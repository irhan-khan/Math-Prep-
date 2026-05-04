import { motion, AnimatePresence } from 'motion/react';

export default function GamificationToast({ xp, show }: { xp: number, show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: -40 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2 }}
          className="fixed pointer-events-none z-[100] font-bold text-[#F27D26] text-xl"
          style={{ 
            top: '40%', 
            right: '25%',
            textShadow: '2px 2px 0px #141414'
          }}
        >
          +{xp} XP
        </motion.div>
      )}
    </AnimatePresence>
  );
}
