import { useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { currentIdentity, useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useUIStore } from '../../stores/useUIStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useServerOperationalReport, collectionStamp } from '../../hooks/useServerOperationalReport';
import { paymentMethodSummary } from '../../lib/paymentMethodSummary';
import { browserProvenance } from '../../lib/reportProvenance';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency } from '../../lib/utils';
import { RowTable } from '../ui/RowTable';
import ReportTableScroll from './ReportTableScroll';
import ReportEmptyState from './ReportEmptyState';
import PaymentFlowsByMethodPanel from './PaymentFlowsByMethodPanel';
import { paymentMethodLabel } from './paymentMethodLabel';
import { useReportDates } from './useReportDates';
import { useReportText } from './useReportText';

interface Props { startDate?: string; endDate?: string; compareStartDate?: string; compareEndDate?: string }
type MethodRows = ReturnType<typeof paymentMethodSummary>;

function isMethodRows(value: unknown): value is MethodRows {
  return Array.isArray(value) && value.every(row => row && typeof row.id === 'string' && row.id && typeof row.name === 'string'
    && Number.isSafeInteger(row.cents) && Number.isSafeInteger(row.count) && row.count >= 0
    && Number.isSafeInteger(row.undated) && row.undated >= 0 && row.undated <= row.count)
    && new Set(value.map(row => row.id)).size === value.length;
}

function fullReceipts(body: Record<string, unknown>, compared: boolean) {
  // Older replies have no provenance. An explicitly partial reply, or a missing comparison,
  // must not turn the fallback's unknown amounts into authoritative zeroes or enable export.
  const p = body.provenance;
  if (p !== undefined && !(p && typeof p === 'object' && 'source' in p && p.source === 'server'
    && 'completeness' in p && p.completeness === 'complete')) return undefined;
  if (!isMethodRows(body.rows) || (compared && !isMethodRows(body.previousRows))) return undefined;
  return { rows: body.rows, previousRows: isMethodRows(body.previousRows) ? body.previousRows : [] };
}

