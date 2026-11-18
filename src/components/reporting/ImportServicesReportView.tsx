import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { importBillsReview, importBillsCsvRows, IMPORT_BILLS_CSV_HEADERS } from '../../lib/tax/ilImportServices';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import type { Bill, Vendor } from '../../types';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

/**
 * A-56: the bills the Israeli import rules can apply to. Recorded bills in the period whose
 * vendor's recorded country is not Israel are listed with the Israeli VAT rate in force on the
 * bill's date and a reference amount — services are self-assessed in the periodic return (Section
 * 20, מע״מ עסקאות) and goods' VAT is paid to customs at the import, and this screen never decides
 * which a bill was. Read-only: nothing is posted, accrued or filed, and a foreign-currency bill is
 * counted, never converted.
 */
export default function ImportServicesReportView({ endDate = '' }: { endDate?: string }) {
  const reportText = useReportText();
  const bills = useLedgerStore(state => state.bills);
  const vendors = useLedgerStore(state => state.vendors);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('bills', 'vendors');
  const [chosenFrom, setChosenFrom] = useState<string | null>(null);

  const to = endDate || getLocalDateISO();
  const valid = validCustomReportPeriod({ startDate: to, endDate: to });
  const from = chosenFrom && validCustomReportPeriod({ startDate: chosenFrom, endDate: chosenFrom }) ? chosenFrom : `${to.slice(0, 4)}-01-01`;
  const homeCurrency = (workspace?.currency || 'ILS').toUpperCase();

  const review = useMemo(() => importBillsReview({
    bills: bills as Bill[], vendors: vendors as Vendor[], from, to, workspaceId: workspaceId || undefined, homeCurrency,
  }), [bills, vendors, from, to, workspaceId, homeCurrency]);

  const partial = truncated.bills || failed.bills || truncated.vendors || failed.vendors;
  const money = (cents: number) => formatCurrency(cents, homeCurrency);

  return <section aria-label={reportText('r.purchases-from-abroad', 'Purchases from abroad')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.purchases-from-abroad', 'Purchases from abroad')}</h2>
    <p className="text-sm text-[var(--muted)]">{reportText('r.read-only-recorded-bills-of-the-period-whose-ven', 'Read-only. Recorded bills of the period whose vendor\'s recorded country is not Israel. An Israeli business accounts for the Israeli VAT on such a purchase itself: on services by self-assessment in the periodic return (VAT Law Section 20, מע״מ עסקאות), and on goods at the import, where customs collects. This screen lists the bills and the rate in force on each date; it never decides which a bill was, posts, accrues or files anything.')}</p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1">{reportText('r.from', 'From')}
        <input aria-label={reportText('r.import-review-from-date', 'Import review from date')} type="date" className={field} value={from} onChange={event => setChosenFrom(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">{reportText('r.to', 'To')}
        <input aria-label={reportText('r.import-review-to-date', 'Import review to date')} type="date" className={field} value={to} readOnly />
      </label>
      <button type="button" className="btn-secondary min-h-11 px-3" disabled={!review.rows.length} onClick={() => downloadCsv(
        `purchases-from-abroad-${from}-${to}.csv`, IMPORT_BILLS_CSV_HEADERS, importBillsCsvRows(review),
      )}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {loading && <p role="status">{reportText('r.loading-bills-and-vendors', 'Loading bills and vendors…')}</p>}
    {!valid && <p role="alert">{reportText('r.choose-a-valid-end-date-on-the-report', 'Choose a valid end date on the report.')}</p>}
    {review.problem && <p role="alert">{review.problem}</p>}
    {partial && <p role="alert">{reportText('r.loaded-bill-or-vendor-history-is-incomplete-or-f', 'Loaded bill or vendor history is incomplete or failed to load. Bills or vendors that are not loaded are not shown, and a vendor whose record is not loaded looks like a vendor with no recorded country.')}</p>}

    {!review.problem && <>
      <p className="text-sm"><b>{review.totals.bills} {reportText('r.bill-s-from-vendors-recorded-abroad', 'bill(s) from vendors recorded abroad,')} {money(review.totals.amountCents)} {reportText('r.in-total', 'in total')}</b>{review.totals.referenceVatCents > 0 && <> {reportText('r.reference-israeli-vat-at-the-rates-in-force', '· reference Israeli VAT at the rates in force:')} {money(review.totals.referenceVatCents)} {reportText('r.an-indication-for-the-reviewer-never-an-accrual', '— an indication for the reviewer, never an accrual')}</>}.</p>
      <p className="text-sm text-[var(--muted)]">{reportText('r.not-listed', 'Not listed:')} {review.skipped.israeliVendor} {reportText('r.bill-s-from-vendors-recorded-in-israel', 'bill(s) from vendors recorded in Israel ·')} {review.skipped.countryNotRecorded} {reportText('r.whose-vendor-s-country-is-not-recorded-review-th', 'whose vendor\'s country is not recorded (review them — they cannot be told from here) ·')} {review.skipped.otherCurrency} {reportText('r.in-another-currency-counted-never-converted', 'in another currency (counted, never converted) ·')} {review.skipped.undated} {reportText('r.without-a-date', 'without a date ·')} {review.skipped.notRecorded} {reportText('r.draft-void-or-cancelled', 'draft, void or cancelled.')}</p>
    </>}

    {review.rows.length > 0 && <ReportTableScroll><RowTable
      rowClassName="border-t border-[var(--line)] align-top"
      caption={(<>{reportText('r.bills-dated', 'Bills dated')} {from} {reportText('r.to-2', 'to')} {to} {reportText('r.from-vendors-whose-recorded-country-is-not-israe', 'from vendors whose recorded country is not Israel')}</>)}
      rows={review.rows}
      rowKey={row => row.billId}
      captionClassName=""
      tableClassName="w-full text-sm"
      headRowClassName=""
      bodyClassName=""
      columns={[
        { header: reportText('r.bill-2', 'Bill'), className: "text-left", headClassName: "", cell: (row) => (<><bdi>{row.date} · {row.billNumber || row.billId}</bdi><div className="text-xs text-[var(--muted)]"><bdi>{row.note}</bdi></div></>) },
        { header: reportText('r.vendor', 'Vendor'), headClassName: "", cell: (row) => <bdi>{row.vendor || '—'}</bdi> },
        { header: reportText('r.country', 'Country'), headClassName: "", cell: (row) => row.vendorCountry },
        { header: reportText('r.amount', 'Amount'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => money(row.amountCents) },
        { header: reportText('r.vat-on-the-bill', 'VAT on the bill'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => row.vatOnBillCents > 0 ? money(row.vatOnBillCents) : '—' },
        { header: reportText('r.il-rate', 'IL rate'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => row.ilRate !== undefined ? `${(row.ilRate * 100).toFixed(0)}%` : '—' },
        { header: reportText('r.reference-vat', 'Reference VAT'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => money(row.referenceVatCents) },
      ]}
    /></ReportTableScroll>}

    {!loading && !review.problem && review.rows.length === 0 && <p>{reportText('r.no-recorded-bill-in-this-period-is-from-a-vendor', 'No recorded bill in this period is from a vendor whose recorded country is not Israel. A vendor\'s country comes from its recorded tax place; vendors without one are counted above, never assumed.')}</p>}
  </section>;
}
