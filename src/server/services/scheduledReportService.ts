import crypto from 'crypto';
import type { Firestore } from '../db/firestore';
import { computeBalanceSheet, computeProfitAndLoss } from '../reports/computeReports';
import { AGING_BUCKETS, computePartyAging } from '../../lib/aging';
import { formatMoney as formatCurrency, type MoneyDisplaySettings } from '../../lib/moneyFormat';
import { addToDateISO, formatTzDate } from '../../lib/calendarDate';
import {
  agingTable, balanceSheetTable, lastFinishedPeriod, profitAndLossTable, reportCsv, reportEmailHtml,
  scheduleProblem, SCHEDULED_REPORTS, type ReportPeriod, type ReportTable, type ScheduledReport,
} from '../../lib/scheduledReports';
import type { ChartAccount, Customer, Invoice, Transaction } from '../../types';
import { isMailConfigured, sendMail } from './mailer';
import { logger } from '../utils/logger';

/**
 * Scheduled reports (K-28): the daily job emails each schedule's last finished week or month once;
 * "Send now" sends it straight away.
 * AUD-04: each period's sending is a delivery record (jobRuns/report_<workspace>_<schedule>_<period>) that a run
 * claims in a transaction before sending, with a 15-minute lease, so two runs at once never both send it. Each
 * address is recorded as delivered or failed; a failed address is tried again by a later run (after 1, 4, then 24
 * hours; given up after 4 attempts, logged), and an address already delivered is never sent again. A run that
 * stopped halfway (a crash) leaves the lease to run out; the next run sends only to the addresses not yet
 * delivered, with the provider's idempotency key so a send the provider had already accepted is not repeated.
 * The workspace's marker (scheduledReportsSent) is written once the period is finished.
 */
export class ScheduledReportError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function workspaceRows<T>(db: Firestore, collection: string, workspaceId: string, before?: string): Promise<T[]> {
  let q = db.collection(collection).where('workspaceId', '==', workspaceId);
  if (before) q = q.where('date', '<', before);
  return (await q.get()).docs.map(d => ({ ...(d.data() as T), id: d.id }));
}

export async function buildReport(db: Firestore, workspaceId: string, schedule: Pick<ScheduledReport, 'report'>, period: ReportPeriod): Promise<ReportTable> {
  const dayAfter = addToDateISO(period.endDate, { days: 1 });
  if (schedule.report === 'receivables-aging') {
    const [customers, invoices] = await Promise.all([
      workspaceRows<Customer>(db, 'customers', workspaceId),
      workspaceRows<Invoice>(db, 'invoices', workspaceId, dayAfter),
    ]);
    return agingTable(computePartyAging(customers, invoices, 'customer', period.endDate), [...AGING_BUCKETS], period);
  }
  const [accounts, entries] = await Promise.all([
    workspaceRows<ChartAccount>(db, 'chartAccounts', workspaceId),
    workspaceRows<Transaction>(db, 'transactions', workspaceId, dayAfter),
  ]);
  if (schedule.report === 'profit-and-loss') return profitAndLossTable(computeProfitAndLoss(accounts, entries, period.startDate, period.endDate), period);
  return balanceSheetTable(computeBalanceSheet(accounts, entries, period.endDate), accounts, period);
}

export interface ReportSendResult { sent: number; failed: string[]; delivered: string[]; errors: Record<string, string> }

export async function sendReport(db: Firestore, workspace: { id: string; name?: string; currency?: string; moneyDisplay?: MoneyDisplaySettings }, schedule: ScheduledReport, period: ReportPeriod,
  options: { skip?: Set<string>; idempotencyPrefix?: string } = {}): Promise<ReportSendResult> {
  const table = await buildReport(db, workspace.id, schedule, period);
  const currency = workspace.currency || 'USD';
  const moneyDisplay = workspace.moneyDisplay;
  const html = reportEmailHtml(table, { workspaceName: workspace.name || 'Your books', currency, format: cents => formatCurrency(cents, currency, moneyDisplay) });
  const attachment = { filename: `${schedule.report}-${period.endDate}.csv`, content: Buffer.from(`\uFEFF${reportCsv(table)}`, 'utf8'), contentType: 'text/csv' };
  const delivered: string[] = [];
  const failed: string[] = [];
  const errors: Record<string, string> = {};
  for (const to of schedule.recipients) {
    if (options.skip?.has(to)) continue;
    try {
      await sendMail({ to, subject: `${table.title} · ${workspace.name || 'LedgerFlow'}`, html, attachments: [attachment], ...(options.idempotencyPrefix ? { idempotencyKey: `${options.idempotencyPrefix}_${to}` } : {}) });
      delivered.push(to);
    } catch (err) {
      failed.push(to);
      errors[to] = err instanceof Error ? err.message : String(err);
      logger.warn('scheduled report not sent', { workspaceId: workspace.id, scheduleId: schedule.id, error: errors[to] });
    }
  }
  return { sent: delivered.length, failed, delivered, errors };
}

