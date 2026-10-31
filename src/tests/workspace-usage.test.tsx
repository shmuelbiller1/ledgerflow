/**
 * Usage (L-15): what a workspace uses against its plan, counted the way the limits are checked:
 * every entry, the people with access, document storage; for any member, never an outsider. On
 * Settings → Billing it shows each against its limit, near it from 80%, and says when it is reached.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import UsagePanel from '../components/platform/settings/UsagePanel';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetchWithBodies } from './helpers/dom';
import { getSupabase } from '../lib/db/client';

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_usage_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Usage', plan: 'growth', members: ['owner-1', 'view-1'], roles: { 'view-1': 'viewer' }, currentStorageMb: 12 });
    for (let i = 0; i < 3; i++) await db.collection('transactions').doc(`${ws}_t${i}`).set({ workspaceId: ws, date: '2026-01-01', status: i === 2 ? 'draft' : 'completed', lines: [] });
    const app = express();
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('every entry, the people, the storage, against the plan; a viewer reads it, an outsider does not', async () => {
    const get = (uid: string) => fetch(`${base}/api/v1/workspaces/${ws}/usage`, { headers: { 'x-test-uid': uid } });
    const res = await get('view-1');
    const body = await res.json() as { usage: unknown };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(body.usage, { plan: 'growth', unlimited: false, entries: { used: 3, limit: 1000 }, seats: { used: 2, limit: 5 }, storageMb: { used: 12, limit: 5000 } }, 'drafts count, as the limit counts them');
    assert.equal((await get('stranger')).status, 403);
  });
});

describe('Settings → Billing: usage', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('each against its limit; near it from 80%; reached says what is refused', async () => {
    setComponentWorkspace('owner');
    const calls = stubFetchWithBodies(200, { status: 'success', usage: { plan: 'free', unlimited: false, entries: { used: 100, limit: 100 }, seats: { used: 1, limit: 1 }, storageMb: { used: 410, limit: 500 } } });
    render(<UsagePanel />);
    await waitFor(() => assert.ok(screen.getByText('Usage on the Free plan')));
    assert.equal(calls[0].url, '/api/v1/workspaces/component-workspace/usage');
    assert.ok(screen.getByText('100 of 100'));
    assert.equal(screen.getAllByRole('alert').length, 2, 'entries and people reached');
    assert.match(screen.getAllByRole('alert')[0].textContent || '', /new entries are refused/);
    assert.ok(screen.getByText('Near the limit.'), 'storage at 82%');
  });

  test('no limits: said in one line', async () => {
    setComponentWorkspace('owner');
    stubFetchWithBodies(200, { status: 'success', usage: { plan: 'pro', unlimited: true, entries: { used: 1, limit: 10000 }, seats: { used: 1, limit: 25 }, storageMb: { used: 0, limit: 25000 } } });
    render(<UsagePanel />);
    await waitFor(() => assert.ok(screen.getByText('Free access (given by LedgerFlow): no limits apply to this workspace.')));
  });
});
