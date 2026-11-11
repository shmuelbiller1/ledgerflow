import type { Firestore } from '../db/firestore';
import { getDb, isWorkspaceMemberData } from '../db/firestore';
import { writeServerAuditLog } from './auditLogService';

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
    await docRef.set(auditRecord);

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
