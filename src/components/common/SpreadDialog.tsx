import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { getIdToken } from '../../firebase';
import { resolveAccountRole } from '../../lib/accountUtils';
import { formatCurrency, readAmountCents } from '../../lib/utils';
import { DEFAULT_ACCOUNT_SLOTS, accountInUse } from '../../lib/accountDefaults';
import { deferredRevenueAccount, documentLine, prepaidAccount, spreadPlan, spreadProblem } from '../../lib/prepaidSchedule';
import type { ChartAccount } from '../../types';
import { useDialog } from '../../hooks/useDialog';

const inputClass = 'w-full p-2 bg-[var(--panel)] border border-[var(--line)] rounded-lg text-[var(--text)]';

export interface SpreadableDocument {
  id: string;
  number?: string;
  date?: string;
  issueDate?: string;
  amountCents?: number;
  exchangeRate?: number;
  vendorName?: string;
  customerName?: string;
  items?: Array<{ accountId?: string; amountCents?: number }>;
  splits?: Array<{ accountId?: string; amountCents?: number }>;
}

const SIDE = {
  bill: {
    role: 'expense' as const, accountLabel: 'Expense account', holdLabel: 'Prepaid account', holdName: 'Prepaid Expenses',
    accountField: 'expenseAccountId', holdField: 'prepaidAccountId', path: 'bills',
    holdFits: (a: ChartAccount) => resolveAccountRole(a) === 'asset',
    findHold: prepaidAccount,
    intro: (date: string) => `the cost goes to Prepaid on ${date} and back to the expense one share at each month end.`,
    missing: 'No “Prepaid Expenses” account yet: add one in the Chart of Accounts, or choose an asset account.',
  },
  invoice: {
    role: 'revenue' as const, accountLabel: 'Income account', holdLabel: 'Deferred revenue account', holdName: 'Deferred Revenue',
    accountField: 'revenueAccountId', holdField: 'deferredAccountId', path: 'invoices',
    holdFits: (a: ChartAccount) => resolveAccountRole(a) === 'liability',
    findHold: deferredRevenueAccount,
    intro: (date: string) => `the income goes to Deferred Revenue on ${date} and is earned one share at each month end.`,
    missing: 'No “Deferred Revenue” account yet: add a liability account with that name in the Chart of Accounts, or choose one.',
  },
};

/**
 * Spread a bill's cost (K-17, prepaid expense) or an invoice's income (K-16, deferred revenue) over
 * months: amount, account, number of months and first month, with the monthly share shown before
 * anything is posted. The server posts all entries at once (src/server/services/prepaidService.ts).
 */
export default function SpreadDialog({ kind, document: doc, onClose }: { kind: 'bill' | 'invoice'; document: SpreadableDocument; onClose: () => void }) {
  const side = SIDE[kind];
  const storedAccounts = useLedgerStore(s => s.accounts);
  const accounts = useMemo(() => (storedAccounts || []).filter(a => !a.isArchived), [storedAccounts]);
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const currency = workspace?.currency || 'USD';
  const mappings = workspace?.defaultAccountMappings;
  const choices = useMemo(() => accounts.filter(a => resolveAccountRole(a) === side.role), [accounts, side]);
  const holdChoices = useMemo(() => accounts.filter(side.holdFits), [accounts, side]);
  // lines without an account of their own post to the default income/expense account
  const fallback = useMemo(() => accountInUse(DEFAULT_ACCOUNT_SLOTS.find(s => s.key === (kind === 'bill' ? 'expense' : 'revenue'))!, accounts, mappings).account?.id, [kind, accounts, mappings]);
  const line = useMemo(() => documentLine(doc, accounts, side.role, fallback), [doc, accounts, side, fallback]);
  const rate = typeof doc.exchangeRate === 'number' && doc.exchangeRate > 0 ? doc.exchangeRate : 1;
  const docBaseCents = Math.round((doc.amountCents || 0) * rate);
  const date = String(doc.date || doc.issueDate || '').slice(0, 10);
  const foundHold = useMemo(() => side.findHold(accounts, mappings), [side, accounts, mappings]);

  const [accountId, setAccountId] = useState(line?.accountId || '');
  const [holdAccountId, setHoldAccountId] = useState(foundHold?.id || '');
  const [amount, setAmount] = useState(((line?.baseCents ?? docBaseCents) / 100).toFixed(2));
  const [months, setMonths] = useState('12');
  const [startMonth, setStartMonth] = useState(date.slice(0, 7));
  const [busy, setBusy] = useState(false);
  const { dialogProps, titleId } = useDialog(onClose);

  const input = { date, amountCents: readAmountCents(amount) ?? Number.NaN, months: Number(months), startMonth };
  const problem = spreadProblem(input, docBaseCents, kind)
    || (!accountId ? `Choose the ${side.accountLabel.toLowerCase()}` : null)
    || (!holdAccountId ? `Choose the ${side.holdName} account` : null);
  const plan = problem ? [] : spreadPlan(input);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    try {
      const token = await getIdToken().catch(() => null);
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace?.id || '')}/${side.path}/${encodeURIComponent(doc.id)}/spread`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ [side.accountField]: accountId, [side.holdField]: holdAccountId, amountCents: input.amountCents, months: input.months, startMonth }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The spread could not be saved');
      toast.success(`Spread over ${input.months} months`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const party = kind === 'bill' ? (doc.vendorName ? `from ${doc.vendorName}` : '') : (doc.customerName ? `to ${doc.customerName}` : '');
  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 text-[var(--text)]">
        <div>
          <h2 id={titleId} className="text-lg font-bold">Spread over months</h2>
          <p className="text-xs text-[var(--muted)]">
            {kind === 'bill' ? 'Bill' : 'Invoice'} {doc.number || ''} {party}: {side.intro(date || `the ${kind} date`)}
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-xs font-bold">{side.accountLabel}</span>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} className={inputClass}>
            <option value="">Choose…</option>
            {choices.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} – ` : ''}{a.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-bold">{side.holdLabel}</span>
          <select value={holdAccountId} onChange={e => setHoldAccountId(e.target.value)} className={inputClass}>
            <option value="">Choose…</option>
            {holdChoices.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} – ` : ''}{a.name}</option>)}
          </select>
          {!foundHold && <span className="text-[11px] text-[var(--muted)]">{side.missing}</span>}
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm">
            <span className="text-xs font-bold">Amount ({currency})</span>
            <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={`${inputClass} font-mono text-right`} />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-bold">Months</span>
            <input type="number" min={2} max={60} value={months} onChange={e => setMonths(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-bold">First month</span>
            <input type="month" value={startMonth} min={date.slice(0, 7) || undefined} onChange={e => setStartMonth(e.target.value)} className={inputClass} />
          </label>
        </div>
        {problem ? (
          <p role="alert" className="text-xs text-rose-600">{problem}</p>
        ) : (
          <p className="text-sm" aria-live="polite">
            {formatCurrency(plan[0].amountCents, currency)} a month, {plan[0].date} to {plan[plan.length - 1].date}
            {plan[plan.length - 1].amountCents !== plan[0].amountCents ? ` (the last ${formatCurrency(plan[plan.length - 1].amountCents, currency)})` : ''}.
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-[var(--muted)] hover:underline">Cancel</button>
          <button type="submit" disabled={Boolean(problem) || busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? 'Spreading…' : 'Spread'}
          </button>
        </div>
      </form>
    </div>
  );
}
