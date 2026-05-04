import { useState, useEffect } from 'react';
import { collection, query, getDocs, where, orderBy, limit, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { User } from 'firebase/auth';
import { 
  LayoutDashboard, 
  Target, 
  TrendingUp, 
  Zap, 
  BrainCircuit, 
  BookOpen, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  ChevronRight,
  Flame,
  Loader2,
  Bookmark,
  Calendar,
  Settings,
  ArrowRight,
  AlertTriangle,
  Info,
  Globe,
  FileUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, ReferenceLine, PieChart, Pie, Legend } from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { toast } from 'sonner';
import { useLanguage } from '../context/LanguageContext';
import AICoachInsights from './AICoachInsights';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface DashboardProps {
  user: User;
}

interface ChapterStats {
  name: string;
  accuracy: number;
  attempts: number;
}

interface TrendData {
  attempt: number;
  accuracy: number;
}

interface MistakeStat {
  name: string;
  value: number;
  color: string;
}

export default function Dashboard({ user }: DashboardProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [stats, setStats] = useState<ChapterStats[]>([]);
  const [trendData, setTrendData] = useState<TrendData[]>([]);
  const [loading, setLoading] = useState(true);
  const [readinessScore, setReadinessScore] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [avgTime, setAvgTime] = useState(0);
  const [streakData, setStreakData] = useState({ current: 0, longest: 0 });
  const [dueTodayCount, setDueTodayCount] = useState(0);
  const [examProbability, setExamProbability] = useState<{ chapter: string, score: number }[]>([]);
  const [bookmarksCount, setBookmarksCount] = useState(0);
  const [activityData, setActivityData] = useState<Record<string, number>>({});
  const [examSettings, setExamSettings] = useState<{ date: string, type: string } | null>(null);
  const [showExamSettings, setShowExamSettings] = useState(false);
  const [mistakeStats, setMistakeStats] = useState<MistakeStat[]>([]);
  const [biggestWeakness, setBiggestWeakness] = useState<{ type: string, chapter: string, percentage: number } | null>(null);
  const [sharedBankCount, setSharedBankCount] = useState(0);

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true);
      try {
        // Fetch Shared Bank Count
        const bankSnap = await getDocs(collection(db, 'questions'));
        setSharedBankCount(bankSnap.size);

        // 1. Fetch Attempts & Stats
        const attemptsRef = collection(db, 'users', user.uid, 'attempts');
        const querySnapshot = await getDocs(attemptsRef);
        
        const chapterMap: Record<string, { correct: number, total: number }> = {};
        const activity: Record<string, number> = {};
        let totalTime = 0;

        querySnapshot.docs.forEach(doc => {
          const data = doc.data();
          const chapter = data.chapter || 'General';
          if (!chapterMap[chapter]) {
            chapterMap[chapter] = { correct: 0, total: 0 };
          }
          chapterMap[chapter].total++;
          if (data.isCorrect) {
            chapterMap[chapter].correct++;
          }
          totalTime += data.timeTaken || 0;

          // Activity tracking
          if (data.timestamp) {
            const date = data.timestamp.toDate().toISOString().split('T')[0];
            activity[date] = (activity[date] || 0) + 1;
          }
        });

        setActivityData(activity);
        const formattedStats = Object.entries(chapterMap).map(([name, data]) => ({
          name,
          accuracy: Math.round((data.correct / data.total) * 100),
          attempts: data.total
        })).sort((a, b) => a.accuracy - b.accuracy);

        setStats(formattedStats);
        setTotalAttempts(querySnapshot.size);
        setAvgTime(querySnapshot.size > 0 ? Math.round(totalTime / querySnapshot.size) : 0);

        // 1.1 Calculate Trend Data (Last 20 attempts)
        const last20Attempts = querySnapshot.docs
          .map(doc => ({ 
            isCorrect: doc.data().isCorrect as boolean, 
            timestamp: doc.data().timestamp?.toDate() || new Date() 
          }))
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
          .slice(-20);

        const rollingTrend: TrendData[] = [];
        for (let i = 0; i < last20Attempts.length; i++) {
          const window = last20Attempts.slice(Math.max(0, i - 4), i + 1);
          const correctInWindow = window.filter(a => a.isCorrect).length;
          rollingTrend.push({
            attempt: i + 1,
            accuracy: Math.round((correctInWindow / window.length) * 100)
          });
        }
        setTrendData(rollingTrend);
        
        // 2. Calculate readiness score
        const avgAccuracy = formattedStats.length > 0 
          ? formattedStats.reduce((acc, curr) => acc + curr.accuracy, 0) / formattedStats.length 
          : 0;
        setReadinessScore(Math.round(avgAccuracy * 0.7 + (Math.min(querySnapshot.size, 500) / 500) * 30));

        // 3. Fetch Streak
        const streakSnap = await getDoc(doc(db, 'users', user.uid, 'streak', 'current'));
        if (streakSnap.exists()) {
          setStreakData({
            current: streakSnap.data().currentStreak || 0,
            longest: streakSnap.data().longestStreak || 0
          });
        }

        // 4. Fetch SRS Due Today
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        try {
          const srsSnap = await getDocs(query(
            collection(db, 'users', user.uid, 'spacedRepetition'),
            where('nextReviewDate', '<=', today)
          ));
          setDueTodayCount(srsSnap.size);
        } catch (e) {
          console.warn("SRS index missing, skipping count");
        }

        // 5. Fetch Bookmarks
        const bookmarksSnap = await getDocs(collection(db, 'users', user.uid, 'bookmarks'));
        setBookmarksCount(bookmarksSnap.size);

        // 6. Fetch Exam Settings
        const examSnap = await getDoc(doc(db, 'users', user.uid, 'settings', 'exam'));
        if (examSnap.exists()) {
          setExamSettings(examSnap.data() as { date: string, type: string });
        }

        // 7. Calculate Exam Probability from questions collection
        const questionsSnap = await getDocs(query(collection(db, 'questions'), limit(100)));
        const probMap: Record<string, { total: number, count: number }> = {};
        questionsSnap.docs.forEach(doc => {
          const data = doc.data();
          if (!probMap[data.chapter]) probMap[data.chapter] = { total: 0, count: 0 };
          probMap[data.chapter].total += data.probabilityScore || 0;
          probMap[data.chapter].count++;
        });

        const probStats = Object.entries(probMap)
          .map(([chapter, data]) => ({
            chapter,
            score: Math.round(data.total / data.count)
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        
        setExamProbability(probStats);

        // 8. Fetch Mistake Analysis
        const mistakesSnap = await getDoc(doc(db, 'users', user.uid, 'stats', 'mistakes'));
        if (mistakesSnap.exists()) {
          const data = mistakesSnap.data();
          const colors: Record<string, string> = {
            "Calculation mistake": "#ef4444",
            "Concept gap": "#F27D26",
            "Misread question": "#f59e0b",
            "Wrong formula applied": "#3b82f6",
            "Time pressure skip": "#141414"
          };

          const formattedMistakes = Object.entries(data)
            .filter(([key]) => key !== 'chapterBreakdown')
            .map(([name, value]) => ({
              name,
              value: value as number,
              color: colors[name] || "#8E9299"
            }))
            .sort((a, b) => b.value - a.value);
          
          setMistakeStats(formattedMistakes);

          // Calculate biggest weakness
          if (data.chapterBreakdown) {
            let maxVal = 0;
            let weakness = null;
            
            Object.entries(data.chapterBreakdown).forEach(([chapter, types]: [string, any]) => {
              Object.entries(types).forEach(([type, count]: [string, any]) => {
                if (count > maxVal) {
                  maxVal = count;
                  const totalWrongInChapter = Object.values(types).reduce((a: any, b: any) => a + b, 0) as number;
                  weakness = {
                    type,
                    chapter,
                    percentage: Math.round((count / totalWrongInChapter) * 100)
                  };
                }
              });
            });
            setBiggestWeakness(weakness);
          }
        }

      } catch (error) {
        console.error('Error fetching dashboard data:', error);
        toast.error('Failed to load dashboard data.');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [user.uid]);

  const saveExamSettings = async (date: string, type: string) => {
    try {
      await setDoc(doc(db, 'users', user.uid, 'settings', 'exam'), { date, type });
      setExamSettings({ date, type });
      setShowExamSettings(false);
      toast.success('Exam settings updated!');
    } catch (error) {
      toast.error('Failed to save settings.');
    }
  };

  const getDaysRemaining = () => {
    if (!examSettings?.date) return null;
    const diff = new Date(examSettings.date).getTime() - new Date().getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const getDailyTarget = () => {
    const days = getDaysRemaining();
    if (!days || days <= 0) return 50;
    // Simple heuristic: 1000 questions total target / days remaining
    return Math.max(20, Math.ceil(1000 / days));
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 80) return '#10b981'; // Green
    if (accuracy >= 60) return '#f59e0b'; // Amber
    return '#ef4444'; // Red
  };

  const getProbColor = (score: number) => {
    if (score >= 70) return 'text-red-500';
    if (score >= 40) return 'text-amber-500';
    return 'text-green-500';
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-12 h-12 animate-spin text-[#F27D26]" />
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-12 max-w-7xl mx-auto"
    >
      <header className="mb-12 flex items-end justify-between">
        <div>
          <h2 className="font-serif italic text-5xl mb-2">Student Intelligence</h2>
          <p className="text-[#8E9299]">Performance analytics and exam-day readiness metrics.</p>
        </div>
        <div className="text-right flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 px-3 py-1 bg-green-50 border border-green-200 rounded-full">
            <Globe className="w-3 h-3 text-green-600" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-green-700">
              Shared Bank: {sharedBankCount} Questions
            </span>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 block mb-1">Last Sync</span>
            <span className="font-mono text-xs">{new Date().toLocaleDateString('en-GB')} • {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} UTC</span>
          </div>
        </div>
      </header>

      {/* Top Stats Grid */}
      <div className="grid grid-cols-4 gap-8 mb-12">
        <div className="bg-white border border-[#141414] p-8 shadow-[6px_6px_0px_0px_rgba(20,20,20,1)]">
          <div className="flex items-center justify-between mb-4">
            <Target className="w-6 h-6 text-[#F27D26]" />
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Readiness</span>
          </div>
          <p className="text-4xl font-serif italic mb-1">{readinessScore}%</p>
          <p className="text-[10px] uppercase font-bold text-green-600">Calculated from accuracy & volume</p>
        </div>

        <div className="bg-white border border-[#141414] p-8 shadow-[6px_6px_0px_0px_rgba(20,20,20,1)]">
          <div className="flex items-center justify-between mb-4">
            <Flame className="w-6 h-6 text-[#F27D26]" />
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Streak</span>
          </div>
          <p className="text-4xl font-serif italic mb-1">{streakData.current} Days</p>
          <p className="text-[10px] uppercase font-bold text-[#8E9299]">Longest: {streakData.longest} days</p>
        </div>

        <div className="bg-white border border-[#141414] p-8 shadow-[6px_6px_0px_0px_rgba(20,20,20,1)]">
          <div className="flex items-center justify-between mb-4">
            <Zap className="w-6 h-6 text-[#F27D26]" />
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Review Due</span>
          </div>
          <p className="text-4xl font-serif italic mb-1">{dueTodayCount}</p>
          <p className="text-[10px] uppercase font-bold text-[#F27D26]">Questions due today</p>
        </div>

        <div className="bg-[#141414] text-white p-8 shadow-[6px_6px_0px_0px_rgba(242,125,38,1)] relative overflow-hidden group">
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <Calendar className="w-6 h-6 text-[#F27D26]" />
              <button 
                onClick={() => setShowExamSettings(true)}
                className="p-1 hover:bg-white/10 rounded transition-colors"
              >
                <Settings className="w-4 h-4 opacity-40" />
              </button>
            </div>
            {examSettings ? (
              <>
                <p className="text-4xl font-serif italic mb-1">{getDaysRemaining()} Days</p>
                <p className="text-[10px] uppercase font-bold text-[#8E9299]">Until {examSettings.type} Exam</p>
              </>
            ) : (
              <button 
                onClick={() => setShowExamSettings(true)}
                className="text-left"
              >
                <p className="text-xl font-serif italic mb-1">Set Exam Date</p>
                <p className="text-[10px] uppercase font-bold text-[#F27D26]">Track your progress</p>
              </button>
            )}
          </div>
          <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Calendar className="w-32 h-32" />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showExamSettings && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] p-10 max-w-md w-full shadow-[12px_12px_0px_0px_rgba(20,20,20,1)]"
            >
              <h3 className="font-serif italic text-3xl mb-8">Exam Settings</h3>
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest opacity-40 block mb-2">Target Exam</label>
                  <select 
                    id="exam-type-select"
                    className="w-full p-4 border border-[#E4E3E0] font-bold text-sm focus:border-[#141414] outline-none"
                    defaultValue={examSettings?.type || 'SSC CGL'}
                  >
                    {['SSC CGL', 'SSC CHSL', 'CUET', 'CAT', 'NDA', 'CLAT', 'PSC'].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest opacity-40 block mb-2">Exam Date</label>
                  <input 
                    id="exam-date-input"
                    type="date" 
                    className="w-full p-4 border border-[#E4E3E0] font-bold text-sm focus:border-[#141414] outline-none"
                    defaultValue={examSettings?.date}
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={() => setShowExamSettings(false)}
                    className="flex-1 py-4 text-[10px] font-bold uppercase tracking-widest border border-[#141414] hover:bg-[#F9F9F8]"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      const date = (document.getElementById('exam-date-input') as HTMLInputElement).value;
                      const type = (document.getElementById('exam-type-select') as HTMLSelectElement).value;
                      if (!date) return toast.error('Please select a date');
                      saveExamSettings(date, type);
                    }}
                    className="flex-1 py-4 text-[10px] font-bold uppercase tracking-widest bg-[#141414] text-white hover:bg-[#F27D26] hover:text-black transition-all"
                  >
                    Save Target
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-3 gap-12">
        {/* AI Coach Insights */}
        <div className="col-span-3 mb-12">
          <AICoachInsights user={user} />
        </div>

        {/* Mistake Analysis Section */}
        <div className="col-span-3 grid grid-cols-3 gap-12 mb-12">
          <div className="col-span-2 bg-white border border-[#141414] p-10 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="font-serif italic text-2xl">Mistake Breakdown</h3>
                <p className="text-[10px] uppercase font-bold opacity-40 mt-1">Why are you getting questions wrong?</p>
              </div>
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            
            <div className="flex items-center gap-8">
              <div className="h-[250px] w-[250px] shrink-0">
                {mistakeStats.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={mistakeStats}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {mistakeStats.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#141414', 
                          border: 'none', 
                          color: 'white',
                          fontSize: '10px',
                          fontWeight: 'bold',
                          textTransform: 'uppercase'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center border-2 border-dashed border-[#E4E3E0] rounded-full opacity-20">
                    <p className="text-[8px] font-bold uppercase">No Data</p>
                  </div>
                )}
              </div>
              
              <div className="flex-1 grid grid-cols-1 gap-3">
                {mistakeStats.map((stat, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 border border-[#E4E3E0] hover:border-[#141414] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stat.color }} />
                      <span className="text-[10px] font-bold uppercase tracking-tight">{stat.name}</span>
                    </div>
                    <span className="font-mono text-xs font-bold">{stat.value}</span>
                  </div>
                ))}
                {mistakeStats.length === 0 && (
                  <p className="text-xs opacity-40 italic">Start practicing to see mistake analysis.</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-[#F27D26] border border-[#141414] p-10 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 bg-white border border-[#141414] flex items-center justify-center mb-6">
                <BrainCircuit className="w-6 h-6 text-[#141414]" />
              </div>
              <h3 className="font-serif italic text-3xl mb-4">Mistake Insight</h3>
              {biggestWeakness ? (
                <div className="space-y-4">
                  <p className="text-sm font-bold leading-relaxed">
                    Your biggest weakness: <span className="underline">{biggestWeakness.type}</span> in <span className="underline">{biggestWeakness.chapter}</span>.
                  </p>
                  <div className="p-4 bg-white/20 border border-black/10">
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1">Impact Score</p>
                    <p className="text-2xl font-serif italic">{biggestWeakness.percentage}% of wrong answers</p>
                  </div>
                  <p className="text-[10px] uppercase font-bold opacity-60 leading-relaxed">
                    Recommendation: Review the {biggestWeakness.chapter} concept notes and practice similar questions.
                  </p>
                </div>
              ) : (
                <p className="text-sm font-bold opacity-60 italic">
                  Not enough data to generate insights. Keep practicing!
                </p>
              )}
            </div>
            <button 
              onClick={() => navigate('/practice')}
              className="mt-8 w-full py-4 bg-[#141414] text-white text-[10px] font-bold uppercase tracking-widest hover:bg-white hover:text-black transition-all flex items-center justify-center gap-2"
            >
              Fix Weaknesses <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Weak Zone Heatmap */}
        <div className="col-span-2 space-y-12">
          <div className="bg-white border border-[#141414] p-10 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex items-center justify-between mb-10">
              <h3 className="font-serif italic text-2xl">Weak Zone Heatmap</h3>
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full" />
                  <span className="text-[10px] uppercase font-bold tracking-widest opacity-40">Critical</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-amber-500 rounded-full" />
                  <span className="text-[10px] uppercase font-bold tracking-widest opacity-40">Warning</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full" />
                  <span className="text-[10px] uppercase font-bold tracking-widest opacity-40">Mastered</span>
                </div>
              </div>
            </div>

            <div className="h-[400px] w-full">
              {stats.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats} layout="vertical" margin={{ left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E4E3E0" />
                    <XAxis type="number" domain={[0, 100]} hide />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      axisLine={false} 
                      tickLine={false}
                      tick={{ fontSize: 11, fontWeight: 'bold', fill: '#141414' }}
                      width={120}
                    />
                    <Tooltip 
                      cursor={{ fill: '#F9F9F8' }}
                      contentStyle={{ 
                        backgroundColor: '#141414', 
                        border: 'none', 
                        color: 'white',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        textTransform: 'uppercase'
                      }}
                    />
                    <Bar dataKey="accuracy" radius={[0, 4, 4, 0]} barSize={24}>
                      {stats.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getAccuracyColor(entry.accuracy)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
                  <AlertCircle className="w-12 h-12 mb-4" />
                  <p className="text-xs uppercase font-bold tracking-widest">No data available yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Accuracy Trend Chart */}
          <div className="bg-white border border-[#141414] p-10 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
            <div className="mb-10">
              <h3 className="font-serif italic text-2xl">{t('accuracyTrend')}</h3>
              <p className="text-[10px] uppercase font-bold opacity-40 mt-1">{t('rollingAccuracy')}</p>
            </div>

            <div className="h-[300px] w-full">
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E3E0" />
                    <XAxis 
                      dataKey="attempt" 
                      axisLine={false} 
                      tickLine={false}
                      tick={{ fontSize: 10, fontWeight: 'bold', fill: '#8E9299' }}
                    />
                    <YAxis 
                      domain={[0, 100]} 
                      axisLine={false} 
                      tickLine={false}
                      tick={{ fontSize: 10, fontWeight: 'bold', fill: '#8E9299' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#141414', 
                        border: 'none', 
                        color: 'white',
                        fontSize: '10px',
                        fontWeight: 'bold'
                      }}
                    />
                    <ReferenceLine y={70} stroke="#F27D26" strokeDasharray="3 3" label={{ value: 'Target 70%', position: 'right', fill: '#F27D26', fontSize: 10, fontWeight: 'bold' }} />
                    <Line 
                      type="monotone" 
                      dataKey="accuracy" 
                      stroke="#141414" 
                      strokeWidth={3} 
                      dot={{ r: 4, fill: '#141414', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 6, fill: '#F27D26' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
                  <AlertCircle className="w-12 h-12 mb-4" />
                  <p className="text-xs uppercase font-bold tracking-widest">No trend data available yet</p>
                </div>
              )}
            </div>
          </div>

          {/* 30-Day Activity Heatmap */}
          <div className="bg-white border border-[#141414] p-10 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="font-serif italic text-2xl">Activity Heatmap</h3>
                <p className="text-[10px] uppercase font-bold opacity-40 mt-1">Last 30 Days of Practice</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-bold uppercase opacity-40">Less</span>
                <div className="flex gap-1">
                  {[0, 1, 2, 3, 4].map(v => (
                    <div 
                      key={v} 
                      className="w-3 h-3" 
                      style={{ 
                        backgroundColor: v === 0 ? '#F9F9F8' : 
                                        v === 1 ? '#FDE6D7' :
                                        v === 2 ? '#F9B284' :
                                        v === 3 ? '#F27D26' : '#C15C12'
                      }} 
                    />
                  ))}
                </div>
                <span className="text-[10px] font-bold uppercase opacity-40">More</span>
              </div>
            </div>

            <div className="grid grid-cols-10 gap-2">
              {Array.from({ length: 30 }).map((_, i) => {
                const date = new Date();
                date.setDate(date.getDate() - (29 - i));
                const dateStr = date.toISOString().split('T')[0];
                const count = activityData[dateStr] || 0;
                
                return (
                  <div 
                    key={i}
                    className="aspect-square border border-[#E4E3E0] relative group"
                    style={{ 
                      backgroundColor: count === 0 ? '#F9F9F8' : 
                                      count < 5 ? '#FDE6D7' :
                                      count < 15 ? '#F9B284' :
                                      count < 30 ? '#F27D26' : '#C15C12'
                    }}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-[#141414] text-white text-[8px] font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      {date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: {count} Questions
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Strategic Recommendations */}
        <div className="space-y-8">
          <div className="bg-[#141414] text-white p-10 shadow-[8px_8px_0px_0px_rgba(242,125,38,1)]">
            <h3 className="font-serif italic text-2xl mb-6">Strategic Focus</h3>
            <div className="space-y-6">
              {stats.filter(s => s.accuracy < 60).slice(0, 3).map((chapter, idx) => (
                <div key={idx} className="flex items-start gap-4 group cursor-pointer">
                  <div className="w-8 h-8 bg-[#F27D26] text-black font-bold flex items-center justify-center text-xs shrink-0">
                    0{idx + 1}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold uppercase tracking-tight mb-1 group-hover:text-[#F27D26] transition-colors">
                      {chapter.name}
                    </h4>
                    <p className="text-[10px] opacity-50 leading-relaxed">
                      Accuracy is at {chapter.accuracy}%. Focus on unit digit tricks and ratio methods.
                    </p>
                  </div>
                </div>
              ))}
              {stats.filter(s => s.accuracy < 60).length === 0 && (
                <p className="text-xs opacity-50 italic">No critical weak zones identified. Keep practicing to maintain consistency.</p>
              )}
            </div>
          </div>

          <div className="bg-white border border-[#141414] p-10 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
            <h3 className="font-serif italic text-2xl mb-6">Exam Probability</h3>
            <div className="space-y-4">
              {examProbability.map((item, idx) => (
                <div key={idx} className="p-4 border border-[#E4E3E0] flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase opacity-40">High Priority</p>
                    <p className="text-sm font-bold">{item.chapter}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-lg font-serif italic", getProbColor(item.score))}>{item.score}%</p>
                  </div>
                </div>
              ))}
              {examProbability.length === 0 && (
                <p className="text-xs opacity-50 italic">No probability data yet. Upload questions to see analysis.</p>
              )}
            </div>
          </div>

          {/* Daily Target Card */}
          <div className="bg-white border border-[#141414] p-10 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
            <h3 className="font-serif italic text-2xl mb-6">Daily Target</h3>
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-3xl font-serif italic">{getDailyTarget()}</p>
                <p className="text-[10px] uppercase font-bold opacity-40">Questions / Day</p>
              </div>
              <div className="w-12 h-12 bg-[#F9F9F8] border border-[#141414] flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-[#F27D26]" />
              </div>
            </div>
            <button 
              onClick={() => navigate('/practice')}
              className="w-full flex items-center justify-between p-4 bg-[#141414] text-white text-[10px] font-bold uppercase tracking-widest hover:bg-[#F27D26] hover:text-black transition-all group mb-4"
            >
              Start Practice <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
            <button 
              onClick={() => navigate('/upload')}
              className="w-full flex flex-col items-center justify-center p-4 border-2 border-dashed border-[#E4E3E0] hover:border-[#F27D26] hover:bg-orange-50 transition-all group"
            >
              <FileUp className="w-5 h-5 text-[#8E9299] group-hover:text-[#F27D26] mb-2" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#8E9299] group-hover:text-[#F27D26]">Upload a new paper</p>
              <p className="text-[8px] opacity-40 group-hover:opacity-100">Grow the shared bank & help others!</p>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
