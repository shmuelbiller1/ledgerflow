import { displayDimensionName, stableLabelValue } from '../../lib/dimensionUtils';
import { useEffect, useState } from 'react';
import { GroupedRowTable } from '../ui/RowTable';
import type { BandCell } from '../../lib/tableBands';
import { fetchProfitByLabel } from '../../lib/profitByLabelFetch';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { budgetedResult, budgetLabel } from '../../lib/budgetByLabel';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import DrillDownModal, { type ExplainRequest } from '../layout/DrillDownModal';
import { rollUp } from '../../lib/labelTree';
import { useReportText, fill } from './useReportText';
import ReportEmptyState from './ReportEmptyState';
import { useReportDates } from './useReportDates';
import { LoadingState } from '../ui/LoadingState';

type Section = 'income' | 'cogs' | 'expense';
interface Column { value: string; income: number; cogs: number; grossProfit: number; expense: number; netIncome: number; accounts: Record<string, number> }
interface Report { columns: Column[]; total: Omit<Column, 'value'>; rows: Array<{ id: string; name: string; code?: string; section: Section }> }
const SECTION_ORDER: Section[] = ['income', 'cogs', 'expense'];
const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/**
 * Profit by label (CB-25): choose a label (Property, Project, Location…) and a period; the income,
 * cost of goods sold, expenses and result of each of its values, and of the lines without one, account
 * by account, with the profit and loss total they add back to. Read by the server from the full history
 * (src/server/reports/byLabel.ts); each figure opens the entries behind it.
 */
