import { useEffect } from 'react';
import { useStudyPlan, StudyPlanDay } from '../hooks/useStudyPlan';
import { useLanguage } from '../context/LanguageContext';
import { motion } from 'motion/react';
import { Calendar, CheckCircle2, RefreshCw, Target, BookOpen, Zap } from 'lucide-react';
import { cn } from '../lib/utils';
import { User } from 'firebase/auth';

export default function StudyPlan({ user }: { user: User }) {
  const { language } = useLanguage();
  const { plan, loading, generatePlan, toggleDayCompletion } = useStudyPlan(user.uid, language);

  useEffect(() => {
    if (plan.length === 0 && !loading) {
      generatePlan();
    }
  }, [plan.length, loading, generatePlan]);

  if (loading && plan.length === 0) {
    return (
      <div className="p-12 flex flex-col items-center justify-center h-full">
        <RefreshCw className="w-12 h-12 animate-spin text-[#F27D26] mb-4" />
        <p className="text-xs font-bold uppercase tracking-widest opacity-50">Generating your personalized plan...</p>
      </div>
    );
  }

  return (
    <div className="p-12 min-h-full bg-[#E4E3E0]">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="font-serif italic text-5xl mb-2">Your Study Plan</h1>
            <p className="text-xs font-bold uppercase tracking-widest opacity-50">Based on your performance and uploaded papers</p>
          </div>
          <button 
            onClick={generatePlan}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-3 bg-[#141414] text-white text-xs font-bold uppercase tracking-widest hover:bg-[#F27D26] hover:text-black transition-all shadow-[4px_4px_0px_0px_rgba(242,125,38,1)]"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Regenerate Plan
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plan.map((day, idx) => {
            const isToday = idx === (new Date().getDay() + 6) % 7; // Simple mapping for demo
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className={cn(
                  "relative bg-white border border-[#141414] p-6 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] transition-all",
                  day.completed && "opacity-60 grayscale",
                  isToday && "border-[#F27D26] ring-2 ring-[#F27D26] ring-offset-4"
                )}
              >
                {day.completed && (
                  <div className="absolute inset-0 bg-white/40 flex items-center justify-center z-10">
                    <CheckCircle2 className="w-16 h-16 text-green-500" />
                  </div>
                )}

                <div className="flex items-center justify-between mb-6">
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-[#141414] text-white">
                    Day {day.day}: {day.dayLabel}
                  </span>
                  <button 
                    onClick={() => toggleDayCompletion(idx)}
                    className="text-[#8E9299] hover:text-green-500 transition-colors"
                  >
                    <CheckCircle2 className={cn("w-5 h-5", day.completed && "text-green-500")} />
                  </button>
                </div>

                <div className="space-y-4 mb-6">
                  <div>
                    <p className="text-[8px] font-bold uppercase tracking-widest opacity-40 mb-1">Primary Focus</p>
                    <p className="text-xl font-serif italic text-[#141414]">{day.primaryChapter}</p>
                  </div>
                  <div>
                    <p className="text-[8px] font-bold uppercase tracking-widest opacity-40 mb-1">Revision</p>
                    <p className="text-sm font-bold text-[#8E9299]">{day.revisionChapter}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-6">
                  <div className="p-2 bg-[#F9F9F8] border border-[#E4E3E0]">
                    <p className="text-[8px] font-bold uppercase opacity-40">Target</p>
                    <p className="text-xs font-bold">{day.questionTarget} Qs</p>
                  </div>
                  <div className="p-2 bg-[#F9F9F8] border border-[#E4E3E0]">
                    <p className="text-[8px] font-bold uppercase opacity-40">Mode</p>
                    <p className="text-[8px] font-bold text-[#F27D26] truncate">{day.practiceMode}</p>
                  </div>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded mb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="w-3 h-3 text-amber-500" />
                    <p className="text-[8px] font-bold uppercase text-amber-700">Formula to Memorize</p>
                  </div>
                  <p className="text-[10px] italic text-amber-800">{day.formulaToMemorize}</p>
                </div>

                <p className="text-[10px] text-[#8E9299] leading-relaxed italic border-t border-[#E4E3E0] pt-4">
                  "{day.tip}"
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
