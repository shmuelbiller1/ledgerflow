/**
 * EG-6 (BF-04): preview → post for landed cost, owners and accountants. The charge is a bill's freight, duty or other
 * line (or a manual amount against an offset account); it is spread over the goods of the chosen receipts by value,
 * quantity or weight. "Review what will post" asks the server (dryRun) for the exact entry and the new unit costs;
 * "Post landed cost" posts exactly the reviewed plan (its planHash; a changed plan is shown again, not posted), and
 * "Undo landed cost" reverses a posted one. The same allocation posts once. The parent keys this panel by workspace,
 * and an answer to an earlier request (or for another workspace) is ignored.
 */
import React, { useMemo, useRef, useState } from 'react';
import { formatCurrency } from '../../lib/utils';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import { LandedCostRequestError, landedCostRequest, undoLandedCostRequest, type LandedCostPostResult } from '../../services/stockRequests';
import type { SpreadBasis } from '../../lib/landedCostPreview';
import type { Bill, ChartAccount } from '../../types';

interface Props {
  workspaceId: string;
  currency: string;
  bills: Bill[];
  accounts: ChartAccount[];
  /** the receipts the preview offers (bill ids and labels) */
  receipts: Array<{ key: string; label: string }>;
  defaultReceiptId?: string;
}

