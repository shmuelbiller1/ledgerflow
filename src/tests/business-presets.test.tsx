import './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BUSINESS_PRESETS, presetDimensions } from '../lib/businessPresets';
import { BUSINESS_TEMPLATES } from '../lib/businessTemplates';
import { labelRole } from '../lib/labelRoles';
import { stubFetchWithBodies } from './helpers/dom';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeChartAccount } from './fixtures';
import OpeningBalancesSetup from '../components/onboarding/OpeningBalancesSetup';
import SetupWizard from '../components/onboarding/SetupWizard';
import Dashboard from '../components/Dashboard';

beforeEach(() => {
  stubFetchWithBodies(200, {});
  setComponentWorkspace('owner');
  useLedgerStore.setState({ accounts: [], transactions: [], dimensionNodes: [] });
  markComponentCollectionsLoaded('accounts', 'transactions');
  useDataNeedsStore.setState({ loadedWorkspaceId: 'component-workspace' });
});
afterEach(() => cleanup());

for (const preset of BUSINESS_PRESETS) {
  test(`${preset.name} selects its existing chart and label preset without posting figures`, async () => {
    const calls = stubFetchWithBodies(200, { status: 'success' });
    render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getByLabelText(preset.name, { exact: true }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })); });
    const workspaceWrite = calls.find(c => c.url.includes('lf_update'))!.body as { p_set: Record<string, unknown> };
    assert.equal(workspaceWrite.p_set.businessType, preset.id);
    const stored = workspaceWrite.p_set.dimensions as typeof preset.labels;
    for (const dimension of preset.labels) assert.deepEqual(stored.find(d => d.id === dimension.id), dimension);
    assert.ok((screen.getByLabelText(BUSINESS_TEMPLATES[preset.id].name) as HTMLInputElement).checked);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })); });
    assert.deepEqual(calls.find(c => c.url.endsWith('/apply-template'))?.body, { templateId: preset.id });
    assert.ok(calls.some(c => c.url.endsWith('/setup-complete')));
    assert.ok(!calls.some(c => c.url.endsWith('/opening-balances')));
    assert.ok(screen.getByRole('heading', { name: 'Your books are set up' }));
  });
}

test('presets preserve existing custom labels and roles, and new funds are self-balancing', () => {
  const custom = [{ id: 'fund', name: 'My custom fund', role: 'informational' as const }, { id: 'unrelated', name: 'Keep me' }];
  const merged = presetDimensions(custom, 'nonprofit');
  assert.deepEqual(merged.slice(0, 2), custom);
  assert.equal(merged.filter(d => d.id === 'fund').length, 1);
  assert.equal(labelRole(presetDimensions([], 'nonprofit').find(d => d.id === 'fund')!), 'self-balancing');
  assert.deepEqual(presetDimensions(merged, 'nonprofit'), merged, 'retry does not duplicate labels');
});

test('previous-year figures are reachable on the completed overview, but not for viewers', async () => {
  const ws = useAuthStore.getState().getCurrentWorkspace()!;
  useAuthStore.setState({ workspaces: [{ ...ws, setupCompletedAt: '2026-11-01' }] });
  const view = render(<Dashboard />);
  fireEvent.click(screen.getByRole('button', { name: 'Add opening balances' }));
  assert.ok(screen.getByRole('heading', { name: 'Opening balances' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.ok(screen.getByRole('button', { name: 'Add opening balances' }));
  view.unmount();
  setComponentWorkspace('viewer');
  const viewerWorkspace = useAuthStore.getState().getCurrentWorkspace()!;
  useAuthStore.setState({ workspaces: [{ ...viewerWorkspace, setupCompletedAt: '2026-11-01' }] });
  render(<Dashboard />);
  assert.equal(screen.queryByRole('button', { name: 'Add opening balances' }), null);
});


test('opening reply after a workspace switch cannot mark either workspace as imported', async () => {
  const ws = useAuthStore.getState().getCurrentWorkspace()!;
  useLedgerStore.setState({ accounts: [makeChartAccount({ id: 'cash', name: 'Checking', type: 'asset', category: 'Cash' }), makeChartAccount({ id: 'obe', name: 'Opening Balance Equity', type: 'equity', category: 'Equity' })] });
  let finish!: (value: Response) => void;
  let calls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async input => {
    if (!String(input).includes('/opening-balances')) return new Response('{}');
    calls++;
    return new Promise<Response>(resolve => { finish = resolve; });
  }) as typeof fetch;
  try {
    render(<OpeningBalancesSetup onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Checking/), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record opening balances' }));
    await waitFor(() => assert.equal(calls, 1));
    fireEvent.click(screen.getByRole('button', { name: 'Recording…' }));
    assert.equal(calls, 1, 'the pending write cannot be submitted twice');
    const other = { ...ws, id: 'other-books' };
    await act(async () => { useAuthStore.setState({ workspaces: [ws, other], currentWorkspaceId: other.id }); });
    await act(async () => { finish(new Response(JSON.stringify({ debitsCents: 100000 }), { status: 200 })); });
    assert.ok(useAuthStore.getState().workspaces.every(w => !w.openingBalanceDate));
    assert.equal(screen.queryByLabelText('Opening balances recorded'), null);
  } finally { globalThis.fetch = previousFetch; }
});

test('a refused opening-balance save keeps the entered figures available for retry', async () => {
  useLedgerStore.setState({ accounts: [makeChartAccount({ id: 'cash', name: 'Checking', type: 'asset', category: 'Cash' }), makeChartAccount({ id: 'obe', name: 'Opening Balance Equity', type: 'equity', category: 'Equity' })] });
  const calls = stubFetchWithBodies(409, { message: 'Period Locked' });
  render(<OpeningBalancesSetup onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText(/Checking/), { target: { value: '1000' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record opening balances' })); });
  assert.equal(calls.length, 1);
  assert.equal((screen.getByLabelText(/Checking/) as HTMLInputElement).value, '1000');
  assert.equal((screen.getByRole('button', { name: 'Record opening balances' }) as HTMLButtonElement).disabled, false);
  assert.equal(useAuthStore.getState().getCurrentWorkspace()?.openingBalanceDate, undefined);
});
