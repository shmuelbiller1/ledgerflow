/**
 * Petty cash (A-3, K-31, AI #3): the cash box and the three things it posts.
 *
 * The box is one of the workspace's own cash-type accounts — there is no petty cash collection
 * and no new table; "cash in the box" is what the ledger says that account holds. Spending,
 * topping up from a bank and a count all go through `POST /api/v1/transactions`, the same route
 * every posting screen uses, so the server validates the entry and the period lock and the role
 * apply (`src/lib/pettyCash.ts` holds the pure maths and the refusals in plain words). The screen
 * never invents an account: the pickers list the workspace's own chart and an action is refused
 * when the right account is missing. Which account is the box (and where a count difference goes)
 * is a browser preference per workspace, like the dashboard layout — it is not money.
 *
 * Viewer role: can read everything, posts nothing.
 */
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowDownToLine, ClipboardCheck, ReceiptText, Wallet } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { getIdToken } from '../../firebase';
import { cn, formatCurrency, getLocalDateISO, isAmountText, parseAmountToCents } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';
import {
  boxSentence,
  countProblem,
  createPettyCashCountEntry,
  createPettyCashSpendEntry,
  createPettyCashTopUpEntry,
  overShortChoices,
  pettyCashBalanceCents,
  pettyCashBoxChoices,
  pettyCashCategoryChoices,
  pettyCashMovements,
  spendProblem,
  topUpProblem,
} from '../../lib/pettyCash';
import type { ChartAccount, Transaction } from '../../types';
import { useBalanceEntries } from '../../hooks/useBalanceEntries';

const inputClass = 'w-full p-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]';
const labelClass = 'block text-xs font-semibold text-[var(--muted)] mb-1';
const buttonClass = 'px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--surface)] text-sm font-bold disabled:opacity-50';

const accountLabel = (a: ChartAccount) => (a.code ? `${a.code} · ${a.name}` : a.name);

/** Which account is the box and where a count difference goes — a browser note, not money. */
interface BoxPreference {
  boxAccountId?: string;
  overShortAccountId?: string;
}

const preferenceKey = (workspaceId: string) => `lf_petty_cash_${workspaceId}`;

function readPreference(workspaceId: string): BoxPreference {
  try {
    return JSON.parse(localStorage.getItem(preferenceKey(workspaceId)) || '{}') as BoxPreference;
  } catch {
    return {};
  }
}

function writePreference(workspaceId: string, preference: BoxPreference) {
  try {
    localStorage.setItem(preferenceKey(workspaceId), JSON.stringify(preference));
  } catch {
    // a full or blocked localStorage only loses the convenience of remembering the pick
  }
}

/**
 * Post one entry through the ordinary server route. Nothing is written when the server refuses
 * (a locked period, a balance that is off, a missing account), and the refusal is thrown in the
 * server's own words.
 */
