import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { isOpeningBalanceEquity, openingBalanceAccounts, openingEntry } from '../../lib/openingBalances';
import { formatCurrency, getLocalDateISO, monthBoundsISO } from '../../lib/utils';
import { describeError } from '../../lib/errorRemedies';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import { failed, identityScope, ok } from '../../lib/serverAction';
import { BRAND_NAME } from '../../config/brand';

/** Existing opening-entry preview/API, moved out of first-run setup; no posting rules change. */
export default function OpeningBalancesSetup({ onClose }: { onClose: () => void }) {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const user = useAuthStore(s => s.user);
  const role = useCurrentRole();
  const accounts = useLedgerStore(s => s.accounts);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [startDate, setStartDate] = useState(() => monthBoundsISO(getLocalDateISO()).start);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [posted, setPosted] = useState<number | null>(null);
  const eligible = useMemo(() => openingBalanceAccounts(accounts), [accounts]);
  const equity = accounts.find(a => isOpeningBalanceEquity(a) && !a.isArchived);
  const balances = eligible.map(a => ({ accountId: a.id, amountCents: TruthEngine.parseAmountToCentsOrZero(amounts[a.id] || '0') }));
  const preview = (() => { try { return equity ? openingEntry(accounts, balances, equity) : null; } catch { return null; } })();
  const currency = workspace?.currency || 'USD';
  const money = (cents: number) => formatCurrency(cents, currency);
  if (!workspace || (role !== 'owner' && role !== 'accountant')) return null;
  const recordBalances = async () => {
    if (pending.current) return failed('Opening balances are already being recorded');
    pending.current = true;
    const scope = identityScope(() => useAuthStore.getState().user?.uid, () => useAuthStore.getState().currentWorkspaceId);
    const isCurrent = () => live.current && scope.isCurrent();
    setBusy(true);
    try {
      const token = await user?.getIdToken();
      if (!isCurrent()) return failed('The workspace or signed-in account changed');
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/opening-balances`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date: startDate, balances: balances.filter(b => b.amountCents !== 0) }),
      });
      const result = await res.json().catch(() => ({}));
      if (!isCurrent()) return failed('The workspace or signed-in account changed');
      if (!res.ok) throw new Error(result.message || result.error || 'Could not record opening balances');
      setPosted(result.debitsCents || 0);
      toast.success('Opening balances recorded');
      const store = useAuthStore.getState();
      store.setWorkspaces(store.workspaces.map(w => w.id === workspace.id ? { ...w, openingBalanceDate: startDate } : w));
      return ok(undefined);
    } catch (err) {
      const described = describeError(err, 'update');
      if (isCurrent()) toast.error(described.title, { description: described.remedy });
      return failed(err);
    } finally { pending.current = false; if (isCurrent()) setBusy(false); }
  };
  const field = 'w-full min-h-11 px-3 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-sm';
  if (posted !== null) return <section className="space-y-3" aria-label="Opening balances recorded"><p>Opening balances recorded on {startDate}: debits and credits are both {money(posted)}.</p><button className="btn-primary min-h-11 bg-[var(--text)] text-[var(--surface)]" onClick={onClose}>Done</button></section>;
  return (
          <section className="space-y-4" aria-labelledby="setup-opening">
            <h2 id="setup-opening" className="text-lg font-semibold">Opening balances</h2>
            <p className="text-sm text-[var(--muted)]">
              What the business had and owed on the day you start using {BRAND_NAME} (from your last balance sheet or bank statements).
              Customers&apos; and vendors&apos; unpaid amounts are added as invoices and bills instead, so you know who owes what.
            </p>
            <div className="space-y-1">
              <label htmlFor="setup-start" className="micro-label">Start date</label>
              <input id="setup-start" type="date" className={`${field} sm:w-48`} value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            {!equity ? (
              <p className="text-sm text-[var(--neg)]">Add an &quot;Opening Balance Equity&quot; account to the chart of accounts first, or start from zero.</p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Opening balance per account</caption>
                <thead>
                  <tr className="text-left text-xs text-[var(--muted)]"><th scope="col" className="py-1">Account</th><th scope="col" className="py-1 text-right">Balance ({currency})</th></tr>
                </thead>
                <tbody>
                  {eligible.map(a => (
                    <tr key={a.id} className="border-t border-[var(--line)]">
                      <td className="py-1.5"><label htmlFor={`ob-${a.id}`}>{a.code ? `${a.code} · ` : ''}{a.name}</label></td>
                      <td className="py-1.5 text-right">
                        <input id={`ob-${a.id}`} type="number" step="0.01" inputMode="decimal" className={`${field} w-36 text-right font-mono`}
                          value={amounts[a.id] || ''} placeholder="0.00" onChange={e => setAmounts({ ...amounts, [a.id]: e.target.value })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {preview && preview.lines.length > 0 && (
              <p className="text-sm tabular-nums" aria-live="polite">
                Debits {money(preview.debitsCents)} = credits {money(preview.creditsCents)}.{' '}
                {preview.equityCents !== 0 && <>{money(Math.abs(preview.equityCents))} goes to {equity?.name} {preview.equityCents > 0 ? '(what the business is worth)' : '(it owes more than it has)'}.</>}
              </p>
            )}
            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" className="btn-tonal min-h-11" onClick={onClose} disabled={busy}>Cancel</button>
              <div className="flex gap-2">
                <button type="button" className="btn-primary min-h-11 bg-[var(--text)] text-[var(--surface)]" onClick={recordBalances} disabled={busy || !equity || !preview || preview.lines.length === 0}>
                  {busy ? 'Recording…' : 'Record opening balances'}
                </button>
              </div>
            </div>
          </section>
  );
}
