/**
 * Creates in-app notifications: one row per person in `notifications`, only for members whose
 * role receives the type and who haven't turned it off (src/lib/notifications.ts). The same
 * event never notifies a person twice (the row id comes from the event key). Notifying never
 * breaks the action that caused it: failures are logged and ignored.
 *
 * Also the daily job: invoices that just became overdue (S-03) and removing old notifications.
 */
import crypto from 'crypto';
import type { DocumentData, Firestore } from '../db/firestore';
import { emailNoticeNow } from './notificationEmailService';
import { logger } from '../utils/logger';
import { NOTIFICATION_TYPES, notificationRecipients } from '../../lib/notifications';
import type { NotificationPrefs, NotificationType } from '../../lib/notifications';
import { calculateAmountDue } from '../../lib/documentMath';
import { dayNumber } from '../../lib/fiscalCalendar';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { formatTzDate } from '../../lib/calendarDate';

export interface NotifyInput {
  workspaceId: string;
  kind: NotificationType;
  title: string;
  message: string;
  /** Same key = same event: nobody is notified twice for it. */
  eventKey: string;
  recordId?: string;
  /** The person who did it (not notified about their own action). */
  actorUid?: string;
  /** Pass the workspace when it is already loaded. */
  workspace?: DocumentData;
  /** Only these people (still only if their role gets this kind and they want it): news about them. */
  onlyUids?: string[];
  /** BG-04: the screen the notice opens, when it is not the kind's own (a watched record's screen) */
  linkTab?: string;
}

export function notificationId(workspaceId: string, eventKey: string, uid: string): string {
  return `n_${crypto.createHash('sha256').update(`${workspaceId}\u0000${eventKey}\u0000${uid}`).digest('hex').slice(0, 40)}`;
}

