import { GoogleGenAI, Type } from "@google/genai";
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function hashQuestion(text: string): string {
  // Simple hash: remove spaces/punctuation, lowercase, take first 100 chars as key
  return text.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 80);
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5, initialDelay = 2000): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorStr = typeof error === 'string' ? error : JSON.stringify(error);
      const isRateLimit = 
        error.message?.includes('429') || 
        error.status === 'RESOURCE_EXHAUSTED' || 
        error.error?.status === 'RESOURCE_EXHAUSTED' ||
        errorStr.includes('429') ||
        errorStr.includes('RESOURCE_EXHAUSTED') ||
        errorStr.includes('quota');
        
      if (isRateLimit && i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.warn(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export interface ClassifiedQuestion {
  text: string;
  options: string[];
  correctAnswer: string;
  chapter: string;
  subtopic: string;
  difficulty: "Easy" | "Medium" | "Hard";
  examType: string;
  trickMethod: string;
  standardMethod: string;
  conceptNote: string;
  probabilityScore: number;
  examPattern: string;
  formulaKey?: string; // Unique key for the shortcut/formula used
}

export async function extractQuestionsFromPDF(base64Data: string): Promise<string[]> {
  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          inlineData: {
            mimeType: "application/pdf",
            data: base64Data
          }
        },
        {
          text: "You are a question paper parser. From the attached PDF (which might be a scanned image), identify and extract each individual math/quantitative aptitude question. Return ONLY a JSON array of strings where each string is one complete question including its answer options. Be extremely fast and concise. Ignore instructions, headers, and non-question content."
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        },
      },
    }));

    const text = response.text;
    if (!text) return [];
    
    try {
      const cleanJson = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      return JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('JSON Parse Error in extractQuestionsFromPDF:', parseError, 'Raw text:', text);
      // Fallback: try to fix common JSON issues
      try {
        const fixedJson = text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
        return JSON.parse(fixedJson);
      } catch (e) {
        throw parseError;
      }
    }
  } catch (error) {
    console.error('Error extracting questions from PDF:', error);
    const err = new Error('Failed to extract questions from PDF. The file might be too large or corrupted.');
    (err as any).suggestions = [
      'Check if the PDF is too large (Gemini has limits on file size).',
      'Try splitting the PDF into smaller parts.',
      'Ensure the PDF is not corrupted and can be opened in a standard viewer.',
      'If it is a scanned image, ensure the text is legible.'
    ];
    throw err;
  }
}

