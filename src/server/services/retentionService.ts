import type { Firestore, Transaction } from '../db/firestore';
import type { Query } from '../db/pgFirestore';
import { RETENTION_DEFAULTS, retentionFor, RetentionSettingsSchema, type RetentionSettings } from '../../lib/retention';
import { workspaceRole } from '../../lib/periodLock';
import { writeServerAuditLog } from './auditLogService';

/**
 * Retention (L-08, BJ-05): owners set how long each workspace's logs are kept, and can put the
 * workspace on legal hold. The daily job prunes what is past its time. Bounce and spam reports
 * are never pruned (they keep those addresses from being emailed again), the books and the
 * audit trail are never touched here.
 */

export class RetentionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'RetentionError';
  }
}

/** Email log entries that may expire (bounced/complaint stay: the suppression list). */
const PRUNABLE_EMAIL_EVENTS = ['sent', 'failed', 'delivered'];
const BATCH = 400;

export interface RetentionWriteResult {
  workspaceId: string;
  before: RetentionSettings;
  settings: RetentionSettings;
  changes: string[];
}

export async function updateRetentionInTransaction(
  db: Firestore,
  tx: Transaction,
  input: { workspaceId: string; uid: string; settings: unknown },
): Promise<RetentionWriteResult> {
  const parsed = RetentionSettingsSchema.safeParse(input.settings);
  if (!parsed.success) throw new RetentionError(400, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const ref = db.collection('workspaces').doc(input.workspaceId);
  const workspace = (await tx.get(ref)).data();
  if (!workspace) throw new RetentionError(404, 'Workspace not found');
  if (workspaceRole(workspace, input.uid) !== 'owner') throw new RetentionError(403, 'Only owners change retention');
  const before = retentionFor(workspace);
  const settings = parsed.data;
  const update: Record<string, unknown> = { retention: settings, updatedAt: new Date().toISOString() };
  // a pending deletion follows the new grace period (and a legal hold keeps it from running)
  if (workspace.status === 'pending_deletion' && typeof workspace.deletedAt === 'string' && settings.deletionGraceDays !== before.deletionGraceDays) {
    update.scheduledPurgeAt = new Date(Date.parse(workspace.deletedAt) + settings.deletionGraceDays * 86_400_000).toISOString();
  }
  tx.update(ref, update);
  const changes = (Object.keys(settings) as Array<keyof RetentionSettings>)
    .filter(key => settings[key] !== before[key])
    .map(key => `${key}: ${before[key]} → ${settings[key]}`);
  return { workspaceId: input.workspaceId, before, settings, changes };
}

export function retentionAuditSummary(result: RetentionWriteResult) {
  return {
    action: result.settings.legalHold !== result.before.legalHold
      ? (result.settings.legalHold ? 'LEGAL_HOLD_ON' : 'LEGAL_HOLD_OFF')
      : 'RETENTION_CHANGED',
    entityType: 'workspace',
    entityId: result.workspaceId,
    description: result.changes.length ? `Retention changed (${result.changes.join(', ')})` : 'Retention saved (no change)',
    details: { before: result.before, after: result.settings },
  };
}

/** Service compatibility wrapper; command callers use updateRetentionInTransaction through the shared runner. */
export async function updateRetention(db: Firestore, input: { workspaceId: string; uid: string; email?: string; settings: unknown }): Promise<RetentionSettings> {
  return db.runTransaction(async tx => {
    const result = await updateRetentionInTransaction(db, tx, input);
    const summary = retentionAuditSummary(result);
    await writeServerAuditLog({
      workspaceId: input.workspaceId,
      uid: input.uid,
      email: input.email || '',
      action: summary.action,
      entityType: summary.entityType,
      entityId: summary.entityId,
      details: { description: summary.description, ...summary.details },
    }, { db, tx });
    return result.settings;
  });
}

async function deleteAll(db: Firestore, query: Query): Promise<number> {
  let removed = 0;
  for (;;) {
    const snap = await query.limit(BATCH).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    removed += snap.docs.length;
    if (snap.docs.length < BATCH) break;
  }
  return removed;
}

/** The daily pruning, workspace by workspace under its own settings. */
export async function applyRetention(db: Firestore, now = new Date()): Promise<{ emailEvents: number; errorLogs: number; held: number }> {
  const result = { emailEvents: 0, errorLogs: 0, held: 0 };
  const cutoff = (daysKept: number) => new Date(now.getTime() - daysKept * 86_400_000).toISOString();
  const workspaces = await db.collection('workspaces').get();
  for (const doc of workspaces.docs) {
    const settings = retentionFor(doc.data());
    if (settings.legalHold) { result.held++; continue; }
    if (settings.emailLogDays > 0) {
      result.emailEvents += await deleteAll(db, db.collection('emailEvents')
        .where('workspaceId', '==', doc.id).where('event', 'in', PRUNABLE_EMAIL_EVENTS).where('timestamp', '<', cutoff(settings.emailLogDays)));
    }
    result.errorLogs += await deleteAll(db, db.collection('errorLogs')
      .where('workspaceId', '==', doc.id).where('createdAt', '<', cutoff(settings.errorLogDays)));
  }
  // error reports from before sign-in belong to no workspace: the default period
  result.errorLogs += await deleteAll(db, db.collection('errorLogs')
    .where('workspaceId', '==', 'unauthenticated').where('createdAt', '<', cutoff(RETENTION_DEFAULTS.errorLogDays)));
  return result;
}

export async function runDailyRetention(): Promise<void> {
  const { getDb } = await import('../db/firestore');
  await applyRetention(getDb());
}
