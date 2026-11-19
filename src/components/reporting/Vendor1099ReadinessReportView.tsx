import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import {
  VENDOR_1099_CSV_HEADERS, vendor1099CsvRows, vendor1099Readiness,
  type ReadinessVendor, type VendorReadinessReport, type VendorReadinessRow,
} from '../../lib/vendor1099Readiness';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import type { Payment } from '../../types';
import { RowTable } from '../ui/RowTable';
import { useReportText, fill } from './useReportText';

/** Code names, form numbers, paths and identifiers shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { c0: 'W-9' } as const;

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const YEAR = /^\d{4}$/;

/**
 * A-188: who is close to a year-end US 1099 and what is missing on the vendor record.
 * Read-only; posted outgoing payments are the only money counted.
 */
export default function Vendor1099ReadinessReportView() {
  const vendors = useLedgerStore(state => state.vendors);
  const payments = useLedgerStore(state => state.payments);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('vendors', 'payments');
  const [taxYearText, setTaxYearText] = useState(String(new Date().getFullYear()));
  const homeCurrency = workspace?.currency || 'USD';
  const validYear = YEAR.test(taxYearText) && Number(taxYearText) >= 2020 && Number(taxYearText) <= 2099;

  const report = useMemo(() => {
    if (!validYear) return null;
    return vendor1099Readiness({
      vendors: vendors.filter(vendor => !workspaceId || vendor.workspaceId === workspaceId) as unknown as ReadinessVendor[],
      payments: payments.filter(payment => !workspaceId || payment.workspaceId === workspaceId) as unknown as Payment[],
      taxYear: Number(taxYearText),
      homeCurrency,
    });
  }, [vendors, payments, workspaceId, homeCurrency, taxYearText, validYear]);

  const partial = Boolean(truncated.vendors || failed.vendors || truncated.payments || failed.payments);
  return <Vendor1099ReadinessPanel report={report} currency={homeCurrency} taxYearText={taxYearText} onTaxYearChange={setTaxYearText}
    loading={loading} partial={partial} validYear={validYear} />;
}