async function postEntry(transaction: Partial<Transaction>): Promise<string> {
  const id = `tx_petty_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const token = await getIdToken();
  const res = await fetch('/api/v1/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-operation-id': id },
    body: JSON.stringify({
      transaction: {
        ...transaction,
        id,
        isCleared: false,
        schemaVersion: '1.1',
        createdAt: new Date().toISOString(),
      },
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(body.message || body.error || `The entry was refused (HTTP ${res.status}).`);
  }
  return id;
}

export default function PettyCashView() {
  // transactions and accounts are core collections: they load when the workspace opens
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  const role = useCurrentRole();
  const getCurrentWorkspace = useAuthStore(s => s.getCurrentWorkspace);
  const workspace = getCurrentWorkspace();
  const workspaceId = workspace?.id || '';
  const currency = workspace?.currency || 'USD';
  const money = (cents: number) => formatCurrency(cents, currency);
  const canWrite = role !== 'viewer';

  // the memos depend on the stored references themselves (a fresh `|| []` would rebuild them)
  const boxes = useMemo(() => pettyCashBoxChoices(accounts || []), [accounts]);
  const categories = useMemo(() => pettyCashCategoryChoices(accounts || []), [accounts]);
  const overShortAccounts = useMemo(() => overShortChoices(accounts || []), [accounts]);
  const chart = accounts || [];
  const ledger = transactions || [];

  const [preference, setPreference] = useState<BoxPreference>(() => readPreference(workspaceId));
  const boxAccountId = boxes.some(a => a.id === preference.boxAccountId) ? preference.boxAccountId || '' : '';
  const box = chart.find(a => a.id === boxAccountId);

  const today = getLocalDateISO();
  const [spend, setSpend] = useState({ amount: '', categoryAccountId: '', note: '', receipt: '', date: today });
  const [topUp, setTopUp] = useState({ amount: '', bankAccountId: '', date: today });
  const [count, setCount] = useState({ counted: '', date: today });
  const [refusals, setRefusals] = useState<Record<string, string | null>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // L-123 step 3c: the box's balance reads the server's sum through the oldest loaded day (the movements stay the loaded entries)
  const { entries: balanceLedger } = useBalanceEntries(ledger, undefined, workspaceId || undefined);
  const balance = box ? pettyCashBalanceCents(box.id, balanceLedger) : 0;
  const movements = useMemo(
    () => (boxAccountId ? pettyCashMovements(boxAccountId, transactions || []).slice(0, 20) : []),
    [boxAccountId, transactions],
  );

  const remember = (patch: BoxPreference) => {
    const next = { ...preference, ...patch };
    setPreference(next);
    if (workspaceId) writePreference(workspaceId, next);
  };

  const refuse = (form: string, problem: string | null) => setRefusals(current => ({ ...current, [form]: problem }));

  const spendDraft = {
    boxAccountId,
    categoryAccountId: spend.categoryAccountId,
    amountCents: spend.amount.trim() && isAmountText(spend.amount, { complete: true }) ? parseAmountToCents(spend.amount) : 0,
    date: spend.date,
    note: spend.note,
    receipt: spend.receipt,
  };
  const topUpDraft = {
    boxAccountId,
    bankAccountId: topUp.bankAccountId,
    amountCents: topUp.amount.trim() && isAmountText(topUp.amount, { complete: true }) ? parseAmountToCents(topUp.amount) : 0,
    date: topUp.date,
  };
  // a typo is no count: NaN is refused by countProblem, where 0 would record the whole balance as short
  const countedCents = count.counted.trim() && isAmountText(count.counted, { complete: true }) ? parseAmountToCents(count.counted) : Number.NaN;
  const countDraft = {
    boxAccountId,
    overShortAccountId: overShortAccounts.some(a => a.id === preference.overShortAccountId) ? preference.overShortAccountId || '' : '',
    countedCents,
    date: count.date,
  };
  const countDiff = Number.isInteger(countedCents) && box ? countedCents - balance : null;

  const recordSpend = async () => {
    const problem = spendProblem(spendDraft, chart);
    if (problem) { refuse('spend', problem); return; }
    const category = chart.find(a => a.id === spendDraft.categoryAccountId);
    if (!box || !category) return;
    setBusy(true);
    try {
      await postEntry(createPettyCashSpendEntry({
        workspaceId, uid: workspace?.uid, currency, draft: spendDraft, box, category,
      }));
      const said = `${money(spendDraft.amountCents)} spent from ${box.name} on ${category.name}.`;
      setNotice(said);
      toast.success(said);
      setSpend(current => ({ ...current, amount: '', note: '', receipt: '' }));
      refuse('spend', null);
    } catch (error) {
      refuse('spend', error instanceof Error ? error.message : 'The entry was refused.');
    } finally {
      setBusy(false);
    }
  };

  const recordTopUp = async () => {
    const problem = topUpProblem(topUpDraft, chart);
    if (problem) { refuse('top-up', problem); return; }
    const bank = chart.find(a => a.id === topUpDraft.bankAccountId);
    if (!box || !bank) return;
    setBusy(true);
    try {
      await postEntry(createPettyCashTopUpEntry({
        workspaceId, uid: workspace?.uid, currency, draft: topUpDraft, box, bank,
      }));
      const said = `${money(topUpDraft.amountCents)} moved from ${bank.name} into ${box.name}.`;
      setNotice(said);
      toast.success(said);
      setTopUp(current => ({ ...current, amount: '' }));
      refuse('top-up', null);
    } catch (error) {
      refuse('top-up', error instanceof Error ? error.message : 'The entry was refused.');
    } finally {
      setBusy(false);
    }
  };

  const recordCount = async () => {
    const problem = countProblem(countDraft, chart);
    if (problem) { refuse('count', problem); return; }
    const overShort = chart.find(a => a.id === countDraft.overShortAccountId);
    if (!box || !overShort) return;
    const entry = createPettyCashCountEntry({
      workspaceId, uid: workspace?.uid, currency, draft: countDraft, box, overShort, bookCents: balance, money,
    });
    if (!entry) {
      const said = 'The count agrees with the books — nothing to post.';
      setNotice(said);
      toast.success(said);
      refuse('count', null);
      return;
    }
    setBusy(true);
    try {
      await postEntry(entry);
      const diff = countDraft.countedCents - balance;
      const said = `Count recorded: ${money(Math.abs(diff))} ${diff < 0 ? 'short, booked to' : 'over, booked to'} ${overShort.name}.`;
      setNotice(said);
      toast.success(said);
      setCount(current => ({ ...current, counted: '' }));
      refuse('count', null);
    } catch (error) {
      refuse('count', error instanceof Error ? error.message : 'The entry was refused.');
    } finally {
      setBusy(false);
    }
  };

  const heading = (
    <h1 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
      <Wallet className="w-5 h-5 text-[var(--brass)]" aria-hidden="true" /> Petty cash
    </h1>
  );

  if (!boxes.length) {
    return (
      <div className="h-full overflow-auto p-6 md:p-8 space-y-4" id="petty-cash-view">
        {/* every screen has its page heading, the empty one too */}
        <div className="max-w-5xl mx-auto">{heading}</div>
        <div className="max-w-5xl mx-auto">
          <EmptyState
            title="No cash account for a petty cash box"
            description="A petty cash box is one of this workspace's own cash-type bank accounts. Add one in the chart of accounts and choose it here — LedgerFlow does not invent accounts."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6 md:p-8" id="petty-cash-view">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            {heading}
            <p className="text-sm text-[var(--muted)] mt-1">
              The box is one of this workspace's own cash accounts. Spending, top-ups and counts post ordinary balanced entries, so the period lock applies.
            </p>
          </div>
          <div className="min-w-[16rem]">
            <label htmlFor="petty-cash-box" className={labelClass}>Petty cash account</label>
            <select
              id="petty-cash-box"
              value={boxAccountId}
              onChange={e => remember({ boxAccountId: e.target.value || undefined })}
              className={inputClass}
            >
              <option value="">Choose the cash account that is the box…</option>
              {boxes.map(a => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
            </select>
          </div>
        </div>

        {!box && (
          <EmptyState
            title="Choose the box"
            description="Pick which cash account is the petty cash box. Its balance by the books, its movements and the three actions appear here."
          />
        )}

        {box && (
          <>
            <section aria-labelledby="petty-cash-balance" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
              <h2 id="petty-cash-balance" className="text-sm font-semibold text-[var(--muted)]">Cash in the box, by the books</h2>
              <p className="text-3xl font-bold tabular-nums text-[var(--text)] mt-1">{money(balance)}</p>
              <p className="text-sm text-[var(--muted)] mt-1">{boxSentence(box, balance, money)} A count below settles any difference with the drawer.</p>
            </section>

            {notice && <p role="status" className="text-sm text-[var(--text)]">{notice}</p>}

            {canWrite && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <section aria-labelledby="petty-cash-spend" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-3">
                  <h2 id="petty-cash-spend" className="text-base font-semibold text-[var(--text)] flex items-center gap-2">
                    <ReceiptText className="w-4 h-4 text-[var(--brass)]" aria-hidden="true" /> Spend from petty cash
                  </h2>
                  {!categories.length && (
                    <p role="alert" className="text-sm text-amber-700 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5" aria-hidden="true" />
                      <span>This workspace has no expense account to book the spending to. Add one in the chart of accounts — LedgerFlow does not invent accounts.</span>
                    </p>
                  )}
                  <div>
                    <label htmlFor="petty-spend-amount" className={labelClass}>Amount</label>
                    <input id="petty-spend-amount" inputMode="decimal" value={spend.amount} onChange={e => setSpend(c => ({ ...c, amount: e.target.value }))} placeholder="0.00" className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="petty-spend-category" className={labelClass}>Category (expense account)</label>
                    <select id="petty-spend-category" value={spend.categoryAccountId} onChange={e => setSpend(c => ({ ...c, categoryAccountId: e.target.value }))} className={inputClass}>
                      <option value="">Choose an account…</option>
                      {categories.map(a => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="petty-spend-note" className={labelClass}>Note</label>
                    <input id="petty-spend-note" value={spend.note} onChange={e => setSpend(c => ({ ...c, note: e.target.value }))} placeholder="e.g. stamps" className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="petty-spend-receipt" className={labelClass}>Receipt number (optional)</label>
                    <input id="petty-spend-receipt" value={spend.receipt} onChange={e => setSpend(c => ({ ...c, receipt: e.target.value }))} placeholder="e.g. PC-0042" className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="petty-spend-date" className={labelClass}>Date</label>
                    <input id="petty-spend-date" type="date" value={spend.date} onChange={e => setSpend(c => ({ ...c, date: e.target.value }))} className={inputClass} />
                  </div>
                  {refusals['spend'] && <p role="alert" className="text-sm text-[var(--neg)]">{refusals['spend']}</p>}
                  <button type="button" disabled={busy} onClick={recordSpend} className={buttonClass}>Record the spending</button>
                </section>

                <section aria-labelledby="petty-cash-top-up" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-3">
                  <h2 id="petty-cash-top-up" className="text-base font-semibold text-[var(--text)] flex items-center gap-2">
                    <ArrowDownToLine className="w-4 h-4 text-[var(--brass)]" aria-hidden="true" /> Top up from bank
                  </h2>
                  <div>
                    <label htmlFor="petty-topup-amount" className={labelClass}>Amount</label>
                    <input id="petty-topup-amount" inputMode="decimal" value={topUp.amount} onChange={e => setTopUp(c => ({ ...c, amount: e.target.value }))} placeholder="0.00" className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="petty-topup-bank" className={labelClass}>From bank account</label>
                    <select id="petty-topup-bank" value={topUp.bankAccountId} onChange={e => setTopUp(c => ({ ...c, bankAccountId: e.target.value }))} className={inputClass}>
                      <option value="">Choose an account…</option>
                      {boxes.filter(a => a.id !== box.id).map(a => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="petty-topup-date" className={labelClass}>Date</label>
                    <input id="petty-topup-date" type="date" value={topUp.date} onChange={e => setTopUp(c => ({ ...c, date: e.target.value }))} className={inputClass} />
                  </div>
                  {refusals['top-up'] && <p role="alert" className="text-sm text-[var(--neg)]">{refusals['top-up']}</p>}
                  <button type="button" disabled={busy} onClick={recordTopUp} className={buttonClass}>Record the top-up</button>
                </section>

                <section aria-labelledby="petty-cash-count" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-3">
                  <h2 id="petty-cash-count" className="text-base font-semibold text-[var(--text)] flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-[var(--brass)]" aria-hidden="true" /> Count the box
                  </h2>
                  <div>
                    <label htmlFor="petty-count-amount" className={labelClass}>Cash in the box (counted)</label>
                    <input id="petty-count-amount" inputMode="decimal" value={count.counted} onChange={e => setCount(c => ({ ...c, counted: e.target.value }))} placeholder="0.00" className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="petty-count-overshort" className={labelClass}>Over/short account</label>
                    <select id="petty-count-overshort" value={countDraft.overShortAccountId} onChange={e => remember({ overShortAccountId: e.target.value || undefined })} className={inputClass}>
                      <option value="">Choose an expense account…</option>
                      {overShortAccounts.map(a => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="petty-count-date" className={labelClass}>Date</label>
                    <input id="petty-count-date" type="date" value={count.date} onChange={e => setCount(c => ({ ...c, date: e.target.value }))} className={inputClass} />
                  </div>
                  {countDiff !== null && (
                    <p className={cn('text-sm font-medium', countDiff === 0 ? 'text-[var(--pos)]' : 'text-amber-700')}>
                      {countDiff === 0
                        ? 'The count agrees with the books — nothing to post.'
                        : `${money(Math.abs(countDiff))} ${countDiff < 0 ? 'short of' : 'over'} the ${money(balance)} the books say.`}
                    </p>
                  )}
                  {refusals['count'] && <p role="alert" className="text-sm text-[var(--neg)]">{refusals['count']}</p>}
                  <button type="button" disabled={busy} onClick={recordCount} className={buttonClass}>Record the count</button>
                </section>
              </div>
            )}

            <section aria-labelledby="petty-cash-movements" className="space-y-2">
              <h2 id="petty-cash-movements" className="text-base font-semibold text-[var(--text)]">Latest movements of the box</h2>
              {movements.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Nothing has touched {box.name} yet. A top-up from the bank usually comes first.</p>
              ) : (
                // a table that can scroll sideways is a focusable, labelled region
                <div className="overflow-x-auto rounded-xl border border-[var(--line)]" role="region" aria-label="Latest movements of the petty cash box" tabIndex={0}>
                  <table className="w-full border-collapse text-sm tabular-nums">
                    <caption className="sr-only">The last {movements.length} posted entries that moved money in or out of {box.name}</caption>
                    <thead className="bg-[var(--ink)]">
                      <tr>
                        <th scope="col" className="p-3 text-left whitespace-nowrap">Date</th>
                        <th scope="col" className="p-3 text-left">What</th>
                        <th scope="col" className="p-3 text-left">Reference</th>
                        <th scope="col" className="p-3 text-right whitespace-nowrap">In / out of the box</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map(m => (
                        <tr key={m.transaction.id} className="border-t border-[var(--line)]">
                          <td className="p-3 whitespace-nowrap">{m.transaction.date}</td>
                          <td className="p-3">{m.transaction.description || '—'}</td>
                          <td className="p-3 whitespace-nowrap">{m.transaction.reference || '—'}</td>
                          <td className={cn('p-3 text-right whitespace-nowrap font-medium', m.amountCents < 0 ? 'text-[var(--neg)]' : 'text-[var(--pos)]')}>
                            {money(m.amountCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
