/**
 * The daily run, in words (BB-06): which jobs it covers, what each one is for, and whether the last
 * run went through. Nothing here decides when anything runs — that is the installation's schedule
 * (src/server/jobs/jobRegistry.ts: `vercel.json`'s cron calls `/api/cron/daily`, a standalone server
 * runs the same list on its own timer) — this is the reading of it for the Settings → Schedule screen, so a person can see whether a reminder is late because the
 * job did not run rather than because nothing was due.
 *
 * It is deliberately a list of *what is promised*, kept next to the list of what runs:
 * `src/tests/job-schedule.test.ts` fails if a job is in the registry and not here, or here and not in
 * the registry, so the screen cannot quietly start describing a schedule that no longer exists.
 */
import { addDaysYMD } from './fiscalCalendar';
import { formatTzDate } from './calendarDate';

/** when the daily run is set for, in UTC — `vercel.json`'s cron, checked against this in a test */
export const DAILY_RUN_AT_UTC = { hour: 6, minute: 10 } as const;
const DUE_AT_UTC = `${String(DAILY_RUN_AT_UTC.hour).padStart(2, '0')}:${String(DAILY_RUN_AT_UTC.minute).padStart(2, '0')}`;
/** a run older than this is late: once a day, with room for a day of outages */
export const DAILY_LATE_HOURS = 36;

export interface DailyJobDescriptor {
  id: string;
  /** what to call it on the screen */
  name: string;
  /** what it does, in the words a person reads */
  what: string;
}

export const DAILY_JOBS: DailyJobDescriptor[] = [
  { id: 'maintenance', name: 'Keeping the data from growing', what: 'Job logs older than 90 days are cleared, advice lists kept to their cap, and a workspace whose 30 days of waiting are up is deleted for good.' },
  { id: 'recurring', name: 'Recurring invoices and bills', what: 'A draft copy is made for every schedule due today — one per date, never a second time — and it is posted only when someone checks it.' },
  { id: 'errorDigest', name: 'What went wrong', what: 'One email to the team with the errors of the last day, grouped, instead of one per fault.' },
  { id: 'notifications', name: 'Team notices and overdue letters', what: 'Customers are told about invoices that have just gone past their due date, and notices the team has read are cleared away.' },
  { id: 'reminders', name: 'Invoice reminders', what: 'The reminders each workspace asked for, at the spacing it set, to the address the customer prefers (Y-27). An invoice waiting on an approval is left out and resumes when it is signed.' },
  { id: 'statements', name: 'Monthly statements', what: 'Once a month, every customer with something open who is set to receive one.' },
  { id: 'scheduledReports', name: 'Scheduled reports', what: 'Each report set in Settings → Scheduled reports, once per finished week or month, to its addresses.' },
  { id: 'ledgerHealth', name: 'Ledger health check', what: 'The Data Health checks on every workspace whose books changed; owners and accountants are told about serious problems that are new since the night before.' },
  { id: 'bookAlerts', name: 'Alerts about the books', what: 'From the chosen day, a reminder to close last month; a budget overspent; cash below the amount set in Settings → Alerts. Each told once.' },
  { id: 'assetReminders', name: 'Warranty and insurance reminders', what: 'Fixed assets whose warranty ends or whose insurance renews within 30 days: the people who keep the books are told once for each date.' },
  { id: 'watches', name: 'Watched records', what: 'Each person watching an invoice, bill, entry, account or item is told once about each change since they were last told, and when it was deleted.' },
  { id: 'notificationDigest', name: 'Daily summary of notices by email', what: 'People who chose one email a day get the notices they have not read since the last one (bell → gear).' },
  { id: 'retention', name: 'What you asked to keep for less time', what: 'Email receipts, error logs and other records past the retention period each workspace sets are pruned.' },
];

/** The row the daily run writes for itself (jobRuns/daily_latest). */
export interface DailyJobRunRecord {
  startedAt?: string;
  finishedAt?: string;
  status?: string;
  failedJobs?: string[];
  /** what each job answered: 'ok', or 'failed: why'; missing on runs from before this was recorded */
  results?: Record<string, string>;
}

export type JobOutcome = 'ok' | 'failed' | 'unknown';
export type ScheduleState = 'ok' | 'late' | 'failed' | 'never' | 'not_configured';

