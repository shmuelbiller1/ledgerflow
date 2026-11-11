import { isWorkspaceMemberData, type Firestore } from '../db/firestore';
import { RECORD_TABS, type RecordRef } from '../../lib/recordLinks';
import { MAX_WATCHES_PER_PERSON, WATCH_KIND, WATCH_TABLES, watchNoticeRecordId, type Watch } from '../../lib/watches';
import { notify } from './notificationService';
import { logger } from '../utils/logger';

/**
 * Watching a record (BG-04, src/lib/watches.ts). Anyone in the workspace watches or stops watching
 * a record; the nightly job tells each watcher about records changed since they were last told, and
 * about deleted ones (their watch then ends).
 */
export class WatchError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

interface Actor { workspaceId: string; uid: string }

async function member(db: Firestore, input: Actor) {
  const ws = (await db.collection('workspaces').doc(input.workspaceId).get()).data();
  if (!ws) throw new WatchError(404, 'Workspace not found');
  if (!isWorkspaceMemberData(ws, { uid: input.uid }, input.workspaceId)) throw new WatchError(403, 'Only people in this workspace watch its records');
  return ws;
}

/** The record's last change (the row's own time, kept by the database), or null when it is not in this workspace. */
async function lastChange(db: Firestore, workspaceId: string, record: RecordRef): Promise<string | null> {
  const table = WATCH_TABLES[record.type];
  if (!table) return null;
  const { rows } = await db.pool.query<{ updated_at: Date }>(`select updated_at from public."${table}" where id = $1 and workspace_id = $2`, [record.id, workspaceId]);
  return rows[0] ? rows[0].updated_at.toISOString() : null;
}

export async function myWatches(db: Firestore, input: Actor): Promise<Watch[]> {
  await member(db, input);
  const snap = await db.collection('documents').where('workspaceId', '==', input.workspaceId).where('kind', '==', WATCH_KIND).where('watcher', '==', input.uid).get();
  return snap.docs.map(d => ({ ...(d.data() as Watch), id: d.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function watchRecord(db: Firestore, input: Actor & { record: unknown }): Promise<Watch> {
  const r = (input.record || {}) as Partial<RecordRef & { label: string }>;
  if (!r.type || !WATCH_TABLES[r.type] || typeof r.id !== 'string' || !r.id || r.id.length > 200 || typeof r.label !== 'string' || !r.label.trim() || r.label.length > 200) throw new WatchError(400, 'Choose the record to watch');
  await member(db, input);
  const seenAt = await lastChange(db, input.workspaceId, { type: r.type, id: r.id });
  if (!seenAt) throw new WatchError(404, 'That record is not in this workspace');
  const mine = await myWatches(db, input);
  const already = mine.find(w => w.record.type === r.type && w.record.id === r.id);
  if (already) return already;
  if (mine.length >= MAX_WATCHES_PER_PERSON) throw new WatchError(409, `${MAX_WATCHES_PER_PERSON} records at most: stop watching some first`);
  const ref = db.collection('documents').doc();
  const watch: Omit<Watch, 'id'> = { kind: WATCH_KIND, workspaceId: input.workspaceId, watcher: input.uid, record: { type: r.type, id: r.id, label: r.label.trim() }, createdAt: new Date().toISOString(), seenAt };
  await ref.set(watch);
  return { ...watch, id: ref.id };
}

export async function unwatch(db: Firestore, input: Actor & { watchId: string }) {
  const ref = db.collection('documents').doc(input.watchId);
  const watch = (await ref.get()).data() as Watch | undefined;
  if (!watch || watch.kind !== WATCH_KIND || watch.workspaceId !== input.workspaceId || watch.watcher !== input.uid) throw new WatchError(404, 'You are not watching that');
  await ref.delete();
}

/** The nightly job: tell each watcher what changed or went since they were last told. Returns how many were told. */
export async function runWatches(db: Firestore): Promise<number> {
  const { rows } = await db.pool.query<{ id: string; data: Omit<Watch, 'id'> }>(`select id, data from public.documents where data->>'kind' = $1`, [WATCH_KIND]);
  let told = 0;
  for (const row of rows) {
    const w = { ...row.data, id: row.id };
    try {
      const changed = await lastChange(db, w.workspaceId, w.record);
      if (changed && changed <= w.seenAt) continue;
      const tab = RECORD_TABS[w.record.type];
      if (!changed) {
        await notify(db, { workspaceId: w.workspaceId, kind: 'record.changed', title: `${w.record.label} was deleted`, message: 'You were watching it; the watch has ended.', eventKey: `watch:${w.id}:deleted`, onlyUids: [w.watcher] });
        await db.collection('documents').doc(w.id).delete();
      } else {
        await notify(db, { workspaceId: w.workspaceId, kind: 'record.changed', title: `${w.record.label} changed`, message: 'It changed since you were last told; open it to see what is different now.', eventKey: `watch:${w.id}:${changed}`, recordId: watchNoticeRecordId(w.record), onlyUids: [w.watcher], linkTab: tab });
        await db.collection('documents').doc(w.id).update({ seenAt: changed });
      }
      told++;
    } catch (err) {
      logger.warn('watch notice failed', { watchId: w.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return told;
}

export async function runDailyWatches() {
  const { getDb } = await import('../db/firestore');
  return runWatches(getDb());
}