const DEAD = ['draft', 'void', 'cancelled', 'rejected'];
const MANUAL = '__manual__';
const newAllocationId = () => `lc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

export default function LandedCostPostPanel({ workspaceId, currency, bills, accounts, receipts, defaultReceiptId }: Props) {
  const charges = useMemo(() => bills.filter(b => !DEAD.includes(String(b.status))).flatMap(b => (b.splits || []).map((s, line) => ({ b, s, line })))
    .filter(({ s }) => !s.itemId && !s.landedCost && (Number(s.amountCents) || 0) > 0)
    .map(({ b, s, line }) => ({ value: `${b.id}#${line}`, billId: b.id, line, label: `${b.number || b.id} · ${s.description || 'Charge'} · ${formatCurrency(s.amountCents, currency)}` })), [bills, currency]);
  const [chargeKey, setChargeKey] = useState(charges[0]?.value || MANUAL);
  const [amount, setAmount] = useState('');
  const [offsetId, setOffsetId] = useState('');
  const [chosen, setChosen] = useState<string[]>(defaultReceiptId ? [defaultReceiptId] : []);
  const [basis, setBasis] = useState<SpreadBasis>('value');
  const [allocationId] = useState(newAllocationId);
  const [plan, setPlan] = useState<LandedCostPostResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [postedId, setPostedId] = useState<string | null>(null);
  const request = useRef(0);

  const manualCents = TruthEngine.parseAmountToCents(amount || '0');
  const charge = chargeKey === MANUAL
    ? { kind: 'manual', amountCents: manualCents, accountId: offsetId, allocationId }
    : (() => { const c = charges.find(x => x.value === chargeKey); return c ? { kind: 'bill', billId: c.billId, line: c.line } : null; })();
  const body = { workspaceId, charge, receiptBillIds: chosen, basis };
  const problem = !charge ? 'Choose the charge to land.'
    : chargeKey === MANUAL && !(manualCents > 0) ? 'Enter the amount to land.'
    : chargeKey === MANUAL && !offsetId ? 'Choose the account the amount comes from.'
    : chosen.length === 0 ? 'Choose the receipts the charge is for.' : '';

  /** runs one request; its answer is used only while it is still the latest one */
  const run = async (work: () => Promise<void>, onError: (e: unknown) => void = e => setNotice(e instanceof Error ? e.message : String(e))) => {
    const mine = ++request.current;
    setBusy(true);
    setNotice(null);
    const latest = () => mine === request.current;
    try {
      await work().then(() => undefined, e => { if (latest()) onError(e); });
    } finally {
      if (latest()) setBusy(false);
    }
  };
  const send = (dryRun: boolean) => {
    if (problem) return;
    const mine = request.current + 1;
    void run(async () => {
      const result = await landedCostRequest({ ...body, dryRun, ...(!dryRun && plan?.planHash ? { expectedPlanHash: plan.planHash } : {}) });
      if (mine !== request.current) return;
      setPlan(result);
      if (!dryRun) {
        setPostedId(result.entryId);
        setNotice(result.replayed ? `Already posted as ${result.entryId}: nothing was posted again.` : `Posted ${result.entryId} on ${result.date}${result.movedToOpenDay ? ' (the day asked for is locked, so it is dated today)' : ''}.`);
      }
    }, e => {
      // what would post changed since the review: show the new plan to review, post nothing
      if (e instanceof LandedCostRequestError && e.plan) setPlan(e.plan);
      setNotice(e instanceof Error ? e.message : String(e));
    });
  };
  const undo = () => {
    if (!postedId) return;
    const mine = request.current + 1;
    void run(async () => {
      const result = await undoLandedCostRequest(workspaceId, postedId);
      if (mine !== request.current) return;
      setPostedId(null);
      setPlan(null);
      setNotice(`Undone: ${result.undoEntryId} on ${result.date} reverses ${result.entryId} and its stock moves.`);
    });
  };
  const change = (fn: () => void) => { fn(); request.current++; setBusy(false); setPlan(null); setNotice(null); setPostedId(null); };

  return (
    <section aria-label="Post landed cost" className="space-y-3 border-t pt-4">
      <h3>Post landed cost</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Charge to land
          <select aria-label="Charge to land" value={chargeKey} onChange={e => change(() => setChargeKey(e.target.value))} className={field}>
            {charges.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            <option value={MANUAL}>A manual amount</option>
          </select>
        </label>
        {chargeKey === MANUAL && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Amount ({currency})
              <input aria-label="Amount to land" type="text" inputMode="decimal" value={amount} onChange={e => change(() => setAmount(e.target.value))} className={`${field} w-36`} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Offset account
              <select aria-label="Offset account" value={offsetId} onChange={e => change(() => setOffsetId(e.target.value))} className={field}>
                <option value="">Choose…</option>
                {accounts.filter(a => !a.isArchived).map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} ` : ''}{a.name}</option>)}
              </select>
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Spread by
          <select aria-label="Post spread basis" value={basis} onChange={e => change(() => setBasis(e.target.value as SpreadBasis))} className={field}>
            <option value="value">Value</option>
            <option value="quantity">Quantity</option>
          </select>
        </label>
      </div>
      <fieldset className="text-sm">
        <legend>Receipts the charge is for</legend>
        {receipts.map(r => (
          <label key={r.key} className="flex items-center gap-2 min-h-11">
            <input type="checkbox" checked={chosen.includes(r.key)} onChange={e => change(() => setChosen(e.target.checked ? [...chosen, r.key] : chosen.filter(k => k !== r.key)))} />
            {r.label}
          </label>
        ))}
      </fieldset>
      {problem && <p className="text-sm text-[var(--muted)]">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={Boolean(problem) || busy} onClick={() => send(true)} className="min-h-11 px-3 rounded border text-sm disabled:opacity-50">Review what will post</button>
        <button type="button" disabled={!plan || plan.replayed || !plan.dryRun || busy} onClick={() => send(false)} className="min-h-11 px-3 rounded border text-sm disabled:opacity-50">Post landed cost</button>
        {postedId && <button type="button" disabled={busy} onClick={undo} className="min-h-11 px-3 rounded border text-sm disabled:opacity-50">Undo landed cost</button>}
      </div>
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {plan && (
        <div className="space-y-2 overflow-x-auto">
          <p className="text-sm">{plan.dryRun ? 'Will post' : 'Posted'} on {plan.date}{plan.movedToOpenDay ? ' (today: the day asked for is locked)' : ''}:</p>
          <table className="w-full text-sm border-collapse">
            <caption className="sr-only">Entry the landed cost posts</caption>
            <thead><tr className="border-b text-left"><th scope="col" className="py-1 pr-3">Account</th><th scope="col" className="py-1 pr-3">Line</th><th scope="col" className="py-1 text-right">Amount</th></tr></thead>
            <tbody>
              {plan.entryLines.map(l => (
                <tr key={`${l.accountId}|${l.description}|${l.amountCents}`} className="border-b"><td className="py-1 pr-3">{l.accountName || l.accountId}</td><td className="py-1 pr-3">{l.description}</td><td className="py-1 text-right tabular-nums">{formatCurrency(l.amountCents, currency)}</td></tr>
              ))}
            </tbody>
          </table>
          <ul className="text-sm">
            {plan.lines.map(l => (
              <li key={l.key}>{l.itemName}: +{formatCurrency(l.allocatedCents, currency)}{l.cogsCents ? ` (${formatCurrency(l.cogsCents, currency)} to cost of goods sold for units already sold)` : ''}, unit cost {formatCurrency(l.unitCostBeforeCents, currency)} → {formatCurrency(l.unitCostAfterCents, currency)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
