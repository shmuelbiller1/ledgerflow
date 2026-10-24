import React, { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { commissionLines } from '../../lib/salesReps';

const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';
const th = 'font-semibold py-1 px-2';

/**
 * Sales commission (P-13, A-123): for a period, each payment from a sales rep's customers applied to
 * an invoice, less its tax share, and the rep's commission on it (applying per-item-group rates when
 * `groupRates` is recorded on the rep), with each rep's total (src/lib/salesReps.ts `commissionLines`).
 * Amounts in the workspace's currency; nothing is posted.
 */
export default function CommissionReportView() {
  const { loading } = useLedgerCollections('invoices', 'payments', 'inventory');
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const invoices = useLedgerStore(s => s.invoices);
  const payments = useLedgerStore(s => s.payments);
  const inventory = useLedgerStore(s => s.inventory);
  const today = getLocalDateISO();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  if (!workspace) return null;
  const currency = workspace.currency || 'USD';
  const reps = workspace.salesReps || [];
  const lines = from && to ? commissionLines(reps, invoices || [], payments || [], from, to, inventory || []) : [];
  const money = (cents: number) => formatCurrency(cents, currency);

  return (
    <section aria-labelledby="commission-title" className="space-y-4">
      <div>
        <h2 id="commission-title" className="text-lg font-bold text-[var(--text)]">Sales commission</h2>
        <p className="text-sm text-[var(--muted)]">What each sales rep&apos;s customers paid in the period, before tax, and the rep&apos;s commission on it.</p>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className={field} /></label>
      </div>
      {loading && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {reps.length === 0 && <p className="text-sm text-[var(--muted)]">No sales reps yet: add them, with their commission and customers, in Settings → Sales reps.</p>}
      {reps.map(rep => {
        const mine = lines.filter(l => l.repId === rep.id);
        const sum = (k: 'paidCents' | 'netCents' | 'commissionCents') => mine.reduce((s, l) => s + l[k], 0);
        const groupSummary = rep.groupRates && Object.keys(rep.groupRates).length > 0
          ? ` (${Object.entries(rep.groupRates).map(([g, r]) => `${g}: ${r}%`).join(', ')})`
          : '';
        return (
          <div key={rep.id} className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            <table className="w-full text-sm">
              <caption className="text-left font-semibold text-[var(--text)] pb-1">
                <bdi>{rep.name}</bdi> ({rep.commissionPercent}%{groupSummary}): {money(sum('commissionCents'))}
              </caption>
              <thead>
                <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                  <th scope="col" className={`text-left ${th}`}>Paid on</th>
                  <th scope="col" className={`text-left ${th}`}>Invoice</th>
                  <th scope="col" className={`text-left ${th}`}>Customer</th>
                  <th scope="col" className={`text-right ${th}`}>Paid</th>
                  <th scope="col" className={`text-right ${th}`}>Before tax</th>
                  <th scope="col" className={`text-right ${th}`}>Commission</th>
                </tr>
              </thead>
              <tbody>
                {mine.length === 0 && <tr><td colSpan={6} className="py-2 px-2 text-[var(--muted)]">Nothing paid by their customers in this period.</td></tr>}
                {mine.map(l => (
                  <tr key={`${l.paymentId}-${l.invoiceId}`} className="border-b border-[var(--line)]/50">
                    <td className="py-1 px-2 font-mono">{l.date}</td>
                    <th scope="row" className="text-left font-mono font-normal py-1 px-2">{l.invoiceNumber}</th>
                    <td className="py-1 px-2"><bdi>{l.customerName}</bdi></td>
                    <td className="text-right font-mono py-1 px-2">{money(l.paidCents)}</td>
                    <td className="text-right font-mono py-1 px-2">{money(l.netCents)}</td>
                    <td className="text-right font-mono py-1 px-2">{money(l.commissionCents)}</td>
                  </tr>
                ))}
              </tbody>
              {mine.length > 0 && (
                <tfoot>
                  <tr className="font-semibold">
                    <th scope="row" colSpan={3} className="text-left py-1 px-2">Total</th>
                    <td className="text-right font-mono py-1 px-2">{money(sum('paidCents'))}</td>
                    <td className="text-right font-mono py-1 px-2">{money(sum('netCents'))}</td>
                    <td className="text-right font-mono py-1 px-2">{money(sum('commissionCents'))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        );
      })}
    </section>
  );
}
