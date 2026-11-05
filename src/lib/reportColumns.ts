import type { ChartAccount, Transaction } from "../types";
import type {
  ServerPLData,
  ServerBalanceSheetData,
} from "../hooks/useFinancialReporting";
import {
  computeProfitAndLoss,
  computeBalanceSheet,
} from "../server/reports/computeReports";
import {
  addToDateISO,
  getLocalDateISO,
  monthBoundsISO,
  parseLocalDate,
} from "./calendarDate";
import { getFiscalQuarter } from "./fiscalCalendar";
import { csvMoney } from "./csvExport";
import { accountGroupLayout, groupSubtotals } from "./accountGroups";

export type ReportColumnMode = "total" | "months" | "quarters";
export type StatementKind = "pl" | "bs";
export type StatementData = ServerPLData | ServerBalanceSheetData;
export interface ReportPeriod {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}
export interface ReportColumn {
  period: ReportPeriod;
  data: StatementData;
  previousPeriod?: ReportPeriod;
  previousData?: StatementData;
}
export interface StatementFigures {
  values: Record<string, number>;
  denominator: number;
}
export interface StatementRow {
  id: string;
  label: string;
  code?: string;
  accountId?: string;
  heading?: boolean;
  total?: boolean;
  /** Account groups (K-14): how far the row sits inside its section, 0 at the section level. */
  depth?: number;
  /** The groups that hide this row while they are collapsed. */
  collapsedBy?: string[];
  /** An account row with accounts inside it, so the table can hide them. */
  group?: boolean;
  /** A "Total <parent>" row: the accounts inside that group, and nothing else. */
  subtotal?: boolean;
}

function validDate(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    getLocalDateISO(parseLocalDate(date)) === date
  );
}

/** Calendar months and fiscal quarters, clipped to the selected inclusive dates. */
export function splitReportPeriods(
  startDate: string,
  endDate: string,
  mode: ReportColumnMode,
  fiscalYearStartMonth = 1,
): ReportPeriod[] {
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate)
    return [];
  if (mode === "total")
    return [
      { id: `${startDate}:${endDate}`, label: "Total", startDate, endDate },
    ];
  const periods: ReportPeriod[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const quarter =
      mode === "quarters"
        ? getFiscalQuarter(cursor, fiscalYearStartMonth)
        : undefined;
    const boundary = quarter?.endDate || monthBoundsISO(cursor).end;
    const end = boundary < endDate ? boundary : endDate;
    const label =
      quarter?.label ||
      new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(
        parseLocalDate(cursor),
      );
    if (end < cursor) return [];
    periods.push({
      id: `${cursor}:${end}`,
      label,
      startDate: cursor,
      endDate: end,
    });
    if (end === endDate) break;
    cursor = addToDateISO(end, { days: 1 });
  }
  return periods;
}

/** A balance sheet is a closing snapshot; a P&L is activity inside each column period. */
export function computeReportColumns(
  kind: StatementKind,
  accounts: ChartAccount[],
  transactions: Transaction[],
  periods: ReportPeriod[],
  previousPeriods: ReportPeriod[] = [],
): ReportColumn[] {
  const compute = (period: ReportPeriod) =>
    kind === "pl"
      ? computeProfitAndLoss(
          accounts,
          transactions,
          period.startDate,
          period.endDate,
        )
      : computeBalanceSheet(accounts, transactions, period.endDate);
  return periods.map((period, index) => {
    const previousPeriod = previousPeriods[index];
    return {
      period,
      data: compute(period),
      ...(previousPeriod
        ? { previousPeriod, previousData: compute(previousPeriod) }
        : {}),
    };
  });
}

/**
 * Every figure a statement row can show, by row id. `accounts` is only needed for the account-group
 * subtotals (K-14): a group's figure is the sum of the accounts of that group already in the
 * section, so no total here is anything but the accounts' own figures added up.
 */
export function statementFigures(
  data: StatementData,
  accounts: ChartAccount[] = [],
): StatementFigures {
  const values: Record<string, number> = {};
  if ("income" in data) {
    for (const section of ["income", "cogs", "expense"] as const) {
      for (const [id, account] of Object.entries(data[section].accounts))
        values[`account:${id}`] = account.balance;
      values[`total:${section}`] = data[section].total;
      const members = accounts.filter(
        (account) => account.id in data[section].accounts,
      );
      for (const [id, sum] of groupSubtotals(members, (account) => ({
        amount: data[section].accounts[account.id]?.balance || 0,
      })))
        values[`group:${id}`] = sum.amount;
    }
    values["total:grossProfit"] = data.grossProfit;
    values["total:netIncome"] = data.netIncome;
    return { values, denominator: data.income.total };
  }
  const sectionType = {
    assets: "asset",
    liabilities: "liability",
    equity: "equity",
  } as const;
  for (const section of ["assets", "liabilities", "equity"] as const) {
    for (const [id, amount] of Object.entries(data[section]))
      values[`account:${id}`] = amount;
    const members = accounts.filter(
      (account) => account.type === sectionType[section],
    );
    for (const [id, sum] of groupSubtotals(members, (account) => ({
      amount: data[section][account.id] || 0,
    })))
      values[`group:${id}`] = sum.amount;
  }
  values["total:assets"] = data.totalAssets;
  values["total:liabilities"] = data.totalLiabilities;
  values["total:retainedEarnings"] = data.netIncome;
  values["total:equity"] = data.totalEquity + data.netIncome;
  values["total:claims"] = data.totalClaims;
  return { values, denominator: data.totalAssets };
}

