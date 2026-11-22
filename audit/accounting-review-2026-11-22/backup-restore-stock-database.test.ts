// Real exportWorkspaceBackup + restoreWorkspaceBackup + repostService on isolated PostgreSQL 18.7.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('Backup/restore leaves repostQueue dirty after clean repost and scrambles same-day stockMoves dbSeq after MVCC update', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const { getDb } = await import('../../src/server/db/firestore');
  const { exportWorkspaceBackup, restoreWorkspaceBackup } = await import('../../src/server/services/workspaceRestoreService');
  const { repostQueueOf, runRepost } = await import('../../src/server/services/repostService');
  const { compareMoves } = await import('../../src/lib/stockMoves');
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

    // Scenario A: Multi-day backdated purchase already cleanly reposted before backup.
    // Insert Mar 20 purchase first, then backdated Mar 05 purchase (marks repostQueue dirty), then runRepost -> clean!
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

    // Scenario B: Same-day moves on 2026-03-10 with normal random/UUID-like IDs:
    // 1) z_buy10: Buy 10 @ $10 (dbSeq 1), 2) a_sell10: Sell 10 @ $10 (dbSeq 2), 3) m_buy30: Buy 10 @ $30 (dbSeq 3).
    // All three share seq: '1' (as independent postings do), relying on dbSeq for same-day chronological tie-break!
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

    const beforeMoves = (await db.collection('stockMoves').where('workspaceId', '==', ws).get()).docs
      .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      .filter(m => m.itemId === itemId)
      .sort(compareMoves as never);
    assert.deepEqual(beforeMoves.map(m => m.id), [id('z_buy10'), id('a_sell10'), id('m_buy30')]);

    // Export official signed backup and immediately restore it:
    const backup = await exportWorkspaceBackup(db, ws, 'audit-owner');
    await restoreWorkspaceBackup(db, ws, backup, { uid: 'audit-owner', email: 'audit@example.test' });

    // Check 1: repostQueue was cleared BEFORE stockMoves were inserted, so lf_repost_mark dirtied repostQueue again!
    const postRestoreQueue = await repostQueueOf(db, ws);
    const dirtyAfterRestore = postRestoreQueue.filter(r => r.status === 'dirty');

    // Check 2: lf_stock_move_db_seq overwrote dbSeq in ID-sorted export order (a_sell10, m_buy30, z_buy10), scrambling same-day chronological order!
    const afterMoves = (await db.collection('stockMoves').where('workspaceId', '==', ws).get()).docs
      .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      .filter(m => m.itemId === itemId)
      .sort(compareMoves as never);

    assert.equal(dirtyAfterRestore.length, 1);
    assert.deepEqual(afterMoves.map(m => m.id), [id('a_sell10'), id('m_buy30'), id('z_buy10')]);

    console.log(JSON.stringify({
      preBackupDirtyQueueCount: preBackupQueue.filter(r => r.status === 'dirty').length,
      postRestoreDirtyQueueCount: dirtyAfterRestore.length,
      beforeRestoreOrder: beforeMoves.map(m => m.id.replace(`${ws}_`, '')),
      afterRestoreOrder: afterMoves.map(m => m.id.replace(`${ws}_`, '')),
    }));
  } finally {
    for (const table of ['repostQueue', 'stockMoves', 'inventory', 'chartAccounts', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]).catch(() => {});
    }
    await db.terminate();
  }
});
