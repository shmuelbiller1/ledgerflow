/**
 * The words and tones the two tax journeys (Israel's month, the US quarter) show for a step's
 * status. They live beside the views, not inside one, so both read the same table.
 */
export type JourneyStepStatus = 'done' | 'attention' | 'not-applicable';

/** The tone a step's status is written in. */
export const STEP_STATUS_TONE: Record<JourneyStepStatus, string> = {
  done: 'text-[var(--pos)]',
  attention: 'text-amber-700 dark:text-amber-400',
  'not-applicable': 'text-[var(--muted)]',
};

/** The words a step's status carries, in the period the journey covers. */
export function stepStatusLabel(period: 'month' | 'quarter', reportText: (key: string, fallback: string) => string): Record<JourneyStepStatus, string> {
  return {
    done: reportText('r.journey-done', 'Done from the recorded data'),
    attention: reportText('r.journey-attention', 'Needs attention'),
    'not-applicable': period === 'month'
      ? reportText('r.journey-na-month', 'Does not apply to this month')
      : reportText('r.journey-na-quarter', 'Does not apply to this quarter'),
  };
}

/** What a step has to show, whoever computed it: the shared steps list reads only this. */
export interface JourneyFigure {
  label: string;
  /** whole cents of the workspace currency */
  cents?: number;
  /** a count of documents or months — shown as a number, never as money */
  count?: number;
  note?: string;
}

export interface JourneyStepShape {
  id: string;
  title: string;
  /** plain words: the work itself */
  what: string;
  /** what the recorded data shows, in words */
  detail: string;
  status: JourneyStepStatus;
  figures: JourneyFigure[];
  screenLabel: string;
}
