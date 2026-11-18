import { requireLiveDb } from '../db/firestore';
import type { Firestore } from '../db/firestore';
import { deleteFilesWithPrefix, StorageNotConfiguredError } from '../storage/supabaseStorage';
import { WORKSPACE_PURGE_ORDER } from '../../constants/collections';
import { writeServerAuditLog } from './auditLogService';
import { retentionFor } from '../../lib/retention';

/** `only` limits the run to these workspaces (tests: so parallel runs don't purge each other's). */
export async function purgePendingWorkspaces(db: Firestore, only?: string[]): Promise<{ purgedWorkspaces: string[]; errors: string[] }> {
  requireLiveDb(db, 'Workspace purge');
  const nowISO = new Date().toISOString();
  const purgedWorkspaces: string[] = [];
  const errors: string[] = [];

  try {
    const wsSnap = await db.collection('workspaces')
      .where('status', '==', 'pending_deletion')
      .where('scheduledPurgeAt', '<=', nowISO)
      .get();

    if (wsSnap.empty) {
      return { purgedWorkspaces, errors };
    }

    for (const wsDoc of wsSnap.docs) {
      const workspaceId = wsDoc.id;
      if (only && !only.includes(workspaceId)) continue;
      // legal hold (BJ-05): a deleted workspace on hold is kept until the hold is lifted
      if (retentionFor(wsDoc.data()).legalHold) continue;
      const jobRunRef = db.collection('jobRuns').doc(`purge_workspace_${workspaceId}`);

      try {
        const jobRunSnap = await jobRunRef.get();
        const jobRunData = jobRunSnap.exists ? jobRunSnap.data() || {} : {};

        let startIndex = 0;
        let lastCursorDocId: string | null = jobRunData.lastCursorDocId || null;

        if (jobRunData.lastUpdatedCollection) {
          const foundIdx = WORKSPACE_PURGE_ORDER.indexOf(String(jobRunData.lastUpdatedCollection));
          if (foundIdx >= 0) {
            startIndex = foundIdx;
          }
        }

        // Initialize or update running job
        await jobRunRef.set({
          jobType: 'workspace_purge',
          workspaceId,
          startedAt: jobRunData.startedAt || nowISO,
          status: 'running',
          updatedAt: new Date().toISOString()
        }, { merge: true });

        // 1. Delete the workspace's data in every table that holds it, in batches of 400
        for (let i = startIndex; i < WORKSPACE_PURGE_ORDER.length; i++) {
          const collectionName = WORKSPACE_PURGE_ORDER[i];

          let hasMore = true;
          while (hasMore) {
            let q = db.collection(collectionName)
              .where('workspaceId', '==', workspaceId)
              .orderBy('__name__')
              .limit(400);

            if (lastCursorDocId) {
              const cursorDoc = await db.collection(collectionName).doc(lastCursorDocId).get();
              if (cursorDoc.exists) {
                q = q.startAfter(cursorDoc);
              }
            }

            const docsSnap = await q.get();
            if (docsSnap.empty) {
              hasMore = false;
              lastCursorDocId = null;
              break;
            }

            const batch = db.batch();
            docsSnap.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();

            const lastDoc = docsSnap.docs[docsSnap.docs.length - 1];
            lastCursorDocId = lastDoc.id;

            await jobRunRef.set({
              lastUpdatedCollection: collectionName,
              lastCursorDocId,
              updatedAt: new Date().toISOString()
            }, { merge: true });

            if (docsSnap.size < 400) {
              hasMore = false;
              lastCursorDocId = null;
            }
          }
        }

        // 2. Purge Storage files associated with this workspace
        try {
          await deleteFilesWithPrefix(`workspaces/${workspaceId}/`);
          await deleteFilesWithPrefix(`${workspaceId}/`);
        } catch (storageErr) {
          if (process.env.NODE_ENV !== 'production' && storageErr instanceof StorageNotConfiguredError) {
            // Tolerate unconfigured storage bucket only in non-production/test environments
            console.warn(`[Workspace Purge] Non-production storage tolerance for workspace ${workspaceId}:`, storageErr instanceof Error ? storageErr.message : String(storageErr));
          } else {
            console.error(`[Workspace Purge] Storage file deletion failed for workspace ${workspaceId}:`, storageErr);
            throw new Error(`Storage purge failed: ${storageErr instanceof Error ? storageErr.message : String(storageErr)}`, { cause: storageErr });
          }
        }

        // 3. Write permanent purge audit log before deleting workspace document
        await writeServerAuditLog({
          workspaceId,
          uid: 'system',
          email: 'system@ledgerflow.internal',
          action: 'WORKSPACE_PURGED',
          entityType: 'workspace',
          entityId: workspaceId,
          details: {
            description: `Workspace ${workspaceId} permanently purged following 30-day retention period.`,
            purgedAt: new Date().toISOString()
          }
        }, { db });

        // 4. Delete the workspace document LAST
        await wsDoc.ref.delete();

        // 5. Mark job run as completed
        await jobRunRef.set({
          status: 'completed',
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }, { merge: true });

        purgedWorkspaces.push(workspaceId);
      } catch (err) {
        console.error(`[Workspace Purge] Failed purging workspace ${workspaceId}:`, err);
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Workspace ${workspaceId}: ${message}`);
        await jobRunRef.set({
          status: 'failed',
          lastError: message,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    }
  } catch (err) {
    console.error('[Workspace Purge] Failed querying pending workspaces:', err);
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { purgedWorkspaces, errors };
}
