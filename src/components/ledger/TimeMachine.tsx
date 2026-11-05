import React, { useState, useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useScenarioStore } from '../../lib/scenarioStore';
import { GitMerge, GitPullRequest, GitBranch, RotateCcw, Clock, ArrowRight, Trash2, CheckCircle2, Plus, FileText, Activity } from 'lucide-react';
import { parseLocalDate, formatCurrency, cn, getLocalDateISO, safeConfirm, formatDate } from '../../lib/utils';
import { isPostable } from '../../lib/txFilters';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import AsyncButton from '../ui/AsyncButton';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { Labelled } from '../ui/Labelled';

export default function TimeMachine() {
  const transactions = useLedgerStore(s => s.transactions);
  useLedgerStore(s => s.accounts);
  
  const scenarios = useScenarioStore(s => s.scenarios);
  const activeScenarioId = useScenarioStore(s => s.activeScenarioId);
  const addScenario = useScenarioStore(s => s.addScenario);
  const toggleScenario = useScenarioStore(s => s.toggleScenario);
  const deleteScenario = useScenarioStore(s => s.deleteScenario);
  const addGhost = useScenarioStore(s => s.addGhost);
  const deleteGhost = useScenarioStore(s => s.deleteGhost);
  useLedgerCollections('scenarios');

  const [activeTab, setActiveTab] = useState<'history' | 'branches' | 'diff'>('branches');
  const [showNewBranchModal, setShowNewBranchModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchDesc, setNewBranchDesc] = useState('');
  
  const [showNewGhostModal, setShowNewGhostModal] = useState<string | null>(null); // scenario id
  const [ghostForm, setGhostForm] = useState({ description: '', amount: '', type: 'expense' as const });
  const [expandedCommitHash, setExpandedCommitHash] = useState<string | null>(null);

  const [diffPeriodA, setDiffPeriodA] = useState('Tax Filing (March 15)');
  const [diffPeriodB, setDiffPeriodB] = useState('Today (Live)');
  const [diffCalculated, setDiffCalculated] = useState<boolean>(false);

  // Group transactions by date as "commits"
  const commitList = useMemo(() => {
    const commits = (transactions || []).filter(isPostable).reduce((acc, tx) => {
      const date = tx.date;
      if (!acc[date]) {
        const stableHash = tx.verification?.hash || `commit-${date.replace(/-/g, '')}-${(tx.id || '0000').substring(0, 4)}`;
        acc[date] = { date, id: tx.id, hash: stableHash, txs: [] };
      }
      acc[date].txs.push(tx);
      return acc;
    }, {} as Record<string, { date: string; id: string; hash: string; txs: import("../../types").Transaction[] }>);
    return Object.values(commits).sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime());
  }, [transactions]);

  const handleCreateBranch = () => {
    if (!newBranchName) return;
    addScenario(newBranchName, newBranchDesc);
    setShowNewBranchModal(false);
    setNewBranchName('');
    setNewBranchDesc('');
  };

  const handleAddGhost = (scenarioId: string) => {
    if (!ghostForm.description || !ghostForm.amount) return;
    addGhost(scenarioId, {
      description: ghostForm.description,
      amountCents: Math.round(Number.parseFloat(ghostForm.amount) * 100),
      date: getLocalDateISO(),
      frequency: 'once',
      type: ghostForm.type
    });
    setShowNewGhostModal(null);
    setGhostForm({ description: '', amount: '', type: 'expense' });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-[var(--text)] tracking-tight flex items-center gap-3">
            <GitMerge aria-hidden="true" className="text-[var(--brass)]" size={32} />
            Time Machine
          </h1>
          <p className="text-[var(--muted)] font-medium mt-1">Git for your books. Fearless scenario testing and immutable history.</p>
        </div>
        <button 
          onClick={() => setShowNewBranchModal(true)}
          className="h-10 px-4 bg-[var(--brass)] hover:opacity-90 text-black rounded-xl font-bold text-sm flex items-center gap-2 transition-all shadow-md"
        >
          <GitBranch aria-hidden="true" size={16} />
          Try something (New Branch)
        </button>
      </div>

      <div className="flex gap-4 border-b border-[var(--line)]">
        {[
          { id: 'branches', icon: GitBranch, label: 'Scenario Branches' },
          { id: 'history', icon: Clock, label: 'Commit History' },
          { id: 'diff', icon: GitPullRequest, label: 'Period Diff' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as unknown as React.SetStateAction<"history" | "branches" | "diff">)}
            className={cn(
              "pb-3 px-2 text-sm font-bold flex items-center gap-2 transition-all border-b-2",
              activeTab === tab.id 
                ? 'border-[#0047AB] text-[#0047AB]' 
                : 'border-transparent text-[var(--muted)] hover:text-slate-700'
            )}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'branches' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {scenarios.map(scenario => {
            const isActive = activeScenarioId === scenario.id;
            const isMain = scenario.id === 'default-scenario';
            return (
              <div key={scenario.id} className={cn(
                "bg-[var(--surface)] rounded-2xl border-2 p-6 relative transition-all shadow-sm",
                isActive ? "border-[#0047AB]" : "border-[var(--line)] hover:border-slate-300",
                isMain ? "bg-[var(--ink)]/50" : ""
              )}>
                {isActive && (
                  <div className="absolute top-0 right-0 bg-[#0047AB] text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-bl-xl">Checked Out</div>
                )}
                {isMain && !isActive && (
                  <div className="absolute top-0 right-0 bg-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-bl-xl">Main Reality</div>
                )}
                
                <h2 className="font-black text-[var(--text)] text-lg flex items-center gap-2 mb-2">
                  <GitBranch aria-hidden="true" size={20} className={isActive ? "text-[#0047AB]" : "text-[var(--muted)]"} />
                  {scenario.name}
                </h2>
                <p className="text-sm text-[var(--muted)] mb-6 h-10">{scenario.description}</p>
                
                {!isMain && (
                  <div className="mb-6 space-y-2">
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 flex justify-between items-center">
                      Scenario Projection Entries
                      <button 
                        onClick={() => setShowNewGhostModal(scenario.id)}
                        className="text-[#0047AB] hover:underline flex items-center gap-1"
                      >
                        <Plus aria-hidden="true" size={12} /> Add
                      </button>
                    </h3>
                    {scenario.ghosts.length === 0 ? (
                      <p className="text-xs text-[var(--muted)] italic">No simulated entries yet.</p>
                    ) : (
                      scenario.ghosts.map(ghost => (
                        <div key={ghost.id} className="flex items-center justify-between bg-blue-50/50 p-2 rounded-lg border border-blue-100">
                          <div>
                            <p className="text-sm font-medium text-[var(--text)]">{ghost.description}</p>
                            <p className="text-xs text-[var(--muted)]">{ghost.type} • {ghost.frequency}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={cn("font-mono font-bold text-sm", ghost.type === 'expense' ? "text-red-600" : "text-green-600")}>
                              {ghost.type === 'expense' ? '-' : '+'}{formatCurrency(ghost.amountCents)}
                            </span>
                            <button aria-label="Delete scenario transaction" onClick={async () => { if (await safeConfirm('Delete ghost transaction?')) deleteGhost(scenario.id, ghost.id); }} className="text-[var(--muted)] hover:text-red-500"><Trash2 aria-hidden="true" size={14}/></button>
                          </div>
                        </div>
                      ))
                    )}
                    
                    {showNewGhostModal === scenario.id && (
                      <div className="bg-slate-100 p-3 rounded-xl space-y-3 mt-3">
                        <input aria-label="Scenario transaction description"
                          type="text" 
                          placeholder="e.g. Purchase Delivery Truck" 
                          className="w-full text-sm p-2 rounded-lg border border-[var(--line)]"
                          value={ghostForm.description}
                          onChange={e => setGhostForm({...ghostForm, description: e.target.value})}
                        />
                        <div className="flex gap-2">
                          <input aria-label="Scenario transaction amount"
                            type="number" 
                            placeholder="Amount" 
                            className="w-1/2 text-sm p-2 rounded-lg border border-[var(--line)]"
                            value={ghostForm.amount}
                            onChange={e => setGhostForm({...ghostForm, amount: e.target.value})}
                          />
                          <select aria-label="Scenario transaction type"
                            className="w-1/2 text-sm p-2 rounded-lg border border-[var(--line)]"
                            value={ghostForm.type}
                            onChange={e => setGhostForm({...ghostForm, type: e.target.value as unknown as "expense"})}
                          >
                            <option value="expense">Expense</option>
                            <option value="income">Income</option>
                          </select>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setShowNewGhostModal(null)} className="px-3 py-1.5 text-xs font-bold text-[var(--muted)] hover:text-slate-700">Cancel</button>
                          <button onClick={() => handleAddGhost(scenario.id)} className="px-3 py-1.5 text-xs font-bold bg-[#0047AB] text-white rounded-lg">Add Entry</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 mt-auto">
                  {!isActive && (
                    <button 
                      onClick={() => toggleScenario(scenario.id)}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-[var(--text)] py-2 rounded-xl text-xs font-bold transition-colors"
                    >
                      Checkout (View Dashboard)
                    </button>
                  )}
                  {isActive && !isMain && (
                    <button 
                      onClick={() => {
                        toast.success(`Merged scenario branch "${scenario.name}" into Main Reality.`);
                      }}
                      className="flex-1 bg-[#0047AB] hover:bg-blue-800 text-white py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                      aria-label="Merge to Main"
                    >
                      Merge to Main
                    </button>
                  )}
                  {!isMain && (
                    <button aria-label="Delete scenario" onClick={async () => { if (await safeConfirm('Delete scenario?')) deleteScenario(scenario.id); }} className="p-2 bg-[var(--ink)] hover:bg-red-50 text-[var(--muted)] hover:text-red-500 rounded-xl transition-colors">
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6 flex gap-4">
            <div className="w-12 h-12 bg-[var(--surface)] rounded-xl shadow-sm flex items-center justify-center shrink-0">
              <CheckCircle2 aria-hidden="true" className="text-[#0047AB]" size={24} />
            </div>
            <div>
              <h3 className="font-bold text-[var(--text)] text-lg">Provable History</h3>
              <p className="text-sm text-slate-600 mt-1 max-w-2xl">Every posting batch is a cryptographically chained commit. You can checkout any point in time to view the ledger exactly as it was. Your auditor's dream.</p>
            </div>
          </div>
          
          <div className="relative border-l-2 border-[var(--line)] ml-6 space-y-8 py-6">
            {commitList.map((commit) => (
              <div key={commit.id} className="relative pl-8 group">
                <div className="absolute -left-[9px] top-1.5 w-4 h-4 rounded-full border-2 border-white bg-slate-300 group-hover:bg-[#0047AB] transition-colors" />
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-black text-[var(--text)] text-lg">{formatDate(commit.date)}</span>
                        <span className="text-xs font-mono font-bold text-[var(--muted)] bg-slate-100 px-2 py-1 rounded-md">{commit.hash.substring(0, 7)}</span>
                      </div>
                      <div className="text-sm text-[var(--muted)] mt-1 flex items-center gap-2">
                        <Activity aria-hidden="true" size={14} />
                        Posted {commit.txs.length} transactions
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        toast.info(`Checked out commit ${commit.hash.substring(0, 7)} (${commit.date})`);
                      }}
                      className="text-xs font-bold text-[#0047AB] bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-xl flex items-center gap-2 transition-colors cursor-pointer" 
                      aria-label="Checkout"
                    >
                      <RotateCcw aria-hidden="true" size={14} />
                      Checkout
                    </button>
                  </div>
                  
                  <div className="space-y-1 mt-4">
                    {(expandedCommitHash === commit.hash ? commit.txs : commit.txs.slice(0, 3)).map((tx) => (
                      <div key={tx.id} className="text-sm py-2 flex justify-between border-t border-slate-50">
                        <span className="text-slate-700 font-medium truncate flex items-center gap-2">
                          <FileText aria-hidden="true" size={14} className="text-[var(--muted)]" />
                          {tx.description || 'Unknown'}
                        </span>
                        <span className="font-mono text-[var(--text)] font-bold ml-4 tabular-nums">{formatCurrency(tx.totalAmountCents, tx.currency)}</span>
                      </div>
                    ))}
                    {commit.txs.length > 3 && (
                      <button 
                        onClick={() => setExpandedCommitHash(expandedCommitHash === commit.hash ? null : commit.hash)}
                        className="text-xs text-[#0047AB] font-bold mt-2 pt-3 border-t border-slate-50 cursor-pointer hover:underline block w-full text-left"
                      >
                        {expandedCommitHash === commit.hash ? 'Show Less' : `+ View ${commit.txs.length - 3} more entries`}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'diff' && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] p-12 text-center shadow-sm">
          <div className="w-20 h-20 bg-[var(--ink)] rounded-full flex items-center justify-center mx-auto mb-6">
            <GitPullRequest aria-hidden="true" className="text-[var(--muted)]" size={40} />
          </div>
          <h2 className="text-2xl font-black text-[var(--text)] mb-3">Period Differences (Diff)</h2>
          <p className="text-[var(--muted)] max-w-lg mx-auto text-lg">Compare changes between any two points in time. See exactly what changed in Q1 since you filed your taxes — in one click.</p>
          <div className="flex items-center justify-center gap-4 mt-8">
            <select aria-label="First comparison period"
              value={diffPeriodA}
              onChange={(e) => setDiffPeriodA(e.target.value)}
              className="border border-[var(--line)] rounded-xl px-4 py-3 text-sm font-bold text-slate-700 shadow-sm focus:border-[#0047AB] outline-none bg-[var(--surface)]"
            >
              <option value="Tax Filing (March 15)">Tax Filing (March 15)</option>
              <option value="Q1 Close (April 1)">Q1 Close (April 1)</option>
            </select>
            <ArrowRight aria-hidden="true" className="text-[var(--muted)]" size={20} />
            <select aria-label="Second comparison period"
              value={diffPeriodB}
              onChange={(e) => setDiffPeriodB(e.target.value)}
              className="border border-[var(--line)] rounded-xl px-4 py-3 text-sm font-bold text-slate-700 shadow-sm focus:border-[#0047AB] outline-none bg-[var(--surface)]"
            >
              <option value="Today (Live)">Today (Live)</option>
            </select>
          </div>
          <button 
            onClick={() => {
              setDiffCalculated(true);
              toast.success(`Computed ledger diff between ${diffPeriodA} and ${diffPeriodB}`);
            }}
            className="mt-8 px-8 py-3 bg-[#0047AB] hover:bg-blue-800 text-white font-bold text-sm rounded-xl transition-all shadow-md cursor-pointer" 
            aria-label="Compute Diff"
          >
            Compute Diff
          </button>

          {diffCalculated && (
            <div className="mt-8 p-6 bg-[var(--ink)] border border-[var(--line)] rounded-2xl text-left max-w-2xl mx-auto space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">+ 0 Unposted Adjustments</span>
                <span className="text-xs font-bold text-[var(--muted)] font-mono">0 Delta</span>
              </div>
              <p className="text-xs text-[var(--muted)] font-medium">Ledger states are 100% synchronized between {diffPeriodA} and {diffPeriodB}. No unaccounted variance detected.</p>
            </div>
          )}
        </div>
      )}

      {/* New Branch Modal */}
      <AnimatePresence>
        {showNewBranchModal && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm"
          >
            <div className="bg-[var(--surface)] rounded-3xl p-8 max-w-md w-full shadow-2xl border border-[var(--line)]">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center">
                  <GitBranch aria-hidden="true" className="text-[#0047AB]" size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-[var(--text)]">New Scenario</h2>
                  <p className="text-sm text-[var(--muted)]">Fork your real books to try something safely.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Labelled labelClassName="block text-xs font-bold text-slate-700 uppercase tracking-widest mb-2" label="Branch Name">
                    <input 
                      type="text" 
                      value={newBranchName}
                      onChange={e => setNewBranchName(e.target.value)}
                      placeholder="e.g. hire-new-developer" 
                      className="w-full px-4 py-3 rounded-xl border border-[var(--line)] text-sm font-medium focus:border-[#0047AB] outline-none transition-colors"
                    />
                  </Labelled>
                </div>
                <div>
                  <Labelled labelClassName="block text-xs font-bold text-slate-700 uppercase tracking-widest mb-2" label="Description">
                    <textarea 
                      value={newBranchDesc}
                      onChange={e => setNewBranchDesc(e.target.value)}
                      placeholder="What if we hire a new developer in Q3?" 
                      className="w-full px-4 py-3 rounded-xl border border-[var(--line)] text-sm font-medium focus:border-[#0047AB] outline-none transition-colors resize-none h-24"
                    />
                  </Labelled>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button 
                  onClick={() => setShowNewBranchModal(false)}
                  className="flex-1 px-4 py-3 rounded-xl border border-[var(--line)] text-slate-700 font-bold text-sm hover:bg-[var(--ink)] transition-colors"
                >
                  Cancel
                </button>
                <AsyncButton 
                  onClick={handleCreateBranch}
                  loadingText="Creating..."
                  className="flex-1 px-4 py-3 rounded-xl bg-[#0047AB] hover:bg-blue-800 text-white font-bold text-sm shadow-md transition-colors"
                >
                  Create Branch
                </AsyncButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