/** Returns how many people were notified. Never throws. */
export async function notify(db: Firestore, input: NotifyInput): Promise<number> {
  try {
    const workspace = input.workspace || (await db.collection('workspaces').doc(input.workspaceId).get()).data();
    if (!workspace) return 0;
    const everyone = notificationRecipients(workspace, input.kind, new Map(), input.actorUid)
      .filter(uid => !input.onlyUids || input.onlyUids.includes(uid));
    if (!everyone.length) return 0;
    const profiles = await Promise.all(everyone.map(uid => db.collection('users').doc(uid).get()));
    const prefs = new Map<string, NotificationPrefs | undefined>(
      profiles.map((p, i) => [everyone[i], (p.data()?.notificationPrefs as NotificationPrefs | undefined)]));
    const recipients = notificationRecipients(workspace, input.kind, prefs, input.actorUid)
      .filter(uid => !input.onlyUids || input.onlyUids.includes(uid));
    const createdAt = new Date().toISOString();
    let sent = 0;
    const told: string[] = [];
    for (const uid of recipients) {
      try {
        await db.collection('notifications').doc(notificationId(input.workspaceId, input.eventKey, uid)).create({
          workspaceId: input.workspaceId,
          uid,
          kind: input.kind,
          title: input.title.slice(0, 140),
          message: input.message.slice(0, 400),
          linkTab: input.linkTab || NOTIFICATION_TYPES[input.kind].tab,
          ...(input.recordId ? { recordId: input.recordId } : {}),
          eventKey: input.eventKey.slice(0, 200),
          read: false,
          createdAt,
        });
        sent++;
        told.push(uid);
      } catch (err) {
        if ((err as { code?: number }).code !== 6) throw err; // 6 = already notified
      }
    }
    // S-18: those who chose an email for each notice get one (a notice told before is not emailed again)
    if (told.length) {
      const users = new Map(profiles.map((p, i) => [everyone[i], p.data() as Record<string, unknown> | undefined]));
      await emailNoticeNow(told.map(uid => ({ uid, user: users.get(uid) })), { workspaceName: String(workspace.name || ''), title: input.title, message: input.message });
    }
    return sent;
  } catch (err) {
    logger.warn('notification failed', { workspaceId: input.workspaceId, kind: input.kind, error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

/** S-04: a customer payment was recorded (by a person, a bank line or an online payment). */
export async function notifyPaymentReceived(db: Firestore, payment: DocumentData, actorUid?: string) {
  if (payment.direction !== 'received' || !payment.workspaceId) return 0;
  const amount = formatCurrency(Number(payment.amountCents) || 0, String(payment.currency || 'USD'));
  const who = String(payment.contactName || payment.entityName || '').trim();
  return notify(db, {
    workspaceId: String(payment.workspaceId),
    kind: 'payment.received',
    title: `Payment received: ${amount}`,
    message: `${who || 'A customer'} paid ${amount}${payment.date ? ` on ${String(payment.date).slice(0, 10)}` : ''}.`,
    eventKey: `payment.received:${payment.id}`,
    recordId: String(payment.id),
    actorUid,
  });
}

const OPEN = new Set(['sent', 'pending', 'approved', 'partially_paid', 'overdue']);
const OVERDUE_WINDOW_DAYS = 7;

/**
 * S-03, daily: each open invoice whose due date passed in the last week notifies once. (Older
 * ones were overdue before this existed and would only flood the bell.)
 */
export async function notifyNewlyOverdue(db: Firestore, now = new Date()): Promise<number> {
  const today = formatTzDate(now, 'UTC');
  const from = formatTzDate(new Date(now.getTime() - (OVERDUE_WINDOW_DAYS + 1) * 86400000), 'UTC');
  const snap = await db.collection('invoices').where('dueDate', '>=', from).where('dueDate', '<=', today).get();
  const workspaces = new Map<string, DocumentData | undefined>();
  let sent = 0;
  for (const doc of snap.docs) {
    const inv = doc.data();
    const due = typeof inv.dueDate === 'string' ? inv.dueDate.slice(0, 10) : '';
    if (!inv.workspaceId || !OPEN.has(String(inv.status)) || !/^\d{4}-\d{2}-\d{2}$/.test(due)) continue;
    if (calculateAmountDue(inv) <= 0) continue;
    const wsId = String(inv.workspaceId);
    if (!workspaces.has(wsId)) workspaces.set(wsId, (await db.collection('workspaces').doc(wsId).get()).data());
    const workspace = workspaces.get(wsId);
    if (!workspace) continue;
    const localToday = formatTzDate(now, typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    const daysLate = dayNumber(localToday) - dayNumber(due);
    if (daysLate < 1 || daysLate > OVERDUE_WINDOW_DAYS) continue;
    const currency = String(inv.currency || workspace.currency || 'USD');
    const number = String(inv.number || doc.id);
    sent += await notify(db, {
      workspaceId: wsId,
      workspace,
      kind: 'invoice.overdue',
      title: `Invoice ${number} is overdue`,
      message: `${String(inv.customerName || 'The customer')} owes ${formatCurrency(calculateAmountDue(inv), currency)}; it was due on ${due}.`,
      eventKey: `invoice.overdue:${doc.id}:${due}`,
      recordId: doc.id,
    });
  }
  return sent;
}

/** Read notifications go after 60 days, all after 180. */
export async function pruneNotifications(db: Firestore, now = new Date()): Promise<number> {
  const day = 86400000;
  const readCutoff = new Date(now.getTime() - 60 * day).toISOString();
  const allCutoff = new Date(now.getTime() - 180 * day).toISOString();
  let removed = 0;
  const queries = [
    db.collection('notifications').where('createdAt', '<', allCutoff),
    db.collection('notifications').where('read', '==', true).where('createdAt', '<', readCutoff),
  ];
  for (const query of queries) {
    for (;;) {
      const snap = await query.limit(500).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      removed += snap.docs.length;
      if (snap.docs.length < 500) break;
    }
  }
  return removed;
}

export async function runNotificationJobs(): Promise<{ overdue: number; removed: number }> {
  const { getDb } = await import('../db/firestore');
  const db = getDb();
  return { overdue: await notifyNewlyOverdue(db), removed: await pruneNotifications(db) };
}
