/**
 * Workspace restore (src/server/services/workspaceRestoreService.ts) against a real database.
 * Runs when LF_TEST_DATABASE_URL is set; skipped otherwise.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { Firestore } from '../server/db/pgFirestore';
import { RestoreError, restoreWorkspaceBackup } from '../server/services/workspaceRestoreService';

const url = process.env.LF_TEST_DATABASE_URL;
const suffix = crypto.randomBytes(4).toString('hex');
const ws = `ws_restore_${suffix}`;
const other = `ws_other_${suffix}`;

describe('Workspace restore', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let db: Firestore;

  before(async () => {
    db = new Firestore({ connectionString: url, max: 4 });
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Mine', plan: 'starter', roles: { 'v-1': 'viewer' } });
    await db.collection('workspaces').doc(other).set({ uid: 'owner-2', name: 'Theirs' });
    await db.collection('customers').doc(`${ws}_old`).set({ workspaceId: ws, name: 'Old customer' });
    await db.collection('customers').doc(`${other}_c1`).set({ workspaceId: other, name: 'Their customer' });
  });

  after(async () => {
    for (const table of ['customers', 'invoices', 'transactions', 'chartAccounts', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id in ($1, $2) or id in ($1, $2)`, [ws, other]);
    }
    await db.terminate();
  });

  test('replaces the workspace records and keeps them in this workspace', async () => {
    const result = await restoreWorkspaceBackup(db, ws, {
      schemaVersion: 1,
      workspace: { id: ws, name: 'Restored name' },
      customers: [{ id: `${ws}_c1`, name: 'Acme', workspaceId: 'someone-else' }],
      accounts: [{ id: `${ws}_cash`, name: 'Cash', type: 'asset' }],
      transactions: [],
    });
    assert.deepEqual(result.counts, { customers: 1, chartAccounts: 1 });
    assert.equal((await db.collection('customers').doc(`${ws}_old`).get()).exists, false);
    const restored = (await db.collection('customers').doc(`${ws}_c1`).get()).data();
    assert.equal(restored?.workspaceId, ws);
    assert.equal((await db.collection('workspaces').doc(ws).get()).data()?.name, 'Restored name');
  });

  test('A8N-03 (#776): a file the browser built when the server export failed is refused, and deletes nothing', async () => {
    await assert.rejects(restoreWorkspaceBackup(db, ws, {
      workspace: { id: ws, name: 'Partial' },
      customers: [],
      metadata: { serverAuthoritative: false },
    }), (err: unknown) => err instanceof RestoreError && err.status === 400 && /saved by the browser/.test(err.message));
    assert.equal((await db.collection('customers').doc(`${ws}_c1`).get()).exists, true, 'nothing was deleted');
    assert.equal((await db.collection('workspaces').doc(ws).get()).data()?.name, 'Restored name');
  });

  test('A8N-02 (#777): with a month closed, an unsigned backup is refused even when it adds an entry to the closed month', async () => {
    await db.collection('workspaces').doc(ws).update({ lockDate: '2026-05-31' });
    try {
      await assert.rejects(restoreWorkspaceBackup(db, ws, {
        workspace: { id: ws, name: 'Forged', lockDate: '2026-05-31' },
        transactions: [{ id: `${ws}_may`, date: '2026-05-28', status: 'completed', description: 'new expense in a closed month',
          lines: [{ accountId: 'exp', amountCents: 500000 }, { accountId: 'cash', amountCents: -500000 }] }],
      }), (err: unknown) => err instanceof RestoreError && err.status === 409 && /only a backup exported by LedgerFlow/.test(err.message));
      assert.equal((await db.collection('transactions').doc(`${ws}_may`).get()).exists, false);
    } finally {
      await db.collection('workspaces').doc(ws).update({ lockDate: '' });
    }
  });

  test('AUD-02: refuses an unbalanced ledger entry in the backup, and changes nothing', async () => {
    await assert.rejects(restoreWorkspaceBackup(db, ws, {
      workspace: { id: ws, name: 'Broken' },
      customers: [{ id: `${ws}_c9`, name: 'Would be added' }],
      transactions: [{ id: `${ws}_bad`, date: '2026-03-01', status: 'completed', lines: [{ accountId: 'a', amountCents: 10000 }, { accountId: 'b', amountCents: -9000 }] }],
    }), (err: unknown) => err instanceof RestoreError && err.status === 400 && /not a valid ledger entry/.test(err.message));
    assert.equal((await db.collection('transactions').doc(`${ws}_bad`).get()).exists, false);
    assert.equal((await db.collection('customers').doc(`${ws}_c9`).get()).exists, false);
    assert.equal((await db.collection('customers').doc(`${ws}_c1`).get()).exists, true, 'the previous restore is untouched');
    assert.equal((await db.collection('workspaces').doc(ws).get()).data()?.name, 'Restored name');
  });

  test('refuses a record id that belongs to another workspace, and changes nothing', async () => {
    await assert.rejects(restoreWorkspaceBackup(db, ws, {
      workspace: { id: ws, name: 'Hijack' },
      customers: [{ id: `${ws}_c2`, name: 'Fine' }, { id: `${other}_c1`, name: 'Taken over' }],
    }), (err: unknown) => err instanceof RestoreError && err.status === 409);
    assert.equal((await db.collection('customers').doc(`${other}_c1`).get()).data()?.name, 'Their customer');
    assert.equal((await db.collection('customers').doc(`${other}_c1`).get()).data()?.workspaceId, other);
    assert.equal((await db.collection('customers').doc(`${ws}_c1`).get()).exists, true);
    assert.equal((await db.collection('customers').doc(`${ws}_c2`).get()).exists, false);
    assert.equal((await db.collection('workspaces').doc(ws).get()).data()?.name, 'Restored name');
  });

  test('never restores ownership, roles or billing fields', async () => {
    await restoreWorkspaceBackup(db, ws, {
      workspace: {
        id: ws, uid: 'attacker', name: 'Renamed', plan: 'enterprise', bypassBilling: true,
        computeCreditBalance: 999999, roles: { attacker: 'owner' }, members: ['attacker'],
      },
    });
    const data = (await db.collection('workspaces').doc(ws).get()).data();
    assert.equal(data?.name, 'Renamed');
    assert.equal(data?.uid, 'owner-1');
    assert.equal(data?.plan, 'starter');
    assert.equal(data?.bypassBilling, undefined);
    assert.equal(data?.computeCreditBalance, undefined);
    assert.deepEqual(data?.roles, { 'v-1': 'viewer' });
    assert.equal(data?.members, undefined);
  });

  test('AUD-02: a document whose fields have the wrong type refuses the backup; a valid one keeps fields no schema knows', async () => {
    await assert.rejects(restoreWorkspaceBackup(db, ws, {
      invoices: [{ id: `${ws}_bad`, status: 'sent', amountCents: '100' }],
    }), (err: unknown) => err instanceof RestoreError && err.status === 400 && /invoices\/.*_bad is not a valid invoice \(amountCents/.test(err.message));
    assert.equal((await db.collection('invoices').doc(`${ws}_bad`).get()).exists, false);
    await restoreWorkspaceBackup(db, ws, {
      invoices: [{ id: `${ws}_good`, status: 'unpaid-legacy', amountCents: 100, someLaterField: 'kept' }],
    });
    const good = (await db.collection('invoices').doc(`${ws}_good`).get()).data();
    assert.equal(good?.someLaterField, 'kept');
    assert.equal(good?.status, 'unpaid-legacy');
  });

  test('rejects malformed backups', async () => {
    for (const bad of [null, 'text', { workspace: { id: other } }, { schemaVersion: 2 },
      { customers: 'not-a-list' }, { customers: [42] }, { customers: [{ id: 'a/b' }] }]) {
      await assert.rejects(restoreWorkspaceBackup(db, ws, bad), (err: unknown) => err instanceof RestoreError && err.status === 400);
    }
  });

  test('AUD-07: refuses a backup older than the current closed period without changing records', async () => {
    // Seed this test's own preconditions; do not rely on earlier tests' restore state.
    await db.collection('workspaces').doc(ws).set({ name: 'Restored name', lockDate: '2026-09-30' }, { merge: true });
    await db.collection('customers').doc(`${ws}_c1`).set({ workspaceId: ws, name: 'Existing customer for AUD-07' });
    const existing = await db.collection('customers').doc(`${ws}_c1`).get();
    assert.equal(existing.exists, true, 'precondition: this test seeded the current customer');

    // A backup without a close date is older than the current closed books.
    await assert.rejects(restoreWorkspaceBackup(db, ws, {
      workspace: { id: ws, name: 'Must not replace closed books' },
      customers: [{ id: `${ws}_replacement`, name: 'Must not be written' }],
    }), (err: unknown) => err instanceof RestoreError && err.status === 409 && /Books are closed through 2026-09-30/.test(err.message));

    // A dated backup is also refused when it predates the current lock date.
    await assert.rejects(restoreWorkspaceBackup(db, ws, {
      workspace: { id: ws, name: 'Also must not replace closed books', lockDate: '2026-08-31' },
      customers: [{ id: `${ws}_replacement`, name: 'Must not be written' }],
    }), (err: unknown) => err instanceof RestoreError && err.status === 409 && /can't replace the months closed since/.test(err.message));

    assert.equal((await db.collection('customers').doc(`${ws}_c1`).get()).exists, true,
      'refused restore preserves the existing customer');
    assert.equal((await db.collection('customers').doc(`${ws}_replacement`).get()).exists, false,
      'refused restore writes no replacement customer');
    assert.equal((await db.collection('workspaces').doc(ws).get()).data()?.name, 'Restored name',
      'refused restore preserves workspace settings');
    await db.collection('workspaces').doc(ws).set({ lockDate: null }, { merge: true });
  });
});

test('the restore endpoint is owner-only', async () => {
  const { serverSource } = await import('./helpers/serverSource');
  const server = serverSource();
  assert.match(server, /app\.post\("\/api\/v1\/workspaces\/:workspaceId\/restore", apiAuthenticate, requireWorkspaceRole\(\['owner'\]\)/);
});
