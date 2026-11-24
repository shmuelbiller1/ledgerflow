/** Isolated local app probe: same empty-workspace requests through both report mounts.
 * Synthetic signed JWTs exercise the app middleware; this is not deployed/Supabase auth or a financial correctness suite. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('legacy and v1 report mounts on local app', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), outsider = randomUUID(), ws = `ws_mount_${randomUUID()}`;
  const email = `${owner}@example.test`;
  let server: Server | undefined, base = '', ownerToken = '', outsiderToken = '';
  let env: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  before(async () => {
    env = useLiveApiEnv('report-mount-parity');
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]);
    db = getDb();
    for (const uid of [owner, outsider]) await db.pool.query(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)`, [uid, `${uid}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ id: ws, uid: owner, name: 'Report mount parity', members: [owner], roles: { [owner]: 'owner' }, plan: 'pro', bypassBilling: true, currency: 'USD' });
    await db.collection('customers').doc(`${ws}_customer`).set({ workspaceId: ws, name: 'Fixture customer' });
    ownerToken = await signTestJwt({ uid: owner, email, aal: 'aal2', userMetadata: { email_verified: true } });
    outsiderToken = await signTestJwt({ uid: outsider, email: `${outsider}@example.test`, userMetadata: { email_verified: true } });
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query('delete from public.customers where workspace_id = $1', [ws]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [[owner, outsider]]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [[owner, outsider]]);
    }
    restoreEnv(env);
  });
  const date = '2026-05-31';
  const cases: Array<[string, string]> = [
    ['aging', 'type=ar'], ['balance-sheet', `endDate=${date}`], ['balance-sheet-by-label', `dimensionId=department&value=Sales&endDate=${date}`],
    ['budget-actual-periods', `startDate=2026-05-01&endDate=${date}`], ['budget-vs-actual', 'month=2026-05'],
    ['by-label', `dimensionId=department&startDate=2026-05-01&endDate=${date}`], ['cash-flow', `startDate=2026-05-01&endDate=${date}`],
    ['general-ledger', `startDate=2026-05-01&endDate=${date}`], ['inventory-details', `startDate=2026-05-01&endDate=${date}`],
    ['party-aging', `side=customer&asOfDate=${date}`], ['party-balances', `asOfDate=${date}`],
    ['payment-methods', `startDate=2026-05-01&endDate=${date}`], ['pl', `startDate=2026-05-01&endDate=${date}`],
    ['profit-and-loss', `startDate=2026-05-01&endDate=${date}`], ['stock-aging', `asOf=${date}`], ['trial-balance', `asOfDate=${date}`],
    ['explain', `accountIds=${ws}_account&startDate=2026-05-01&endDate=${date}`],
    ['statement', `type=customer&contactId=${ws}_customer&startDate=2026-05-01&endDate=${date}`],
  ];
  it('group summary for one workspace: both mounts return the same result and refuse outsiders', async () => {
    const suffix = `group-summary?groupId=${encodeURIComponent(`ws:${ws}`)}&startDate=2026-05-01&endDate=${date}`;
    const a = await callApi(base, 'GET', `/api/reports/${suffix}`, { token: ownerToken });
    const b = await callApi(base, 'GET', `/api/v1/reports/${suffix}`, { token: ownerToken });
    assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(b.status, 200, JSON.stringify(b));
    assert.deepEqual(a.json, b.json);
    assert.ok([403, 404].includes((await callApi(base, 'GET', `/api/reports/${suffix}`, { token: outsiderToken })).status));
    assert.ok([403, 404].includes((await callApi(base, 'GET', `/api/v1/reports/${suffix}`, { token: outsiderToken })).status));
  });
  it('POST explain: both mounts give the same answer and reject an outsider', async () => {
    const body = { workspaceId: ws, accountIds: [`${ws}_account`], startDate: '2026-05-01', endDate: date };
    const a = await callApi(base, 'POST', '/api/reports/explain', { token: ownerToken, body });
    const b = await callApi(base, 'POST', '/api/v1/reports/explain', { token: ownerToken, body });
    assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(b.status, 200, JSON.stringify(b));
    assert.deepEqual(a.json, b.json);
    assert.equal((await callApi(base, 'POST', '/api/reports/explain', { token: outsiderToken, body })).status, 403);
    assert.equal((await callApi(base, 'POST', '/api/v1/reports/explain', { token: outsiderToken, body })).status, 403);
  });
  for (const [path, params] of cases) it(`${path}: both mounts return equal empty-book result and deny outsiders`, async () => {
    const suffix = `${path}?workspaceId=${encodeURIComponent(ws)}&${params}`;
    const legacy = await callApi(base, 'GET', `/api/reports/${suffix}`, { token: ownerToken });
    const v1 = await callApi(base, 'GET', `/api/v1/reports/${suffix}`, { token: ownerToken });
    assert.equal(legacy.status, 200, JSON.stringify(legacy));
    assert.equal(v1.status, 200, JSON.stringify(v1));
    const withoutCacheTime = (value: unknown) => JSON.parse(JSON.stringify(value, (key, val) => key === 'cachedAt' ? undefined : val));
    assert.deepEqual(withoutCacheTime(legacy.json), withoutCacheTime(v1.json));
    assert.equal((await callApi(base, 'GET', `/api/reports/${suffix}`, { token: outsiderToken })).status, 403);
    assert.equal((await callApi(base, 'GET', `/api/v1/reports/${suffix}`, { token: outsiderToken })).status, 403);
    assert.equal((await callApi(base, 'GET', `/api/reports/${suffix}`)).status, 401);
    assert.equal((await callApi(base, 'GET', `/api/v1/reports/${suffix}`)).status, 401);
  });
});
