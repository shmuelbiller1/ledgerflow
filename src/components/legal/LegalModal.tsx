import { useDialog } from '../../hooks/useDialog';
import React, { useState } from 'react';
import { X, ShieldCheck, FileText, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { BRAND_NAME } from '../../config/brand';
interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'terms' | 'privacy';
}

export default function LegalModal({ isOpen, onClose, initialTab = 'terms' }: LegalModalProps) {
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(onClose, isOpen);
  const [activeTab, setActiveTab] = useState<'terms' | 'privacy'>(initialTab);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div {...overlayDialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                {activeTab === 'privacy' ? <ShieldCheck size={20} /> : <FileText size={20} />}
              </div>
              <div>
                <h2 id={overlayTitleId} className="text-lg font-bold text-slate-900">
                  {activeTab === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
                </h2>
                <p className="text-xs text-[var(--muted)] font-medium">{BRAND_NAME} Platform Compliance & Legal Agreement</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-[var(--muted)] hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-100 bg-slate-50/30 px-6 gap-6 text-sm font-semibold text-slate-600">
            <button
              onClick={() => setActiveTab('terms')}
              className={`py-3 border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'terms'
                  ? 'border-indigo-600 text-indigo-600 font-bold'
                  : 'border-transparent text-[var(--muted)] hover:text-slate-900'
              }`}
            >
              <FileText size={16} />
              Terms of Service
            </button>
            <button
              onClick={() => setActiveTab('privacy')}
              className={`py-3 border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'privacy'
                  ? 'border-indigo-600 text-indigo-600 font-bold'
                  : 'border-transparent text-[var(--muted)] hover:text-slate-900'
              }`}
            >
              <ShieldCheck size={16} />
              Privacy Policy
            </button>
          </div>

          {/* Content Body */}
          <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-600 leading-relaxed font-sans">
            {activeTab === 'terms' ? (
              <>
                <section>
                  <h3 className="text-base font-bold text-slate-900 mb-2">1. Acceptance of Terms</h3>
                  <p>
                    By accessing or using {BRAND_NAME} ("Platform"), provided by {BRAND_NAME} Systems, you agree to be bound by these Terms of Service. If you are entering into this agreement on behalf of a company or other legal entity, you represent that you have authority to bind such entity to these terms.
                  </p>
                </section>

                <section>
                  <h3 className="text-base font-bold text-slate-900 mb-2">2. Description of Service</h3>
                  <p>
                    {BRAND_NAME} provides cloud-based enterprise resource planning, financial accounting, general ledger, and double-entry transaction management software. {BRAND_NAME} is designed as an analytical tool and does not constitute certified legal, tax, or official CPA audit advice.
                  </p>
                </section>

                <section>
                  <h3 className="text-base font-bold text-slate-900 mb-2">3. User Data & Workspace Ownership</h3>
                  <p>
                    You retain full ownership of all transaction data, chart of accounts, bank imports, and financial records uploaded to your workspace. {BRAND_NAME} grants you a non-exclusive, non-transferable license to access and manage your workspace in accordance with your subscription tier.
                  </p>
                </section>

                <section>
                  <h3 className="text-base font-bold text-slate-900 mb-2">4. Acceptable Use & Account Security</h3>
                  <p>
                    You are responsible for maintaining the confidentiality of your credentials and account tokens. You agree not to use the Platform for unlawful financial activities, fraud, or intentional circumvention of system limits.
                  </p>
                </section>

                <section>
                  <h3 className="text-base font-bold text-slate-900 mb-2">5. Limitation of Liability</h3>
                  <p>
                    To the maximum extent permitted by applicable law, {BRAND_NAME} shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from loss of data, income, or business interruption.
                  </p>
                </section>
              </>
            ) : (
              <>
                <section>
                  <h3 className="text-base font-bold text-slate-900 mb-2">1. Information We Collect</h3>
                  <p>
                    We collect information required to deliver enterprise accounting services: account credentials (email, UID), workspace configuration metadata, uploaded bank statement files, journal entries, and system diagnostic telemetry.
                  </p>
                </section>

                <section>
                  <h3 className="text-base font-bold text-slate-900 mb-2">2. How We Use Financial Data</h3>
                  <p>
                    Your financial data is strictly used to render balance sheets, profit and loss reports, double-entry audit checks, and AI-assisted ledger categorization within your authenticated workspace session. We do not sell, rent, or share your financial records with third-party advertisers.
                  </p>
                </section>

                <section>
                  <h3 className="text-base font-bold text-slate-900 mb-2">3. AI Processing & Privacy Disclosures</h3>
                  <p>
                    If you interact with AI intelligence lenses (e.g. Gemini AI ledger categorization or natural language transaction parsing), relevant transaction descriptions are processed via secure server-side API endpoints with strict non-retention policies.
                  </p>
                </section>

                <section>
                  <h3 className="text-base font-bold text-slate-900 mb-2">4. Data Storage & Security Measures</h3>
                  <p>
                    Financial records are encrypted in transit using TLS 1.3 and at rest via Google Cloud Firestore with role-based access control rules enforced at the database level.
                  </p>
                </section>

                <section>
                  <h3 className="text-base font-bold text-slate-900 mb-2">5. User Data Rights & GDPR Compliance</h3>
                  <p>
                    You have the right to export your full financial ledger data in standardized JSON/CSV formats at any time, or request complete account and workspace deletion via Platform Settings.
                  </p>
                </section>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-[var(--muted)] font-medium">
              <Lock size={12} />
              <span>TLS 1.3 Encrypted • Compliance Version 2026.1</span>
            </div>
            <button
              onClick={onClose}
              className="px-5 py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold text-xs transition-colors"
             aria-label="Acknowledge & Close">
              Acknowledge & Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
