import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'English' | 'Hindi';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  English: {
    dashboard: 'Dashboard',
    practice: 'Practice',
    mockTest: 'Mock Test',
    uploadPdf: 'Upload PDF',
    streak: 'Streak',
    accuracy: 'Accuracy',
    avgTime: 'Avg Time',
    totalSolved: 'Total Solved',
    readiness: 'Readiness',
    nextQuestion: 'Next Question',
    viewInHindi: 'हिंदी में देखें',
    viewInEnglish: 'View in English',
    sessionComplete: 'Session Complete',
    practiceAgain: 'Practice Again',
    viewDashboard: 'View Dashboard',
    signOut: 'Sign Out',
    days: 'Days',
    aiIntelligence: 'AI Intelligence',
    vision: 'The strategic practice engine for Indian competitive exams.',
    signInGoogle: 'Sign in with Google',
    trickSolutions: 'Trick Solutions',
    examProbability: 'Exam Probability',
    accuracyTrend: 'Accuracy Trend',
    rollingAccuracy: 'Rolling 5-question accuracy',
    uploadDescription: 'AI-first question detection and classification.',
    dropPdfHere: 'Drop PDF here',
    orClickToBrowse: 'or click to browse',
    studyPlan: 'Study Plan',
    formulaBook: 'Formula Book',
    sharedBank: 'Shared Bank',
    aiCoach: 'AI Coach',
    adaptingTo: 'Adapting to',
  },
  Hindi: {
    dashboard: 'डैशबोर्ड',
    practice: 'अभ्यास',
    mockTest: 'मॉक टेस्ट',
    uploadPdf: 'पीडीएफ अपलोड',
    streak: 'लगातार दिन',
    accuracy: 'सटीकता',
    avgTime: 'औसत समय',
    totalSolved: 'कुल हल',
    readiness: 'तैयारी',
    nextQuestion: 'अगला प्रश्न',
    viewInHindi: 'हिंदी में देखें',
    viewInEnglish: 'अंग्रेजी में देखें',
    sessionComplete: 'सत्र पूरा हुआ',
    practiceAgain: 'फिर से अभ्यास करें',
    viewDashboard: 'डैशबोर्ड देखें',
    signOut: 'साइन आउट',
    days: 'दिन',
    aiIntelligence: 'एआई इंटेलिजेंस',
    vision: 'भारतीय प्रतियोगी परीक्षाओं के लिए रणनीतिक अभ्यास इंजन।',
    signInGoogle: 'गूगल के साथ साइन इन करें',
    trickSolutions: 'ट्रिक समाधान',
    examProbability: 'परीक्षा की संभावना',
    accuracyTrend: 'सटीकता रुझान',
    rollingAccuracy: 'रोलिंग 5-प्रश्न सटीकता',
    uploadDescription: 'एआई-फर्स्ट प्रश्न पहचान और वर्गीकरण।',
    dropPdfHere: 'पीडीएफ यहाँ छोड़ें',
    orClickToBrowse: 'या ब्राउज़ करने के लिए क्लिक करें',
    studyPlan: 'अध्ययन योजना',
    formulaBook: 'फॉर्मूला बुक',
    sharedBank: 'साझा बैंक',
    aiCoach: 'एआई कोच',
    adaptingTo: 'अनुकूलन',
  }
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('app_language');
    return (saved as Language) || 'English';
  });

  useEffect(() => {
    localStorage.setItem('app_language', language);
  }, [language]);

  const t = (key: string) => translations[language][key] || key;

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
};
