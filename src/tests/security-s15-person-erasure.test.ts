import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  chainAuditEntries,
  maskErasedPersonInAuditEntry,
  pseudonymiseEmailAddress,
  pseudonymisePersonTag,
  verifyAuditHashChain,
} from '../lib/auditHashChain';
import { getDb } from '../server/db/firestore';
import { AccountDeletionBlocked, deleteAccount } from '../server/services/accountDeletionService';
import { buildAuditLogRecord, verifyAuditHashChain as verifyServerAuditHashChain } from '../server/services/auditLogService';

const hasTestDb = Boolean(process.env.LF_TEST_DATABASE_URL);
const TEST_SALT = process.env.SYSTEM_SALT || 'test-ledgerflow-salt-32b-deterministic';

test('S-15: pseudonymiseEmailAddress is deterministic per uid+salt and reveals no raw PII', () => {
  const uid = crypto.randomUUID();
  const a1 = pseudonymiseEmailAddress(uid, TEST_SALT);
  const a2 = pseudonymiseEmailAddress(uid, TEST_SALT);
  const other = pseudonymiseEmailAddress(crypto.randomUUID(), TEST_SALT);

  assert.equal(a1, a2);
  assert.notEqual(a1, other);
  assert.match(a1, /^erased-[0-9a-f]{12}@redacted\.invalid$/);
  assert.equal(pseudonymisePersonTag(uid, TEST_SALT).startsWith('erased-'), true);
});

test('S-15: top-level email pseudonymisation preserves SHA-256 client & server audit hash chains, and display masking redacts details PII', () => {
  const uid = crypto.randomUUID();
  const rawEmail = 'alice.bookkeeper@example.test';
  const rawEntries = [
    {
      id: 'aud_1',
      workspaceId: 'ws_s15',
      uid,
      email: rawEmail,
      userEmail: rawEmail,
      actorEmail: rawEmail,
      action: 'TRANSACTION_CREATED',
      entityType: 'transaction',
      entityId: 'tx_1',
      timestamp: '2026-11-19T10:00:00.000Z',
      details: { description: `Posted entry by ${rawEmail}`, amountCents: 1200 },
    },
    {
      id: 'aud_2',
      workspaceId: 'ws_s15',
      uid,
      email: rawEmail,
      userEmail: rawEmail,
      actorEmail: rawEmail,
      action: 'MEMBER_LEFT',
      entityType: 'workspace',
      entityId: 'ws_s15',
      timestamp: '2026-11-19T10:05:00.000Z',
      details: { description: 'Left the workspace when deleting their account' },
    },
  ];

  // Build hash-chained entries identically to server auditLogService + client auditHashChain
  const chained = chainAuditEntries(rawEntries);
  const serverRecord1 = buildAuditLogRecord(
    {
      workspaceId: 'ws_s15',
      uid,
      email: rawEmail,
      action: 'TRANSACTION_CREATED',
      entityType: 'transaction',
      entityId: 'tx_1',
      timestamp: '2026-11-19T10:00:00.000Z',
      details: { description: `Posted entry by ${rawEmail}`, amountCents: 1200 },
    },
    'aud_1',
    { seq: 1, prevHash: '0'.repeat(64) },
  );
  const serverRecord2 = buildAuditLogRecord(
    {
      workspaceId: 'ws_s15',
      uid,
      email: rawEmail,
      action: 'MEMBER_LEFT',
      entityType: 'workspace',
      entityId: 'ws_s15',
      timestamp: '2026-11-19T10:05:00.000Z',
      details: { description: 'Left the workspace when deleting their account' },
    },
    'aud_2',
    { seq: 2, prevHash: serverRecord1.entryHash },
  );

  // Top-level email pseudonymisation (for storage update without touching details) preserves BOTH chains!
  const pseudoEmail = pseudonymiseEmailAddress(uid, TEST_SALT);
  const storagePseudonymised = chained.map(e => ({ ...e, email: pseudoEmail, userEmail: pseudoEmail, actorEmail: pseudoEmail }));
  assert.equal(verifyAuditHashChain(storagePseudonymised).valid, true);

  const serverPseudonymised = [serverRecord1, serverRecord2].map(r => ({
    ...r,
    email: pseudoEmail,
    userEmail: pseudoEmail,
    actorEmail: pseudoEmail,
  }));
  assert.equal(verifyServerAuditHashChain(serverPseudonymised).valid, true);

  // Read/export masking removes raw email even inside details.description without mutating stored DB rows.
  const maskedForDisplay = storagePseudonymised.map(e =>
    maskErasedPersonInAuditEntry(e, { uid, originalEmail: rawEmail, salt: TEST_SALT }),
  );
  assert.equal(JSON.stringify(maskedForDisplay).includes(rawEmail), false);
  assert.match(String(maskedForDisplay[0].details?.description), /erased-[0-9a-f]{12}@redacted\.invalid/);
});

