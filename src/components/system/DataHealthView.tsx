import React, { useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { getLocalDateISO } from '../../lib/utils';
import { DATA_CHECKS, runDataChecks, truncatedInputs } from '../../lib/dataChecks';
import type { CheckSeverity } from '../../lib/dataChecks';
import type { LedgerHealth } from '../../lib/ledgerHealth';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { LoadingState } from '../ui/LoadingState';
import BalanceBreakPanel from './BalanceBreakPanel';

/**
 * Data Health (launch step 8): runs every check in the registry (src/lib/dataChecks.ts) over the
 * loaded records, groups the findings by check with what to do about them, and opens each record
 * with one click (Z-32 record links).
 */

const SEVERITY: Record<CheckSeverity, { label: string; className: string }> = {
  high: { label: 'Fix now', className: 'text-[var(--neg)] border-[var(--neg)]' },
  medium: { label: 'Check soon', className: 'text-[var(--brass)] border-[var(--brass)]' },
  low: { label: 'Worth a look', className: 'text-[var(--muted)] border-[var(--line)]' },
};

/** CA-32: what the nightly check found last time (the whole ledger, on the server). */
function nightlyLine(health: LedgerHealth | undefined): string {
  const told = 'Owners and accountants are told about new serious problems.';
  if (!health?.checkedAt) return `The server also checks the whole ledger every night. ${told}`;
  const when = new Date(health.checkedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const { high, medium, low } = health.counts;
  const found = high + medium + low === 0 ? 'nothing to fix' : `${high} serious, ${medium} to look at, ${low} minor`;
  return `Last nightly check of the whole ledger: ${when}, ${found}. ${told}`;
}

export default function DataHealthView() {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const recurring = useLedgerStore(s => s.recurring);
  const inventory = useLedgerStore(s => s.inventory);
  const bankLines = useLedgerStore(s => s.bankLines);
  const payments = useLedgerStore(s => s.payments);
  const customers = useLedgerStore(s => s.customers);
  const truncatedCollections = useLedgerStore(s => s.truncatedCollections);
  const vendors = useLedgerStore(s => s.vendors);
  const { loading } = useLedgerCollections('bankLines', 'bills', 'inventory', 'invoices', 'recurring', 'payments');
  useLedgerCollections('customers', 'vendors');
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const baseCurrency = workspace?.currency || 'USD';
  const workspaceCountry = workspace?.taxProfiles?.books?.place?.country;
  const dimensions = workspace?.dimensions;
  const nightly = workspace?.ledgerHealth;
  const openRecord = useUIStore(s => s.openRecord);
  const [only, setOnly] = useState<string>('all');

  const findings = useMemo(() => runDataChecks({
    transactions: transactions || [], accounts: accounts || [], invoices: invoices || [], bills: bills || [],
    recurring: recurring || [], inventory: inventory || [], bankLines: bankLines || [], payments: payments || [],
    customers: customers || [], vendors: vendors || [], workspaceCountry,
    today: getLocalDateISO(), baseCurrency, dimensions,
    // EG-10: the browser reads the newest records only; totals over a cut collection are not compared
    truncated: truncatedInputs(truncatedCollections),
  }), [truncatedCollections, transactions, accounts, invoices, bills, recurring, inventory, bankLines, payments, customers, vendors, workspaceCountry, baseCurrency, dimensions]);

  const byCheck = useMemo(() => DATA_CHECKS.map(check => ({ check, findings: findings.filter(f => f.checkId === check.id) })), [findings]);
  const shown = byCheck.filter(g => g.findings.length > 0 && (only === 'all' || g.check.id === only));
  const count = (severity: CheckSeverity) => findings.filter(f => f.severity === severity).length;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl mx-auto text-[var(--text)]">
      <div className="flex items-center gap-4 pb-4 border-b border-[var(--line)]">
        <Activity size={24} className="text-[var(--brass)]" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">Data health</h1>
          <p className="text-xs text-[var(--muted)]">{DATA_CHECKS.length} checks on your books: entries that don't balance, duplicate numbers, missing accounts, wrong dates and more. Updated as you work.</p>
          <p className="text-xs text-[var(--muted)] mt-1">{nightlyLine(nightly)}</p>
        </div>
      </div>

      <BalanceBreakPanel />

      <div className="grid grid-cols-3 gap-4" role="status">
        {(['high', 'medium', 'low'] as CheckSeverity[]).map(s => (
          <div key={s} className={`p-4 rounded-xl border ${SEVERITY[s].className}`}>
            <p className="text-xs font-semibold">{SEVERITY[s].label}</p>
            <p className="text-2xl font-bold">{count(s)}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        <button type="button" aria-pressed={only === 'all'} onClick={() => setOnly('all')} className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${only === 'all' ? 'border-[var(--brass)]' : 'border-[var(--line)] text-[var(--muted)]'}`}>All ({findings.length})</button>
        {byCheck.filter(g => g.findings.length > 0).map(g => (
          <button key={g.check.id} type="button" aria-pressed={only === g.check.id} onClick={() => setOnly(g.check.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${only === g.check.id ? 'border-[var(--brass)]' : 'border-[var(--line)] text-[var(--muted)]'}`}>
            {g.check.label} ({g.findings.length})
          </button>
        ))}
      </div>

      {loading ? <LoadingState what="your records to check" /> : findings.length === 0 ? (
        <div className="p-12 text-center border border-[var(--line)] rounded-2xl">
          <CheckCircle2 size={40} className="text-[var(--pos)] mx-auto mb-3" aria-hidden="true" />
          <h2 className="text-base font-bold">Everything checks out</h2>
          <p className="text-xs text-[var(--muted)] mt-1">All {DATA_CHECKS.length} checks passed on the records loaded.</p>
        </div>
      ) : shown.map(({ check, findings: list }) => (
        <section key={check.id} className="space-y-2" aria-labelledby={`check-${check.id}`}>
          <h2 id={`check-${check.id}`} className="text-sm font-bold">{check.label}</h2>
          <p className="text-xs text-[var(--muted)]">{check.remedy}</p>
          <ul className="space-y-2">
            {list.slice(0, 50).map(f => (
              <li key={f.id} className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${SEVERITY[f.severity].className}`}>
                <div className="flex items-start gap-3 text-[var(--text)]">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold">{f.title}</p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">{f.description}</p>
                  </div>
                </div>
                {f.record && (
                  <button type="button" onClick={() => openRecord(f.record!)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--line)] text-[var(--text)] inline-flex items-center gap-1 shrink-0">
                    Open <ArrowRight size={12} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
            {list.length > 50 && <li className="text-xs text-[var(--muted)]">and {list.length - 50} more</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}