export async function extractQuestionsFromText(fullPdfText: string): Promise<string[]> {
  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `You are a question paper parser. From the following text extracted from a competitive exam PDF, identify and extract each individual math/quantitative aptitude question. 
      
      Return ONLY a JSON array of strings where each string is one complete question including its answer options. 
      Be extremely fast and concise. Do NOT include any explanations or markdown code blocks.
      Ignore instructions, headers, and non-question content. 
      
      Text: 
      ${fullPdfText}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        },
      },
    }));

    const text = response.text;
    if (!text) return [];
    
    try {
      const cleanJson = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      return JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('JSON Parse Error in extractQuestionsFromText:', parseError, 'Raw text:', text);
      try {
        const fixedJson = text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
        return JSON.parse(fixedJson);
      } catch (e) {
        throw parseError;
      }
    }
  } catch (error) {
    console.error('Error extracting questions:', error);
    const err = new Error('Failed to extract questions from PDF text.');
    (err as any).suggestions = [
      'The extracted text might be too large for the AI to process in one go.',
      'Ensure the PDF has a valid text layer (not just images).',
      'Try uploading a shorter version of the PDF.'
    ];
    throw err;
  }
}

export async function classifyAndSolveQuestion(
  questionText: string, 
  examContext: string = "SSC CGL",
  language: string = "English"
): Promise<ClassifiedQuestion> {
  const hash = hashQuestion(questionText);
  const cacheRef = doc(db, 'questions', hash);
  
  try {
    const cacheSnap = await getDoc(cacheRef);
    if (cacheSnap.exists()) {
      console.log('Cache HIT for question:', hash);
      return cacheSnap.data() as ClassifiedQuestion;
    }
  } catch (e) {
    console.warn('Cache check failed:', e);
  }

  try {
    const langInstruction = language === "Hindi" 
      ? "Provide the trickMethod, standardMethod, and conceptNote in simple Hindi language that an SSC aspirant from a Hindi-medium background can understand."
      : "Provide the trickMethod, standardMethod, and conceptNote in clear English.";

    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `Analyze the following math question for the ${examContext} exam. 
      Extract the question text, options, and identify the correct answer.
      Classify it into a chapter and subtopic.
      Identify the specific exam pattern (e.g., "Pipe & Cistern", "Train Speed", "Compound Interest", "Ages Problem").
      
      Provide a "Trick Method" (fastest shortcut), a "Standard Method" (textbook approach), and a "Concept Note".
      Also provide a "formulaKey" which is a short, unique slug (e.g., "ratio-method-work", "unit-digit-multiplication") that identifies the specific trick/formula used.
      ${langInstruction}

      Assign a probabilityScore from 0-100 based on THESE SPECIFIC CRITERIA for the ${examContext} exam:
      - Base score by chapter frequency in that exam (Percentage/Profit-Loss/Time-Work = +40 base for SSC, Number System/Algebra = +35, Geometry/Trigonometry = +30, DI/Statistics = +25 for CAT)
      - Add +20 if this is a 'calculation-based' question (most common type in SSC)
      - Add +15 if the question uses a common pattern (train problems, pipe-cistern, partnership)
      - Add +10 if difficulty is Medium (most SSC questions are medium)
      - Subtract -20 if difficulty is Hard (hard questions appear rarely in SSC but more in CAT)
      - Final score should be between 5 and 95

      Return ONLY a JSON object with the specified properties. Do NOT include any other text or markdown code blocks.

      Question:
      ${questionText}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
            correctAnswer: { type: Type.STRING },
            chapter: { type: Type.STRING },
            subtopic: { type: Type.STRING },
            difficulty: { type: Type.STRING, enum: ["Easy", "Medium", "Hard"] },
            examType: { type: Type.STRING },
            trickMethod: { type: Type.STRING },
            standardMethod: { type: Type.STRING },
            conceptNote: { type: Type.STRING },
            formulaKey: { type: Type.STRING },
            probabilityScore: { type: Type.NUMBER },
            examPattern: { type: Type.STRING },
          },
          required: ["text", "options", "correctAnswer", "chapter", "difficulty", "trickMethod", "standardMethod", "conceptNote", "probabilityScore", "examPattern", "formulaKey"],
        },
      },
    }));

    const text = response.text;
    if (!text) throw new Error('Empty response from AI');
    
    try {
      const cleanJson = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      const result = JSON.parse(cleanJson);
      
      // Save to cache
      setDoc(cacheRef, {
        ...result,
        cachedAt: serverTimestamp()
      }).catch(e => console.error('Failed to save to cache:', e));
      
      return result;
    } catch (parseError) {
      console.error('JSON Parse Error in classifyAndSolveQuestion:', parseError, 'Raw text:', text);
      try {
        // Fix invalid escapes like \x or single backslashes in math
        const fixedJson = text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
        const result = JSON.parse(fixedJson);
        
        // Save to cache
        setDoc(cacheRef, {
          ...result,
          cachedAt: serverTimestamp()
        }).catch(e => console.error('Failed to save to cache:', e));
        
        return result;
      } catch (e) {
        throw parseError;
      }
    }
  } catch (error) {
    console.error('Error classifying question:', error);
    throw new Error('Failed to classify and solve question.');
  }
}

