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

const controlClass = 'min-h-11 rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm text-[var(--text)]';

/**
 * A-148 / A-206: read-only 12-month small-business fixture inspector and live speed check
 * for the five heaviest reports against the 1,000 ms budget.
 */
export default function SampleYearBenchmarkReportView() {
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
    <section aria-label="Sample business year and report speed" className="p-4 space-y-6 min-w-0 text-[var(--text)]">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">12-month sample business &amp; report speed</h2>
        <p className="text-sm text-[var(--muted)]">
          Generates a deterministic 12-month small-business year (invoices, supplier bills, purchase orders,
          warehouse receipts, lots and serials, payments, bank statements, reconciliations, and balanced double-entry
          postings) and times the {benchmark.reports.length} report computations it can measure — led by the five
          heaviest — against the {REPORT_BUDGET_MS} ms budget. It is a speed check of those computations, not of every
          report screen: the browser-rendered screens are measured separately in the report-speed tests (AF13-004).
          Read-only fixture only: nothing here reads from, writes to, or alters your workspace books.
        </p>
      </div>

      <p role={verification.ok && benchmark.allWithinBudget ? 'status' : 'alert'} className="text-sm font-semibold">
        {verification.ok && benchmark.allWithinBudget
          ? `All ${verification.monthsCovered} months verified (${verification.balancedTransactions} balanced entries, ${verification.totalLines} lines) · Top 5 heaviest of the ${benchmark.reports.length} report computations under ${REPORT_BUDGET_MS} ms (max ${benchmark.topFiveHeaviest[0]?.durationMs.toFixed(2) || '0.00'} ms).`
          : `Check failed: ${verification.failures.join('; ') || 'one or more reports exceeded the 1,000 ms budget'}.`}
      </p>

      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">
          Volume scale
          <select
            aria-label="Volume scale"
            className={controlClass}
            value={scale}
            onChange={e => setScale(Number(e.target.value))}
          >
            <option value={1}>1× standard year ({fixture.transactions.length} entries)</option>
            <option value={2}>2× busy year</option>
            <option value={3}>3× high-volume stress year</option>
          </select>
        </label>

        <button
          type="button"
          className="min-h-11 px-4 rounded border border-[var(--line)] text-sm font-medium"
          onClick={() => setRunCount(n => n + 1)}
        >
          Re-run speed check
        </button>

        <button
          type="button"
          className="min-h-11 px-4 rounded border border-[var(--line)] text-sm font-medium"
          onClick={() => downloadCsv(`sample-year-speed-${scale}x`, SAMPLE_YEAR_BENCHMARK_CSV_HEADERS, sampleYearBenchmarkCsvRows(benchmark))}
        >
          Export CSV
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Five heaviest reports against the {REPORT_BUDGET_MS} ms budget</h3>
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption className="sr-only">Five heaviest reports measured on the 12-month sample business fixture</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                {['Rank', 'Report', 'Measured (ms)', 'Budget (ms)', 'Rows computed', 'Result'].map(h => (
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
                  <td className="py-2 px-2">{row.withinBudget ? `Pass (< ${benchmark.budgetMs} ms)` : 'Over budget'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportTableScroll>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">All measured reports ({benchmark.reports.length})</h3>
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption className="sr-only">All measured reports ordered from heaviest to fastest</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                {['Rank', 'Report', 'Top 5', 'Measured (ms)', 'Rows computed', 'Result'].map(h => (
                  <th key={h} scope="col" className="text-left py-2 px-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {benchmark.reports.map((row, idx) => (
                <tr key={row.reportId} className="border-b border-[var(--line)]/50">
                  <td className="py-2 px-2 tabular-nums">{idx + 1}</td>
                  <th scope="row" className="text-left font-normal py-2 px-2"><bdi>{row.label}</bdi></th>
                  <td className="py-2 px-2">{row.isTopFiveHeaviest ? 'Top 5' : '—'}</td>
                  <td className="py-2 px-2 tabular-nums">{row.durationMs.toFixed(2)}</td>
                  <td className="py-2 px-2 tabular-nums">{row.rowsProduced}</td>
                  <td className="py-2 px-2">{row.withinBudget ? `Pass (< ${benchmark.budgetMs} ms)` : 'Over budget'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportTableScroll>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">12-month sample business activity ({fixture.startDate} to {fixture.endDate})</h3>
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption className="sr-only">Monthly document counts and totals in the 12-month sample business fixture</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                {['Month', 'Invoices', 'Bills', 'Purchase orders', 'Payments', 'Stock moves', 'Journal entries', 'Invoiced', 'Billed'].map(h => (
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
