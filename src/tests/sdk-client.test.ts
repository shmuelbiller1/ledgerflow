/**
 * The API client (Z-06): waits and retries after a 429, turns refusals into LedgerFlowError with the
 * status and message, and against the real server with an API key: batch create, list across pages,
 * create one (with an Idempotency-Key), an update refused when the entry changed since, delete.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { LedgerFlowClient, LedgerFlowError, type CommandDefinition, type LedgerEntry } from '../../sdk/ledgerflowClient';
import type { Firestore } from '../server/db/pgFirestore';

import { BRAND_NAME } from '../config/brand';
const url = process.env.LF_TEST_DATABASE_URL;
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

test('typed command SDK methods discover, preview, and execute a command with its stable operation key', async () => {
  const definition = {
    name: 'customer.create', area: 'customer', roles: ['owner', 'accountant', 'bookkeeper'], risk: 'normal' as const,
    description: { sentence: 'Create a customer, not an invoice.', example: { customer: { name: 'Acme' } }, refusals: [] },
    inputSchema: { type: 'object' }, runPath: '/api/v1/commands/customer.create', previewPath: '/api/v1/commands/customer.create/preview',
  };
  const answers = [
    { status: 'success', commands: [definition] },
    { status: 'success', command: definition },
    { status: 'success', command: 'customer.create', preview: { title: 'Create customer Acme', lines: ['Acme'] } },
    { status: 'success', command: 'customer.create', data: { customer: { id: 'cust-1' } }, replayed: false },
  ];
  const sent: Array<{ url: string; init: RequestInit }> = [];
  let dropCommandRequest = true;
  const client = new LedgerFlowClient({
    apiKey: 'lf_id_ws_1.secret',
    sleep: async () => {},
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      if (init.method === 'POST' && url === '/api/v1/commands/customer.create' && dropCommandRequest) {
        dropCommandRequest = false;
        throw new TypeError('connection lost');
      }
      return reply(200, answers.shift());
    }) as unknown as typeof fetch,
  });

  assert.deepEqual(await client.listCommands(), [definition]);
  assert.deepEqual(await client.describeCommand('customer.create'), definition);
  assert.deepEqual(await client.previewCommand('customer.create', 'ws-1', { customer: { name: 'Acme' } }), { title: 'Create customer Acme', lines: ['Acme'] });
  assert.deepEqual(await client.executeCommand<{ customer: { id: string } }>('customer.create', 'ws-1', { customer: { name: 'Acme' } }, { idempotencyKey: 'customer-op' }), {
    data: { customer: { id: 'cust-1' } }, replayed: false,
  });
  assert.deepEqual(sent.map(request => request.url), [
    '/api/v1/commands', '/api/v1/commands/customer.create',
    '/api/v1/commands/customer.create/preview', '/api/v1/commands/customer.create',
    '/api/v1/commands/customer.create',
  ]);
  assert.deepEqual(JSON.parse(String(sent[2].init.body)), { workspaceId: 'ws-1', input: { customer: { name: 'Acme' } } });
  const operationKeys = sent.slice(3).map(request => (request.init.headers as Record<string, string>)['Idempotency-Key']);
  assert.deepEqual(operationKeys, ['customer-op', 'customer-op'], 'a network retry must preserve the command operation key');
});

test('findCommand ranks command metadata and performs no preview or execution', async () => {
  const definitions: CommandDefinition[] = [
    {
      name: 'payment.receive', area: 'payment', roles: ['owner'], risk: 'normal',
      description: { sentence: 'Record money received from a customer.', example: { allocations: [{ documentType: 'invoice' }] }, refusals: [] },
      inputSchema: { type: 'object' }, runPath: '/api/v1/commands/payment.receive', previewPath: '/api/v1/commands/payment.receive/preview',
    },
    {
      name: 'invoice.create', area: 'invoice', roles: ['owner'], risk: 'normal',
      description: { sentence: 'Create an invoice from a customer sale.', example: { invoice: { number: 'INV-1' } }, refusals: [] },
      inputSchema: { type: 'object' }, runPath: '/api/v1/commands/invoice.create', previewPath: '/api/v1/commands/invoice.create/preview',
    },
  ];
  const sent: Array<{ url: string; method: string }> = [];
  const client = new LedgerFlowClient({
    apiKey: 'lf_id_ws_1.secret',
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, method: String(init.method) });
      return reply(200, { status: 'success', commands: definitions });
    }) as unknown as typeof fetch,
  });

  const found = await client.findCommand('invoice', 1);
  assert.deepEqual(found.map(command => command.name), ['invoice.create']);
  assert.deepEqual(sent, [{ url: '/api/v1/commands', method: 'GET' }], 'metadata discovery must not preview or execute writes');
  assert.deepEqual(await client.findCommand('not-a-command'), []);
});

test(`a 429 is waited out (Retry-After) and retried; a refusal becomes a ${BRAND_NAME}Error`, async () => {
  const waits: number[] = [];
  const answers = [reply(429, { message: 'slow down' }, { 'retry-after': '2' }), reply(200, { transactions: [{ id: 't1', date: '2026-10-01', lines: [] }], nextCursor: null })];
  const sent: Array<Record<string, string>> = [];
  const client = new LedgerFlowClient({ apiKey: 'lf_id_ws_1.secret', fetch: (async (_u: string, init: RequestInit) => { sent.push(init.headers as Record<string, string>); return answers.shift()!; }) as unknown as typeof fetch, sleep: async ms => { waits.push(ms); } });
  const ids: string[] = [];
  for await (const e of client.listTransactions('ws')) ids.push(String(e.id));
  assert.deepEqual([ids, waits], [['t1'], [2000]]);
  assert.equal(sent[0]['X-API-Key'], 'lf_id_ws_1.secret');

  const refusing = new LedgerFlowClient({ apiKey: 'k.s', fetch: (async () => reply(409, { message: 'Period Locked: closed' })) as unknown as typeof fetch });
  await assert.rejects(refusing.createTransaction('ws', { date: '2026-01-01', lines: [] }), (e: unknown) => e instanceof LedgerFlowError && e.status === 409 && /Period Locked/.test(e.message));
  assert.throws(() => new LedgerFlowClient({ apiKey: 'no-dot' }));
});

describe('The client against the server (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_sdk${crypto.randomBytes(4).toString('hex')}`;
  const acc = (n: string) => `${ws}_${n}`;
  let db: Firestore;
  let server: Server;
  let client: LedgerFlowClient;
  const entry = (date: string, cents: number, status = 'completed'): LedgerEntry => ({
    date, description: `Sale ${cents}`, currency: 'USD', status,
    lines: [{ accountId: acc('bank'), accountName: 'Bank', amountCents: cents }, { accountId: acc('sales'), accountName: 'Sales', amountCents: -cents }],
  });

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../server/db/firestore')).getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'SDK Co', currency: 'USD', members: ['owner-1'], bypassBilling: true });
    const account = (n: string, fields: Record<string, unknown>) => db.collection('chartAccounts').doc(acc(n)).set({ workspaceId: ws, uid: 'owner-1', balanceCents: 0, isActive: true, ...fields });
    await account('bank', { code: '1000', name: 'Bank', type: 'asset', category: 'Cash' });
    await account('sales', { code: '4000', name: 'Sales', type: 'income' });
    const keyId = `lf_id_${ws}_${crypto.randomBytes(8).toString('hex')}`;
    const secret = crypto.randomBytes(32).toString('hex');
    await db.collection('apiKeys').doc(keyId).set({
      id: keyId, workspaceId: ws, uid: 'owner-1', name: 'SDK test', keyHash: crypto.createHash('sha256').update(secret).digest('hex'),
      scopes: ['read:transactions', 'write:transactions', 'read:ledger', 'write:ledger'], expiresAt: 'never', createdAt: new Date().toISOString(),
    });
    const express = (await import('express')).default;
    const { apiAuthenticate } = await import('../server/auth/apiAuthenticate');
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/transactions', apiAuthenticate, transactionRouter);
    server = app.listen(0);
    client = new LedgerFlowClient({ apiKey: `${keyId}.${secret}`, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'chartAccounts', 'apiKeys', 'auditLogs', 'idempotencyKeys', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('batch create, list across pages, create one, a stale update refused, delete a draft', async () => {
    const batch = await client.createTransactions(ws, [entry('2026-10-01', 100), entry('2026-10-02', 200), entry('2026-10-03', 300)]);
    assert.equal(batch.created, 3);
    const draft = await client.createTransaction(ws, entry('2026-10-04', 400, 'draft'));
    assert.ok(draft.id);
    const seen: string[] = [];
    for await (const e of client.listTransactions(ws, { pageSize: 2, fields: ['date'] })) seen.push(String(e.date));
    assert.deepEqual(seen, ['2026-10-04', '2026-10-03', '2026-10-02', '2026-10-01'], 'three pages followed');
    await assert.rejects(client.updateTransaction(batch.ids[0], { memo: 'x' }, { ifUpdatedAt: '2020-01-01T00:00:00.000Z' }), (e: unknown) => e instanceof LedgerFlowError && e.status === 412);
    await client.updateTransaction(batch.ids[0], { memo: 'Checked' });
    assert.equal((await db.collection('transactions').doc(batch.ids[0]).get()).data()?.memo, 'Checked');
    await client.deleteTransaction(String(draft.id));
    assert.equal((await db.collection('transactions').doc(String(draft.id)).get()).exists, false);
  });

  test('INT-4: the server commits, the answer is lost; a new call with the same key gets the first result and creates nothing more', async () => {
    const realFetch = (client as unknown as { fetchImpl: typeof fetch }).fetchImpl;
    let dropNext = true;
    const lossy = new LedgerFlowClient({ apiKey: (client as unknown as { options: { apiKey: string } }).options.apiKey, baseUrl: (client as unknown as { base: string }).base, maxRetries: 0,
      fetch: (async (u: string, init: RequestInit) => { const res = await realFetch(u, init); if (dropNext) { dropNext = false; throw new TypeError('network connection lost'); } return res; }) as unknown as typeof fetch });
    const key = LedgerFlowClient.newOperationKey();
    const e = entry('2026-09-15', 4242);
    await assert.rejects(lossy.createTransaction(ws, e, { idempotencyKey: key }), /network connection lost/);
    const count = async () => (await db.pool.query(`select count(*)::int as n from public."transactions" where workspace_id = $1 and (data->>'description') = 'Sale 4242'`, [ws])).rows[0].n as number;
    assert.equal(await count(), 1, 'the server did create it');
    const again = await lossy.createTransaction(ws, e, { idempotencyKey: key });
    assert.ok(again.id);
    assert.equal(await count(), 1, 'the repeat created nothing more');
    await assert.rejects(lossy.createTransaction(ws, entry('2026-09-15', 999), { idempotencyKey: key }), (err: unknown) => err instanceof LedgerFlowError && err.status === 409);
    // two real, identical payments: two keys, two entries
    await client.createTransaction(ws, entry('2026-09-16', 5151));
    await client.createTransaction(ws, entry('2026-09-16', 5151));
    assert.equal((await db.pool.query(`select count(*)::int as n from public."transactions" where workspace_id = $1 and (data->>'description') = 'Sale 5151'`, [ws])).rows[0].n, 2);
  });

  test('INT-4: inside one call, a dropped connection is retried with the same key: one entry', async () => {
    const realFetch = (client as unknown as { fetchImpl: typeof fetch }).fetchImpl;
    let dropNext = true;
    const lossy = new LedgerFlowClient({ apiKey: (client as unknown as { options: { apiKey: string } }).options.apiKey, baseUrl: (client as unknown as { base: string }).base, sleep: async () => {},
      fetch: (async (u: string, init: RequestInit) => { const res = await realFetch(u, init); if (dropNext) { dropNext = false; throw new TypeError('network connection lost'); } return res; }) as unknown as typeof fetch });
    const created = await lossy.createTransactions(ws, [entry('2026-09-17', 6161), entry('2026-09-17', 6262)]);
    assert.equal(created.created, 2);
    assert.equal((await db.pool.query(`select count(*)::int as n from public."transactions" where workspace_id = $1 and (data->>'description') in ('Sale 6161','Sale 6262')`, [ws])).rows[0].n, 2);
  });
});