export async function batchClassifyAndSolveQuestions(
  questions: string[],
  examContext: string = "SSC CGL",
  language: string = "English"
): Promise<ClassifiedQuestion[]> {
  // Increased batch size to 8 for Gemini 2.0 Flash
  if (questions.length > 8) {
    console.warn('batchClassifyAndSolveQuestions: max 8 questions per batch. Truncating.');
    questions = questions.slice(0, 8);
  }
  if (questions.length === 0) return [];
  
  const results: ClassifiedQuestion[] = [];
  const toProcess: string[] = [];
  const toProcessHashes: string[] = [];

  for (const qText of questions) {
    const hash = hashQuestion(qText);
    const cacheRef = doc(db, 'questions', hash);
    try {
      const snap = await getDoc(cacheRef);
      if (snap.exists()) {
        console.log('Batch Cache HIT for question:', hash);
        results.push(snap.data() as ClassifiedQuestion);
      } else {
        toProcess.push(qText);
        toProcessHashes.push(hash);
      }
    } catch (e) {
      toProcess.push(qText);
      toProcessHashes.push(hash);
    }
  }

  if (toProcess.length === 0) return results;

  try {
    const langInstruction = language === "Hindi" 
      ? "Provide the trickMethod, standardMethod, and conceptNote in simple Hindi language that an SSC aspirant from a Hindi-medium background can understand."
      : "Provide the trickMethod, standardMethod, and conceptNote in clear English.";

    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `Analyze the following ${toProcess.length} math questions for the ${examContext} exam. 
      For EACH question:
      1. Extract the question text and options.
      2. Identify the correct answer.
      3. Classify it into a chapter and subtopic.
      4. Identify the specific exam pattern (e.g., "Pipe & Cistern", "Train Speed", "Compound Interest", "Ages Problem").
      5. Provide a "Trick Method" (fastest shortcut), a "Standard Method" (textbook approach), and a "Concept Note".
      6. Provide a "formulaKey" which is a short, unique slug (e.g., "ratio-method-work", "unit-digit-multiplication") that identifies the specific trick/formula used.
      ${langInstruction}
      7. Assign a probabilityScore from 0-100 based on THESE SPECIFIC CRITERIA for the ${examContext} exam:
         - Base score by chapter frequency in that exam (Percentage/Profit-Loss/Time-Work = +40 base for SSC, Number System/Algebra = +35, Geometry/Trigonometry = +30, DI/Statistics = +25 for CAT)
         - Add +20 if this is a 'calculation-based' question (most common type in SSC)
         - Add +15 if the question uses a common pattern (train problems, pipe-cistern, partnership)
         - Add +10 if difficulty is Medium (most SSC questions are medium)
         - Subtract -20 if difficulty is Hard (hard questions appear rarely in SSC but more in CAT)
         - Final score should be between 5 and 95

      Return ONLY a JSON array of objects with the specified properties. Do NOT include any other text or markdown code blocks.

      Questions to process:
      ${toProcess.map((q, i) => `Question ${i + 1}:\n${q}`).join('\n\n---\n\n')}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctAnswer: { type: Type.STRING },
              chapter: { type: Type.STRING },
              subtopic: { type: Type.STRING },
              difficulty: { type: Type.STRING, enum: ["Easy", "Medium", "Hard"] },
              examType: { type: Type.STRING },
              trickMethod: { type: Type.STRING },
              standardMethod: { type: Type.STRING },
              conceptNote: { type: Type.STRING },
              formulaKey: { type: Type.STRING },
              probabilityScore: { type: Type.NUMBER },
              examPattern: { type: Type.STRING },
            },
            required: ["text", "options", "correctAnswer", "chapter", "difficulty", "trickMethod", "standardMethod", "conceptNote", "probabilityScore", "examPattern", "formulaKey"],
          },
        },
      },
    }), 7, 3000); // 7 retries, 3s initial delay

    const text = response.text;
    if (!text) throw new Error('Empty response from AI');
    
    let batchResults: ClassifiedQuestion[] = [];
    try {
      const cleanJson = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      batchResults = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('JSON Parse Error in batchClassifyAndSolveQuestions:', parseError, 'Raw text:', text);
      try {
        const fixedJson = text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
        batchResults = JSON.parse(fixedJson);
      } catch (e) {
        throw parseError;
      }
    }

    // Save to cache
    batchResults.forEach((res, idx) => {
      const hash = toProcessHashes[idx];
      if (hash) {
        setDoc(doc(db, 'questions', hash), {
          ...res,
          cachedAt: serverTimestamp()
        }).catch(e => console.error('Failed to save batch to cache:', e));
      }
    });

    return [...results, ...batchResults];
  } catch (error) {
    console.error('Error in batch processing questions:', error);
    throw new Error('Failed to process batch of questions.');
  }
}

export type MistakeType = "Calculation mistake" | "Concept gap" | "Misread question" | "Wrong formula applied" | "Time pressure skip";

export async function classifyMistake(
  question: ClassifiedQuestion,
  userAnswer: string,
  correctAnswer: string
): Promise<{ type: MistakeType; reasoning: string }> {
  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `Analyze why a student might have chosen the wrong answer for this math question.
      
      Question: ${question.text}
      Options: ${question.options.join(', ')}
      Correct Answer: ${correctAnswer}
      Student's Wrong Answer: ${userAnswer}
      Concept: ${question.conceptNote}
      Standard Method: ${question.standardMethod}

      Decide which of these 5 categories the mistake most likely falls into:
      1. "Calculation mistake" - student likely used the right method but made a small arithmetic error.
      2. "Concept gap" - student likely doesn't understand the underlying formula or logic.
      3. "Misread question" - student likely misunderstood what was being asked (e.g., found X when Y was asked).
      4. "Wrong formula applied" - student used a completely incorrect approach or formula.
      5. "Time pressure skip" - student likely guessed or made a very hasty decision.

      Return ONLY a JSON object with 'type' (one of the 5 categories exactly) and 'reasoning' (a short 1-sentence explanation in English).`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            type: { 
              type: Type.STRING, 
              enum: ["Calculation mistake", "Concept gap", "Misread question", "Wrong formula applied", "Time pressure skip"] 
            },
            reasoning: { type: Type.STRING },
          },
          required: ["type", "reasoning"],
        },
      },
    }));

    const text = response.text;
    if (!text) throw new Error('Empty response from AI');
    
    const cleanJson = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error('Error classifying mistake:', error);
    return { type: "Concept gap", reasoning: "Could not determine the exact cause of the error." };
  }
}

export async function generateProgressiveHints(
  question: ClassifiedQuestion, 
  language: string
): Promise<{hint1: string, hint2: string, hint3: string}> {
  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `Generate 3 progressive hints for this math question. 
      Language: ${language}
      Question: ${question.text}
      Correct approach: ${question.trickMethod}

      Rules:
      - Hint 1: Only tell the student WHICH concept/topic applies. Do not give any numbers or steps. Example: 'Think about the relationship between time, speed and distance.'
      - Hint 2: Give the FIRST step only — what to calculate first, not the answer.
      - Hint 3: Give the full METHOD without the final numerical answer.
      - NEVER reveal the answer in any hint.

      Return JSON: {hint1: string, hint2: string, hint3: string}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            hint1: { type: Type.STRING },
            hint2: { type: Type.STRING },
            hint3: { type: Type.STRING },
          },
          required: ["hint1", "hint2", "hint3"],
        },
      },
    }));

    const text = response.text;
    if (!text) throw new Error('Empty response from AI');
    const cleanJson = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error('Error generating hints:', error);
    return {
      hint1: "Think about the core concept used in this problem.",
      hint2: "Try to identify the first variable you need to find.",
      hint3: "Use the standard formula related to this chapter."
    };
  }
}

