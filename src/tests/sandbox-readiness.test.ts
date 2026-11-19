import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Firestore } from '../server/db/firestore';
import { allocationLedgerReady, resetAllocationLedgerReadyForTests } from '../server/services/allocationLedger';
import { verifyAuditHashChain, writeServerAuditLog } from '../server/services/auditLogService';
import { periodClosingsReady, resetPeriodClosingsReadyForTests } from '../server/services/periodClosingService';
import { repostQueueReady } from '../server/services/repostMarker';
import { runRepost } from '../server/services/repostService';
import { stockClosingsReady } from '../server/services/stockClosingService';
import { resetStockMovesReadyForTests, stockMovesReady, writeStockMoves } from '../server/services/stockMoveService';
import { seedSandbox } from './helpers/sandbox';

const url = process.env.LF_TEST_DATABASE_URL;

describe('SBX-1: settlement and stock readiness (PostgreSQL)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `sbx-readiness-${randomUUID()}`;
  const uid = `${ws}-owner`;
  let live: Firestore;
  let draft: Firestore;

  before(async () => {
    live = new Firestore({ connectionString: url, max: 1 });
    await live.collection('workspaces').doc(ws).create({ uid, members: [uid], currency: 'USD' });
    draft = live.forSandbox(await seedSandbox(live, ws, uid));
  });

  after(async () => {
    if (!live) return;
    try {
      await live.pool.query('delete from sandbox.sandboxes where workspace_id = $1', [ws]);
      for (const table of ['auditLogs', 'stockMoves', 'workspaces']) {
        await live.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
      }
    } finally {
      await live.terminate();
    }
  });

  test('missing draft relations and warm live flags never influence each other', async t => {
    resetAllocationLedgerReadyForTests();
    resetPeriodClosingsReadyForTests();
    // Exercise real catalog queries with a missing relation without changing shared CI schema.
    const missing = t.mock.method(draft, 'tableSource', () => 'sandbox_read."not_installed_for_readiness_test"');
    const liveProbe = t.mock.method(live, 'tablesExist');
    const checks = [allocationLedgerReady, periodClosingsReady, repostQueueReady, stockClosingsReady];
    try {
      assert.deepEqual(await Promise.all(checks.map(check => check(draft))), [false, false, false, false]);
      assert.equal(liveProbe.mock.callCount(), 0);
      assert.deepEqual(await Promise.all(checks.map(check => check(live))), [true, true, true, true]);
      assert.deepEqual(liveProbe.mock.calls.map(call => call.arguments), [
        ['paymentAllocations', 'allocationOperations'], ['periodClosings'], ['repostQueue'], ['stockClosings'],
      ]);
      assert.deepEqual(await Promise.all(checks.map(check => check(draft))), [false, false, false, false]);
      assert.deepEqual(await Promise.all(checks.map(check => check(live))), [true, true, true, true]);
      assert.equal(liveProbe.mock.callCount(), checks.length, 'the draft did not replace a cached real result');
    } finally {
      missing.mock.restore();
      resetAllocationLedgerReadyForTests();
      resetPeriodClosingsReadyForTests();
    }
  });

  test('cold probes use the only connection and a live missing flag cannot suppress draft stock history', { timeout: 5_000 }, async t => {
    resetStockMovesReadyForTests();
    const missing = t.mock.method(live, 'tableSource', () => 'public."not_installed_for_readiness_test"');
    try {
      assert.equal(await stockMovesReady(live), false);
      missing.mock.restore();
      const sequence = async () => (await live.pool.query('select last_value, is_called from public."stockMoves_db_seq"')).rows[0];
      const sequenceBefore = await sequence();
      await draft.runTransaction(async tx => {
        assert.equal(await allocationLedgerReady(draft, tx), true);
        assert.equal(await periodClosingsReady(draft, tx), true);
        assert.equal(await stockMovesReady(draft, tx), true);
        writeStockMoves(draft, tx, [{
          workspaceId: ws, itemId: `${ws}-item`, date: '2026-02-01', kind: 'opening',
          quantity: 3, quantityBefore: 0, quantityAfter: 3, unitCostCents: 250, valueCents: 750, uid,
        }]);
      });
      const kept = await draft.collection('stockMoves').where('workspaceId', '==', ws).get();
      assert.equal(kept.size, 1);
      assert.equal(kept.docs[0].data().valueCents, 750);
      assert.ok(Number.isSafeInteger(kept.docs[0].data().dbSeq), 'the overlay numbers the draft move provisionally');
      assert.deepEqual(await sequence(), sequenceBefore, 'no live database sequence is advanced');
      assert.equal((await live.collection('stockMoves').where('workspaceId', '==', ws).get()).size, 0);
      assert.equal(await stockMovesReady(live), false, 'the draft did not warm the live stock flag');
    } finally {
      resetStockMovesReadyForTests();
    }
  });

  test('draft writes never reserve an audit head and the uncached live fallback links the next entry', async () => {
    const input = { workspaceId: ws, uid, action: 'test', entityType: 'workspaces', entityId: ws, details: { description: 'Fixture audit' } };
    const first = await writeServerAuditLog(input, { db: live });
    const logs = async (db: Firestore) => (await db.collection('auditLogs').where('workspaceId', '==', ws).orderBy('seq').get()).docs.map(d => d.data());
    const before = await logs(live);
    assert.equal(before.length, 1);
    assert.equal(before[0].id, first);
    assert.equal(before[0].seq, 1);
    assert.equal(await draft.runTransaction(tx => writeServerAuditLog(input, { db: draft, tx })), '');
    assert.equal(await writeServerAuditLog(input, { db: draft }), '');
    assert.deepEqual(await logs(draft), before);
    assert.deepEqual(await logs(live), before);
    // Exercise the compatibility fallback without mocking the scoped query or its result.
    const fallback = { collection: live.collection.bind(live), readRows: live.readRows.bind(live), tableSource: live.tableSource.bind(live) } as unknown as Firestore;
    const second = await writeServerAuditLog(input, { db: fallback });
    const next = await logs(live);
    assert.equal(next.length, 2);
    assert.equal(next[1].id, second);
    assert.equal(next[1].seq, 2);
    assert.equal(next[1].prevHash, before[0].entryHash);
    assert.deepEqual(await logs(draft), next, 'an untouched draft sees the later real audit row');
    assert.deepEqual(verifyAuditHashChain(next as Parameters<typeof verifyAuditHashChain>[0]), { valid: true });
  });

  test('repost refuses a draft while the stock dirty queue is not available on overlays', async t => {
    const collections = t.mock.method(draft, 'collection');
    await assert.rejects(runRepost(draft, { workspaceId: ws, user: { uid }, runId: 'test-repost' }), { status: 409 });
    assert.equal(collections.mock.callCount(), 0);
  });
});
