/**
 * #824: `revenue.recognize` and `lease.capitalize` posted a second journal entry when called twice without an
 * `Idempotency-Key`. The old addresses derived an id from the input (a contract's period, a lease's name) and
 * replayed; the commands now derive the same id through `defaultOperationId`, so a repeated call replays too.
 * Input that names nothing to derive from (no contract and period, no lease name) posts each time, as the old
 * address did. Runs against the real test database (the journal service needs it).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createCommandRouter } from '../server/routes/commandRoutes';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;

describe('#824 vertical journals without an Idempotency-Key', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const ws = `ws_824_${suffix}`;
  const owner = `owner_824_${suffix}`;
  let client: pg.Client;
  let serverDb: Firestore | undefined;
  let server: Server | undefined;
  let base = '';

  const run = async (name: string, input: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/v1/commands/${name}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws, input }),
    });
    const body = await res.json() as { replayed?: boolean; message?: string; data?: { transactionId?: string } };
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
  };
  const entries = async () => (await client.query(
    `select count(*)::int as n from public.transactions where workspace_id = $1`, [ws])).rows[0].n as number;

  before(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('insert into public.workspaces (id, data) values ($1, $2)', [ws, { uid: owner, name: '824 Co', currency: 'USD', members: [owner] }]);
    for (const [id, name, type] of [['deferred', 'Deferred revenue', 'liability'], ['revenue', 'Revenue', 'income'],
      ['rou', 'Right-of-use asset', 'asset'], ['lease', 'Lease liability', 'liability']]) {
      await client.query('insert into public."chartAccounts" (id, data) values ($1, $2)', [`${ws}_${id}`, { workspaceId: ws, name, type }]);
    }
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    serverDb = getDb() as unknown as Firestore;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { Object.assign(req, { user: { uid: owner, email: `${owner}@example.test`, aal: 'aal2' } }); next(); });
    app.use('/api/v1/commands', createCommandRouter(undefined, { getDb: () => serverDb! }));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await serverDb?.terminate();
    for (const table of ['transactions', 'chartAccounts', 'auditLogs', 'idempotencyKeys']) {
      await client.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
    }
    await client.query('delete from public.workspaces where id = $1', [ws]);
    await client.end();
  });

  test('revenue.recognize twice for the same contract and period posts one entry and replays', async () => {
    const input = { contractId: 'C-100', periodId: '2026-06', amountCents: 250000, deferredAccountId: `${ws}_deferred`, revenueAccountId: `${ws}_revenue`, date: '2026-06-30' };
    const before = await entries();
    const first = await run('revenue.recognize', input);
    const second = await run('revenue.recognize', input);
    assert.equal(second.replayed, true);
    assert.equal(second.data?.transactionId, first.data?.transactionId);
    assert.equal(await entries(), before + 1);
  });

  test('lease.capitalize twice for the same lease posts one entry and replays', async () => {
    const input = { leaseName: 'HQ Floor 3', pvAmountCents: 1200000, rouAssetAccountId: `${ws}_rou`, leaseLiabilityAccountId: `${ws}_lease`, date: '2026-01-01' };
    const before = await entries();
    await run('lease.capitalize', input);
    const second = await run('lease.capitalize', input);
    assert.equal(second.replayed, true);
    assert.equal(await entries(), before + 1);
  });

  test('a contract id with a slash, a space and an accent is not refused, and still posts once', async () => {
    const input = { contractId: 'INV/100 Café', periodId: '2026-07', amountCents: 4200, deferredAccountId: `${ws}_deferred`, revenueAccountId: `${ws}_revenue`, date: '2026-07-31' };
    const before = await entries();
    const first = await run('revenue.recognize', input);
    const second = await run('revenue.recognize', input);
    assert.equal(second.replayed, true);
    assert.equal(second.data?.transactionId, first.data?.transactionId);
    assert.equal(await entries(), before + 1);
  });

  test('input that names nothing to derive from posts each time, as the old address did', async () => {
    const input = { amountCents: 1000, deferredAccountId: `${ws}_deferred`, revenueAccountId: `${ws}_revenue`, date: '2026-06-30' };
    const before = await entries();
    await run('revenue.recognize', input);
    const second = await run('revenue.recognize', input);
    assert.notEqual(second.replayed, true);
    assert.equal(await entries(), before + 2);
  });
});
