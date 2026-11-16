import type { Firestore, Transaction } from '../db/firestore';
import { digestEmail, emailMode, noticeEmail, type NotificationEmailMode } from '../../lib/notificationEmail';
import { isMailConfigured, sendMail } from './mailer';
import { getTrustedAppUrl } from '../utils/urlHelper';
import { logger } from '../utils/logger';

/**
 * Notices by email (S-18). The choice is kept on the person's user record (`notificationEmail`,
 * written by the server: GET/PUT /api/v1/account/notification-email). "Each as it happens" is sent
 * by notify() right after the notice is stored; "one a day" is the nightly digest of what they have
 * not read since the last one. Nothing is sent when no email provider is set up; a failed email never
 * stops the notice itself.
 */
export async function getNotificationEmail(db: Firestore, uid: string): Promise<NotificationEmailMode> {
  return emailMode((await db.collection('users').doc(uid).get()).data()?.notificationEmail);
}

/** The write of setNotificationEmail inside a given transaction (registered command `account.setnotificationemail`). */
export async function setNotificationEmailInTransaction(db: Firestore, tx: Transaction, uid: string, mode: NotificationEmailMode): Promise<{ mode: NotificationEmailMode; previousMode: NotificationEmailMode }> {
  const ref = db.collection('users').doc(uid);
  const current = (await tx.get(ref)).data();
  const previousMode = emailMode(current?.notificationEmail);
  tx.set(ref, { ...(current || {}), uid, notificationEmail: mode, updatedAt: new Date().toISOString() });
  return { mode, previousMode };
}

export async function setNotificationEmail(db: Firestore, uid: string, mode: NotificationEmailMode): Promise<NotificationEmailMode> {
  return (await db.runTransaction(t => setNotificationEmailInTransaction(db, t, uid, mode))).mode;
}

const appUrl = () => { try { return getTrustedAppUrl(); } catch { return 'https://ledgerflow.app'; } };

/** Called by notify() with the people just told and their user records. */
export async function emailNoticeNow(recipients: Array<{ uid: string; user?: Record<string, unknown> }>, notice: { workspaceName: string; title: string; message: string }) {
  if (!isMailConfigured()) return 0;
  let sent = 0;
  for (const { uid, user } of recipients) {
    const to = typeof user?.email === 'string' ? user.email : '';
    if (!to || emailMode(user?.notificationEmail) !== 'immediate') continue;
    try {
      await sendMail({ to, ...noticeEmail(notice, appUrl()) });
      sent++;
    } catch (err) {
      logger.warn('notice email failed', { uid, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return sent;
}

/** The nightly digest: for each person who chose it, the notices they have not read since the last one (or a day). */
export async function runNotificationDigest(db: Firestore, now = new Date()): Promise<number> {
  if (!isMailConfigured()) return 0;
  const { rows: people } = await db.pool.query<{ id: string; data: Record<string, unknown> }>(
    `select id, data from public.users where data->>'notificationEmail' = 'daily'`);
  const names = new Map<string, string>();
  let sent = 0;
  for (const person of people) {
    const to = typeof person.data.email === 'string' ? person.data.email : '';
    if (!to) continue;
    const since = typeof person.data.lastDigestAt === 'string' ? person.data.lastDigestAt : new Date(now.getTime() - 86_400_000).toISOString();
    const { rows } = await db.pool.query<{ workspace_id: string; title: string; message: string; created: string }>(
      `select workspace_id, data->>'title' as title, data->>'message' as message, data->>'createdAt' as created
         from public.notifications
        where data->>'uid' = $1 and coalesce((data->>'read')::boolean, false) = false and data->>'createdAt' > $2
        order by data->>'createdAt' limit 200`, [person.id, since]);
    for (const r of rows) {
      if (!names.has(r.workspace_id)) names.set(r.workspace_id, String((await db.collection('workspaces').doc(r.workspace_id).get()).data()?.name || ''));
    }
    const email = digestEmail(rows.map(r => ({ workspaceName: names.get(r.workspace_id) || '', title: r.title, message: r.message, createdAt: r.created })), appUrl());
    try {
      if (email) { await sendMail({ to, ...email }); sent++; }
      await db.collection('users').doc(person.id).set({ lastDigestAt: now.toISOString() }, { merge: true });
    } catch (err) {
      logger.warn('notice digest failed', { uid: person.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return sent;
}

export async function runDailyNotificationDigest() {
  const { getDb } = await import('../db/firestore');
  return runNotificationDigest(getDb());
}
