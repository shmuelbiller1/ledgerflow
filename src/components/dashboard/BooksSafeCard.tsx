import { useMemo } from 'react';
import { ChevronRight, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { getBackupHealth } from '../../lib/ledgerBackupHealth';
import { runDataChecks } from '../../lib/dataChecks';
import { booksSafety } from '../../lib/booksSafety';
import { getLocalDateISO } from '../../lib/utils';

/** EU-H2: "Your books are safe" on the overview — last backup, months closed, problems found, each with a link. Read-only. */
export default function BooksSafeCard() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const recurring = useLedgerStore(s => s.recurring);
  const goToPage = useUIStore(s => s.goToPage);
  const { loading } = useLedgerCollections('bills', 'invoices', 'recurring');
  const rows = useMemo(() => {
    if (!workspace) return [];
    const findings = runDataChecks({
      transactions: transactions || [], accounts: accounts || [], invoices: invoices || [], bills: bills || [], recurring: recurring || [],
      today: getLocalDateISO(), baseCurrency: workspace.currency || 'USD', dimensions: workspace.dimensions,
    });
    return booksSafety({ backup: getBackupHealth(workspace.id), lockDate: workspace.lockDate, findings });
  }, [workspace, transactions, accounts, invoices, bills, recurring]);
  if (loading || !workspace) return null;
  const allOk = rows.every(r => r.ok);
  return (
    <section aria-labelledby="books-safe-title" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <h2 id="books-safe-title" className="flex items-center gap-2 text-sm font-bold text-[var(--text)]">
        {allOk ? <ShieldCheck aria-hidden="true" size={16} className="text-[var(--pos)]" /> : <AlertTriangle aria-hidden="true" size={16} className="text-amber-600" />}
        {allOk ? 'Your books are safe' : 'Keeping your books safe'}
      </h2>
      <ul className="mt-2 divide-y divide-[var(--line)]">
        {rows.map(row => (
          <li key={row.id}>
            <button type="button" onClick={() => goToPage(row.page)} className="w-full flex items-center justify-between gap-3 min-h-11 py-2 text-left hover:bg-[var(--elevated)] rounded">
              <span className={`text-sm ${row.ok ? 'text-[var(--text)]' : 'font-semibold text-amber-700'}`}>{row.text}</span>
              <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-[var(--muted)]" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