export async function generateSimilarQuestions(originalQuestion: ClassifiedQuestion): Promise<ClassifiedQuestion[]> {
  try {
    // Increase retries for similar questions as they are often called after a heavy batch process
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `Generate 5 similar practice questions based on this concept:
      Chapter: ${originalQuestion.chapter}
      Subtopic: ${originalQuestion.subtopic}
      Difficulty: ${originalQuestion.difficulty}
      Concept: ${originalQuestion.conceptNote}
      Pattern: ${originalQuestion.examPattern}

      Original Question: ${originalQuestion.text}
      
      IMPORTANT: Ensure all generated questions strictly follow the same 'examPattern' (${originalQuestion.examPattern}) as the original question.
      
      Return ONLY a JSON array of objects with the specified properties. Do NOT include any other text or markdown code blocks.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctAnswer: { type: Type.STRING },
              chapter: { type: Type.STRING },
              subtopic: { type: Type.STRING },
              difficulty: { type: Type.STRING, enum: ["Easy", "Medium", "Hard"] },
              examType: { type: Type.STRING },
              trickMethod: { type: Type.STRING },
              standardMethod: { type: Type.STRING },
              conceptNote: { type: Type.STRING },
              probabilityScore: { type: Type.NUMBER },
              examPattern: { type: Type.STRING },
            },
            required: ["text", "options", "correctAnswer", "chapter", "difficulty", "trickMethod", "standardMethod", "conceptNote", "probabilityScore", "examPattern"],
          },
        },
      },
    }), 7, 3000); // 7 retries, 3s initial delay

    const text = response.text;
    if (!text) return [];
    
    try {
      const cleanJson = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      return JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('JSON Parse Error in generateSimilarQuestions:', parseError, 'Raw text:', text);
      try {
        const fixedJson = text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
        return JSON.parse(fixedJson);
      } catch (e) {
        return [];
      }
    }
  } catch (error) {
    console.error('Error generating similar questions:', error);
    return [];
  }
}
