import React, { useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import {
  groupMarginCsvHeaders, groupMarginCsvRows,
} from '../../lib/grossMarginByGroup';
import ReportTableScroll from './ReportTableScroll';
import { RangeReportSourceNote } from './RangeReportSourceNote';
import { useServerItemGroupMargin } from '../../hooks/useServerProfitability';

const monthShort = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const pctText = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}%`);

/**
 * A-193: gross margin by item group over time. Each month is Sales by Item rolled up to the group
 * recorded on each item, so margin drift in a group is visible before it reaches the year totals.
 * Amounts are in minor units of the base currency in the CSV; an asterisk marks a cost that is
 * partly estimated from recorded unit costs, exactly as Sales by Item marks it.
 */
export default function GrossMarginByItemGroupReportView() {
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('invoices', 'inventory');
  const thisYear = Number(getLocalDateISO().slice(0, 4));
  const [year, setYear] = useState(thisYear);

  const home = workspace?.currency || 'USD';
  const { report, source } = useServerItemGroupMargin(year);

  const partial = source !== 'server' && (truncated.invoices || truncated.inventory || truncated.transactions || failed.invoices || failed.inventory);
  const anyEstimate = report.rows.some(r => r.costIsEstimate);

  return <section aria-label="Gross margin by item group" className="p-4 space-y-4 min-w-0">
    <h2>Gross margin by item group</h2>
    <p className="text-sm text-[var(--muted)]">
      Each month&apos;s sales, cost and gross margin from Sales by Item — issued invoices, in {home} at each
      invoice&apos;s own rate — rolled up to the group recorded on each item (its category). A line with no
      item is No item and carries no invented cost; an item with no recorded group is No group recorded.
      Cost is the cost of goods sold posted for the line, or quantity × the recorded unit cost where none
      is posted yet, marked *.
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Year
        <select aria-label="Year" className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={year} onChange={e => setYear(Number(e.target.value))}>
          {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!report.rows.length}
        onClick={() => downloadCsv('gross-margin-by-item-group', groupMarginCsvHeaders(report.months), groupMarginCsvRows(report.rows))}>Export CSV</button>
    </div>

    {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading invoices and items…</p>}
    {partial && <p role="alert" className="text-sm">The loaded invoices, items or entries are capped or failed. These figures may be incomplete.</p>}
    <RangeReportSourceNote source={source} testId="item-group-margin-source" what="these figures" />

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>Gross margin percent by item group and month, {year} ({home})</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left py-1 px-2">Item group</th>
            {report.months.map(m => <th key={m} scope="col" className="text-right py-1 px-2">{monthShort(m)}</th>)}
            <th scope="col" className="text-right py-1 px-2">Year sales</th>
            <th scope="col" className="text-right py-1 px-2">Year margin</th>
            <th scope="col" className="text-right py-1 px-2">Year margin %</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map(row => (
            <tr key={row.group} className="border-b border-[var(--line)]/50">
              <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{row.group}</bdi>{row.costIsEstimate ? ' *' : ''}</th>
              {row.months.map(cell => (
                <td key={cell.month} className="py-1 px-2 text-right tabular-nums"
                  title={cell.salesCents ? `Sales ${formatCurrency(cell.salesCents, home)}, cost ${formatCurrency(cell.costCents, home)}, margin ${formatCurrency(cell.marginCents, home)}` : 'No sales this month'}>
                  {pctText(cell.marginPct)}
                </td>
              ))}
              <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(row.salesCents, home)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(row.marginCents, home)}</td>
              <td className="py-1 px-2 text-right tabular-nums font-semibold">{pctText(row.marginPct)}</td>
            </tr>
          ))}
        </tbody>
        {report.rows.length > 0 && <tfoot>
          <tr className="font-semibold">
            <th scope="row" className="text-left py-1 px-2">All groups</th>
            {report.totals.map(cell => <td key={cell.month} className="py-1 px-2 text-right tabular-nums">{pctText(cell.marginPct)}</td>)}
            <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(report.totals.reduce((s, c) => s + c.salesCents, 0), home)}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(report.totals.reduce((s, c) => s + c.marginCents, 0), home)}</td>
            <td className="py-1 px-2 text-right tabular-nums">{pctText((() => {
              const sales = report.totals.reduce((s, c) => s + c.salesCents, 0);
              const margin = report.totals.reduce((s, c) => s + c.marginCents, 0);
              return sales > 0 ? (margin / sales) * 100 : null;
            })())}</td>
          </tr>
        </tfoot>}
      </table>
      {!report.rows.length && !loading && <p className="text-sm text-[var(--muted)]">No issued invoice lines fall in {year}.</p>}
    </ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">
      The month cells are margin percent; point at one for its sales, cost and margin, or export the CSV for
      every figure. {anyEstimate ? '* Part of this group\u2019s cost is estimated from recorded unit costs because no cost of goods sold is posted for those lines yet — the same estimate Sales by Item shows. ' : ''}
      A month with no sales shows —, never 0%: no sales is not a zero margin.
    </p>
  </section>;
}
