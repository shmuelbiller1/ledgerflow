import ExportTemplateControls from '../reporting/ExportTemplateControls';
import React, { useId, useMemo, useState } from "react";
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
      `${row.label} · ${period.startDate} to ${period.endDate}`,
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
    const csv = statementColumnCsv(
      visibleRows,
      displayedColumns,
      showPercent,
      compare,
      accounts,
      compareLabel,
    );
    downloadCsv(
      `${kind === "pl" ? "Profit_and_Loss" : "Balance_Sheet"}_${startDate}_${endDate}_${mode}.csv`,
      csv.headers,
      csv.rows,
    );
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
            {startDate} to {endDate} ·{" "}
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
          <div role="region" aria-label={`${title} period table`} tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border border-[var(--line)]">
            <table className="w-full border-collapse text-sm tabular-nums">
              <caption className="sr-only">
                {title} by {mode} with {showPercent ? "percentages and " : ""}
                {compare ? "comparison variance" : "amounts"}
              </caption>
              <thead className="bg-[var(--ink)]">
                <tr>
                  <th scope="col" rowSpan={2} className="p-3 text-left">
                    <button
                      type="button"
                      onClick={() => onSort("name")}
                      className="min-h-11"
                      aria-label="Sort accounts by name"
                    >
                      Account
                    </button>
                  </th>
                  <th scope="col" rowSpan={2} className="p-3 text-left">
                    <button
                      type="button"
                      onClick={() => onSort("code")}
                      className="min-h-11"
                      aria-label="Sort accounts by code"
                    >
                      Code
                    </button>
                  </th>
                  {displayedColumns.map((column) => (
                    <th
                      scope="colgroup"
                      colSpan={cellsPerColumn}
                      key={column.period.id}
                      className="p-3 text-center whitespace-nowrap"
                    >
                      {column.period.label}
                      <span className="block text-xs font-normal">
                        {kind === "bs"
                          ? column.period.endDate
                          : `${column.period.startDate} – ${column.period.endDate}`}
                      </span>
                      {compare && column.previousPeriod && (
                        <span className="block text-xs font-normal">
                          vs{" "}
                          {kind === "bs"
                            ? column.previousPeriod.endDate
                            : `${column.previousPeriod.startDate} – ${column.previousPeriod.endDate}`}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
                <tr>
                  {displayedColumns.map((column) => (
                    <React.Fragment key={column.period.id}>
                      <th scope="col" className="p-3 text-right">
                        {column.period.id === columns[0]?.period.id ? (
                          <button
                            type="button"
                            onClick={() => onSort("balance")}
                            className="min-h-11"
                            aria-label="Sort accounts by first period amount"
                          >
                            Amount
                          </button>
                        ) : (
                          "Amount"
                        )}
                      </th>
                      {showPercent && (
                        <th
                          scope="col"
                          className="p-3 text-right whitespace-nowrap"
                        >
                          % of total
                        </th>
                      )}
                      {compare && (
                        <>
                          <th scope="col" className="p-3 text-right">
                            {compareLabel}
                          </th>
                          <th scope="col" className="p-3 text-right">
                            Variance
                          </th>
                          <th
                            scope="col"
                            className="p-3 text-right whitespace-nowrap"
                          >
                            Variance %
                          </th>
                        </>
                      )}
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  // K-14: the group a row can hide, when it is a parent account
                  const groupId = row.group ? row.accountId : undefined;
                  return (
                  <tr
                    key={row.id}
                    className={`border-t border-[var(--line)] ${row.total || row.heading ? "font-semibold bg-[var(--ink)]" : ""} ${row.subtotal ? "font-semibold" : ""}`}
                  >
                    <th scope="row" className="p-3 text-left whitespace-nowrap">
                      <span
                        className="inline-flex items-center gap-1"
                        style={{
                          paddingLeft: `${(row.depth || 0) * ACCOUNT_GROUP_INDENT_PX}px`,
                        }}
                      >
                        {groupId ? (
                          <AccountGroupToggle
                            label={row.label}
                            expanded={!collapsedGroups.has(groupId)}
                            onToggle={() =>
                              setCollapsedGroups((collapsed) =>
                                toggleAccountGroup(collapsed, groupId),
                              )
                            }
                          />
                        ) : null}
                        {row.label}
                      </span>
                    </th>
                    <td className="p-3">{row.code}</td>
                    {figures.map((column) => {
                      const amount = column.current.values[row.id] || 0;
                      const previous = column.previous?.values[row.id] || 0;
                      const variance = column.previous
                        ? reportVariance(amount, previous)
                        : null;
                      return (
                        <React.Fragment key={column.period.id}>
                          <td className="p-3 text-right whitespace-nowrap">
                            <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{!row.heading &&
                              (row.accountId ? (
                                <button
                                  type="button"
                                  onClick={() => drillDown(row, column.period)}
                                  className="min-h-11 underline decoration-dotted"
                                  aria-label={`${row.label}, ${column.period.label}, open ledger`}
                                >
                                  <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatMoney(amount)}</bdi>
                                </button>
                              ) : (
                                formatMoney(amount)
                              ))}</bdi>
                          </td>
                          {showPercent && (
                            <td className="p-3 text-right whitespace-nowrap">
                              {!row.heading &&
                                reportPercent(
                                  percentageOfTotal(
                                    amount,
                                    column.current.denominator,
                                  ),
                                )}
                            </td>
                          )}
                          {compare && (
                            <>
                              <td className="p-3 text-right whitespace-nowrap">
                                <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{!row.heading &&
                                  (column.previous
                                    ? formatMoney(previous)
                                    : "—")}</bdi>
                              </td>
                              <td className="p-3 text-right whitespace-nowrap">
                                <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{!row.heading &&
                                  (variance
                                    ? formatMoney(variance.amount)
                                    : "—")}</bdi>
                              </td>
                              <td className="p-3 text-right whitespace-nowrap">
                                {!row.heading &&
                                  reportPercent(variance?.percent ?? null)}
                              </td>
                            </>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
