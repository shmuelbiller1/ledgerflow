import React, { useMemo, useState } from 'react';
import {
  buildSampleBusinessYear,
  summarizeSampleBusinessYear,
  verifySampleBusinessYear,
} from '../../lib/sampleBusinessYear';
import {
  REPORT_BUDGET_MS,
  runSampleYearReportBenchmark,
  SAMPLE_YEAR_BENCHMARK_CSV_HEADERS,
  sampleYearBenchmarkCsvRows,
} from '../../lib/reportBenchmark';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import { useReportText, fill } from './useReportText';

const controlClass = 'min-h-11 rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm text-[var(--text)]';

/**
 * A-148 / A-206: read-only 12-month small-business fixture inspector and live speed check
 * for the five heaviest reports against the 1,000 ms budget.
 */
export default function SampleYearBenchmarkReportView() {
  const reportText = useReportText();
  const [scale, setScale] = useState<number>(1);
  const [runCount, setRunCount] = useState<number>(0);

  const fixture = useMemo(() => buildSampleBusinessYear({ year: 2026, scale }), [scale]);
  const verification = useMemo(() => verifySampleBusinessYear(fixture), [fixture]);
  const monthly = useMemo(() => summarizeSampleBusinessYear(fixture), [fixture]);
  const benchmark = useMemo(() => {
    void runCount;
    return runSampleYearReportBenchmark(fixture, scale);
  }, [fixture, scale, runCount]);

  return (
    <section aria-label={reportText('r.sample-business-year-and-report-speed', 'Sample business year and report speed')} className="p-4 space-y-6 min-w-0 text-[var(--text)]">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">{reportText('r.12-month-sample-business-report-speed', '12-month sample business & report speed')}</h2>
        <p className="text-sm text-[var(--muted)]">
          {reportText('r.generates-a-deterministic-12-month-small-busines', 'Generates a deterministic 12-month small-business year (invoices, supplier bills, purchase orders, warehouse receipts, lots and serials, payments, bank statements, reconciliations, and balanced double-entry postings) and times the')} {benchmark.reports.length} {reportText('r.report-computations-it-can-measure-led-by-the-fi', 'report computations it can measure — led by the five heaviest — against the')} {REPORT_BUDGET_MS} {reportText('r.ms-budget-it-is-a-speed-check-of-those-computati', 'ms budget. It is a speed check of those computations, not of every report screen: the browser-rendered screens are measured separately in the report-speed tests (AF13-004). Read-only fixture only: nothing here reads from, writes to, or alters your workspace books.')}
        </p>
      </div>

      <p role={verification.ok && benchmark.allWithinBudget ? 'status' : 'alert'} className="text-sm font-semibold">
        {verification.ok && benchmark.allWithinBudget
          ? fill(reportText('r.all-0-months-verified-1-balanced-entries-2-lines', 'All {0} months verified ({1} balanced entries, {2} lines) · Top 5 heaviest of the {3} report computations under {4} ms (max {5} ms).'), { 0: verification.monthsCovered, 1: verification.balancedTransactions, 2: verification.totalLines, 3: benchmark.reports.length, 4: REPORT_BUDGET_MS, 5: benchmark.topFiveHeaviest[0]?.durationMs.toFixed(2) || '0.00' })
          : fill(reportText('r.check-failed-0', 'Check failed: {0}.'), { 0: verification.failures.join('; ') || 'one or more reports exceeded the 1,000 ms budget' })}
      </p>

      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">
          {reportText('r.volume-scale', 'Volume scale')}
          <select
            aria-label={reportText('r.volume-scale', 'Volume scale')}
            className={controlClass}
            value={scale}
            onChange={e => setScale(Number(e.target.value))}
          >
            <option value={1}>{reportText('r.1-standard-year', '1× standard year (')}{fixture.transactions.length} {reportText('r.entries-2', 'entries)')}</option>
            <option value={2}>{reportText('r.2-busy-year', '2× busy year')}</option>
            <option value={3}>{reportText('r.3-high-volume-stress-year', '3× high-volume stress year')}</option>
          </select>
        </label>

        <button
          type="button"
          className="min-h-11 px-4 rounded border border-[var(--line)] text-sm font-medium"
          onClick={() => setRunCount(n => n + 1)}
        >
          {reportText('r.re-run-speed-check', 'Re-run speed check')}
        </button>

        <button
          type="button"
          className="min-h-11 px-4 rounded border border-[var(--line)] text-sm font-medium"
          onClick={() => downloadCsv(`sample-year-speed-${scale}x`, SAMPLE_YEAR_BENCHMARK_CSV_HEADERS, sampleYearBenchmarkCsvRows(benchmark))}
        >
          {reportText('r.export-csv', 'Export CSV')}
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">{reportText('r.five-heaviest-reports-against-the', 'Five heaviest reports against the')} {REPORT_BUDGET_MS} {reportText('r.ms-budget', 'ms budget')}</h3>
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption className="sr-only">{reportText('r.five-heaviest-reports-measured-on-the-12-month-s', 'Five heaviest reports measured on the 12-month sample business fixture')}</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                {[reportText('r.rank', 'Rank'), reportText('r.report', 'Report'), reportText('r.measured-ms', 'Measured (ms)'), reportText('r.budget-ms', 'Budget (ms)'), reportText('r.rows-computed', 'Rows computed'), reportText('r.result', 'Result')].map(h => (
                  <th key={h} scope="col" className="text-left py-2 px-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {benchmark.topFiveHeaviest.map((row, idx) => (
                <tr key={row.reportId} className="border-b border-[var(--line)]/50">
                  <td className="py-2 px-2 tabular-nums">{idx + 1}</td>
                  <th scope="row" className="text-left font-normal py-2 px-2"><bdi>{row.label}</bdi></th>
                  <td className="py-2 px-2 tabular-nums">{row.durationMs.toFixed(2)}</td>
                  <td className="py-2 px-2 tabular-nums">{benchmark.budgetMs}</td>
                  <td className="py-2 px-2 tabular-nums">{row.rowsProduced}</td>
                  <td className="py-2 px-2">{row.withinBudget ? fill(reportText('r.pass-0-ms', 'Pass (< {0} ms)'), { 0: benchmark.budgetMs }) : reportText('r.over-budget', 'Over budget')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportTableScroll>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">{reportText('r.all-measured-reports', 'All measured reports (')}{benchmark.reports.length})</h3>
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption className="sr-only">{reportText('r.all-measured-reports-ordered-from-heaviest-to-fa', 'All measured reports ordered from heaviest to fastest')}</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                {[reportText('r.rank', 'Rank'), reportText('r.report', 'Report'), reportText('r.top-5', 'Top 5'), reportText('r.measured-ms', 'Measured (ms)'), reportText('r.rows-computed', 'Rows computed'), reportText('r.result', 'Result')].map(h => (
                  <th key={h} scope="col" className="text-left py-2 px-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {benchmark.reports.map((row, idx) => (
                <tr key={row.reportId} className="border-b border-[var(--line)]/50">
                  <td className="py-2 px-2 tabular-nums">{idx + 1}</td>
                  <th scope="row" className="text-left font-normal py-2 px-2"><bdi>{row.label}</bdi></th>
                  <td className="py-2 px-2">{row.isTopFiveHeaviest ? reportText('r.top-5', 'Top 5') : '—'}</td>
                  <td className="py-2 px-2 tabular-nums">{row.durationMs.toFixed(2)}</td>
                  <td className="py-2 px-2 tabular-nums">{row.rowsProduced}</td>
                  <td className="py-2 px-2">{row.withinBudget ? fill(reportText('r.pass-0-ms', 'Pass (< {0} ms)'), { 0: benchmark.budgetMs }) : reportText('r.over-budget', 'Over budget')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportTableScroll>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">{reportText('r.12-month-sample-business-activity', '12-month sample business activity (')}{fixture.startDate} {reportText('r.to-2', 'to')} {fixture.endDate})</h3>
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption className="sr-only">{reportText('r.monthly-document-counts-and-totals-in-the-12-mon', 'Monthly document counts and totals in the 12-month sample business fixture')}</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                {[reportText('r.month', 'Month'), reportText('r.invoices-2', 'Invoices'), reportText('r.bills-2', 'Bills'), reportText('r.purchase-orders', 'Purchase orders'), reportText('r.payments', 'Payments'), reportText('r.stock-moves', 'Stock moves'), reportText('r.journal-entries', 'Journal entries'), reportText('r.invoiced-2', 'Invoiced'), reportText('r.billed-2', 'Billed')].map(h => (
                  <th key={h} scope="col" className="text-left py-2 px-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthly.map(m => (
                <tr key={m.month} className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-2 px-2 tabular-nums">{m.month}</th>
                  <td className="py-2 px-2 tabular-nums">{m.invoices}</td>
                  <td className="py-2 px-2 tabular-nums">{m.bills}</td>
                  <td className="py-2 px-2 tabular-nums">{m.purchaseOrders}</td>
                  <td className="py-2 px-2 tabular-nums">{m.payments}</td>
                  <td className="py-2 px-2 tabular-nums">{m.stockMoves}</td>
                  <td className="py-2 px-2 tabular-nums">{m.transactions}</td>
                  <td className="py-2 px-2 tabular-nums whitespace-nowrap">{formatCurrency(m.invoicedCents, 'USD')}</td>
                  <td className="py-2 px-2 tabular-nums whitespace-nowrap">{formatCurrency(m.billedCents, 'USD')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportTableScroll>
      </div>
    </section>
  );
}