export interface ScheduledJobView extends DailyJobDescriptor {
  outcome: JobOutcome;
  /** what the run answered for this job, when it answered */
  detail: string;
}

export interface ScheduleView {
  state: ScheduleState;
  /** the line to lead with */
  headline: string;
  /** one more line under it: when it ran, and what that means */
  detail: string;
  ranAt: string | null;
  hoursSince: number | null;
  nextRunAt: string;
  lateAfterHours: number;
  jobs: ScheduledJobView[];
}

/** the next run after `now`: today's scheduled minute if it has not come, otherwise tomorrow's */
export function nextDailyRunAt(now: Date): string {
  const today = formatTzDate(now, 'UTC');
  const at = (day: string) => new Date(`${day}T${DUE_AT_UTC}:00Z`);
  const dueToday = at(today);
  return (dueToday.getTime() > now.getTime() ? dueToday : at(addDaysYMD(today, 1))).toISOString();
}

const hoursBefore = (from: string, now: Date) => Math.floor((now.getTime() - Date.parse(from)) / 3_600_000);
const agoWords = (hours: number) => {
  if (hours < 1) return 'in the last hour';
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

/**
 * The screen's whole answer. A run that did not record what each job did is `unknown` rather than ok:
 * the older rows only kept the failures, and saying nothing went wrong because nothing was *said* to
 * have gone wrong is the kind of reassurance this screen exists to avoid.
 */
export function describeSchedule(input: { run?: DailyJobRunRecord | null; cronConfigured: boolean; now: Date }): ScheduleView {
  const nextRunAt = nextDailyRunAt(input.now);
  const run = input.run;
  const jobs = (job: DailyJobDescriptor): ScheduledJobView => {
    const answer = run?.results?.[job.id];
    if (!run) return { ...job, outcome: 'unknown', detail: 'No run recorded yet.' };
    if (answer === 'ok') return { ...job, outcome: 'ok', detail: '' };
    if (answer && answer.startsWith('failed')) return { ...job, outcome: 'failed', detail: answer.replace(/^failed:\s*/, '') };
    const failed = Array.isArray(run.failedJobs) && run.failedJobs.includes(job.id);
    if (failed) return { ...job, outcome: 'failed', detail: 'The run said it went wrong, without saying how.' };
    return { ...job, outcome: 'unknown', detail: 'This run did not say what it did.' };
  };

  const view = (state: ScheduleState, headline: string, detail: string, ranAt: string | null, hoursSince: number | null): ScheduleView =>
    ({ state, headline, detail, ranAt, hoursSince, nextRunAt, lateAfterHours: DAILY_LATE_HOURS, jobs: DAILY_JOBS.map(jobs) });

  const dueAt = `${DUE_AT_UTC} UTC`;
  if (!input.cronConfigured) {
    return view('not_configured', 'Nothing runs on its own yet.',
      'The daily run needs the installation to be given its cron secret (CRON_SECRET). Until then, recurring drafts, reminders, statements and clean-up wait for someone to do them by hand.',
      null, null);
  }
  if (!run?.finishedAt) {
    return view('never', 'No run has been recorded yet.', `The first one is due at ${dueAt}.`, null, null);
  }
  const hours = hoursBefore(run.finishedAt, input.now);
  const ran = `Last ran ${agoWords(hours)} (${formatTzDate(new Date(run.finishedAt), 'UTC')} at ${run.finishedAt.slice(11, 16)}).`;
  if (run.status === 'failed') {
    const names = (run.failedJobs || []).map(id => DAILY_JOBS.find(j => j.id === id)?.name || id);
    return view('failed', names.length ? `The last run had problems: ${names.join(', ')}.` : 'The last run said something went wrong.', ran, run.finishedAt, hours);
  }
  if (hours > DAILY_LATE_HOURS) {
    // a run that reported no problems and then was never heard of again: the schedule stopped, the jobs did not fail
    const stopped = (run.failedJobs || []).length === 0 ? ' The last one reported no problems, so it is the schedule that stopped, not a job.' : '';
    return view('late', `The daily run did not happen when it was due (every day at ${dueAt}).${stopped}`, ran, run.finishedAt, hours);
  }
  return view('ok', 'The daily run is doing its work.', ran, run.finishedAt, hours);
}
