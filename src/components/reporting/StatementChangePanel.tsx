import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, X } from 'lucide-react';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useFigureExplanation } from '../../hooks/useFigureExplanation';
import type { ExplainRequest } from '../../lib/reportExplain';
import type { StatementChangeRow, StatementChangeSet } from '../../lib/statementChange';
import { changePercent } from '../../lib/statementChange';

/** Where the entries behind a change come from. */
export type ChangeEntrySource =
  | { kind: 'movement'; start: string; end: string }
  | { kind: 'flow'; current: { start: string; end: string }; prior: { start: string; end: string } };

interface StatementChangePanelProps {
  /** what changed, e.g. "What changed in net profit" */
  title: string;
  /** one sentence with the three figures, written by the screen in its own words */
  summary: string;
  change: StatementChangeSet;
  /** the day range (balance sheet) or the two periods (profit and loss) whose entries are the change */
  source: ChangeEntrySource;
  /** the report's own formatter, in cents */
  formatCurrency: (cents: number) => string;
  /** -1 where the report prints credits as positive, so a line's amount is shown the way the figure is */
  sign: 1 | -1;
  onClose: () => void;
  /** CB-25: only lines carrying this label, on a report that is filtered by one */
  labelFilter?: { dimensionId: string; value: string };
}

/**
 * R-7: "Why did this number change?" — the accounts ranked by how much they moved the figure, and,
 * for one account, the posted lines on each side that make up its change.
 *
 * The list of accounts is the statement's own figures (src/lib/statementChange.ts), so nothing is
 * recalculated. The lines are the server's answer to the same question the drill-down asks
 * (`/api/v1/reports/explain`): the full history, not the capped copy in this browser. Two sides are
 * shown for a profit-and-loss figure — this period's entries and the compared period's — because a
 * flow's difference *is* one minus the other; a balance-sheet figure shows one range, the days
 * between the two dates, which is what moved the balance.
 *
 * When the server cannot answer (offline, a guest workspace, an older server) the panel says so and
 * offers "Try again"; it never shows an empty list as if nothing were there.
 */
