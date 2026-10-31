import type { Firestore } from '../db/firestore';
import { assetRemindersDue, reminderText } from '../../lib/assetReminders';
import { formatTzDate } from '../../lib/calendarDate';
import { logger } from '../utils/logger';
import { notify } from './notificationService';

/**
 * Warranty, insurance and service reminders (X-08, X-06), every night: each asset whose warranty
 * ends, whose insurance renews or whose next service is due within 30 days (src/lib/assetReminders.ts), in its workspace's own date, tells the
 * people who keep the books once for that date (the notification id comes from the asset, the kind
 * and the date, so a new date is told again). Only assets carrying one of the two dates are read.
 */
export async function runAssetReminders(db: Firestore, now = new Date()): Promise<number> {
  const { rows } = await db.pool.query<{ id: string; data: Record<string, unknown> }>(
    `select id, data from public.assets
      where coalesce(data->>'status', 'active') <> 'disposed'
        and ((data->>'warrantyExpires') is not null or (data->>'insuranceRenews') is not null or (data->>'nextServiceDue') is not null)`);
  const timezones = new Map<string, string>();
  let told = 0;
  for (const row of rows) {
    const workspaceId = String(row.data.workspaceId || '');
    if (!workspaceId) continue;
    if (!timezones.has(workspaceId)) {
      const ws = (await db.collection('workspaces').doc(workspaceId).get()).data();
      timezones.set(workspaceId, ws ? (typeof ws.timezone === 'string' ? ws.timezone : 'UTC') : '');
    }
    const timezone = timezones.get(workspaceId);
    if (!timezone) continue;
    const name = String(row.data.name || 'an asset');
    for (const due of assetRemindersDue(row.data as { status?: string; warrantyExpires?: string; insuranceRenews?: string; nextServiceDue?: string }, formatTzDate(now, timezone))) {
      try {
        told += await notify(db, {
          workspaceId,
          kind: 'asset.reminder',
          title: reminderText(name, due),
          message: due.kind === 'warranty'
            ? 'Have anything that is still wrong with it fixed while the warranty covers it.'
            : due.kind === 'insurance' ? 'Check the cover and the price before it renews.' : 'Book the service, then note it in the asset\'s maintenance log.',
          eventKey: `asset:${row.id}:${due.kind}:${due.date}`,
          recordId: row.id,
        });
      } catch (err) {
        logger.warn('asset reminder failed', { workspaceId, assetId: row.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return told;
}

export async function runDailyAssetReminders() {
  const { getDb } = await import('../db/firestore');
  return runAssetReminders(getDb());
}
