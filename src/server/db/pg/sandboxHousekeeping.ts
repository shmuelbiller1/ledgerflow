import type { Firestore } from '../pgFirestore';

/**
 * SBX-1 housekeeping: a sandbox expires 7 days after it opens (`expires_at`). Overlay rows of a
 * closed or expired sandbox are deleted; the step list is kept for 30 more days so a person can
 * still see what was drafted, then the binding goes too. Runs from the daily maintenance job and
 * touches only the `sandbox` schema: no real row is read or written.
 */
export interface SandboxCleanupResult { expired: number; clearedOverlays: number; purged: number }

export async function cleanupSandboxes(db: Firestore, now = new Date()): Promise<SandboxCleanupResult> {
  const expired = await db.pool.query(`update sandbox.sandboxes set status = 'expired', overlay_bytes = 0
    where status = 'open' and expires_at <= $1`, [now]);
  const { rows: overlays } = await db.pool.query<{ table_name: string }>(`select table_name from information_schema.tables
    where table_schema = 'sandbox' and table_type = 'BASE TABLE' and table_name not in ('sandboxes', 'sandboxSteps')`);
  let clearedOverlays = 0;
  for (const { table_name: table } of overlays) {
    const res = await db.pool.query(`delete from sandbox."${table.replaceAll('"', '""')}"
      where sandbox_id in (select id from sandbox.sandboxes where status <> 'open')`);
    clearedOverlays += res.rowCount ?? 0;
  }
  const purged = await db.pool.query(`delete from sandbox.sandboxes
    where status <> 'open' and expires_at <= $1::timestamptz - interval '30 days'`, [now]);
  return { expired: expired.rowCount ?? 0, clearedOverlays, purged: purged.rowCount ?? 0 };
}
