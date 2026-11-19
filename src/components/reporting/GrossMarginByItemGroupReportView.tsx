import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import {
  groupMarginCsvHeaders, groupMarginCsvRows, NO_GROUP_NAME, NO_ITEM_NAME, type GroupMonth,
} from '../../lib/grossMarginByGroup';
import ReportSchedule from './ReportSchedule';
import { useReportDates } from './useReportDates';
import { RangeReportSourceNote } from './RangeReportSourceNote';
import { useServerItemGroupMargin } from '../../hooks/useServerProfitability';
import { useReportText, fill } from './useReportText';

const pctText = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}%`);

/**
 * A-193: gross margin by item group over time. Each month is Sales by Item rolled up to the group
 * recorded on each item, so margin drift in a group is visible before it reaches the year totals.
 * Amounts are in minor units of the base currency in the CSV; an asterisk marks a cost that is
 * partly estimated from recorded unit costs, exactly as Sales by Item marks it.
 */
export default function GrossMarginByItemGroupReportView() {
  const reportText = useReportText();
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('invoices', 'inventory', 'transactions', 'accounts');
  const currentBook = useDataNeedsStore(s => s.loadedWorkspaceId === workspace?.id);
  const guest = useAuthStore(s => s.isGuest && !s.user);
  const { locale } = useReportDates();
  const thisYear = Number(getLocalDateISO().slice(0, 4));
  const [year, setYear] = useState(thisYear);

  const home = workspace?.currency || 'USD';
  const [detail, setDetail] = useState<{ workspace?: string; group: string; month: string } | null>(null);
  const { report, source, pending, retry } = useServerItemGroupMargin(year);

  const partial = source === 'loaded-incomplete';
  const readable = source === 'server' || (!!workspace && (guest || currentBook) && !loading);
  const anyEstimate = report.rows.some(r => r.costIsEstimate);

  const complete = readable && !partial;
  const sales = report.totals.reduce((sum, cell) => sum + cell.salesCents, 0);
  const margin = report.totals.reduce((sum, cell) => sum + cell.marginCents, 0);
  const monthFormat = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const selected = readable && detail && detail.workspace === workspace?.id
    ? report.rows.find(r => r.group === detail.group)?.months.find(c => c.month === detail.month) : undefined;
  const groupName = (name: string) => name === NO_ITEM_NAME ? reportText('r.no-item', 'No item')
    : name === NO_GROUP_NAME ? reportText('r.no-group-status', 'No group recorded') : name;
  const monthDetail = (cell?: GroupMonth) => cell?.salesCents ? fill(reportText('r.sales-0-cost-1-margin-2', 'Sales {0}, cost {1}, margin {2}'), {
    0: formatCurrency(cell.salesCents, home), 1: formatCurrency(cell.costCents, home), 2: formatCurrency(cell.marginCents, home),
  }) : reportText('r.no-sales-this-month', 'No sales this month');
  return <section aria-label={reportText('r.gross-margin-by-item-group', 'Gross margin by item group')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.gross-margin-by-item-group', 'Gross margin by item group')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.each-month-s-sales-cost-and-gross-margin-from-sa', 'Each month\'s sales, cost and gross margin from Sales by Item — issued invoices, in')} {home} {reportText('r.at-each-invoice-s-own-rate-rolled-up-to-the-grou', 'at each invoice\'s own rate — rolled up to the group recorded on each item (its category). A line with no item is No item and carries no invented cost; an item with no recorded group is No group recorded. Cost is the cost of goods sold posted for the line, or quantity × the recorded unit cost where none is posted yet, marked *.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.year', 'Year')}
        <select aria-label={reportText('r.year', 'Year')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={year} onChange={e => setYear(Number(e.target.value))}>
          {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!complete || !report.rows.length}
        onClick={() => downloadCsv('gross-margin-by-item-group', groupMarginCsvHeaders(report.months), groupMarginCsvRows(report.rows))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {!readable && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-invoices-and-items', 'Loading invoices and items…')}</p>}
    {partial && <p role="alert" className="text-sm">{reportText('r.the-loaded-invoices-items-entries-or-accounts-ar', 'The loaded invoices, items, entries or accounts are capped or failed. These figures may be incomplete.')}</p>}
    {pending ? <p role="status">{reportText('r.loading-report-records', 'Loading report records…')}</p> : <RangeReportSourceNote source={source} testId="item-group-margin-source" what={reportText('r.these-figures', 'these figures')} />}
    {retry && <button type="button" onClick={retry} className="min-h-11 underline">{reportText('r.retry-full-report', 'Retry full report')}</button>}

    {readable && report.rows.length > 0 && <ReportSchedule columnControls allowDisplayedExport={complete}
      caption={<>{reportText('r.gross-margin-percent-by-item-group-and-month', 'Gross margin percent by item group and month,')} {year} ({home})</>}
      rows={report.rows} rowKey={row => row.group}
      columns={[
        { header: reportText('r.item-group', 'Item group'), cell: row => <><bdi>{groupName(row.group)}</bdi>{row.costIsEstimate && ' *'}</> },
        { over: report.months, head: month => monthFormat.format(new Date(`${month}-15T12:00:00Z`)), align: 'right', cell: (row, month) => {
          const cell = row.months.find(c => c.month === month);
          if (!cell?.salesCents) return pctText(cell?.marginPct ?? null);
          const open = selected === cell;
          return <button type="button" className="min-h-11 underline" aria-expanded={open} title={monthDetail(cell)}
            onClick={() => setDetail(open ? null : { workspace: workspace?.id, group: row.group, month })}>{pctText(cell.marginPct)}</button>;
        } },
        { header: reportText('r.year-sales', 'Year sales'), align: 'right', cell: row => formatCurrency(row.salesCents, home) },
        { header: reportText('r.year-margin', 'Year margin'), align: 'right', cell: row => formatCurrency(row.marginCents, home) },
        { header: reportText('r.year-margin-2', 'Year margin %'), align: 'right', cell: row => pctText(row.marginPct) },
      ]}
      footer={<tr><th scope="row">{reportText('r.all-groups', 'All groups')}</th>
        {report.months.map(month => <td key={month}>{pctText(report.totals.find(c => c.month === month)?.marginPct ?? null)}</td>)}
        <td>{formatCurrency(sales, home)}</td><td>{formatCurrency(margin, home)}</td><td>{pctText(sales > 0 ? margin / sales * 100 : null)}</td>
      </tr>} />}
    {selected && detail && <p role="status"><bdi>{groupName(detail.group)}</bdi> · <bdi>{selected.month}</bdi>: {monthDetail(selected)}</p>}
    {complete && !report.rows.length && <p role="status">{reportText('r.no-issued-invoice-lines-fall-in', 'No issued invoice lines fall in')} {year}.</p>}

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.month-margin-detail', 'Choose a month’s margin to see its sales, cost and margin. The CSV includes every figure.')} {anyEstimate ? `${reportText('r.part-of-this-group-s-cost-is-estimated-from-reco', '* Part of this group’s cost is estimated from recorded unit costs because no cost of goods sold is posted for those lines yet — the same estimate Sales by Item shows.')} ` : ''}
      {reportText('r.a-month-with-no-sales-shows-never-0-no-sales-is', 'A month with no sales shows —, never 0%: no sales is not a zero margin.')}
    </p>
  </section>;
}
