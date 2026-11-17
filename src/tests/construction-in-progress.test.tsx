/**
 * Construction in progress (X-09): an asset being built does not depreciate; placing it in service
 * posts one entry moving its cost out of the construction-in-progress account into the asset account
 * it belongs in, and depreciation starts from that day; wrong accounts and dates are refused; undo
 * makes it in progress again until it has been depreciated. On the register: Add cost, Place in service.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { depreciationSchedule, depreciationThrough } from '../lib/depreciationEngine';
import FixedAssetsView from '../components/assets/FixedAssetsView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetchWithBodies } from './helpers/dom';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import { makeChartAccount } from './fixtures';
import type { Firestore } from '../server/db/pgFirestore';
import type { FixedAsset } from '../types';

const url = process.env.LF_TEST_DATABASE_URL;
const building = {
  id: 'wh', uid: 'u', workspaceId: 'component-workspace', name: 'Warehouse', purchaseDate: '2026-03-01', purchasePriceCents: 5_000_000,
  salvageValueCents: 0, usefulLifeYears: 20, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0, status: 'in_progress',
  createdAt: '2026-03-01', assetAccountId: 'cip',
} as FixedAsset;

describe('While it is being built', () => {
  test('nothing depreciates and there is no schedule; once active, the same asset depreciates', () => {
    assert.equal(depreciationThrough(building, '2026-09'), 0);
    assert.deepEqual(depreciationSchedule(building), []);
    assert.ok(depreciationThrough({ ...building, status: 'active' }, '2026-09') > 0);
  });
});

describe('Placing it in service (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_cip_${crypto.randomBytes(4).toString('hex')}`;
  const id = (n: string) => `${ws}_${n}`;
  let db: Firestore;
  let server: Server;
  let base = '';
  const call = async (method: string, body?: unknown) => {
    const res = await fetch(`${base}/api/v1/workspaces/${ws}/assets/${id('wh')}/in-service`, { method, headers: { 'Content-Type': 'application/json', 'x-test-uid': 'book-1' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() as { message?: string; transactionId?: string } };
  };
  const wh = async () => (await db.collection('assets').doc(id('wh')).get()).data()!;

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../server/db/firestore')).getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Build Co', currency: 'USD', members: ['owner-1', 'book-1'], roles: { 'book-1': 'bookkeeper' } });
    const account = (n: string, fields: Record<string, unknown>) => db.collection('chartAccounts').doc(id(n)).set({ workspaceId: ws, uid: 'owner-1', balanceCents: 0, isActive: true, ...fields });
    await account('cip', { code: '1700', name: 'Construction in progress', type: 'asset' });
    await account('buildings', { code: '1600', name: 'Buildings', type: 'asset' });
    await account('rent', { code: '6100', name: 'Rent', type: 'expense' });
    const { id: _id, ...rest } = building;
    await db.collection('assets').doc(id('wh')).set({ ...rest, workspaceId: ws, assetAccountId: id('cip') });
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'assets', 'chartAccounts', 'auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('refused: not an asset account, the construction account itself, a day before building started', async () => {
    assert.match(String((await call('POST', { date: '2026-09-15', assetAccountId: id('rent') })).body.message), /asset accounts/);
    assert.match(String((await call('POST', { date: '2026-09-15', assetAccountId: id('cip') })).body.message), /other than/);
    assert.match(String((await call('POST', { date: '2026-02-01', assetAccountId: id('buildings') })).body.message), /started on 2026-03-01/);
    assert.equal((await wh()).status, 'in_progress');
  });

  test('placed in service on 15 Sept: 50,000.00 moves from construction in progress to Buildings; depreciation starts then', async () => {
    const res = await call('POST', { date: '2026-09-15', assetAccountId: id('buildings'), usefulLifeYears: 25 });
    assert.equal(res.status, 200);
    const entry = (await db.collection('transactions').doc(String(res.body.transactionId)).get()).data()!;
    const lines = Object.fromEntries((entry.lines as Array<{ accountId: string; amountCents: number }>).map(l => [l.accountId.replace(`${ws}_`, ''), l.amountCents]));
    assert.deepEqual(lines, { buildings: 5_000_000, cip: -5_000_000 });
    const w = await wh();
    assert.deepEqual([w.status, w.purchaseDate, w.assetAccountId, w.usefulLifeYears, w.placedInService?.startedOn], ['active', '2026-09-15', id('buildings'), 25, '2026-03-01']);
    assert.equal(depreciationThrough(w as FixedAsset, '2026-09'), 0, 'nothing for the month it was placed');
    assert.equal(depreciationThrough(w as FixedAsset, '2026-10'), Math.round(5_000_000 / 300), 'one month of 25 years');
    assert.equal((await call('POST', { date: '2026-09-16', assetAccountId: id('buildings') })).status, 409, 'not twice');
  });

  test('undo: refused once depreciated; otherwise it is being built again and the entry is void', async () => {
    const placed = (await wh()).placedInService.transactionId as string;
    await db.collection('assets').doc(id('wh')).update({ accumulatedDepreciationCents: 16_667, depreciatedThrough: '2026-10' });
    assert.match(String((await call('DELETE')).body.message), /depreciated/);
    await db.collection('assets').doc(id('wh')).update({ accumulatedDepreciationCents: 0, depreciatedThrough: null });
    assert.equal((await call('DELETE')).status, 200);
    const w = await wh();
    assert.deepEqual([w.status, w.purchaseDate, w.assetAccountId, w.placedInService], ['in_progress', '2026-03-01', id('cip'), undefined]);
    assert.equal((await db.collection('transactions').doc(placed).get()).data()?.status, 'void');
  });
});

describe('Construction in progress on the register', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });
  const accounts = [
    makeChartAccount({ id: 'cip', code: '1700', name: 'Construction in progress', type: 'asset', category: 'Fixed assets' }),
    makeChartAccount({ id: 'buildings', code: '1600', name: 'Buildings', type: 'asset', category: 'Fixed assets' }),
  ];
  const show = () => {
    setComponentWorkspace('bookkeeper');
    useLedgerStore.setState({ assets: [building], accounts } as never);
    markComponentCollectionsLoaded('assets');
    render(<FixedAssetsView />);
  };

  test('it shows as being built; Add cost adds to what it cost', async () => {
    const calls = stubFetchWithBodies(200, null);
    show();
    assert.match(screen.getByRole('row', { name: /Warehouse/ }).textContent || '', /Being built since/);
    fireEvent.click(screen.getByRole('button', { name: 'Add cost to Warehouse' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a cost to Warehouse' });
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '1250.50' } });
    fireEvent.change(within(dialog).getByLabelText('What for (optional)'), { target: { value: 'Roof' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Add' })); });
    // `asset.costaddition` takes the ONE cost: the command reads the list and derives the basis, so the tab sends
    // neither the previous list nor the new total
    await waitFor(() => assert.equal(calls.filter(c => c.url.includes('/commands/asset.costaddition')).length, 1));
    const body = calls.find(c => c.url.includes('/commands/asset.costaddition'))!.body as { input: { assetId: string; amountCents: number; note?: string } };
    assert.equal(body.input.assetId, building.id);
    assert.equal(body.input.amountCents, 125_050);
    assert.equal(body.input.note, 'Roof');
    assert.equal('purchasePriceCents' in body.input, false, 'the basis is derived by the command');
  });

  test('Place in service asks the server with the account it belongs in', async () => {
    const calls = stubFetchWithBodies(200, { status: 'success', description: 'Warehouse placed in service' });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Place in service Warehouse' }));
    const dialog = screen.getByRole('dialog', { name: 'Place Warehouse in service' });
    assert.equal([...(within(dialog).getByLabelText('Asset account it belongs in') as HTMLSelectElement).options].map(o => o.value).join(','), ',buildings', 'not the construction account');
    fireEvent.change(within(dialog).getByLabelText('Asset account it belongs in'), { target: { value: 'buildings' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Place in service' })); });
    await waitFor(() => assert.equal(calls.length, 1));
    assert.match(calls[0].url, /\/assets\/wh\/in-service$/);
    assert.equal((calls[0].body as { assetAccountId: string }).assetAccountId, 'buildings');
  });
});
