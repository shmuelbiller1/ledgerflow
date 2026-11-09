import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';
import { formatCurrency, readAmountCents } from '../../lib/utils';
import { type OrderPart, type OrderProgress, hasItemLines, orderLineProgress, orderPartInvoice, partCents, partLabel, partProblem } from '../../lib/salesOrders';
import type { Estimate } from '../../types';
import type { Milestone } from '../../lib/milestones';
import { db } from '../../firebase';
import { doc, updateDoc } from '../../lib/db/firestore';
import { MilestoneSchedule } from './MilestoneSchedule';

const field = 'w-full px-3 py-2 text-sm bg-[var(--ink)] border border-[var(--line)] rounded-lg text-[var(--text)]';
type Mode = OrderPart['mode'];

/**
 * Invoice part of a sales order (K-04): the rest, a percentage of the order, or an amount. Shows
 * what is already invoiced and the lines the draft invoice will have before it is made. An order
 * with stock items is invoiced by quantity instead (BF-08): how many of each line, so stock and
 * cost move with the units invoiced (the rules: src/lib/salesOrders.ts).
 */
export default function OrderInvoiceDialog({ estimate, progress, currency, onCreate, onClose, canWrite = true }: {
  estimate: Estimate;
  canWrite?: boolean;
  progress: OrderProgress;
  currency: string;
  onCreate: (part: OrderPart) => Promise<unknown>;
  onClose: () => void;
}) {
  const byQuantity = hasItemLines(estimate);
  const lines = orderLineProgress(estimate, progress);
  const [mode, setMode] = useState<Mode>(byQuantity ? 'quantities' : 'rest');
  const [percent, setPercent] = useState('50');
  const [amount, setAmount] = useState('');
  const [quantities, setQuantities] = useState<string[]>(() => lines.map(l => String(l.leftQuantity)));
  const [saving, setSaving] = useState(false);
  // V-09: the order's milestone schedule, and the milestone being invoiced now
  const [milestones, setMilestones] = useState<Milestone[]>(() => estimate.milestones || []);
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const { dialogProps, titleId } = useDialog(onClose, true);
  const part: OrderPart = mode === 'quantities' ? { mode, quantities: quantities.map(q => (q.trim() === '' ? 0 : Number(q))) }
    : mode === 'rest' ? { mode } : mode === 'percent' ? { mode, percent: Number(percent) } : { mode, cents: readAmountCents(amount) ?? 0 };
  const problem = partProblem(part, progress, estimate);
  const cents = problem ? 0 : partCents(part, progress, estimate);
  const preview = problem ? [] : orderPartInvoice(estimate, progress, cents, partLabel(part, estimate, progress), part).items || [];
  const money = (c: number) => formatCurrency(c, currency);

  const create = async () => {
    if (problem || saving) return;
    setSaving(true);
    try {
      await onCreate(part);
      if (milestone && part.mode === 'percent' && part.percent === milestone.percent) {
        const done = milestones.map(m => (m.id === milestone.id ? { ...m, invoicedAt: new Date().toISOString() } : m));
        await updateDoc(doc(db, 'estimates', estimate.id), { milestones: done, updatedAt: new Date().toISOString() });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const choice = (value: Mode, text: string) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="radio" name="order-part" checked={mode === value} onChange={() => setMode(value)} />
      {text}
    </label>
  );

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-md w-full border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">Invoice order {estimate.number || ''}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <p className="text-xs text-[var(--muted)]">
            {estimate.customerName || 'Customer'} · order of {money(progress.totalCents)} · invoiced {money(progress.invoicedCents)}
            {progress.invoices.length > 0 && ` (${progress.invoices.map(inv => inv.number || inv.id).join(', ')})`} · <strong className="text-[var(--text)]">left {money(progress.leftCents)}</strong>
          </p>
          {byQuantity ? (
            <div className="space-y-2">
              <p className="text-xs text-[var(--muted)]">This order has stock items, so it is invoiced by quantity: stock and cost move with what is invoiced. To take money before delivery, use Deposit on the order.</p>
              <table className="w-full text-xs">
                <caption className="text-left text-xs font-semibold text-[var(--muted)] mb-1">How many to invoice now</caption>
                <thead>
                  <tr className="text-[var(--muted)]">
                    <th scope="col" className="text-left font-semibold py-0.5">Line</th>
                    <th scope="col" className="text-right font-semibold py-0.5">Ordered</th>
                    <th scope="col" className="text-right font-semibold py-0.5">Left</th>
                    <th scope="col" className="text-right font-semibold py-0.5">Now</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => (
                    <tr key={line.position}>
                      <td className="py-0.5 pr-2">{line.description}{line.itemId ? '' : <span className="text-[var(--muted)]"> (not a stock item)</span>}</td>
                      <td className="py-0.5 text-right font-mono">{line.quantity}</td>
                      <td className="py-0.5 text-right font-mono">{line.leftQuantity}</td>
                      <td className="py-0.5 pl-2 text-right">
                        <input aria-label={`How many of ${line.description || `line ${line.position + 1}`} to invoice now`} inputMode="decimal" value={quantities[line.position] ?? ''}
                          disabled={line.leftQuantity <= 0}
                          onChange={e => setQuantities(qs => qs.map((q, i) => (i === line.position ? e.target.value : q)))} className={`${field} w-20 font-mono text-right`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-[var(--muted)] mb-1">How much to invoice now</legend>
            <MilestoneSchedule estimateId={estimate.id} milestones={milestones} canWrite={canWrite} onSaved={setMilestones}
              onPick={m => { setMilestone(m); setMode('percent'); setPercent(String(m.percent)); }} />
            {choice('rest', `All that is left (${money(progress.leftCents)})`)}
            <div className="flex items-center gap-2">
              {choice('percent', 'A percentage of the order')}
              {mode === 'percent' && (
                <input aria-label="Percentage of the order" inputMode="decimal" value={percent} onChange={e => setPercent(e.target.value)} className={`${field} w-20 font-mono text-right`} />
              )}
            </div>
            <div className="flex items-center gap-2">
              {choice('amount', 'An amount')}
              {mode === 'amount' && (
                <input aria-label={`Amount to invoice (${currency})`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={`${field} w-28 font-mono text-right`} />
              )}
            </div>
          </fieldset>
          )}
          {preview.length > 0 && (
            <table className="w-full text-xs">
              <caption className="text-left text-xs font-semibold text-[var(--muted)] mb-1">The draft invoice</caption>
              <tbody>
                {preview.map(item => (
                  <tr key={item.id}>
                    <td className="py-0.5 pr-2">{item.description}{byQuantity ? ` × ${item.quantity}` : ''}</td>
                    <td className="py-0.5 text-right font-mono">{money(item.amountCents)}</td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--line)] font-semibold">
                  <td className="py-0.5">Total</td>
                  <td className="py-0.5 text-right font-mono">{money(cents)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {problem && <p role="alert" className="text-xs text-rose-600">{problem}</p>}
          <p className="text-xs text-[var(--muted)]">It is saved as a draft: review it in Sales, then send it.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-[var(--muted)] hover:underline">Cancel</button>
            <button type="button" onClick={() => void create()} disabled={Boolean(problem) || saving}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">
              {saving ? 'Creating…' : `Create ${money(cents)} invoice`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
