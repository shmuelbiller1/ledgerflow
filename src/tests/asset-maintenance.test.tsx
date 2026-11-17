/**
 * The maintenance log of a fixed asset (X-06): what an entry needs; newest first; what it cost in
 * all; the next service reminded like the warranty, on the register and in the nightly bell; and the
 * log on the register, where an entry is noted and the next service set.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { maintenanceCost, maintenanceProblem, withEntry } from '../lib/assetMaintenance';
import { assetRemindersDue, reminderText } from '../lib/assetReminders';
import FixedAssetsView from '../components/assets/FixedAssetsView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { Firestore } from '../server/db/pgFirestore';
import type { FixedAsset } from '../types';

const realFetch = globalThis.fetch;

describe('The log', () => {
  test('what an entry needs; newest first; the cost in all', () => {
    assert.equal(maintenanceProblem({ date: '2026-10-01', description: 'Oil change', costCents: 12000, nextDue: '2027-04-01' }), null);
    assert.match(String(maintenanceProblem({ date: '', description: 'Oil change' })), /day it was done/);
    assert.match(String(maintenanceProblem({ date: '2026-10-01', description: 'x' })), /what was done/);
    assert.match(String(maintenanceProblem({ date: '2026-10-01', description: 'Oil', costCents: -1 })), /0 or more/);
    assert.match(String(maintenanceProblem({ date: '2026-10-01', description: 'Oil', nextDue: '2026-09-01' })), /after this one/);
    const log = withEntry(withEntry([], { id: 'a', date: '2026-03-01', description: 'Tyres', costCents: 40000 }), { id: 'b', date: '2026-09-15', description: 'Oil change', costCents: 12000 });
    assert.deepEqual(log.map(e => e.id), ['b', 'a']);
    assert.equal(maintenanceCost(log), 52000);
  });

  test('the next service is reminded 30 days before, like the warranty', () => {
    const due = assetRemindersDue({ status: 'active', nextServiceDue: '2026-10-20' }, '2026-10-10');
    assert.deepEqual(due, [{ kind: 'service', date: '2026-10-20', daysLeft: 10 }]);
    assert.equal(reminderText('Van', due[0]), 'Van is due for its service in 10 days (2026-10-20)');
    assert.deepEqual(assetRemindersDue({ status: 'disposed', nextServiceDue: '2026-10-20' }, '2026-10-10'), []);
  });
});

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_service_${crypto.randomBytes(4).toString('hex')}`;
  let db: Firestore;
  let job: typeof import('../server/services/assetReminderService');
  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    db = (await import('../server/db/firestore')).getDb();
    job = await import('../server/services/assetReminderService');
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Service Co', timezone: 'UTC', members: ['owner-1'] });
    // far from other tests' dates: the nightly job reads every workspace's assets, and other tests run beside this one
    await db.collection('assets').doc(`${ws}_van`).set({ workspaceId: ws, uid: 'owner-1', status: 'active', name: 'Van', nextServiceDue: '2030-10-20' });
  });
  after(async () => {
    for (const table of ['notifications', 'assets', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('the nightly job tells the owner about the service once', async () => {
    await job.runAssetReminders(db, new Date('2030-10-10T12:00:00Z'));
    await job.runAssetReminders(db, new Date('2030-10-11T12:00:00Z'));
    const { rows } = await db.pool.query<{ title: string }>(`select data->>'title' as title from public.notifications where workspace_id = $1`, [ws]);
    assert.deepEqual(rows.map(r => r.title), ['Van is due for its service in 10 days (2030-10-20)']);
  });
});

describe('On the register', () => {
  afterEach(async () => { cleanup(); globalThis.fetch = realFetch; getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('the log shows newest first with its cost; a bookkeeper notes a service and sets the next', async () => {
    setComponentWorkspace('bookkeeper');
    const van = {
      id: 'van', uid: 'u', workspaceId: 'component-workspace', name: 'Delivery van', purchaseDate: '2026-01-01', purchasePriceCents: 1_200_000,
      salvageValueCents: 0, usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0, status: 'active', createdAt: '2026-01-01',
      maintenance: [{ id: 'm1', date: '2026-03-01', description: 'New tyres', costCents: 40000, by: 'Tyre Shop' }],
    } as FixedAsset;
    useLedgerStore.setState({ assets: [van], accounts: [] } as never);
    markComponentCollectionsLoaded('assets');
    const writes: Array<{ url: string; method: string; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method && init.method !== 'GET') writes.push({ url, method: init.method, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
      return new Response(JSON.stringify(url.includes('/rest/v1/') ? [] : {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    render(<FixedAssetsView />);
    assert.match(screen.getByText(/Maintenance log \(1\)/).textContent || '', /\$400\.00 in all/);
    assert.ok(screen.getByText('New tyres'));
    fireEvent.change(screen.getByLabelText('Day done'), { target: { value: '2026-09-15' } });
    fireEvent.change(screen.getByLabelText('What was done'), { target: { value: 'Oil change' } });
    fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Next service'), { target: { value: '2027-03-15' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Note it' })); });
    // saved through the database's update call for the assets table
    const isAsset = (w: { url: string; body: unknown }) => w.url.includes('/commands/record.save')
      ? (w.body as { input?: { collection?: string } }).input?.collection === 'assets'
      : w.url.includes('lf_update') && (w.body as { p_table?: string }).p_table === 'assets';
    await waitFor(() => assert.ok(writes.some(isAsset)));
    const assetWrite = writes.find(isAsset)!;
    const sent = JSON.stringify((assetWrite.body as { input?: unknown }).input ?? assetWrite.body);
    assert.match(sent, /"description":"Oil change","costCents":12000/);
    assert.match(sent, /"nextServiceDue":"2027-03-15"/);
    assert.ok(sent.indexOf('Oil change') < sent.indexOf('New tyres'), 'newest first');
  });
});
