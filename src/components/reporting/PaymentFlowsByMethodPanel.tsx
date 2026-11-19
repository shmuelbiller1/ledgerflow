import { useMemo } from 'react';
import type { Payment } from '../../types';
import { paymentMethodFlows } from '../../lib/paymentMethodFlows';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { downloadCsv } from '../../lib/csvExport';
import { paymentMethodCsvAmount } from '../../lib/paymentMethodCsvAmount';
import { formatCurrency } from '../../lib/utils';
import { RowTable } from '../ui/RowTable';
import { paymentMethodLabel } from './paymentMethodLabel';
import { useReportText } from './useReportText';

interface Props {
  payments: readonly Payment[];
  workspaceId: string;
  homeCurrency: string;
  startDate: string;
  endDate: string;
  loading: boolean;
  incomplete: boolean;
}

export default function PaymentFlowsByMethodPanel({
  payments, workspaceId, homeCurrency, startDate, endDate, loading, incomplete,
}: Props) {
  const reportText = useReportText();
  const valid = validCustomReportPeriod({ startDate, endDate });
  const summary = useMemo(() => valid && !loading
    ? paymentMethodFlows(payments, { startDate, endDate }, workspaceId, homeCurrency)
    : null, [payments, valid, loading, startDate, endDate, workspaceId, homeCurrency]);
  const canDownload = Boolean(summary?.readyForExport && !loading && !incomplete);

  const download = () => {
    if (!summary || !canDownload) return;
    downloadCsv(`payment-methods-in-out-${startDate}-to-${endDate}.csv`,
      ['Method', 'Currency', 'Received count', 'Received amount', 'Paid count', 'Paid amount'],
      summary.rows.map(row => [
        row.method, row.currency, String(row.receivedCount), paymentMethodCsvAmount(row.receivedCents, row.currency),
        String(row.madeCount), paymentMethodCsvAmount(row.madeCents, row.currency),
      ]));
  };

  return <section aria-label={reportText('r.payment-in-and-out-by-method', 'Payment in and out by method')} className="space-y-3 border-t border-[var(--line)] pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold text-[var(--text)]">{reportText('r.money-in-and-out-by-payment-method', 'Money in and out by payment method')}</h3>
      {(summary?.rows.length || summary?.undatedCount || summary?.unverifiedCount) ? <button type="button" onClick={download} disabled={!canDownload}
        className="min-h-11 rounded-lg border border-[var(--line)] px-3 text-sm font-medium text-[var(--text)] disabled:opacity-40">
        {reportText('r.download-payment-method-csv', 'Download payment method CSV')}
      </button> : null}
    </div>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.posted-received-and-outgoing-payment-records-in', 'Posted received and outgoing payment records in the chosen period, grouped by recorded method and original currency. These are payment documents, not invoice revenue or an account reconciliation. Currencies are never added together; allocations do not multiply a payment.')}
    </p>
    {loading && <p role="status">{reportText('r.loading-payment-records', 'Loading payment records…')}</p>}
    {incomplete && <p role="alert">{reportText('r.loaded-payment-records-may-be-incomplete-or-fail', 'Loaded payment records may be incomplete or failed to load. CSV export is disabled.')}</p>}
    {summary && (summary.undatedCount > 0 || summary.unverifiedCount > 0) && <p role="alert">
      {summary.undatedCount} {reportText('r.posted-payments-lack-a-valid-date-and', 'posted payments lack a valid date and')} {summary.unverifiedCount} {reportText('r.have-unsafe-amount-or-currency-values-these-reco', 'have unsafe amount or currency values. These records are excluded; review them before exporting.')}
    </p>}
    {summary && summary.impliedCurrencyCount > 0 && <p className="text-sm text-[var(--muted)]">
      {summary.impliedCurrencyCount} {reportText('r.payments-have-no-stored-currency-the-current-wor', 'payments have no stored currency; the current workspace currency was used.')}
    </p>}
    {valid && !loading && !incomplete && summary && !summary.undatedCount && !summary.unverifiedCount && summary.rows.length === 0
      ? <p className="text-sm text-[var(--muted)]">{reportText('r.no-dated-posted-payments-found-in-this-period', 'No dated posted payments found in this period.')}</p>
      : null}
    {summary && summary.rows.length > 0 && <div className="max-w-full overflow-x-auto rounded-lg border border-[var(--line)]">
      <RowTable
        rowClassName="border-t border-[var(--line)]"
        caption={(<>{reportText('r.posted-payment-document-totals-by-method-and-cur', 'Posted payment document totals by method and currency, received and paid separately')}</>)}
        rows={summary.rows}
        rowKey={row => row.method + ':' + row.currency}
        tableClassName="comparison-report-table min-w-full text-start text-sm"
        headRowClassName="bg-[var(--surface)]"
        bodyClassName=""
        columns={[
          { header: reportText('r.method', 'Method'), className: "p-2 font-medium", headClassName: "p-2", cell: (row) => <bdi>{paymentMethodLabel(row.method, reportText)}</bdi> },
          { header: reportText('r.currency-2', 'Currency'), className: "p-2", headClassName: "p-2", cell: (row) => row.currency },
          { header: reportText('r.received', 'Received'), align: 'right', className: "p-2", headClassName: "p-2", cell: (row) => <bdi dir="ltr" className="whitespace-nowrap">{row.receivedCount} / {formatCurrency(row.receivedCents, row.currency)}</bdi> },
          { header: reportText('r.paid', 'Paid'), align: 'right', className: "p-2", headClassName: "p-2", cell: (row) => <bdi dir="ltr" className="whitespace-nowrap">{row.madeCount} / {formatCurrency(row.madeCents, row.currency)}</bdi> },
        ]}
      />
    </div>}
  </section>;
}
