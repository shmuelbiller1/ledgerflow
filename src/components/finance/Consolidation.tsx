import type { TransactionLine } from '../../types';
import React, { useState, useMemo } from 'react';
import { Layers, Download, BarChart3, TrendingUp, Globe, ShieldCheck, AlertTriangle } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { IntercompanyEliminationEngine } from '../../lib/intercompanyElimination';
import { isIncomeAccount } from '../../lib/accountUtils';
import { buildSelfProvingEliminations } from '../../lib/selfBalancingDimensions';
import { labelRoleFindings } from '../../lib/labelRoles';
import { computeSharedTransactionIdentity } from '../../lib/algorithms/shared-transaction-identity';

export default function Consolidation() {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const currentWorkspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaceId = currentWorkspace?.id || 'default';
  
  const summary = useMemo(() => {
    const incomeAccountIds = new Set(accounts.filter(a => isIncomeAccount(a)).map(a => a.id));
    const expenseAccountIds = new Set(accounts.filter(a => a.type === 'expense').map(a => a.id));

    const isIncomeLine = (l: TransactionLine) => incomeAccountIds.has(l.accountId) || l.category?.toLowerCase().includes('income') || l.category?.toLowerCase().includes('revenue');
    const isExpenseLine = (l: TransactionLine) => expenseAccountIds.has(l.accountId) || l.category?.toLowerCase().includes('expense') || l.category?.toLowerCase().includes('cogs');

    return IntercompanyEliminationEngine.generateConsolidatedSummary(transactions, isIncomeLine as (line: TransactionLine) => boolean, isExpenseLine as (line: TransactionLine) => boolean);
  }, [transactions, accounts]);

  const selfProvingReport = useMemo(
    () => buildSelfProvingEliminations([{ workspaceId, transactions }]),
    [workspaceId, transactions],
  );
  const sharedIdentity = useMemo(
    () => computeSharedTransactionIdentity(transactions),
    [transactions],
  );
  const dimensionFindings = useMemo(
    () => labelRoleFindings(transactions, currentWorkspace?.dimensions, accounts),
    [transactions, currentWorkspace?.dimensions, accounts],
  );

  const [activeTab, setActiveTab] = useState<'matrix' | 'adjustments'>('matrix');

  return (
    <div className="h-full flex flex-col bg-[var(--ink)] text-[var(--text)]">
      <div className="px-4 sm:px-8 py-6 bg-[var(--surface)] border-b border-[var(--line)] text-[var(--text)] flex flex-col sm:flex-row justify-between items-start gap-4 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3 text-[var(--text)]">
            <Layers className="w-6 h-6 text-[var(--brass)]" />
            Multi-Entity Consolidation
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Dynamic coordinate-based sub-ledgers with automatic intercompany transfer elimination.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="bg-slate-800/80 min-h-11 px-3 py-1.5 rounded-xl border border-slate-700 flex items-center gap-2 text-xs font-mono text-slate-300">
            <Globe className="w-3.5 h-3.5 text-emerald-400" />
            <span>Companies: {summary.worldStatements.length}</span>
          </div>
          <div className="min-w-0 space-y-1"><button className="disabled:cursor-not-allowed disabled:opacity-50 min-h-11 px-4 bg-purple-500 text-white rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-purple-400 transition-colors" type="button" disabled aria-describedby="consolidation-export-help" title="Export is unavailable until complete consolidated history is supported." aria-label="Export Report">
            <Download className="w-4 h-4" /> Export Report
          </button>
            <p id="consolidation-export-help" className="text-xs text-[var(--muted)] max-w-sm">Export is unavailable until complete consolidated history is supported.</p></div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-8">
        <div className="flex flex-wrap p-1 bg-[var(--surface)] border border-[var(--line)] rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200 mb-6 w-full sm:w-max">
          {[
            { id: 'matrix', label: 'Consolidated Matrix', icon: BarChart3 },
            { id: 'adjustments', label: 'Top-Level Adjustments', icon: TrendingUp }
          ].map(tab => (
             <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as unknown as React.SetStateAction<"matrix" | "adjustments">)}
                className={cn(
                   "min-h-11 px-4 sm:px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all",
                   activeTab === tab.id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-[var(--ink)]"
                )}
             >
                <tab.icon className="w-4 h-4" /> {tab.label}
             </button>
          ))}
        </div>

        {activeTab === 'matrix' && (
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 bg-[var(--ink)] border-b border-[var(--line)] text-xs font-bold text-slate-700 uppercase tracking-wider flex flex-wrap justify-between items-center gap-2">
              <span>Company sub-ledgers</span>
              <span className="text-rose-600 font-mono text-[11px] tabular-nums">Intercompany Eliminations: {formatCurrency(summary.eliminatedTransferCents)}</span>
            </div>
            
            <div className="overflow-x-auto">
            <div className="divide-y divide-slate-200 min-w-[700px]">
              <div className="grid grid-cols-12 p-4 bg-slate-100/80 text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
                <div className="col-span-4">Company / Sub-ledger</div>
                <div className="col-span-2 text-right">Transactions</div>
                <div className="col-span-2 text-right">Total Revenue</div>
                <div className="col-span-2 text-right">Total Expenses</div>
                <div className="col-span-2 text-right text-indigo-600">Net Income</div>
              </div>

              {summary.worldStatements.map(stmt => (
                <div key={stmt.world} className="grid grid-cols-12 p-4 items-center hover:bg-[var(--ink)] transition-colors font-mono text-sm">
                  <div className="col-span-4 font-bold font-sans text-[var(--text)] capitalize flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                    {stmt.world}
                  </div>
                  <div className="col-span-2 text-right text-[var(--muted)]">{stmt.transactionCount}</div>
                  <div className="col-span-2 text-right text-emerald-600 tabular-nums">{formatCurrency(stmt.totalRevenueCents)}</div>
                  <div className="col-span-2 text-right text-slate-700 tabular-nums">{formatCurrency(stmt.totalExpenseCents)}</div>
                  <div className={cn("col-span-2 text-right font-bold", stmt.netIncomeCents >= 0 ? "text-indigo-600" : "text-rose-600", "tabular-nums")}>
                    {formatCurrency(stmt.netIncomeCents)}
                  </div>
                </div>
              ))}

              <div className="grid grid-cols-12 p-4 items-center bg-slate-900 text-white font-mono text-sm font-bold">
                <div className="col-span-4 font-sans uppercase tracking-wider text-xs">Consolidated Group Total</div>
                <div className="col-span-2 text-right text-[var(--muted)]">{transactions.length}</div>
                <div className="col-span-2 text-right text-emerald-400 tabular-nums">{formatCurrency(summary.consolidatedRevenueCents)}</div>
                <div className="col-span-2 text-right text-slate-300 tabular-nums">{formatCurrency(summary.consolidatedExpenseCents)}</div>
                <div className={cn("col-span-2 text-right font-bold text-base", summary.consolidatedNetIncomeCents >= 0 ? "text-purple-300" : "text-rose-300", "tabular-nums")}>
                  {formatCurrency(summary.consolidatedNetIncomeCents)}
                </div>
              </div>
            </div>
            </div>
          </div>
        )}

        {activeTab === 'adjustments' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-5 bg-[var(--surface)] border border-[var(--line)] rounded-2xl">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-[var(--muted)]">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                  Self-Proving Eliminations
                </div>
                <p className="text-2xl font-black mt-2 text-[var(--text)]">
                  {selfProvingReport.selfProving ? 'Balanced (0 discrepancy)' : `${selfProvingReport.discrepancyCount} discrepancy`}
                </p>
                <p className="text-xs text-[var(--muted)] mt-1">
                  {selfProvingReport.matchedCount} matched Due From / Due To pairs · {formatCurrency(selfProvingReport.totalEliminatedCents)} eliminated
                </p>
              </div>
              <div className="p-5 bg-[var(--surface)] border border-[var(--line)] rounded-2xl">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-[var(--muted)]">
                  <Globe className="w-4 h-4 text-indigo-500" aria-hidden="true" />
                  Bilateral Identity Hashes
                </div>
                <p className="text-2xl font-black mt-2 text-[var(--text)]">
                  {sharedIdentity.totalSharedCount}
                </p>
                <p className="text-xs text-[var(--muted)] mt-1">
                  SHA-256 dual-perspective intercompany records
                </p>
              </div>
              <div className="p-5 bg-[var(--surface)] border border-[var(--line)] rounded-2xl">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-[var(--muted)]">
                  {dimensionFindings.length === 0 ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
                  )}
                  Self-Balancing Dimensions
                </div>
                <p className="text-2xl font-black mt-2 text-[var(--text)]">
                  {dimensionFindings.length === 0 ? 'All balanced' : `${dimensionFindings.length} open`}
                </p>
                <p className="text-xs text-[var(--muted)] mt-1">
                  Each self-balancing fund, property, or entity nets to zero
                </p>
              </div>
            </div>

            {sharedIdentity.pairs.length > 0 && (
              <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
                <h2 className="text-sm font-bold text-[var(--text)] mb-3">Shared-Identity Intercompany Ledger</h2>
                <div className="space-y-2 text-xs font-mono">
                  {sharedIdentity.pairs.slice(0, 8).map(pair => (
                    <div key={pair.txId} className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--ink)] border border-[var(--line)]">
                      <span className="font-sans font-semibold text-[var(--text)]">{pair.sourceEntity} → {pair.targetEntity}</span>
                      <span className="text-[var(--muted)]">{pair.hashSignature}</span>
                      <span className="font-bold text-emerald-600">{formatCurrency(pair.amountCents)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
