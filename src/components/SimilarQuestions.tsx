import React, { useEffect, useState } from 'react';
import { generateSimilarQuestions, ClassifiedQuestion } from '../services/geminiService';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Zap, Target, TrendingUp, Plus, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';

interface SimilarQuestionsProps {
  originalQuestion: ClassifiedQuestion;
  userId: string;
}

const SimilarQuestions = React.memo(({ originalQuestion, userId }: SimilarQuestionsProps) => {
  const [similarQuestions, setSimilarQuestions] = useState<ClassifiedQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const fetchSimilar = async () => {
      setLoading(true);
      setError(false);
      try {
        // Add a small delay to stagger requests and avoid hitting rate limits
        // especially when multiple QuestionCards might be rendered or navigated quickly
        await new Promise(resolve => setTimeout(resolve, 800));
        
        const result = await generateSimilarQuestions(originalQuestion);
        if (result && result.length > 0) {
          setSimilarQuestions(result);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error('Error in SimilarQuestions:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchSimilar();
  }, [originalQuestion, retryCount]);

  const handleAddToPractice = async (q: ClassifiedQuestion) => {
    try {
      await addDoc(collection(db, 'questions'), {
        ...q,
        sourcePdf: 'AI Generated (Similar)',
        createdAt: serverTimestamp(),
        createdBy: userId
      });
      toast.success('Added to your practice bank!');
    } catch (err) {
      console.error('Error adding question:', err);
      toast.error('Failed to add question.');
    }
  };

  const getProbabilityColor = (score: number) => {
    if (score >= 70) return 'text-red-500 bg-red-50 border-red-200';
    if (score >= 40) return 'text-amber-500 bg-amber-50 border-amber-200';
    return 'text-green-500 bg-green-50 border-green-200';
  };

  if (loading) {
    return (
      <div className="mt-12 space-y-6">
        <h3 className="font-serif italic text-xl">5 Questions Most Likely to Appear in Exam</h3>
        <div className="grid grid-cols-1 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 animate-pulse border border-[#E4E3E0]" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-12 p-8 border-2 border-dashed border-[#E4E3E0] text-center space-y-4">
        <AlertCircle className="w-8 h-8 text-[#8E9299] mx-auto opacity-40" />
        <div>
          <p className="text-[10px] text-[#8E9299] uppercase font-bold tracking-widest">AI Quota Exceeded or Error</p>
          <p className="text-xs text-[#8E9299] mt-1">Failed to generate similar questions due to high traffic.</p>
        </div>
        <button 
          onClick={() => {
            setRetryCount(prev => prev + 1);
          }}
          className="px-6 py-2 bg-[#141414] text-white text-[10px] uppercase font-bold tracking-widest hover:bg-[#F27D26] hover:text-black transition-all"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-12 space-y-6">
      <h3 className="font-serif italic text-xl">5 Questions Most Likely to Appear in Exam</h3>
      <div className="grid grid-cols-1 gap-4">
        {similarQuestions.map((q, idx) => (
          <motion.div 
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="p-4 bg-white border border-[#141414] flex items-center justify-between gap-4 group hover:shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] transition-all"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-sans line-clamp-2 mb-2">{q.text}</p>
              <div className="flex items-center gap-3">
                <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 bg-[#141414] text-white">
                  {q.chapter}
                </span>
                <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 border border-[#141414]">
                  {q.difficulty}
                </span>
                <div className={`flex items-center gap-1 px-2 py-0.5 border rounded-full text-[8px] font-bold uppercase tracking-widest ${getProbabilityColor(q.probabilityScore)}`}>
                  <TrendingUp className="w-2 h-2" />
                  <span>{q.probabilityScore}%</span>
                </div>
              </div>
            </div>
            <button 
              onClick={() => handleAddToPractice(q)}
              className="p-3 bg-[#E4E3E0] hover:bg-[#F27D26] transition-colors"
              title="Add to Practice"
            >
              <Plus className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
});

export default SimilarQuestions;
