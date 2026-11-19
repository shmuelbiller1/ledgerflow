import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { reviewUseTax, reviewUseTaxCsvRows, USE_TAX_CSV_HEADERS, USE_TAX_STATES } from '../../lib/tax/usUseTax';
import { US_STATE_SALES_TAX, NO_STATE_SALES_TAX } from '../../lib/tax/usStateSalesTax';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import type { Bill } from '../../types';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const STATE_NAMES = new Map(US_STATE_SALES_TAX.map(row => [row.state, row.stateName]));

/**
 * A-54: the "use tax you may owe" review. Recorded bills in the period that carry no sales tax are
 * listed for the chosen state: the base of each bill by the item's own tax category in that state
 * (A-31's answers), the state-level rate in force on the bill's date (A-22's table) and the
 * estimated use tax. Read-only: it never changes a bill, never accrues and never posts; paying use
 * tax happens on the state's own return. Lines with no item or a category the state leaves open are
 * listed for review and never estimated; bills in another currency are counted, never converted.
 */
export default function UseTaxReportView({ endDate = '' }: { endDate?: string }) {
  const reportText = useReportText();
  const bills = useLedgerStore(state => state.bills);
  const items = useLedgerStore(state => state.inventory);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('bills', 'inventory');
  const [chosenFrom, setChosenFrom] = useState<string | null>(null);
  const [chosenState, setChosenState] = useState('');

  const to = endDate || getLocalDateISO();
  const valid = validCustomReportPeriod({ startDate: to, endDate: to });
  const from = chosenFrom && validCustomReportPeriod({ startDate: chosenFrom, endDate: chosenFrom }) ? chosenFrom : `${to.slice(0, 4)}-01-01`;
  const homeCurrency = (workspace?.currency || 'USD').toUpperCase();

  const review = useMemo(() => reviewUseTax({
    bills: bills as Bill[], items, state: chosenState, from, to, workspaceId: workspaceId || undefined, homeCurrency,
  }), [bills, items, chosenState, from, to, workspaceId, homeCurrency]);

  const partial = truncated.bills || failed.bills || truncated.inventory || failed.inventory;
  const money = (cents: number) => formatCurrency(cents, homeCurrency);
  const noTaxStates = NO_STATE_SALES_TAX;

  return <section aria-label={reportText('r.use-tax-review', 'Use tax review')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.use-tax-review', 'Use tax review')}</h2>
    <p className="text-sm text-[var(--muted)]">{reportText('r.read-only-when-a-seller-charged-no-sales-tax-on', 'Read-only. When a seller charged no sales tax on a purchase and the purchase is taxable in the state where this workspace uses it, that state\'s use tax generally applies at its own sales-tax rate. This screen lists the recorded bills of the period that carry no tax, splits each base by the item\'s tax category in the chosen state, and estimates the state-level tax. It never changes a bill, accrues or posts anything: use tax is reported and paid on the state\'s own return.')}</p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1">{reportText('r.state-the-purchases-are-used-in', 'State the purchases are used in')}
        <select aria-label={reportText('r.use-tax-state', 'Use tax state')} className={field} value={chosenState} onChange={event => setChosenState(event.target.value)}>
          <option value="">{reportText('r.choose-a-state', 'Choose a state…')}</option>
          {USE_TAX_STATES.map(code => <option key={code} value={code}>{code} — {STATE_NAMES.get(code) || code}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">{reportText('r.from', 'From')}
        <input aria-label={reportText('r.use-tax-from-date', 'Use tax from date')} type="date" className={field} value={from} onChange={event => setChosenFrom(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">{reportText('r.to', 'To')}
        <input aria-label={reportText('r.use-tax-to-date', 'Use tax to date')} type="date" className={field} value={to} readOnly />
      </label>
      <button type="button" className="btn-secondary min-h-11 px-3" disabled={!review.rows.length} onClick={() => downloadCsv(
        `use-tax-review-${chosenState || 'state'}-${from}-${to}.csv`, USE_TAX_CSV_HEADERS, reviewUseTaxCsvRows(review),
      )}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {loading && <p role="status">{reportText('r.loading-bills-and-items', 'Loading bills and items…')}</p>}
    {!valid && <p role="alert">{reportText('r.choose-a-valid-end-date-on-the-report', 'Choose a valid end date on the report.')}</p>}
    {review.problem && <p role="note">{review.problem}</p>}
    {partial && <p role="alert">{reportText('r.loaded-bill-or-item-history-is-incomplete-or-fai', 'Loaded bill or item history is incomplete or failed to load. Bills that are not loaded are not shown and are not treated as tax-free.')}</p>}
    <p className="text-sm text-[var(--muted)]">{reportText('r.the-estimate-is-state-level-only-county-city-and', 'The estimate is state-level only: county, city and district additions follow the state\'s own rules and are not concluded here. States with no state sales tax (')}{noTaxStates.join(', ')}{reportText('r.have-no-state-use-tax-in-this-table', ') have no state use tax in this table.')}</p>

    {chosenState && !review.problem && <>
      <p className="text-sm"><b>{reportText('r.estimated-use-tax', 'Estimated use tax')} {from} {reportText('r.to-2', 'to')} {to}: {money(review.totals.estimatedUseTaxCents)}</b> {reportText('r.on-2', 'on')} {money(review.totals.taxableCents)} {reportText('r.of-taxable-and-reduced-rate-bases', 'of taxable and reduced-rate bases')}{review.totals.unclearCents > 0 && <> · {money(review.totals.unclearCents)} {reportText('r.of-lines-need-a-person-s-review-and-are-not-esti', 'of lines need a person\'s review and are not estimated')}</>}.</p>
      <p className="text-sm text-[var(--muted)]">{reportText('r.skipped', 'Skipped:')} {review.skipped.taxCharged} {reportText('r.bill-s-already-carry-sales-tax', 'bill(s) already carry sales tax ·')} {review.skipped.otherCurrency} {reportText('r.in-another-currency-not-converted', 'in another currency (not converted) ·')} {review.skipped.undated} {reportText('r.without-a-date', 'without a date ·')} {review.skipped.notRecorded} {reportText('r.draft-void-or-cancelled', 'draft, void or cancelled.')}</p>
    </>}

    {review.rows.length > 0 && <ReportTableScroll><RowTable
      rowClassName="border-t border-[var(--line)] align-top"
      caption={(<>{reportText('r.bills-dated', 'Bills dated')} {from} {reportText('r.to-2', 'to')} {to} {reportText('r.with-no-sales-tax-recorded-reviewed-for', 'with no sales tax recorded, reviewed for')} {chosenState} {reportText('r.use-tax', 'use tax')}</>)}
      rows={review.rows}
      rowKey={row => row.billId}
      captionClassName=""
      tableClassName="w-full text-sm"
      headRowClassName=""
      bodyClassName=""
      columns={[
        { header: reportText('r.bill-2', 'Bill'), className: "text-left", headClassName: "", cell: (row) => (<><bdi>{row.date} · {row.billNumber || row.billId}</bdi>{row.note && <div className="text-xs text-[var(--muted)]">{row.note}</div>}</>) },
        { header: reportText('r.vendor', 'Vendor'), headClassName: "", cell: (row) => <bdi>{row.vendor || '—'}</bdi> },
        { header: reportText('r.taxable', 'Taxable'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => money(row.taxableCents) },
        { header: reportText('r.reduced', 'Reduced'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => row.reducedCents ? money(row.reducedCents) : '—' },
        { header: reportText('r.exempt', 'Exempt'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => row.exemptCents ? money(row.exemptCents) : '—' },
        { header: reportText('r.needs-review-2', 'Needs review'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => row.unclearCents ? money(row.unclearCents) : '—' },
        { header: reportText('r.state-rate', 'State rate'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => row.rate !== undefined ? `${(row.rate * 100).toFixed(3).replace(/\.?(?<!0)0+$/, '')}%` : '—' },
        { header: reportText('r.estimated-use-tax', 'Estimated use tax'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => money(row.estimatedUseTaxCents) },
      ]}
    /></ReportTableScroll>}

    {!loading && chosenState && !review.problem && review.rows.length === 0 && <p>{reportText('r.no-recorded-bill-in-this-period-is-missing-sales', 'No recorded bill in this period is missing sales tax for')} {chosenState}{reportText('r.a-bill-is-reviewed-when-it-carries-no-tax-amount', '. A bill is reviewed when it carries no tax amount at all; a bill with any recorded tax is treated as taxed and skipped.')}</p>}
    {!chosenState && <p>{reportText('r.choose-the-state-the-purchases-are-used-in-to-re', 'Choose the state the purchases are used in to review them. The workspace\'s own state is not assumed: use tax follows where the goods are received or used.')}</p>}
  </section>;
}