export default function StatementChangePanel({ title, summary, change, source, formatCurrency, sign, onClose, labelFilter }: StatementChangePanelProps) {
  const reportText = useReportText();
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const openRow = change.rows.find(row => row.accountId === openAccountId) || null;
  const nothingMoved = change.rows.length === 0;

  return (
    <section
      data-statement-change-panel
      aria-label={title}
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-[var(--text)]">{title}</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">{summary}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 min-w-11 shrink-0 rounded-lg border border-[var(--line)] inline-flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
          aria-label={reportText('r.close-what-changed', 'Close what changed')}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {nothingMoved ? (
        <p role="status" className="text-sm text-[var(--muted)]">
          {reportText('r.no-account-moved-between-these-two-figures', 'No account moved between these two figures: every posted line is the same on both sides.')}
        </p>
      ) : (
        <>
          <RowTable
            caption={reportText('r.accounts-behind-the-change', 'Accounts behind the change, biggest share first')}
            rows={change.rows}
            rowKey={row => row.accountId}
            rowClassName="border-b border-[var(--line)]/60"
            tableClassName="w-full text-xs sm:text-sm"
            headRowClassName="text-[var(--muted)] text-xs"
            columns={[
              {
                header: reportText('r.account', 'Account'),
                cell: (row: StatementChangeRow) => (
                  <span className="flex flex-col">
                    <span className="font-semibold text-[var(--text)]"><bdi>{row.name}</bdi></span>
                    <span className="text-[10px] text-[var(--muted)]">
                      <bdi>{sectionLabel(row.section, reportText)}</bdi>
                      {row.code ? ` · ${row.code}` : ''}
                    </span>
                  </span>
                ),
              },
              { header: reportText('r.column-now', 'Now'), align: 'right' as const, className: 'py-2 font-mono whitespace-nowrap', cell: (row: StatementChangeRow) => formatCurrency(row.currentCents) },
              { header: reportText('r.column-before', 'Before'), align: 'right' as const, className: 'py-2 font-mono whitespace-nowrap', cell: (row: StatementChangeRow) => formatCurrency(row.priorCents) },
              {
                header: reportText('r.column-change', 'Change'),
                align: 'right' as const,
                className: 'py-2 font-mono whitespace-nowrap',
                cell: (row: StatementChangeRow) => {
                  const percent = changePercent(row.changeCents, row.priorCents);
                  return (
                    <span className="flex flex-col items-end">
                      <span>{formatCurrency(row.changeCents)}</span>
                      {percent === null ? null : <span className="text-[10px] text-[var(--muted)]">{percent.toFixed(1)}%</span>}
                    </span>
                  );
                },
              },
              {
                header: reportText('r.effect-on-this-figure', 'Effect on this figure'),
                align: 'right' as const,
                className: 'py-2 font-mono whitespace-nowrap',
                cell: (row: StatementChangeRow) => formatCurrency(row.effectCents),
              },
              {
                header: reportText('r.entries', 'Entries'),
                className: 'py-2',
                cell: (row: StatementChangeRow) => {
                  const open = row.accountId === openAccountId;
                  return (
                    <button
                      type="button"
                      onClick={() => setOpenAccountId(open ? null : row.accountId)}
                      aria-expanded={open}
                      className="min-h-11 inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-2 text-[11px] font-semibold text-[var(--text)]"
                    >
                      {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                      {open ? reportText('r.hide', 'Hide') : reportText('r.show', 'Show')}
                      <span className="sr-only">
                        {reportText('r.the-entries-behind', 'the entries behind')} <bdi>{row.name}</bdi>
                      </span>
                    </button>
                  );
                },
              },
            ]}
          />
          {change.unchangedCount > 0 ? (
            <p className="text-[11px] text-[var(--muted)]">
              {reportText('r.accounts-that-did-not-move-are-not-listed', 'Accounts that did not move are not listed.')}
            </p>
          ) : null}
          {openRow ? (
            <ChangeEntries
              row={openRow}
              source={source}
              sign={sign}
              formatCurrency={formatCurrency}
              labelFilter={labelFilter}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function sectionLabel(section: StatementChangeRow['section'], reportText: (key: string, fallback: string) => string): string {
  switch (section) {
    case 'income': return reportText('r.income', 'Income');
    case 'cogs': return reportText('r.cost-of-goods', 'Cost of goods');
    case 'expense': return reportText('r.expenses', 'Expenses');
    case 'assets': return reportText('r.assets', 'Assets');
    case 'liabilities': return reportText('r.liabilities', 'Liabilities');
    default: return reportText('r.equity', 'Equity');
  }
}

/** The lines on one side of the change, with the figure they add up to and a way into each one. */
function ExplainedSide({ title, workspaceId, request, sign, formatCurrency }: {
  title: string;
  workspaceId: string | null | undefined;
  request: ExplainRequest | null;
  sign: 1 | -1;
  formatCurrency: (cents: number) => string;
}) {
  const reportText = useReportText();
  const openRecord = useUIStore(s => s.openRecord);
  const { data, loading, failed, retry } = useFigureExplanation(workspaceId, request);

  if (!request) return null;
  return (
    <div className="rounded-lg border border-[var(--line)]/70 p-3">
      <p className="text-xs font-bold text-[var(--text)]">{title}</p>
      {loading ? <p className="mt-1 text-xs text-[var(--muted)]" role="status">{reportText('r.loading-the-entries', 'Loading the entries…')}</p> : null}
      {failed ? (
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
          <p role="alert" className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle size={14} aria-hidden="true" />
            {reportText('r.the-entries-could-not-be-loaded', 'The entries behind this figure could not be loaded (offline, or the full history is unavailable). The account totals above are still the report’s own.')}
          </p>
          <button type="button" onClick={retry} className="min-h-11 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--text)]">
            {reportText('r.try-again', 'Try again')}
          </button>
        </div>
      ) : null}
      {data ? (
        data.lines.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--muted)]">{reportText('r.no-posted-entries-on-this-side', 'No posted entries on this side.')}</p>
        ) : (
          <>
            <RowTable
              caption={title}
              rowHeaderColumn={false}
              rows={data.lines}
              rowKey={line => line.key}
              rowClassName="border-b border-[var(--line)]/40"
              tableClassName="mt-1 w-full text-xs"
              headRowClassName="text-[10px] uppercase tracking-wide text-[var(--muted)]"
              footer={(
                <tr className="font-semibold">
                  <th scope="row" colSpan={2} className="py-1 text-left">{reportText('r.total', 'Total')}</th>
                  <td className="py-1 text-right font-mono">{formatCurrency(sign * data.totalCents)}</td>
                </tr>
              )}
              columns={[
                {
                  header: reportText('r.entry-date', 'Date'),
                  className: 'py-1 font-mono whitespace-nowrap',
                  cell: line => line.date,
                },
                {
                  header: reportText('r.entry', 'Entry'),
                  className: 'py-1',
                  cell: line => (
                    <>
                      {line.document ? (
                        <button
                          type="button"
                          className="text-left text-indigo-600 dark:text-indigo-400 hover:underline"
                          onClick={() => openRecord({ type: line.document!.type, id: line.document!.id })}
                        >
                          <bdi>{line.description || line.payee || reportText('r.entry-lower', 'entry')}</bdi>
                        </button>
                      ) : <span><bdi>{line.description}</bdi></span>}
                      <span className="block text-[10px] text-[var(--muted)]"><bdi>{line.accountName}</bdi></span>
                    </>
                  ),
                },
                {
                  header: reportText('r.amount', 'Amount'),
                  align: 'right' as const,
                  className: 'py-1 font-mono whitespace-nowrap',
                  cell: line => formatCurrency(sign * line.amountCents),
                },
              ]}
            />
            <p className="mt-1 text-[10px] text-[var(--muted)]">
              {reportText('r.posted-entries-only-from-the-full-history', 'Posted entries only, from the full history.')}
            </p>
          </>
        )
      ) : null}
    </div>
  );
}

/** The one account whose entries the reader opened, on each side of the change. */
function ChangeEntries({ row, source, sign, formatCurrency, labelFilter }: {
  row: StatementChangeRow;
  source: ChangeEntrySource;
  sign: 1 | -1;
  formatCurrency: (cents: number) => string;
  labelFilter?: { dimensionId: string; value: string };
}) {
  const reportText = useReportText();
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const request = (startDate: string, endDate: string, expectedCents: number): ExplainRequest => ({
    accountIds: [row.accountId],
    startDate,
    endDate,
    expectedCents,
    sign,
    label: row.name,
    ...(labelFilter ? { labelFilter } : {}),
  });
  return (
    <div className="space-y-2" data-change-entries={row.accountId}>
      <h4 className="text-xs font-bold text-[var(--text)]">
        {reportText('r.entries-behind', 'Entries behind')} <bdi>{row.name}</bdi>
      </h4>
      {source.kind === 'movement' ? (
        <ExplainedSide
          title={reportText('r.posted-between-the-two-dates', 'Posted between the two dates')}
          workspaceId={workspaceId}
          request={request(source.start, source.end, row.changeCents)}
          sign={sign}
          formatCurrency={formatCurrency}
        />
      ) : (
        <>
          <ExplainedSide
            title={reportText('r.this-period', 'This period')}
            workspaceId={workspaceId}
            request={request(source.current.start, source.current.end, row.currentCents)}
            sign={sign}
            formatCurrency={formatCurrency}
          />
          <ExplainedSide
            title={reportText('r.the-period-before', 'The period before')}
            workspaceId={workspaceId}
            request={request(source.prior.start, source.prior.end, row.priorCents)}
            sign={sign}
            formatCurrency={formatCurrency}
          />
        </>
      )}
    </div>
  );
}
