import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test, type TestContext } from 'node:test';
import express from 'express';
import { SignJWT } from 'jose';
import { generateInviteToken } from '../lib/inviteManager';
import type { Firestore } from '../server/db/firestore';
import type { ServerContext } from '../server/http/serverKit';

const url = process.env.LF_TEST_DATABASE_URL;
const issuer = 'https://cmd1-protocols.example.test';
const jwtSecret = 'isolated-cmd1-test-signing-key-only-000000';
const pass: express.RequestHandler = (_req, _res, next) => next();
const context: ServerContext = { apiLogs: [], apiLimiter: pass, matchLimiter: pass, limiter: pass };

describe('Invitation and protocol contracts on PostgreSQL', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let db: Firestore;
  let server: Server;
  let origin: string;
  // Independent limiter bucket on the isolated test proxy; other HTTP suites may share the test DB.
  const testClient = `2001:db8::${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}`;
  const secretEnv = {
    DATABASE_URL: url, SUPABASE_URL: issuer, SUPABASE_JWT_SECRET: jwtSecret,
    GEMINI_API_KEY: 'test-gemini-not-a-live-key', STRIPE_SECRET_KEY: 'sk_test_cmd1_protocol_mock', CSP_TIGHTEN: 'report-only',
  };
  const oldEnv = { ...process.env };

  before(async () => {
    Object.assign(process.env, secretEnv);
    db = (await import('../server/db/firestore')).getDb();
    const { apiAuthenticate } = await import('../server/auth/apiAuthenticate');
    const { registerCspReportRoutes } = await import('../server/routes/cspReportRoutes');
    const { registerAuthRoutes } = await import('../server/routes/authRoutes');
    const { registerTelemetryRoutes } = await import('../server/routes/telemetryRoutes');
    const { invitePublicRouter } = await import('../server/routes/invitePublicRoutes');
    const { billingRouter } = await import('../server/routes/billingRoutes');
    const { aiRouter } = await import('../server/routes/aiRoutes');
    const { registerBrainRoutes } = await import('../server/routes/brainRoutes');
    const { registerDeveloperApiRoutes } = await import('../server/routes/developerApiRoutes');
    const { commandRouter } = await import('../server/routes/commandRoutes');
    const app = express();
    app.set('trust proxy', 'loopback');
    registerCspReportRoutes(app);
    app.use(express.json());
    registerAuthRoutes(app, context);
    registerTelemetryRoutes(app, context);
    registerBrainRoutes(app, context);
    registerDeveloperApiRoutes(app, context);
    app.use('/api/v1/invites', invitePublicRouter);
    app.use('/api/v1/billing', apiAuthenticate, billingRouter);
    app.use('/api/v1/commands', apiAuthenticate, commandRouter);
    app.use('/api/v1/ai', aiRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (db) await db.terminate();
    for (const key of Object.keys(secretEnv)) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
  });

  async function person(t: TestContext, options: { admin?: boolean; confirmed?: boolean; aal?: 'aal1' | 'aal2' } = {}) {
    const uid = randomUUID();
    const email = `${uid.slice(0, 8)}@example.test`;
    await db.pool.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)', [uid, email, options.confirmed === false ? null : new Date()]);
    t.after(async () => {
      await db.pool.query('delete from auth.sessions where user_id = $1', [uid]);
      await db.pool.query('delete from public."loginAudits" where data->>\'uid\' = $1', [uid]);
      await db.pool.query('delete from public."idempotencyKeys" where workspace_id = $1', [`person:${uid}`]);
      await db.pool.query('delete from auth.users where id = $1', [uid]);
    });
    const token = await new SignJWT({ role: 'authenticated', email, aal: options.aal ?? 'aal2', app_metadata: { provider: 'email', admin: options.admin === true } })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer(`${issuer}/auth/v1`).setAudience('authenticated').setSubject(uid)
      .setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(jwtSecret));
    return { uid, email, token };
  }

  async function workspace(t: TestContext, uid: string, fields: Record<string, unknown> = {}) {
    const id = `cmd1-proto-${randomUUID()}`;
    const ref = db.collection('workspaces').doc(id);
    await ref.create({ uid, name: 'Protocol test', plan: 'starter', members: [uid], computeCreditBalance: 1_000, ...fields });
    t.after(async () => {
      for (const table of ['invites', 'notifications', 'auditLogs', 'billingLedgerTraces', 'workspaceShards', 'stripeProcessedEvents', 'errorLogs']) {
        await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [id]);
      }
      await ref.delete();
    });
    const rows = (table: string) => db.collection(table).where('workspaceId', '==', id).get();
    return { id, ref, rows };
  }

  async function request(method: string, path: string, token?: string, body?: unknown) {
    const headers: Record<string, string> = { 'idempotency-key': 'same-request', 'x-forwarded-for': testClient };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, json: res.status === 204 ? null : await res.json() };
  }
  const post = (path: string, token: string | undefined, body: unknown) => request('POST', path, token, body);

  test('a verified invited email may join before membership; the invite and audit are consumed once', async t => {
    const owner = await person(t);
    const invited = await person(t);
    const wrong = await person(t);
    const unverified = await person(t, { confirmed: false });
    const ws = await workspace(t, owner.uid, { maxSeats: 1 });
    const invite = generateInviteToken(ws.id, invited.email, 'accountant');
    const ref = db.collection('invites').doc(invite.id);
    await ref.create({ ...invite });
    const path = `/api/v1/invites/${invite.token}/accept`;
    assert.equal((await post(path, undefined, {})).status, 401);
    assert.equal((await post(path, unverified.token, {})).status, 403);
    assert.equal((await post(path, wrong.token, {})).status, 403);
    assert.equal((await post(path, invited.token, {})).status, 402);
    assert.equal((await ref.get()).data()?.status, 'pending');
    assert.equal((await ws.rows('auditLogs')).size, 0);
    await ws.ref.update({ maxSeats: 2 });
    assert.deepEqual(await post(path, invited.token, {}), { status: 200, json: { status: 'success', workspaceId: ws.id, role: 'accountant', message: 'Successfully joined workspace' } });
    assert.deepEqual((await ws.ref.get()).data()?.members, [owner.uid, invited.uid]);
    assert.equal((await ws.ref.get()).data()?.roles[invited.uid], 'accountant');
    assert.equal((await ref.get()).data()?.acceptedByUid, invited.uid);
    assert.deepEqual(await post(path, invited.token, {}), { status: 400, json: { status: 'error', message: 'Invite is no longer pending (currently accepted)' } });
    assert.deepEqual((await ws.rows('auditLogs')).docs.map(doc => doc.data().action), ['INVITE_ACCEPTED']);
    assert.equal((await ws.rows('notifications')).size, 1);
  });

  test('the named join previews without joining, requires two step, and replays without consuming a second seat', async t => {
    const owner = await person(t);
    const invited = await person(t);
    const passwordOnly = await new SignJWT({ role: 'authenticated', email: invited.email, aal: 'aal1' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer(`${issuer}/auth/v1`).setAudience('authenticated').setSubject(invited.uid)
      .setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(jwtSecret));
    const ws = await workspace(t, owner.uid, { maxSeats: 2 });
    const invite = generateInviteToken(ws.id, invited.email, 'viewer');
    const ref = db.collection('invites').doc(invite.id);
    await ref.create({ ...invite });
    const path = '/api/v1/commands/invite.accept';
    const body = { input: { token: invite.token } };
    assert.equal((await post(path, passwordOnly, body)).json.code, 'TWO_STEP_REQUIRED');
    assert.equal((await post(`${path}/preview`, owner.token, body)).json.code, 'INVITE_EMAIL_MISMATCH');
    const preview = await post(`${path}/preview`, invited.token, body);
    assert.equal(preview.status, 200);
    assert.equal(preview.json.preview.title, 'Join Protocol test');
    assert.equal((await ref.get()).data()?.status, 'pending');
    assert.deepEqual((await ws.ref.get()).data()?.members, [owner.uid]);
    const join = () => post(path, invited.token, body);
    const results = await Promise.all([join(), join()]);
    assert.deepEqual(results.map(r => r.status), [200, 200], JSON.stringify(results));
    assert.deepEqual(results.map(r => r.json.replayed).toSorted(), [false, true]);
    for (const r of results) assert.deepEqual(r.json.data, { workspaceId: ws.id, role: 'viewer' });
    assert.deepEqual((await ws.ref.get()).data()?.members, [owner.uid, invited.uid]);
    assert.equal((await ws.rows('auditLogs')).size, 1);
    assert.equal((await ws.rows('notifications')).size, 1);
  });

  test('verify-session rejects wrong payment state or workspace and repeats verification without granting twice', async t => {
    const owner = await person(t);
    const viewer = await person(t);
    const ws = await workspace(t, owner.uid, { members: [viewer.uid], roles: { [viewer.uid]: 'viewer' } });
    const stripe = (await import('../server/services/stripeService')).getStripe();
    const sessionId = `cs_test_${randomUUID()}`;
    let upstreamWorkspace = `${ws.id}-other`;
    let paid = true;
    const session = t.mock.method(stripe.checkout.sessions, 'retrieve', async () => ({
      id: sessionId, payment_status: paid ? 'paid' : 'unpaid', metadata: { workspaceId: upstreamWorkspace, plan: 'pro' },
      customer: 'cus_test', subscription: 'sub_test',
    }));
    const verify = (token = owner.token) => post('/api/v1/billing/verify-session', token, { session_id: sessionId, workspaceId: ws.id });
    assert.equal((await verify(viewer.token)).status, 403);
    assert.equal(session.mock.callCount(), 0);
    assert.equal((await verify()).json.status, 'incomplete');
    upstreamWorkspace = ws.id;
    paid = false;
    assert.equal((await verify()).status, 400);
    assert.equal((await ws.rows('stripeProcessedEvents')).size, 0);
    assert.equal((await ws.ref.get()).data()?.computeCreditBalance, 1000);
    paid = true;
    assert.deepEqual((await verify()).json, { status: 'success', plan: 'pro' });
    assert.deepEqual((await verify()).json, { status: 'success', plan: 'pro', message: 'Session already verified' });
    assert.equal(session.mock.callCount(), 4, 'replay still verifies the provider response');
    assert.equal((await ws.ref.get()).data()?.computeCreditBalance, 1_001_000);
    assert.equal((await ws.rows('stripeProcessedEvents')).size, 1);
    assert.deepEqual((await ws.rows('auditLogs')).docs.map(doc => doc.data().action), ['WORKSPACE_PLAN_UPGRADED']);
  });

  test('sign-in events record the authenticated actor; revocation and erasure keep their identity and ownership contracts', async t => {
    const owner = await person(t);
    const viewer = await person(t);
    const ws = await workspace(t, owner.uid, { members: [owner.uid, viewer.uid], roles: { [viewer.uid]: 'viewer' } });
    const auth = '/api/v1/auth';
    assert.equal((await post(`${auth}/audit`, undefined, { event: 'login', workspaceId: ws.id })).status, 401);
    assert.equal((await post(`${auth}/audit`, owner.token, { event: 'login', workspaceId: ws.id, uid: viewer.uid })).status, 400);
    const auditIds = new Set();
    for (let i = 0; i < 2; i++) {
      const audit = await post(`${auth}/audit`, viewer.token, { event: 'login', workspaceId: ws.id });
      assert.equal(audit.status, 200);
      assert.ok(audit.json.id);
      auditIds.add(audit.json.id);
      assert.equal((await db.collection('loginAudits').doc(audit.json.id).get()).data()?.uid, viewer.uid);
    }
    assert.equal(auditIds.size, 2);
    assert.deepEqual((await ws.rows('auditLogs')).docs.map(doc => doc.data().uid), [viewer.uid, viewer.uid]);

    await db.pool.query('insert into auth.sessions(id, user_id) values ($1, $2), ($3, $4)', [randomUUID(), owner.uid, randomUUID(), viewer.uid]);
    const revoke = await post(`${auth}/revoke-sessions`, owner.token, {});
    assert.equal(revoke.json.success, true);
    const remaining = await db.pool.query('select user_id from auth.sessions where user_id in ($1, $2)', [owner.uid, viewer.uid]);
    assert.deepEqual(remaining.rows.map(r => r.user_id), [viewer.uid]);
    const refusal = await request('DELETE', `${auth}/delete-account`, owner.token);
    assert.equal(refusal.status, 409);
    assert.equal(refusal.json.workspaces[0].id, ws.id);
    assert.equal((await db.pool.query('select id from auth.users where id = $1', [owner.uid])).rowCount, 1);
    const deleted = await request('DELETE', `${auth}/delete-account`, viewer.token);
    assert.deepEqual(deleted, { status: 200, json: { success: true, message: 'Account deleted.', scheduledForDeletion: [], left: [ws.id] } });
    assert.deepEqual((await ws.ref.get()).data()?.members, [owner.uid]);
    assert.equal((await db.pool.query('select id from auth.users where id = $1', [viewer.uid])).rowCount, 0);
  });

  test('CSP reset is platform-only and anonymous telemetry cannot attach itself to a workspace', async t => {
    const owner = await person(t);
    const admin = await person(t, { admin: true });
    const ws = await workspace(t, owner.uid);
    const { recordCspViolation, resetCspViolations, cspViolationSummary } = await import('../server/http/cspViolations');
    const { CSP_REPORT_PATH } = await import('../server/http/contentSecurityPolicy');
    t.after(resetCspViolations);
    recordCspViolation({ directive: 'img-src', blockedSource: 'https://test.example.test', documentPath: '/' });
    const reset = `${CSP_REPORT_PATH}/summary`;
    assert.equal((await request('DELETE', reset, owner.token)).status, 403);
    assert.equal(cspViolationSummary().total, 1);
    for (let i = 0; i < 2; i++) {
      const response = await request('DELETE', reset, admin.token);
      assert.deepEqual(response, { status: 200, json: { status: 'ok', total: 0, dropped: 0, groups: [] } });
    }
    const path = '/api/v1/telemetry/errors';
    const id = `cmd1-trace-${randomUUID()}`;
    const trace = db.collection('errorLogs').doc(id);
    t.after(async () => { await trace.delete(); });
    assert.equal((await post(path, owner.token, { id, workspaceId: ws.id, message: 9 })).status, 400);
    await post(path, undefined, { id, workspaceId: ws.id, userId: owner.uid, message: 'Could not load the page' });
    assert.equal((await trace.get()).data()?.workspaceId, 'unauthenticated');
    assert.equal((await trace.get()).data()?.userId, undefined);
    const first = await post(path, owner.token, { id, workspaceId: ws.id, message: 'Could not load the page' });
    const again = await post(path, owner.token, { id, workspaceId: ws.id, message: 'Could not load the page' });
    assert.deepEqual(first, { status: 200, json: { status: 'success', errorId: id } });
    assert.deepEqual(again, first);
    assert.equal((await ws.rows('errorLogs')).size, 1);
    assert.equal((await trace.get()).data()?.userId, owner.uid);
    assert.equal((await ws.rows('auditLogs')).size, 0);
  });

  test('AI tasks bill the execution and refund a failure; analysis and classification charge suggestions without posting', async t => {
    const owner = await person(t);
    const outsider = await person(t);
    const ws = await workspace(t, owner.uid, { creditCostMultiplier: 1, quotaCentsMultiplier: 1 });
    const { AIBackendService } = await import('../server/services/aiBackendService');
    const { getShardedCounterValue } = await import('../server/services/shardedCounterService');
    const credit = () => getShardedCounterValue(db, ws.id, 'computeCreditBalance', 1_000);
    let fails = false;
    const model = t.mock.method(AIBackendService, 'processTask', async () => {
      assert.equal(await credit(), fails ? 700 : 850, 'the task is debited before executing');
      if (fails) throw new Error('mocked provider outage');
      return { suggestions: ['A receipt total to review'] };
    });
    const task = '/api/v1/ai/process';
    const receipt = { task: 'parse-receipt', payload: { workspaceId: ws.id, image: 'local-fixture' } };
    assert.equal((await post(task, outsider.token, receipt)).status, 403);
    assert.equal(model.mock.callCount(), 0);
    assert.deepEqual(await post(task, owner.token, receipt), { status: 200, json: { suggestions: ['A receipt total to review'] } });
    assert.equal(await credit(), 850);
    fails = true;
    assert.deepEqual(await post(task, owner.token, receipt), { status: 503, json: { status: 'error', message: 'mocked provider outage' } });
    assert.equal(await credit(), 850, 'a failed retry is a new call but leaves no debit');
    assert.equal(model.mock.callCount(), 2);

    const localFetch = globalThis.fetch;
    let generated = 0;
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const dest = input instanceof Request ? input.url : String(input);
      if (dest.startsWith(`${origin}/`)) return localFetch(input, init);
      assert.equal(new URL(dest).hostname, 'generativelanguage.googleapis.com');
      generated++;
      return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: '{"analysis":"A suggested review"}' }] } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 } });
    });
    const analyze = '/api/v1/brain/analyze';
    const question = { workspaceId: ws.id, prompt: 'What did you notice?', ephemeralData: [{ description: 'Unposted sample' }] };
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(await post(analyze, owner.token, question), { status: 200, json: { status: 'success', analysis: 'A suggested review' } });
    }
    assert.equal(generated, 2);
    assert.equal(await credit(), 828);

    const single = { workspaceId: ws.id, description: 'A not yet posted shop visit' };
    const batch = { workspaceId: ws.id, descriptions: ['First not yet posted', 'Second not yet posted'] };
    const a = await post('/api/v1/brain/classify', owner.token, single);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(a.json.queryDescription, single.description);
    const b = await post('/api/v1/brain/classify-batch', owner.token, batch);
    assert.equal(b.status, 200, JSON.stringify(b.json));
    assert.equal(b.json.predictions.length, 2);
    const names = (await ws.rows('billingLedgerTraces')).docs.map(doc => doc.data().algorithmName).toSorted();
    assert.deepEqual(names, ['AI_BRAIN_ANALYZE_QUERY', 'AI_BRAIN_ANALYZE_QUERY', 'AI_TASK_parse-receipt', 'ALGO_CLASSIFIER_BAYESIAN_BATCH', 'ALGO_CLASSIFIER_BAYESIAN_SINGLE']);
    for (const table of ['transactions', 'journalEntries', 'documents', 'invoices', 'auditLogs']) assert.equal((await ws.rows(table)).size, 0, table);
  });
});
