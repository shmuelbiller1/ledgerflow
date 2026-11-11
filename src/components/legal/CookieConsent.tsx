import React, { useState } from 'react';
import { Cookie, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { BRAND_NAME } from '../../config/brand';
interface CookieConsentProps {
  onOpenPrivacyPolicy?: () => void;
}

export default function CookieConsent({ onOpenPrivacyPolicy }: CookieConsentProps) {
  const [showBanner, setShowBanner] = useState(() => !localStorage.getItem('ledgerflow-cookie-consent'));

  const handleAccept = (type: 'all' | 'essential') => {
    localStorage.setItem('ledgerflow-cookie-consent', JSON.stringify({
      choice: type,
      timestamp: new Date().toISOString()
    }));
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        role="region"
        aria-labelledby="cookie-notice-title"
        className="fixed bottom-4 right-4 left-4 md:left-auto md:max-w-md z-50 bg-slate-900 border border-slate-800 text-white p-5 rounded-2xl shadow-2xl backdrop-blur-md"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
              <Cookie size={18} />
            </div>
            <h2 id="cookie-notice-title" className="text-sm font-bold text-white">Cookie & Privacy Notice</h2>
          </div>
          <button
            onClick={() => handleAccept('essential')}
            className="p-1 text-slate-400 hover:text-white rounded-md transition-colors"
            aria-label="Dismiss cookie banner"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed mb-4">
          {BRAND_NAME} uses essential cookies and client storage to secure workspace sessions, maintain active financial state, and meet compliance standards.{' '}
          {onOpenPrivacyPolicy && (
            <button
              onClick={onOpenPrivacyPolicy}
              className="text-indigo-400 hover:underline font-semibold"
            >
              Read Privacy Policy
            </button>
          )}
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAccept('all')}
            className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
          >
            Accept All
          </button>
          <button
            onClick={() => handleAccept('essential')}
            className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Essential Only
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
