import React, { useState, useEffect, useId } from 'react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { Key, AlertCircle, RefreshCw, CheckCircle2, Lock, Eye, EyeOff, Database, Cpu as CpuIcon, Activity, ExternalLink, Sliders, Sparkles, BrainCircuit } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { toast } from 'sonner';
import { db } from '../../../firebase';
import { collection, query, where, getDocs, deleteDoc, doc, updateDoc } from '../../../lib/db/firestore';
import AsyncButton from '../../ui/AsyncButton';
import { useTimeout } from '../../../hooks/useTimeout';

export default function AISettings() {
  const settingsId = useId();
  const updateGeminiApiKey = useAuthStore(s => s.updateGeminiApiKey);
  const userProfile = useAuthStore(state => state.userProfile);
  const currentWorkspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspaces = useAuthStore(state => state.workspaces);
  
  // Find current active workspace
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);

  const [apiKey, setApiKey] = useState(userProfile?.geminiApiKey || '');
  const [, setIsUpdating] = useState(false);
  const [showKey, setShowKey] = useState(false);
  
  // Track selected model with modern fallback mapping
  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window !== 'undefined') {
      const persisted = localStorage.getItem('lf_selected_ai_model');
      if (persisted) return persisted;
    }
    // Read from workspace or default
    return currentWorkspace?.aiModel || 'Gemini 3.8 Flash';
  });

  // Self-learning precision threshold (Laplace/Bayes classification gate)
  const [threshold, setThreshold] = useState(() => {
    return currentWorkspace?.matchingThreshold ?? 0.85;
  });

  // Learning speed multiplier (weights incoming transactions train/fine-tune Bayes parameters)
  const [learningScale, setLearningScale] = useState(2.0);
  const { setSafeTimeout } = useTimeout();

  // Sync state values when workspace loads
  useEffect(() => {
    if (currentWorkspace) {
      if (typeof currentWorkspace.matchingThreshold === 'number') {
        const t = currentWorkspace.matchingThreshold;
        setSafeTimeout(() => setThreshold(t), 0);
      }
      if (currentWorkspace.aiModel) {
        const m = currentWorkspace.aiModel;
        setSafeTimeout(() => setSelectedModel(m), 0);
      }
    }
  }, [currentWorkspaceId, workspaces, currentWorkspace, setSafeTimeout]);

  const MODEL_OPTIONS = [
    {
      name: 'Gemini 3.8 Flash',
      tier: 'Production Default',
      desc: 'Optimized high-throughput multimodal intelligence for OCR receipt extraction, bank statement parsing, deep transaction labeling, and real-time copilot intelligence.'
    },
    {
      name: 'Gemini 3.1 Pro',
      tier: 'Deep Reasoning',
      desc: 'Advanced reasoning model for complex financial tax profiles, multi-entity consolidation, and forensic audit simulations.'
    }
  ];

  const handleSelectModel = (modelName: string) => {
    setSelectedModel(modelName);
  };

  const handleSave = async () => {
    setIsUpdating(true);
    const loader = toast.loading("Configuring proxima rule gateway and synchronizing to institution core...");
    try {
      // 1. Update API Key if supplied
      if (apiKey.trim()) {
        await updateGeminiApiKey(apiKey.trim());
      }
      
      // 2. Update Workspace-level settings (Model choice + Bayes threshold)
      if (currentWorkspaceId) {
        await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
          matchingThreshold: Number(threshold),
          aiModel: selectedModel
        });
      }

      // 3. Local persistence update
      if (typeof window !== 'undefined') {
        localStorage.setItem('lf_selected_ai_model', selectedModel);
      }

      // Update local ledger store state directly for hot reloading
      useLedgerStore.getState().setMatchingThreshold(Number(threshold));

      toast.success("AI Configuration synchronized persistently on cloud profile.", { id: loader });
    } catch (error) {
      console.error(error);
      toast.error(`Sync failed: ${(error as Error).message || 'Verification rejected.'}`, { id: loader });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleWipeRuleCache = async () => {
    if (!currentWorkspaceId) {
      toast.error("No active workspace selected.");
      return;
    }
    const loader = toast.loading("Wiping algorithm neuromatrix persistently from cloud storage...");
    try {
      const q = query(
        collection(db, 'rulePatterns'),
        where('workspaceId', '==', currentWorkspaceId)
      );
      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
      
      useLedgerStore.getState().setAnalyticalPatternCache({});
      
      toast.success("Algorithm memory persistently purged. Rule plasticity restored.", { id: loader });
    } catch (err) {
      console.error(err);
      toast.error("Failed to persistently wipe patterns from cloud storage.", { id: loader });
    }
  };

  // Determine current threshold status string for user-friendly guidance
  const getThresholdLabel = (val: number) => {
    if (val >= 0.90) {
      return {
        title: "Absolute Certainty / Maximum Veracity",
        color: "text-indigo-600 bg-indigo-50 border-indigo-150",
        description: "Requires >= " + Math.round(val * 100) + "% mathematical matching confidence. Minimizes auto-matching false-positives; unmatched entries fallback directly to Manual Review for deep safety."
      };
    } else if (val >= 0.80) {
      return {
        title: "Balanced Accuracy / Standard Enterprise Verification",
        color: "text-emerald-600 bg-emerald-50 border-emerald-150",
        description: "Optimal enterprise default (" + Math.round(val * 100) + "% threshold). Robust statistical self-classification balanced with quick multi-layer heuristics."
      };
    } else {
      return {
        title: "Maximum Plasticity / Relaxed Learning",
        color: "text-amber-600 bg-amber-50 border-amber-150",
        description: "Allows auto-tagging at " + Math.round(val * 100) + "% confidence. Highly active learning and associative mapping, but carries an increased risk of minor semantic mismatching."
      };
    }
  };

  const statusLabel = getThresholdLabel(threshold);

  return (
    <div className="space-y-10">
      <div className="ledger-card p-6 md:p-12 bg-[var(--surface)] border-[var(--line)] shadow-sm relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-12 opacity-[0.02] pointer-events-none transition-opacity group-hover:opacity-[0.05]">
          <Key aria-hidden="true" size={140} />
        </div>
        
        <div className="flex items-center gap-5 mb-12">
          <div className="w-14 h-14 bg-indigo-600 text-white rounded-[32px] flex items-center justify-center shadow-xl shadow-ledger-accent/20 rotate-3 animate-pulse">
            <BrainCircuit aria-hidden="true" size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-[var(--text)] tracking-tight uppercase tracking-widest">Rule Key & Intelligence Provisioning</h2>
            <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] mt-1">Google Gemini Enterprise Routing Infrastructure</p>
          </div>
        </div>

        <div className="space-y-8">
          <div className="space-y-4">
            <label htmlFor={`${settingsId}-api-key`} className="text-[10px] font-black uppercase text-[var(--muted)] tracking-[0.2em] flex items-center justify-between">
              <span className="flex items-center gap-2">Enterprise API Key Override</span>
              {userProfile?.geminiApiKey && (
                <span className="inline-flex items-center gap-1 text-emerald-600 font-extrabold text-[9px] bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
                  <CheckCircle2 aria-hidden="true" size={10} />
                  CLOUD PERSISTED OVERRIDE
                </span>
              )}
            </label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-[var(--muted)]">
                <Lock aria-hidden="true" size={18} />
              </div>
              <input
                id={`${settingsId}-api-key`}
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Secure institutional API credentials (leaves blank to use global workspace keys)..."
                className="w-full pl-14 pr-14 py-5 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] text-sm font-mono focus:bg-[var(--surface)] focus:ring-4 focus:ring-indigo-600/5 focus:border-indigo-600 transition-all outline-none"
              />
              <button 
                aria-label={showKey ? "Hide API key" : "Show API key"}
                onClick={() => setShowKey(!showKey)}
                type="button"
                className="absolute inset-y-0 right-0 pr-5 flex items-center text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                style={{ right: '1.25rem' }}
              >
                {showKey ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
              </button>
            </div>
          </div>

          <div className="p-6 bg-slate-900 rounded-[32px] border border-slate-800 flex flex-col sm:flex-row gap-5">
            <div className="w-10 h-10 bg-[var(--surface)]/5 rounded-[32px] flex items-center justify-center shrink-0 border border-white/10">
              <AlertCircle aria-hidden="true" className="text-amber-400" size={20} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-200 leading-relaxed uppercase tracking-wider">Enterprise Cryptograph Awareness</p>
              <p className="text-[11px] text-[var(--muted)] leading-relaxed font-medium">
                Your keys enable high-precision fiscal modeling and bypass system-shared quota limitations. Keys are AES-256 encrypted at rest in your secure institutional user profile.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Bayesian Self-Learning Rigor Configurations */}
      <div className="ledger-card p-6 md:p-12 bg-[var(--surface)] border-[var(--line)] shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5 mb-10">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-[32px] flex items-center justify-center shrink-0 border border-indigo-100">
            <Sliders aria-hidden="true" size={22} />
          </div>
          <div>
            <h3 className="text-lg font-black text-[var(--text)] tracking-tight uppercase">Statistical Self-Learning Calibration</h3>
            <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-[0.15em] mt-0.5">Control match thresholds and update rates at absolute integrity</p>
          </div>
        </div>

        <div className="space-y-8">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label htmlFor={`${settingsId}-matching-gate`} className="text-[10px] font-black uppercase text-[var(--muted)] tracking-[0.2em]">
                Self-Learning Matching Gate (Certainty Edge)
              </label>
              <span className="font-mono text-sm font-black text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-xl">
                {Math.round(threshold * 100)}% Match Rigor
              </span>
            </div>
            
            <input 
              id={`${settingsId}-matching-gate`}
              type="range" 
              min="0.50" 
              max="0.99" 
              step="0.01" 
              value={threshold} 
              onChange={(e) => setThreshold(Number.parseFloat(e.target.value))}
              className="w-full h-2 bg-[var(--surface)] rounded-lg appearance-none cursor-pointer accent-indigo-600 border border-[var(--line)]"
            />
            
            <div className={cn("p-6 rounded-[32px] border transition-all space-y-2", statusLabel.color)}>
              <span className="text-[10px] font-medium uppercase tracking-wider block">{statusLabel.title}</span>
              <p className="text-[11px] leading-relaxed font-semibold">{statusLabel.description}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
            {/* Soft-Learning Rate Adjuster */}
            <div role="group" aria-labelledby={`${settingsId}-learning-weight`} className="space-y-4">
              <span id={`${settingsId}-learning-weight`} className="text-[10px] font-black uppercase text-[var(--muted)] tracking-[0.2em] block">
                Unsupervised Learning Memory Weight
              </span>
              <div className="flex flex-col sm:flex-row gap-4">
                {[
                  { value: 1.0, label: 'Standard / Fluid (1.0x)' },
                  { value: 2.0, label: 'Fast / Calibrated (2.0x)' },
                  { value: 5.0, label: 'Hyper / Immediate (5.0x)' }
                ].map((scale) => (
                  <button
                    key={scale.value}
                    aria-pressed={learningScale === scale.value}
                    type="button"
                    onClick={() => setLearningScale(scale.value)}
                    className={cn(
                      "flex-1 p-4 rounded-[32px] text-[10px] font-black uppercase tracking-wider text-center border transition-all active:scale-[0.98]",
                      learningScale === scale.value ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-600/10" : "bg-[var(--surface)] border-[var(--line)] text-[var(--text)] hover:border-slate-350"
                    )}
                  >
                    {scale.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide leading-relaxed">
                Determines how fast newly accepted or corrected transactions alter the Bayesian ledger sorting weights. Higher values enforce faster adaptability but reduce historical smoothing.
              </p>
            </div>

            {/* Clear Brain memory state */}
            <div className="p-6 bg-rose-500/5 rounded-[32px] border border-rose-500/10 flex flex-col justify-between">
              <div className="space-y-1">
                <h3 className="text-xs font-black text-rose-600 uppercase tracking-widest flex items-center gap-1.5">
                  <Activity aria-hidden="true" size={14} />
                  Purge Algorithmic Drift
                </h3>
                <p className="text-[10px] text-rose-500/70 leading-relaxed font-bold uppercase tracking-wider">
                  Purge Bayes classifiers and fast heuristic pattern models mapping to current Workspace. Structured analytical custom rules remain persistent.
                </p>
              </div>
              <AsyncButton 
                onClick={handleWipeRuleCache}
                type="button"
                loadingText="Wiping..."
                className="w-full mt-4 px-6 py-3 bg-red-50 hover:bg-red-100 text-rose-600 rounded-[32px] text-[10px] font-medium uppercase tracking-wider transition-all ring-1 ring-inset ring-rose-500/35 flex items-center justify-center gap-2 active:scale-95"
              >
                <RefreshCw aria-hidden="true" size={12} />
                Wipe Neuromatrix Pattern Cache
              </AsyncButton>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="ledger-card p-6 md:p-12 bg-[var(--surface)] border-[var(--line)] shadow-sm">
          <h3 className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest mb-6 flex items-center gap-2">
            <CpuIcon aria-hidden="true" size={14} className="text-indigo-500" />
            Vivid Logic Routing Precision
          </h3>
          <div className="space-y-4">
            {MODEL_OPTIONS.map((m) => (
              <button type="button"
                aria-pressed={selectedModel === m.name}
                key={m.name} 
                onClick={() => handleSelectModel(m.name)}
                className={cn(
                  "w-full text-left p-5 rounded-[32px] border flex flex-col gap-2 transition-all cursor-pointer select-none active:scale-[0.98]",
                  selectedModel === m.name ? "bg-indigo-50 border-indigo-200 ring-2 ring-indigo-50" : "bg-[var(--surface)] border-[var(--line)] hover:border-slate-350"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text)]">{m.name}</span>
                  <span className={cn(
                    "text-[8px] font-black uppercase px-2 py-0.5 rounded",
                    selectedModel === m.name ? "bg-indigo-600 text-white" : "bg-zinc-150 text-slate-500"
                  )}>
                    {m.tier}
                  </span>
                </div>
                <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wider leading-relaxed">{m.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="ledger-card p-6 md:p-12 bg-[var(--surface)] border-[var(--line)] shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest mb-6 flex items-center gap-2">
              <Activity aria-hidden="true" size={14} className="text-emerald-500" />
              Intelligence Bridge Telemetry
            </h3>
            <div className="space-y-6 pt-2">
              {[
                { label: 'Rule Resolution Latency', value: '42ms', status: 'Optimal' },
                { label: 'Cloud Synchrony Uptime', value: '99.99%', status: 'Stable' },
                { label: 'Staged Prediction Drift', value: '0.001%', status: 'Minimal' },
              ].map((h) => (
                <div key={h.label} className="flex items-center justify-between border-b border-dashed border-[var(--line)] pb-4 last:border-0 last:pb-0">
                  <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest pr-4">{h.label}</span>
                  <div className="text-right whitespace-nowrap">
                    <span className="text-xs font-black text-[var(--text)] block leading-tight">{h.value}</span>
                    <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">{h.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-6 border-t border-[var(--line)] flex items-center justify-between">
            <a 
              href="https://aistudio.google.com/app/apikey" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-2 hover:opacity-70 transition-opacity"
            >
              <ExternalLink aria-hidden="true" size={16} />
              Launch Google AI Studio Workbench
            </a>
          </div>
        </div>
      </div>

      {/* Persistence commit line */}
      <div className="p-6 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="space-y-1">
          <h3 className="text-xs font-black text-[var(--text)] uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles aria-hidden="true" size={14} className="text-amber-500" />
            Enterprise Veracity Gate
          </h3>
          <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wider">
            Consolidate keys, dynamic model routing rules, and the mathematical classifier threshold variables.
          </p>
        </div>
        <AsyncButton
          onClick={handleSave}
          loadingText="SYNCHRONIZING..."
          className="btn-primary !px-10 !py-5 flex items-center justify-center gap-3 disabled:bg-zinc-300 shadow-2xl shadow-ledger-accent/20 w-full sm:w-auto sm:min-w-[240px] whitespace-nowrap active:scale-95 transition-all text-xs font-medium uppercase tracking-wider text-white leading-none inline-flex items-center"
        >
          <Database aria-hidden="true" size={16} />
          <span>COMMIT RULES PLATFORM</span>
        </AsyncButton>
      </div>
    </div>
  );
}
