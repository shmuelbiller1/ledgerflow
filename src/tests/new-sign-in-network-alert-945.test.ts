/**
 * #945 / S-13: a sign-in from an IP the person never signed in from before puts a notice in
 * their bell; the first sign-in and repeat networks do not. Runs on the migrated test database.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Firestore } from '../server/db/pgFirestore';
import { recordAuthEvent } from '../server/services/authAuditService';

const url = process.env.LF_TEST_DATABASE_URL;
const suffix = randomBytes(6).toString('hex');
const workspaceId = `ws_s13_${suffix}`;
const uid = `u_s13_${suffix}`;
const otherUid = `u_s13_other_${suffix}`;

describe('S-13 new-network sign-in alert', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let db: Firestore;
  before(async () => {
    db = new Firestore({ connectionString: url, max: 4 });
    await db.collection('workspaces').doc(workspaceId).set({
      id: workspaceId, name: 'S-13 test', uid, members: [uid, otherUid],
      memberRoles: { [uid]: 'owner', [otherUid]: 'accountant' },
    });
  });
  after(async () => {
    if (!db) return;
    for (const doc of (await db.collection('notifications').where('workspaceId', '==', workspaceId).get()).docs) await doc.ref.delete();
    for (const doc of (await db.collection('loginAudits').where('uid', '==', uid).get()).docs) await doc.ref.delete();
    for (const doc of (await db.collection('auditLogs').where('workspaceId', '==', workspaceId).get()).docs) await doc.ref.delete();
    await db.collection('workspaces').doc(workspaceId).delete();
    await db.terminate();
  });

  const signIn = (ip: string, at: string) =>
    recordAuthEvent({ uid, event: 'login', workspaceId, ip, timestamp: at }, db);
  const notices = async () =>
    (await db.collection('notifications').where('workspaceId', '==', workspaceId).get()).docs.map(d => d.data());

  test('first sign-in and a repeat network do not alert; a new network alerts only that person, once', async () => {
    assert.ok(await signIn('203.0.113.10', '2026-11-20T09:00:00.000Z'));
    assert.equal((await notices()).length, 0, 'the first sign-in has nothing to compare with');

    await signIn('203.0.113.10', '2026-11-21T09:00:00.000Z');
    assert.equal((await notices()).length, 0, 'a known network does not alert');

    await signIn('198.51.100.7', '2026-11-22T09:00:00.000Z');
    const after = await notices();
    assert.equal(after.length, 1);
    assert.equal(after[0].uid, uid, 'only the person who signed in is told');
    assert.equal(after[0].kind, 'security.new_sign_in');
    assert.match(String(after[0].message), /198\.51\.100\.7/);

    await signIn('198.51.100.7', '2026-11-22T10:00:00.000Z');
    assert.equal((await notices()).length, 1, 'the same new network is not told twice');
  });

  test('a network last used long ago (beyond any recent window) is still known', async () => {
    for (let i = 0; i < 205; i++) {
      await db.collection('loginAudits').doc(`s13_bulk_${suffix}_${i}`).set({
        id: `s13_bulk_${suffix}_${i}`, uid, event: 'login', ip: '192.0.2.50', userAgent: 'test', email: '', metadata: {},
        timestamp: `2026-11-23T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
      });
    }
    const before = (await notices()).length;
    await signIn('203.0.113.10', '2026-11-24T09:00:00.000Z');
    assert.equal((await notices()).length, before, 'the first network is still known after 200+ later sign-ins');
  });

  test('an unknown IP never alerts', async () => {
    const before = (await notices()).length;
    await signIn('unknown', '2026-11-22T11:00:00.000Z');
    assert.equal((await notices()).length, before);
  });
});
