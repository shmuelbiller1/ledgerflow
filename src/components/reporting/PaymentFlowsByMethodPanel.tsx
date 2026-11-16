import { useMemo } from 'react';
import type { Payment } from '../../types';
import { paymentMethodFlows } from '../../lib/paymentMethodFlows';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { downloadCsv } from '../../lib/csvExport';
import { paymentMethodCsvAmount } from '../../lib/paymentMethodCsvAmount';
import { formatCurrency } from '../../lib/utils';
import { RowTable } from '../ui/RowTable';

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

  return <section aria-label="Payment in and out by method" className="space-y-3 border-t border-neutral-200 pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold text-neutral-900">Money in and out by payment method</h3>
      <button type="button" onClick={download} disabled={!canDownload}
        className="min-h-11 rounded-lg border border-neutral-300 px-3 text-sm font-medium text-neutral-800 disabled:opacity-40">
        Download payment method CSV
      </button>
    </div>
    <p className="text-sm text-neutral-600">
      Posted received and outgoing payment records in the chosen period, grouped by recorded method
      and original currency. These are payment documents, not invoice revenue or an account reconciliation.
      Currencies are never added together; allocations do not multiply a payment.
    </p>
    {loading && <p role="status">Loading payment records…</p>}
    {incomplete && <p role="alert">Loaded payment records may be incomplete or failed to load. CSV export is disabled.</p>}
    {summary && (summary.undatedCount > 0 || summary.unverifiedCount > 0) && <p role="alert">
      {summary.undatedCount} posted payments lack a valid date and {summary.unverifiedCount} have unsafe amount or currency values.
      These records are excluded; review them before exporting.
    </p>}
    {summary && summary.impliedCurrencyCount > 0 && <p className="text-sm text-neutral-600">
      {summary.impliedCurrencyCount} payments have no stored currency; the current workspace currency was used.
    </p>}
    {valid && !loading && summary && summary.rows.length === 0
      ? <p className="text-sm text-neutral-600">No dated posted payments found in this period.</p>
      : null}
    {summary && summary.rows.length > 0 && <div className="max-w-full overflow-x-auto rounded-lg border border-neutral-200">
      <RowTable
        rowClassName="border-t border-neutral-100"
        caption={(<>Posted payment document totals by method and currency, received and paid separately</>)}
        rows={summary.rows}
        rowKey={row => row.method + ':' + row.currency}
        tableClassName="min-w-full text-left text-sm"
        headRowClassName="bg-neutral-50"
        bodyClassName=""
        columns={[
          { header: "Method", className: "p-2 font-medium", headClassName: "p-2", cell: (row) => row.method },
          { header: "Currency", className: "p-2", headClassName: "p-2", cell: (row) => row.currency },
          { header: "Received", align: 'right', className: "p-2", headClassName: "p-2", cell: (row) => (<>{row.receivedCount} / {formatCurrency(row.receivedCents, row.currency)}</>) },
          { header: "Paid", align: 'right', className: "p-2", headClassName: "p-2", cell: (row) => (<>{row.madeCount} / {formatCurrency(row.madeCents, row.currency)}</>) },
        ]}
      />
    </div>}
  </section>;
}
