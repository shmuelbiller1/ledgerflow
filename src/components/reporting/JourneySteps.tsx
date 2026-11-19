/**
 * The two tax journeys (Israel's month, the US quarter) are one screen with a different calendar:
 * the notices, the numbered steps with their figures, and the status words beside them. The period
 * differs (a month, a quarter) and so do the tables a step carries, so those are handed in. The
 * status words and the shape a step has to show live in journeyStatus.ts.
 */
import React from 'react';
import { STEP_STATUS_TONE, type JourneyStepShape, type JourneyStepStatus } from './journeyStatus';
import { useReportText } from './useReportText';

/**
 * Why a journey is not simply what the data says: a load failed, a list was capped, a step found a
 * problem. A failed or partial load makes the totals below provisional, so it is said plainly.
 */
export function JourneyNotices({ problem, loading, loadingText, partial, problems }: {
  problem?: string | null;
  loading?: boolean;
  loadingText: string;
  partial?: boolean;
  problems?: string[];
}) {
  const reportText = useReportText();
  return <>
    {problem && <p role="alert">{problem}</p>}
    {loading && <p role="status">{loadingText}</p>}
    {partial && <p role="alert">{reportText('r.a-loaded-list-is-capped-or-failed-so-the-totals', 'A loaded list is capped or failed, so the totals below are provisional until it is complete.')}</p>}
    {(problems || []).map(item => <p key={item} role="alert">{item}</p>)}
  </>;
}

/**
 * The steps, numbered, each with its status, what it is for, what the data shows, its figures, and
 * the action that takes the reader to the screen that does the work.
 */
export function JourneySteps<S extends JourneyStepShape>({ steps, currency, formatCurrency, statusLabel, openScreen, afterFigures }: {
  steps: S[];
  currency: string;
  formatCurrency: (cents: number, currency: string) => string;
  statusLabel: Record<JourneyStepStatus, string>;
  /** the per-step action: the button to its screen, or a note where the step is shown below */
  openScreen(step: S): React.ReactNode;
  /** tables a step carries under its figures */
  afterFigures?(step: S): React.ReactNode;
}) {
  return <ol className="space-y-3">
    {steps.map((step, index) => <li key={step.id} className="rounded border border-[var(--line)] p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-sm">{index + 1}. {step.title}</h3>
        <span className={`text-sm font-medium ${STEP_STATUS_TONE[step.status]}`}>{statusLabel[step.status]}</span>
      </div>
      <p className="text-sm">{step.what}</p>
      <p className="text-sm text-[var(--muted)]">{step.detail}</p>
      {step.figures.length > 0 && <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {step.figures.map(figure => <li key={`${step.id}-${figure.label}`} className="tabular-nums">
          <span className="text-[var(--muted)]">{figure.label}: </span>
          <b>{figure.cents !== undefined ? formatCurrency(figure.cents, currency) : figure.count}</b>
          {figure.note ? <span className="text-[var(--muted)]"> ({figure.note})</span> : null}
        </li>)}
      </ul>}
      {afterFigures?.(step)}
      {openScreen(step)}
    </li>)}
  </ol>;
}