/** How long a claimed sending is left to the run that claimed it before another run may take it over. */
export const DELIVERY_LEASE_MS = 15 * 60 * 1000;
/** Hours to wait before trying failed addresses again, by attempt; after the last, the period is given up. */
export const RETRY_AFTER_HOURS = [1, 4, 24];
const MAX_ATTEMPTS = RETRY_AFTER_HOURS.length + 1;

interface DeliveryRecord {
  kind: 'scheduled-report'; workspaceId: string; scheduleId: string; periodKey: string;
  status: 'sending' | 'sent' | 'failed' | 'gave-up';
  claimId: string; claimedAt: string; attempts: number; nextAttemptAt?: string; finishedAt?: string;
  recipients: Record<string, { status: 'delivered' | 'failed'; at: string; error?: string }>;
}

const deliveryRef = (db: Firestore, workspaceId: string, scheduleId: string, periodKey: string) =>
  db.collection('jobRuns').doc(`report_${workspaceId}_${scheduleId}_${periodKey}`);

/** Claim one period's sending, or null when it is sent, given up, being sent by another run, or not due again yet. */
export async function claimDelivery(db: Firestore, workspaceId: string, scheduleId: string, periodKey: string, now: Date): Promise<{ claimId: string; attempt: number; delivered: Set<string> } | null> {
  const ref = deliveryRef(db, workspaceId, scheduleId, periodKey);
  return db.runTransaction(async t => {
    const ws = (await t.get(db.collection('workspaces').doc(workspaceId))).data() as { scheduledReportsSent?: Record<string, string> } | undefined;
    if (!ws || ws.scheduledReportsSent?.[scheduleId] === periodKey) return null;
    const prev = (await t.get(ref)).data() as DeliveryRecord | undefined;
    if (prev?.status === 'sent' || prev?.status === 'gave-up') return null;
    if (prev?.status === 'sending' && Date.parse(prev.claimedAt) + DELIVERY_LEASE_MS > now.getTime()) return null;
    if (prev?.status === 'failed' && prev.nextAttemptAt && Date.parse(prev.nextAttemptAt) > now.getTime()) return null;
    const claimId = crypto.randomUUID();
    const attempt = (prev?.attempts || 0) + 1;
    t.set(ref, { kind: 'scheduled-report', workspaceId, scheduleId, periodKey, recipients: prev?.recipients || {}, status: 'sending', claimId, claimedAt: now.toISOString(), attempts: attempt });
    return { claimId, attempt, delivered: new Set(Object.entries(prev?.recipients || {}).filter(([, r]) => r.status === 'delivered').map(([to]) => to)) };
  });
}

/** Record what this run delivered; the period is finished (and the workspace marked) when every address has it. */
export async function finishDelivery(db: Firestore, input: { workspaceId: string; scheduleId: string; periodKey: string; claimId: string; attempt: number; recipients: string[]; result: Pick<ReportSendResult, 'delivered' | 'errors'>; now: Date }) {
  const ref = deliveryRef(db, input.workspaceId, input.scheduleId, input.periodKey);
  return db.runTransaction(async t => {
    const prev = (await t.get(ref)).data() as DeliveryRecord | undefined;
    // the lease ran out and another run took the sending over: it records its own outcome
    if (!prev || prev.claimId !== input.claimId) return { status: 'taken-over' as const };
    const at = input.now.toISOString();
    const recipients = { ...prev.recipients };
    for (const to of input.result.delivered) recipients[to] = { status: 'delivered', at };
    for (const [to, error] of Object.entries(input.result.errors)) recipients[to] = { status: 'failed', at, error: error.slice(0, 500) };
    const done = input.recipients.every(to => recipients[to]?.status === 'delivered');
    const gaveUp = !done && input.attempt >= MAX_ATTEMPTS;
    const status: DeliveryRecord['status'] = done ? 'sent' : gaveUp ? 'gave-up' : 'failed';
    t.set(ref, {
      ...prev, recipients, status,
      ...(done || gaveUp ? { finishedAt: at } : { nextAttemptAt: new Date(input.now.getTime() + RETRY_AFTER_HOURS[input.attempt - 1] * 3_600_000).toISOString() }),
    });
    if (done || gaveUp) t.update(db.collection('workspaces').doc(input.workspaceId), { [`scheduledReportsSent.${input.scheduleId}`]: input.periodKey });
    return { status };
  });
}

