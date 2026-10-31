
import { Server, AlertOctagon, CheckCircle2, Loader2, Building, Users, History } from 'lucide-react';
import AuditLogViewer from '../admin/AuditLogViewer';
import { motion, AnimatePresence } from 'motion/react';

import { cn } from '../../lib/utils';

import { SYSTEM_GLOSSARY } from '../../config/registry';
import { BookA } from 'lucide-react';

import { Labelled } from '../ui/Labelled';

import { SystemUsersPanel } from './SystemUsersPanel';
import { GiveAccessPanel } from './GiveAccessPanel';
import { SystemTelemetryPanel } from './SystemTelemetryPanel';
import { WorkspacePolicyDialog } from './WorkspacePolicyDialog';
import { StressTestPanel } from './StressTestPanel';
import type { SystemCommandCenterModel } from './SystemCommandCenter';
export function SystemCommandCenterView(model: SystemCommandCenterModel) {
 const { overlay2DialogProps, overlay2TitleId, telemetry, loading, lexiconOverrides, setLexiconOverride, showBulkSuccess, setShowBulkSuccess, activeMainTab, setActiveMainTab } = model;
 return (
    <div className="w-full space-y-12 max-w-[1600px] mx-auto pb-12 px-4">
      {/* Header section matching upgraded architecture */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2 border-b border-[var(--line)]">
        <div>
          <div className="flex items-center gap-1.5 text-[9px] font-bold text-[var(--muted)] uppercase tracking-widest truncate mb-1">
            <Server aria-hidden="true" size={12} />
            Institutional Telemetry & Control Tower
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-[var(--text)] tracking-tighter">Admin Panel</h1>
          <p className="text-[var(--muted)] font-medium text-lg mt-2 italic opacity-60">Consolidated platform health, multi-tenant matrices, live billing pipelines, and granular override dials.</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="p-4 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] flex items-center gap-3 shadow-3xs">
            <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
            <div>
              <p className="text-[8px] font-bold text-[var(--muted)] uppercase tracking-widest leading-none">Diagnostic Socket</p>
              <p className="text-xs font-bold text-emerald-600 uppercase mt-0.5 tracking-wider">ONLINE</p>
            </div>
          </div>
        </div>
      </div>

      {loading && !telemetry ? (
        <div className="h-96 flex items-center justify-center flex-col gap-3">
          <Loader2 aria-hidden="true" className="animate-spin text-[var(--text)] opacity-40" size={32} />
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">Hooking operational datastream...</span>
        </div>
      ) : !telemetry || !telemetry.tenants ? (
        <div className="h-96 flex flex-col items-center justify-center gap-4 border border-dashed border-[var(--line)] rounded-[32px]">
          <AlertOctagon aria-hidden="true" size={40} className="text-rose-500 opacity-60" />
          <div className="text-center">
            <h2 className="text-sm font-black text-[var(--text)] uppercase tracking-wider">Interface Refused</h2>
            <p className="text-xs text-[var(--muted)] mt-1">Unable to construct reliable stream channel to backend metrics.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="flex flex-wrap gap-4 border-b border-[var(--line)] pb-4">
            <button
              onClick={() => setActiveMainTab('workspaces')}
              className={cn(
                "px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer",
                activeMainTab === 'workspaces' ? "bg-[var(--brass)] text-[var(--ink)] shadow-md font-bold" : "bg-[var(--surface)] text-[var(--muted)] border border-[var(--line)] hover:bg-[var(--ink)] hover:text-[var(--text)]"
              )}
            >
              <Building aria-hidden="true" className="inline-block w-3.5 h-3.5 mr-2 -mt-0.5" />
              Workspaces & Tenants
            </button>
            <button
              onClick={() => setActiveMainTab('users')}
              className={cn(
                "px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer",
                activeMainTab === 'users' ? "bg-[var(--brass)] text-[var(--ink)] shadow-md font-bold" : "bg-[var(--surface)] text-[var(--muted)] border border-[var(--line)] hover:bg-[var(--ink)] hover:text-[var(--text)]"
              )}
            >
              <Users aria-hidden="true" className="inline-block w-3.5 h-3.5 mr-2 -mt-0.5" />
              Deep User Matrix
            </button>
            <button
              onClick={() => setActiveMainTab('lexicon')}
              className={cn(
                "px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer",
                activeMainTab === 'lexicon' ? "bg-[var(--brass)] text-[var(--ink)] shadow-md font-bold" : "bg-[var(--surface)] text-[var(--muted)] border border-[var(--line)] hover:bg-[var(--ink)] hover:text-[var(--text)]"
              )}
            >
              <BookA aria-hidden="true" className="inline-block w-3.5 h-3.5 mr-2 -mt-0.5" />
              Site Lexicon Control
            </button>
            <button
              onClick={() => setActiveMainTab('audit')}
              className={cn(
                "px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer",
                activeMainTab === 'audit' ? "bg-[var(--brass)] text-[var(--ink)] shadow-md font-bold" : "bg-[var(--surface)] text-[var(--muted)] border border-[var(--line)] hover:bg-[var(--ink)] hover:text-[var(--text)]"
              )}
            >
              <History aria-hidden="true" className="inline-block w-3.5 h-3.5 mr-2 -mt-0.5" />
              Institutional Audit Trail
            </button>
          </div>

          {activeMainTab === 'audit' ? (
            <AuditLogViewer />
          ) : activeMainTab === 'lexicon' ? (
            <div className="space-y-8">
              <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[32px] shadow-3xs overflow-hidden">
                <div className="p-4 md:p-6 border-b border-[var(--line)] flex items-center justify-between bg-[var(--ink)]">
                  <div className="flex items-center gap-3">
                    <BookA aria-hidden="true" size={16} className="text-[#0047AB]" />
                    <h2 className="text-[12px] font-black uppercase tracking-widest text-[var(--text)]">Global Lexicon Override</h2>
                  </div>
                </div>
                <div className="p-6 md:p-8 space-y-6">
                  <p className="text-sm text-[var(--muted)]">
                    Use this administrative panel to override any hardcoded text across the system. This allows full white-labeling and customization of the site's terminology. Changes here are applied instantly for all users.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Object.keys(SYSTEM_GLOSSARY).map(key => {
                        const originalVal = SYSTEM_GLOSSARY[key];
                        const currentVal = lexiconOverrides[key]?.en || originalVal.en;
                        return (
                          <div key={key} className="space-y-2 p-4 bg-[var(--ink)] rounded-[20px] border border-[var(--line)]">
                            <Labelled labelClassName="block text-xs font-bold text-slate-700 tracking-wide break-all" label={<>{key}</>}>
                              <input
                                type="text"
                                value={currentVal}
                                onChange={e => setLexiconOverride(key, 'en', e.target.value)}
                                className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3 py-2 text-sm font-medium focus:border-[#0047AB] focus:ring-2 focus:ring-[#0047AB]/20 transition-all"
                              />
                            </Labelled>
                          </div>
                        );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : activeMainTab === 'users' ? (
            <>
              <GiveAccessPanel />
              <SystemUsersPanel model={model} />
            </>
          ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Main Left Side (Stats & Usage Table) */}
          <SystemTelemetryPanel model={{ ...model, telemetry }} />

          {/* Edit Limits & Policies Modal Accent */}
          <WorkspacePolicyDialog model={model} />

          {/* Right Column - Incident Stream */}
          <StressTestPanel model={model} />
        </div>
        )}
      </div>
      )}

      {/* Bulk Synchronization Progress Success Modal */}
      <AnimatePresence>
        {showBulkSuccess && (
          <div {...overlay2DialogProps} className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[250] p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[var(--surface)] rounded-[32px] border border-[var(--line)] shadow-2xl p-4 md:p-8 max-w-sm w-full text-center relative"
            >
              <div className="mx-auto w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 aria-hidden="true" size={24} />
              </div>
              <h2 id={overlay2TitleId} className="text-xl font-black text-[var(--text)] uppercase tracking-tight">Ledger Synchronized</h2>
              <p className="text-xs text-[var(--muted)] mt-2 uppercase tracking-wide leading-relaxed">
                Successfully propagated global cost coefficients, spend multipliers, and private api key surcharges to all {telemetry?.tenants?.length || 0} active workspaces securely.
              </p>
              <button
                type="button"
                onClick={() => setShowBulkSuccess(false)}
                className="w-full mt-6 h-11 bg-slate-900 hover:bg-[#0047AB] text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-md cursor-pointer"
              >
                Acknowledge alignment
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
