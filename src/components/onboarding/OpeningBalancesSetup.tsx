import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { isOpeningBalanceEquity, openingBalanceAccounts, openingEntry } from '../../lib/openingBalances';
import { formatCurrency, getLocalDateISO, monthBoundsISO } from '../../lib/utils';
import { describeError } from '../../lib/errorRemedies';
import { uiLanguageNow } from '../../lib/i18n/uiLanguageNow';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import { failed, identityScope, ok } from '../../lib/serverAction';
import { BRAND_NAME } from '../../config/brand';
import { runCommand } from '../../lib/runCommand';
import { RowTable } from '../ui/RowTable';

/** Existing opening-entry preview/API, moved out of first-run setup; no posting rules change. */
export default function OpeningBalancesSetup({ onClose }: { onClose: () => void }) {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
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
  const currency = workspace?.currency || 'USD';
  const balances = eligible.map(a => ({ accountId: a.id, amountCents: TruthEngine.parseAmountToCentsOrZero(amounts[a.id] || '0', currency) }));
  const preview = (() => { try { return equity ? openingEntry(accounts, balances, equity) : null; } catch { return null; } })();
  const money = (cents: number) => formatCurrency(cents, currency);
  if (!workspace || (role !== 'owner' && role !== 'accountant')) return null;
  const recordBalances = async () => {
    if (pending.current) return failed('Opening balances are already being recorded');
    pending.current = true;
    const scope = identityScope(() => useAuthStore.getState().user?.uid, () => useAuthStore.getState().currentWorkspaceId);
    const isCurrent = () => live.current && scope.isCurrent();
    setBusy(true);
    try {
      if (!isCurrent()) return failed('The workspace or signed-in account changed');
      const result = await runCommand<{ debitsCents?: number }>({
        path: `/api/v1/workspaces/${encodeURIComponent(workspace.id)}/opening-balances`,
        method: 'POST',
        body: { date: startDate, balances: balances.filter(b => b.amountCents !== 0) },
      }) ?? {};
      if (!isCurrent()) return failed('The workspace or signed-in account changed');
      setPosted(result.debitsCents || 0);
      toast.success('Opening balances recorded');
      const store = useAuthStore.getState();
      store.setWorkspaces(store.workspaces.map(w => w.id === workspace.id ? { ...w, openingBalanceDate: startDate } : w));
      return ok(undefined);
    } catch (err) {
      const described = describeError(err, 'update', uiLanguageNow());
      if (isCurrent()) toast.error(described.title, { description: described.remedy });
      return failed(err);
    } finally { pending.current = false; if (isCurrent()) setBusy(false); }
  };
  const field = 'w-full min-h-11 px-3 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-sm';
  if (posted !== null) return <section className="space-y-3" aria-label="Opening balances recorded"><p>Opening balances recorded on {startDate}: debits and credits are both {money(posted)}.</p><button className="btn-tonal min-h-11" onClick={onClose}>Done</button></section>;
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
              <RowTable
                rowHeaderColumn={false}
                rowClassName="border-t border-[var(--line)]"
                caption={(<>Opening balance per account</>)}
                rows={eligible}
                rowKey={a => a.id}
                tableClassName="w-full text-sm"
                headRowClassName="text-left text-xs text-[var(--muted)]"
                bodyClassName=""
                columns={[
                  { header: "Account", className: "py-1.5", headClassName: "py-1", cell: (a) => <label htmlFor={`ob-${a.id}`}>{a.code ? `${a.code} · ` : ''}{a.name}</label> },
                  { header: (<>Balance ({currency})</>), align: 'right', className: "py-1.5", headClassName: "py-1", cell: (a) => <input id={`ob-${a.id}`} type="number" step="0.01" inputMode="decimal" className={`${field} w-36 text-right font-mono`}
                          value={amounts[a.id] || ''} placeholder="0.00" onChange={e => setAmounts({ ...amounts, [a.id]: e.target.value })} /> },
                ]}
              />
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
