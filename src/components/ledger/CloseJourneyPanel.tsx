import React, { useMemo } from 'react';
import { ArrowRight, CheckCircle2, Circle, Eye, XCircle, AlertTriangle } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { closeJourney, type CloseJourneyStatus } from '../../lib/closeJourney';
import type { CloseItem } from '../../lib/closeChecklist';
import type { MonthCloseState } from '../../lib/periodLock';
import type { AppTab } from '../../types';
import { cn, formatCurrency } from '../../lib/utils';
import ReportTableScroll from '../reporting/ReportTableScroll';
import { RowTable } from '../ui/RowTable';

const STATUS: Record<CloseJourneyStatus, { label: string; tone: string; icon: React.ReactNode }> = {
  done: { label: 'Done', tone: 'text-[var(--pos)]', icon: <CheckCircle2 className="w-5 h-5 text-[var(--pos)]" aria-hidden="true" /> },
  attention: { label: 'Needs attention', tone: 'text-amber-700 dark:text-amber-400', icon: <AlertTriangle className="w-5 h-5 text-amber-500" aria-hidden="true" /> },
  blocker: { label: 'Blocks the close', tone: 'text-[var(--neg)]', icon: <XCircle className="w-5 h-5 text-[var(--neg)]" aria-hidden="true" /> },
  review: { label: 'For review', tone: 'text-[var(--muted)]', icon: <Eye className="w-5 h-5 text-[var(--muted)]" aria-hidden="true" /> },
  'not-applicable': { label: 'Does not apply', tone: 'text-[var(--muted)]', icon: <Circle className="w-5 h-5 text-[var(--muted)]" aria-hidden="true" /> },
};

/**
 * A-151 (P2-2): the month-end close journey, read-only, on Month-End Close. Each step names the
 * work, says what the recorded data shows and opens the screen that does it; the checklist above
 * remains the place where items are signed off and the month is closed.
 */
export default function CloseJourneyPanel({
  month, state, items, accounts, bankLines, invoices, bills, journalEntries, currency = 'USD',
}: {
  month: string;
  state: MonthCloseState;
  items: CloseItem[];
  accounts?: Parameters<typeof closeJourney>[0]['accounts'];
  bankLines?: Parameters<typeof closeJourney>[0]['bankLines'];
  invoices?: Parameters<typeof closeJourney>[0]['invoices'];
  bills?: Parameters<typeof closeJourney>[0]['bills'];
  journalEntries?: Parameters<typeof closeJourney>[0]['journalEntries'];
  currency?: string;
}) {
  const goToPage = useUIStore(s => s.goToPage);
  const journey = useMemo(() => closeJourney({
    month, state, items, accounts, bankLines, invoices, bills, journalEntries, currency,
  }), [month, state, items, accounts, bankLines, invoices, bills, journalEntries, currency]);

  return <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-4" aria-labelledby="close-journey">
    <div>
      <h2 id="close-journey" className="text-lg font-medium text-[var(--text)]">Close journey</h2>
      <p className="text-sm text-[var(--muted)] mt-1">
        The month’s path in order: reconcile each bank, account for every entry, review the open
        invoices and bills and the accruals, clear the drafts, check the trial balance, lock the
        month and take the report pack. Each step opens the screen that does the work; signing off
        and closing stay in the checklist above. Read-only: nothing here is signed, posted or closed.
      </p>
    </div>

    {journey.problems.map(problem => <p key={problem} role="alert" className="text-sm text-[var(--neg)]">{problem}</p>)}

    <p className="text-sm text-[var(--text)]">
      {journey.done} of {journey.steps.length} steps done
      {journey.blockers ? ` · ${journey.blockers} blocking` : ''}
      {journey.attention ? ` · ${journey.attention} needing attention` : ''}
      {journey.readyToClose
        ? ' · nothing in the recorded data blocks the close.'
        : journey.nextStep ? ` · next: ${journey.steps.find(s => s.id === journey.nextStep)?.title}.` : ''}
    </p>

    <ol className="space-y-3">
      {journey.steps.map((step, index) => {
        const status = STATUS[step.status];
        return <li key={step.id} className="rounded-xl border border-[var(--line)] p-3 space-y-2">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0">{status.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium text-sm text-[var(--text)]">{index + 1}. {step.title}</h3>
                <span className={cn('text-xs font-semibold', status.tone)}>{status.label}</span>
              </div>
              <p className="text-sm text-[var(--muted)] mt-0.5">{step.what}</p>
              <p className="text-sm text-[var(--text)] mt-1">{step.detail}</p>
              {step.figures.length > 0 && <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-1">
                {step.figures.map(figure => <li key={`${step.id}-${figure.label}`} className="tabular-nums">
                  <span className="text-[var(--muted)]">{figure.label}: </span>
                  <b>{figure.cents !== undefined ? formatCurrency(figure.cents, currency) : figure.count}</b>
                </li>)}
              </ul>}
              {step.banks.length > 0 && <ReportTableScroll>
                <RowTable
                  rowClassName="border-b border-[var(--line)]/50"
                  caption={(<>Each bank account for {month}</>)}
                  rows={step.banks}
                  rowKey={row => row.accountId || 'unassigned'}
                  captionClassName="text-left font-semibold text-[var(--text)] pb-1"
                  tableClassName="w-full text-sm mt-2"
                  headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
                  bodyClassName=""
                  columns={[
                    { header: "Account", className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => (<>{row.accountName}{row.unassigned ? ' (check them)' : ''}</>) },
                    { header: "Bank lines", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.lines },
                    { header: "Not matched", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.unmatched },
                  ]}
                />
              </ReportTableScroll>}
              <button type="button" onClick={() => goToPage({ tab: step.tab as AppTab, sub: step.screen })}
                className="mt-2 text-xs font-semibold text-[var(--brass)] hover:underline inline-flex items-center gap-1">
                Open {step.screenLabel} <ArrowRight className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          </div>
        </li>;
      })}
    </ol>
  </section>;
}
