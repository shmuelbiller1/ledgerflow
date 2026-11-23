import { toast } from 'sonner';
import { useReportText } from '../reporting/useReportText';
import { StatementChangeReview } from './StatementChangeReview';
import type { ReportLabelFilterValue } from '../../lib/reportLabelScope';
import ExportTemplateControls from '../reporting/ExportTemplateControls';
import { useReportDates } from '../reporting/useReportDates';
import { useId, useMemo, useState } from "react";
import type { ChartAccount, Transaction } from "../../types";
import { useAuthStore } from "../../stores/useAuthStore";
import { useStatementColumns } from "../../hooks/useStatementColumns";
import { STATEMENT_COLLECTIONS, useBrowserProvenance } from "../../hooks/useBrowserProvenance";
import { ReportProvenanceNote } from "../reporting/ReportProvenanceNote";
import { combineProvenance, provenanceFromResponse } from "../../lib/reportProvenance";
import {
  splitReportPeriods,
  statementFigures,
  statementRows,
  percentageOfTotal,
  reportVariance,
  reportPercent,
  statementColumnCsv,
} from "../../lib/reportColumns";
import type {
  ReportColumnMode,
  ReportPeriod,
  StatementData,
  StatementKind,
  StatementRow,
} from "../../lib/reportColumns";
import { downloadCsv } from "../../lib/csvExport";
import { isPostable, isTransactionInDateRange } from "../../lib/txFilters";
import {
  ACCOUNT_GROUP_INDENT_PX,
  toggleAccountGroup,
  visibleGroupRows,
} from "../../lib/accountGroups";
import { movePeriod, readPeriodLayout, savePeriodLayout, validPeriodLayout, visiblePeriods, type ReportPeriodLayout } from "../../lib/reportPeriodLayout";
import { GroupedRowTable } from "../ui/RowTable";
import { AccountGroupToggle } from "./AccountGroupControls";

interface StatementColumnsProps {
  kind: StatementKind;
  title: string;
  accounts: ChartAccount[];
  transactions: Transaction[];
  startDate: string;
  endDate: string;
  compareStartDate?: string;
  compareEndDate?: string;
  compare: boolean;
  /** the heading of the comparison column (R-2: "Budget"); "Previous" when not given */
  compareLabel?: string;
  labelFilter?: ReportLabelFilterValue;
  mode: ReportColumnMode;
  onModeChange: (mode: ReportColumnMode) => void;
  showPercent: boolean;
  onPercentChange: (show: boolean) => void;
  totalData: StatementData;
  previousTotalData: StatementData;
  totalAuthoritative: boolean;
  formatMoney: (cents: number) => string;
  sortBy?: "code" | "name" | "balance";
  sortDir?: "asc" | "desc";
  onSort: (field: "code" | "name" | "balance") => void;
  onDrillDown: (name: string, transactions: Transaction[]) => void;
}