export function percentageOfTotal(
  amount: number,
  total: number,
): number | null {
  return total === 0 ? null : (amount / total) * 100;
}
export function reportVariance(
  amount: number,
  previous: number,
): { amount: number; percent: number | null } {
  const difference = amount - previous;
  return {
    amount: difference,
    percent: previous === 0 ? null : (difference / Math.abs(previous)) * 100,
  };
}
export function reportPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export function statementRows(
  accounts: ChartAccount[],
  data: StatementData,
  sortBy: "code" | "name" | "balance" = "code",
  sortDir: "asc" | "desc" = "asc",
  sortFigures?: StatementFigures,
): StatementRow[] {
  const figures = sortFigures || statementFigures(data, accounts);
  const rows: StatementRow[] = [];
  const compare = (a: ChartAccount, b: ChartAccount) => {
    const result =
      sortBy === "balance"
        ? (figures.values[`account:${a.id}`] || 0) -
          (figures.values[`account:${b.id}`] || 0)
        : (sortBy === "code" ? a.code || "" : a.name).localeCompare(
            sortBy === "code" ? b.code || "" : b.name,
          );
    return sortDir === "asc" ? result : -result;
  };
  /**
   * The section's accounts in the report's own order, with a group's children indented under their
   * parent and a subtotal row after them (K-14). Without a group this is the flat sorted list it was.
   */
  const accountRows = (members: ChartAccount[]): StatementRow[] =>
    accountGroupLayout(members, compare).map((row) =>
      row.kind === "subtotal"
        ? {
            id: `group:${row.member.id}`,
            label: row.label,
            depth: row.depth,
            collapsedBy: row.collapsedBy,
            subtotal: true,
          }
        : {
            id: `account:${row.member.id}`,
            accountId: row.member.id,
            label: row.member.name,
            code: row.member.code,
            depth: row.depth,
            collapsedBy: row.collapsedBy,
            group: row.hasChildren,
          },
    );
  const section = (id: string, title: string, members: ChartAccount[]) => {
    rows.push({ id: `heading:${id}`, label: title, heading: true });
    rows.push(...accountRows(members));
    rows.push({ id: `total:${id}`, label: `Total ${title}`, total: true });
  };
  if ("income" in data) {
    section(
      "income",
      "Income",
      accounts.filter((account) => account.id in data.income.accounts),
    );
    section(
      "cogs",
      "Cost of goods sold",
      accounts.filter((account) => account.id in data.cogs.accounts),
    );
    rows.push({ id: "total:grossProfit", label: "Gross profit", total: true });
    section(
      "expense",
      "Expenses",
      accounts.filter((account) => account.id in data.expense.accounts),
    );
    rows.push({ id: "total:netIncome", label: "Net income", total: true });
  } else {
    section(
      "assets",
      "Assets",
      accounts.filter((account) => account.type === "asset"),
    );
    section(
      "liabilities",
      "Liabilities",
      accounts.filter((account) => account.type === "liability"),
    );
    // Current earnings are a separate equity row, included once in the equity subtotal.
    rows.push({ id: "heading:equity", label: "Equity", heading: true });
    rows.push(
      ...accountRows(accounts.filter((account) => account.type === "equity")),
    );
    rows.push({ id: "total:retainedEarnings", label: "Current earnings" });
    rows.push({ id: "total:equity", label: "Total Equity", total: true });
    rows.push({
      id: "total:claims",
      label: "Total liabilities and equity",
      total: true,
    });
  }
  return rows;
}

/** Export the same cents and percentages displayed by the table, through the shared CSV writer. */
export function statementColumnCsv(
  rows: StatementRow[],
  columns: ReportColumn[],
  showPercent: boolean,
  compare: boolean,
  accounts: ChartAccount[] = [],
): { headers: string[]; rows: string[][] } {
  const headers = ["Account", "Code"];
  for (const column of columns) {
    const label = `${column.period.label} (${column.period.startDate} to ${column.period.endDate})`;
    headers.push(label);
    if (showPercent) headers.push(`${label} % of total`);
    if (compare)
      headers.push(
        `${label} Previous`,
        `${label} Variance`,
        `${label} Variance %`,
      );
  }
  const figures = columns.map((column) => ({
    current: statementFigures(column.data, accounts),
    previous: column.previousData
      ? statementFigures(column.previousData, accounts)
      : undefined,
  }));
  return {
    headers,
    rows: rows.map((row) => {
      const cells = [row.label, row.code || ""];
      for (const column of figures) {
        const amount = column.current.values[row.id] || 0;
        cells.push(row.heading ? "" : csvMoney(amount));
        if (showPercent)
          cells.push(
            row.heading
              ? ""
              : reportPercent(
                  percentageOfTotal(amount, column.current.denominator),
                ),
          );
        if (compare) {
          const previous = column.previous?.values[row.id] || 0;
          const variance = column.previous
            ? reportVariance(amount, previous)
            : undefined;
          cells.push(
            row.heading || !column.previous ? "" : csvMoney(previous),
            row.heading || !variance ? "" : csvMoney(variance.amount),
            row.heading || !variance ? "" : reportPercent(variance.percent),
          );
        }
      }
      return cells;
    }),
  };
}
