import type { Firestore } from '../db/firestore';
import { getDb, isWorkspaceMemberData } from '../db/firestore';
import { writeServerAuditLog } from './auditLogService';
import { notify } from './notificationService';

export type AuthAuditEventType = 'login' | 'logout' | 'failed_login' | 'password_reset' | 'token_refresh';

export interface AuthAuditEvent {
  uid: string;
  event: AuthAuditEventType;
  workspaceId?: string;
  ip?: string;
  userAgent?: string;
  email?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Records an authentication audit trail event into `loginAudits` and, for `login` events,
 * emits server-verified `USER_LOGIN` rows into workspace `auditLogs` so Access Review and
 * the Audit Evidence Pack read authoritative server timestamps rather than browser writes.
 */
export async function recordAuthEvent(
  eventData: AuthAuditEvent,
  dbOverride?: Firestore
): Promise<string> {
  const db = dbOverride || getDb();
  const docRef = db.collection('loginAudits').doc();
  const timestamp = eventData.timestamp || new Date().toISOString();

  const auditRecord = {
    id: docRef.id,
    uid: eventData.uid,
    event: eventData.event,
    ...(eventData.workspaceId ? { workspaceId: eventData.workspaceId } : {}),
    ip: eventData.ip || 'unknown',
    userAgent: eventData.userAgent || 'unknown',
    email: eventData.email || '',
    metadata: eventData.metadata || {},
    timestamp,
    createdAt: timestamp,
  };

  try {
    // S-13: was this a sign-in from a network this person has not signed in from before?
    // A failed check never stops the sign-in being recorded.
    const newNetwork = eventData.event === 'login' && eventData.workspaceId
      ? await isNewSignInNetwork(db, eventData.uid, auditRecord.ip).catch((err: unknown) => {
        console.warn('[authAuditService] new-network check failed:', err instanceof Error ? err.message : err);
        return false;
      })
      : false;
    await docRef.set(auditRecord);
    if (newNetwork && eventData.workspaceId) {
      await notify(db, {
        workspaceId: eventData.workspaceId,
        kind: 'security.new_sign_in',
        title: 'New sign-in to your account',
        message: `Your account signed in from a network not seen before (IP ${auditRecord.ip}). If this was not you, sign out all sessions in Settings → Security and change your password.`,
        eventKey: `new-sign-in:${eventData.uid}:${auditRecord.ip}`,
        onlyUids: [eventData.uid],
      });
    }

    if (eventData.event === 'login') {
      const targetWorkspaceIds = new Set<string>();
      if (eventData.workspaceId) {
        const wsDoc = await db.collection('workspaces').doc(eventData.workspaceId).get();
        if (wsDoc.exists && isWorkspaceMemberData(wsDoc.data(), { uid: eventData.uid }, eventData.workspaceId)) {
          targetWorkspaceIds.add(eventData.workspaceId);
        }
      } else {
        const [ownedSnap, memberSnap] = await Promise.all([
          db.collection('workspaces').where('uid', '==', eventData.uid).get(),
          db.collection('workspaces').where('members', 'array-contains', eventData.uid).get(),
        ]);
        for (const doc of ownedSnap.docs) targetWorkspaceIds.add(doc.id);
        for (const doc of memberSnap.docs) targetWorkspaceIds.add(doc.id);
      }

      await Promise.all(
        Array.from(targetWorkspaceIds).map((workspaceId) =>
          writeServerAuditLog(
            {
              workspaceId,
              uid: eventData.uid,
              email: eventData.email,
              action: 'USER_LOGIN',
              entityType: 'auth',
              entityId: eventData.uid,
              timestamp,
              details: {
                description: 'User authenticated and entered workspace session',
                loginAuditId: docRef.id,
                ip: auditRecord.ip,
              },
            },
            { db }
          )
        )
      );
    }

    return docRef.id;
  } catch (err) {
    console.error('[authAuditService] Failed to record auth event:', err);
    return '';
  }
}

/**
 * S-13: true when the person has signed in before, but never from this IP. The first sign-in
 * ever is not "new" (nothing to compare with), and an unknown IP never alerts.
 */
export async function isNewSignInNetwork(db: Firestore, uid: string, ip: string): Promise<boolean> {
  if (!ip || ip === 'unknown') return false;
  const prior = await db.collection('loginAudits')
    .where('uid', '==', uid)
    .where('event', '==', 'login')
    .orderBy('timestamp', 'desc')
    .limit(200)
    .get();
  if (prior.empty) return false;
  return !prior.docs.some(doc => doc.data()?.ip === ip);
}
