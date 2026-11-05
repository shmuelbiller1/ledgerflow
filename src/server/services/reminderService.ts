/**
 * Daily payment reminders (BE-01, K-26): for every workspace that turned them on (Settings →
 * Emails & Reminders), each open overdue invoice gets the next reminder it is due for, by the
 * workspace's own date. Customers marked "no automatic reminders" are skipped. The email itself,
 * the send log and the per-invoice counters are documentEmailService.emailInvoice's job.
 *
 * A customer who asked for paper instead of email (Y-27: Print or Post) is not emailed either —
 * nobody is emailed behind their back — but the team is told once a day which reminder is due, so
 * a copy can go out that way. The invoice stays untouched: the reminder counters only move when an
 * email actually goes.
 */
import type { Firestore } from '../db/firestore';
import { emailInvoice, emailStatements } from './documentEmailService';
import { isMailConfigured } from './mailer';
import { logger } from '../utils/logger';
import { getTrustedAppUrl } from '../utils/urlHelper';
import { normalizeReminderSettings, remindersDue, separatePaperReminders, statementMonthDue } from '../../lib/reminders';
import type { ReminderInvoice } from '../../lib/reminders';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { formatTzDate } from '../../lib/calendarDate';
import { PAPER_DELIVERY_METHODS } from '../../lib/delivery';
import { calculateAmountDue } from '../../lib/documentMath';
import { holdsSending } from '../../lib/invoiceApproval';
import { notify } from './notificationService';

/** The currency to show a reminder amount in: the invoice's own, else the workspace's. */
function currencyOf(invoice: { currency?: string } | undefined, workspace: { currency?: string }): string {
  return String(invoice?.currency || workspace?.currency || 'USD');
}

export async function runReminders(db: Firestore, now = new Date(), baseUrl?: string): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  if (!isMailConfigured()) return { sent, failed };
  const url = baseUrl || getTrustedAppUrl();
  const workspaces = await db.collection('workspaces').where('reminderSettings.enabled', '==', true).get();
  for (const wsDoc of workspaces.docs) {
    const workspace = wsDoc.data();
    const settings = normalizeReminderSettings(workspace.reminderSettings);
    if (!settings.enabled) continue;
    const today = formatTzDate(now, typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    const loaded = (await db.collection('invoices').where('workspaceId', '==', wsDoc.id).where('dueDate', '<', today).get())
      .docs.map(d => ({ ...d.data(), id: d.id }) as ReminderInvoice);
    // BE-04: an invoice over the approval limit that nobody has signed off yet never reached the
    // customer, so chasing them for it would be wrong; it waits for the signature like the email does
    const invoices = loaded.filter(inv => !holdsSending(inv, workspace.invoiceApproval));
    const quiet = new Set((await db.collection('customers').where('workspaceId', '==', wsDoc.id).where('noReminders', '==', true).get()).docs.map(d => d.id));
    // Y-27: these customers get a printed or posted reminder instead of an email
    const paper = new Set((await db.collection('customers').where('workspaceId', '==', wsDoc.id).where('deliveryMethod', 'in', [...PAPER_DELIVERY_METHODS]).get()).docs.map(d => d.id));
    const invoiceById = new Map(invoices.map(inv => [inv.id, inv] as const));
    const due = remindersDue(invoices, settings, today, quiet).map(d => ({ ...d, customerId: invoiceById.get(d.invoiceId)?.customerId }));
    const { email: toEmail, paper: toDeliver } = separatePaperReminders(due, paper);
    for (const reminder of toDeliver) {
      const invoice = invoiceById.get(reminder.invoiceId);
      // the counters only move when an email goes, so the step comes from how late it is: one note per
      // reminder day (3 days late, 14 days late…), not a new one every day (L-191)
      const step = Math.max(reminder.step, settings.daysAfterDue.filter(d => reminder.daysOverdue >= d).length);
      await notify(db, {
        workspaceId: wsDoc.id, workspace, kind: 'invoice.paper_copy',
        title: `Reminder to deliver for invoice ${invoice?.number || reminder.invoiceId}`,
        message: `${invoice?.customerName || 'The customer'} is owed ${formatCurrency(calculateAmountDue(invoice || {}), currencyOf(invoice, workspace))} and gets paper copies, not emails — print or post reminder ${step}.`,
        eventKey: `invoice.paper_copy:${reminder.invoiceId}:${step}`, recordId: reminder.invoiceId,
      });
    }
    for (const reminder of toEmail) {
      try {
        await emailInvoice(db, { workspaceId: wsDoc.id, invoiceId: reminder.invoiceId, uid: 'system', system: true, template: 'reminder', baseUrl: url });
        sent++;
      } catch (err) {
        failed++;
        logger.warn('payment reminder not sent', { workspaceId: wsDoc.id, invoiceId: reminder.invoiceId, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return { sent, failed };
}

export async function runDailyReminders() {
  const { getDb } = await import('../db/firestore');
  return runReminders(getDb());
}

/**
 * Monthly statements (Y-28): workspaces that turned them on email each customer with something
 * open their statement once a month (the first daily run of the month, by the workspace's date).
 * The month is recorded first, so a crash halfway never sends the same month twice.
 */
export async function runMonthlyStatements(db: Firestore, now = new Date()): Promise<{ workspaces: number; sent: number; failed: number }> {
  let count = 0;
  let sent = 0;
  let failed = 0;
  if (!isMailConfigured()) return { workspaces: count, sent, failed };
  const workspaces = await db.collection('workspaces').where('reminderSettings.monthlyStatements', '==', true).get();
  for (const wsDoc of workspaces.docs) {
    const workspace = wsDoc.data();
    const today = formatTzDate(now, typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    const month = statementMonthDue(today, typeof workspace.lastStatementsMonth === 'string' ? workspace.lastStatementsMonth : null);
    if (!month) continue;
    await wsDoc.ref.update({ lastStatementsMonth: month });
    count++;
    try {
      const result = await emailStatements(db, { workspaceId: wsDoc.id, uid: 'system', system: true });
      sent += result.sent.length;
      failed += result.failed.length;
    } catch (err) {
      failed++;
      logger.warn('monthly statements not sent', { workspaceId: wsDoc.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { workspaces: count, sent, failed };
}

export async function runDailyStatements() {
  const { getDb } = await import('../db/firestore');
  return runMonthlyStatements(getDb());
}
