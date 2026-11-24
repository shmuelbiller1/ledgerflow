/**
 * S-42: assistant scopes. One test per case, against the real app (`createApp`) on real PostgreSQL:
 *  1. a viewer's assistant token cannot draft;
 *  2. a bookkeeper's assistant token cannot draft an owner-only command;
 *  3. a workspace API key cannot call the assistant turn route (either door);
 *  4. an expired token or a closed sandbox is refused.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from './helpers/liveApiServer';
import { startAssistantFixture } from './helpers/assistantTurnHarness';

const passThrough: import('express').RequestHandler = (_req, _res, next) => next();

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);

describe('S-42: assistant scopes are enforced on every door', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL', timeout: 120_000 }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const ownerA = crypto.randomUUID();
  const userV = crypto.randomUUID();
  const ownerB = crypto.randomUUID();
  const userK = crypto.randomUUID();
  const uids = [ownerA, userV, ownerB, userK];
  const wsA = `s42-ws-a-${tag}`;
  const wsB = `s42-ws-b-${tag}`;
  const bankB = `s42-bank-${tag}`;
  let jwtUserV = '';
  let jwtOwnerB = '';
  let jwtUserK = '';
  let apiKeyFull = '';
  let server: Server | undefined;
  let base = '';
  let prevEnv: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;
  let tokenV = '';
  let tokenK = '';
  let sandboxV = '';
  let sandboxK = '';
  let sandboxK2 = '';

  const api = (method: string, path: string, token: string, body?: unknown) =>
    callApi(base, method, path, { token, body, alwaysJson: true });

  before(async () => {
    prevEnv = useLiveApiEnv('s42-scopes', { RATE_LIMIT_HIGH: '1' });
    const [{ getDb }, { createApp }, { API_KEY_SCOPE_IDS }, { issueAssistantToken }] = await Promise.all([
      import('../server/db/firestore'),
      import('../../server'),
      import('../lib/apiScopes'),
      import('../server/auth/assistantToken'),
    ]);
    db = getDb();
    for (const uid of uids) {
      await db.pool.query(
        `insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)`,
        [uid, `${uid}@s42.test`],
      );
    }
    const now = new Date().toISOString();
    for (const [id, uid, members, roles] of [
      [wsA, ownerA, [ownerA, userV], { [userV]: 'bookkeeper' }],
      [wsB, ownerB, [ownerB, userK], { [userK]: 'bookkeeper' }],
    ] as const) {
      await db.collection('workspaces').doc(id).set({
        id, name: 'S42 books', uid, members: [...members], roles: { ...roles },
        currency: 'USD', timezone: 'UTC', plan: 'pro', bypassBilling: true, createdAt: now,
      });
    }
    await db.collection('chartAccounts').doc(bankB).set({ id: bankB, workspaceId: wsB, name: 'Bank', type: 'asset', category: 'Cash', createdAt: now });
    await db.collection('customers').doc(`s42-cust-${tag}`).set({
      id: `s42-cust-${tag}`, workspaceId: wsB, name: 'Acme Design', email: 'billing@acme.test', balanceCents: 0, createdAt: now,
    });

    const keyId = `lf_id_${wsB}_${crypto.randomBytes(8).toString('hex')}`;
    const rawSecret = crypto.randomBytes(32).toString('hex');
    apiKeyFull = `${keyId}.${rawSecret}`;
    await db.collection('apiKeys').doc(keyId).set({
      id: keyId, workspaceId: wsB, uid: ownerB, name: 'S42 integration key',
      keyHash: crypto.createHash('sha256').update(rawSecret).digest('hex'),
      scopes: [...API_KEY_SCOPE_IDS], expiresAt: 'never', rateLimitPerMinute: 1000, createdAt: now,
    });

    jwtOwnerB = await signTestJwt({ uid: ownerB, email: `${ownerB}@s42.test`, aal: 'aal2' });
    jwtUserV = await signTestJwt({ uid: userV, email: `${userV}@s42.test`, aal: 'aal2' });
    jwtUserK = await signTestJwt({ uid: userK, email: `${userK}@s42.test`, aal: 'aal2' });

    const app = await createApp();
    ({ server, base } = await listenOnRandomPort({ listen: (port, host, cb) => app.listen(port, host, cb) }));

    // Case 1's sandbox (opened while userV is still a bookkeeper) and case 2/4's sandboxes.
    const openV = await api('POST', `/api/v1/workspaces/${wsA}/sandboxes`, jwtUserV);
    assert.equal(openV.status, 201, JSON.stringify(openV.json));
    sandboxV = (openV.json as { sandbox: { id: string } }).sandbox.id;
    const openK = await api('POST', `/api/v1/workspaces/${wsB}/sandboxes`, jwtUserK);
    assert.equal(openK.status, 201, JSON.stringify(openK.json));
    sandboxK = (openK.json as { sandbox: { id: string } }).sandbox.id;
    const openK2 = await api('POST', `/api/v1/workspaces/${wsB}/sandboxes`, jwtUserK);
    assert.equal(openK2.status, 201, JSON.stringify(openK2.json));
    sandboxK2 = (openK2.json as { sandbox: { id: string } }).sandbox.id;

    // Case 2's token: issued to a bookkeeper, while they are a bookkeeper.
    const issuedK = await api('POST', `/api/v1/workspaces/${wsB}/sandboxes/${sandboxK}/token`, jwtUserK);
    assert.equal(issuedK.status, 200, JSON.stringify(issuedK.json));
    tokenK = (issuedK.json as { assistant: { token: string } }).assistant.token;

    // Case 4's expired token: minted with the issuing code, but two hours ago.
    const expired = issueAssistantToken(
      { sandboxId: sandboxK, personId: userK, workspaceId: wsB, role: 'bookkeeper', aal: 'aal2' },
      Date.now() - 2 * 60 * 60 * 1000,
    );
    const refusedExpired = await callApi(base, 'GET', `/api/v1/sandboxes/${sandboxK}/tools`, { token: expired.token, alwaysJson: true });
    assert.equal(refusedExpired.status, 401, JSON.stringify(refusedExpired.json));
    assert.equal((refusedExpired.json as Record<string, unknown>).code, 'ASSISTANT_TOKEN_INVALID');
  });

  after(async () => {
    await closeServer(server);
    await db.pool.query(`delete from sandbox.sandboxes where workspace_id in ($1, $2)`, [wsA, wsB]);
    for (const table of ['workspaces', 'chartAccounts', 'customers', 'apiKeys']) {
      await db.pool.query(`delete from public."${table}" where workspace_id in ($1, $2)`, [wsA, wsB]);
    }
    for (const uid of uids) await db.pool.query('delete from auth.users where id = $1::uuid', [uid]);
    await db.pool.query('delete from public."billingLedgerTraces" where workspace_id in ($1, $2)', [wsA, wsB]);
    restoreEnv(prevEnv);
  });

  it('case 1: a viewer\'s assistant token cannot draft', async () => {
    // demote the sandbox's person to viewer, then mint their token the real way: its role claim is viewer
    const workspace = (await db.collection('workspaces').doc(wsA).get()).data()!;
    await db.collection('workspaces').doc(wsA).set({ ...workspace, roles: { ...workspace.roles, [userV]: 'viewer' } });
    const issued = await api('POST', `/api/v1/workspaces/${wsA}/sandboxes/${sandboxV}/token`, jwtUserV);
    assert.equal(issued.status, 200, JSON.stringify(issued.json));
    tokenV = (issued.json as { assistant: { token: string } }).assistant.token;

    const tools = await callApi(base, 'GET', `/api/v1/sandboxes/${sandboxV}/tools`, { token: tokenV, alwaysJson: true });
    assert.equal(tools.status, 200, JSON.stringify(tools.json));
    const names = ((tools.json as { tools: Array<{ functionDeclarations: Array<{ name: string }> }> }).tools[0].functionDeclarations)
      .map(tool => tool.name);
    assert.ok(!names.some(name => name.startsWith('propose_')), `viewer's token offered drafting tools: ${names.join(', ')}`);

    const draft = await callApi(base, 'POST', `/api/v1/sandboxes/${sandboxV}/steps`, {
      token: tokenV, alwaysJson: true,
      body: { command: 'payment.receive', input: { amountCents: 100, cashAccountId: 'any', allocations: [] } },
    });
    assert.equal(draft.status, 403, JSON.stringify(draft.json));
    assert.equal((draft.json as Record<string, unknown>).code, 'ROLE_REQUIRED');
    // even the review door needs live write access, and the failed attempt left no step behind
    const state = await callApi(base, 'GET', `/api/v1/sandboxes/${sandboxV}`, { token: tokenV, alwaysJson: true });
    assert.equal(state.status, 403, JSON.stringify(state.json));
    const { rows } = await db.pool.query('select count(*)::int as n from sandbox."sandboxSteps" where sandbox_id = $1', [sandboxV]);
    assert.equal(rows[0].n, 0, 'nothing was drafted');
  });

  it('case 2: a bookkeeper\'s assistant token cannot draft an owner-only command', async () => {
    const tools = await callApi(base, 'GET', `/api/v1/sandboxes/${sandboxK}/tools`, { token: tokenK, alwaysJson: true });
    assert.equal(tools.status, 200, JSON.stringify(tools.json));
    const names = ((tools.json as { tools: Array<{ functionDeclarations: Array<{ name: string }> }> }).tools[0].functionDeclarations)
      .map(tool => tool.name);
    assert.ok(!names.includes('propose_inventory_stockpolicy'), 'an owner-only command is not offered to a bookkeeper');

    const draft = await callApi(base, 'POST', `/api/v1/sandboxes/${sandboxK}/steps`, {
      token: tokenK, alwaysJson: true,
      body: { command: 'inventory.stockpolicy', input: {} },
    });
    assert.equal(draft.status, 403, JSON.stringify(draft.json));
    assert.equal((draft.json as Record<string, unknown>).code, 'ROLE_REQUIRED');
    assert.match(String((draft.json as Record<string, unknown>).message), /outside the role granted to this assistant token/);
  });

  it('case 3: a workspace API key cannot call the assistant turn route', async t => {
    // the real app refuses at the API-key scope gate before any handler runs (workspace changes are
    // for people, so no key is issued the write:workspaces scope these POST routes require)
    for (const path of [
      `/api/v1/workspaces/${wsB}/sandboxes/assistant/turn`,
      `/api/v1/workspaces/${wsB}/sandboxes/${sandboxK}/assistant/turn`,
    ]) {
      const refused = await callApi(base, 'POST', path, { token: apiKeyFull, alwaysJson: true, body: { question: 'Find customer Acme Design' } });
      assert.equal(refused.status, 403, `${path}: ${JSON.stringify(refused.json)}`);
      const body = refused.json as { code?: string; message?: string };
      assert.ok(body.code === 'PERSON_ONLY' || /scope/.test(body.message ?? ''), `${path}: ${JSON.stringify(refused.json)}`);
    }
    // defense in depth: the handler itself refuses a key-marked caller (PERSON_ONLY) behind that gate
    const f = await startAssistantFixture(t, { turnRateLimit: passThrough });
    for (const path of [`/assistant/turn`, `/${f.sandboxId}/assistant/turn`]) {
      const refused = await f.person('POST', path, { question: 'Find customer Acme Design' },
        { 'x-test-uid': f.owner, 'x-test-apikey': '1' });
      assert.equal(refused.status, 403, JSON.stringify(refused.json));
      assert.equal(refused.json.code, 'PERSON_ONLY');
    }
    // the same routes answer the person (non-vacuous): a code-path question needs no model
    const asPerson = await api('POST', `/api/v1/workspaces/${wsB}/sandboxes/assistant/turn`, jwtOwnerB, { question: 'Find customer Acme Design' });
    assert.equal(asPerson.status, 200, JSON.stringify(asPerson.json));
    assert.equal((asPerson.json as Record<string, unknown>).path, 'code');
  });

  it('case 4: a closed sandbox is refused to its own assistant token and its person', async () => {
    const review = await api('GET', `/api/v1/workspaces/${wsB}/sandboxes/${sandboxK2}`, jwtUserK);
    assert.equal(review.status, 200, JSON.stringify(review.json));
    const issued = await api('POST', `/api/v1/workspaces/${wsB}/sandboxes/${sandboxK2}/token`, jwtUserK);
    assert.equal(issued.status, 200, JSON.stringify(issued.json));
    const token = (issued.json as { assistant: { token: string } }).assistant.token;
    const closed = await api('POST', `/api/v1/workspaces/${wsB}/sandboxes/${sandboxK2}/reject`, jwtUserK,
      { revision: (review.json as { revision: string }).revision });
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    assert.equal((closed.json as { outcome: string }).outcome, 'closed');

    const afterClose = await callApi(base, 'GET', `/api/v1/sandboxes/${sandboxK2}/tools`, { token, alwaysJson: true });
    assert.equal(afterClose.status, 404, JSON.stringify(afterClose.json));
    assert.equal((afterClose.json as Record<string, unknown>).code, 'SANDBOX_NOT_FOUND');
    const person = await api('GET', `/api/v1/workspaces/${wsB}/sandboxes/${sandboxK2}`, jwtUserK);
    assert.equal(person.status, 404, JSON.stringify(person.json));
  });
});
