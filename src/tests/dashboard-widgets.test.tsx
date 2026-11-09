import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import DashboardWidgets from '../components/dashboard/DashboardWidgets';
import { readBankStatuses } from '../lib/bankFeedStatus';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });
test('dashboard layout persists by user/workspace, resets, and hides misleading values for invalid dates', async () => {
  const workspace = setComponentWorkspace();
  markComponentCollectionsLoaded('transactions', 'accounts', 'invoices', 'bills', 'customers', 'vendors');
  useLedgerStore.setState({ accounts: [], transactions: [], invoices: [], bills: [], customers: [], vendors: [], truncatedCollections: { transactions: true } });
  localStorage.clear(); globalThis.fetch = (async () => new Response(JSON.stringify({ banks: [] }), { status: 200 })) as typeof fetch;
  const view = render(<DashboardWidgets />);
  assert.match(screen.getByRole('alert').textContent || '', /Incomplete data: transactions/);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Revenue' }));
  assert.equal(screen.queryByRole('article', { name: 'Revenue' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Move Cash balance up' }));
  view.unmount(); render(<DashboardWidgets />);
  assert.equal(screen.queryByRole('article', { name: 'Revenue' }), null);
  assert.equal(screen.getAllByRole('article')[2].getAttribute('aria-label'), 'Cash balance');
  fireEvent.change(screen.getByLabelText('Dashboard date range'), { target: { value: 'custom' } });
  fireEvent.change(screen.getByLabelText('Dashboard from'), { target: { value: '2024-03-02' } }); fireEvent.change(screen.getByLabelText('Dashboard to'), { target: { value: '2024-03-01' } });
  assert.match(screen.getAllByRole('alert')[0].textContent || '', /valid dates/); assert.equal(screen.queryAllByRole('article').length, 0);
  await act(async () => { useAuthStore.setState({ currentWorkspaceId: 'other', workspaces: [{ ...workspace, id: 'other' }] }); });
  assert.ok(screen.getByRole('article', { name: 'Revenue' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Revenue' })); fireEvent.click(screen.getByRole('button', { name: 'Reset layout' })); assert.ok(screen.getByRole('article', { name: 'Revenue' }));
});
test('bank status exposes expired login without treating an unknown timestamp as a successful sync', async () => {
  setComponentWorkspace('viewer'); markComponentCollectionsLoaded('transactions', 'accounts', 'invoices', 'bills', 'customers', 'vendors');
  globalThis.fetch = (async () => new Response(JSON.stringify({ banks: [{ id: 'bank', institutionName: 'בנק Bank', status: 'login_required' }] }), { status: 200 })) as typeof fetch;
  render(<DashboardWidgets />);
  const feed = within(screen.getByRole('article', { name: 'Bank feed health' }));
  await waitFor(() => assert.ok(feed.getByText('Login expired')));
  assert.match(feed.getByText(/Last successful sync/).textContent || '', /not provided/); assert.equal(feed.queryByRole('button', { name: 'Reconnect' }), null);
  assert.throws(() => readBankStatuses({}), /did not return/); assert.throws(() => readBankStatuses({ banks: [{ id: 1 }] }), /Invalid/);
});
test('a late bank status response cannot populate another workspace', async () => {
  const workspace = setComponentWorkspace(); markComponentCollectionsLoaded('transactions', 'accounts', 'invoices', 'bills', 'customers', 'vendors');
  let release!: (response: Response) => void;
  const requests: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    requests.push(String(url));
    if (requests.length === 1) return await new Promise<Response>(resolve => { release = resolve; });
    return new Response(JSON.stringify({ banks: [] }), { status: 200 });
  }) as typeof fetch;
  render(<DashboardWidgets />);
  await waitFor(() => assert.equal(requests.length, 1));
  await act(async () => { useAuthStore.setState({ currentWorkspaceId: 'new-workspace', workspaces: [{ ...workspace, id: 'new-workspace' }] }); });
  await waitFor(() => assert.ok(screen.getByText('No connected banks.')));
  await act(async () => { release(new Response(JSON.stringify({ banks: [{ id: 'old-bank', institutionName: 'Old private bank', status: 'active' }] }), { status: 200 })); });
  assert.equal(screen.queryByText('Old private bank'), null);
  assert.match(requests[0], /workspaceId=component-workspace/); assert.match(requests[1], /workspaceId=new-workspace/);
});
test('BC-02: someone who has not arranged their own starts from their role\'s layout; an owner gives a role theirs', async () => {
  const { roleDashboardProblem, startingLayout } = await import('../lib/dashboardOverview');
  assert.equal(roleDashboardProblem('bookkeeper', { order: ['cash'], hidden: [] }), null);
  assert.equal(roleDashboardProblem('bookkeeper', null), null);
  assert.match(String(roleDashboardProblem('boss', null)), /roles/);
  assert.match(String(roleDashboardProblem('viewer', { order: ['nope'], hidden: [] })), /does not exist/);
  assert.equal(startingLayout({ order: ['recent'], hidden: [] }, { viewer: { order: ['cash'], hidden: [] } }, 'viewer').order[0], 'recent', 'their own wins');
  assert.equal(startingLayout(null, { viewer: { order: ['cash'], hidden: [] } }, 'viewer').order[0], 'cash');
  assert.equal(startingLayout(null, {}, 'viewer').order[0], 'networth');

  const viewer = setComponentWorkspace('viewer');
  markComponentCollectionsLoaded('transactions', 'accounts', 'invoices', 'bills', 'customers', 'vendors');
  useLedgerStore.setState({ accounts: [], transactions: [], invoices: [], bills: [], customers: [], vendors: [], truncatedCollections: {} });
  useAuthStore.setState({ workspaces: [{ ...viewer, roleDashboards: { viewer: { order: ['cash'], hidden: ['revenue'] } } }] });
  localStorage.clear(); globalThis.fetch = (async () => new Response(JSON.stringify({ banks: [] }), { status: 200 })) as typeof fetch;
  render(<DashboardWidgets />);
  assert.equal(screen.getAllByRole('article')[0].getAttribute('aria-label'), 'Cash balance');
  assert.equal(screen.queryByRole('article', { name: 'Revenue' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Give them this layout' }), null, 'only owners give layouts');
  cleanup();

  const owner = setComponentWorkspace('owner');
  localStorage.clear();
  const sent: unknown[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes('/role-dashboards')) { sent.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ status: 'success', roleDashboards: { accountant: { order: [], hidden: ['revenue'] } } }), { status: 200 }); }
    return new Response(JSON.stringify({ banks: [] }), { status: 200 });
  }) as typeof fetch;
  render(<DashboardWidgets />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Revenue' }));
  fireEvent.change(screen.getByLabelText('Starting dashboard for'), { target: { value: 'accountant' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Give them this layout' })); });
  assert.equal((sent[0] as { role: string }).role, 'accountant');
  assert.deepEqual((sent[0] as { layout: { hidden: string[] } }).layout.hidden, ['revenue']);
  await waitFor(() => assert.ok(screen.getByText(/accountants who have not arranged their own start from this layout/)));
  assert.ok(useAuthStore.getState().workspaces.find(w => w.id === owner.id)?.roleDashboards?.accountant);
});
