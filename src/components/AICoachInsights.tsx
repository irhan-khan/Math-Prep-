import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { Brain, Sparkles, TrendingUp, AlertCircle, Loader2 } from 'lucide-react';
import { User } from 'firebase/auth';

export default function AICoachInsights({ user }: { user: User }) {
  const [insights, setInsights] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInsights = async () => {
      try {
        // 1. Fetch recent performance data
        const attemptsSnap = await getDocs(
          query(
            collection(db, 'users', user.uid, 'attempts'),
            orderBy('timestamp', 'desc'),
            limit(50)
          )
        );

        if (attemptsSnap.empty) {
          setInsights(["Start practicing to get personalized AI insights!"]);
          setLoading(false);
          return;
        }

        const performanceData = attemptsSnap.docs.map(d => d.data());

        // 2. Call Gemini for analysis
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        
        const prompt = `Analyze this student's recent math practice data and provide 3 short, actionable coaching insights.
        Data: ${JSON.stringify(performanceData)}
        
        Focus on:
        - Accuracy vs Speed trade-offs
        - Chapter-specific weaknesses
        - Consistency patterns
        - Use of hints
        
        Format: Return exactly 3 bullet points. Keep them encouraging but direct. Use a mix of English and Hindi (Hinglish) as it's for Indian students.
        Example: "Geometry mein aapki speed acchi hai, par calculation mistakes ho rahi hain. Try to double-check your steps."`;

        const result = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: prompt
        });
        const text = result.text;
        const lines = text.split('\n').filter(l => l.trim().length > 0).slice(0, 3);
        setInsights(lines.map(l => l.replace(/^[*-]\s*/, '')));
      } catch (error) {
        console.error('Error fetching AI insights:', error);
        setInsights(["AI Coach is resting. Check back later!"]);
      } finally {
        setLoading(false);
      }
    };

    fetchInsights();
  }, [user.uid]);

  return (
    <div className="bg-white border border-[#141414] p-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
      <div className="flex items-center gap-2 mb-6">
        <div className="p-2 bg-purple-100 rounded">
          <Brain className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <h3 className="font-serif italic text-xl">AI Coach Insights</h3>
          <p className="text-[8px] font-bold uppercase tracking-widest opacity-40">Personalized feedback based on your last 50 attempts</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-4">
          <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
          <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">Analyzing your patterns...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {insights.map((insight, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="flex gap-3 p-3 bg-purple-50/50 border border-purple-100 rounded group hover:border-purple-300 transition-all"
            >
              <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              <p className="text-xs text-purple-900 leading-relaxed">{insight}</p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