const today = (ws: Record<string, unknown>, now: Date) => formatTzDate(now, typeof ws.timezone === 'string' ? ws.timezone : 'UTC');

/** "Send now" (owners and accountants): the last finished period, without changing what the schedule has sent. */
export async function sendScheduleNow(db: Firestore, input: { workspaceId: string; scheduleId: string; now?: Date }) {
  if (!isMailConfigured()) throw new ScheduledReportError(503, 'Email sending is not set up yet, so nothing can be sent');
  const snap = await db.collection('workspaces').doc(input.workspaceId).get();
  const ws = snap.data() as (Record<string, unknown> & { scheduledReports?: ScheduledReport[] }) | undefined;
  const schedule = ws?.scheduledReports?.find(s => s.id === input.scheduleId);
  if (!ws || !schedule) throw new ScheduledReportError(404, 'That schedule is not in this workspace');
  const problem = scheduleProblem(schedule);
  if (problem) throw new ScheduledReportError(400, problem);
  const period = lastFinishedPeriod(schedule.frequency, today(ws, input.now || new Date()));
  return { period, ...(await sendReport(db, { id: input.workspaceId, name: ws.name as string, currency: ws.currency as string }, schedule, period)) };
}

/** The daily run: every workspace's schedules whose last finished period has not been delivered to every address yet. */
export async function runScheduledReports(db: Firestore, now = new Date()) {
  let reports = 0;
  let emails = 0;
  if (!isMailConfigured()) return { reports, emails };
  const workspaces = await db.collection('workspaces').get();
  for (const wsDoc of workspaces.docs) {
    const done = await runWorkspaceSchedules(db, wsDoc.id, wsDoc.data() as Record<string, unknown>, now);
    reports += done.reports;
    emails += done.emails;
  }
  return { reports, emails };
}

/** One workspace's part of the daily run. */
export async function runWorkspaceSchedules(db: Firestore, workspaceId: string, ws: Record<string, unknown> & { scheduledReports?: ScheduledReport[]; scheduledReportsSent?: Record<string, string> }, now = new Date()) {
  let reports = 0;
  let emails = 0;
  const schedules = Array.isArray(ws.scheduledReports) ? ws.scheduledReports : [];
  for (const schedule of schedules) {
    if (!schedule?.id || scheduleProblem(schedule)) continue;
    const period = lastFinishedPeriod(schedule.frequency, today(ws, now));
    if (ws.scheduledReportsSent?.[schedule.id] === period.key) continue;
    const claim = await claimDelivery(db, workspaceId, schedule.id, period.key, now);
    if (!claim) continue;
    let result: Pick<ReportSendResult, 'delivered' | 'errors'>;
    try {
      result = await sendReport(db, { id: workspaceId, name: ws.name as string, currency: ws.currency as string }, schedule, period,
        { skip: claim.delivered, idempotencyPrefix: `report_${workspaceId}_${schedule.id}_${period.key}` });
    } catch (err) {
      // the report itself could not be made: every address not yet delivered counts as failed, tried again later
      const error = err instanceof Error ? err.message : String(err);
      result = { delivered: [], errors: Object.fromEntries(schedule.recipients.filter(to => !claim.delivered.has(to)).map(to => [to, error])) };
      logger.warn('scheduled report failed', { workspaceId, scheduleId: schedule.id, report: SCHEDULED_REPORTS[schedule.report], error });
    }
    const outcome = await finishDelivery(db, { workspaceId, scheduleId: schedule.id, periodKey: period.key, claimId: claim.claimId, attempt: claim.attempt, recipients: schedule.recipients, result, now });
    if (outcome.status === 'gave-up') logger.error('scheduled report given up', { workspaceId, scheduleId: schedule.id, period: period.key, failed: Object.keys(result.errors) });
    reports++;
    emails += result.delivered.length;
  }
  return { reports, emails };
}

export async function runDailyScheduledReports() {
  const { getDb } = await import('../db/firestore');
  return runScheduledReports(getDb());
}