export default function PaymentMethodSummaryView({ startDate = '', endDate = '', compareStartDate = '', compareEndDate = '' }: Props) {
  const reportText = useReportText();
  const dates = useReportDates();
  const open = useUIStore(s => s.setActiveTab);
  const customers = useLedgerStore(s => s.customers), payments = useLedgerStore(s => s.payments);
  const truncatedCollections = useLedgerStore(s => s.truncatedCollections), isDataTruncated = useLedgerStore(s => s.isDataTruncated);
  const failed = useDataNeedsStore(s => s.failed);
  const workspace = useAuthStore(s => s.currentWorkspaceId), currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const identity = useAuthStore(currentIdentity), guest = useAuthStore(s => s.isGuest);
  // The flow panel reads payments alone. Waiting for customers must not make a complete
  // payment register unavailable; failed reads are provisional, not still loading.
  const { loading: waitingForPayments } = useLedgerCollections('payments');
  const { loading: waitingForCustomers } = useLedgerCollections('customers');
  const loadedWorkspace = useDataNeedsStore(s => s.loadedWorkspaceId);
  const changingBooks = !workspace || (!guest && (!identity || loadedWorkspace !== workspace));
  const flowsLoading = changingBooks || (waitingForPayments && !failed.payments);
  const loading = flowsLoading || (waitingForCustomers && !failed.customers);
  const valid = validCustomReportPeriod({ startDate, endDate });
  const compared = validCustomReportPeriod({ startDate: compareStartDate, endDate: compareEndDate });
  const cache = { truncatedCollections, isDataTruncated, failed };
  const incomplete = browserProvenance(['customers', 'payments'], cache).completeness !== 'complete';
  const paymentsIncomplete = browserProvenance(['payments'], cache).completeness !== 'complete';
  const query = new URLSearchParams({ workspaceId: workspace || '', startDate, endDate, ...(compared ? { compareStartDate, compareEndDate } : {}) });
  const stamp = useMemo(() => collectionStamp(customers, payments), [customers, payments]);
  const server = useServerOperationalReport<{ rows: MethodRows; previousRows: MethodRows }>(
    valid && incomplete && Boolean(workspace && identity && !guest), `/api/v1/reports/payment-methods?${query}`,
    JSON.stringify([identity, query.toString(), currency, stamp]),
    body => fullReceipts(body, compared),
  );
  const scopedPayments = useMemo(() => payments.filter(p => workspace && p.workspaceId === workspace), [workspace, payments]);
  const local = useMemo(() => {
    if (server || !valid || loading) return { rows: [], previousRows: [] };
    const parties = customers.filter(c => workspace && c.workspaceId === workspace);
    return { rows: paymentMethodSummary(parties, scopedPayments, { startDate, endDate }, currency),
      previousRows: compared ? paymentMethodSummary(parties, scopedPayments, { startDate: compareStartDate, endDate: compareEndDate }, currency) : [] };
  }, [server, valid, loading, workspace, customers, scopedPayments, currency, startDate, endDate, compared, compareStartDate, compareEndDate]);
  const { rows, previousRows } = server ?? local;
  const complete = Boolean(workspace && (guest || identity) && valid && (server || (!loading && !incomplete)));
  const prior = new Map(previousRows.map(row => [row.id, row.cents]));
  const currentIds = new Set(rows.map(row => row.id));
  // Only a complete window can say that a method with prior receipts had zero this period.
  const displayed = compared && complete ? [...rows, ...previousRows.filter(row => !currentIds.has(row.id)).map(row => ({ ...row, count: 0, cents: 0, undated: 0 }))] : rows;
  const emptyBooks = complete && !server && scopedPayments.length === 0;
  const noMatch = reportText('r.no-received-payment-documents-for-this-period', 'No received payment documents for this period.');
  const table = <RowTable caption={reportText('r.receipts-table', 'Customer receipts by method')} captionClassName="text-start text-[var(--muted)]"
    tableClassName="comparison-report-table w-full text-sm" rows={displayed} rowKey={row => row.id}
    emptyRow={<tr><td colSpan={compared ? 5 : 4} className="text-center text-[var(--muted)]">{noMatch}</td></tr>}
    columns={[
      { header: reportText('r.method', 'Method'), headClassName: 'text-start', className: 'text-start', cell: row => <bdi>{paymentMethodLabel(row.name, reportText)}</bdi> },
      { header: reportText('r.payments', 'Payments'), align: 'right', className: 'tabular-nums', cell: row => row.count },
      { header: reportText('r.received', 'Received'), align: 'right', className: 'whitespace-nowrap tabular-nums', cell: row => <bdi dir="ltr">{formatCurrency(row.cents, currency)}</bdi> },
      { header: reportText('r.undated-included', 'Undated included'), align: 'right', className: 'tabular-nums', cell: row => row.undated },
      compared ? { header: reportText('r.previous-receipts-change', 'Previous receipts / change'), align: 'right', className: 'tabular-nums', cell: row => {
        const before = prior.get(row.id) ?? (complete ? 0 : undefined);
        return before === undefined ? '—' : <bdi dir="ltr" className="whitespace-nowrap">{formatCurrency(before, currency)} / {formatCurrency(row.cents - before, currency)}</bdi>;
      } } : false,
    ]} />;

  return <section aria-label={reportText('r.sales-payment-summary', 'Sales payment summary')} className="p-4 space-y-3 min-w-0">
    <h2 className="text-lg font-semibold">{reportText('r.sales-payment-summary-by-method', 'Sales payment summary by method')}</h2>
    {emptyBooks ? <ReportEmptyState title={reportText('r.no-payments-in-books', 'No payments recorded in these books yet.')} actionLabel={reportText('r.open-sales', 'Open Sales')} onAction={() => open('sales')} /> : <>
      {valid && <p className="flex flex-wrap gap-x-3">
        <bdi>{dates.periodText(startDate, endDate)}</bdi>
        {compared && <span>{reportText('r.period-previous', 'Previous')}: <bdi>{dates.periodText(compareStartDate, compareEndDate)}</bdi></span>}
      </p>}
      <details className="text-sm text-[var(--muted)]"><summary className="min-h-11 py-3 cursor-pointer">{reportText('r.receipt-scope', 'Received payments in the workspace currency')}</summary>
        <p>{reportText('r.receipt-method-help', 'Received customer payments, including unapplied receipts, are grouped by their recorded method. Drafts, voids and outgoing payments are excluded. Undated receipts are counted separately and included in both periods. These are receipts, not invoice revenue.')}</p>
      </details>
      {loading && !server && !incomplete && <p role="status">{reportText('r.loading-payments', 'Loading payments…')}</p>}
      {!valid && <p role="alert">{reportText('r.choose-a-valid-report-period', 'Choose a valid report period.')}</p>}
      {incomplete && !server && <p role="alert">{reportText('r.receipt-preview', 'Receipt history is incomplete. These figures are provisional; displayed-row CSV is unavailable.')}</p>}
      {server && <p className="text-sm text-[var(--muted)]">{reportText('r.receipt-server', 'Receipt totals use full workspace history. The separate money-in-and-out report below uses loaded payment records.')}</p>}
      {displayed.length > 0 ? <ReportTableScroll allowDisplayedExport={complete}>{table}</ReportTableScroll> : complete && table}
      <PaymentFlowsByMethodPanel payments={scopedPayments} workspaceId={workspace || ''} homeCurrency={currency} startDate={startDate} endDate={endDate} loading={flowsLoading} incomplete={paymentsIncomplete} />
    </>}
  </section>;
}
