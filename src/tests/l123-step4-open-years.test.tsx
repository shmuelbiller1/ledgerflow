/**
 * L-123 step 4 (docs/design/L-123-server-balances.md): the browser loads only the entries after the newest fresh
 * year-end snapshot. The server answers that day (GET /api/v1/balances/closed-through); the entry list is then
 * marked partial, so every screen that sums all entries reads the server's figures (steps 3–6), and the status
 * bar says the closed years are in the opening balances.
 *
 * Hand-worked case (cents), on a real database when LF_TEST_DATABASE_URL is set:
 *   2025-03-01 sale Cash +50,000 / Sales −50,000; 2025-12-31 snapshot built (fresh) → closedThrough 2025-12-31.
 *   An edit dated 2025-06-01 marks the snapshot stale → closedThrough null (every entry loads again).
 */
import './helpers/dom';
import test, { after, afterEach, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cleanup, render, screen } from '@testing-library/react';
import DataStatusBar from '../components/layout/DataStatusBar';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { CORE_KEYS, closedThroughFrom, entryListPartial } from '../lib/ledgerCollections';
import { setComponentWorkspace } from './helpers/componentFixtures';
import type { Firestore } from '../server/db/pgFirestore';

describe('L-123 step 4: what counts as a partial entry list', () => {
  test('the cap, or closed years left to the server', () => {
    assert.equal(entryListPartial(19_999, 20_000, null), false);
    assert.equal(entryListPartial(20_000, 20_000, null), true);
    assert.equal(entryListPartial(10, 20_000, '2025-12-31'), true);
  });
  test('the server\'s answer is read only when it is a day', () => {
    assert.equal(closedThroughFrom({ closedThrough: '2025-12-31' }), '2025-12-31');
    assert.equal(closedThroughFrom({ closedThrough: null }), null);
    assert.equal(closedThroughFrom({ closedThrough: '31/12/2025' }), null);
    assert.equal(closedThroughFrom(null), null);
  });
});

describe('L-123 step 4: the status bar', () => {
  const loaded = Object.fromEntries(CORE_KEYS.map(k => [k, true]));
  beforeEach(() => {
    setComponentWorkspace('owner');
    useDataNeedsStore.setState({ asked: [], loaded, loadedWorkspaceId: 'component-workspace', failed: {} });
  });
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {}, entriesClosedThrough: null, transactions: [] }); });

  test('closed years: says they are in the opening balances, not that the newest 20,000 are loaded', () => {
    useLedgerStore.setState({ truncatedCollections: { transactions: true }, entriesClosedThrough: '2025-12-31', transactions: [] });
    render(<DataStatusBar />);
    assert.match(screen.getByTestId('closed-years-note').textContent || '', /Entries up to 2025-12-31 are in the closed years' opening balances/);
    assert.doesNotMatch(document.body.textContent || '', /Only the most recent 20,000 entries/);
  });

  test('every entry loaded: no note', () => {
    render(<DataStatusBar />);
    assert.equal(screen.queryByTestId('closed-years-note'), null);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
const OWNER = 'owner-1';

describe('L-123 step 4: GET /api/v1/balances/closed-through', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let db: Firestore;
  let server: Server;
  let base = '';
  const ws = `ws_l123s4_${crypto.randomBytes(4).toString('hex')}`;
  const get = async (workspaceId: string, uid = OWNER) => {
    const res = await fetch(`${base}/api/v1/balances/closed-through?${new URLSearchParams({ workspaceId })}`, { headers: { 'x-test-uid': uid } });
    return { status: res.status, body: await res.json() as { closedThrough: string | null } };
  };

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    const app = express();
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/balances', (await import('../server/routes/balanceRoutes')).balanceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'L-123 step 4', currency: 'USD', timezone: 'UTC', members: [OWNER] });
    await db.collection('chartAccounts').doc(`${ws}_cash`).set({ id: `${ws}_cash`, workspaceId: ws, name: 'Cash', type: 'asset', balance: 0 });
    await db.collection('chartAccounts').doc(`${ws}_sales`).set({ id: `${ws}_sales`, workspaceId: ws, name: 'Sales', type: 'income', balance: 0 });
    await db.collection('transactions').doc(`${ws}_t1`).set({
      id: `${ws}_t1`, workspaceId: ws, uid: OWNER, date: '2025-03-01', description: 'Sale', status: 'completed', type: 'journal', currency: 'USD',
      lines: [{ accountId: `${ws}_cash`, amountCents: 50_000 }, { accountId: `${ws}_sales`, amountCents: -50_000 }],
    });
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'chartAccounts', 'periodBalances', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  test('no snapshot: null; a fresh one: its day; stale: null again; members only', async () => {
    assert.deepEqual((await get(ws)).body.closedThrough, null);
    const svc = await import('../server/services/balanceService');
    await svc.buildSnapshot(db, ws, '2025-12-31', 'test');
    assert.equal((await get(ws)).body.closedThrough, '2025-12-31');
    await db.collection('transactions').doc(`${ws}_t1`).update({ date: '2025-06-01' });
    assert.equal((await get(ws)).body.closedThrough, null);
    assert.equal((await get(ws, 'stranger')).status, 403);
  });
});
