import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import * as pdfjs from 'pdfjs-dist';
// @ts-ignore - pdfjsWorker is a URL string from Vite
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { FileUp, Loader2, CheckCircle2, AlertCircle, BrainCircuit, Zap, Target, History, Trash2, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { extractQuestionsFromText, extractQuestionsFromPDF, classifyAndSolveQuestion, batchClassifyAndSolveQuestions, ClassifiedQuestion } from '../services/geminiService';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, query, where, orderBy, getDocs, deleteDoc, doc, getDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { toast } from 'sonner';
import { useLanguage } from '../context/LanguageContext';

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PDFUploaderProps {
  user: User;
}

interface UploadHistory {
  id: string;
  fileName: string;
  questionCount: number;
  timestamp: any;
  breakdown: {
    Easy: number;
    Medium: number;
    Hard: number;
  };
  topChapters: string[];
}

interface ProcessingFile {
  id: string;
  file: File;
  progress: number;
  status: string;
  isComplete: boolean;
  error?: string;
  suggestions?: string[];
  summary?: UploadHistory;
}

export default function PDFUploader({ user }: PDFUploaderProps) {
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);
  const [history, setHistory] = useState<UploadHistory[]>([]);
  const { language, t } = useLanguage();
  const [examContext, setExamContext] = useState("SSC CGL");

  useEffect(() => {
    const fetchUserExam = async () => {
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (userSnap.exists()) {
          setExamContext(userSnap.data().selectedExam || "SSC CGL");
        }
      } catch (error) {
        console.error('Error fetching user exam context:', error);
      }
    };
    fetchUserExam();
  }, [user.uid]);

  const isProcessing = processingFiles.some(f => !f.isComplete && !f.error);

  useEffect(() => {
    fetchHistory();
  }, [user.uid]);

  const fetchHistory = useCallback(async () => {
    try {
      // FIRESTORE INDEX REQUIRED:
      // Collection: users/{uid}/uploads
      // Fields: timestamp (Descending)
      const q = query(
        collection(db, 'users', user.uid, 'uploads'),
        orderBy('timestamp', 'desc')
      );
      const snap = await getDocs(q);
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() } as UploadHistory)));
    } catch (err) {
      console.error('Error fetching history:', err);
      toast.error('Failed to load upload history');
    }
  }, [user.uid]);

  const deleteHistory = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'uploads', id));
      setHistory(prev => prev.filter(h => h.id !== id));
      toast.success('Upload record deleted');
    } catch (err) {
      toast.error('Failed to delete record');
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const updateFileStatus = useCallback((id: string, updates: Partial<ProcessingFile>) => {
    setProcessingFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }, []);

  const extractTextFromPDF = async (file: File, onStatusUpdate: (s: string) => void) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    
    onStatusUpdate(`Extracting text from ${pdf.numPages} pages...`);
    
    const pagePromises = Array.from({ length: pdf.numPages }, (_, i) => i + 1).map(async (pageNum) => {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        return textContent.items
          .map((item: any) => ('str' in item ? item.str : ''))
          .join(' ');
      } catch (pageErr) {
        console.error(`Error extracting text from page ${pageNum}:`, pageErr);
        return '';
      }
    });
    
    const pageTexts = await Promise.all(pagePromises);
    const fullText = pageTexts.join('\n');
    
    if (!fullText.trim()) {
      const err = new Error('No text content found in PDF. It might be a scanned image or protected.');
      (err as any).suggestions = [
        'The PDF might be a scanned image without a text layer.',
        'The PDF might be password protected.',
        'Try a different PDF or use a clearer scan.'
      ];
      throw err;
    }
    
    return { text: fullText, pageCount: pdf.numPages };
  };

  const processingIdsRef = useRef<Set<string>>(new Set());

  const processFile = useCallback(async (processingFile: ProcessingFile) => {
    const { id, file } = processingFile;
    const heartbeat = { interval: null as ReturnType<typeof setInterval> | null };
    
    const startHeartbeat = (prefix: string) => {
      stopHeartbeat();
      const start = Date.now();
      heartbeat.interval = setInterval(() => {
        const elapsed = Math.round((Date.now() - start) / 1000);
        updateFileStatus(id, { status: `${prefix} (${elapsed}s elapsed...)` });
      }, 2000);
    };
    
    const stopHeartbeat = () => {
      if (heartbeat.interval) {
        clearInterval(heartbeat.interval);
        heartbeat.interval = null;
      }
    };
    
    try {
      // Step 1: Size check
      if (file.size > 20 * 1024 * 1024) {
        throw Object.assign(new Error('File too large. Maximum allowed size is 20MB.'), {
          suggestions: ['Split the PDF into smaller parts (10-15 pages each).', 'Compress the PDF using online tools.']
        });
      }

      // Step 2: Extract text with pdfjs
      updateFileStatus(id, { status: 'Reading PDF...', progress: 5 });
      let rawQuestions: string[] = [];
      
      let extractedText = '';
      let pageCount = 0;
      
      try {
        const result = await extractTextFromPDF(file, (s) => updateFileStatus(id, { status: s }));
        extractedText = result.text;
        pageCount = result.pageCount;
      } catch (textErr: any) {
        if (textErr.message?.toLowerCase().includes('password')) {
          throw Object.assign(new Error('PDF is password protected. Remove the password first.'), {
            suggestions: ['Use Adobe Acrobat or an online tool to remove the password.']
          });
        }
        // No text layer — will fallback to OCR below
      }

      // Step 3: Extract question list
      if (extractedText.trim().length > 100) {
        // Text-based PDF path
        updateFileStatus(id, { status: 'AI identifying questions...', progress: 20 });
        startHeartbeat('Scanning for questions');
        try {
          rawQuestions = await extractQuestionsFromText(extractedText);
        } finally {
          stopHeartbeat();
        }
      } else {
        // Scanned/image PDF — use Gemini Vision OCR
        updateFileStatus(id, { status: 'Scanned PDF detected. Starting AI OCR...', progress: 15 });
        startHeartbeat('AI OCR in progress');
        try {
          const base64 = await fileToBase64(file);
          rawQuestions = await extractQuestionsFromPDF(base64);
        } finally {
          stopHeartbeat();
        }
      }

      if (!rawQuestions || rawQuestions.length === 0) {
        throw Object.assign(new Error('No math questions found in this PDF.'), {
          suggestions: [
            'Make sure the PDF contains quantitative aptitude or math questions.',
            'Try a different exam paper PDF.',
            'If it is a scanned image, ensure the scan is clear and legible.'
          ]
        });
      }

      // Step 4: Classify in parallel batches
      updateFileStatus(id, { 
        status: `Found ${rawQuestions.length} questions. Generating solutions...`, 
        progress: 40 
      });

      const breakdown = { Easy: 0, Medium: 0, Hard: 0 };
      const chapters: Record<string, number> = {};
      const BATCH_SIZE = 8; 
      const CONCURRENCY = 3;
      
      const chunks: string[][] = [];
      for (let i = 0; i < rawQuestions.length; i += BATCH_SIZE) {
        chunks.push(rawQuestions.slice(i, i + BATCH_SIZE));
      }

      let processedCount = 0;

      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const window = chunks.slice(i, i + CONCURRENCY);
        
        updateFileStatus(id, {
          status: `Processing questions: ${processedCount}/${rawQuestions.length} complete (${Math.round((processedCount/rawQuestions.length)*100)}%)`,
          progress: 40 + Math.round((processedCount / rawQuestions.length) * 58)
        });

        const results = await Promise.allSettled(window.map(chunk => 
          batchClassifyAndSolveQuestions(chunk, examContext, language)
        ));

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const currentChunk = window[j];
          
          let batchResults: ClassifiedQuestion[] = [];

          if (result.status === 'fulfilled') {
            batchResults = result.value;
          } else {
            console.warn(`Parallel batch failed, falling back to individual processing for chunk:`, result.reason);
            // Individual fallback for this specific failed chunk
            for (const qText of currentChunk) {
              try {
                const indResult = await classifyAndSolveQuestion(qText, examContext, language);
                batchResults.push(indResult);
              } catch (indErr) {
                console.error(`Failed to process question individually:`, indErr);
              }
            }
          }

          // Save to Firestore
          if (batchResults.length > 0) {
            await Promise.all(batchResults.map(async (classified) => {
              try {
                await addDoc(collection(db, 'questions'), {
                  ...classified,
                  sourcePdf: file.name,
                  createdAt: serverTimestamp(),
                  createdBy: user.uid
                });
                breakdown[classified.difficulty] = (breakdown[classified.difficulty] || 0) + 1;
                chapters[classified.chapter] = (chapters[classified.chapter] || 0) + 1;
              } catch (saveErr) {
                console.error('Failed to save question to Firestore:', saveErr);
              }
            }));
          }
          processedCount += currentChunk.length;
        }

        // Update progress after window
        updateFileStatus(id, {
          status: `Processing questions: ${processedCount}/${rawQuestions.length} complete (${Math.round((processedCount/rawQuestions.length)*100)}%)`,
          progress: 40 + Math.round((processedCount / rawQuestions.length) * 58)
        });
      }

      // Step 5: Save upload record
      const topChapters = Object.entries(chapters)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name);

      const totalSaved = Object.values(breakdown).reduce((a, b) => a + b, 0);
      
      const uploadData = {
        fileName: file.name,
        questionCount: totalSaved,
        timestamp: serverTimestamp(),
        breakdown,
        topChapters: topChapters.length > 0 ? topChapters : ['General']
      };

      const docRef = await addDoc(collection(db, 'users', user.uid, 'uploads'), uploadData);
      
      updateFileStatus(id, {
        isComplete: true,
        status: 'Complete',
        progress: 100,
        summary: { id: docRef.id, ...uploadData }
      });
      
      fetchHistory();
      
    } catch (error: any) {
      stopHeartbeat();
      console.error('Processing error for file', file.name, ':', error);
      updateFileStatus(id, {
        error: error instanceof Error ? error.message : 'Unknown error occurred.',
        status: 'Error',
        suggestions: (error as any).suggestions || [
          'Check your internet connection and try again.',
          'Refresh the page and re-upload the file.',
          'Try a different or smaller PDF.'
        ]
      });
    }
  }, [user.uid, fetchHistory, updateFileStatus, examContext, language]);

  // Queue management: Process up to 2 files concurrently
  useEffect(() => {
    const activeCount = processingFiles.filter(f => 
      !f.isComplete && !f.error && f.status !== 'Queued'
    ).length;

    if (activeCount >= 2) return; // max 2 concurrent

    const nextFile = processingFiles.find(
      f => f.status === 'Queued' && !processingIdsRef.current.has(f.id)
    );
    
    if (!nextFile) return;
    
    processingIdsRef.current.add(nextFile.id);
    updateFileStatus(nextFile.id, { status: 'Starting...', progress: 2 });
    
    processFile(nextFile).finally(() => {
      processingIdsRef.current.delete(nextFile.id);
    });
  }, [processingFiles.map(f => f.status).join(',')]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      progress: 0,
      status: 'Queued',
      isComplete: false
    }));

    setProcessingFiles(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    disabled: isProcessing
  });

  return (
    <div className="max-w-4xl mx-auto space-y-12 pb-20">
      <header className="space-y-2">
        <h2 className="text-4xl font-serif italic text-[#141414]">{t('uploadPdf')}</h2>
        <p className="text-[#8E9299] font-sans">{t('uploadDescription') || 'AI-first question detection and classification.'}</p>
      </header>

      <div 
        {...getRootProps()} 
        className={cn(
          "relative border-2 border-dashed rounded-3xl p-20 transition-all duration-500 cursor-pointer group overflow-hidden",
          isDragActive 
            ? "border-[#F27D26] bg-[#F27D26]/5 scale-[0.98]" 
            : "border-[#2A2A2A] hover:border-[#F27D26] bg-white shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] hover:shadow-[12px_12px_0px_0px_rgba(242,125,38,1)]",
          isProcessing && 'opacity-50 pointer-events-none'
        )}
      >
        <input {...getInputProps()} />
        <div className="absolute inset-0 bg-gradient-to-br from-[#F27D26]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        
        <div className="relative z-10 space-y-6 text-center">
          <div className="w-24 h-24 bg-[#F27D26]/10 rounded-full flex items-center justify-center mx-auto group-hover:scale-110 transition-transform duration-500 group-hover:rotate-12">
            <FileUp className="w-12 h-12 text-[#F27D26]" />
          </div>
          <div>
            <h3 className="text-2xl font-serif italic text-[#141414]">{t('dropPdfHere')}</h3>
            <p className="text-[#8E9299] mt-2 font-sans">{t('orClickToBrowse')}</p>
            <div className="flex items-center justify-center gap-4 mt-8 opacity-40">
              <span className="text-[10px] uppercase font-bold tracking-widest">Max 20MB</span>
              <span className="w-1 h-1 bg-[#141414] rounded-full" />
              <span className="text-[10px] uppercase font-bold tracking-widest">OCR Supported</span>
              <span className="w-1 h-1 bg-[#141414] rounded-full" />
              <span className="text-[10px] uppercase font-bold tracking-widest">Math Expert</span>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {processingFiles.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 bg-[#F27D26] rounded-full animate-pulse" />
              <h3 className="text-[10px] uppercase font-bold tracking-widest opacity-40">Active Processing Queue</h3>
            </div>
            <div className="grid gap-4">
              {processingFiles.map((f) => (
                <motion.div 
                  key={f.id} 
                  layout
                  className={cn(
                    "bg-white border-2 border-[#141414] p-8 shadow-[6px_6px_0px_0px_rgba(20,20,20,1)] relative overflow-hidden transition-all duration-300",
                    f.error && "border-red-500 shadow-[6px_6px_0_0_rgba(239,68,68,1)]",
                    f.isComplete && "border-green-500 shadow-[6px_6px_0_0_rgba(34,197,94,1)]"
                  )}
                >
                  <div className="flex justify-between items-start mb-6">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <FileText className={cn("w-5 h-5", f.error ? "text-red-500" : "text-[#F27D26]")} />
                        <p className="font-bold text-lg truncate">{f.file.name}</p>
                      </div>
                      <p className={cn(
                        "text-[10px] uppercase font-bold tracking-wider",
                        f.error ? "text-red-500" : "text-[#F27D26]"
                      )}>
                        {f.error || f.status}
                      </p>
                    </div>
                    {f.isComplete && (
                      <div className="bg-green-500 text-white p-1 rounded-full">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                  
                  {!f.isComplete && !f.error && f.status !== 'Queued' && (
                    <div className="space-y-4">
                      <div className="w-full h-3 bg-[#E4E3E0] rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-[#F27D26]" 
                          animate={{ width: `${f.progress}%` }} 
                          transition={{ type: "spring", stiffness: 40 }}
                        />
                      </div>
                      <div className="flex justify-between items-center">
                        <p className="text-xs font-bold text-[#8E9299] uppercase tracking-widest truncate pr-4">
                          {f.status}
                        </p>
                        <span className="text-xs font-mono font-bold text-[#F27D26] shrink-0">
                          {f.progress}%
                        </span>
                      </div>
                      {f.progress > 40 && f.progress < 99 && (
                        <p className="text-[10px] text-[#8E9299] opacity-60">
                          AI is generating trick solutions & exam probability scores. 
                          This takes 1–3 min for large papers. Please keep this tab open.
                        </p>
                      )}
                    </div>
                  )}

                  {f.summary && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }} 
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-6 pt-6 border-t-2 border-[#E4E3E0] grid grid-cols-3 gap-6"
                    >
                      <div className="space-y-1">
                        <p className="text-[8px] uppercase font-bold opacity-40 tracking-widest">Questions</p>
                        <p className="text-xl font-serif italic">{f.summary.questionCount}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[8px] uppercase font-bold opacity-40 tracking-widest">Difficulty</p>
                        <div className="flex gap-2">
                          <span className="text-[10px] font-bold text-green-600">E:{f.summary.breakdown.Easy}</span>
                          <span className="text-[10px] font-bold text-orange-600">M:{f.summary.breakdown.Medium}</span>
                          <span className="text-[10px] font-bold text-red-600">H:{f.summary.breakdown.Hard}</span>
                        </div>
                      </div>
                      <div className="flex justify-end items-center">
                        <button 
                          onClick={() => setProcessingFiles(prev => prev.filter(pf => pf.id !== f.id))}
                          className="px-4 py-2 bg-[#141414] text-white text-[10px] uppercase font-bold tracking-widest hover:bg-[#F27D26] hover:text-black transition-all duration-300"
                        >
                          Dismiss
                        </button>
                      </div>
                    </motion.div>
                  )}
                  
                  {f.error && (
                    <div className="mt-6 space-y-4">
                      {f.suggestions && f.suggestions.length > 0 && (
                        <div className="bg-red-50 border-l-4 border-red-500 p-4 space-y-2">
                          <p className="text-[10px] uppercase font-bold text-red-500 tracking-widest">
                            How to fix this:
                          </p>
                          <ul className="space-y-1">
                            {f.suggestions.map((s, idx) => (
                              <li key={idx} className="text-xs text-red-700 flex items-start gap-2">
                                <span className="shrink-0 font-bold">{idx + 1}.</span>
                                <span>{s}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="flex gap-3">
                        <button
                          onClick={() => {
                            // Reset this file to Queued state for retry
                            setProcessingFiles(prev => prev.map(pf => 
                              pf.id === f.id 
                                ? { ...pf, error: undefined, suggestions: undefined, status: 'Queued', progress: 0 }
                                : pf
                            ));
                          }}
                          className="px-4 py-2 bg-[#F27D26] text-black text-[10px] uppercase font-bold 
                                     tracking-widest hover:bg-[#141414] hover:text-white transition-all"
                        >
                          Retry
                        </button>
                        <button 
                          onClick={() => setProcessingFiles(prev => prev.filter(pf => pf.id !== f.id))}
                          className="px-4 py-2 border-2 border-red-500 text-red-500 text-[10px] uppercase 
                                     font-bold tracking-widest hover:bg-red-500 hover:text-white transition-all"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="space-y-6">
        <div className="flex items-center gap-3 opacity-40">
          <History className="w-5 h-5" />
          <h3 className="text-[10px] uppercase font-bold tracking-widest">Recent Upload History</h3>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {history.map(h => (
            <div key={h.id} className="bg-white border-2 border-[#141414] p-6 flex items-center justify-between group hover:shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] transition-all duration-300">
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate text-sm mb-1">{h.fileName}</p>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] opacity-40 uppercase font-bold tracking-tighter">{h.questionCount} Questions</span>
                  <span className="w-1 h-1 bg-[#141414] rounded-full opacity-20" />
                  <span className="text-[10px] opacity-40 uppercase font-bold tracking-tighter truncate">{h.topChapters[0]}</span>
                </div>
              </div>
              <button 
                onClick={() => deleteHistory(h.id)} 
                className="p-2 text-[#8E9299] hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {history.length === 0 && (
            <div className="col-span-full py-12 text-center border-2 border-dashed border-[#2A2A2A] opacity-20 rounded-2xl">
              <p className="text-sm font-bold uppercase tracking-widest">No upload history yet</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
