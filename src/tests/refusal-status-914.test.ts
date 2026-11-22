/** #914: a guard's refusal is answered 403/402 with a plain message, never a 500 with the guard's wording. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type express from 'express';
import { isForbidden, refusalStatus, sendError } from '../server/http/serverKit';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from './helpers/liveApiServer';

function fakeRes() {
  const out: { status?: number; body?: unknown } = {};
  const res = { req: { originalUrl: '/x' }, status(code: number) { out.status = code; return res; }, json(body: unknown) { out.body = body; return res; } };
  return { res: res as unknown as express.Response, out };
}

describe('#914 refusal statuses', () => {
  it('recognizes the refusals the guards raise, prefixed or not', () => {
    assert.equal(isForbidden('FORBIDDEN'), true);
    assert.equal(isForbidden('FORBIDDEN: your role in this workspace is read-only.'), true);
    assert.equal(isForbidden('Unauthorized: You are not a member of this workspace.'), true);
    assert.equal(isForbidden('Unauthorized: API key is scoped strictly to workspace ws_1'), true);
    assert.equal(isForbidden('database exploded'), false);
    assert.equal(refusalStatus('PAYMENT_REQUIRED: This workspace has exhausted its compute credit balance'), 402);
    assert.equal(refusalStatus('boom'), undefined);
  });

  it('sendError turns a refusal 500 into 403/402 and does not echo the guard text', () => {
    let { res, out } = fakeRes();
    sendError(res, 'Internal Reporting Error', 500, 'Unauthorized: You are not a member of this workspace.');
    assert.equal(out.status, 403);
    assert.deepEqual(out.body, { status: 'error', message: 'Forbidden' });
    ({ res, out } = fakeRes());
    sendError(res, 'PAYMENT_REQUIRED: exhausted (0 left)', 500);
    assert.equal(out.status, 402);
    assert.doesNotMatch(JSON.stringify(out.body), /exhausted \(0 left\)/);
    ({ res, out } = fakeRes());
    sendError(res, 'Something broke', 500, 'disk full');
    assert.equal(out.status, 500, 'a real fault stays a 500');
  });
});

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('#914 through the server', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const wsId = `ws_914_${tag}`;
  const ownerUid = crypto.randomUUID();
  const strangerUid = crypto.randomUUID();
  let server: Server | undefined;
  let base = '';
  let prevEnv: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;

  before(async () => {
    prevEnv = useLiveApiEnv('refusal-914');
    const [{ getDb }, { createApp }] = await Promise.all([import('../server/db/firestore'), import('../../server')]);
    db = getDb();
    await db.pool.query(`delete from public."rateLimitEntries"`);
    for (const [uid, who] of [[ownerUid, 'owner'], [strangerUid, 'stranger']]) {
      await db.pool.query(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)`, [uid, `${who}.914.${tag}@example.test`]);
    }
    await db.collection('workspaces').doc(wsId).set({ id: wsId, name: '914', uid: ownerUid, members: [ownerUid], roles: { [ownerUid]: 'owner' }, plan: 'pro', bypassBilling: true, createdAt: new Date().toISOString() });
    const app = await createApp();
    ({ server, base } = await listenOnRandomPort(app));
  });

  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query(`delete from public."rateLimitEntries"`);
      await db.pool.query(`delete from public.workspaces where id = $1`, [wsId]);
      await db.pool.query(`delete from public.users where id = any($1::text[])`, [[ownerUid, strangerUid]]);
      await db.pool.query(`delete from auth.users where id = any($1::uuid[])`, [[ownerUid, strangerUid]]);
    }
    restoreEnv(prevEnv);
  });

  it("a stranger's report request is a 403, not a 500", async () => {
    const token = await signTestJwt({ uid: strangerUid, email: `stranger.914.${tag}@example.test`, userMetadata: { email_verified: true } });
    for (const path of [`/api/v1/reports/balance-sheet?workspaceId=${wsId}&endDate=2026-10-31`, `/api/v1/reports/trial-balance?workspaceId=${wsId}`]) {
      const res = await callApi(base, 'GET', path, { token });
      assert.equal(res.status, 403, path);
      assert.doesNotMatch(JSON.stringify(res.json), /not a member/, 'the guard wording stays in the log');
    }
  });
});
