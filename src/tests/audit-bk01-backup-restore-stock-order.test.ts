/**
 * BK-01: restoring a backup writes stock moves back exactly as the backup carried them — each move
 * keeps its own dbSeq (same-day chronological order) and the restore does not re-dirty the repost
 * queue. Audit scenario (PR #1002, `backup-restore-stock-database.test.ts`) with the assertions
 * inverted to the correct accounting result.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('Backup/restore keeps same-day stockMoves dbSeq order and leaves repostQueue clean', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const { getDb } = await import('../server/db/firestore');
  const { exportWorkspaceBackup, restoreWorkspaceBackup } = await import('../server/services/workspaceRestoreService');
  const { repostQueueOf, runRepost } = await import('../server/services/repostService');
  const { compareMoves } = await import('../lib/stockMoves');
  const db = getDb();
  const ws = `ws_audit_bkp_${crypto.randomBytes(5).toString('hex')}`;
  const id = (s: string) => `${ws}_${s}`;

  try {
    await db.collection('workspaces').doc(ws).set({ uid: 'audit-owner', members: ['audit-owner'], name: 'Synthetic Warehouse Co', currency: 'USD', timezone: 'UTC' });
    for (const [key, name, type, category] of [
      ['inv', 'Inventory Asset', 'asset', 'Inventory'],
      ['cogs', 'Cost of Goods Sold', 'expense', 'Cost of Goods Sold'],
      ['ap', 'Accounts Payable', 'liability', 'Payables'],
    ]) {
      await db.collection('chartAccounts').doc(id(key)).set({ workspaceId: ws, name, type, category });
    }
    const itemId = id('widget');
    await db.collection('inventory').doc(itemId).set({
      workspaceId: ws, name: 'Precision Bearing', sku: 'PB-1', quantityAtHand: 10, unitCostCents: 3000,
      inventoryAccountId: id('inv'), cogsAccountId: id('cogs'),
    });

    // Scenario A: multi-day backdated purchases, reposted cleanly before the backup
    const item2 = id('valve');
    await db.collection('inventory').doc(item2).set({
      workspaceId: ws, name: 'Control Valve', sku: 'CV-2', quantityAtHand: 20, unitCostCents: 1500,
      inventoryAccountId: id('inv'), cogsAccountId: id('cogs'),
    });
    await db.collection('stockMoves').doc(id('a_mar20')).set({
      workspaceId: ws, itemId: item2, date: '2026-03-20', seq: '1', kind: 'purchase',
      quantity: 10, quantityBefore: 0, quantityAfter: 10, unitCostCents: 2000, totalCostCents: 20_000, sourceType: 'bill', sourceId: id('b20'),
    });
    await db.collection('stockMoves').doc(id('z_mar05')).set({
      workspaceId: ws, itemId: item2, date: '2026-03-05', seq: '1', kind: 'purchase',
      quantity: 10, quantityBefore: 10, quantityAfter: 20, unitCostCents: 1000, totalCostCents: 10_000, sourceType: 'bill', sourceId: id('b05'),
    });
    await runRepost(db, { workspaceId: ws, runId: 'audit_run_01', user: { uid: 'audit-owner', email: 'audit@example.test' } });
    const preBackupQueue = await repostQueueOf(db, ws);
    assert.equal(preBackupQueue.filter(r => r.status === 'dirty').length, 0, 'pre-backup repostQueue is clean');

    // Scenario B: same-day moves on 2026-03-10 with independent postings' equal `seq`, relying on dbSeq
    await db.collection('stockMoves').doc(id('z_buy10')).set({
      workspaceId: ws, itemId, date: '2026-03-10', seq: '1', kind: 'purchase',
      quantity: 10, quantityBefore: 0, quantityAfter: 10, unitCostCents: 1000, totalCostCents: 10_000, sourceType: 'bill', sourceId: id('b1'),
    });
    await db.collection('stockMoves').doc(id('a_sell10')).set({
      workspaceId: ws, itemId, date: '2026-03-10', seq: '1', kind: 'sale',
      quantity: -10, quantityBefore: 10, quantityAfter: 0, unitCostCents: 1000, totalCostCents: -10_000, sourceType: 'invoice', sourceId: id('i1'),
    });
    await db.collection('stockMoves').doc(id('m_buy30')).set({
      workspaceId: ws, itemId, date: '2026-03-10', seq: '1', kind: 'purchase',
      quantity: 10, quantityBefore: 0, quantityAfter: 10, unitCostCents: 3000, totalCostCents: 30_000, sourceType: 'bill', sourceId: id('b2'),
    });

    const movesOf = async (): Promise<Array<{ id: string; itemId?: unknown; dbSeq?: unknown }>> => (await db.collection('stockMoves').where('workspaceId', '==', ws).get()).docs
      .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string; itemId?: unknown; dbSeq?: unknown })
      .filter(m => m.itemId === itemId)
      .sort(compareMoves as never);
    const beforeMoves = await movesOf();
    assert.deepEqual(beforeMoves.map(m => m.id), [id('z_buy10'), id('a_sell10'), id('m_buy30')]);

    // Export the signed backup and restore it: the restored books are the backup's books
    const backup = await exportWorkspaceBackup(db, ws, 'audit-owner');
    await restoreWorkspaceBackup(db, ws, backup, { uid: 'audit-owner', email: 'audit@example.test' });

    // Check 1: the restore must not re-dirty the repost queue (the backup was taken post-repost)
    const postRestoreQueue = await repostQueueOf(db, ws);
    assert.equal(postRestoreQueue.filter(r => r.status === 'dirty').length, 0, 'restore leaves repostQueue clean');

    // Check 2: each restored move keeps its own dbSeq, so the same-day chronological order survives
    const afterMoves = await movesOf();
    assert.deepEqual(afterMoves.map(m => m.id), [id('z_buy10'), id('a_sell10'), id('m_buy30')], 'same-day order is the backup order');
    assert.deepEqual(afterMoves.map(m => m.dbSeq), beforeMoves.map(m => m.dbSeq), 'dbSeq values are preserved');
  } finally {
    for (const table of ['repostQueue', 'stockMoves', 'inventory', 'chartAccounts', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]).catch(() => {});
    }
    await db.terminate();
  }
});
