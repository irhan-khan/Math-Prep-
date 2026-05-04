import { useState, useEffect, useCallback } from 'react';
import { collection, query, limit, getDocs, addDoc, serverTimestamp, where, orderBy, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { User } from 'firebase/auth';
import { ClassifiedQuestion } from '../services/geminiService';
import QuestionCard from './QuestionCard';
import { Loader2, AlertCircle, Filter, CheckCircle2, Trophy, ArrowRight, RotateCcw, History } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { calculateNextReview } from '../utils/spacedRepetition';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useAdaptiveDifficulty } from '../hooks/useAdaptiveDifficulty';
import { useGamification } from '../hooks/useGamification';
import GamificationToast from './GamificationToast';

interface PracticeSessionProps {
  user: User;
}

type Mode = 'Smart Mix (Interleaved)' | 'Chapter Drill' | 'Mixed Practice' | 'High Probability Only' | 'Bookmarked' | 'Due for Review Today' | 'Marked for Review';

export default function PracticeSession({ user }: PracticeSessionProps) {
  const navigate = useNavigate();
  const { abilityModels, updateAbility } = useAdaptiveDifficulty(user.uid);
  const { addXP, awardBadge } = useGamification(user.uid);
  const [questions, setQuestions] = useState<(ClassifiedQuestion & { id: string })[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  const [showXP, setShowXP] = useState(false);
  const [earnedXP, setEarnedXP] = useState(0);
  const [sessionStats, setSessionStats] = useState({ 
    correct: 0, 
    total: 0, 
    avgTime: 0, 
    fastestTime: Infinity,
    chapterAccuracy: {} as Record<string, { correct: number, total: number }>,
    chaptersCovered: new Set<string>()
  });

  // Filter States
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('practice_mode') as Mode) || 'Smart Mix (Interleaved)');
  const [selectedExam, setSelectedExam] = useState<string>(localStorage.getItem('practice_exam') || 'All');
  const [selectedChapter, setSelectedChapter] = useState<string>(localStorage.getItem('practice_chapter') || 'All');
  const [selectedPattern, setSelectedPattern] = useState<string>(localStorage.getItem('practice_pattern') || 'All');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>(localStorage.getItem('practice_difficulty') || 'All');
  const [progressiveDifficulty, setProgressiveDifficulty] = useState(false);
  const [currentDifficultyLevel, setCurrentDifficultyLevel] = useState<"Easy" | "Medium" | "Hard">("Easy");
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);

  const [availableChapters, setAvailableChapters] = useState<string[]>([]);
  const [availablePatterns, setAvailablePatterns] = useState<string[]>([]);
  const [showMarkedOnly, setShowMarkedOnly] = useState(false);

  const saveSessionProgress = useCallback(async (index: number, stats: typeof sessionStats, qIds: string[]) => {
    try {
      await setDoc(doc(db, 'users', user.uid, 'activeSessions', 'practice'), {
        mode,
        selectedExam,
        selectedChapter,
        selectedPattern,
        selectedDifficulty,
        progressiveDifficulty,
        currentDifficultyLevel,
        consecutiveCorrect,
        currentIndex: index,
        sessionStats: {
          ...stats,
          chaptersCovered: Array.from(stats.chaptersCovered)
        },
        questionIds: qIds,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.error('Error saving session progress:', error);
    }
  }, [user.uid, mode, selectedExam, selectedChapter, selectedPattern, selectedDifficulty, progressiveDifficulty, currentDifficultyLevel, consecutiveCorrect]);

  const clearSavedSession = useCallback(async () => {
    try {
      await setDoc(doc(db, 'users', user.uid, 'activeSessions', 'practice'), { completed: true }, { merge: true });
    } catch (error) {
      console.error('Error clearing session:', error);
    }
  }, [user.uid]);

  const checkSavedSession = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, 'users', user.uid, 'activeSessions', 'practice'));
      if (snap.exists() && !snap.data().completed) {
        setHasSavedSession(true);
      }
    } catch (error) {
      console.error('Error checking saved session:', error);
    }
  }, [user.uid]);

  useEffect(() => {
    checkSavedSession();
  }, [checkSavedSession]);

  const resumeSavedSession = async () => {
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'users', user.uid, 'activeSessions', 'practice'));
      if (snap.exists()) {
        const data = snap.data();
        setMode(data.mode);
        setSelectedExam(data.selectedExam);
        setSelectedChapter(data.selectedChapter);
        setSelectedPattern(data.selectedPattern || 'All');
        setSelectedDifficulty(data.selectedDifficulty);
        setProgressiveDifficulty(data.progressiveDifficulty);
        setCurrentDifficultyLevel(data.currentDifficultyLevel);
        setConsecutiveCorrect(data.consecutiveCorrect);
        setSessionStats({
          ...data.sessionStats,
          chaptersCovered: new Set(data.sessionStats.chaptersCovered || [])
        });
        
        const questionsRef = collection(db, 'questions');
        const questionIds = data.questionIds as string[];
        
        // Fetch questions in chunks of 10 (Firestore limit for 'in' queries)
        const fetchedQuestions: (ClassifiedQuestion & { id: string })[] = [];
        for (let i = 0; i < questionIds.length; i += 10) {
          const chunk = questionIds.slice(i, i + 10);
          const q = query(questionsRef, where('__name__', 'in', chunk));
          const querySnapshot = await getDocs(q);
          fetchedQuestions.push(...querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...(doc.data() as object)
          })) as (ClassifiedQuestion & { id: string })[]);
        }
        
        const orderedQuestions = questionIds.map((id: string) => 
          fetchedQuestions.find(q => q.id === id)
        ).filter(Boolean) as (ClassifiedQuestion & { id: string })[];

        setQuestions(orderedQuestions);
        setCurrentIndex(data.currentIndex);
        setResuming(true);
        setHasSavedSession(false);
      }
    } catch (error) {
      console.error('Error resuming session:', error);
      toast.error('Failed to resume session.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    localStorage.setItem('practice_mode', mode);
    localStorage.setItem('practice_exam', selectedExam);
    localStorage.setItem('practice_chapter', selectedChapter);
    localStorage.setItem('practice_pattern', selectedPattern);
    localStorage.setItem('practice_difficulty', selectedDifficulty);
  }, [mode, selectedExam, selectedChapter, selectedPattern, selectedDifficulty]);

  const fetchQuestions = useCallback(async () => {
    if (resuming) {
      setResuming(false);
      return;
    }
    setLoading(true);
    try {
      let q;
      const questionsRef = collection(db, 'questions');
      
      if (mode === 'Smart Mix (Interleaved)') {
        const qRaw = query(questionsRef, limit(100));
        const snap = await getDocs(qRaw);
        const allFetched = snap.docs.map(doc => ({
          id: doc.id,
          ...(doc.data() as object)
        })) as (ClassifiedQuestion & { id: string })[];

        // Interleaving Logic
        const byChapter: Record<string, (ClassifiedQuestion & { id: string })[]> = {};
        allFetched.forEach(q => {
          if (!byChapter[q.chapter]) byChapter[q.chapter] = [];
          byChapter[q.chapter].push(q);
        });

        const interleaved: (ClassifiedQuestion & { id: string })[] = [];
        const chapters = Object.keys(byChapter);
        let chapterIdx = 0;
        const totalQuestions = allFetched.length;

        while (interleaved.length < Math.min(totalQuestions, 20)) {
          const currentChapter = chapters[chapterIdx % chapters.length];
          const chapterQuestions = byChapter[currentChapter];
          
          if (chapterQuestions && chapterQuestions.length > 0) {
            interleaved.push(chapterQuestions.shift()!);
          }
          chapterIdx++;
          
          // If all chapters are empty, break
          if (chapters.every(c => !byChapter[c] || byChapter[c].length === 0)) break;
        }
        setQuestions(interleaved);
      } else if (mode === 'Bookmarked') {
        const bookmarksSnap = await getDocs(collection(db, 'users', user.uid, 'bookmarks'));
        const bookmarkedIds = bookmarksSnap.docs.map(d => d.id);
        if (bookmarkedIds.length === 0) {
          setQuestions([]);
          setLoading(false);
          return;
        }
        // Firestore 'in' query limit is 10
        q = query(questionsRef, where('__name__', 'in', bookmarkedIds.slice(0, 10)));
      } else if (mode === 'Marked for Review') {
        const reviewSnap = await getDocs(collection(db, 'users', user.uid, 'markedForReview'));
        const markedIds = reviewSnap.docs.map(d => d.id);
        if (markedIds.length === 0) {
          setQuestions([]);
          setLoading(false);
          return;
        }
        q = query(questionsRef, where('__name__', 'in', markedIds.slice(0, 10)));
      } else if (mode === 'Due for Review Today') {
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        // FIRESTORE INDEX REQUIRED:
        // Collection: users/{uid}/spacedRepetition
        // Fields: nextReviewDate (Ascending)
        // Create at: https://console.firebase.google.com/project/YOUR_PROJECT/firestore/indexes
        const srsSnap = await getDocs(query(
          collection(db, 'users', user.uid, 'spacedRepetition'),
          where('nextReviewDate', '<=', today)
        ));
        const dueIds = srsSnap.docs.map(d => d.id);
        if (dueIds.length === 0) {
          setQuestions([]);
          setLoading(false);
          return;
        }
        q = query(questionsRef, where('__name__', 'in', dueIds.slice(0, 10)));
      } else {
        const constraints = [];
        if (selectedExam !== 'All') constraints.push(where('examType', '==', selectedExam));
        if (selectedChapter !== 'All') constraints.push(where('chapter', '==', selectedChapter));
        if (selectedPattern !== 'All') constraints.push(where('examPattern', '==', selectedPattern));
        
        if (progressiveDifficulty) {
          constraints.push(where('difficulty', '==', currentDifficultyLevel));
        } else if (selectedDifficulty !== 'All') {
          constraints.push(where('difficulty', '==', selectedDifficulty));
        }

        if (mode === 'High Probability Only') {
          constraints.push(where('probabilityScore', '>=', 70));
        }

        // FIRESTORE INDEX REQUIRED:
        // Collection: questions  
        // Fields: examType (Ascending), chapter (Ascending), difficulty (Ascending), probabilityScore (Ascending)
        q = query(questionsRef, ...constraints, limit(15));
      }

      const querySnapshot = await getDocs(q);
      let fetchedQuestions = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...(doc.data() as object)
      })) as (ClassifiedQuestion & { id: string })[];

      // Apply Adaptive Scoring if in Mixed or Smart Mix mode
      if (mode === 'Mixed Practice' || mode === 'Smart Mix (Interleaved)' || mode === 'High Probability Only') {
        const srsSnap = await getDocs(collection(db, 'users', user.uid, 'spacedRepetition'));
        const srsMap: Record<string, any> = {};
        srsSnap.forEach(d => srsMap[d.id] = d.data());

        const scoredQuestions = fetchedQuestions.map(question => {
          const model = abilityModels[question.chapter];
          const targetLevel = model?.currentLevel || 'Easy';
          const difficultyMatch = question.difficulty === targetLevel ? 1.0 : 0.3;
          
          const srsData = srsMap[question.id];
          const isDue = srsData ? new Date(srsData.nextReviewDate.toDate()) <= new Date() : false;
          const spacedRepetitionDue = isDue ? 1.0 : 0.1;

          const score = (question.probabilityScore * 0.35) + (spacedRepetitionDue * 35) + (difficultyMatch * 30);
          return { ...question, score };
        });

        fetchedQuestions = scoredQuestions.sort((a, b) => (b as any).score - (a as any).score);
      }
      
      if (showMarkedOnly && mode !== 'Marked for Review') {
        const reviewSnap = await getDocs(collection(db, 'users', user.uid, 'markedForReview'));
        const markedIds = new Set(reviewSnap.docs.map(d => d.id));
        fetchedQuestions = fetchedQuestions.filter(q => markedIds.has(q.id));
      }

      setQuestions(fetchedQuestions);
      setCurrentIndex(0);
      setIsSessionComplete(false);
      
      // Initial save
      if (fetchedQuestions.length > 0) {
        saveSessionProgress(0, sessionStats, fetchedQuestions.map(q => q.id));
      }
    } catch (error) {
      console.error('Error fetching questions:', error);
      toast.error('Failed to load questions.');
    } finally {
      setLoading(false);
    }
  }, [user.uid, mode, selectedExam, selectedChapter, selectedPattern, selectedDifficulty, progressiveDifficulty, currentDifficultyLevel]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  useEffect(() => {
    const fetchChapters = async () => {
      const q = query(collection(db, 'questions'), limit(100));
      const snap = await getDocs(q);
      const chapters = Array.from(new Set(snap.docs.map(d => d.data().chapter)));
      setAvailableChapters(chapters);
      
      // Fetch top 10 patterns
      const patterns = snap.docs.map(d => d.data().examPattern).filter(Boolean);
      const patternCounts = patterns.reduce((acc, p) => {
        acc[p] = (acc[p] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const topPatterns = (Object.entries(patternCounts) as [string, number][])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([p]) => p);
      
      setAvailablePatterns(topPatterns);
    };
    fetchChapters();
  }, []);

  const handleAnswer = async (isCorrect: boolean, timeTaken: number, quality: number, hintsUsed: number = 0) => {
    const currentQuestion = questions[currentIndex];
    
    try {
      // 1. Save Attempt
      // FIRESTORE INDEX REQUIRED:
      // Collection: users/{uid}/attempts
      // Fields: timestamp (Ascending)
      await addDoc(collection(db, 'users', user.uid, 'attempts'), {
        uid: user.uid,
        questionId: currentQuestion.id,
        isCorrect,
        timeTaken,
        quality,
        hintsUsed,
        chapter: currentQuestion.chapter,
        timestamp: serverTimestamp()
      });

      // 2. Update SRS
      const srsRef = doc(db, 'users', user.uid, 'spacedRepetition', currentQuestion.id);
      const srsSnap = await getDoc(srsRef);
      const srsData = srsSnap.exists() ? srsSnap.data() : null;
      
      const nextReview = calculateNextReview(quality, srsData ? {
        repetition: srsData.repetition || 0,
        interval: srsData.interval || 0,
        easeFactor: srsData.easeFactor || 2.5,
        nextReviewDate: srsData.nextReviewDate?.toDate() || new Date()
      } : undefined);
      await setDoc(srsRef, nextReview);

      // 3. Update Streak & Stats
      const streakRef = doc(db, 'users', user.uid, 'streak', 'current');
      const today = new Date().toISOString().split('T')[0];
      const streakSnap = await getDoc(streakRef);
      
      if (streakSnap.exists()) {
        const data = streakSnap.data();
        if (data.lastPracticeDate !== today) {
          const isConsecutive = data.lastPracticeDate === new Date(Date.now() - 86400000).toISOString().split('T')[0];
          const newStreak = isConsecutive ? data.currentStreak + 1 : 1;
          await updateDoc(streakRef, {
            currentStreak: newStreak,
            longestStreak: Math.max(newStreak, data.longestStreak),
            lastPracticeDate: today
          });
          if (newStreak % 7 === 0) toast.success(`🔥 ${newStreak} day streak! Keep it up!`);
        }
      }

      // 4. Progressive Difficulty Logic (Legacy - replaced by Adaptive Hook but keeping for state compatibility if needed)
      if (progressiveDifficulty) {
        // ... existing logic ...
      }

      // 4b. Update Adaptive Ability Model
      await updateAbility(currentQuestion.chapter, isCorrect);

      // 4c. Award XP
      if (isCorrect) {
        let xp = 0;
        if (currentQuestion.difficulty === 'Easy') xp = 10;
        else if (currentQuestion.difficulty === 'Medium') xp = 20;
        else if (currentQuestion.difficulty === 'Hard') xp = 35;

        if (hintsUsed === 0) xp += 5;
        if (timeTaken < 25) xp += 5;

        setEarnedXP(xp);
        setShowXP(true);
        setTimeout(() => setShowXP(false), 1200);
        addXP(xp);

        // Check for badges
        if (hintsUsed === 0 && sessionStats.correct >= 20) {
          awardBadge("No Hints Needed");
        }
      }

      // 5. Update Session Stats
      const newChaptersCovered = new Set(sessionStats.chaptersCovered);
      newChaptersCovered.add(currentQuestion.chapter);

      const newStats = {
        correct: sessionStats.correct + (isCorrect ? 1 : 0),
        total: sessionStats.total + 1,
        avgTime: Math.round((sessionStats.avgTime * sessionStats.total + timeTaken) / (sessionStats.total + 1)),
        fastestTime: Math.min(sessionStats.fastestTime, timeTaken),
        chapterAccuracy: { ...sessionStats.chapterAccuracy },
        chaptersCovered: newChaptersCovered
      };
      
      if (!newStats.chapterAccuracy[currentQuestion.chapter]) {
        newStats.chapterAccuracy[currentQuestion.chapter] = { correct: 0, total: 0 };
      }
      newStats.chapterAccuracy[currentQuestion.chapter].total++;
      if (isCorrect) newStats.chapterAccuracy[currentQuestion.chapter].correct++;

      // 5. Save Progress
      const nextIndex = currentIndex + 1;
      const isLast = nextIndex >= questions.length;
      
      if (!isLast) {
        saveSessionProgress(nextIndex, newStats, questions.map(q => q.id));
      } else {
        clearSavedSession();
      }

      setSessionStats(newStats);
      saveSessionProgress(currentIndex, newStats, questions.map(q => q.id));
    } catch (error) {
      console.error('Error saving attempt:', error);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      saveSessionProgress(nextIndex, sessionStats, questions.map(q => q.id));
    } else {
      setIsSessionComplete(true);
      clearSavedSession();
    }
  };

  const handlePrevious = () => {
    const prevIndex = Math.max(0, currentIndex - 1);
    setCurrentIndex(prevIndex);
    saveSessionProgress(prevIndex, sessionStats, questions.map(q => q.id));
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-12 h-12 animate-spin text-[#F27D26]" />
      </div>
    );
  }

  if (isSessionComplete) {
    const weakAreas = Object.entries(sessionStats.chapterAccuracy)
      .map(([name, stats]) => ({ name, accuracy: (stats.correct / stats.total) * 100 }))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 3);

    return (
      <div className="p-12 min-h-full bg-[#E4E3E0] flex items-center justify-center">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-2xl w-full bg-white border border-[#141414] p-12 shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] text-center"
        >
          <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <Trophy className="w-10 h-10 text-white" />
          </div>
          <h2 className="font-serif italic text-5xl mb-4">Session Complete!</h2>
          <p className="text-[#8E9299] mb-12 uppercase tracking-widest font-bold text-xs">You've mastered {sessionStats.correct} out of {sessionStats.total} problems.</p>

          <div className="grid grid-cols-4 gap-6 mb-12">
            <div className="p-6 border border-[#E4E3E0]">
              <p className="text-[10px] font-bold uppercase opacity-40 mb-2">Accuracy</p>
              <p className="text-3xl font-serif italic text-[#F27D26]">{Math.round((sessionStats.correct / sessionStats.total) * 100)}%</p>
            </div>
            <div className="p-6 border border-[#E4E3E0]">
              <p className="text-[10px] font-bold uppercase opacity-40 mb-2">Chapters</p>
              <p className="text-3xl font-serif italic text-blue-600">{sessionStats.chaptersCovered.size}</p>
            </div>
            <div className="p-6 border border-[#E4E3E0]">
              <p className="text-[10px] font-bold uppercase opacity-40 mb-2">Avg Time</p>
              <p className="text-3xl font-serif italic">{sessionStats.avgTime}s</p>
            </div>
            <div className="p-6 border border-[#E4E3E0]">
              <p className="text-[10px] font-bold uppercase opacity-40 mb-2">Fastest</p>
              <p className="text-3xl font-serif italic text-green-600">{sessionStats.fastestTime}s</p>
            </div>
          </div>

          {weakAreas.length > 0 && (
            <div className="mb-12 text-left">
              <h3 className="text-xs font-bold uppercase tracking-widest mb-4 opacity-40">Top Weak Areas</h3>
              <div className="space-y-3">
                {weakAreas.map((area, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-[#F9F9F8] border border-[#E4E3E0]">
                    <span className="font-bold text-sm">{area.name}</span>
                    <span className="text-red-500 font-serif italic">{Math.round(area.accuracy)}% Accuracy</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-4">
            <button 
              onClick={() => {
                setSessionStats({ correct: 0, total: 0, avgTime: 0, fastestTime: Infinity, chapterAccuracy: {}, chaptersCovered: new Set() });
                fetchQuestions();
              }}
              className="flex-1 bg-[#141414] text-white py-4 font-bold uppercase tracking-widest hover:bg-[#F27D26] hover:text-black transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Practice Again
            </button>
            <button 
              onClick={() => navigate('/')}
              className="flex-1 border border-[#141414] py-4 font-bold uppercase tracking-widest hover:bg-[#E4E3E0] transition-all flex items-center justify-center gap-2"
            >
              Dashboard <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="p-12 min-h-full bg-[#E4E3E0]">
      {/* Resume Session Prompt */}
      <AnimatePresence>
        {hasSavedSession && (
          <motion.div 
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className="max-w-5xl mx-auto mb-8"
          >
            <div className="bg-[#F27D26] border border-[#141414] p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <History className="w-5 h-5" />
                <span className="text-xs font-bold uppercase tracking-widest">You have an unfinished practice session. Would you like to resume?</span>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setHasSavedSession(false)}
                  className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-[#141414] hover:bg-white/20 transition-all"
                >
                  Dismiss
                </button>
                <button 
                  onClick={resumeSavedSession}
                  className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-[#141414] text-white hover:bg-white hover:text-black transition-all"
                >
                  Resume Session
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter Bar */}
      <GamificationToast xp={earnedXP} show={showXP} />
      <div className="max-w-5xl mx-auto mb-12">
        <div className="bg-white border border-[#141414] p-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2 text-[#F27D26]">
            <Filter className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Filters</span>
          </div>

          <div className="h-8 w-px bg-[#E4E3E0]" />

          <div className="flex gap-2">
            {['Smart Mix (Interleaved)', 'Mixed Practice', 'Chapter Drill', 'High Probability Only', 'Bookmarked', 'Marked for Review', 'Due for Review Today'].map(m => (
              <button
                key={m}
                onClick={() => setMode(m as Mode)}
                className={cn(
                  "px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-all",
                  mode === m ? "bg-[#141414] text-white border-[#141414]" : "border-[#E4E3E0] hover:border-[#141414]",
                  m === 'Smart Mix (Interleaved)' && "border-[#F27D26] text-[#F27D26]"
                )}
              >
                {m === 'Smart Mix (Interleaved)' ? 'Smart Mix (अनुशंसित)' : m}
              </button>
            ))}
          </div>

          <div className="h-8 w-px bg-[#E4E3E0]" />

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMarkedOnly(!showMarkedOnly)}
              className={cn(
                "w-5 h-5 border border-[#141414] flex items-center justify-center transition-colors",
                showMarkedOnly ? "bg-[#F27D26]" : "bg-white"
              )}
            >
              {showMarkedOnly && <CheckCircle2 className="w-3 h-3 text-black" />}
            </button>
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">Marked Only</span>
          </div>

          <div className="h-8 w-px bg-[#E4E3E0]" />

          <div className="flex gap-4 flex-1">
            <select 
              value={selectedExam}
              onChange={(e) => setSelectedExam(e.target.value)}
              className="bg-transparent border-b border-[#141414] text-[10px] font-bold uppercase tracking-widest outline-none py-1"
            >
              <option value="All">All Exams</option>
              <option value="SSC CGL">SSC CGL</option>
              <option value="SSC CHSL">SSC CHSL</option>
              <option value="CAT">CAT</option>
              <option value="CUET">CUET</option>
            </select>

            <select 
              value={selectedChapter}
              onChange={(e) => setSelectedChapter(e.target.value)}
              className="bg-transparent border-b border-[#141414] text-[10px] font-bold uppercase tracking-widest outline-none py-1 flex-1"
            >
              <option value="All">All Chapters</option>
              {availableChapters.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <select 
              value={selectedPattern}
              onChange={(e) => setSelectedPattern(e.target.value)}
              className="bg-transparent border-b border-[#141414] text-[10px] font-bold uppercase tracking-widest outline-none py-1 flex-1"
            >
              <option value="All">All Patterns</option>
              {availablePatterns.map(p => <option key={p} value={p}>{p}</option>)}
            </select>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={progressiveDifficulty}
                  onChange={(e) => setProgressiveDifficulty(e.target.checked)}
                  className="w-4 h-4 accent-[#F27D26]"
                />
                <span className="text-[10px] font-bold uppercase tracking-widest">Progressive</span>
              </label>
              
              {!progressiveDifficulty && (
                <select 
                  value={selectedDifficulty}
                  onChange={(e) => setSelectedDifficulty(e.target.value)}
                  className="bg-transparent border-b border-[#141414] text-[10px] font-bold uppercase tracking-widest outline-none py-1"
                >
                  <option value="All">All Difficulty</option>
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Hard">Hard</option>
                </select>
              )}
            </div>
          </div>
        </div>
      </div>

      {questions.length === 0 ? (
        <div className="h-[60vh] flex flex-col items-center justify-center p-12 text-center">
          <AlertCircle className="w-16 h-16 text-[#8E9299] mb-6" />
          <h2 className="text-2xl font-serif italic mb-4">No questions match your filters</h2>
          <p className="text-[#8E9299] max-w-md mb-8">
            Try adjusting your filters or upload more PDFs to expand your question bank.
          </p>
          <button onClick={() => {
            setMode('Mixed Practice');
            setSelectedExam('All');
            setSelectedChapter('All');
            setSelectedPattern('All');
            setSelectedDifficulty('All');
          }} className="bg-[#141414] text-white px-8 py-3 font-bold uppercase tracking-widest">Reset Filters</button>
        </div>
      ) : (
        <>
          <div className="max-w-3xl mx-auto mb-12 flex items-center justify-between relative">
            {/* Adaptive Indicator */}
            <AnimatePresence>
              {questions[currentIndex] && abilityModels[questions[currentIndex].chapter] && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="absolute -top-8 right-0 flex items-center gap-2"
                >
                  <div className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]",
                    abilityModels[questions[currentIndex].chapter].recentAccuracy > 75 ? "bg-orange-100 text-orange-600 border-orange-200" :
                    abilityModels[questions[currentIndex].chapter].recentAccuracy < 35 ? "bg-blue-100 text-blue-600 border-blue-200" :
                    "bg-gray-100 text-gray-600 border-gray-200"
                  )}>
                    Adapting to {abilityModels[questions[currentIndex].chapter].currentLevel} — {questions[currentIndex].chapter}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="font-serif italic text-4xl">{mode}</h2>
                {progressiveDifficulty && (
                  <span className="px-3 py-1 bg-[#F27D26] text-black text-[10px] font-bold uppercase tracking-widest rounded-full">
                    Level: {currentDifficultyLevel}
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-[#8E9299] uppercase tracking-widest">
                Question {currentIndex + 1} of {questions.length}
              </p>
              {mode === 'Smart Mix (Interleaved)' && (
                <div className="mt-4 flex items-center gap-2 overflow-x-auto no-scrollbar pb-2">
                  <span className="text-[10px] font-bold uppercase text-[#8E9299] shrink-0">Chapter Rotation:</span>
                  {questions.slice(Math.max(0, currentIndex - 2), currentIndex + 3).map((q, i) => {
                    const actualIdx = Math.max(0, currentIndex - 2) + i;
                    return (
                      <div key={i} className="flex items-center gap-2 shrink-0">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-1 border",
                          actualIdx === currentIndex ? "bg-[#141414] text-white border-[#141414]" : "bg-white text-[#8E9299] border-[#E4E3E0]"
                        )}>
                          {q.chapter}
                        </span>
                        {i < 4 && actualIdx < questions.length - 1 && <ArrowRight className="w-3 h-3 text-[#8E9299]" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex gap-6">
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#8E9299]">Accuracy</p>
                <p className="text-xl font-serif italic text-[#F27D26]">
                  {sessionStats.total > 0 ? Math.round((sessionStats.correct / sessionStats.total) * 100) : 0}%
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#8E9299]">Avg Time</p>
                <p className="text-xl font-serif italic text-[#141414]">{sessionStats.avgTime}s</p>
              </div>
            </div>
          </div>

          <AnimatePresence mode="wait">
            <QuestionCard 
              key={questions[currentIndex].id}
              question={questions[currentIndex]}
              userId={user.uid}
              onAnswer={handleAnswer}
              onNext={handleNext}
              onPrevious={handlePrevious}
              isFirst={currentIndex === 0}
            />
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
