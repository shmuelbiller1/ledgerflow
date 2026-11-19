import { useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import ChartFrame, { ChartTooltip, type ChartSeries } from '../charts/ChartFrame';
import { useAuthStore } from '../../stores/useAuthStore';
import type { Transaction } from '../../types';
import { isPostable, lineAmount } from '../../lib/txFilters';
import ReportSchedule from '../reporting/ReportSchedule';
import { fill, useReportText } from '../reporting/useReportText';

interface Props { transactions: Transaction[]; formatCurrency: (val: number) => string }
type Mode = 'all' | 'high-yield' | 'loss';
const margin = (net: number, income: number) => income > 0 ? `${(net / income * 100).toFixed(1)}%` : '0%';

/** Transaction-line analysis, not the separate invoice profitability report. All money stays
 * in home minor units, including in the chart; the count is matching lines, not journal entries. */
export default function ProjectProfitabilityView({ transactions, formatCurrency }: Props) {
  const reportText = useReportText();
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency);
  const [mode, setMode] = useState<Mode>('all');
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => {
    const groups = new Map<string | null, { project: string | null; income: number; expense: number; net: number; lines: number }>();
    for (const tx of transactions) {
      if (!isPostable(tx)) continue;
      for (const line of tx.lines || []) {
        const project = line.project || tx.projectId || null;
        let row = groups.get(project);
        if (!row) { row = { project, income: 0, expense: 0, net: 0, lines: 0 }; groups.set(project, row); }
        const amount = lineAmount(line, tx);
        const account = (line.accountName || '').toLowerCase();
        const category = (typeof line.category === 'string' ? line.category : '').toLowerCase();
        if (/income|revenue/.test(account) || /income|revenue/.test(category)) {
          row.income -= amount; row.net -= amount; row.lines++;
        } else if (/expense|cost|cogs/.test(account) || /expense|cost/.test(category)) {
          row.expense += amount; row.net -= amount; row.lines++;
        }
      }
    }
    return [...groups.values()].filter(r => mode === 'all' || (mode === 'loss' ? r.net < 0 : r.income > 0 && r.net / r.income > 0.4)).sort((a, b) => b.net - a.net);
  }, [transactions, mode]);
  const income = rows.reduce((sum, r) => sum + r.income, 0), expense = rows.reduce((sum, r) => sum + r.expense, 0);
  const incomeLabel = reportText('r.section-income', 'Income'), expenseLabel = reportText('r.section-expense', 'Expenses');
  const netLabel = reportText('r.net-amount', 'Net amount'), marginLabel = reportText('r.margin-2', 'Margin');
  const title = reportText('r.project-ledger-profit', 'Project profitability');
  const modes: Record<Mode, string> = { all: reportText('r.all', 'All'), 'high-yield': reportText('r.project-high-margin', 'Margin over 40%'), loss: reportText('r.loss', 'Loss') };
  const name = (project: string | null) => project ?? reportText('r.unspecified-project', 'No project recorded');
  const series: ChartSeries[] = [{ key: 'income', name: incomeLabel, unit: 'money' }, { key: 'expense', name: expenseLabel, unit: 'money' }, { key: 'margin', name: marginLabel, unit: 'percent' }];
  const chart = rows.slice(0, showAll ? undefined : 10).map(r => ({ id: JSON.stringify(r.project), label: name(r.project), income: r.income, expense: r.expense, margin: r.income > 0 ? r.net / r.income * 100 : 0 }));
  const exportLabel = reportText('r.export-project-rows', 'Export project rows');
  const expandLabel = reportText('r.expand-project-chart', 'Expand chart');
  return <section aria-label={title} className="p-4 space-y-4 min-w-0 text-[var(--text)]">
    <h2 className="text-lg font-bold">{title}</h2>
    <p className="text-sm text-[var(--muted)]">{reportText('r.project-ledger-scope', 'Income, expenses and profit from loaded journal lines. The figures below follow the selected filter.')}</p>
    <div className="flex flex-wrap gap-2" data-print-hide>{(Object.keys(modes) as Mode[]).map(key => <button type="button" key={key} aria-pressed={key === mode}
      className="option-state min-h-11 rounded-lg border px-3" onClick={() => setMode(key)}>{modes[key]}</button>)}</div>
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">{[[incomeLabel, formatCurrency(income)], [expenseLabel, formatCurrency(expense)], [netLabel, formatCurrency(income - expense)], [marginLabel, margin(income - expense, income)]].map(([label, value]) => (
      <div key={label} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3"><dt className="text-sm text-[var(--muted)]">{label}</dt><dd className="font-semibold tabular-nums"><bdi dir="ltr">{value}</bdi></dd></div>
    ))}</dl>
    {rows.length > 0 ? <>
      <ReportSchedule rows={rows} rowKey={r => JSON.stringify(r.project)} caption={reportText('r.project-results', 'Results by project')}
        columns={[
          { header: reportText('r.project', 'Project'), cell: r => <bdi>{name(r.project)}</bdi> },
          { header: reportText('r.matching-lines', 'Matching lines'), align: 'right', cell: r => r.lines },
          { header: incomeLabel, align: 'right', cell: r => formatCurrency(r.income) },
          { header: expenseLabel, align: 'right', cell: r => formatCurrency(r.expense) },
          { header: netLabel, align: 'right', cell: r => formatCurrency(r.net) },
          { header: marginLabel, align: 'right', cell: r => margin(r.net, r.income) },
        ]} />
      {rows.length > 10 && <button type="button" className="min-h-11 rounded border px-3" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>
        {showAll ? reportText('r.show-top-ten', 'Chart the top 10') : fill(reportText('r.chart-all-projects', 'Chart all {count} projects'), { count: rows.length })}</button>}
      <ChartFrame title={reportText('r.project-chart', 'Project income, expenses and margin')} rows={chart} series={series} currency={currency}>
        {({ rows: visible, hidden }) => <div dir="ltr" className="h-full"><ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={visible} margin={{ top: 12, right: 0, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <YAxis yAxisId="money" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={value => formatCurrency(Number(value))} />
            <YAxis yAxisId="margin" orientation="right" width={42} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={n => `${n}%`} />
            <Tooltip content={<ChartTooltip currency={currency} series={series} />} />
            <Bar isAnimationActive={false} yAxisId="money" dataKey="income" name={incomeLabel} hide={hidden.has('income')} fill="#3b82f6" maxBarSize={40} />
            <Bar isAnimationActive={false} yAxisId="money" dataKey="expense" name={expenseLabel} hide={hidden.has('expense')} fill="#ef4444" maxBarSize={40} />
            <Line isAnimationActive={false} yAxisId="margin" dataKey="margin" name={marginLabel} hide={hidden.has('margin')} stroke="#8b5cf6" strokeWidth={3} />
          </ComposedChart>
        </ResponsiveContainer></div>}
      </ChartFrame>
      <div><button type="button" disabled aria-label={expandLabel} aria-describedby="chart-expand-help" className="btn-tonal px-3">{expandLabel}</button>
        <p id="chart-expand-help" className="text-sm text-[var(--muted)]">{reportText('r.project-expand-help', 'Chart expansion is not available. Use the results table to review all projects.')}</p></div>
    </> : <p role="status">{reportText('r.no-project-results', 'No projects match this filter in the loaded entries.')}</p>}
    <div><button type="button" disabled aria-label={exportLabel} aria-describedby="project-export-help" className="btn-tonal px-3">{exportLabel}</button>
      <p id="project-export-help" className="text-sm text-[var(--muted)]">{reportText('r.project-export-help', 'Export is not available because the analysis uses loaded transactions only.')}</p></div>
  </section>;
}
