import { usePartialReportInputs } from '../../hooks/usePartialReportInputs';
import { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { inactiveItemsReport } from '../../lib/inactiveItemsReport';
import { useReportText } from './useReportText';
import { useReportDates } from './useReportDates';
import ReportSchedule from './ReportSchedule';

const SKU = 'SKU';
const dayValid = (date: string) => validCustomReportPeriod({ startDate: date, endDate: date });

export default function InactiveItemsReportView({ asOfDate = '', endDate = '', compareEndDate = '' }: { asOfDate?: string; endDate?: string; compareEndDate?: string }) {
  const reportText = useReportText();
  const dates = useReportDates();
  const items = useLedgerStore(s => s.inventory), invoices = useLedgerStore(s => s.invoices);
  const workspace = useAuthStore(s => s.currentWorkspaceId);
  const guest = useAuthStore(s => s.isGuest && !s.user);
  const currentBook = useDataNeedsStore(s => s.loadedWorkspaceId === workspace) || guest;
  const failed = useDataNeedsStore(s => !!(s.failed.inventory || s.failed.invoices));
  const partial = usePartialReportInputs(['inventory', 'invoices']);
  const { loading } = useLedgerCollections('inventory', 'invoices');
  const [threshold, setThreshold] = useState('90');
  const date = asOfDate || endDate, days = Number(threshold);
  const valid = dayValid(date) && /^\d+$/.test(threshold) && Number.isInteger(days) && days >= 1 && days <= 36500;
  const compared = valid && dayValid(compareEndDate);
  const ready = !!workspace && currentBook && !loading && !failed;
  const { rows, previous } = useMemo(() => {
    const ownItems = items.filter(r => r.workspaceId === workspace), ownInvoices = invoices.filter(r => r.workspaceId === workspace);
    return { rows: valid && ready ? inactiveItemsReport(ownItems, ownInvoices, date, days) : [],
      previous: new Map(compared && ready ? inactiveItemsReport(ownItems, ownInvoices, compareEndDate, days).map(r => [r.id, r]) : []) };
  }, [items, invoices, workspace, ready, valid, compared, date, compareEndDate, days]);
  const status = (value: string) => {
    if (value === 'Inactive') return reportText('r.inactive-status', 'Inactive');
    if (value === 'No recorded sale') return reportText('r.no-sale-status', 'No recorded sale');
    return reportText('r.unknown-sale-date', 'Unknown: issued invoice has no valid date');
  };
  return <section aria-label={reportText('r.inactive-items', 'Inactive items')} className="space-y-4 p-4 min-w-0">
    <h2>{reportText('r.inactive-items-as-of', 'Inactive items as of')} <time dateTime={date}>{dates.dateText(date)}</time></h2>
    <p className="text-sm text-[var(--muted)]">{reportText('r.items-with-no-recorded-positive-quantity-sale-on', 'Items with no recorded positive-quantity sale on an issued invoice for at least the selected number of days. Drafts and later invoices are excluded. Items with no recorded sale or an undated issued sale are identified separately. This reads loaded invoice history, not stock movements.')}</p>
    <label data-print-hide className="flex flex-wrap items-center gap-2">{reportText('r.days-without-a-sale', 'Days without a sale')}
      <input type="text" inputMode="numeric" value={threshold} onChange={event => setThreshold(event.target.value)} aria-invalid={!valid} className="min-h-11 w-24 px-3 border rounded bg-[var(--panel)]" />
    </label>
    {!valid && <p role="alert">{reportText('r.choose-a-valid-report-end-date-and-1-36500-whole', 'Choose a valid report end date and 1–36500 whole days.')}</p>}
    {!ready && !failed && <p role="status">{reportText('r.loading-items-and-invoices', 'Loading items and invoices…')}</p>}
    {partial && <p role="alert">{reportText('r.loaded-history-is-incomplete-or-failed-inactivit', 'Loaded history is incomplete or failed. Inactivity cannot be confirmed from these provisional results.')}</p>}
    {rows.length > 0 && <ReportSchedule columnControls allowDisplayedExport={!partial} rows={rows} rowKey={r => r.id}
      caption={reportText('r.items-without-a-recent-recorded-sale', 'Items without a recent recorded sale')}
      columns={[
        { header: reportText('r.item', 'Item'), cell: r => <bdi>{r.name}</bdi> },
        { header: SKU, cell: r => <bdi>{r.sku}</bdi> },
        { header: reportText('r.last-recorded-sale', 'Last recorded sale'), cell: r => r.lastSaleDate ? <time dateTime={r.lastSaleDate}>{dates.dateText(r.lastSaleDate)}</time> : '—' },
        { header: reportText('r.days-2', 'Days'), align: 'right', cell: r => r.daysSinceSale ?? '—' },
        { header: reportText('r.status', 'Status'), cell: r => status(r.status) },
        compared ? { header: reportText('r.previous-status-days', 'Previous status / days'), cell: r => {
          const prev = previous.get(r.id);
          return <>{prev ? status(prev.status) : reportText('r.sale-within-threshold', 'Sale within threshold')} / {prev?.daysSinceSale ?? '—'}</>;
        } } : false,
      ]} />}
    {valid && ready && !partial && !rows.length && <p role="status">{reportText('r.no-matching-inactive-items', 'No matching inactive items.')}</p>}
  </section>;
}
