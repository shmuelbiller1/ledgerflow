import { useDialog } from '../../hooks/useDialog';
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Terminal,
  Layers,
  Activity
} from 'lucide-react';
import ArchitectureMonitor from './ArchitectureMonitor';
import { useAuditTelemetry } from '../../hooks/useAuditTelemetry';

import { BRAND_NAME } from '../../config/brand';
export default function SystemArchitecture({ isOpen, onClose, transactions, accounts }: { isOpen: boolean; onClose: () => void; transactions?: import("../../types").Transaction[]; accounts: import("../../types").ChartAccount[] }) {
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(onClose, isOpen);
  const telemetry = useAuditTelemetry(transactions!, accounts);

  return (
    <AnimatePresence>
      {isOpen && (
        <div {...overlayDialogProps} className="fixed inset-0 z-[160] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-2xl bg-[var(--ink)] rounded-[32px] border border-[var(--line)] shadow-2xl overflow-y-auto custom-scrollbar p-12"
          >
            <div className="flex items-center justify-between mb-12">
               <div className="flex items-center gap-4">
                 <div className="w-12 h-12 bg-slate-900 text-zinc-100 rounded-[32px] flex items-center justify-center shadow-2xl shadow-ledger-ink/20 transform -rotate-1">
                    <Layers size={24} />
                  </div>
                  <div>
                    <h2 id={overlayTitleId} className="text-2xl font-bold text-[var(--text)] tracking-tight">System Architecture</h2>
                    <p className="text-xs text-[var(--muted)] font-bold uppercase tracking-widest mt-1">High-Level Deterministic Data Flow</p>
                  </div>
               </div>
               <button aria-label="Close" onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-all"><X size={20} /></button>
            </div>

            <ArchitectureMonitor layerStatus={telemetry.layerStatus} />

            <div className="mt-12 p-4 md:p-8 bg-zinc-900 rounded-[32px] text-zinc-400 space-y-6 relative overflow-hidden">
               <div className="absolute top-0 right-0 p-4 md:p-8 opacity-5">
                  <Terminal size={120} />
               </div>
               <div className="flex items-start gap-4 relative z-10">
                  <Terminal size={18} className="text-emerald-500 mt-1" />
                  <div>
                     <h3 className="text-zinc-100 text-[10px] font-medium uppercase tracking-wider mb-2">Analytical Summary</h3>
                     <p className="text-xs leading-relaxed text-zinc-300">
                        The {BRAND_NAME} data pipeline implements a <span className="text-white font-bold italic">Deterministic Intelligence</span> protocol. 
                        Every transaction passes through O(1) Bloom filters, MinHash Entity Resolution, and Trend Analysis 
                        before being committed to the ledger.
                     </p>
                  </div>
               </div>
               <div className="flex items-center gap-4 pt-4 border-t border-zinc-800 relative z-10">
                  <div className="flex -space-x-2">
                     {[1,2,3].map(dot => (
                        <div key={dot} className="w-6 h-6 rounded-full border-2 border-zinc-900 bg-zinc-800 flex items-center justify-center">
                           <Activity size={10} className="text-emerald-500" />
                        </div>
                     ))}
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">All Nodes Certified & Signed</span>
               </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