export default function LabelProfitReportView() {
  const reportText = useReportText();
  const reportDates = useReportDates();
  const SECTION_NAMES: Record<Section, string> = { income: reportText('r.section-income', 'Income'), cogs: reportText('r.section-cogs', 'Cost of goods sold'), expense: reportText('r.section-expense', 'Expenses') };
  const sectionTotal = (section: Section) => fill(reportText('r.total-section', 'Total {section}'), { section: SECTION_NAMES[section].toLowerCase() });
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const nodes = useLedgerStore(s => s.dimensionNodes);
  // the roll-up needs every value's parent: with a partial list it would leave children out
  const nodesPartial = useLedgerStore(s => Boolean(s.truncatedCollections.dimensionNodes));
  // EU-E5: budgets that carry a value of this label give a budget row and a "vs budget" row
  const budgets = useLedgerStore(s => s.budgets);
  const ledgerAccounts = useLedgerStore(s => s.accounts);
  useLedgerCollections('budgets', 'accounts');
  const dimensions = workspace?.dimensions || [];
  const [picked, setPicked] = useState('');
  const dimensionId = picked || dimensions[0]?.id || '';
  const [startDate, setStartDate] = useState(`${getLocalDateISO().slice(0, 4)}-01-01`);
  const [endDate, setEndDate] = useState(getLocalDateISO());
  const [result, setResult] = useState<{ key: string; report?: Report; error?: string } | null>(null);
  const [drill, setDrill] = useState<{ name: string; explain: ExplainRequest } | null>(null);
  const currency = workspace?.currency || 'USD';
  const key = workspace && dimensionId && startDate && endDate && startDate <= endDate ? new URLSearchParams({ workspaceId: workspace.id, dimensionId, startDate, endDate }).toString() : '';

  useEffect(() => {
    if (!key) return;
    let live = true;
    fetchProfitByLabel<Report>(key).then(report => { if (live) setResult({ key, report }); }).catch(err => { if (live) setResult({ key, error: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [key]);
  const shown = result && result.key === key ? result : null;
  const report = shown?.report;
  const valueName = (value: string) => {
    const node = (nodes || []).find(n => n.dimensionId === dimensionId && n.id === value);
    return node?.description || value;
  };
  const dimension = dimensions.find(d => d.id === dimensionId);
  const dimensionName = dimension ? displayDimensionName(dimension) : dimensionId;

  /** a figure that opens the entries behind it; income is shown as credits, so its sign is turned */
  const cell = (cents: number, accountIds: string[], value: string | null, name: string, section: Section | null): BandCell => ({ className: "text-right font-mono py-1 px-2", content:
      cents === 0 || accountIds.length === 0 ? (cents === 0 ? '' : formatCurrency(cents, currency)) : (
        <button type="button" className="hover:underline" onClick={() => setDrill({
          name, explain: { accountIds, startDate, endDate, expectedCents: cents, sign: section === 'income' ? -1 : 1, ...(value !== null ? { labelFilter: { dimensionId, value }, label: fill(reportText('r.label-value-period', '{label} {value}, {period}'), { label: dimensionName, value: valueName(value), period: reportDates.periodText(startDate, endDate) }) } : {}) },
        })}>
          {formatCurrency(cents, currency)}<span className="sr-only"> {name}{value !== null ? ` ${fill(reportText('r.for-value', 'for {value}'), { value: valueName(value) })}` : ` ${reportText('r.in-total', 'in total')}`}{reportText('r.open-the-entries', ': open the entries')}</span>
        </button>
      ) });
  const idsOf = (section: Section) => (report?.rows || []).filter(r => r.section === section).map(r => r.id);

  return (
    <section aria-labelledby="by-label-title" className="space-y-4">
      <h2 id="by-label-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.profit-by-label', 'Profit by label')}</h2>
      {dimensions.length === 0 ? (
        <ReportEmptyState
          title={reportText('r.no-labels-yet-add-one-property-project-location', 'No labels yet: add one (Property, Project, Location…) in Settings → Labels, and put it on lines.')}
          description={reportText('r.this-report-shows-profit-and-loss-by-one-label-a', 'This report shows profit and loss by one label at a time; with no labels it has nothing to group.')}
        />
      ) : (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.label', 'Label')}
            <select value={dimensionId} onChange={e => setPicked(e.target.value)} className={field}>
              {dimensions.map(d => <option key={d.id} value={d.id}>{displayDimensionName(d)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.from', 'From')}<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={field} /></label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.to', 'To')}<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={field} /></label>
        </div>
      )}
      {startDate > endDate && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{reportText('r.the-period-starts-after-it-ends', 'The period starts after it ends.')}</p>}
      {key && !shown && <LoadingState label={reportText('r.loading', 'Loading…')} rows={3} />}
      {shown?.error && <p role="alert" className="text-sm text-rose-600">{shown.error}</p>}
      {report && report.columns.length === 0 && <ReportEmptyState
        title={reportText('r.no-income-or-costs-in-this-period', 'No income or costs in this period.')}
        description={reportText('r.choose-another-period-or-tag-lines-with-this-label', 'Choose another period, or put this label on the lines that carry the income and costs.')}
      />}
      {report && report.columns.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <GroupedRowTable
            caption={<>{reportText('r.each-value-of', 'Each value of')} {dimensionName}{reportText('r.and-the-lines-without-one-together-they-add-up-t', ', and the lines without one; together they add up to the profit and loss of the period. Posted entries only.')}</>}
            captionClassName="text-left text-xs text-[var(--muted)] pb-1"
            tableClassName="w-full text-sm"
            head={[{ className: "border-b border-[var(--line)] text-[var(--muted)]", cells: [
              { scope: 'col', className: "text-left font-semibold py-2", content: reportText('r.account', 'Account') },
              ...report.columns.map(c => ({ key: c.value, scope: 'col', className: "text-right font-semibold py-2 px-2", content: <bdi>{valueName(c.value)}</bdi> })),
              { scope: 'col', className: "text-right font-semibold py-2 px-2", content: reportText('r.total', 'Total') },
            ] }]}
            groups={SECTION_ORDER.filter(s => report.rows.some(r => r.section === s)).map(section => ({
              key: section,
              rows: [
                { cells: [{ scope: 'rowgroup', colSpan: report.columns.length + 2, className: "text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)] pt-3", content: SECTION_NAMES[section] }] },
                ...report.rows.filter(r => r.section === section).map(r => ({ key: r.id, className: "border-b border-[var(--line)]/50", cells: [
                  { scope: 'row', className: "text-left font-normal py-1", content: <>{r.code ? <span className="font-mono text-xs text-[var(--muted)]">{r.code} </span> : null}<bdi>{r.name}</bdi></> },
                  ...report.columns.map(c => ({ key: c.value, ...cell(c.accounts[r.id] || 0, [r.id], c.value, r.name, section) })),
                  cell(report.columns.reduce((s, c) => s + (c.accounts[r.id] || 0), 0), [r.id], null, r.name, section),
                ] })),
                { className: "font-semibold border-b border-[var(--line)]", cells: [
                  { scope: 'row', className: "text-left py-1", content: sectionTotal(section) },
                  ...report.columns.map(c => ({ key: c.value, ...cell(c[section], idsOf(section), c.value, sectionTotal(section), section) })),
                  cell(report.total[section], idsOf(section), null, sectionTotal(section), section),
                ] },
              ],
            }))}
            foot={[
              ...([['grossProfit', 'Gross profit'], ['netIncome', 'Net income']] as const).map(([k, label]) => ({ key: k, className: "font-semibold", cells: [
                { scope: 'row', className: "text-left py-1", content: label },
                ...report.columns.map(c => ({ key: c.value, className: "text-right font-mono py-1 px-2", content: formatCurrency(c[k], currency) })),
                { className: "text-right font-mono py-1 px-2", content: formatCurrency(report.total[k], currency) },
              ] })),
              ...(() => {
                const budgetOf = (value: string) => budgetedResult({ budgets: budgets || [], accounts: ledgerAccounts || [], dimensionId, value, start: startDate, end: endDate, nodes: nodes || [] });
                // Old imports can supply descriptions while new entries carry node IDs.
                // Give the canonical label's budget to its first actual column only.
                const canon = (v: string) => stableLabelValue(v, dimensionId, nodes || []).normalize('NFC').toLowerCase();
                const counted = new Set<string>();
                const budgeted = report.columns.map(c => {
                  const key = canon(c.value);
                  if (counted.has(key)) return null;
                  counted.add(key);
                  return budgetOf(c.value);
                });
                // A value with a budget but no activity still contributes once, even if
                // multiple saved budgets refer to it by both description and node ID.
                const budgetOnly = [...new Set((budgets || []).map(bg => budgetLabel(bg)).filter(l => l?.dimensionId === dimensionId).map(l => l!.value))]
                  .filter(v => {
                    const key = canon(v);
                    if (counted.has(key)) return false;
                    counted.add(key);
                    return true;
                  }).map(v => ({ value: v, cents: budgetOf(v) || 0 })).filter(v => v.cents !== 0);
                if (budgeted.every(b => b === null) && budgetOnly.length === 0) return [];
                const total = budgeted.reduce<number>((s, b) => s + (b || 0), 0) + budgetOnly.reduce((s, v) => s + v.cents, 0);
                return [
                  { key: 'label-budget-row', 'data-testid': 'label-budget-row', cells: [
                    { scope: 'row', className: "text-left py-1", content: reportText('r.budgeted-result', 'Budgeted result') },
                    ...budgeted.map((b, i) => ({ key: report.columns[i].value, className: "text-right font-mono py-1 px-2", content: formatCurrency(b || 0, currency) })),
                    { className: "text-right font-mono py-1 px-2", content: formatCurrency(total, currency) },
                  ] },
                  { key: 'net-income-vs-budget', className: "font-semibold", cells: [
                    { scope: 'row', className: "text-left py-1", content: reportText('r.net-income-vs-budget', 'Net income vs budget') },
                    ...report.columns.map((c, i) => ({ key: c.value, className: "text-right font-mono py-1 px-2", content: formatCurrency(c.netIncome - (budgeted[i] || 0), currency) })),
                    { className: "text-right font-mono py-1 px-2", content: formatCurrency(report.total.netIncome - total, currency) },
                  ] },
                  ...budgetOnly.length > 0 ? [{ key: 'label-budget-only', cells: [{ colSpan: report.columns.length + 2, className: "text-xs text-[var(--muted)] pt-1", 'data-testid': 'label-budget-only', content: <>{reportText('r.budgeted-with-no-activity-in-this-period-in-the', 'Budgeted with no activity in this period (in the total):')} {budgetOnly.map(v => `${valueName(v.value)} ${formatCurrency(v.cents, currency)}`).join(', ')}</> }] }] : [],
                ];
              })(),
            ]}
          />
        </div>
      )}
      {report && (() => {
        // EU-E3: each parent with its own net income, its children's, and the two together
        const netById = new Map<string, number>();
        for (const c of report.columns) {
          const id = stableLabelValue(c.value, dimensionId, nodes || []);
          netById.set(id, (netById.get(id) || 0) + c.netIncome);
        }
        const rows = rollUp(nodes || [], dimensionId, id => netById.get(id) || 0);
        if (!rows.length) return null;
        if (nodesPartial) {
          return <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.totals-with-children-are-not-shown-this-workspac', 'Totals with children are not shown: this workspace has more label values than were loaded, so some children could be missing from a parent\'s total.')}</p>;
        }
        return (
          <section aria-label={reportText('r.totals-with-children', 'Totals with children')} className="space-y-1 text-sm" data-testid="label-rollup">
            <h3 className="font-semibold">{reportText('r.net-income-with-children', 'Net income with children')}</h3>
            <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,8rem))] gap-2 text-xs text-[var(--muted)]">
              <span>{dimensionName}</span><span className="text-right">{reportText('r.own', 'Own')}</span><span className="text-right">{reportText('r.children', 'Children')}</span><span className="text-right">{reportText('r.total', 'Total')}</span>
            </div>
            {rows.map(r => (
              <div key={r.id} role="group" aria-label={fill(reportText('r.label-rollup-row', '{name}: own {own}, children {children}, total {total}'), { name: r.name, own: formatCurrency(r.own, currency), children: formatCurrency(r.children, currency), total: formatCurrency(r.total, currency) })}
                className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,8rem))] gap-2 border-t border-[var(--line)] py-1">
                <bdi className="truncate">{r.name}</bdi>
                <span className="text-right font-mono">{formatCurrency(r.own, currency)}</span>
                <span className="text-right font-mono">{formatCurrency(r.children, currency)}</span>
                <span className="text-right font-mono font-semibold">{formatCurrency(r.total, currency)}</span>
              </div>
            ))}
          </section>
        );
      })()}
      <DrillDownModal key={drill ? drill.name + JSON.stringify(drill.explain) : 'closed'} isOpen={Boolean(drill)} onClose={() => setDrill(null)} accountName={drill?.name || ''} transactions={[]} explain={drill?.explain} formatCurrency={(v: number) => formatCurrency(v, currency)} from="Profit by label" />
    </section>
  );
}
