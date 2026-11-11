/**
 * Usage (Strategy 7 + L-15): value-aligned meters (companies/entities, accounting-firm clients,
 * rental units, monthly payment volume, people with access, document storage) while confirming
 * ledger entries are unlimited on standard plans.
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

import { BRAND_NAME } from '../config/brand';
describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_usage_${crypto.randomBytes(4).toString('hex')}`;
  const owner = `owner_usage_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: owner, name: 'Usage', plan: 'growth', members: [owner, 'view-1'], roles: { 'view-1': 'viewer' }, currentStorageMb: 12 });
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

  test('value-aligned meters and uncapped entries; a viewer reads it, an outsider does not', async () => {
    const get = (uid: string) => fetch(`${base}/api/v1/workspaces/${ws}/usage`, { headers: { 'x-test-uid': uid } });
    const res = await get('view-1');
    const body = await res.json() as { usage: Record<string, unknown> };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(body.usage, {
      plan: 'growth',
      unlimited: false,
      entries: { used: 3, limit: null },
      entities: { used: 1, limit: 1 },
      firmClients: { used: 1, limit: 5 },
      rentalUnits: { used: 0, limit: 15 },
      paymentVolumeCents: { used: 0, limit: 5_000_000, platformFeeBps: 35 },
      seats: { used: 2, limit: 5 },
      storageMb: { used: 12, limit: 5000 },
    });
    assert.equal((await get('stranger')).status, 403);
  });
});

describe('Settings → Billing: usage', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('shows unlimited entries alongside value-aligned meters; near it from 80%; reached says what is refused', async () => {
    setComponentWorkspace('owner');
    const calls = stubFetchWithBodies(200, {
      status: 'success',
      usage: {
        plan: 'free',
        unlimited: false,
        entries: { used: 420, limit: null },
        entities: { used: 1, limit: 1 },
        firmClients: { used: 0, limit: 1 },
        rentalUnits: { used: 2, limit: 2 },
        paymentVolumeCents: { used: 200_000, limit: 1_000_000, platformFeeBps: 50 },
        seats: { used: 1, limit: 1 },
        storageMb: { used: 410, limit: 500 },
      },
    });
    render(<UsagePanel />);
    await waitFor(() => assert.ok(screen.getByText('Usage on the Free plan')));
    assert.equal(calls[0].url, '/api/v1/workspaces/component-workspace/usage');
    assert.ok(screen.getByText(/420 entries recorded · Unlimited entries/));
    assert.equal(screen.getAllByRole('alert').length, 3, 'entities, rental units and seats reached');
    assert.match(screen.getAllByRole('alert')[0].textContent || '', /new companies are refused/);
    assert.ok(screen.getByText('Near the limit.'), 'storage at 82%');
  });

  test('no limits: said in one line', async () => {
    setComponentWorkspace('owner');
    stubFetchWithBodies(200, { status: 'success', usage: { plan: 'pro', unlimited: true, entries: { used: 1, limit: null }, seats: { used: 1, limit: 25 }, storageMb: { used: 0, limit: 25000 } } });
    render(<UsagePanel />);
    await waitFor(() => assert.ok(screen.getByText(`Free access (given by ${BRAND_NAME}): no limits apply to this workspace.`)));
  });
});
