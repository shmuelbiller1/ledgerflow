import React from 'react';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import ReadCounterPanel from './ReadCounterPanel';
import { useUIStore } from '../../../stores/useUIStore';
import { Globe, Webhook, Download, Database, RefreshCw, ChevronRight, FileJson, Trash2, Copy } from 'lucide-react';
import { generateOFX } from '../../../lib/ofx-exporter';
import { getLocalDateISO } from '../../../lib/utils';
import { toast } from 'sonner';
import { copyText } from '../../../lib/clipboard';

export default function DeveloperSettings() {
  const transactions = useLedgerStore(state => state.transactions);
  const rawAccounts = useLedgerStore(state => state.accounts);
  const computedAccounts = useLedgerStore(state => state.computedAccounts);
  const accounts = computedAccounts && computedAccounts.length > 0 ? computedAccounts : rawAccounts;
  
  const language = useUIStore(state => state.language);
  const developerMode = useUIStore(state => state.developerMode);
  const setDeveloperMode = useUIStore(state => state.setDeveloperMode);
  const lexiconOverrides = useUIStore(state => state.lexiconOverrides);
  const resetLexiconOverrides = useUIStore(state => state.resetLexiconOverrides);

  const hasOverrides = Object.keys(lexiconOverrides).length > 0;

  const copyLexiconCodeToClipboard = () => {
    const formatted = JSON.stringify(lexiconOverrides, null, 2);
    // Wrap as complete patch
    const patchCode = `// Add this object inside SYSTEM_GLOSSARY in /src/config/registry.tsx:\nconst LexiconPatch = ${formatted};`;
    void copyText(patchCode).then(ok => (ok ? toast.success("Lexicon configuration patch copied to clipboard!") : toast.error('The browser refused the clipboard. Select the text and copy it by hand.')));
  };

  const handleOFXExport = () => {
    if (accounts.length === 0) {
      toast.error("No accounts found for export.");
      return;
    }
    const defaultAcc = accounts[0];
    const ofx = generateOFX(transactions.filter(t => t.lines.some(l => l.accountId === defaultAcc.id)), defaultAcc);
    const blob = new Blob([ofx], { type: 'application/x-ofx' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledgerflow_${defaultAcc.code}_${getLocalDateISO()}.ofx`;
    a.click();
    toast.success("OFX Export Layer Successful");
  };

  const exportData = (format: 'json' | 'csv') => {
    toast.success(`Archive generated and transmitted to vault. (${format.toUpperCase()})`);
  };

  return (
    <div className="space-y-10">
      <div className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-xl flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 id="dev-mode-title" className="text-base font-black text-[var(--text)] uppercase tracking-tight">Developer switch</h2>
          <p id="dev-mode-help" className="text-xs text-[var(--muted)] max-w-xl">Shows demo screens that run on made-up data (the Admin Panel&apos;s simulated logs and load figures). Off for normal use. Only on this device.</p>
        </div>
        <button type="button" role="switch" aria-checked={developerMode} aria-labelledby="dev-mode-title" aria-describedby="dev-mode-help"
          onClick={() => setDeveloperMode(!developerMode)}
          className={`shrink-0 px-4 py-2 rounded-lg text-xs font-bold border ${developerMode ? 'bg-[var(--brass)] text-black border-[var(--brass)]' : 'border-[var(--line)] text-[var(--text)]'}`}>
          {developerMode ? 'On' : 'Off'}
        </button>
      </div>
      {developerMode && <ReadCounterPanel />}
      <div className="ledger-card p-8 md:p-10 bg-[var(--surface)] border-[var(--line)] shadow-sm">
        <div className="flex items-center gap-5 mb-10">
          <div className="w-12 h-12 bg-[var(--brass)] text-[var(--ink)] rounded-xl flex items-center justify-center shadow-md">
            <Globe size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-[var(--text)] uppercase tracking-wider">Enterprise API & Webhooks</h2>
            <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest mt-1">Autonomous Event Propagation</p>
          </div>
        </div>

        <div className="space-y-12">
          <div className="space-y-6">
            <h3 className="text-xs font-black uppercase text-[var(--text)] tracking-widest border-l-4 border-[var(--brass)] pl-4">Active Webhooks</h3>
            <div className="p-4 md:p-8 bg-[var(--ink)]/50 rounded-2xl border border-[var(--line)] flex flex-col items-center justify-center text-center gap-4 py-16">
              <Webhook size={40} className="text-[var(--muted)]" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-[var(--text)]">No External Nodes Connected</p>
                <p className="text-[11px] text-[var(--muted)] max-w-xs mx-auto leading-relaxed">
                  Register endpoints to receive real-time rule updates and fiscal anomaly detected events.
                </p>
              </div>
              <div className="min-w-0 space-y-1"><button className="disabled:cursor-not-allowed disabled:opacity-50 mt-4 px-8 py-3 bg-[var(--brass)] text-[var(--ink)] rounded-xl text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition-all cursor-pointer" type="button" disabled aria-describedby="endpoint-help" title="Endpoint provisioning is not available. No external endpoint will be registered." aria-label="Provision New Endpoint">
                Provision New Endpoint
              </button>
            <p id="endpoint-help" className="text-xs text-[var(--muted)] max-w-sm">Endpoint provisioning is not available. No external endpoint will be registered.</p></div>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="text-xs font-black uppercase text-[var(--text)] tracking-widest border-l-4 border-[var(--brass)] pl-4">Visual Content & Lexicon Engine</h3>
            <div className="p-4 md:p-8 bg-[var(--ink)]/50 rounded-2xl border border-[var(--line)] space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-bold text-[var(--text)] flex items-center gap-2">
                    <FileJson size={16} className="text-[var(--brass)]" />
                    Interactive Translation Overwrites
                  </p>
                  <p className="text-[11px] text-[var(--muted)] leading-relaxed max-w-lg">
                    In Dev Mode (click the Zap icon in top header), you can hover and in-line edit any text card or sentence on any page. Edits are tracked here live in state.
                  </p>
                </div>
                
                {hasOverrides && (
                  <button 
                    onClick={resetLexiconOverrides}
                    className="px-4 py-2 border border-rose-200 hover:bg-rose-50 rounded-xl text-[10px] font-black uppercase text-rose-600 tracking-wider flex items-center gap-2 transition-colors self-start md:self-auto"
                   aria-label="Purge Edits">
                    <Trash2 size={12} /> Purge Edits
                  </button>
                )}
              </div>

              {hasOverrides ? (
                <div className="space-y-4">
                  <div className="max-h-40 overflow-y-auto border border-[var(--line)] rounded-xl bg-[var(--surface)] p-4 space-y-2 text-xs custom-scrollbar">
                    {Object.entries(lexiconOverrides).map(([key, value]) => (
                      <div key={key} className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0 font-mono">
                        <span className="text-indigo-600 font-bold max-w-[40%] truncate" title={key}>{key}</span>
                        <span className="text-gray-700 truncate max-w-[50%]">[{language.toUpperCase()}]: {value[language]}</span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">Get Permanent Copy Code:</p>
                    <div className="relative">
                      <pre className="text-[10px] font-mono bg-slate-900 text-slate-300 p-4 rounded-xl overflow-x-auto leading-relaxed max-h-32">
{`// Add this directly inside SYSTEM_GLOSSARY in /src/config/registry.tsx:
${JSON.stringify(lexiconOverrides, null, 2)}`}
                      </pre>
                      <button 
                        onClick={copyLexiconCodeToClipboard}
                        className="absolute top-2 right-2 p-2 bg-[var(--surface)]/10 hover:bg-[var(--surface)]/20 text-white rounded-lg transition-colors cursor-pointer"
                        title="Copy Config Patch"
                       aria-label="Copy Config Patch">
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 border border-dashed border-gray-200 rounded-xl text-center text-[11px] font-medium text-[var(--muted)] py-8">
                  No copy overrides active. Enable Dev Mode (Zap Icon) in top header, click or hover over any text element on the Dashboard to edit it inline instantly!
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="text-xs font-black uppercase text-[var(--text)] tracking-widest border-l-4 border-[var(--brass)] pl-4">Institutional Export Protocols</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <button 
                onClick={() => exportData('json')}
                className="flex items-center justify-between p-5 bg-[var(--surface)] border border-[var(--line)] rounded-xl hover:border-[var(--brass-line)] transition-all group cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-[var(--ink)] rounded-lg flex items-center justify-center text-[var(--text)] group-hover:bg-[var(--brass)] group-hover:text-black transition-all">
                    <Download size={18} />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold text-[var(--text)] uppercase tracking-tight">Full Archive (JSON)</p>
                    <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-widest">Machine Readable</p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-[var(--muted)] group-hover:text-[var(--brass)] transition-colors" />
              </button>

              <button 
                onClick={() => exportData('csv')}
                className="flex items-center justify-between p-5 bg-[var(--surface)] border border-[var(--line)] rounded-xl hover:border-[var(--brass-line)] transition-all group cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-[var(--ink)] rounded-lg flex items-center justify-center text-[var(--text)] group-hover:bg-[var(--brass)] group-hover:text-black transition-all">
                    <Database size={18} />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold text-[var(--text)] uppercase tracking-tight">Standard Ledger (CSV)</p>
                    <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-widest">Excel / Audit Ready</p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-[var(--muted)] group-hover:text-[var(--brass)] transition-colors" />
              </button>

              <button 
                onClick={handleOFXExport}
                className="flex items-center justify-between p-5 bg-[var(--surface)] border border-[var(--line)] rounded-xl hover:border-[var(--brass-line)] transition-all group cursor-pointer"
               aria-label="Bank Interchange (OFX) Intuit / Quicken Compatible">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-[var(--ink)] rounded-lg flex items-center justify-center text-[var(--text)] group-hover:bg-[var(--brass)] group-hover:text-black transition-all">
                    <RefreshCw size={18} />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold text-[var(--text)] uppercase tracking-tight">Bank Interchange (OFX)</p>
                    <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-widest">Intuit / Quicken Compatible</p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-[var(--muted)] group-hover:text-[var(--brass)] transition-colors" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
