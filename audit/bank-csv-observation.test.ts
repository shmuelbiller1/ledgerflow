/** Observes current legacy CSV upload behavior on a disposable local app/DB. Assertions that
 * record dropped rows and substituted dates are observations, not desired regression behavior. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('legacy bank CSV upload observations', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), outsider = randomUUID(), ws = `ws_csv_${randomUUID()}`;
  let server: Server | undefined, base = '', token = '', strangerToken = '';
  let env: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  before(async () => {
    env = useLiveApiEnv('bank-csv-observation');
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]);
    db = getDb();
    for (const uid of [owner, outsider]) await db.pool.query("insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)", [uid, `${uid}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ id: ws, name: 'CSV observation', uid: owner, members: [owner], roles: { [owner]: 'owner' }, currency: 'USD', timezone: 'UTC' });
    token = await signTestJwt({ uid: owner, email: `${owner}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    strangerToken = await signTestJwt({ uid: outsider, email: `${outsider}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [[owner, outsider]]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [[owner, outsider]]);
    }
    restoreEnv(env);
  });
  async function upload(csv: string, auth: string) {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'statement.csv');
    form.append('workspaceId', ws);
    const res = await fetch(`${base}/api/upload-bank-csv`, { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'X-LedgerFlow-Request': '1' }, body: form });
    return { status: res.status, body: await res.json() };
  }
  it('AUP-30 (fixed): a file with an unreadable amount or date is refused and names each row', async () => {
    const result = await upload('Date,Description,Amount\n2026-01-01,Valid,10.00\n2026-01-02,Bad amount,banana\nnot-a-date,Bad date,5.00\n', token);
    assert.equal(result.status, 422, JSON.stringify(result));
    assert.deepEqual(result.body.rejected.map((r: { row: number }) => r.row), [2, 3]);
    assert.equal((await db.collection('transactions').where('workspaceId', '==', ws).get()).size, 0, 'upload itself does not write ledger entries');
  });
  it('refuses an outsider using the selected workspace', async () => {
    const result = await upload('Date,Description,Amount\n2026-01-01,Valid,10.00\n', strangerToken);
    assert.equal(result.status, 403, JSON.stringify(result));
  });
});
