/**
 * Modules (BB-07): simple until needed. A module turned off leaves the menu and the page search,
 * nothing is deleted, and a workspace without settings has everything on. Owners and accountants
 * change them through the server (Settings → Modules), with an audit line; a new workspace starts
 * with the advanced modules off. The database part runs when LF_TEST_DATABASE_URL is set.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ModulesSettings from '../components/platform/settings/ModulesSettings';
import { isModuleOn, MODULES, modulesProblem, moduleOfTab, NEW_WORKSPACE_MODULES } from '../lib/modules';
import { isTabVisible } from '../config/tabVisibility';
import { pageIndex } from '../config/pageIndex';
import { APP_TABS, SETTINGS_TABS_REGISTRY } from '../config/registry';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetchWithBodies } from './helpers/dom';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';

const everyone = { isOwner: true, isProMode: true, developerMode: false };

describe('Which screens show', () => {
  test('every module names menu tabs that exist, and a new workspace has a setting for each', () => {
    const tabs = new Set((APP_TABS as Array<{ id: string }>).map(t => t.id));
    for (const m of MODULES) {
      for (const tab of m.tabs) assert.ok(tabs.has(tab), `${m.id}: no menu tab ${tab}`);
      assert.equal(typeof NEW_WORKSPACE_MODULES[m.id], 'boolean', m.id);
    }
    assert.ok(SETTINGS_TABS_REGISTRY.some(s => s.id === 'modules'));
  });

  test('a workspace without settings has everything on; a module turned off hides only its own tabs', () => {
    const payroll = { id: 'payroll' };
    const invoices = { id: 'invoices' };
    assert.equal(isTabVisible(payroll, everyone), true);
    assert.equal(isTabVisible(payroll, { ...everyone, modules: { payroll: false } }), false);
    assert.equal(isTabVisible(payroll, { ...everyone, modules: { loans: false } }), true);
    assert.equal(isTabVisible(invoices, { ...everyone, modules: NEW_WORKSPACE_MODULES }), true, 'screens outside modules always show');
    assert.equal(moduleOfTab('assets'), 'fixed-assets');
    assert.equal(isModuleOn(undefined, 'payroll'), true);
  });

  test('the page search leaves out modules turned off, and offers them again when on', () => {
    const has = (modules?: Record<string, boolean>) => pageIndex('en', { modules }).some(p => p.page.tab === 'payroll');
    assert.equal(has(undefined), true);
    assert.equal(has({ payroll: false }), false);
    assert.equal(has({ payroll: true }), true);
    assert.ok(pageIndex('en', { modules: { payroll: false } }).some(p => p.page.tab === 'settings' && p.page.sub === 'modules'), 'Settings → Modules is always offered');
  });

  test('settings are checked: known modules, true or false', () => {
    assert.equal(modulesProblem({ payroll: false, loans: true }), null);
    assert.match(String(modulesProblem({ rockets: true })), /no module "rockets"/);
    assert.match(String(modulesProblem({ payroll: 'off' })), /true or false/);
    assert.match(String(modulesProblem(['payroll'])), /Send which modules/);
  });
});

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_modules_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const put = async (uid: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1/workspaces/${ws}/modules`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const saved = async () => (await db.collection('workspaces').doc(ws).get()).data()?.modules;

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Modules', members: ['owner-1', 'acct-1', 'book-1'], roles: { 'acct-1': 'accountant', 'book-1': 'bookkeeper' } });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: `${req.header('x-test-uid')}@example.test` }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('owners and accountants change modules; a bookkeeper and a wrong body are refused', async () => {
    assert.equal((await put('book-1', { modules: { payroll: false } })).status, 403);
    assert.equal((await put('owner-1', { modules: { payroll: 'off' } })).status, 400);
    assert.equal((await put('owner-1', { modules: { rockets: true } })).status, 400);
    assert.equal(await saved(), undefined);
    const off = await put('owner-1', { modules: { payroll: false } });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.deepEqual(off.body.modules, { payroll: false });
    const on = await put('acct-1', { modules: { loans: false, payroll: true } });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.deepEqual(await saved(), { payroll: true, loans: false }, 'other modules keep their setting');
    const audit = await db.pool.query(`select data->'details'->>'description' as d from public."auditLogs" where workspace_id = $1 and data->>'action' = 'MODULES_SET' order by created_at`, [ws]);
    assert.deepEqual(audit.rows.map(r => r.d), ['Modules: Payroll off', 'Modules: Loans off, Payroll on']);
  });

  test('what each module still holds is counted for any member, never for an outsider (step 2)', async () => {
    await db.collection('loans').doc(`${ws}_loan1`).set({ workspaceId: ws, name: 'Van loan' });
    const moduleLines = [{ accountId: 'module-debit', amountCents: 1 }, { accountId: 'module-credit', amountCents: -1 }];
    await db.collection('transactions').doc(`${ws}_ic1`).set({ workspaceId: ws, date: '2026-01-01', status: 'completed', lines: moduleLines, metadata: { isIntercompany: true } });
    await db.collection('transactions').doc(`${ws}_pc1`).set({ workspaceId: ws, date: '2026-01-01', status: 'completed', lines: moduleLines, metadata: { pettyCash: { kind: 'spend' } } });
    await db.collection('transactions').doc(`${ws}_plain`).set({ workspaceId: ws, date: '2026-01-01', status: 'completed', lines: moduleLines });
    const get = async (uid: string) => {
      const res = await fetch(`${base}/api/v1/workspaces/${ws}/modules/records`, { headers: { 'x-test-uid': uid } });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    };
    const res = await get('book-1');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.records, { estimates: 0, 'purchase-orders': 0, payroll: 0, 'fixed-assets': 0, loans: 1, 'petty-cash': 1, intercompany: 1, forecasting: 0, inventory: 0, projects: 0, budgets: 0 });
    assert.equal((await get('stranger')).status, 403);
    for (const table of ['loans', 'transactions']) await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
  });
});

describe('Settings → Modules', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });
  const withModules = (modules?: Record<string, boolean>) => useAuthStore.setState(s => ({ workspaces: s.workspaces.map(w => ({ ...w, modules })) }));

  test('an owner turns a module off: the server is asked, and the switch shows it', async () => {
    setComponentWorkspace('owner');
    withModules(undefined);
    const calls = stubFetchWithBodies(200, { status: 'success', modules: { payroll: false } });
    render(<ModulesSettings />);
    const box = screen.getByRole('checkbox', { name: /^Payroll/ }) as HTMLInputElement;
    assert.equal(box.checked, true, 'a workspace without settings has everything on');
    await act(async () => { fireEvent.click(box); });
    await waitFor(() => assert.equal((screen.getByRole('checkbox', { name: /^Payroll/ }) as HTMLInputElement).checked, false));
    const call = calls.find(c => c.url === '/api/v1/workspaces/component-workspace/modules')!;
    assert.equal(call.method, 'PUT');
    assert.deepEqual(call.body, { modules: { payroll: false } });
    assert.equal(useAuthStore.getState().getCurrentWorkspace()?.modules?.payroll, false);
  });

  test('a module turned off that still holds records says so', async () => {
    setComponentWorkspace('owner');
    withModules({ loans: false, payroll: false });
    const calls = stubFetchWithBodies(200, { status: 'success', records: { loans: 3, payroll: 0 } });
    render(<ModulesSettings />);
    await waitFor(() => assert.ok(screen.getByText('Off, but it still holds 3 records: turn it on to see them.')));
    assert.equal(screen.getAllByText(/^Off, but it still holds/).length, 1, 'payroll holds nothing; modules that are on say nothing');
    assert.ok(calls.some(c => c.url === '/api/v1/workspaces/component-workspace/modules/records'));
  });

  test('a bookkeeper sees the modules but cannot change them', () => {
    setComponentWorkspace('bookkeeper');
    withModules(NEW_WORKSPACE_MODULES);
    stubFetchWithBodies(200, {});
    render(<ModulesSettings />);
    assert.ok(screen.getByText('Owners and accountants choose the modules.'));
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    assert.equal(boxes.length, MODULES.length);
    assert.ok(boxes.every(b => b.disabled));
    assert.equal((screen.getByRole('checkbox', { name: /^Quotes and sales orders/ }) as HTMLInputElement).checked, true);
    assert.equal((screen.getByRole('checkbox', { name: /^Payroll/ }) as HTMLInputElement).checked, false);
  });
});
