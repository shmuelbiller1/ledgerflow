import { useEffect, useId, useMemo, useState } from 'react';
import type { ChartAccount, Transaction } from '../../types';
import type { ReportColumn, StatementData, StatementRow } from '../../lib/reportColumns';
import { statementFigures } from '../../lib/reportColumns';
import { changeContributions, changeFilter, statementChangeGroups } from '../../lib/statementChange';
import { explainFigure, type ExplainFilter, type Explanation } from '../../server/reports/explain';
import { runCommand } from '../../lib/runCommand';
import { recordHash } from '../../lib/recordLinks';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { useReportDates } from '../reporting/useReportDates';
import { useReportText } from '../reporting/useReportText';

interface Props {
  column: ReportColumn;
  chartSections: StatementData;
  rows: StatementRow[];
  accounts: ChartAccount[];
  transactions: Transaction[];
  labelFilter?: ExplainFilter['label'];
  formatMoney: (minor: number) => string;
}

/** A disclosure on the accrual comparison. No extra read or grouping until opened. */
export function StatementChangeReview(props: Props) {
  const text = useReportText();
  const id = useId();
  const [open, setOpen] = useState(false);
  const guest = useAuthStore(s => s.isGuest && !s.user);
  const uid = useAuthStore(s => s.user?.uid);
  const workspace = useAuthStore(s => s.currentWorkspaceId);
  const currentBook = useDataNeedsStore(s => !!workspace && workspace === s.loadedWorkspaceId);
  const chart = useScreenDataHealth(['accounts']);
  const incomplete = useLedgerStore(s => isCollectionCapped(s.truncatedCollections, 'accounts') || (s.isDataTruncated && !Object.values(s.truncatedCollections).some(Boolean)));
  const title = text('r.why-change', 'Why did this number change?');
  return <div data-print-hide className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="min-h-11 font-semibold underline decoration-dotted">{title}</button>
    <section id={id} hidden={!open} aria-label={title} className="space-y-3">
      {open && (chart.ready && !incomplete && (guest || (uid && currentBook))
        ? <ChangeSelection {...props} guest={guest} workspaceId={workspace || ''} />
        : <p role="status">{text('r.change-needs-chart', 'The full account list is needed to explain this change.')}</p>)}
    </section>
  </div>;
}

function ChangeSelection({ column, chartSections, rows, accounts, transactions, labelFilter, formatMoney, guest, workspaceId }: Props & { guest: boolean; workspaceId: string }) {
  const text = useReportText();
  const dates = useReportDates();
  const asOf = !('income' in column.data);
  const groups = useMemo(() => statementChangeGroups(chartSections, accounts), [chartSections, accounts]);
  const [rowId, setRowId] = useState(asOf ? 'total:assets' : 'total:netIncome');
  const group = groups[rowId];
  const prior = column.previousPeriod!;
  const now = column.period;
  const current = statementFigures(column.data).values[rowId], previous = statementFigures(column.previousData!).values[rowId];
  const filter = useMemo(() => changeFilter(group, asOf, now, prior, labelFilter), [group, asOf, now, prior, labelFilter]);
  const period = (p: typeof now) => asOf ? dates.dateText(p.endDate) : dates.periodText(p.startDate, p.endDate);
  return <>
    <label className="flex flex-wrap items-center gap-2 text-sm">{text('r.change-total', 'Report total')}
      <select className="min-h-11 rounded border bg-[var(--surface)] px-2" value={rowId} onChange={e => setRowId(e.target.value)}>
        {rows.filter(r => groups[r.id]).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
    </label>
    <p className="text-sm"><bdi>{period(now)}</bdi>: <bdi>{formatMoney(current)}</bdi> − <bdi>{period(prior)}</bdi>: <bdi>{formatMoney(previous)}</bdi> = <strong><bdi>{formatMoney(current - previous)}</bdi></strong></p>
    <ChangeEntries key={JSON.stringify([rowId, workspaceId, filter, current, previous])} {...{ filter, accounts, transactions, workspaceId, guest, formatMoney, group, now, prior, current, previous, asOf }} />
  </>;
}

type EntriesProps = Pick<Props, 'accounts' | 'transactions' | 'formatMoney'> & {
  workspaceId: string; guest: boolean; filter: ExplainFilter; group: Parameters<typeof changeContributions>[1];
  now: ReportColumn['period']; prior: ReportColumn['period']; current: number; previous: number; asOf: boolean;
};
function ChangeEntries({ filter, accounts, transactions, workspaceId, guest, group, now, prior, current, previous, asOf, formatMoney }: EntriesProps) {
  const text = useReportText();
  const dates = useReportDates();
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState(25);
  // A live revision invalidates the read even when two offsetting edits leave the total unchanged.
  const request = useMemo(() => ({ filter, accounts, transactions, attempt, workspaceId, guest }), [filter, accounts, transactions, attempt, workspaceId, guest]);
  const [answer, setAnswer] = useState<{ request: typeof request; lines: Explanation['lines'] | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      if (!filter.accountIds.length) return [];
      if (guest) return explainFigure(accounts, transactions, filter).lines;
      const { label, ...range } = filter;
      const result = await runCommand<Explanation>({ path: '/api/v1/reports/explain', method: 'POST', signal: controller.signal,
        body: { workspaceId, ...range, ...(label && { labelDimension: label.dimensionId, labelValue: label.value }) } });
      if (!Array.isArray(result?.lines)) throw new Error('Missing explanation');
      return result.lines;
    }
    const publish = (lines: Explanation['lines'] | null) => { if (!controller.signal.aborted) setAnswer({ request, lines }); };
    void read().then(publish, () => publish(null));
    return () => controller.abort();
  }, [request, filter, accounts, transactions, guest, workspaceId]);
  const lines = answer?.request === request ? answer.lines : undefined;
  const entries = useMemo(() => lines && changeContributions(lines, group, asOf, now, prior, current, previous), [lines, group, asOf, now, prior, current, previous]);
  if (lines === undefined) return <p role="status">{text('r.loading-report-records', 'Loading report records…')}</p>;
  if (!entries) return <div role="status" className="text-sm">
    {lines === null ? text('r.change-read-failed', 'The entries for this comparison could not be loaded.') : text('r.change-mismatch', 'The entries do not match both totals on screen. Refresh the report before relying on this explanation.')}
    <button type="button" className="ms-2 min-h-11 px-2 underline" onClick={() => setAttempt(n => n + 1)}>{text('r.try-again', 'Try again')}</button>
  </div>;
  if (!entries.length) return <p role="status">{text('r.no-change-entries', 'No entries changed this total between the two periods.')}</p>;
  return <><p className="text-sm text-[var(--muted)]">{text('r.change-order', 'Entries are ordered by size of change. The comparison period is subtracted.')}</p>
    <ol className="divide-y divide-[var(--line)]">{entries.slice(0, limit).map(e => <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
      <a className="inline-flex min-h-11 min-w-0 items-center break-words underline" href={`#${recordHash({ type: 'transaction', id: e.id })}`}><bdi>{e.description}</bdi></a>
      <span><bdi>{dates.dateText(e.date)}</bdi> · <bdi>{formatMoney(e.change)}</bdi></span>
    </li>)}</ol>
    {entries.length > limit && <button type="button" className="min-h-11 underline" onClick={() => setLimit(n => n + 25)}>{text('r.more-change-entries', 'Show more entries')}</button>}
  </>;
}
