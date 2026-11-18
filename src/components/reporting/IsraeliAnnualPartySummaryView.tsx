/**
 * A-189: Israeli annual summary per customer & vendor (working paper for the accountant).
 *
 * Calculation / working-paper report — never files with the Israel Tax Authority, always masks
 * tax/VAT numbers (`••••1234`) in on-screen tables and exported CSV files, checks Israeli invoice
 * allocation number (`mispar haktsa'a`) completeness against `needsAllocationNumber`, and summarizes
 * supplier source tax withheld alongside Form 856.
 */
import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import {
  computeIsraeliAnnualSummary,
  IL_ANNUAL_CUSTOMER_CSV_HEADERS,
  IL_ANNUAL_VENDOR_CSV_HEADERS,
} from '../../lib/israeliAnnualPartySummary';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

export default function IsraeliAnnualPartySummaryView() {
  const reportText = useReportText();
  const customers = useLedgerStore(s => s.customers);
  const vendors = useLedgerStore(s => s.vendors);
  const invoices = useLedgerStore(s => s.invoices);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const bills = useLedgerStore(s => s.bills);
  const vendorCredits = useLedgerStore(s => s.vendorCredits);
  const payments = useLedgerStore(s => s.payments);
  const { loading } = useLedgerCollections(
    'customers', 'vendors', 'invoices', 'creditNotes', 'bills', 'vendorCredits', 'payments',
  );
  const baseCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'ILS';

  const currentYear = Number(getLocalDateISO().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState<'customers' | 'vendors'>('customers');

  const summary = useMemo(
    () => computeIsraeliAnnualSummary({
      year,
      baseCurrency,
      customers: customers || [],
      vendors: vendors || [],
      invoices: invoices || [],
      creditNotes: creditNotes || [],
      bills: bills || [],
      vendorCredits: vendorCredits || [],
      payments: payments || [],
    }),
    [year, baseCurrency, customers, vendors, invoices, creditNotes, bills, vendorCredits, payments],
  );

  const exportCsv = () => {
    if (tab === 'customers') {
      downloadCsv(
        `il-annual-customers-${year}.csv`,
        IL_ANNUAL_CUSTOMER_CSV_HEADERS,
        summary.customers.map(r => [
          r.customerName, r.maskedTaxId, r.documentCount, r.netSalesCents, r.vatChargedCents,
          r.grossBilledCents, r.collectionsInYearCents, r.closingOpenCents,
          r.allocationRequiredCount, r.allocationMissingCount, r.foreignDocCount,
        ]),
      );
    } else {
      downloadCsv(
        `il-annual-vendors-${year}.csv`,
        IL_ANNUAL_VENDOR_CSV_HEADERS,
        summary.vendors.map(r => [
          r.vendorName, r.maskedTaxId, r.documentCount, r.grossBilledCents, r.inputVatCents,
          r.paymentsInYearCents, r.taxWithheldCents, r.withholdingCertificate,
          r.closingOpenCents, r.foreignDocCount,
        ]),
      );
    }
  };

  if (loading) {
    return <p className="p-6 text-sm text-slate-600 dark:text-slate-400">{reportText('r.loading-annual-customer-amp-vendor-working-paper', 'Loading annual customer & vendor working paper…')}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-indigo-600" aria-hidden="true" />
            {reportText('r.israel-annual-customer-amp-vendor-summary', 'Israel: Annual Customer & Vendor Summary')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {reportText('r.year-end-accountant-working-paper-calculation-on', 'Year-end accountant working paper (calculation only — not an official Israel Tax Authority filing). Summarizes annual billed turnover, VAT, allocation number checks, source tax withheld, collections/payments, and year-end open balances in')} {baseCurrency} {reportText('r.using-each-documents-stored-exchange-rate', 'using each document\'s stored exchange rate.')}
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2"
        >
          <Download className="w-4 h-4" aria-hidden="true" /> {reportText('r.export', 'Export')} {tab} {reportText('r.csv', 'CSV')}
        </button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <label htmlFor="il-annual-year" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            {reportText('r.tax-year', 'Tax year')}
          </label>
          <select
            id="il-annual-year"
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="min-h-11 px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
          >
            {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div role="tablist" aria-label={reportText('r.party-side', 'Party side')} className="flex gap-2">
          <button
            role="tab"
            type="button"
            aria-selected={tab === 'customers'}
            onClick={() => setTab('customers')}
            className={`min-h-11 px-4 py-2 text-sm font-semibold rounded-lg border ${
              tab === 'customers'
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
            }`}
          >
            {reportText('r.customers', 'Customers (')}{summary.customers.length})
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={tab === 'vendors'}
            onClick={() => setTab('vendors')}
            className={`min-h-11 px-4 py-2 text-sm font-semibold rounded-lg border ${
              tab === 'vendors'
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
            }`}
          >
            {reportText('r.vendors', 'Vendors (')}{summary.vendors.length})
          </button>
        </div>
      </div>

      {tab === 'customers' ? (
        summary.customers.length === 0 ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{reportText('r.no-issued-customer-activity-for', 'No issued customer activity for')} {year}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <RowTable
              rowHeaderColumn={false}
              caption={(<>{reportText('r.annual-customer-summary-for', 'Annual customer summary for')} {year}</>)}
              rows={summary.customers}
              rowKey={r => r.customerId}
              tableClassName="w-full text-sm text-start"
              headRowClassName="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400"
              bodyClassName="divide-y divide-slate-200 dark:divide-slate-800"
              columns={[
                { header: reportText('r.customer', 'Customer'), className: "px-4 py-3 font-medium text-slate-900 dark:text-white", headClassName: "px-4 py-3 text-start", cell: (r) => r.customerName },
                { header: reportText('r.dealer-vat-id', 'Dealer / VAT ID'), className: "px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400", headClassName: "px-4 py-3 text-start", cell: (r) => r.maskedTaxId || 'Missing' },
                { header: reportText('r.docs', 'Docs'), className: "px-4 py-3 text-end tabular-nums", headClassName: "px-4 py-3 text-end", cell: (r) => r.documentCount },
                { header: reportText('r.net-pre-vat', 'Net pre-VAT'), className: "px-4 py-3 text-end tabular-nums", headClassName: "px-4 py-3 text-end", cell: (r) => formatCurrency(r.netSalesCents, baseCurrency) },
                { header: reportText('r.vat', 'VAT'), className: "px-4 py-3 text-end tabular-nums", headClassName: "px-4 py-3 text-end", cell: (r) => formatCurrency(r.vatChargedCents, baseCurrency) },
                { header: reportText('r.gross-billed', 'Gross billed'), className: "px-4 py-3 text-end tabular-nums font-semibold", headClassName: "px-4 py-3 text-end", cell: (r) => formatCurrency(r.grossBilledCents, baseCurrency) },
                { header: reportText('r.collected', 'Collected'), className: "px-4 py-3 text-end tabular-nums", headClassName: "px-4 py-3 text-end", cell: (r) => formatCurrency(r.collectionsInYearCents, baseCurrency) },
                { header: reportText('r.closing-open', 'Closing open'), className: "px-4 py-3 text-end tabular-nums", headClassName: "px-4 py-3 text-end", cell: (r) => formatCurrency(r.closingOpenCents, baseCurrency) },
                { header: reportText('r.allocation-check-2', 'Allocation # check'), className: "px-4 py-3 text-xs", headClassName: "px-4 py-3 text-start", cell: (r) => r.allocationMissingCount > 0 ? (
                        <span className="font-semibold text-rose-700 dark:text-rose-300">
                          {r.allocationMissingCount} {reportText('r.missing-of', 'missing of')} {r.allocationRequiredCount}
                        </span>
                      ) : r.allocationRequiredCount > 0 ? (
                        <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                          {r.allocationRecordedCount}/{r.allocationRequiredCount} {reportText('r.recorded', 'recorded')}
                        </span>
                      ) : (
                        '—'
                      ) },
              ]}
            />
          </div>
        )
      ) : summary.vendors.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{reportText('r.no-issued-vendor-activity-for', 'No issued vendor activity for')} {year}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <RowTable
            rowHeaderColumn={false}
            caption={(<>{reportText('r.annual-vendor-summary-for', 'Annual vendor summary for')} {year}</>)}
            rows={summary.vendors}
            rowKey={r => r.vendorId}
            tableClassName="w-full text-sm text-start"
            headRowClassName="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400"
            bodyClassName="divide-y divide-slate-200 dark:divide-slate-800"
            columns={[
              { header: reportText('r.vendor', 'Vendor'), className: "px-4 py-3 font-medium text-slate-900 dark:text-white", headClassName: "px-4 py-3 text-start", cell: (r) => r.vendorName },
              { header: reportText('r.dealer-tax-id', 'Dealer / Tax ID'), className: "px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400", headClassName: "px-4 py-3 text-start", cell: (r) => r.maskedTaxId || 'Missing' },
              { header: reportText('r.docs', 'Docs'), className: "px-4 py-3 text-end tabular-nums", headClassName: "px-4 py-3 text-end", cell: (r) => r.documentCount },
              { header: reportText('r.gross-billed', 'Gross billed'), className: "px-4 py-3 text-end tabular-nums font-semibold", headClassName: "px-4 py-3 text-end", cell: (r) => formatCurrency(r.grossBilledCents, baseCurrency) },
              { header: reportText('r.input-vat', 'Input VAT'), className: "px-4 py-3 text-end tabular-nums", headClassName: "px-4 py-3 text-end", cell: (r) => formatCurrency(r.inputVatCents, baseCurrency) },
              { header: reportText('r.paid-in-year', 'Paid in year'), className: "px-4 py-3 text-end tabular-nums", headClassName: "px-4 py-3 text-end", cell: (r) => formatCurrency(r.paymentsInYearCents, baseCurrency) },
              { header: reportText('r.tax-withheld', 'Tax withheld'), className: "px-4 py-3 text-end tabular-nums", headClassName: "px-4 py-3 text-end", cell: (r) => formatCurrency(r.taxWithheldCents, baseCurrency) },
              { header: reportText('r.wht-cert', 'WHT cert'), className: "px-4 py-3 text-xs text-slate-600 dark:text-slate-400", headClassName: "px-4 py-3 text-start", cell: (r) => r.withholdingCertificate },
              { header: reportText('r.closing-open', 'Closing open'), className: "px-4 py-3 text-end tabular-nums", headClassName: "px-4 py-3 text-end", cell: (r) => formatCurrency(r.closingOpenCents, baseCurrency) },
            ]}
          />
        </div>
      )}
    </div>
  );
}
