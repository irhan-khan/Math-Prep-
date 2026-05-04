import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, collection, query, where, orderBy, limit, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { toast } from 'sonner';

export interface AbilityModel {
  chapter: string;
  currentLevel: 'Easy' | 'Medium' | 'Hard';
  recentAccuracy: number;
  consecutiveCorrect: number;
  consecutiveWrong: number;
  lastUpdated: any;
}

export function useAdaptiveDifficulty(userId: string) {
  const [abilityModels, setAbilityModels] = useState<Record<string, AbilityModel>>({});
  const [loading, setLoading] = useState(true);

  const fetchAbilityModels = useCallback(async () => {
    if (!userId) return;
    try {
      const snap = await getDocs(collection(db, 'users', userId, 'abilityModel'));
      const models: Record<string, AbilityModel> = {};
      snap.forEach(doc => {
        models[doc.id] = doc.data() as AbilityModel;
      });
      setAbilityModels(models);
    } catch (error) {
      console.error('Error fetching ability models:', error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchAbilityModels();
  }, [fetchAbilityModels]);

  const updateAbility = async (chapter: string, isCorrect: boolean) => {
    if (!userId) return;

    try {
      // 1. Get recent 10 attempts for this chapter
      const attemptsRef = collection(db, 'users', userId, 'attempts');
      const q = query(
        attemptsRef,
        where('chapter', '==', chapter),
        orderBy('timestamp', 'desc'),
        limit(10)
      );
      const attemptsSnap = await getDocs(q);
      const recentAttempts = attemptsSnap.docs.map(d => d.data().isCorrect);
      
      // Add current attempt if it's not already in the snap (it might be if called after save)
      // But for accuracy calculation, we want the most recent 10 including this one.
      const accuracy = (recentAttempts.filter(Boolean).length / Math.max(recentAttempts.length, 1)) * 100;

      const currentModel = abilityModels[chapter] || {
        chapter,
        currentLevel: 'Easy',
        recentAccuracy: 0,
        consecutiveCorrect: 0,
        consecutiveWrong: 0,
        lastUpdated: new Date()
      };

      let newLevel = currentModel.currentLevel;
      let newConsecutiveCorrect = isCorrect ? currentModel.consecutiveCorrect + 1 : 0;
      let newConsecutiveWrong = !isCorrect ? currentModel.consecutiveWrong + 1 : 0;

      // Logic:
      // If rolling accuracy > 75% AND consecutiveCorrect >= 4 → upgrade
      // If rolling accuracy < 35% AND consecutiveWrong >= 3 → downgrade
      if (accuracy > 75 && newConsecutiveCorrect >= 4) {
        if (newLevel === 'Easy') {
          newLevel = 'Medium';
          toast.info(`Chapter Mastered: Moving to Medium for ${chapter}`, { icon: '🚀' });
        } else if (newLevel === 'Medium') {
          newLevel = 'Hard';
          toast.info(`Chapter Mastered: Moving to Hard for ${chapter}`, { icon: '🔥' });
        }
        newConsecutiveCorrect = 0;
      } else if (accuracy < 35 && newConsecutiveWrong >= 3) {
        if (newLevel === 'Hard') {
          newLevel = 'Medium';
          toast.info(`Adjusting Difficulty: Moving to Medium for ${chapter}`, { icon: '📉' });
        } else if (newLevel === 'Medium') {
          newLevel = 'Easy';
          toast.info(`Adjusting Difficulty: Moving to Easy for ${chapter}`, { icon: '📉' });
        }
        newConsecutiveWrong = 0;
      }

      const updatedModel: AbilityModel = {
        chapter,
        currentLevel: newLevel,
        recentAccuracy: accuracy,
        consecutiveCorrect: newConsecutiveCorrect,
        consecutiveWrong: newConsecutiveWrong,
        lastUpdated: serverTimestamp()
      };

      await setDoc(doc(db, 'users', userId, 'abilityModel', chapter), updatedModel);
      setAbilityModels(prev => ({ ...prev, [chapter]: updatedModel }));
    } catch (error) {
      console.error('Error updating ability model:', error);
    }
  };

  return { abilityModels, updateAbility, loading };
}
