import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { Zap, BookOpen, BrainCircuit, CheckCircle2, XCircle, ChevronRight, Target, TrendingUp, Bookmark, BookmarkCheck, Flag, AlertTriangle, Loader2, Info } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ClassifiedQuestion, classifyMistake, MistakeType, generateProgressiveHints } from '../services/geminiService';
import SimilarQuestions from './SimilarQuestions';
import { db } from '../firebase';
import { doc, setDoc, deleteDoc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { calculateNextReview } from '../utils/spacedRepetition';
import { useGamification } from '../hooks/useGamification';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface QuestionCardProps {
  question: ClassifiedQuestion & { id: string };
  userId: string;
  onAnswer: (isCorrect: boolean, timeTaken: number, quality: number, hintsUsed: number) => void;
  onNext: () => void;
  onPrevious?: () => void;
  isFirst?: boolean;
}

const QuestionCard = React.memo(({ question, userId, onAnswer, onNext, onPrevious, isFirst }: QuestionCardProps) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [quality, setQuality] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'trick' | 'standard' | 'concept'>('trick');
  const [startTime] = useState(Date.now());
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isMarkedForReview, setIsMarkedForReview] = useState(false);
  const [note, setNote] = useState('');
  const [mistakeAnalysis, setMistakeAnalysis] = useState<{ type: MistakeType; reasoning: string } | null>(null);
  const [isAnalyzingMistake, setIsAnalyzingMistake] = useState(false);
  const { addXP } = useGamification(userId);
  
  // Hint System State
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hints, setHints] = useState<{hint1: string, hint2: string, hint3: string} | null>(null);
  const [isGeneratingHints, setIsGeneratingHints] = useState(false);
  const [showHintButton, setShowHintButton] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  useEffect(() => {
    if (selectedOption) return;
    const timer = setInterval(() => {
      setSecondsElapsed(prev => {
        if (prev + 1 >= 60) setShowHintButton(true);
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [selectedOption]);

  const handleRevealHint = async () => {
    if (hintsUsed >= 3) return;
    
    // XP costs: Hint 1 (free), Hint 2 (-5), Hint 3 (-10)
    if (hintsUsed === 1) await addXP(-5);
    if (hintsUsed === 2) await addXP(-10);

    if (!hints) {
      setIsGeneratingHints(true);
      try {
        const generated = await generateProgressiveHints(question, 'English'); 
        setHints(generated);
      } catch (error) {
        toast.error('Failed to generate hints');
        return;
      } finally {
        setIsGeneratingHints(false);
      }
    }
    
    setHintsUsed(prev => prev + 1);
  };

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const bookmarkSnap = await getDoc(doc(db, 'users', userId, 'bookmarks', question.id));
        setIsBookmarked(bookmarkSnap.exists());
        
        const reviewSnap = await getDoc(doc(db, 'users', userId, 'markedForReview', question.id));
        setIsMarkedForReview(reviewSnap.exists());

        const noteSnap = await getDoc(doc(db, 'users', userId, 'notes', question.id));
        if (noteSnap.exists()) setNote(noteSnap.data().text);
      } catch (error) {
        console.error('Error checking question status:', error);
      }
    };
    checkStatus();
  }, [question.id, userId]);

  const toggleBookmark = async () => {
    try {
      const ref = doc(db, 'users', userId, 'bookmarks', question.id);
      if (isBookmarked) {
        await deleteDoc(ref);
      } else {
        await setDoc(ref, { timestamp: new Date() });
      }
      setIsBookmarked(!isBookmarked);
    } catch (error) {
      toast.error('Failed to update bookmark');
    }
  };

  const toggleMarkForReview = async () => {
    try {
      const ref = doc(db, 'users', userId, 'markedForReview', question.id);
      if (isMarkedForReview) {
        await deleteDoc(ref);
      } else {
        await setDoc(ref, { timestamp: new Date() });
      }
      setIsMarkedForReview(!isMarkedForReview);
    } catch (error) {
      toast.error('Failed to update review status');
    }
  };

  const saveNote = async (text: string) => {
    try {
      await setDoc(doc(db, 'users', userId, 'notes', question.id), { text, timestamp: new Date() });
    } catch (error) {
      toast.error('Failed to save note');
    }
  };

  const handleOptionSelect = async (option: string) => {
    if (selectedOption) return;
    setSelectedOption(option);
    setShowSolution(true);

    // Save formula to library if it exists
    if (question.formulaKey && question.trickMethod) {
      try {
        const formulaRef = doc(db, 'users', userId, 'formulas', question.formulaKey);
        await setDoc(formulaRef, {
          formulaKey: question.formulaKey,
          trickMethod: question.trickMethod,
          chapter: question.chapter,
          exampleQuestion: question.text,
          exampleAnswer: question.correctAnswer,
          timestamp: new Date(),
          isStarred: false,
          language: 'English' // Default
        }, { merge: true });
      } catch (error) {
        console.error('Error saving formula:', error);
      }
    }

    if (option !== question.correctAnswer) {
      setIsAnalyzingMistake(true);
      try {
        const analysis = await classifyMistake(question, option, question.correctAnswer);
        setMistakeAnalysis(analysis);
        
        // Track mistake type in user stats for dashboard
        const statsRef = doc(db, 'users', userId, 'stats', 'mistakes');
        const statsSnap = await getDoc(statsRef);
        
        if (!statsSnap.exists()) {
          await setDoc(statsRef, {
            [analysis.type]: 1,
            chapterBreakdown: {
              [question.chapter]: {
                [analysis.type]: 1
              }
            }
          });
        } else {
          await updateDoc(statsRef, {
            [analysis.type]: increment(1),
            [`chapterBreakdown.${question.chapter}.${analysis.type}`]: increment(1)
          });
        }
      } catch (error) {
        console.error('Mistake analysis failed:', error);
      } finally {
        setIsAnalyzingMistake(false);
      }
    }
  };

  const handleQualitySelect = (q: number) => {
    setQuality(q);
    const isCorrect = selectedOption === question.correctAnswer;
    const timeTaken = Math.round((Date.now() - startTime) / 1000);
    onAnswer(isCorrect, timeTaken, q, hintsUsed);
  };

  const getProbabilityColor = (score: number) => {
    if (score >= 70) return 'text-red-500 bg-red-50 border-red-200';
    if (score >= 40) return 'text-amber-500 bg-amber-50 border-amber-200';
    return 'text-green-500 bg-green-50 border-green-200';
  };

  const getMistakeCTA = (type: MistakeType) => {
    switch (type) {
      case "Concept gap":
      case "Wrong formula applied":
        return {
          text: "Isko bookmark karo aur concept note padho",
          action: () => {
            if (!isBookmarked) toggleBookmark();
            setActiveTab('concept');
          }
        };
      case "Calculation mistake":
        return {
          text: "Isko 2 din baad phir karo (Calculation check)",
          action: () => toast.info("Scheduled for re-practice in 2 days")
        };
      case "Misread question":
        return {
          text: "Dhyan se padho — ek baar question highlight karo",
          action: () => toast.info("Focus on keywords like 'not', 'except', 'only'")
        };
      default:
        return null;
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-3xl mx-auto"
    >
      <div className="bg-white border border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
        <div className="p-6 border-b border-[#E4E3E0] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-[#141414] text-white">
              {question.chapter}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-[#141414]">
              {question.examPattern}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-[#141414] opacity-50">
              {question.difficulty}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className={cn("flex items-center gap-2 px-3 py-1 border rounded-full text-[10px] font-bold uppercase tracking-widest", getProbabilityColor(question.probabilityScore))}>
              <TrendingUp className="w-3 h-3" />
              <span>{question.probabilityScore}% Probability</span>
            </div>
            <button 
              onClick={toggleMarkForReview} 
              className={cn("p-1 transition-colors", isMarkedForReview ? "text-amber-500" : "hover:text-amber-500")}
              title="Mark for Review"
            >
              <Flag className={cn("w-5 h-5", isMarkedForReview && "fill-current")} />
            </button>
            <button onClick={toggleBookmark} className="p-1 hover:text-[#F27D26] transition-colors">
              {isBookmarked ? <BookmarkCheck className="w-5 h-5 text-[#F27D26]" /> : <Bookmark className="w-5 h-5" />}
            </button>
          </div>
        </div>

        <div className="p-10">
          <h3 className="text-2xl font-serif leading-relaxed mb-10">{question.text}</h3>
          
          {/* Socratic Hint System */}
          <div className="mb-8 overflow-hidden">
            <AnimatePresence>
              {showHintButton && !selectedOption && hintsUsed < 3 && (
                <motion.button
                  key="hint-button"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ 
                    opacity: 1, 
                    scale: [1, 1.05, 1],
                  }}
                  transition={{
                    scale: {
                      repeat: Infinity,
                      duration: 2,
                      ease: "easeInOut"
                    }
                  }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleRevealHint}
                  disabled={isGeneratingHints}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 border border-amber-200 text-[10px] font-bold uppercase tracking-widest hover:bg-amber-200 transition-all shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]"
                >
                  {isGeneratingHints ? <Loader2 className="w-3 h-3 animate-spin" /> : <BrainCircuit className="w-3 h-3" />}
                  {hintsUsed === 0 ? "Need a nudge?" : hintsUsed === 1 ? "Show me more" : "One more step"}
                  {hintsUsed === 1 && <span className="ml-1 text-red-500">(-5 XP)</span>}
                  {hintsUsed === 2 && <span className="ml-1 text-red-500">(-10 XP)</span>}
                </motion.button>
              )}
            </AnimatePresence>

            {hintsUsed > 0 && hints && (
              <div className="mt-4 space-y-3">
                <AnimatePresence>
                  {[1, 2, 3].slice(0, hintsUsed).map((num) => (
                    <motion.div
                      key={num}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-amber-50 border-l-4 border-amber-400 text-xs text-amber-800 italic"
                    >
                      <span className="font-bold uppercase mr-2">Hint {num}:</span>
                      {(hints as any)[`hint${num}`]}
                    </motion.div>
                  ))}
                </AnimatePresence>
                {hintsUsed === 3 && (
                  <p className="text-[10px] font-bold uppercase text-amber-600 mt-2">
                    You've used all hints. Try your best answer now.
                  </p>
                )}
              </div>
            )}
          </div>
          
          {selectedOption && selectedOption !== question.correctAnswer && (
            <div className="mb-8">
              {isAnalyzingMistake ? (
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#8E9299]">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Galti kahan hui? Analyzing...
                </div>
              ) : mistakeAnalysis && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-red-50 border border-red-200 p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-red-600">
                        Galti: {mistakeAnalysis.type}
                      </span>
                    </div>
                    {getMistakeCTA(mistakeAnalysis.type) && (
                      <button 
                        onClick={getMistakeCTA(mistakeAnalysis.type)?.action}
                        className="text-[10px] font-bold uppercase tracking-widest text-[#F27D26] hover:underline flex items-center gap-1"
                      >
                        <Info className="w-3 h-3" />
                        {getMistakeCTA(mistakeAnalysis.type)?.text}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-red-700 italic">"{mistakeAnalysis.reasoning}"</p>
                </motion.div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">
            {question.options.map((option, idx) => {
              const isSelected = selectedOption === option;
              const isCorrect = option === question.correctAnswer;
              const showCorrect = showSolution && isCorrect;
              const showWrong = showSolution && isSelected && !isCorrect;
              return (
                <button
                  key={idx}
                  onClick={() => handleOptionSelect(option)}
                  disabled={showSolution}
                  className={cn(
                    "group relative flex items-center gap-4 p-5 text-left border transition-all duration-200",
                    !showSolution && "hover:border-[#141414] hover:bg-[#F5F5F5]",
                    showCorrect && "border-green-500 bg-green-50 text-green-700",
                    showWrong && "border-red-500 bg-red-50 text-red-700",
                    !showSolution && "border-[#E4E3E0]"
                  )}
                >
                  <span className={cn(
                    "w-8 h-8 flex items-center justify-center rounded-full border text-xs font-bold transition-colors",
                    showCorrect ? "bg-green-500 border-green-500 text-white" : 
                    showWrong ? "bg-red-500 border-red-500 text-white" : 
                    "border-[#E4E3E0] group-hover:border-[#141414]"
                  )}>
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="flex-1 font-sans text-lg">{option}</span>
                  {showCorrect && <CheckCircle2 className="w-6 h-6 text-green-500" />}
                  {showWrong && <XCircle className="w-6 h-6 text-red-500" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-10 border-t border-[#E4E3E0] flex justify-between items-center bg-white">
          <div className="flex gap-4">
            {!isFirst && onPrevious && (
              <button 
                onClick={onPrevious}
                className="flex items-center gap-3 px-8 py-4 font-bold uppercase tracking-widest transition-all border border-[#141414] text-[#141414] hover:bg-[#F5F5F5] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]"
              >
                Previous
              </button>
            )}
            <button 
              onClick={toggleMarkForReview}
              className={cn(
                "flex items-center gap-3 px-8 py-4 font-bold uppercase tracking-widest transition-all border",
                isMarkedForReview 
                  ? "bg-amber-100 border-amber-500 text-amber-700 shadow-[4px_4px_0px_0px_rgba(245,158,11,1)]" 
                  : "bg-white border-[#141414] text-[#141414] hover:bg-[#F5F5F5] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]"
              )}
            >
              <Flag className={cn("w-5 h-5", isMarkedForReview && "fill-current")} />
              {isMarkedForReview ? 'Marked' : 'Mark for Review'}
            </button>
          </div>

          {showSolution && (
            <div className="flex-1 flex flex-col items-center gap-4">
              {!quality ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#8E9299]">Aapko kitna confident tha?</p>
                  <div className="grid grid-cols-4 gap-2 w-full max-w-lg">
                    {[
                      { label: "😰 Didn't know", q: 1, color: "hover:bg-red-50 border-red-200" },
                      { label: "😕 Was hard", q: 2, color: "hover:bg-orange-50 border-orange-200" },
                      { label: "🙂 Got it", q: 3, color: "hover:bg-blue-50 border-blue-200" },
                      { label: "😎 Too easy", q: 5, color: "hover:bg-green-50 border-green-200" }
                    ].map((btn) => {
                      // Pre-calculate interval for display
                      const nextReview = calculateNextReview(btn.q);
                      return (
                        <button 
                          key={btn.q}
                          onClick={() => handleQualitySelect(btn.q)}
                          className={cn(
                            "group flex flex-col items-center justify-center p-3 border border-[#141414] transition-all",
                            btn.color
                          )}
                        >
                          <span className="text-[10px] font-bold uppercase tracking-widest mb-1">{btn.label}</span>
                          <span className="text-[8px] opacity-40 group-hover:opacity-100">Next: {nextReview.interval}d</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <button onClick={onNext} className="flex items-center gap-3 bg-[#141414] text-white px-8 py-4 font-bold uppercase tracking-widest hover:bg-[#F27D26] hover:text-black transition-all shadow-[4px_4px_0px_0px_rgba(242,125,38,1)]">
                  Next Question <ChevronRight className="w-5 h-5" />
                </button>
              )}
            </div>
          )}
        </div>

        <AnimatePresence>
          {showSolution && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="border-t border-[#141414] bg-[#F9F9F8]">
              <div className="flex border-b border-[#E4E3E0]">
                {['trick', 'standard', 'concept'].map((tab) => (
                  <button 
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={cn(
                      "flex-1 py-4 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-all",
                      activeTab === tab ? "bg-[#F27D26] text-black" : "hover:bg-[#E4E3E0] text-[#8E9299]"
                    )}
                  >
                    {tab === 'trick' && <Zap className="w-4 h-4" />}
                    {tab === 'standard' && <BookOpen className="w-4 h-4" />}
                    {tab === 'concept' && <BrainCircuit className="w-4 h-4" />}
                    {tab} Method
                  </button>
                ))}
              </div>

              <div className="p-10">
                <div className="prose prose-sm max-w-none font-sans leading-relaxed text-[#141414]">
                  <ReactMarkdown>
                    {activeTab === 'trick' ? question.trickMethod : activeTab === 'standard' ? question.standardMethod : question.conceptNote}
                  </ReactMarkdown>
                </div>

                <div className="mt-8">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={(e) => saveNote(e.target.value)}
                    placeholder="Add your personal notes here..."
                    className="w-full p-4 bg-white border border-[#E4E3E0] text-xs font-sans focus:border-[#141414] outline-none transition-all"
                    rows={3}
                  />
                </div>

                <div className="mt-12 flex justify-end gap-4">
                  {quality && (
                    <button onClick={onNext} className="flex items-center gap-3 bg-[#141414] text-white px-8 py-4 font-bold uppercase tracking-widest hover:bg-[#F27D26] hover:text-black transition-all shadow-[4px_4px_0px_0px_rgba(242,125,38,1)]">
                      Next Question <ChevronRight className="w-5 h-5" />
                    </button>
                  )}
                </div>

                <SimilarQuestions originalQuestion={question} userId={userId} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});

export default QuestionCard;
