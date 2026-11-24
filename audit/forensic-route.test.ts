import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('forensic scan route, local app and disposable database', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), outsider = randomUUID(), ws = `ws_forensic_${randomUUID()}`;
  let server: Server | undefined, base = '', token = '', strangerToken = '';
  let env: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  before(async () => {
    env = useLiveApiEnv('forensic-scan');
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]);
    db = getDb();
    for (const uid of [owner, outsider]) await db.pool.query("insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)", [uid, `${uid}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ id: ws, name: 'Forensic test', uid: owner, members: [owner], roles: { [owner]: 'owner' }, currency: 'USD' });
    for (let i = 0; i < 8; i++) {
      const amount = i === 7 ? 12345 : 100;
      await db.collection('transactions').doc(`${ws}_${i}`).set({ workspaceId: ws, date: '2026-01-01', description: i === 7 ? 'Large charge' : 'Normal', totalAmountCents: amount, status: 'completed', type: 'actual', lines: [{ accountId: 'one', amountCents: amount }, { accountId: 'two', amountCents: -amount }] });
    }
    token = await signTestJwt({ uid: owner, email: `${owner}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    strangerToken = await signTestJwt({ uid: outsider, email: `${outsider}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query('delete from public.transactions where workspace_id = $1', [ws]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [[owner, outsider]]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [[owner, outsider]]);
    }
    restoreEnv(env);
  });
  it('returns the documented four-field outlier, rather than a transaction with score/date', async () => {
    const result = await callApi(base, 'POST', '/api/v1/forensics/anomaly-scan', { token, body: { workspaceId: ws } });
    assert.equal(result.status, 200, JSON.stringify(result));
    const rows = (result.json as { anomalies: Array<Record<string, unknown>> }).anomalies;
    assert.deepEqual(rows, [{ id: `${ws}_7`, description: 'Large charge', amountCents: 12345, reason: 'Statistically anomalous amount (Z-Score > 2.5)' }]);
  });
  it('refuses an unauthorized workspace', async () => {
    const result = await callApi(base, 'POST', '/api/v1/forensics/anomaly-scan', { token: strangerToken, body: { workspaceId: ws } });
    assert.equal(result.status, 403, JSON.stringify(result));
  });
});
