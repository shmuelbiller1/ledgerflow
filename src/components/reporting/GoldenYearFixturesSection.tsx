
import { useMemo } from 'react';
import {
  GOLDEN_IL_YEAR, GOLDEN_TX_YEAR, goldenIlYearTotals, goldenTxYearTotals, verifyGoldenYearFixtures,
  type GoldenYearCheck,
} from '../../lib/goldenYearFixtures';
import { US_1099_THRESHOLDS } from '../../lib/tax/us1099Thresholds';
import { formatCurrency } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';
import { useReportText, fill } from './useReportText';

const ils = (cents: number) => formatCurrency(cents, 'ILS');
const usd = (cents: number) => formatCurrency(cents, 'USD');

/**
 * A-198 / A-199: the full-year golden scenarios — an Israeli VAT year in six bi-monthly periods and
 * a Texas sales-tax year in four quarters — each checked live against the return libraries the
 * screens use. Read-only fixtures; nothing posts, files or closes.
 */
export default function GoldenYearFixturesSection() {
  const result = useMemo(() => verifyGoldenYearFixtures(), []);
  return <GoldenYearFixturesPanel result={result} />;
}

export function GoldenYearFixturesPanel({ result }: { result: { ilPeriods: number; txQuarters: number; failures: GoldenYearCheck[] } }) {
  const reportText = useReportText();
  const failedIds = new Set(result.failures.map(f => f.id));
  const ilTotals = goldenIlYearTotals();
  const txTotals = goldenTxYearTotals();
  return <section aria-label={reportText('r.full-year-golden-scenarios', 'Full-year golden scenarios')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.full-year-golden-scenarios', 'Full-year golden scenarios')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.one-israeli-year-2026-vat-18-reported-every-two', 'One Israeli year (2026, VAT 18%, reported every two months) and one Texas year (2026, reported quarterly), with every period’s figures worked by hand and written into the fixture. Each period is checked against the same return library the Tax return screen uses, so a change that would move a filed figure shows as a failure here. These are test fixtures, not workspace books: nothing posts, files or closes. US amounts are the Texas')} <strong>{reportText('r.state-base-rate-only', 'state base rate only')}</strong>{' '}
      {reportText('r.6-25-county-city-and-transit-taxes-are-not-inclu', '(6.25%) — county, city and transit taxes are not included and must never be read as the full amount due. Eilat is zero-rated through the existing special-area row; an exempt sale is reported apart from zero-rated, never mixed in.')}
    </p>

    <p className="text-sm font-semibold">
      {result.failures.length === 0
        ? fill(reportText('r.all-0-israeli-periods-and-1-texas-quarters-match', 'All {0} Israeli periods and {1} Texas quarters match the worked figures.'), { 0: result.ilPeriods, 1: result.txQuarters })
        : fill(reportText('r.0-full-year-check-s-fail-do-not-rely-on-the-affe', '{0} full-year check(s) fail — do not rely on the affected period until this is reviewed.'), { 0: result.failures.length })}
    </p>
    {result.failures.length > 0 && <ul className="text-sm list-disc ps-5" aria-label={reportText('r.full-year-failures', 'Full-year failures')}>
      {result.failures.map(f => <li key={`${f.id}-${f.detail}`}>{f.id}: {f.detail}</li>)}
    </ul>}

    <h3 className="font-semibold text-sm">{reportText('r.a-198-israel-vat-year-six-bi-monthly-periods', 'A-198 · Israel VAT year, six bi-monthly periods (₪)')}</h3>
    <ReportTableScroll nameFromCaption allowDisplayedExport={true}>
      <RowTable
        caption={reportText(
          'r.israeli-vat-year-taxable-zero-rated-and-exempt-s',
          'Israeli VAT year: taxable, zero-rated and exempt sales; equipment and other input VAT; to pay or reclaim',
        )}
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
        bodyClassName=""
        rowClassName="border-b border-[var(--line)]/50"
        rows={GOLDEN_IL_YEAR.periods}
        rowKey={(p) => p.period}
        footer={
          <tr className="border-t-2 border-[var(--line)] font-semibold">
            <th scope="row" className="text-left py-1 px-2">
              {reportText('r.year', 'Year')}
            </th>
            <td className="py-1 px-2 tabular-nums">{ils(ilTotals.taxableSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ils(ilTotals.outputVatCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ils(ilTotals.zeroRatedSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ils(ilTotals.exemptSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ils(ilTotals.fixedAssetInputVatCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ils(ilTotals.otherInputVatCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ils(ilTotals.toPayCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ilTotals.documentCount}</td>
            <td className="py-1 px-2" />
          </tr>
        }
        columns={[
          { header: reportText('r.col-period', 'Period'), headClassName: 'text-left py-1 px-2', className: 'text-left font-normal py-1 px-2', cell: (p) => p.period },
          {
            header: reportText('r.taxable-sales', 'Taxable sales'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (p) => ils(p.expected.taxableSalesCents),
          },
          {
            header: reportText('r.output-vat', 'Output VAT'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (p) => ils(p.expected.outputVatCents),
          },
          {
            header: reportText('r.zero-rated', 'Zero-rated'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (p) => ils(p.expected.zeroRatedSalesCents),
          },
          {
            header: reportText('r.exempt', 'Exempt'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (p) => ils(p.expected.exemptSalesCents),
          },
          {
            header: reportText('r.input-equipment', 'Input — equipment'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (p) => ils(p.expected.fixedAssetInputVatCents),
          },
          {
            header: reportText('r.input-other', 'Input — other'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (p) => ils(p.expected.otherInputVatCents),
          },
          {
            header: reportText('r.to-pay-reclaim-2', 'To pay / (reclaim)'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (p) => ils(p.expected.toPayCents),
          },
          {
            header: reportText('r.documents-heading', 'Documents'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (p) => p.expected.documentCount,
          },
          {
            header: reportText('r.check', 'Check'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2',
            cell: (p) => (failedIds.has(`A-198 ${p.period}`) ? reportText('r.fails-see-above', 'Fails — see above') : reportText('r.matches', 'Matches')),
          },
        ]}
      />
    </ReportTableScroll>

    <h3 className="font-semibold text-sm">{reportText('r.a-199-texas-sales-tax-year-four-quarters', 'A-199 · Texas sales-tax year, four quarters ($)')}</h3>
    <ReportTableScroll nameFromCaption allowDisplayedExport={true}>
      <RowTable
        caption={reportText(
          'r.texas-state-base-rate-6-25-only-gross-exempt-and',
          'Texas state base rate 6.25% only: gross, exempt and taxable sales with the tax collected',
        )}
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
        bodyClassName=""
        rowClassName="border-b border-[var(--line)]/50"
        rows={GOLDEN_TX_YEAR.quarters}
        rowKey={(q) => q.quarter}
        footer={
          <tr className="border-t-2 border-[var(--line)] font-semibold">
            <th scope="row" className="text-left py-1 px-2">
              {reportText('r.year', 'Year')}
            </th>
            <td className="py-1 px-2 tabular-nums">{usd(txTotals.grossSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{usd(txTotals.exemptSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{usd(txTotals.taxableSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{usd(txTotals.taxCollectedCents)}</td>
            <td className="py-1 px-2 tabular-nums">{txTotals.documentCount}</td>
            <td className="py-1 px-2" />
          </tr>
        }
        columns={[
          { header: reportText('r.quarter', 'Quarter'), headClassName: 'text-left py-1 px-2', className: 'text-left font-normal py-1 px-2', cell: (q) => q.quarter },
          {
            header: reportText('r.gross-sales', 'Gross sales'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (q) => usd(q.expected.grossSalesCents),
          },
          {
            header: reportText('r.exempt', 'Exempt'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (q) => usd(q.expected.exemptSalesCents),
          },
          {
            header: reportText('r.taxable', 'Taxable'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (q) => usd(q.expected.taxableSalesCents),
          },
          {
            header: reportText('r.tax-collected', 'Tax collected'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (q) => usd(q.expected.taxCollectedCents),
          },
          {
            header: reportText('r.documents-heading', 'Documents'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2 tabular-nums',
            cell: (q) => q.expected.documentCount,
          },
          {
            header: reportText('r.check', 'Check'),
            headClassName: 'text-left py-1 px-2', className: 'py-1 px-2',
            cell: (q) => (failedIds.has(`A-199 ${q.quarter}`) ? reportText('r.fails-see-above', 'Fails — see above') : reportText('r.matches', 'Matches')),
          },
        ]}
      />
    </ReportTableScroll>

    <h3 className="font-semibold text-sm">{reportText('r.a-106-us-1099-reporting-thresholds-by-year', 'A-106 · US 1099 reporting thresholds by year ($)')}</h3>
    <ReportTableScroll nameFromCaption allowDisplayedExport={true}>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>{reportText('r.1099-nec-and-1099-misc-thresholds-the-year-s-tot', '1099-NEC and 1099-MISC thresholds: the year’s total at or above which a payment is reportable')}</>)}
        rows={US_1099_THRESHOLDS}
        rowKey={row => `${row.kind}-${row.validFrom}`}
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
        bodyClassName=""
        columns={[
          { header: reportText('r.form-and-box', 'Form and box'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.form },
          { header: reportText('r.threshold', 'Threshold'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => usd(row.thresholdCents) },
          { header: reportText('r.payments-from', 'Payments from'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.validFrom },
          { header: reportText('r.payments-through', 'Payments through'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.validTo || 'in force' },
          { header: reportText('r.note', 'Note'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.note || '' },
        ]}
      />
    </ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.the-israeli-year-s-april-credit-note-reduces-the', 'The Israeli year’s April credit note reduces the March–April period, the quarter it belongs to, never a later one. The Texas year keeps the Oregon buyer off the Texas return (no Texas permit applies to that sale) and counts the resale-certificate customer as exempt, not as missing tax.')}
    </p>
  </section>;
}
