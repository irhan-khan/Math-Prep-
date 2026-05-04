import { useState, useEffect } from 'react';
import { collection, query, getDocs, doc, updateDoc, deleteDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { User } from 'firebase/auth';
import { 
  Search, 
  Star, 
  BookMarked, 
  ChevronRight, 
  Zap, 
  BrainCircuit, 
  Loader2, 
  Trash2, 
  Globe,
  ArrowRight,
  Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Formula {
  id: string;
  formulaKey: string;
  trickMethod: string;
  chapter: string;
  exampleQuestion: string;
  exampleAnswer: string;
  isStarred: boolean;
  language: 'English' | 'Hindi';
  timestamp: any;
}

interface FormulaLibraryProps {
  user: User;
}

export default function FormulaLibrary({ user }: FormulaLibraryProps) {
  const navigate = useNavigate();
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [showStarredOnly, setShowStarredOnly] = useState(false);

  useEffect(() => {
    const formulasRef = collection(db, 'users', user.uid, 'formulas');
    const q = query(formulasRef, orderBy('timestamp', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedFormulas = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Formula[];
      setFormulas(fetchedFormulas);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching formulas:', error);
      toast.error('Failed to load formulas.');
      setLoading(false);
    });

    return unsubscribe;
  }, [user.uid]);

  const toggleStar = async (formula: Formula) => {
    try {
      await updateDoc(doc(db, 'users', user.uid, 'formulas', formula.id), {
        isStarred: !formula.isStarred
      });
    } catch (error) {
      toast.error('Failed to update favorite status.');
    }
  };

  const deleteFormula = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'formulas', id));
      toast.success('Shortcut removed from library.');
    } catch (error) {
      toast.error('Failed to remove shortcut.');
    }
  };

  const chapters = Array.from(new Set(formulas.map(f => f.chapter)));

  const filteredFormulas = formulas.filter(f => {
    const matchesSearch = f.trickMethod.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         f.chapter.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         f.exampleQuestion.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesChapter = !selectedChapter || f.chapter === selectedChapter;
    const matchesStarred = !showStarredOnly || f.isStarred;
    return matchesSearch && matchesChapter && matchesStarred;
  });

  const groupedFormulas = filteredFormulas.reduce((acc, f) => {
    if (!acc[f.chapter]) acc[f.chapter] = [];
    acc[f.chapter].push(f);
    return acc;
  }, {} as Record<string, Formula[]>);

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
          <h2 className="font-serif italic text-5xl mb-2">Formula Book</h2>
          <p className="text-[#8E9299]">Your personal collection of shortcuts and tricks.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E9299]" />
            <input 
              type="text"
              placeholder="Search tricks or chapters..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 pr-6 py-3 bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] focus:translate-x-1 focus:translate-y-1 focus:shadow-none transition-all outline-none font-bold text-sm w-80"
            />
          </div>
          <button 
            onClick={() => setShowStarredOnly(!showStarredOnly)}
            className={cn(
              "p-3 border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] transition-all",
              showStarredOnly ? "bg-[#F27D26] text-black" : "bg-white text-[#8E9299]"
            )}
          >
            <Star className={cn("w-5 h-5", showStarredOnly && "fill-current")} />
          </button>
        </div>
      </header>

      {/* Chapter Filters */}
      <div className="flex flex-wrap gap-3 mb-12">
        <button
          onClick={() => setSelectedChapter(null)}
          className={cn(
            "px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-[#141414] transition-all",
            !selectedChapter ? "bg-[#141414] text-white" : "bg-white text-[#141414] hover:bg-[#F9F9F8]"
          )}
        >
          All Chapters
        </button>
        {chapters.map(chapter => (
          <button
            key={chapter}
            onClick={() => setSelectedChapter(chapter)}
            className={cn(
              "px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-[#141414] transition-all",
              selectedChapter === chapter ? "bg-[#141414] text-white" : "bg-white text-[#141414] hover:bg-[#F9F9F8]"
            )}
          >
            {chapter}
          </button>
        ))}
      </div>

      {Object.keys(groupedFormulas).length > 0 ? (
        <div className="space-y-16">
          {Object.entries(groupedFormulas).map(([chapter, items]) => (
            <section key={chapter}>
              <div className="flex items-center gap-4 mb-8">
                <h3 className="font-serif italic text-3xl">{chapter}</h3>
                <div className="h-[1px] flex-1 bg-[#E4E3E0]" />
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">{items.length} Tricks</span>
              </div>

              <div className="grid grid-cols-2 gap-8">
                {items.map((formula) => (
                  <motion.div 
                    layout
                    key={formula.id}
                    className="bg-white border border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] overflow-hidden flex flex-col"
                  >
                    <div className="p-6 border-b border-[#E4E3E0] flex items-center justify-between bg-[#F9F9F8]">
                      <div className="flex items-center gap-3">
                        <Zap className="w-4 h-4 text-[#F27D26]" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">{formula.formulaKey}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => toggleStar(formula)}
                          className={cn("p-1 transition-colors", formula.isStarred ? "text-[#F27D26]" : "text-[#8E9299] hover:text-[#F27D26]")}
                        >
                          <Star className={cn("w-4 h-4", formula.isStarred && "fill-current")} />
                        </button>
                        <button 
                          onClick={() => deleteFormula(formula.id)}
                          className="p-1 text-[#8E9299] hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="p-8 flex-1">
                      <div className="mb-6">
                        <p className="text-lg font-bold leading-relaxed">{formula.trickMethod}</p>
                      </div>

                      <div className="p-4 bg-[#F9F9F8] border border-[#E4E3E0] rounded space-y-3">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest opacity-40">
                          <BrainCircuit className="w-3 h-3" />
                          <span>Example Context</span>
                        </div>
                        <p className="text-xs italic text-[#8E9299]">"{formula.exampleQuestion}"</p>
                        <p className="text-xs font-bold">Ans: {formula.exampleAnswer}</p>
                      </div>
                    </div>

                    <div className="p-6 border-t border-[#E4E3E0] bg-white">
                      <button 
                        onClick={() => navigate('/practice', { state: { chapter: formula.chapter } })}
                        className="w-full flex items-center justify-between p-4 bg-[#141414] text-white text-[10px] font-bold uppercase tracking-widest hover:bg-[#F27D26] hover:text-black transition-all group"
                      >
                        Practice this type <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="py-24 text-center border-2 border-dashed border-[#E4E3E0]">
          <BookMarked className="w-16 h-16 mx-auto mb-6 text-[#8E9299] opacity-20" />
          <h3 className="text-2xl font-serif italic mb-2">No shortcuts found</h3>
          <p className="text-[#8E9299]">Start practicing to automatically save tricks to your notebook.</p>
        </div>
      )}
    </motion.div>
  );
}
