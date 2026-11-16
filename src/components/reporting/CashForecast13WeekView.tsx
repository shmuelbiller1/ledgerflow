import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import {
  CASH_FORECAST_CSV_HEADERS, DEFAULT_FORECAST_WEEKS, cashForecast13Week, cashForecastCsvRows, recurringDirection,
  type CashForecastReport, type ForecastRecurringRule, type ForecastDocument,
} from '../../lib/cashForecast13Week';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import type { Bill, Invoice } from '../../types';
import { RowTable } from '../ui/RowTable';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const MAX_LINE_ROWS = 200;

function centsFromText(value: string): number | undefined {
  const cleaned = value.replace(/[^0-9.-]/g, '');
  if (!cleaned) return 0;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return undefined;
  return Math.round(amount * 100);
}

/**
 * A-186: the next 13 weeks of money already promised in the workspace — open invoices, open bills
 * and recurring rules — week by week. Read-only; nothing is posted and no rate is guessed.
 */
export default function CashForecast13WeekView() {
  const invoices = useLedgerStore(state => state.invoices);
  const bills = useLedgerStore(state => state.bills);
  const recurring = useLedgerStore(state => state.recurring);
  const accounts = useLedgerStore(state => state.accounts);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('invoices', 'bills', 'recurring');
  const [asOf, setAsOf] = useState(getLocalDateISO());
  const [openingCashText, setOpeningCashText] = useState('0');
  const homeCurrency = workspace?.currency || 'USD';

  const openingCashCents = centsFromText(openingCashText);
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(asOf);

  const report = useMemo(() => {
    if (!validDay || openingCashCents === undefined) return null;
    const inWorkspace = <T extends { workspaceId?: string }>(row: T) => !workspaceId || row.workspaceId === workspaceId;
    const accountsById = new Map(accounts.map(account => [account.id, account]));
    const rules: ForecastRecurringRule[] = recurring.filter(inWorkspace).map(rule => ({
      id: rule.id,
      label: rule.description || rule.payee || 'Recurring entry',
      amountCents: rule.amountCents,
      frequency: rule.frequency,
      nextOccurrence: rule.nextOccurrence,
      isActive: rule.isActive,
      status: rule.status,
      ...{ direction: recurringDirection(rule, accountsById) },
    }));
    const toDocument = (row: Invoice | Bill, label: string): ForecastDocument => ({
      id: row.id,
      label: row.number || label,
      expectedDate: (row as { dueDate?: string }).dueDate || row.date,
      amountCents: row.amountCents,
      paidCents: row.amountPaidCents,
      currency: row.currency,
      status: row.status,
    });
    return cashForecast13Week({
      asOf,
      homeCurrency,
      openingCashCents,
      weeks: DEFAULT_FORECAST_WEEKS,
      invoices: invoices.filter(inWorkspace).map(invoice => toDocument(invoice, invoice.customerName || 'Invoice')),
      bills: bills.filter(inWorkspace).map(bill => toDocument(bill, bill.vendorName || 'Bill')),
      recurring: rules,
    });
  }, [invoices, bills, recurring, accounts, workspaceId, homeCurrency, asOf, openingCashCents, validDay]);

  const partial = Boolean(truncated.invoices || failed.invoices || truncated.bills || failed.bills || truncated.recurring || failed.recurring);
  return <CashForecast13WeekPanel
    report={report}
    currency={homeCurrency}
    asOf={asOf}
    onAsOfChange={setAsOf}
    openingCashText={openingCashText}
    onOpeningCashChange={setOpeningCashText}
    loading={loading}
    partial={partial}
    validDay={validDay}
    openingCashValid={openingCashCents !== undefined}
  />;
}

