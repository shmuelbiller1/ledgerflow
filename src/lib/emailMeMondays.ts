/**
 * EU-F3: "Email me this every Monday" on a report. It adds (or finds) a weekly schedule of that report to this
 * person, sent on Monday for the week before — the same scheduled reports Settings → Scheduled reports keeps
 * (src/lib/scheduledReports.ts), so the daily job sends it and Settings can change or remove it.
 */
import { MAX_SCHEDULES, scheduleProblem, type ScheduledReport, type ScheduledReportKind } from './scheduledReports';

/** The report tabs that can be emailed, and the scheduled report each one is. */
export const EMAILABLE_REPORTS: Readonly<Record<string, ScheduledReportKind>> = {
  pnl: 'profit-and-loss',
  'balance-sheet': 'balance-sheet',
  'ar-aging': 'receivables-aging',
};

/** A Monday schedule of this report that already reaches this address, if any. */
export function mondayScheduleFor(schedules: readonly ScheduledReport[], kind: ScheduledReportKind, email: string): ScheduledReport | undefined {
  const me = email.trim().toLowerCase();
  return schedules.find(s => s.report === kind && s.frequency === 'weekly' && (s.sendDay ?? 1) === 1 && s.recipients.some(r => r.toLowerCase() === me));
}

/** The schedules with a Monday one for this report and address added, or why not. */
export function addMondayEmail(schedules: readonly ScheduledReport[], kind: ScheduledReportKind, email: string, id: string): { next: ScheduledReport[] } | { problem: string } {
  if (mondayScheduleFor(schedules, kind, email)) return { problem: 'Already emailed to you every Monday' };
  if (schedules.length >= MAX_SCHEDULES) return { problem: `At most ${MAX_SCHEDULES} scheduled reports — remove one in Settings → Scheduled reports` };
  const schedule: ScheduledReport = { id, report: kind, frequency: 'weekly', recipients: [email.trim()] };
  const problem = scheduleProblem(schedule);
  return problem ? { problem } : { next: [...schedules, schedule] };
}
