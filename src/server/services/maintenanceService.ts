import { getDb } from '../db/firestore';
import { logger } from '../utils/logger';
import { purgePendingWorkspaces } from './workspacePurgeService';
import { cleanupSandboxes } from '../db/pg/sandboxHousekeeping';

/**
 * Daily data maintenance: expired job logs, the strategicAdvice size cap and scheduled
 * workspace purges. Runs every 24 hours in the long-running server, and from the Vercel
 * cron job (GET /api/cron/daily) when deployed on Vercel. Audit logs are never deleted.
 */
export async function runDailyMaintenance(): Promise<void> {
  logger.info("Running data retention cleanup job");
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90); // 90 days default
  const cutoffStr = cutoff.toISOString();

  // Audit logs are permanent and must NEVER be deleted (§13A / Part 2c).
  // 2. Backup retention: Purge expired job run logs older than 90 days in chunks of 450
  let purgedJobRuns = 0;
  while (true) {
    const oldJobRuns = await getDb().collection('jobRuns').where('finishedAt', '<', cutoffStr).limit(450).get();
    if (oldJobRuns.empty) break;
    const batch = getDb().batch();
    oldJobRuns.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    purgedJobRuns += oldJobRuns.size;
    if (oldJobRuns.size < 450) break;
  }
  if (purgedJobRuns > 0) {
    logger.info("Purged expired job runs", { count: purgedJobRuns });
  }

  // 3. Cap strategicAdvice array on all workspaces to maximum 15 items to prevent database bloat
  const workspacesSnap = await getDb().collection('workspaces').get();
  for (const doc of workspacesSnap.docs) {
    const data = doc.data() || {};
    if (Array.isArray(data.strategicAdvice) && data.strategicAdvice.length > 15) {
      const cappedAdvice = data.strategicAdvice.slice(-15); // Keep the most recent 15
      await doc.ref.update({ strategicAdvice: cappedAdvice });
      logger.info("Capped strategicAdvice for workspace", { workspaceId: doc.id });
    }
  }

  // 4. Workspace deletion purge job
  const purgeResult = await purgePendingWorkspaces(getDb());
  if (purgeResult.purgedWorkspaces.length > 0) {
    logger.info("Purged pending workspaces", { count: purgeResult.purgedWorkspaces.length, purged: purgeResult.purgedWorkspaces });
  }
  if (purgeResult.errors.length > 0) {
    console.error(`[Data Lifecycle] Workspace purge encountered errors: ${purgeResult.errors.join('; ')}`);
  }

  // 5. SBX-1: expired assistant sandboxes lose their overlay rows; old closed ones are purged
  try {
    const sandboxes = await cleanupSandboxes(getDb());
    if (sandboxes.expired || sandboxes.clearedOverlays || sandboxes.purged) logger.info("Sandbox housekeeping", { ...sandboxes });
  } catch (err) {
    console.error('[Data Lifecycle] Sandbox housekeeping failed:', err);
  }
}
