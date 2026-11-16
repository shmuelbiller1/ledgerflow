import { useMemo } from 'react';
import {
  GOLDEN_IL_YEAR, GOLDEN_TX_YEAR, goldenIlYearTotals, goldenTxYearTotals, verifyGoldenYearFixtures,
  type GoldenYearCheck,
} from '../../lib/goldenYearFixtures';
import { US_1099_THRESHOLDS } from '../../lib/tax/us1099Thresholds';
import { formatCurrency } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';

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
  const failedIds = new Set(result.failures.map(f => f.id));
  const ilTotals = goldenIlYearTotals();
  const txTotals = goldenTxYearTotals();
  return <section aria-label="Full-year golden scenarios" className="p-4 space-y-4 min-w-0">
    <h2>Full-year golden scenarios</h2>
    <p className="text-sm text-[var(--muted)]">
      One Israeli year (2026, VAT 18%, reported every two months) and one Texas year (2026, reported
      quarterly), with every period&rsquo;s figures worked by hand and written into the fixture. Each
      period is checked against the same return library the Tax return screen uses, so a change that
      would move a filed figure shows as a failure here. These are test fixtures, not workspace
      books: nothing posts, files or closes. US amounts are the Texas <strong>state base rate only</strong>{' '}
      (6.25%) — county, city and transit taxes are not included and must never be read as the full
      amount due. Eilat is zero-rated through the existing special-area row; an exempt sale is
      reported apart from zero-rated, never mixed in.
    </p>

    <p className="text-sm font-semibold">
      {result.failures.length === 0
        ? `All ${result.ilPeriods} Israeli periods and ${result.txQuarters} Texas quarters match the worked figures.`
        : `${result.failures.length} full-year check(s) fail — do not rely on the affected period until this is reviewed.`}
    </p>
    {result.failures.length > 0 && <ul className="text-sm list-disc ps-5" aria-label="Full-year failures">
      {result.failures.map(f => <li key={`${f.id}-${f.detail}`}>{f.id}: {f.detail}</li>)}
    </ul>}

    <h3 className="font-semibold text-sm">A-198 · Israel VAT year, six bi-monthly periods (₪)</h3>
    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption className="text-left font-semibold text-[var(--text)] pb-1">Israeli VAT year: taxable, zero-rated and exempt sales; equipment and other input VAT; to pay or reclaim</caption>
        <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
          {['Period', 'Taxable sales', 'Output VAT', 'Zero-rated', 'Exempt', 'Input — equipment', 'Input — other', 'To pay / (reclaim)', 'Documents', 'Check'].map(head => <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}
        </tr></thead>
        <tbody>
          {GOLDEN_IL_YEAR.periods.map(p => <tr key={p.period} className="border-b border-[var(--line)]/50">
            <th scope="row" className="text-left font-normal py-1 px-2">{p.period}</th>
            <td className="py-1 px-2 tabular-nums">{ils(p.expected.taxableSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ils(p.expected.outputVatCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ils(p.expected.zeroRatedSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ils(p.expected.exemptSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ils(p.expected.fixedAssetInputVatCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ils(p.expected.otherInputVatCents)}</td>
            <td className="py-1 px-2 tabular-nums">{ils(p.expected.toPayCents)}</td>
            <td className="py-1 px-2 tabular-nums">{p.expected.documentCount}</td>
            <td className="py-1 px-2">{failedIds.has(`A-198 ${p.period}`) ? 'Fails — see above' : 'Matches'}</td>
          </tr>)}
          <tr className="border-t-2 border-[var(--line)] font-semibold">
            <th scope="row" className="text-left py-1 px-2">Year</th>
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
        </tbody>
      </table>
    </ReportTableScroll>

    <h3 className="font-semibold text-sm">A-199 · Texas sales-tax year, four quarters ($)</h3>
    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption className="text-left font-semibold text-[var(--text)] pb-1">Texas state base rate 6.25% only: gross, exempt and taxable sales with the tax collected</caption>
        <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
          {['Quarter', 'Gross sales', 'Exempt', 'Taxable', 'Tax collected', 'Documents', 'Check'].map(head => <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}
        </tr></thead>
        <tbody>
          {GOLDEN_TX_YEAR.quarters.map(q => <tr key={q.quarter} className="border-b border-[var(--line)]/50">
            <th scope="row" className="text-left font-normal py-1 px-2">{q.quarter}</th>
            <td className="py-1 px-2 tabular-nums">{usd(q.expected.grossSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{usd(q.expected.exemptSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{usd(q.expected.taxableSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{usd(q.expected.taxCollectedCents)}</td>
            <td className="py-1 px-2 tabular-nums">{q.expected.documentCount}</td>
            <td className="py-1 px-2">{failedIds.has(`A-199 ${q.quarter}`) ? 'Fails — see above' : 'Matches'}</td>
          </tr>)}
          <tr className="border-t-2 border-[var(--line)] font-semibold">
            <th scope="row" className="text-left py-1 px-2">Year</th>
            <td className="py-1 px-2 tabular-nums">{usd(txTotals.grossSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{usd(txTotals.exemptSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{usd(txTotals.taxableSalesCents)}</td>
            <td className="py-1 px-2 tabular-nums">{usd(txTotals.taxCollectedCents)}</td>
            <td className="py-1 px-2 tabular-nums">{txTotals.documentCount}</td>
            <td className="py-1 px-2" />
          </tr>
        </tbody>
      </table>
    </ReportTableScroll>

    <h3 className="font-semibold text-sm">A-106 · US 1099 reporting thresholds by year ($)</h3>
    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>1099-NEC and 1099-MISC thresholds: the year&rsquo;s total at or above which a payment is reportable</>)}
        rows={US_1099_THRESHOLDS}
        rowKey={row => `${row.kind}-${row.validFrom}`}
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
        bodyClassName=""
        columns={[
          { header: "Form and box", className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.form },
          { header: "Threshold", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => usd(row.thresholdCents) },
          { header: "Payments from", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.validFrom },
          { header: "Payments through", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.validTo || 'in force' },
          { header: "Note", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.note || '' },
        ]}
      />
    </ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">
      The Israeli year&rsquo;s April credit note reduces the March–April period, the quarter it belongs
      to, never a later one. The Texas year keeps the Oregon buyer off the Texas return (no Texas
      permit applies to that sale) and counts the resale-certificate customer as exempt, not as
      missing tax.
    </p>
  </section>;
}
