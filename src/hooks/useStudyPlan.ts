import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { GoogleGenAI, Type } from "@google/genai";
import { toast } from 'sonner';

export interface StudyPlanDay {
  day: number;
  dayLabel: string;
  primaryChapter: string;
  revisionChapter: string;
  questionTarget: number;
  practiceMode: string;
  formulaToMemorize: string;
  tip: string;
  completed?: boolean;
}

export function useStudyPlan(userId: string, language: string) {
  const [plan, setPlan] = useState<StudyPlanDay[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlan = useCallback(async () => {
    if (!userId) return;
    try {
      const snap = await getDoc(doc(db, 'users', userId, 'studyPlan', 'current'));
      if (snap.exists()) {
        setPlan(snap.data().plan);
      }
    } catch (error) {
      console.error('Error fetching study plan:', error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  const generatePlan = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      // 1. Fetch performance data
      const attemptsSnap = await getDocs(collection(db, 'users', userId, 'attempts'));
      const chapterStats: Record<string, { correct: number, total: number }> = {};
      attemptsSnap.forEach(d => {
        const data = d.data();
        if (!chapterStats[data.chapter]) chapterStats[data.chapter] = { correct: 0, total: 0 };
        chapterStats[data.chapter].total++;
        if (data.isCorrect) chapterStats[data.chapter].correct++;
      });

      const weakChapters = Object.entries(chapterStats)
        .filter(([_, stats]) => (stats.correct / stats.total) < 0.5)
        .map(([name]) => name);
      
      const strongChapters = Object.entries(chapterStats)
        .filter(([_, stats]) => (stats.correct / stats.total) >= 0.75)
        .map(([name]) => name);

      // 2. Fetch available question counts per chapter
      const questionsSnap = await getDocs(collection(db, 'questions'));
      const chapterQuestionCounts: Record<string, number> = {};
      questionsSnap.forEach(d => {
        const chapter = d.data().chapter;
        chapterQuestionCounts[chapter] = (chapterQuestionCounts[chapter] || 0) + 1;
      });

      // 3. Call Gemini
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const prompt = `Create a 7-day math study plan for a competitive exam student.
      Weak chapters (needs most work): ${weakChapters.join(', ')}
      Strong chapters (can revise quickly): ${strongChapters.join(', ')}  
      Total questions available per chapter: ${JSON.stringify(chapterQuestionCounts)}
      Language: ${language}

      Rules:
      - Alternate weak and strong chapters (don't pile all weak chapters on day 1)
      - Each day: 1 primary chapter focus, 1 revision chapter
      - Suggest specific practice mode for each day
      - Day 7 is always a mixed mock/revision day
      - Be specific and actionable, like a real coaching institute schedule

      Return JSON array (7 items):
      [{
        "day": number,
        "dayLabel": string,
        "primaryChapter": string,
        "revisionChapter": string,
        "questionTarget": number,
        "practiceMode": string,
        "formulaToMemorize": string,
        "tip": string
      }]`;

      const result = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt
      });
      const text = result.text;
      const cleanJson = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      const generatedPlan = JSON.parse(cleanJson);

      await setDoc(doc(db, 'users', userId, 'studyPlan', 'current'), {
        plan: generatedPlan,
        generatedAt: serverTimestamp()
      });
      
      setPlan(generatedPlan);
      toast.success('New study plan generated!');
    } catch (error) {
      console.error('Error generating study plan:', error);
      toast.error('Failed to generate study plan');
    } finally {
      setLoading(false);
    }
  };

  const toggleDayCompletion = async (dayIndex: number) => {
    const newPlan = [...plan];
    newPlan[dayIndex].completed = !newPlan[dayIndex].completed;
    setPlan(newPlan);
    try {
      await setDoc(doc(db, 'users', userId, 'studyPlan', 'current'), { plan: newPlan }, { merge: true });
    } catch (error) {
      console.error('Error updating plan:', error);
    }
  };

  return { plan, loading, generatePlan, toggleDayCompletion };
}