export function Vendor1099ReadinessPanel({ report, currency = 'USD', taxYearText, onTaxYearChange, loading = false, partial = false, validYear = true }: {
  report: VendorReadinessReport | null;
  currency?: string;
  taxYearText: string;
  onTaxYearChange: (value: string) => void;
  loading?: boolean;
  partial?: boolean;
  validYear?: boolean;
}) {
  const reportText = useReportText();
  const [needsAttention, setNeedsAttention] = useState(false);
  const rows = report?.rows || [];
  const visible: VendorReadinessRow[] = needsAttention
    ? rows.filter(row => row.overThreshold && row.state === 'needs-tax-details')
    : rows;

  return <section aria-label={reportText('r.vendor-1099-readiness', 'Vendor 1099 readiness')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.vendor-1099-readiness', 'Vendor 1099 readiness')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.us-information-returns-are-prepared-from-what-wa', 'US information returns are prepared from what was actually paid, so this report adds up posted outgoing payments in the workspace currency for the chosen year and compares each vendor with the existing 1099 threshold table. It shows the tax ID as a mask only, never the number. A recorded ID is not a check that it is correct, no country is assumed when none is recorded, this workspace has no W-9 field so no form is claimed to be on file, and nothing here files a form, edits a vendor or posts anything.')}
    </p>

    {loading && <p role="status">{reportText('r.loading-vendors-and-payments', 'Loading vendors and payments…')}</p>}
    {partial && <p role="alert">{reportText('r.a-loaded-vendor-or-payment-list-is-capped-or-fai', 'A loaded vendor or payment list is capped or failed. Totals and the export are provisional until both lists are complete.')}</p>}
    {!validYear && <p role="alert">{reportText('r.choose-a-tax-year-between-2020-and-2099', 'Choose a tax year between 2020 and 2099.')}</p>}

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.tax-year', 'Tax year')}
        <input aria-label={reportText('r.tax-year', 'Tax year')} className={field} inputMode="numeric" value={taxYearText} onChange={event => onTaxYearChange(event.target.value)} />
      </label>
      <label className="min-h-11 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={needsAttention} onChange={event => setNeedsAttention(event.target.checked)} />
        {reportText('r.only-over-the-threshold-with-missing-details', 'Only over the threshold with missing details')}
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!report || loading || partial || !visible.length}
        onClick={() => report && downloadCsv(`vendor-1099-readiness-${report.taxYear}`, VENDOR_1099_CSV_HEADERS, vendor1099CsvRows({ ...report, rows: visible }))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {report && <>
      <p className="text-sm">
        <b>{reportText('r.threshold-for', 'Threshold for')} {report.taxYear}:</b> {formatCurrency(report.thresholdCents, currency)} · <b>{reportText('r.vendors-paid', 'Vendors paid:')}</b> {rows.length} ·
        {' '}<b>{reportText('r.over-the-threshold', 'Over the threshold:')}</b> {rows.filter(row => row.overThreshold).length}
      </p>
      {(report.skippedForeignCurrencyPayments > 0 || report.ignoredPayments > 0 || report.outsideTaxYear > 0 || report.unmarkedWithPayments > 0) && <p className="text-sm text-[var(--muted)]">
        {reportText('r.not-counted', 'Not counted:')} {report.skippedForeignCurrencyPayments} {reportText('r.payment-s-in-another-currency', 'payment(s) in another currency,')} {report.ignoredPayments} {reportText('r.not-a-posted-outgoing-payment', 'not a posted outgoing payment,')} {report.outsideTaxYear} {reportText('r.dated-outside', 'dated outside')} {report.taxYear}.
        {report.unmarkedWithPayments > 0 ? ` ${fill(reportText('r.0-vendor-s-with-payments-are-not-marked-as-1099', '{0} vendor(s) with payments are not marked as 1099 vendors — that is flagged below, not hidden.'), { 0: report.unmarkedWithPayments })}` : ''}
      </p>}

      <ReportTableScroll>
        <RowTable
          rowClassName="border-b border-[var(--line)]/50 align-top"
          caption={(<>{reportText('r.vendors-with-posted-payments-in', 'Vendors with posted payments in')} {report.taxYear}{reportText('r.and-what-their-record-is-missing', ', and what their record is missing')}</>)}
          rows={visible}
          rowKey={row => row.vendorId}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          columns={[
            { header: reportText('r.vendor', 'Vendor'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => (<><bdi>{row.vendor}</bdi><div className="text-xs text-[var(--muted)]"><code>{row.vendorId}</code></div></>) },
            { header: reportText('r.tax-country', 'Tax country'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.country },
            { header: reportText('r.paid', 'Paid'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.paidCents, currency) },
            { header: reportText('r.over-threshold', 'Over threshold'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.overThreshold ? 'Yes' : 'No' },
            { header: reportText('r.tax-id', 'Tax ID'), className: "py-1 px-2 font-mono", headClassName: "text-left py-1 px-2", cell: (row) => row.taxId.masked || 'Not recorded' },
            { header: reportText('r.address', 'Address'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.addressRecorded ? 'Recorded' : 'Missing' },
            { header: CODE_NAMES.c0, className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (_row) => (<>{reportText('r.not-recorded-here', 'Not recorded here')}</>) },
            { header: reportText('r.readiness', 'Readiness'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.state === 'needs-tax-details' ? 'Missing details' : row.state === 'over-threshold' ? 'Details recorded — review' : 'Below the threshold' },
            { header: reportText('r.what-to-check', 'What to check'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.missing.join(' ') },
          ]}
        />
        {!loading && !visible.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-posted-vendor-payment-in', 'No posted vendor payment in')} {report.taxYear}{needsAttention ? ` ${reportText('r.needs-attention', 'needs attention')}` : ''}{reportText('r.a-year-with-no-payments-owes-no-1099-from-this-d', '. A year with no payments owes no 1099 from this data.')}</p>}
      </ReportTableScroll>
    </>}
  </section>;
}