export function StatementColumns(props: StatementColumnsProps) {
  const {
    kind,
    title,
    accounts,
    transactions,
    startDate,
    endDate,
    compareStartDate,
    compareEndDate,
    compare,
    compareLabel = "Previous",
    mode,
    onModeChange,
    showPercent,
    onPercentChange,
    totalData,
    previousTotalData,
    totalAuthoritative,
    formatMoney,
    sortBy,
    sortDir,
    onSort,
    onDrillDown,
  } = props;
  const reportDates = useReportDates();
  const reportText = useReportText();
  const currency = useAuthStore(state => state.getCurrentWorkspace()?.currency) || 'USD';
  const formId = useId();
  // K-14: a group starts open, so a report with groups shows every account it showed before.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const fiscalStart =
    useAuthStore(
      (state) => state.getCurrentWorkspace()?.fiscalYearStartMonth,
    ) || 1;
  const periods = useMemo(
    () => splitReportPeriods(startDate, endDate, mode, fiscalStart),
    [startDate, endDate, mode, fiscalStart],
  );
  const previousPeriods = useMemo(
    () =>
      compare && compareStartDate && compareEndDate
        ? splitReportPeriods(
            compareStartDate,
            compareEndDate,
            mode,
            fiscalStart,
          )
        : [],
    [compare, compareStartDate, compareEndDate, mode, fiscalStart],
  );
  const report = useStatementColumns(
    kind,
    accounts,
    transactions,
    periods,
    previousPeriods,
    mode !== "total",
  );
  const columns = useMemo(
    () =>
      mode === "total"
        ? report.columns.map((column) => ({
            ...column,
            data: totalData,
            previousData: compare ? previousTotalData : undefined,
          }))
        : report.columns,
    [mode, report.columns, totalData, previousTotalData, compare],
  );
  const userId = useAuthStore(state => state.user?.uid || 'guest');
  const workspaceId = useAuthStore(state => state.currentWorkspaceId || 'sample');
  const layoutKey = JSON.stringify(['lf_report_periods_v1', userId, workspaceId, kind, mode, periods.map(period => period.id)]);
  const [choice, setChoice] = useState<{ key: string; layout: ReportPeriodLayout } | null>(null);
  const ids = columns.map(column => column.period.id);
  const layout = choice?.key === layoutKey ? validPeriodLayout(choice.layout, ids) : readPeriodLayout(layoutKey, ids);
  const displayedColumns = visiblePeriods(columns, layout);
  const updateLayout = (next: ReportPeriodLayout) => {
    setChoice({ key: layoutKey, layout: next });
    savePeriodLayout(layoutKey, next);
  };
  const active = mode !== "total" || showPercent || compare;
  const rows = useMemo(
    () =>
      columns[0] && report.columns[0]
        ? statementRows(
            accounts,
            report.columns[0].data,
            sortBy,
            sortDir,
            statementFigures(columns[0].data, accounts),
          )
        : [],
    [accounts, columns, report.columns, sortBy, sortDir],
  );
  const visibleRows = useMemo(
    () => visibleGroupRows(rows, collapsedGroups),
    [rows, collapsedGroups],
  );
  const figures = displayedColumns.map((column) => ({
    period: column.period,
    current: statementFigures(column.data, accounts),
    previous: column.previousData
      ? statementFigures(column.previousData, accounts)
      : undefined,
  }));
  const complete = mode === "total" ? totalAuthoritative : report.authoritative;
  // AUD-10: the period columns' provenance; the total column is the statement's own (its note)
  const browserFigures = useBrowserProvenance(STATEMENT_COLLECTIONS, report.incomplete);
  const truncated = browserFigures.completeness !== "complete";
  const provenance =
    mode === "total"
      ? null
      : report.authoritative
        ? combineProvenance(columns.map((column) => provenanceFromResponse(column.data)))
        : report.loading && !truncated
          ? null
          : browserFigures;
  const drillDown = (row: StatementRow, period: ReportPeriod) =>
    onDrillDown(
      // H-8: the drill-down sentence names the period for a reader; the filter below keeps ISO
      `${row.label} · ${reportDates.periodText(period.startDate, period.endDate)}`,
      transactions.filter(
        (transaction) =>
          isPostable(transaction) &&
          isTransactionInDateRange(
            transaction,
            kind === "pl" ? period.startDate : undefined,
            period.endDate,
          ) &&
          transaction.lines?.some((line) => line.accountId === row.accountId),
      ),
    );
  const exportCsv = () => {
    try {
      const csv = statementColumnCsv(visibleRows, displayedColumns, showPercent, compare, accounts, compareLabel, currency);
      downloadCsv(
        `${kind === "pl" ? "Profit_and_Loss" : "Balance_Sheet"}_${startDate}_${endDate}_${mode}.csv`,
        csv.headers, csv.rows,
      );
    } catch {
      toast.error(reportText('r.report-csv-unavailable', 'CSV could not be created. Check the book currency and report amounts.'));
    }
  };
  const cellsPerColumn = 1 + (showPercent ? 1 : 0) + (compare ? 3 : 0);
  return (
    <section className="space-y-3" aria-label={`${title} columns`}>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <label
          htmlFor={`${formId}-mode`}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          Columns:
          <select
            id={`${formId}-mode`}
            value={mode}
            onChange={(event) =>
              onModeChange(event.target.value as ReportColumnMode)
            }
            className="min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3"
          >
            <option value="total">Total</option>
            <option value="months">Months</option>
            <option value="quarters">Quarters</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showPercent}
            onChange={(event) => onPercentChange(event.target.checked)}
          />
          % of total
        </label>
        <button
          type="button"
          onClick={exportCsv}
          disabled={
            columns.length === 0 || report.loading || (truncated && !complete)
          }
          className="min-h-11 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold disabled:opacity-50"
        >
          Export columns CSV
        </button>
      </div>
      {active && columns.length > 0 && <ExportTemplateControls report={`statement:${kind}:${mode}`} columns={columns.map(column=>`${column.period.id}|${column.period.label}|percent:${showPercent}|compare:${compare}`)} layout={{order:layout.order.map(id=>String(ids.indexOf(id))),hidden:layout.hidden.map(id=>String(ids.indexOf(id)))}} onUse={next=>updateLayout({order:next.order.map(index=>ids[Number(index)]),hidden:next.hidden.map(index=>ids[Number(index)])})} />}
      {active && columns.length > 1 && <details data-print-hide className="rounded-xl border p-3">
        <summary className="min-h-11 cursor-pointer">Choose and order periods</summary>
        <p className="text-sm">Amounts, percentages, comparisons, totals and CSV follow this order. At least one period stays visible.</p>
        <fieldset className="space-y-2">
          <legend className="sr-only">Visible report periods</legend>
          {layout.order.map((id, index) => {
            const period = columns.find(column => column.period.id === id)!.period;
            const hidden = layout.hidden.includes(id);
            return <div key={id} className="flex flex-wrap items-center gap-2">
              <label className="min-h-11 flex items-center gap-2"><input type="checkbox" checked={!hidden}
                disabled={!hidden && displayedColumns.length === 1}
                onChange={() => updateLayout({ ...layout, hidden: hidden ? layout.hidden.filter(value => value !== id) : [...layout.hidden, id] })} />{period.label}</label>
              <button type="button" className="min-h-11 px-3 border rounded" aria-label={`Move ${period.label} earlier`} disabled={index === 0} onClick={() => updateLayout(movePeriod(layout, id, -1))}>← Earlier</button>
              <button type="button" className="min-h-11 px-3 border rounded" aria-label={`Move ${period.label} later`} disabled={index === layout.order.length - 1} onClick={() => updateLayout(movePeriod(layout, id, 1))}>Later →</button>
            </div>;
          })}
          <button type="button" className="min-h-11 px-3 border rounded" onClick={() => updateLayout(validPeriodLayout(null, ids))}>Reset period columns</button>
        </fieldset>
      </details>}
      {active && (
        <>
          <p className="text-xs text-[var(--muted)]">
            {/* H-8 (AI #10): the reader's date format, not the stored ISO string */}
            {reportDates.periodText(startDate, endDate)} ·{" "}
            {kind === "bs"
              ? "Closing balances at each period end"
              : "Activity inside each period"}{" "}
            · % of {kind === "pl" ? "income" : "total assets"}
          </p>
          {report.loading && (
            <p role="status" className="text-sm">
              Loading full period reports…
            </p>
          )}
          <ReportProvenanceNote provenance={provenance} />
          {truncated && !complete && (
            <p role="status" className="text-sm">
              CSV export is available after the full reports load.
            </p>
          )}
          {compare && previousPeriods.length !== periods.length && (
            <p role="status" className="text-sm">
              The comparison has a different number of periods. Unavailable
              comparisons are shown as —.
            </p>
          )}
          <div role="region" aria-label={`${title} period table`} tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border border-[var(--line)]">{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
            <GroupedRowTable
              caption={<>{title} by {mode} with {showPercent ? "percentages and " : ""}{compare ? "comparison variance" : "amounts"}</>}
              captionClassName="sr-only"
              tableClassName="w-full border-collapse text-sm tabular-nums"
              headClassName="bg-[var(--ink)]"
              head={[
                { cells: [
                  { scope: 'col', rowSpan: 2, className: "p-3 text-start", content: (
                    <button type="button" onClick={() => onSort("name")} className="min-h-11" aria-label="Sort accounts by name">Account</button>
                  ) },
                  { scope: 'col', rowSpan: 2, className: "p-3 text-start", content: (
                    <button type="button" onClick={() => onSort("code")} className="min-h-11" aria-label="Sort accounts by code">Code</button>
                  ) },
                  ...displayedColumns.map(column => ({ key: column.period.id, scope: 'colgroup' as const, colSpan: cellsPerColumn, className: "p-3 text-center whitespace-nowrap", content: (<>
                    {column.period.label}
                    <span className="block text-xs font-normal">
                      {/* H-8: the column headings write the reader's layout too */}
                      {kind === "bs" ? reportDates.dateText(column.period.endDate) : reportDates.periodText(column.period.startDate, column.period.endDate)}
                    </span>
                    {compare && column.previousPeriod && (
                      <span className="block text-xs font-normal">
                        vs {kind === "bs" ? reportDates.dateText(column.previousPeriod.endDate) : reportDates.periodText(column.previousPeriod.startDate, column.previousPeriod.endDate)}
                      </span>
                    )}
                  </>) })),
                ] },
                { cells: displayedColumns.flatMap(column => [
                  { key: `${column.period.id}-amount`, scope: 'col' as const, className: "p-3 text-right", content: column.period.id === columns[0]?.period.id ? (
                    <button type="button" onClick={() => onSort("balance")} className="min-h-11" aria-label="Sort accounts by first period amount">Amount</button>
                  ) : "Amount" },
                  showPercent && { key: `${column.period.id}-percent`, scope: 'col' as const, className: "p-3 text-right whitespace-nowrap", content: '% of total' },
                  compare && [
                    { key: `${column.period.id}-previous`, scope: 'col' as const, className: "p-3 text-right", content: compareLabel },
                    { key: `${column.period.id}-variance`, scope: 'col' as const, className: "p-3 text-right", content: 'Variance' },
                    { key: `${column.period.id}-variance-percent`, scope: 'col' as const, className: "p-3 text-right whitespace-nowrap", content: 'Variance %' },
                  ],
                ]) },
              ]}
              groups={[{ rows: visibleRows.map(row => {
                // K-14: the group a row can hide, when it is a parent account
                const groupId = row.group ? row.accountId : undefined;
                return { key: row.id, className: `border-t border-[var(--line)] ${row.total || row.heading ? "font-semibold bg-[var(--ink)]" : ""} ${row.subtotal ? "font-semibold" : ""}`, cells: [
                  { scope: 'row', className: "p-3 text-start whitespace-nowrap", content: (
                    <span className="inline-flex items-center gap-1" style={{ paddingInlineStart: `${(row.depth || 0) * ACCOUNT_GROUP_INDENT_PX}px` }}>
                      {groupId ? (
                        <AccountGroupToggle label={row.label} expanded={!collapsedGroups.has(groupId)} onToggle={() => setCollapsedGroups((collapsed) => toggleAccountGroup(collapsed, groupId))} />
                      ) : null}
                      {row.label}
                    </span>
                  ) },
                  { className: "p-3", content: row.code },
                  ...figures.flatMap(column => {
                    const amount = column.current.values[row.id] || 0;
                    const previous = column.previous?.values[row.id] || 0;
                    const variance = column.previous ? reportVariance(amount, previous) : null;
                    return [
                      { key: column.period.id, className: "p-3 text-right whitespace-nowrap", content: (
                        <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{!row.heading &&
                          (row.accountId ? (
                            <button type="button" onClick={() => drillDown(row, column.period)} className="min-h-11 underline decoration-dotted" aria-label={`${row.label}, ${column.period.label}, open ledger`}>
                              <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatMoney(amount)}</bdi>
                            </button>
                          ) : (
                            formatMoney(amount)
                          ))}</bdi>
                      ) },
                      showPercent && { key: `${column.period.id}-percent`, className: "p-3 text-right whitespace-nowrap", content: !row.heading && reportPercent(percentageOfTotal(amount, column.current.denominator)) },
                      compare && [
                        { key: `${column.period.id}-previous`, className: "p-3 text-right whitespace-nowrap", content: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{!row.heading && (column.previous ? formatMoney(previous) : "—")}</bdi> },
                        { key: `${column.period.id}-variance`, className: "p-3 text-right whitespace-nowrap", content: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{!row.heading && (variance ? formatMoney(variance.amount) : "—")}</bdi> },
                        { key: `${column.period.id}-variance-percent`, className: "p-3 text-right whitespace-nowrap", content: !row.heading && reportPercent(variance?.percent ?? null) },
                      ],
                    ];
                  }),
                ] };
              }) }]}
            />
          </div>
          {mode === 'total' && compare && compareLabel !== 'Budget' && columns[0]?.previousData && columns[0].previousPeriod && (
            <StatementChangeReview key={JSON.stringify([userId, workspaceId, periods, previousPeriods, props.labelFilter])}
              column={columns[0]} chartSections={report.columns[0].data} rows={rows} accounts={accounts} transactions={transactions}
              formatMoney={formatMoney} labelFilter={props.labelFilter} />
          )}
        </>
      )}
    </section>
  );
}
