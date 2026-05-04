import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Toaster, toast } from 'sonner';
import { LayoutDashboard, BookOpen, FileUp, LogOut, Loader2, Zap, Target, Timer, Flame, Globe, BookMarked, Menu, X, Calendar } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Dashboard from './components/Dashboard';
import PDFUploader from './components/PDFUploader';
import PracticeSession from './components/PracticeSession';
import MockTest from './components/MockTest';
import FormulaLibrary from './components/FormulaLibrary';
import StudyPlan from './components/StudyPlan';
import ErrorBoundary from './components/ErrorBoundary';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { useGamification } from './hooks/useGamification';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function Sidebar({ user }: { user: User }) {
  const location = useLocation();
  const { language, setLanguage, t } = useLanguage();
  const { gamificationData, getNextLevelThreshold, getLevelName } = useGamification(user.uid);
  const [streak, setStreak] = useState(0);
  const [examInfo, setExamInfo] = useState<{ type: string, date: string } | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userRef = doc(db, 'users', user.uid);
        const streakRef = doc(db, 'users', user.uid, 'streak', 'current');
        
        const [userSnap, streakSnap] = await Promise.all([
          getDoc(userRef),
          getDoc(streakRef)
        ]);

        if (streakSnap.exists()) {
          setStreak(streakSnap.data().currentStreak || 0);
        }
        if (userSnap.exists()) {
          const data = userSnap.data();
          if (data.examDate) {
            setExamInfo({
              type: data.selectedExam || 'Exam',
              date: data.examDate
            });
          }
        }
      } catch (error) {
        console.error('Error fetching sidebar data:', error);
      }
    };
    fetchData();
  }, [user.uid]);

  const daysRemaining = examInfo ? Math.ceil((new Date(examInfo.date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : null;

  const menuItems = [
    { name: t('dashboard'), icon: LayoutDashboard, path: '/' },
    { name: t('uploadPdf'), icon: FileUp, path: '/upload' },
    { name: 'Study Plan', icon: Calendar, path: '/plan' },
    { name: 'Formula Book', icon: BookMarked, path: '/formulas' },
    { name: t('practice'), icon: BookOpen, path: '/practice' },
    { name: t('mockTest'), icon: Timer, path: '/mock' },
  ];

  if (isMobile) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 bg-[#141414] border-t border-[#2A2A2A] flex justify-around py-2 z-50 md:hidden">
        {menuItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex flex-col items-center gap-1 p-2 transition-all",
              location.pathname === item.path ? "text-[#F27D26]" : "text-[#8E9299]"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[8px] uppercase font-bold tracking-widest">{item.name}</span>
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <aside className="hidden md:flex w-64 bg-[#141414] text-[#E4E3E0] flex-col border-r border-[#2A2A2A]">
      <div className="p-6 flex items-center gap-3 border-bottom border-[#2A2A2A]">
        <div className="w-10 h-10 bg-[#F27D26] rounded flex items-center justify-center text-black font-bold text-xl shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)]">
          M
        </div>
        <div>
          <h1 className="font-serif italic text-xl leading-none">MathPrep</h1>
          <span className="text-[10px] uppercase tracking-widest opacity-50">{t('aiIntelligence')}</span>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded transition-all duration-200 group",
              location.pathname === item.path 
                ? "bg-[#F27D26] text-black font-medium" 
                : "hover:bg-[#2A2A2A] text-[#8E9299]"
            )}
          >
            <item.icon className={cn("w-5 h-5", location.pathname === item.path ? "text-black" : "group-hover:text-[#F27D26]")} />
            <span className="font-sans text-sm">{item.name}</span>
          </Link>
        ))}
      </nav>

      <div className="p-4 space-y-4 border-t border-[#2A2A2A]">
        {/* Gamification Stats */}
        <div className="px-4 py-3 bg-[#2A2A2A]/50 border border-[#2A2A2A] rounded space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#F27D26]">
              Lvl {gamificationData.level} — {getLevelName()}
            </span>
            <span className="text-[10px] font-bold text-[#8E9299]">
              {gamificationData.xp} XP
            </span>
          </div>
          <div className="w-full h-1.5 bg-[#141414] rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${(gamificationData.xp / getNextLevelThreshold()) * 100}%` }}
              className="h-full bg-[#F27D26]" 
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2 bg-[#2A2A2A] rounded">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-[#F27D26]" />
            <span className="text-xs font-bold">{streak} {t('days')}</span>
          </div>
          <button 
            onClick={() => setLanguage(language === 'English' ? 'Hindi' : 'English')}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#8E9299] hover:text-white transition-colors"
          >
            <Globe className="w-3 h-3" />
            {language}
          </button>
        </div>

        {examInfo && daysRemaining !== null && (
          <div className="px-4 py-2 bg-[#F27D26]/10 border border-[#F27D26]/20 rounded">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-[#F27D26]">
              <span>{examInfo.type}</span>
              <span>{daysRemaining} {t('days')}</span>
            </div>
            <div className="w-full h-1 bg-[#2A2A2A] mt-2 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#F27D26]" 
                style={{ width: `${Math.max(0, Math.min(100, (1 - daysRemaining / 365) * 100))}%` }} 
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 px-4 py-3">
          <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-[#2A2A2A]" referrerPolicy="no-referrer" />
          <div className="flex-1 overflow-hidden">
            <p className="text-xs font-medium truncate">{user.displayName}</p>
            <p className="text-[10px] opacity-50 truncate">{user.email}</p>
          </div>
        </div>
        <button
          onClick={() => signOut(auth)}
          className="w-full flex items-center gap-3 px-4 py-2 text-xs text-[#8E9299] hover:text-white transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>{t('signOut')}</span>
        </button>
      </div>
    </aside>
  );
}

function Login() {
  const [loading, setLoading] = useState(false);
  const { t } = useLanguage();

  const handleLogin = async () => {
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          examInterests: [],
          readinessScore: 0,
          lastActive: serverTimestamp(),
        });

        // Initialize streak
        await setDoc(doc(db, 'users', user.uid, 'streak', 'current'), {
          currentStreak: 0,
          longestStreak: 0,
          lastPracticeDate: null
        });
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error('Failed to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-[#141414] p-12 shadow-[12px_12px_0px_0px_rgba(20,20,20,1)]">
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-16 h-16 bg-[#F27D26] rounded flex items-center justify-center text-black font-bold text-3xl mb-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            M
          </div>
          <h1 className="font-serif italic text-4xl mb-2">MathPrep AI</h1>
          <p className="text-sm text-[#8E9299] max-w-[280px]">
            {t('vision')}
          </p>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 border border-[#141414] text-center">
              <Zap className="w-5 h-5 mx-auto mb-2 text-[#F27D26]" />
              <span className="text-[10px] uppercase font-bold tracking-tighter">{t('trickSolutions')}</span>
            </div>
            <div className="p-4 border border-[#141414] text-center">
              <Target className="w-5 h-5 mx-auto mb-2 text-[#F27D26]" />
              <span className="text-[10px] uppercase font-bold tracking-tighter">{t('examProbability')}</span>
            </div>
          </div>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-[#141414] text-white py-4 font-bold uppercase tracking-widest hover:bg-[#F27D26] hover:text-black transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-3"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('signInGoogle')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#F27D26]" />
      </div>
    );
  }

  return (
    <LanguageProvider>
      {!user ? (
        <>
          <Login />
          <Toaster position="top-center" richColors />
        </>
      ) : (
        <BrowserRouter>
          <div className="flex h-screen bg-[#E4E3E0] overflow-hidden">
            <Sidebar user={user} />
            <main className="flex-1 overflow-y-auto relative pb-20 md:pb-0">
              <Routes>
                <Route path="/" element={<Dashboard user={user} />} />
                <Route path="/upload" element={<PDFUploader user={user} />} />
                <Route path="/plan" element={<StudyPlan user={user} />} />
                <Route path="/formulas" element={<FormulaLibrary user={user} />} />
                <Route path="/practice" element={<PracticeSession user={user} />} />
                <Route path="/mock" element={<MockTest user={user} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
            <Toaster position="top-right" richColors />
          </div>
        </BrowserRouter>
      )}
    </LanguageProvider>
  );
}
