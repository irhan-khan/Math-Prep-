import { useState, useEffect, useRef } from 'react';
import { collection, query, getDocs, addDoc, serverTimestamp, where, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { User } from 'firebase/auth';
import { ClassifiedQuestion } from '../services/geminiService';
import { 
  Loader2, 
  Timer, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  AlertCircle, 
  Bookmark, 
  Flag, 
  X,
  Trophy,
  RotateCcw,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Zap,
  ArrowRight,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';

interface MockTestProps {
  user: User;
}

const EXAM_CONFIGS: Record<string, { questions: number, duration: number, negative: number, positive: number }> = {
  'SSC CGL Tier 1': { questions: 25, duration: 12, negative: 0.5, positive: 2 },
  'SSC CGL Tier 2': { questions: 30, duration: 60, negative: 0, positive: 3 },
  'SSC CHSL': { questions: 25, duration: 60, negative: 0.5, positive: 2 },
  'IBPS PO': { questions: 35, duration: 20, negative: 0.25, positive: 1 },
  'IBPS Clerk': { questions: 35, duration: 20, negative: 0.25, positive: 1 },
  'SBI PO': { questions: 30, duration: 20, negative: 0.25, positive: 1 },
  'RRB NTPC': { questions: 30, duration: 90, negative: 0.33, positive: 1 },
  'CAT': { questions: 22, duration: 40, negative: 1, positive: 3 },
  'UPSC CSAT': { questions: 20, duration: 120, negative: 0.83, positive: 2.5 }
};

export default function MockTest({ user }: MockTestProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<'setup' | 'test' | 'result'>('setup');
  const [examType, setExamType] = useState('SSC CGL Tier 1');
  const [questions, setQuestions] = useState<(ClassifiedQuestion & { id: string })[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timePerQuestion, setTimePerQuestion] = useState<Record<string, number>>({});
  const [markedForReview, setMarkedForReview] = useState<Record<string, boolean>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [expandedSolutions, setExpandedSolutions] = useState<Record<string, boolean>>({});
  const [analysis, setAnalysis] = useState<{
    timeSinks: string[];
    sillyMistakes: string[];
    chapterAccuracy: Record<string, { total: number, correct: number }>;
  } | null>(null);
  
  const answersRef = useRef<Record<string, string>>({});
  const timePerQuestionRef = useRef<Record<string, number>>({});
  const lastQuestionStartTimeRef = useRef<number>(0);
  const timeLeftRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const config = EXAM_CONFIGS[examType] || EXAM_CONFIGS['SSC CGL Tier 1'];

  const startTest = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'questions'), 
        where('examType', '==', examType.split(' ')[0]), // Match base exam type for broad search if needed
        limit(config.questions)
      );
      const querySnapshot = await getDocs(q);
      let fetched = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as (ClassifiedQuestion & { id: string })[];

      // If specific exam fetch fails, try a general fetch
      if (fetched.length < config.questions) {
        const generalQ = query(collection(db, 'questions'), limit(config.questions));
        const generalSnap = await getDocs(generalQ);
        fetched = generalSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as (ClassifiedQuestion & { id: string })[];
      }

      if (fetched.length === 0) {
        toast.error('No questions found. Please upload a PDF first.');
        setLoading(false);
        return;
      }

      setQuestions(fetched);
      const initialTime = config.duration * 60;
      setTimeLeft(initialTime);
      timeLeftRef.current = initialTime;
      setStep('test');
      setStartTime(Date.now());
      lastQuestionStartTimeRef.current = Date.now();
      setAnswers({});
      answersRef.current = {};
      timePerQuestionRef.current = {};
      
      timerRef.current = setInterval(() => {
        timeLeftRef.current -= 1;
        setTimeLeft(timeLeftRef.current);
        if (timeLeftRef.current <= 0) {
          submitTest();
        }
      }, 1000);
    } catch (error) {
      console.error('Error starting test:', error);
      toast.error('Failed to start test.');
    } finally {
      setLoading(false);
    }
  };

  const submitTest = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    
    // Update time for the last question
    const now = Date.now();
    const timeOnLast = Math.round((now - lastQuestionStartTimeRef.current) / 1000);
    timePerQuestionRef.current[questions[currentIndex].id] = (timePerQuestionRef.current[questions[currentIndex].id] || 0) + timeOnLast;

    const finalAnswers = answersRef.current;
    const finalTimes = timePerQuestionRef.current;
    const timeTakenTotal = Math.round((now - startTime) / 1000);
    
    const results = questions.map(q => ({
      questionId: q.id,
      selectedAnswer: finalAnswers[q.id] || null,
      isCorrect: finalAnswers[q.id] === q.correctAnswer,
      chapter: q.chapter,
      timeTaken: finalTimes[q.id] || 0
    }));

    const correctCount = results.filter(r => r.isCorrect).length;
    const wrongCount = results.filter(r => r.selectedAnswer !== null && !r.isCorrect).length;
    const rawScore = (correctCount * config.positive) - (wrongCount * config.negative);
    const maxScore = questions.length * config.positive;
    const scorePercentage = (rawScore / maxScore) * 100;

    // Post-Analysis Logic
    const avgTime = timeTakenTotal / questions.length;
    const timeSinks = results
      .filter(r => !r.isCorrect && r.timeTaken > avgTime * 2)
      .map(r => r.questionId);
    
    const sillyMistakes = results
      .filter(r => !r.isCorrect && r.selectedAnswer !== null && r.timeTaken < 10)
      .map(r => r.questionId);

    const chapterAccuracy: Record<string, { total: number, correct: number }> = {};
    results.forEach(r => {
      if (!chapterAccuracy[r.chapter]) chapterAccuracy[r.chapter] = { total: 0, correct: 0 };
      chapterAccuracy[r.chapter].total++;
      if (r.isCorrect) chapterAccuracy[r.chapter].correct++;
    });

    setAnalysis({ timeSinks, sillyMistakes, chapterAccuracy });

    try {
      await addDoc(collection(db, 'users', user.uid, 'mockAttempts'), {
        uid: user.uid,
        examType,
        duration: config.duration,
        timeTaken: timeTakenTotal,
        score: scorePercentage,
        rawScore,
        maxScore,
        correctCount,
        wrongCount,
        results,
        timestamp: serverTimestamp()
      });
      setStep('result');
    } catch (error) {
      console.error('Error saving mock result:', error);
      toast.error('Failed to save results, but showing summary.');
      setStep('result');
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleAnswer = (opt: string) => {
    const newAnswers = { ...answers, [questions[currentIndex].id]: opt };
    setAnswers(newAnswers);
    answersRef.current = newAnswers;
  };

  const handleNavigate = (newIndex: number) => {
    const now = Date.now();
    const timeSpent = Math.round((now - lastQuestionStartTimeRef.current) / 1000);
    const qId = questions[currentIndex].id;
    
    timePerQuestionRef.current[qId] = (timePerQuestionRef.current[qId] || 0) + timeSpent;
    setTimePerQuestion({ ...timePerQuestionRef.current });
    
    setCurrentIndex(newIndex);
    lastQuestionStartTimeRef.current = now;
  };

  if (step === 'setup') {
    return (
      <div className="p-12 max-w-2xl mx-auto">
        <h2 className="font-serif italic text-4xl mb-8">Mock Test Setup</h2>
        <div className="bg-white border border-[#141414] p-10 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] space-y-8">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 block mb-3">Select Exam</label>
            <div className="flex flex-wrap gap-3">
              {Object.keys(EXAM_CONFIGS).map(type => (
                <button
                  key={type}
                  onClick={() => setExamType(type)}
                  className={cn(
                    "px-4 py-2 text-xs font-bold border transition-all",
                    examType === type ? "bg-[#141414] text-white border-[#141414]" : "border-[#E4E3E0] hover:border-[#141414]"
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6 p-6 bg-[#F9F9F8] border border-[#E4E3E0]">
            <div>
              <p className="text-[10px] font-bold uppercase opacity-40 mb-1">Questions</p>
              <p className="text-xl font-serif italic">{config.questions}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase opacity-40 mb-1">Duration</p>
              <p className="text-xl font-serif italic">{config.duration}m</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase opacity-40 mb-1">Negative</p>
              <p className="text-xl font-serif italic text-red-500">-{config.negative}</p>
            </div>
          </div>

          <button
            onClick={startTest}
            disabled={loading}
            className="w-full bg-[#F27D26] text-black py-4 font-bold uppercase tracking-widest hover:bg-[#141414] hover:text-white transition-all duration-300 flex items-center justify-center gap-3"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Start Mock Test"}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'test') {
    const currentQ = questions[currentIndex];
    return (
      <div className="flex h-full bg-[#E4E3E0]">
        <div className="flex-1 p-12 overflow-y-auto">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-8">
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-[#141414] text-white">
                {currentQ.chapter}
              </span>
              <div className="flex flex-col items-end">
                <div className={cn(
                  "flex items-center gap-2 font-mono text-xl font-bold",
                  timeLeft < 300 ? "text-red-500 animate-pulse" : "text-[#141414]"
                )}>
                  <Timer className="w-5 h-5" />
                  {formatTime(timeLeft)}
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mt-1">
                  Pace: {Math.round((config.duration * 60) / config.questions)}s per question
                </p>
              </div>
            </div>

            <div className="bg-white border border-[#141414] p-10 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] mb-8">
              <h3 className="text-2xl font-serif leading-relaxed mb-10">{currentQ.text}</h3>
              <div className="grid grid-cols-1 gap-4">
                {currentQ.options.map((opt, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAnswer(opt)}
                    className={cn(
                      "flex items-center gap-4 p-5 text-left border transition-all",
                      answers[currentQ.id] === opt ? "bg-[#F5F5F5] border-[#141414]" : "border-[#E4E3E0] hover:border-[#141414]"
                    )}
                  >
                    <span className={cn(
                      "w-8 h-8 flex items-center justify-center rounded-full border text-xs font-bold",
                      answers[currentQ.id] === opt ? "bg-[#141414] text-white border-[#141414]" : "border-[#E4E3E0]"
                    )}>
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className="font-sans text-lg">{opt}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-between items-center">
              <div className="flex gap-4">
                <button
                  onClick={() => setMarkedForReview({ ...markedForReview, [currentQ.id]: !markedForReview[currentQ.id] })}
                  className={cn(
                    "flex items-center gap-2 px-6 py-3 text-xs font-bold uppercase tracking-widest border transition-all",
                    markedForReview[currentQ.id] ? "bg-amber-500 text-black border-amber-500" : "bg-white border-[#141414]"
                  )}
                >
                  <Flag className="w-4 h-4" />
                  {markedForReview[currentQ.id] ? "Marked" : "Mark for Review"}
                </button>
              </div>
              <div className="flex gap-4">
                <button
                  disabled={currentIndex === 0}
                  onClick={() => handleNavigate(currentIndex - 1)}
                  className="p-3 border border-[#141414] disabled:opacity-30"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <button
                  disabled={currentIndex === questions.length - 1}
                  onClick={() => handleNavigate(currentIndex + 1)}
                  className="p-3 border border-[#141414] disabled:opacity-30"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
                <button
                  onClick={() => setShowSubmitModal(true)}
                  className="bg-[#141414] text-white px-8 py-3 font-bold uppercase tracking-widest hover:bg-[#F27D26] hover:text-black transition-all"
                >
                  Submit Test
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Submit Confirmation Modal */}
        <AnimatePresence>
          {showSubmitModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white border-2 border-[#141414] p-8 max-w-md w-full shadow-[12px_12px_0px_0px_rgba(20,20,20,1)]"
              >
                <div className="flex justify-between items-start mb-6">
                  <h3 className="font-serif italic text-2xl">Submit Test?</h3>
                  <button onClick={() => setShowSubmitModal(false)} className="p-1 hover:bg-gray-100 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-[#8E9299] mb-8">
                  You have attempted {Object.keys(answers).length} out of {questions.length} questions. 
                  Are you sure you want to end the test now?
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setShowSubmitModal(false)}
                    className="py-3 border border-[#141414] font-bold uppercase tracking-widest hover:bg-gray-50 transition-colors"
                  >
                    Go Back
                  </button>
                  <button
                    onClick={() => {
                      setShowSubmitModal(false);
                      submitTest();
                    }}
                    className="py-3 bg-[#F27D26] text-black font-bold uppercase tracking-widest hover:bg-[#141414] hover:text-white transition-colors"
                  >
                    Submit
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Palette Sidebar */}
        <div className="w-80 bg-white border-l border-[#141414] p-8 overflow-y-auto">
          <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-6">Question Palette</h4>
          <div className="grid grid-cols-5 gap-3">
            {questions.map((q, idx) => (
              <button
                key={q.id}
                onClick={() => handleNavigate(idx)}
                className={cn(
                  "w-10 h-10 flex items-center justify-center text-xs font-bold border transition-all",
                  currentIndex === idx && "ring-2 ring-[#F27D26] ring-offset-2",
                  markedForReview[q.id] ? "bg-amber-500 text-black border-amber-500" :
                  answers[q.id] ? "bg-green-500 text-white border-green-500" :
                  "bg-[#E4E3E0] border-[#E4E3E0] text-[#8E9299]"
                )}
              >
                {idx + 1}
              </button>
            ))}
          </div>
          <div className="mt-12 space-y-4">
            <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest">
              <div className="w-3 h-3 bg-green-500" />
              <span>Attempted</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest">
              <div className="w-3 h-3 bg-amber-500" />
              <span>Marked for Review</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest">
              <div className="w-3 h-3 bg-[#E4E3E0]" />
              <span>Unattempted</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'result') {
    const correctCount = questions.filter(q => answers[q.id] === q.correctAnswer).length;
    const wrongCount = Object.keys(answers).length - correctCount;
    const rawScore = (correctCount * config.positive) - (wrongCount * config.negative);
    const maxScore = questions.length * config.positive;
    const accuracy = Object.keys(answers).length > 0 ? Math.round(correctCount / Object.keys(answers).length * 100) : 0;
    const scorePercentage = Math.round((rawScore / maxScore) * 100);

    return (
      <div className="p-12 max-w-4xl mx-auto">
        <div className="bg-[#141414] text-white p-12 shadow-[12px_12px_0px_0px_rgba(242,125,38,1)] mb-12">
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 bg-[#F27D26] rounded-full flex items-center justify-center">
                <Trophy className="w-10 h-10 text-black" />
              </div>
              <div>
                <h2 className="font-serif italic text-4xl">Test Analysis</h2>
                <p className="text-[#8E9299] uppercase text-[10px] font-bold tracking-widest mt-2">{examType} Pattern</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase font-bold opacity-40 mb-1">Final Score</p>
              <p className="text-5xl font-serif italic text-[#F27D26]">{rawScore.toFixed(2)}<span className="text-xl text-white/40">/{maxScore}</span></p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-8">
            <div className="p-6 border border-white/10 bg-white/5">
              <p className="text-[10px] uppercase font-bold opacity-40 mb-2">Accuracy</p>
              <p className="text-3xl font-serif italic">{accuracy}%</p>
            </div>
            <div className="p-6 border border-white/10 bg-white/5">
              <p className="text-[10px] uppercase font-bold opacity-40 mb-2">Correct</p>
              <p className="text-3xl font-serif italic text-green-500">{correctCount}</p>
            </div>
            <div className="p-6 border border-white/10 bg-white/5">
              <p className="text-[10px] uppercase font-bold opacity-40 mb-2">Incorrect</p>
              <p className="text-3xl font-serif italic text-red-500">{wrongCount}</p>
            </div>
            <div className="p-6 border border-white/10 bg-white/5">
              <p className="text-[10px] uppercase font-bold opacity-40 mb-2">Score %</p>
              <p className="text-3xl font-serif italic">{scorePercentage}%</p>
            </div>
          </div>

          <div className="mt-12 flex gap-4">
            <button 
              onClick={() => setReviewMode(!reviewMode)}
              className="flex-1 bg-white text-black py-4 font-bold uppercase tracking-widest hover:bg-[#F27D26] transition-colors flex items-center justify-center gap-2"
            >
              <BookOpen className="w-4 h-4" />
              {reviewMode ? 'Hide Review' : 'Review Answers'}
            </button>
            <button 
              onClick={() => setStep('setup')}
              className="flex-1 border border-white/20 py-4 font-bold uppercase tracking-widest hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              New Mock Test
            </button>
          </div>
        </div>

        {reviewMode && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 mb-12">
            <h3 className="font-serif italic text-2xl">Detailed Review</h3>
            {questions.map((q, idx) => {
              const userAnswer = answers[q.id];
              const isCorrect = userAnswer === q.correctAnswer;
              const isExpanded = expandedSolutions[q.id];

              return (
                <div key={q.id} className="bg-white border border-[#141414] shadow-[6px_6px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
                  <div className="p-6 border-b border-[#E4E3E0] flex items-center justify-between bg-[#F9F9F8]">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 flex items-center justify-center bg-[#141414] text-white text-[10px] font-bold">
                        {idx + 1}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-[#141414]">
                        {q.chapter}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-[#141414] opacity-50">
                        {q.difficulty}
                      </span>
                    </div>
                    <div className={cn(
                      "text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full",
                      isCorrect ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    )}>
                      {isCorrect ? 'Correct' : userAnswer ? 'Incorrect' : 'Unattempted'}
                    </div>
                  </div>

                  <div className="p-8">
                    <p className="text-lg font-serif mb-6">{q.text}</p>
                    <div className="grid grid-cols-2 gap-4 mb-6">
                      {q.options.map((opt, oIdx) => (
                        <div 
                          key={oIdx}
                          className={cn(
                            "p-4 border text-sm",
                            opt === q.correctAnswer ? "border-green-500 bg-green-50 text-green-700 font-bold" :
                            opt === userAnswer && !isCorrect ? "border-red-500 bg-red-50 text-red-700" :
                            "border-[#E4E3E0]"
                          )}
                        >
                          <span className="mr-2 opacity-40">{String.fromCharCode(65 + oIdx)}.</span>
                          {opt}
                        </div>
                      ))}
                    </div>

                    <button 
                      onClick={() => setExpandedSolutions(prev => ({ ...prev, [q.id]: !isExpanded }))}
                      className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#F27D26] hover:underline"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      {isExpanded ? 'Hide Solution' : 'View Solution'}
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="mt-6 p-6 bg-[#F9F9F8] border-t border-[#E4E3E0]"
                        >
                          <div className="flex items-center gap-2 mb-4 text-[#F27D26]">
                            <Zap className="w-4 h-4" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Trick Method</span>
                          </div>
                          <div className="prose prose-sm max-w-none font-sans text-[#141414]">
                            <ReactMarkdown>{q.trickMethod}</ReactMarkdown>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}

        {/* Post-Analysis Section */}
        {analysis && (
          <div className="grid grid-cols-2 gap-8 mb-12">
            <div className="bg-white border border-[#141414] p-8 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
              <div className="flex items-center gap-3 mb-6">
                <Clock className="w-6 h-6 text-red-500" />
                <h3 className="font-serif italic text-2xl">Time Sinks</h3>
              </div>
              <p className="text-xs text-[#8E9299] mb-6">Questions where you spent {'>'}2x average time but still got wrong. These are your "danger zones".</p>
              <div className="space-y-4">
                {analysis.timeSinks.length > 0 ? analysis.timeSinks.map(qId => {
                  const q = questions.find(q => q.id === qId);
                  return (
                    <div key={qId} className="p-4 border border-red-100 bg-red-50/50 flex items-center justify-between">
                      <span className="text-xs font-bold">{q?.chapter}</span>
                      <span className="text-xs font-mono text-red-600 font-bold">{timePerQuestion[qId]}s</span>
                    </div>
                  );
                }) : (
                  <p className="text-xs italic opacity-40">No major time sinks found. Great time management!</p>
                )}
              </div>
            </div>

            <div className="bg-white border border-[#141414] p-8 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
              <div className="flex items-center gap-3 mb-6">
                <AlertCircle className="w-6 h-6 text-amber-500" />
                <h3 className="font-serif italic text-2xl">Silly Mistakes</h3>
              </div>
              <p className="text-xs text-[#8E9299] mb-6">Questions answered in {'<'}10s but got wrong. You were too fast!</p>
              <div className="space-y-4">
                {analysis.sillyMistakes.length > 0 ? analysis.sillyMistakes.map(qId => {
                  const q = questions.find(q => q.id === qId);
                  return (
                    <div key={qId} className="p-4 border border-amber-100 bg-amber-50/50 flex items-center justify-between">
                      <span className="text-xs font-bold">{q?.chapter}</span>
                      <span className="text-xs font-mono text-amber-600 font-bold">{timePerQuestion[qId]}s</span>
                    </div>
                  );
                }) : (
                  <p className="text-xs italic opacity-40">No silly mistakes found. You were careful!</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="bg-white border border-[#141414] p-10 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] mb-12">
          <h3 className="font-serif italic text-2xl mb-8">Chapter-wise Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-[#141414]">
                  <th className="py-4 text-[10px] font-bold uppercase tracking-widest opacity-40">Chapter</th>
                  <th className="py-4 text-[10px] font-bold uppercase tracking-widest opacity-40">Attempted</th>
                  <th className="py-4 text-[10px] font-bold uppercase tracking-widest opacity-40">Correct</th>
                  <th className="py-4 text-[10px] font-bold uppercase tracking-widest opacity-40">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(
                  questions.reduce((acc, q) => {
                    const chapter = q.chapter;
                    if (!acc[chapter]) acc[chapter] = { total: 0, correct: 0, attempted: 0 };
                    acc[chapter].total++;
                    if (answers[q.id]) {
                      acc[chapter].attempted++;
                      if (answers[q.id] === q.correctAnswer) acc[chapter].correct++;
                    }
                    return acc;
                  }, {} as Record<string, { total: number, correct: number, attempted: number }>)
                ).map(([chapter, stats]) => (
                  <tr key={chapter} className="border-b border-[#E4E3E0]">
                    <td className="py-4 font-bold text-sm">{chapter}</td>
                    <td className="py-4 text-sm">{stats.attempted}/{stats.total}</td>
                    <td className="py-4 text-sm">{stats.correct}</td>
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-[#E4E3E0] rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full",
                              (stats.correct / (stats.attempted || 1)) >= 0.8 ? "bg-green-500" :
                              (stats.correct / (stats.attempted || 1)) >= 0.5 ? "bg-amber-500" : "bg-red-50"
                            )}
                            style={{ width: `${(stats.correct / (stats.attempted || 1)) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-bold">{Math.round((stats.correct / (stats.attempted || 1)) * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-12 flex justify-center">
            <button 
              onClick={() => {
                const chapterStats = Object.entries(
                  questions.reduce((acc, q) => {
                    const chapter = q.chapter;
                    if (!acc[chapter]) acc[chapter] = { total: 0, correct: 0, attempted: 0 };
                    acc[chapter].total++;
                    if (answers[q.id]) {
                      acc[chapter].attempted++;
                      if (answers[q.id] === q.correctAnswer) acc[chapter].correct++;
                    }
                    return acc;
                  }, {} as Record<string, { total: number, correct: number, attempted: number }>)
                ).map(([chapter, stats]) => ({ chapter, accuracy: stats.correct / (stats.attempted || 1) }));
                
                const weakest = chapterStats.sort((a, b) => a.accuracy - b.accuracy)[0]?.chapter;
                navigate(`/practice?chapter=${encodeURIComponent(weakest || '')}`);
              }}
              className="flex items-center gap-3 bg-[#141414] text-white px-10 py-5 font-bold uppercase tracking-widest hover:bg-[#F27D26] hover:text-black transition-all shadow-[6px_6px_0px_0px_rgba(242,125,38,1)] group"
            >
              Practice Weak Chapters <ArrowRight className="w-5 h-5 group-hover:translate-x-2 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