test('S-15 (Postgres): deleteAccount removes personal collections, blocks sole-owner shared books, and documents residual auditLogs email gap', { skip: !hasTestDb }, async () => {
  const prevDbUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
  const db = getDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const aliceUid = crypto.randomUUID();
  const bobUid = crypto.randomUUID();
  const aliceEmail = `alice.${suffix}@example.test`;
  const soloWsId = `ws_s15_solo_${suffix}`;
  const sharedWsId = `ws_s15_shared_${suffix}`;
  const now = new Date().toISOString();

  await db.pool.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
     values ($1::uuid, $2, now(), '{}'::jsonb), ($3::uuid, $4, now(), '{}'::jsonb)`,
    [aliceUid, aliceEmail, bobUid, `bob.${suffix}@example.test`],
  );

  try {
    // 1. Sole-owner shared workspace blocks deletion until ownership is transferred
    await db.collection('workspaces').doc(sharedWsId).set({
      id: sharedWsId,
      name: 'Shared S15 Books',
      uid: aliceUid,
      members: [aliceUid, bobUid],
      roles: { [aliceUid]: 'owner', [bobUid]: 'bookkeeper' },
      createdAt: now,
    });
    await assert.rejects(
      () => deleteAccount(db, { uid: aliceUid, email: aliceEmail }, async () => {}),
      err => err instanceof AccountDeletionBlocked && err.workspaces.some(w => w.id === sharedWsId),
    );

    // 2. Promote Bob to co-owner and also add a solo workspace + personal collections
    await db.collection('workspaces').doc(sharedWsId).update({
      roles: { [aliceUid]: 'owner', [bobUid]: 'owner' },
    });
    await db.collection('workspaces').doc(soloWsId).set({
      id: soloWsId,
      name: 'Solo S15 Books',
      uid: aliceUid,
      members: [aliceUid],
      roles: { [aliceUid]: 'owner' },
      createdAt: now,
    });
    await db.collection('users').doc(aliceUid).set({ uid: aliceUid, email: aliceEmail, role: 'client', createdAt: now });
    await db.collection('recoveryCodes').doc(aliceUid).set({ uid: aliceUid, hashes: ['h1'], updatedAt: now });
    await db.collection('notifications').doc(`notif_${suffix}`).set({ id: `notif_${suffix}`, uid: aliceUid, workspaceId: soloWsId, message: 'hi', createdAt: now });
    await db.collection('loginAudits').doc(`login_${suffix}`).set({ id: `login_${suffix}`, uid: aliceUid, email: aliceEmail, event: 'login', timestamp: now });

    let deletedAuthUid = '';
    const result = await deleteAccount(db, { uid: aliceUid, email: aliceEmail }, async uid => {
      deletedAuthUid = uid;
    });

    assert.equal(deletedAuthUid, aliceUid);
    assert.deepEqual(result.scheduledForDeletion, [soloWsId]);
    assert.deepEqual(result.left, [sharedWsId]);
    assert.equal((await db.collection('users').doc(aliceUid).get()).exists, false);
    assert.equal((await db.collection('recoveryCodes').doc(aliceUid).get()).exists, false);
    assert.equal((await db.collection('notifications').doc(`notif_${suffix}`).get()).exists, false);
    assert.equal((await db.collection('loginAudits').doc(`login_${suffix}`).get()).exists, false);

    // Confirm current behavior: auditLogs retains raw actor email (tracked for AI #1 pseudonymisation follow-up)
    const auditSnap = await db.collection('auditLogs').where('workspaceId', '==', soloWsId).get();
    assert.equal(auditSnap.docs.length >= 1, true);
    const deletionAudit = auditSnap.docs.map(d => d.data()).find(d => d.action === 'WORKSPACE_DELETION_SCHEDULED');
    assert.ok(deletionAudit);
    assert.equal(deletionAudit.email, aliceEmail);
  } finally {
    await db.pool.query(`delete from public."auditLogs" where workspace_id in ($1, $2)`, [soloWsId, sharedWsId]);
    await db.pool.query(`delete from public.workspaces where id in ($1, $2)`, [soloWsId, sharedWsId]);
    await db.pool.query(`delete from public.users where id = $1`, [aliceUid]);
    await db.pool.query(`delete from auth.users where id in ($1::uuid, $2::uuid)`, [aliceUid, bobUid]);
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDbUrl;
  }
});
