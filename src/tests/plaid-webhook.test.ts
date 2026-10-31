/**
 * AU-1: Plaid's transactions webhook. A notice is acted on only when its Plaid-Verification JWT is
 * signed by Plaid's published key, is fresh, and hashes to the exact body received; then the named
 * connection syncs from its saved cursor and its new rows become bank lines (as POST /sync does).
 * The DB part runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;

async function signer(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig', created_at: 1, expired_at: null } as JWK;
  const sign = (body: string, iatSeconds = Math.floor(Date.now() / 1000), key = privateKey) =>
    new SignJWT({ request_body_sha256: crypto.createHash('sha256').update(body).digest('hex') })
      .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' }).setIssuedAt(iatSeconds).sign(key);
  return { jwk, sign, privateKey };
}

describe('AU-1: Plaid webhook verification', () => {
  test('a fresh notice signed for this exact body passes; anything else is refused', async () => {
    const { setPlaidClientForTests } = await import('../server/routes/plaidRoutes');
    const { verifyPlaidWebhook, clearPlaidWebhookKeysForTests, PlaidWebhookRejected } = await import('../server/routes/plaidWebhookRoutes');
    const plaid = await signer('kid-verify');
    const other = await generateKeyPair('ES256');
    clearPlaidWebhookKeysForTests();
    setPlaidClientForTests({
      linkTokenCreate: (async () => ({ data: {} })) as never, itemPublicTokenExchange: (async () => ({ data: {} })) as never, transactionsGet: (async () => ({ data: { transactions: [] } })) as never,
      webhookVerificationKeyGet: (async ({ key_id }: { key_id: string }) => {
        assert.equal(key_id, 'kid-verify');
        return { data: { key: plaid.jwk } };
      }) as never,
    });
    const body = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-x' });
    await verifyPlaidWebhook(Buffer.from(body), await plaid.sign(body));
    await assert.rejects(verifyPlaidWebhook(Buffer.from(body), undefined), PlaidWebhookRejected, 'no header');
    await assert.rejects(verifyPlaidWebhook(Buffer.from(body + ' '), await plaid.sign(body)), PlaidWebhookRejected, 'body changed after signing');
    await assert.rejects(verifyPlaidWebhook(Buffer.from(body), await plaid.sign(body, undefined, other.privateKey)), PlaidWebhookRejected, 'signed by someone else');
    await assert.rejects(verifyPlaidWebhook(Buffer.from(body), await plaid.sign(body, Math.floor(Date.now() / 1000) - 10 * 60)), PlaidWebhookRejected, 'older than five minutes');
  });
});

describe('AU-1: a verified SYNC_UPDATES_AVAILABLE notice syncs that connection', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const ws = `ws_au1_${suffix}`;
  const bankId = `bank_au1_${suffix}`;
  const itemId = `item_au1_${suffix}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  let plaid: Awaited<ReturnType<typeof signer>>;

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { setPlaidClientForTests } = await import('../server/routes/plaidRoutes');
    const { registerPlaidWebhookRoutes, clearPlaidWebhookKeysForTests } = await import('../server/routes/plaidWebhookRoutes');
    const { getDb } = await import('../server/db/firestore');
    const { SecurityService } = await import('../services/securityService');
    db = getDb();
    plaid = await signer('kid-db');
    clearPlaidWebhookKeysForTests();
    setPlaidClientForTests({
      linkTokenCreate: (async () => ({ data: {} })) as never, itemPublicTokenExchange: (async () => ({ data: {} })) as never, transactionsGet: (async () => ({ data: { transactions: [] } })) as never,
      webhookVerificationKeyGet: (async () => ({ data: { key: plaid.jwk } })) as never,
      transactionsSync: (async ({ cursor }: { cursor?: string }) => ({
        data: cursor ? { added: [], modified: [], removed: [], next_cursor: cursor, has_more: false }
          : { added: [{ transaction_id: `tx-${suffix}`, date: '2026-10-30', name: 'Webhook coffee', amount: 3 }], modified: [], removed: [], next_cursor: 'c-after-webhook', has_more: false },
      })) as never,
    });
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'AU-1', members: ['owner-1'], currency: 'USD' });
    await db.collection('banks').doc(bankId).set({ workspaceId: ws, item_id: itemId, access_token: SecurityService.encryptSensitiveField('access-au1'), institutionName: 'AU Bank', accountId: 'acc-checking', status: 'active' });
    const app = express();
    registerPlaidWebhookRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['banks', 'bankLines', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  const post = async (body: string, token?: string) => {
    const res = await fetch(`${base}/api/webhook/plaid`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'plaid-verification': token } : {}) }, body });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  test('an unsigned notice is refused and nothing is synced', async () => {
    const body = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: itemId });
    assert.equal((await post(body)).status, 401);
    assert.equal((await db.collection('bankLines').where('workspaceId', '==', ws).get()).size, 0);
  });

  test('a signed notice syncs the connection: the row becomes a bank line and the cursor moves', async () => {
    const body = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: itemId });
    const r = await post(body, await plaid.sign(body));
    assert.equal(r.status, 200);
    assert.equal(r.body.synced, 1);
    const lines = (await db.collection('bankLines').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
    assert.deepEqual(lines.map(l => [l.description, l.amountCents, l.uid]), [['Webhook coffee', -300, 'plaid-webhook']]);
    assert.equal((await db.collection('banks').doc(bankId).get()).data()?.syncCursor, 'c-after-webhook');
    // the same notice again is harmless: the cursor has moved, nothing new is stored
    const again = await post(body, await plaid.sign(body));
    assert.equal(again.status, 200);
    assert.equal((await db.collection('bankLines').where('workspaceId', '==', ws).get()).size, 1);
  });

  test('other notices are acknowledged without a sync', async () => {
    const body = JSON.stringify({ webhook_type: 'ITEM', webhook_code: 'WEBHOOK_UPDATE_ACKNOWLEDGED', item_id: itemId });
    const r = await post(body, await plaid.sign(body));
    assert.deepEqual([r.status, r.body.synced], [200, 0]);
  });
});
