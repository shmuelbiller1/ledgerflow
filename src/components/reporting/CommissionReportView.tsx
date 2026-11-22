import { useReportDates } from './useReportDates';
import ReportSchedule from './ReportSchedule';
import React, { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { commissionLines } from '../../lib/salesReps';
import { useReportText } from './useReportText';
import { LoadingState } from '../ui/LoadingState';

const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/**
 * Sales commission (P-13, A-123): for a period, each payment from a sales rep's customers applied to
 * an invoice, less its tax share, and the rep's commission on it (applying per-item-group rates when
 * `groupRates` is recorded on the rep), with each rep's total (src/lib/salesReps.ts `commissionLines`).
 * Amounts in the workspace's currency; nothing is posted.
 */
export default function CommissionReportView() {
  const dates = useReportDates();
  const reportText = useReportText();
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
  const lines = from && to ? commissionLines(reps, invoices || [], payments || [], from, to, inventory || [], currency) : [];
  const money = (cents: number) => formatCurrency(cents, currency);

  return (
    <section aria-labelledby="commission-title" className="space-y-4">
      <div>
        <h2 id="commission-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.sales-commission', 'Sales commission')}</h2>
        <p className="text-sm text-[var(--muted)]">{reportText('r.what-each-sales-rep-s-customers-paid-in-the-peri', 'What each sales rep\'s customers paid in the period, before tax, and the rep\'s commission on it.')}</p>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.from', 'From')}<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.to', 'To')}<input type="date" value={to} onChange={e => setTo(e.target.value)} className={field} /></label>
      </div>
      {loading && <LoadingState label={reportText('r.loading', 'Loading…')} rows={3} />}
      {reps.length === 0 && <p className="text-sm text-[var(--muted)]">{reportText('r.no-sales-reps-yet-add-them-with-their-commission', 'No sales reps yet: add them, with their commission and customers, in Settings → Sales reps.')}</p>}
      {reps.map(rep => {
        const mine = lines.filter(l => l.repId === rep.id);
        const sum = (k: 'paidCents' | 'netCents' | 'commissionCents') => mine.reduce((s, l) => s + l[k], 0);
        const groupSummary = rep.groupRates && Object.keys(rep.groupRates).length > 0
          ? ` (${Object.entries(rep.groupRates).map(([g, r]) => `${g}: ${r}%`).join(', ')})`
          : '';
        return (
          <div key={rep.id} className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            <ReportSchedule
              caption={<><bdi>{rep.name}</bdi> ({rep.commissionPercent}%{groupSummary}): {money(sum('commissionCents'))}</>}
              captionClassName="text-start font-semibold text-[var(--text)] pb-1"
              headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
              rowClassName="border-b border-[var(--line)]/50"
              bodyClassName=""
              rows={mine} rowKey={l => JSON.stringify([l.paymentId, l.invoiceId])}
              emptyRow={<tr><td colSpan={6} className="py-2 px-2 text-[var(--muted)]">{reportText('r.nothing-paid-by-their-customers-in-this-period', 'Nothing paid by their customers in this period.')}</td></tr>}
              footer={mine.length ? <tr className="font-semibold">
                    <th scope="row" colSpan={3} className="text-start py-1 px-2">{reportText('r.total', 'Total')}</th>
                    <td className="text-right font-mono py-1 px-2">{money(sum('paidCents'))}</td>
                    <td className="text-right font-mono py-1 px-2">{money(sum('netCents'))}</td>
                    <td className="text-right font-mono py-1 px-2">{money(sum('commissionCents'))}</td>
                  </tr> : undefined}
              columns={[
                { header: reportText('r.paid-on', 'Paid on'), className: 'font-mono', cell: l => <time dateTime={l.date}>{dates.dateText(l.date)}</time> },
                { header: reportText('r.invoice-2', 'Invoice'), rowHeader: true, className: 'font-mono', cell: l => l.invoiceNumber },
                { header: reportText('r.customer', 'Customer'), cell: l => <bdi>{l.customerName}</bdi> },
                { header: reportText('r.paid', 'Paid'), align: 'right', className: 'font-mono', cell: l => money(l.paidCents) },
                { header: reportText('r.before-tax', 'Before tax'), align: 'right', className: 'font-mono', cell: l => money(l.netCents) },
                { header: reportText('r.commission', 'Commission'), align: 'right', className: 'font-mono', cell: l => money(l.commissionCents) },
              ]} />
          </div>
        );
      })}
    </section>
  );
}
