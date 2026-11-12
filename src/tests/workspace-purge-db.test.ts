/**
 * Deleting a workspace (L-124) against a real database: after the purge none of its data is left in
 * any table (incl. bank connections, API keys, members, notifications, filed tax returns, purchase
 * orders), the audit trail is kept, and another workspace is untouched. Every table is either
 * purged or listed as kept with a reason. Runs when LF_TEST_DATABASE_URL is set (the guard part
 * always runs).
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Firestore } from '../server/db/pgFirestore';
import { KEPT_AFTER_WORKSPACE_PURGE, WORKSPACE_PURGE_ORDER } from '../constants/collections';
import { documentTables } from './helpers/migrations';

const url = process.env.LF_TEST_DATABASE_URL;

describe('Workspace purge covers every table', () => {
  test('every table is purged or kept for a stated reason', () => {
    const purged = new Set(WORKSPACE_PURGE_ORDER);
    const unclassified = documentTables().filter(t => !purged.has(t) && !KEPT_AFTER_WORKSPACE_PURGE[t]);
    assert.deepEqual(unclassified, [], 'add the table to WORKSPACE_PURGE_EXTRA or KEPT_AFTER_WORKSPACE_PURGE (src/constants/collections.ts)');
    const both = WORKSPACE_PURGE_ORDER.filter(t => KEPT_AFTER_WORKSPACE_PURGE[t]);
    assert.deepEqual(both, []);
  });
});

describe('Workspace purge (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const ws = `ws_purge_${suffix}`;
  const other = `ws_keep_${suffix}`;
  let db: Firestore;
  const tables = ['transactions', 'invoices', 'customers', 'purchaseOrders', 'taxReturns', 'notifications', 'banks', 'apiKeys', 'members', 'emailEvents'];

  before(async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Gone', status: 'pending_deletion', scheduledPurgeAt: '2026-01-01T00:00:00.000Z' });
    await db.collection('workspaces').doc(other).set({ uid: 'owner-2', name: 'Kept' });
    for (const t of tables) {
      await db.collection(t).doc(`${ws}_${t}`).set(t === 'transactions'
        ? { workspaceId: ws, status: 'draft', lines: [], note: 'purge me' }
        : { workspaceId: ws, note: 'purge me' });
      await db.collection(t).doc(`${other}_${t}`).set(t === 'transactions'
        ? { workspaceId: other, status: 'draft', lines: [], note: 'keep me' }
        : { workspaceId: other, note: 'keep me' });
    }
    await db.collection('auditLogs').doc(`${ws}_log`).set({ workspaceId: ws, action: 'X', timestamp: '2026-01-01T00:00:00Z' });
  });

  after(async () => {
    for (const t of tables) await db.collection(t).doc(`${other}_${t}`).delete().catch(() => {});
    await db.collection('workspaces').doc(other).delete().catch(() => {});
  });

  test('the workspace and all its data go; its audit trail and other workspaces stay', async () => {
    const { purgePendingWorkspaces } = await import('../server/services/workspacePurgeService');
    const result = await purgePendingWorkspaces(db, [ws]);
    assert.ok(result.purgedWorkspaces.includes(ws), JSON.stringify(result));
    for (const t of tables) {
      assert.equal((await db.collection(t).doc(`${ws}_${t}`).get()).exists, false, `${t} row of the purged workspace`);
      assert.equal((await db.collection(t).doc(`${other}_${t}`).get()).exists, true, `${t} row of another workspace`);
    }
    assert.equal((await db.collection('workspaces').doc(ws).get()).exists, false);
    assert.equal((await db.collection('auditLogs').doc(`${ws}_log`).get()).exists, true, 'audit trail kept');
  });
});
