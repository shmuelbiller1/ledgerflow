/**
 * R-09 close comparison (AI #3, A-1): the month being closed beside the month before it and the
 * same month last year. Read-only — the figures come from `buildCloseComparison`
 * (src/lib/closeComparison.ts), which calls the same statement functions the reports use.
 */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatCurrency } from '../../lib/utils';
import { reportPercent } from '../../lib/reportColumns';
import {
  CLOSE_COMPARISON_PERCENT,
  CLOSE_COMPARISON_THRESHOLD_CENTS,
  buildCloseComparison,
  thresholdFromInput,
} from '../../lib/closeComparison';
import type { CloseComparisonResult, CloseComparisonRow, CloseComparisonStatement } from '../../lib/closeComparison';

function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);
  return new Date(year, (index || 1) - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

/** "+$250.00" / "−$250.00" / "$0.00" — the direction is in the text, not only in the colour. */
function signedMoney(cents: number, currency?: string): string {
  const amount = formatCurrency(Math.abs(cents || 0), currency);
  if (!cents) return amount;
  return `${cents > 0 ? '+' : '\u2212'}${amount}`;
}

function changeText(change: number, percent: number | null, currency?: string, comparable = true): string {
  if (!comparable) return 'Not comparable';
  if (!change) return 'No change';
  return percent === null ? `${signedMoney(change, currency)} from zero` : `${signedMoney(change, currency)} (${reportPercent(percent)})`;
}

function ComparisonTable({
  statement,
  currency,
  result,
}: {
  statement: CloseComparisonStatement;
  currency?: string;
  result: CloseComparisonResult;
}) {
  const { periods } = result;
  return (
    // a table that scrolls sideways can be reached and scrolled with the keyboard
    <div className="overflow-x-auto rounded-xl border border-[var(--line)]" tabIndex={0} role="region" aria-label={statement.title}>{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
      <table className="w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">
          {statement.title}: {monthLabel(periods.current.month)} beside {monthLabel(periods.previousMonth.month)} and{' '}
          {monthLabel(periods.previousYear.month)}
        </caption>
        <thead className="bg-[var(--ink)]">
          <tr>
            <th scope="col" className="p-3 text-left">Account</th>
            <th scope="col" className="p-3 text-right whitespace-nowrap">
              {monthLabel(periods.current.month)}
              <span className="block text-xs font-normal">{statement.id === 'bs' ? periods.current.endDate : 'This month'}</span>
              {statement.incomplete.current && <span data-testid={`close-comparison-incomplete-${statement.id}-current`} className="block text-xs font-normal text-[var(--neg)]">Incomplete: loaded entries only</span>}
            </th>
            <th scope="col" className="p-3 text-right whitespace-nowrap">
              Previous month
              <span className="block text-xs font-normal">{statement.id === 'bs' ? periods.previousMonth.endDate : monthLabel(periods.previousMonth.month)}</span>
              {statement.incomplete.previousMonth && <span data-testid={`close-comparison-incomplete-${statement.id}-previousMonth`} className="block text-xs font-normal text-[var(--neg)]">Incomplete: loaded entries only</span>}
            </th>
            <th scope="col" className="p-3 text-right whitespace-nowrap">Change</th>
            <th scope="col" className="p-3 text-right whitespace-nowrap">
              Same month last year
              <span className="block text-xs font-normal">{statement.id === 'bs' ? periods.previousYear.endDate : monthLabel(periods.previousYear.month)}</span>
              {statement.incomplete.previousYear && <span data-testid={`close-comparison-incomplete-${statement.id}-previousYear`} className="block text-xs font-normal text-[var(--neg)]">Incomplete: loaded entries only</span>}
            </th>
            <th scope="col" className="p-3 text-right whitespace-nowrap">Change</th>
          </tr>
        </thead>
        <tbody>
          {statement.rows.map(row => (
            <tr
              key={`${statement.id}:${row.id}`}
              className={row.kind === 'total' ? 'border-t border-[var(--line)] font-semibold bg-[var(--ink)]' : 'border-t border-[var(--line)]'}
            >
              <th scope="row" className="p-3 text-left">
                <span className="block">{row.label}</span>
                {row.code && <span className="block text-xs font-normal text-[var(--muted)]">{row.code}</span>}
                {(row.bigMove || row.bigMoveYear) && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/60 px-2 py-0.5 text-xs font-semibold text-amber-600">
                    <AlertTriangle className="w-3 h-3" aria-hidden="true" /> Big move
                  </span>
                )}
              </th>
              <td className="p-3 text-right whitespace-nowrap">{formatCurrency(row.current, currency)}</td>
              <td className="p-3 text-right whitespace-nowrap">{formatCurrency(row.previousMonth, currency)}</td>
              <td className="p-3 text-right whitespace-nowrap">{changeText(row.changePreviousMonth, row.percentPreviousMonth, currency, row.comparablePreviousMonth)}</td>
              <td className="p-3 text-right whitespace-nowrap">{formatCurrency(row.previousYear, currency)}</td>
              <td className="p-3 text-right whitespace-nowrap">{changeText(row.changePreviousYear, row.percentPreviousYear, currency, row.comparablePreviousYear)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BigMoveSummary({ bigMoves, currency }: { bigMoves: CloseComparisonRow[]; currency?: string }) {
  if (!bigMoves.length) return <p className="text-sm text-[var(--muted)]">No moves this big in either comparison.</p>;
  return (
    <div>
      <p className="text-sm text-[var(--text)]">
        {bigMoves.length} big move{bigMoves.length === 1 ? '' : 's'} to look at before closing:
      </p>
      <ul className="mt-1 list-disc pl-5 text-sm text-[var(--muted)]">
        {bigMoves.map(row => (
          <li key={`move:${row.id}`}>
            <span className="font-medium text-[var(--text)]">{row.label}</span>
            {' — '}
            {row.bigMove ? `vs previous month: ${changeText(row.changePreviousMonth, row.percentPreviousMonth, currency)}` : ''}
            {row.bigMove && row.bigMoveYear ? ' · ' : ''}
            {row.bigMoveYear ? `vs the same month last year: ${changeText(row.changePreviousYear, row.percentPreviousYear, currency)}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CloseComparisonPanel({ month, currency }: { month: string; currency?: string }) {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const serverOpening = useLedgerStore(s => s.serverOpening);
  const truncated = useLedgerStore(s => !!s.truncatedCollections?.transactions);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || undefined;
  const [thresholdInput, setThresholdInput] = useState(() => String(CLOSE_COMPARISON_THRESHOLD_CENTS / 100));
  const thresholdCents = thresholdFromInput(thresholdInput);
  const result = useMemo(() => buildCloseComparison({
    month,
    accounts: accounts || [],
    transactions: transactions || [],
    ...(thresholdCents !== null ? { thresholdCents } : {}),
    // L-123 step 3d: month ends on or after the oldest loaded day, and months after it, read the server's balances
    opening: serverOpening,
    workspaceId,
    capped: truncated,
  }), [month, accounts, transactions, thresholdCents, serverOpening, workspaceId, truncated]);

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-4" aria-labelledby="close-comparison">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 id="close-comparison" className="text-lg font-medium text-[var(--text)] flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[var(--brass)]" aria-hidden="true" /> Compare {monthLabel(result.month)}
          </h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            This month beside the month before it and the same month last year. A big move is at least
            {' '}{CLOSE_COMPARISON_PERCENT}% of the month compared with and at least the amount below.
          </p>
        </div>
        <div>
          <label htmlFor="close-comparison-threshold" className="block text-xs font-semibold text-[var(--muted)] mb-1">
            Flag moves of at least
          </label>
          <input
            id="close-comparison-threshold"
            value={thresholdInput}
            onChange={e => setThresholdInput(e.target.value)}
            inputMode="decimal"
            className="w-40 px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]"
            aria-describedby="close-comparison-threshold-hint"
          />
          <p id="close-comparison-threshold-hint" className={thresholdCents === null ? 'text-xs text-[var(--neg)] mt-1' : 'text-xs text-[var(--muted)] mt-1'}>
            {thresholdCents === null ? `Not an amount — using ${formatCurrency(CLOSE_COMPARISON_THRESHOLD_CENTS, currency)}.` : 'In the workspace currency.'}
          </p>
        </div>
      </div>

      {[result.profitAndLoss, result.balanceSheet].some(st => Object.values(st.incomplete).some(Boolean)) && (
        <p role="alert" data-testid="close-comparison-incomplete" className="text-sm text-[var(--neg)]">
          The loaded ledger history is incomplete. Columns marked &quot;Incomplete&quot; read only the loaded entries and may omit older ones, so changes against them are not compared or flagged.
        </p>
      )}
      <BigMoveSummary bigMoves={result.bigMoves} currency={currency} />

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--text)]">{result.profitAndLoss.title}</h3>
        <ComparisonTable statement={result.profitAndLoss} currency={currency} result={result} />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--text)]">{result.balanceSheet.title} (closing balances)</h3>
        <ComparisonTable statement={result.balanceSheet} currency={currency} result={result} />
      </div>
      <p className="text-xs text-[var(--muted)]">
        Accounts with no activity in these three periods are left out. Nothing here changes the books.
      </p>
    </section>
  );
}
