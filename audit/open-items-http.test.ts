/** Real HTTP routes, isolated DB and synthetic signed identities: selected opening-item figures. */
import '../src/tests/helpers/dom';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import OpeningDocumentsDialog from '../src/components/common/OpeningDocumentsDialog';
import { setComponentWorkspace } from '../src/tests/helpers/componentFixtures';
import { useAuthStore } from '../src/stores/useAuthStore';
import { auth } from '../src/firebase';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('opening items HTTP to isolated books', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), bookkeeper = randomUUID(), stranger = randomUUID(), ws = `ws_open_http_${randomUUID()}`;
  const users = [owner, bookkeeper, stranger];
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  let server: Server | undefined, base = '', tokens: string[] = [], env: Record<string, string | undefined> = {};
  const head = 'Number,Contact,Date,Due Date,Currency,Amount,Amount Still Open';
  const customer = [head, 'INV-101,Acme Ltd,2026-08-14,2026-09-13,USD,"1,250.00","1,250.00"', 'INV-102,Acme Ltd,2026-09-02,2026-10-02,USD,800.00,300.00'].join('\n');
  const vendor = [head, 'B-77,Paper Co,2026-08-20,2026-09-19,USD,310.00,210.00'].join('\n');
  const body = (side: 'customer' | 'vendor', csv: string) => ({ workspaceId: ws, side, csv });
  const request = (mode: 'preview' | 'confirm', input: ReturnType<typeof body>, token = tokens[0]) => callApi(base, 'POST', `/api/v1/open-items/${mode}`, { token, body: input });
  const count = async (name: string) => (await db.collection(name).where('workspaceId', '==', ws).get()).size;
  const balance = async (suffix: string) => (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs
    .flatMap(d => (d.data().lines || []) as Array<{ accountId: string; amountCents: number }>)
    .filter(line => line.accountId === `${ws}_${suffix}`).reduce((sum, line) => sum + line.amountCents, 0);
  before(async () => {
    env = useLiveApiEnv('open-items-http');
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]);
    db = getDb();
    for (const uid of users) await db.pool.query("insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)", [uid, `${uid}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ id: ws, uid: owner, name: 'Opening HTTP', currency: 'USD', timezone: 'UTC', openingBalanceDate: '2026-09-30', setupCompletedAt: '2026-10-01', members: [owner, bookkeeper], roles: { [owner]: 'owner', [bookkeeper]: 'bookkeeper' }, defaultAccountMappings: { ar: `${ws}_ar`, ap: `${ws}_ap`, revenue: `${ws}_sales` } });
    for (const [id, name, type, category, code] of [['ar', 'Accounts Receivable', 'asset', 'Receivables', '1100'], ['bank', 'Bank', 'asset', 'Cash', '1000'], ['ap', 'Accounts Payable', 'liability', 'Payables', '2000'], ['obe', 'Opening Balance Equity', 'equity', 'Equity', '3900'], ['sales', 'Sales', 'income', 'Revenue', '4000'], ['supplies', 'Office Supplies', 'expense', 'Expenses', '6000']]) await db.collection('chartAccounts').doc(`${ws}_${id}`).set({ workspaceId: ws, name, type, category, code });
    await db.collection('customers').doc(`${ws}_customer`).set({ workspaceId: ws, name: 'Acme Ltd', status: 'active' });
    await db.collection('vendors').doc(`${ws}_vendor`).set({ workspaceId: ws, name: 'Paper Co', status: 'active' });
    tokens = await Promise.all(users.map(uid => signTestJwt({ uid, email: `${uid}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } })));
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      for (const table of ['transactions', 'invoices', 'bills', 'customers', 'vendors', 'chartAccounts', 'idempotencyKeys', 'auditLogs']) await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [users]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [users]);
    }
    restoreEnv(env);
  });
  it('preview reports exact open amount, makes no entries, and denies bookkeeper and outsider', async () => {
    const result = await request('preview', body('customer', customer));
    assert.equal(result.status, 200, JSON.stringify(result.json));
    const json = result.json as { openTotalCents: number; rows: Array<{ problem: string | null }>; created: string[] };
    assert.equal(json.openTotalCents, 155000); assert.equal(json.rows.length, 2);
    assert.ok(json.rows.every(row => row.problem === null)); assert.deepEqual(json.created, []);
    assert.equal(await count('transactions'), 0); assert.equal(await count('invoices'), 0);
    assert.equal((await request('preview', body('customer', customer), tokens[1])).status, 403);
    assert.equal((await request('preview', body('customer', customer), tokens[2])).status, 403);
    assert.equal((await callApi(base, 'POST', '/api/v1/open-items/preview', { body: body('customer', customer) })).status, 401);
  });
  it('invalid confirm writes nothing, valid customer and vendor confirms post worked balances, retry refuses duplicates', async () => {
    const invalid = [customer, 'INV-103,Acme Ltd,2026-10-01,,USD,100,100'].join('\n');
    assert.equal((await request('confirm', body('customer', invalid))).status, 400);
    assert.equal(await count('transactions'), 0); assert.equal(await count('invoices'), 0);
    for (const input of [body('customer', customer), body('vendor', vendor)]) {
      const result = await request('confirm', input); assert.equal(result.status, 200, JSON.stringify(result.json));
    }
    assert.deepEqual([await count('invoices'), await count('bills'), await count('transactions')], [2, 1, 3]);
    assert.deepEqual([await balance('ar'), await balance('ap'), await balance('obe'), await balance('sales')], [155000, -21000, -134000, 0]);
    assert.equal((await request('confirm', body('customer', customer))).status, 400);
    assert.deepEqual([await count('invoices'), await count('transactions')], [2, 3]);
  });
  it('the actual dialog previews and confirms via local API and the saved books', async () => {
    const originalFetch = globalThis.fetch;
    const fixture = setComponentWorkspace();
    const user = { ...auth.currentUser!, uid: owner, getIdToken: async () => tokens[0] };
    auth.currentUser = user;
    useAuthStore.setState({ user, currentWorkspaceId: ws, workspaces: [{ ...fixture, id: ws, uid: owner, openingBalanceDate: '2026-09-30' }] });
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => originalFetch(new URL(String(input), base), init)) as typeof fetch;
    let closed = 0;
    try {
      render(React.createElement(OpeningDocumentsDialog, { side: 'customer', onClose: () => { closed++; } }));
      fireEvent.change(screen.getByLabelText('Paste the invoices'), { target: { value: 'Acme Ltd\tINV-UI\t2026-08-14\t2026-09-13\t10.00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Check' }));
      assert.match((await screen.findByRole('table')).textContent || '', /Preview: 1 to add.*10\.00/);
      fireEvent.click(screen.getByRole('button', { name: 'Add 1 opening invoice' }));
      await waitFor(() => assert.equal(closed, 1));
      assert.deepEqual([await count('invoices'), await count('transactions'), await balance('ar')], [3, 4, 156000]);
    } finally { cleanup(); globalThis.fetch = originalFetch; }
  });
});
