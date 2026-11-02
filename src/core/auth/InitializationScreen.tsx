import React from 'react';
import { motion } from 'motion/react';
import { SYSTEM_GLOSSARY } from '../../config/systemGlossary';

export function InitializationScreen({ language }: { language: string }) {
  return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-[#fbfbfc] overflow-hidden relative font-sans">
      <div className="paper-texture" />
      <div className="absolute inset-0 technical-grid opacity-[0.03] pointer-events-none" />
      <div className="relative flex flex-col items-center gap-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-3 mb-2"
        >
          <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-800 font-black text-sm shadow-md">LF</div>
          <span className="text-xl font-black text-slate-800 tracking-tighter">
            {SYSTEM_GLOSSARY.appName[language] || SYSTEM_GLOSSARY.appName['en']}
          </span>
        </motion.div>
        <div className="flex gap-1.5 items-center justify-center h-8">
          <span className="w-2.5 h-2.5 rounded-full bg-[#1a73e8] animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2.5 h-2.5 rounded-full bg-[#ea4335] animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2.5 h-2.5 rounded-full bg-[#fbbc04] animate-bounce" style={{ animationDelay: '300ms' }} />
          <span className="w-2.5 h-2.5 rounded-full bg-[#34a853] animate-bounce" style={{ animationDelay: '450ms' }} />
        </div>
        <p className="text-[9px] font-black text-[var(--muted)] tracking-widest truncate uppercase mt-2">
          {SYSTEM_GLOSSARY.connectingSecureVault[language] || SYSTEM_GLOSSARY.connectingSecureVault['en']}
        </p>
      </div>
    </div>
  );
}
