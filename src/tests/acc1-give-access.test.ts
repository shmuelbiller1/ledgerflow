/**
 * ACC-1: the owner's "Give access" — one email, one level, every workspace that person owns changes, each with
 * an audit line; making them a platform admin is a separate tick.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Firestore } from '../server/db/pgFirestore';
import { GiveAccessSchema, workspaceFieldsFor } from '../server/routes/giveAccessRoutes';

const url = process.env.LF_TEST_DATABASE_URL;

test('each level sets the fields the server already reads (bypassBilling, plan)', () => {
  assert.deepEqual(workspaceFieldsFor('full'), { bypassBilling: true, plan: 'enterprise', accessLevel: 'full' });
  assert.equal(workspaceFieldsFor('tester').bypassBilling, true);
  assert.deepEqual(workspaceFieldsFor('pro'), { bypassBilling: false, plan: 'pro', accessLevel: 'pro' });
  assert.deepEqual(workspaceFieldsFor('none'), { bypassBilling: false, plan: 'free', accessLevel: null });
  assert.equal(GiveAccessSchema.parse({ email: ' Dana@Example.com ', level: 'growth' }).email, 'dana@example.com');
  assert.throws(() => GiveAccessSchema.parse({ email: 'not-an-email', level: 'full' }));
  assert.throws(() => GiveAccessSchema.parse({ email: 'a@b.co', level: 'gold' }));
});

describe('Give access (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const sfx = crypto.randomBytes(4).toString('hex');
  const target = { uid: `dana_${sfx}`, email: `dana_${sfx}@example.com` };
  const ws = [`ws_acc1a_${sfx}`, `ws_acc1b_${sfx}`, `ws_acc1other_${sfx}`];
  let db: Firestore;

  before(async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws[0]).set({ uid: target.uid, name: 'Dana One', plan: 'free', members: [target.uid] });
    await db.collection('workspaces').doc(ws[1]).set({ uid: target.uid, name: 'Dana Two', plan: 'growth', members: [target.uid] });
    await db.collection('workspaces').doc(ws[2]).set({ uid: 'someone-else', name: 'Not Dana', plan: 'free', members: ['someone-else', target.uid] });
  });

  after(async () => {
    for (const id of ws) await db.pool.query('delete from public."workspaces" where id = $1', [id]);
    await db.pool.query('delete from public."users" where id = $1', [target.uid]);
    await db.terminate();
  });

  test('full access: both of her workspaces are free with no limits; one she only belongs to is untouched; audited', async () => {
    const { giveAccess } = await import('../server/routes/giveAccessRoutes');
    const r = await giveAccess(db, { uid: 'admin-1', email: 'admin@ledgerflow.test' }, target, { level: 'full', makeAdmin: true });
    assert.deepEqual(r.workspaces.map(w => w.id).sort(), [ws[0], ws[1]].sort());
    assert.equal(r.madeAdmin, true);
    for (const id of [ws[0], ws[1]]) {
      const d = (await db.collection('workspaces').doc(id).get()).data()!;
      assert.deepEqual([d.bypassBilling, d.plan, d.accessGivenBy], [true, 'enterprise', 'admin@ledgerflow.test']);
    }
    assert.equal((await db.collection('workspaces').doc(ws[2]).get()).data()?.bypassBilling, undefined);
    assert.equal((await db.collection('users').doc(target.uid).get()).data()?.role, 'admin');
    const audit = await db.pool.query(`select count(*)::int as n from public."auditLogs" where data->>'action' = 'ADMIN_ACCESS_GIVEN' and workspace_id = any($1)`, [[ws[0], ws[1]]]);
    assert.equal(audit.rows[0].n, 2);
  });

  test('taking it away: back to Free, free access off', async () => {
    const { giveAccess } = await import('../server/routes/giveAccessRoutes');
    await giveAccess(db, { uid: 'admin-1', email: 'admin@ledgerflow.test' }, target, { level: 'none' });
    const d = (await db.collection('workspaces').doc(ws[1]).get()).data()!;
    assert.deepEqual([d.bypassBilling, d.plan], [false, 'free']);
  });
});