export function CashForecast13WeekPanel({ report, currency = 'USD', asOf, onAsOfChange, openingCashText = '0', onOpeningCashChange, loading = false, partial = false, validDay = true, openingCashValid = true }: {
  report: CashForecastReport | null;
  currency?: string;
  asOf: string;
  onAsOfChange: (value: string) => void;
  openingCashText?: string;
  onOpeningCashChange: (value: string) => void;
  loading?: boolean;
  partial?: boolean;
  validDay?: boolean;
  openingCashValid?: boolean;
}) {
  const lines = report ? report.weeks.flatMap(week => week.lines.map(line => ({ ...line, week: week.index }))) : [];
  return <section aria-label="13-week cash forecast" className="p-4 space-y-4 min-w-0">
    <h2>13-week cash forecast</h2>
    <p className="text-sm text-[var(--muted)]">
      Open invoices on their own due dates, open bills on theirs and the recurring rules you already recorded, added up week by
      week from the assessment day. This is arithmetic on what is recorded, not a prediction: it assumes every customer pays on
      the due date, no new work is won, no payment history or seasonality is modelled, and a document in another currency is
      counted instead of converted at an invented rate. Nothing here is posted and no bill or invoice is changed.
    </p>

    {loading && <p role="status">Loading invoices, bills and recurring rules…</p>}
    {partial && <p role="alert">A loaded list is capped or failed. The weeks and the export are provisional until every list is complete.</p>}
    {!validDay && <p role="alert">Choose a real assessment day (YYYY-MM-DD) to see the forecast.</p>}
    {!openingCashValid && <p role="alert">The starting cash amount is not a number; type an amount like 12500.00.</p>}

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Assessment day
        <input type="date" aria-label="Assessment day" className={field} value={asOf} onChange={event => onAsOfChange(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">Cash and bank today ({currency})
        <input aria-label={`Cash and bank today (${currency})`} className={field} inputMode="decimal" value={openingCashText} onChange={event => onOpeningCashChange(event.target.value)} placeholder="0.00" />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!report || loading || partial}
        onClick={() => report && downloadCsv('cash-forecast-13-week', CASH_FORECAST_CSV_HEADERS, cashForecastCsvRows(report))}>Export CSV</button>
    </div>

    {report && <>
      <p className="text-sm">
        <b>Expected in:</b> {formatCurrency(report.totalInflowCents, currency)} · <b>Expected out:</b> {formatCurrency(report.totalOutflowCents, currency)} ·
        {' '}<b>Net:</b> {formatCurrency(report.totalInflowCents - report.totalOutflowCents, currency)}
      </p>
      {(report.overdueInflowCents > 0 || report.overdueOutflowCents > 0) && <p role="alert">
        Already past its due date on the assessment day and placed in week 1: {formatCurrency(report.overdueInflowCents, currency)} to come in,
        {' '}{formatCurrency(report.overdueOutflowCents, currency)} to go out.
      </p>}
      {(report.skippedOtherCurrency > 0 || report.undated > 0 || report.beyondHorizonCents.documents > 0 || report.unclassifiedRecurring > 0 || report.inactiveRecurring > 0) && <p className="text-sm text-[var(--muted)]">
        Not in the weeks: {report.skippedOtherCurrency} document(s) in another currency (never converted), {report.undated} without a
        readable date, {report.beyondHorizonCents.documents} after the forecast ends
        {report.beyondHorizonCents.documents > 0 ? ` (${formatCurrency(report.beyondHorizonCents.inflowCents, currency)} in / ${formatCurrency(report.beyondHorizonCents.outflowCents, currency)} out)` : ''}
        {', '}{report.unclassifiedRecurring} recurring rule(s) whose accounts do not say whether money comes in or goes out,
        and {report.inactiveRecurring} paused or finished rule(s).
      </p>}

      <ReportTableScroll>
        <table className="w-full text-sm">
          <caption className="text-left font-semibold text-[var(--text)] pb-1">Thirteen weeks from {asOf}: expected money in, expected money out and the projected balance</caption>
          <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
            {['Week', 'Start', 'End', 'Expected in', 'Expected out', 'Net', 'Projected balance'].map(head => <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}
          </tr></thead>
          <tbody>
            {report.weeks.map(week => <tr key={week.startDate} className="border-b border-[var(--line)]/50">
              <th scope="row" className="text-left font-normal py-1 px-2">Week {week.index}</th>
              <td className="py-1 px-2 tabular-nums">{week.startDate}</td>
              <td className="py-1 px-2 tabular-nums">{week.endDate}</td>
              <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(week.inflowCents, currency)}</td>
              <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(week.outflowCents, currency)}</td>
              <td className="py-1 px-2 tabular-nums whitespace-nowrap">{formatCurrency(week.netCents, currency)}</td>
              <td className={`py-1 px-2 tabular-nums whitespace-nowrap ${week.closingCents < 0 ? 'text-rose-600 font-semibold' : ''}`}>{formatCurrency(week.closingCents, currency)}</td>
            </tr>)}
          </tbody>
        </table>
      </ReportTableScroll>

      <h3 className="font-semibold text-sm">What is dated in the next 13 weeks</h3>
      <ReportTableScroll>
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>Each dated invoice, bill and recurring occurrence in the forecast</>)}
          rows={lines.slice(0, MAX_LINE_ROWS)}
          rowKey={line => `${line.kind}-${line.id}`}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          columns={[
            { header: "Date", className: "text-left font-normal py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (line) => (<>{line.date}{line.overdue ? ' (past due)' : ''}</>) },
            { header: "Week", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (line) => line.week },
            { header: "Direction", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (line) => line.kind === 'bill' ? 'Out' : 'In' },
            { header: "Document", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (line) => <bdi>{line.label}</bdi> },
            { header: "Amount", className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (line) => formatCurrency(line.cents, currency) },
          ]}
        />
        {lines.length > MAX_LINE_ROWS && <p className="text-sm text-[var(--muted)]">Showing the first {MAX_LINE_ROWS} of {lines.length} dated lines; the weekly totals and the CSV include all of them.</p>}
        {!lines.length && <p className="text-sm text-[var(--muted)]">Nothing dated in the next 13 weeks: no open invoice, open bill or active recurring rule falls inside it.</p>}
      </ReportTableScroll>
    </>}
  </section>;
}
