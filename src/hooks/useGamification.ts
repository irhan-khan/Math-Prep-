import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, updateDoc, increment, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { toast } from 'sonner';

export interface GamificationData {
  xp: number;
  level: number;
  badges: string[];
  weeklyXP: number;
  weekStartDate: string;
}

const LEVEL_THRESHOLDS = [0, 500, 1500, 4000, 10000, 1000000];
const LEVEL_NAMES = ["Beginner", "Solver", "Tactician", "Expert", "Topper"];

export function useGamification(userId: string) {
  const [data, setData] = useState<GamificationData>({
    xp: 0,
    level: 1,
    badges: [],
    weeklyXP: 0,
    weekStartDate: new Date().toISOString().split('T')[0]
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    const unsub = onSnapshot(doc(db, 'users', userId, 'gamification', 'stats'), (snap) => {
      if (snap.exists()) {
        setData(snap.data() as GamificationData);
      } else {
        // Initialize
        const initial = {
          xp: 0,
          level: 1,
          badges: [],
          weeklyXP: 0,
          weekStartDate: new Date().toISOString().split('T')[0]
        };
        setDoc(doc(db, 'users', userId, 'gamification', 'stats'), initial);
        setData(initial);
      }
      setLoading(false);
    });

    return () => unsub();
  }, [userId]);

  const addXP = async (amount: number, reason?: string) => {
    if (!userId) return;

    const newXP = data.xp + amount;
    let newLevel = data.level;

    // Check for level up
    while (newLevel < 5 && newXP >= LEVEL_THRESHOLDS[newLevel]) {
      newLevel++;
      toast.success(`LEVEL UP! You are now a Level ${newLevel} ${LEVEL_NAMES[newLevel - 1]}!`, {
        description: "Keep crushing those math problems!",
        duration: 5000,
      });
    }

    try {
      await updateDoc(doc(db, 'users', userId, 'gamification', 'stats'), {
        xp: increment(amount),
        weeklyXP: increment(amount),
        level: newLevel
      });
      
      if (reason) {
        // We could log XP events here if needed
      }
    } catch (error) {
      console.error('Error adding XP:', error);
    }
  };

  const awardBadge = async (badgeName: string) => {
    if (!userId || data.badges.includes(badgeName)) return;

    try {
      await updateDoc(doc(db, 'users', userId, 'gamification', 'stats'), {
        badges: [...data.badges, badgeName]
      });
      toast.success(`New Badge Unlocked: ${badgeName}!`, {
        icon: '🏅',
        duration: 5000
      });
    } catch (error) {
      console.error('Error awarding badge:', error);
    }
  };

  const getNextLevelThreshold = () => {
    return LEVEL_THRESHOLDS[data.level] || 10000;
  };

  const getLevelName = () => {
    return LEVEL_NAMES[data.level - 1] || "Beginner";
  };

  return { 
    gamificationData: data, 
    addXP, 
    awardBadge, 
    loading, 
    getNextLevelThreshold, 
    getLevelName 
  };
}
