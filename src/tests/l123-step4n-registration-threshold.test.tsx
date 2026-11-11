/**
 * L-123 step 4n: Registration threshold watch (RegistrationThresholdWatchReportView) reads its comparison from the
 * server (GET /api/v1/balances/registration-threshold, useServerRegistrationThreshold) when the loaded entries are
 * capped before the windows' first day, 1 January of the year before the as-of date.
 *
 * Hand-worked case (agorot), Israeli entity E1 with osek patur activity, as of 2026-12-31 (calendar year 2026, the
 * 2026 ceiling 12,283,300, "Effective 2026-01-01 onward"):
 *   S1 2026-03-01 12,000,000 + S2 2026-12-31 283,300 = 12,283,300 → at the ceiling ("At threshold — review scope and dates")
 *   S0 2025-06-01 5,000,000 is outside the 2026 window and is left out.
 * The browser holds only S2 (the entries are capped): 283,300, well below the ceiling.
 */
import './helpers/dom';
import test, { after, afterEach, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { balanceRouteHarness } from './helpers/balanceRouteHarness';
import RegistrationThresholdWatchReportView from '../components/reporting/RegistrationThresholdWatchReportView';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { registrationThresholdWatch, thresholdWindowStart, type RegistrationThresholdWatch } from '../lib/registrationThresholdWatch';
import { makeChartAccount, makeTransaction } from './fixtures';
import type { DimensionNode, Transaction, Workspace } from '../types';

const asOf = '2026-12-31';
const taxProfiles = { labels: { 'world:E1': { name: 'Israel entity', place: { country: 'IL' } } } };
const dimensions = [{ id: 'world', name: 'World / Entity', isWorld: true }, { id: 'activity', name: 'Activity' }];
const sales = (ws: string) => makeChartAccount({ id: `${ws}_sales`, workspaceId: ws, name: 'Sales', type: 'revenue', category: 'Income' });
const cash = (ws: string) => makeChartAccount({ id: `${ws}_cash`, workspaceId: ws, name: 'Cash', type: 'asset', category: 'Cash' });
const sale = (ws: string, id: string, date: string, cents: number) => makeTransaction({
  id: `${ws}_${id}`, workspaceId: ws, date, totalAmountCents: cents, status: 'completed',
  lines: [
    { accountId: `${ws}_cash`, amountCents: cents, dimensions: { world: 'E1', activity: 'OSEK' } },
    { accountId: `${ws}_sales`, amountCents: -cents, dimensions: { world: 'E1', activity: 'OSEK' } },
  ],
}) as Transaction;
const entries = (ws: string) => [sale(ws, 'S0', '2025-06-01', 5_000_000), sale(ws, 'S1', '2026-03-01', 12_000_000), sale(ws, 'S2', '2026-12-31', 283_300)];
const nodes = (ws: string): DimensionNode[] => [
  { id: 'E1', workspaceId: ws, dimensionId: 'world', description: 'Israeli entity' } as DimensionNode,
  { id: 'OSEK', workspaceId: ws, dimensionId: 'activity', description: 'Israel osek patur qualifying turnover' } as DimensionNode,
];
const watch = (ws: string, list: Transaction[]) => registrationThresholdWatch({
  accounts: [sales(ws)], transactions: list, profiles: taxProfiles, dimensionNodes: nodes(ws), entityDimensionId: 'world', activityDimensionId: 'activity', asOf, baseCurrency: 'ILS',
});
const brief = (r: RegistrationThresholdWatch) => r.rows.map(row => `${row.periodStart}…${row.periodEnd} ${row.result} ${row.salesCents}/${row.thresholdCents}`);

describe('L-123 step 4n: registration threshold watch (no database)', () => {
  const ws = 'threshold-workspace';
  const workspace = { id: ws, uid: 'test-user', name: 'Threshold books', businessType: 'custom', createdAt: '2026-01-01', currency: 'ILS', dimensions, taxProfiles } as Workspace;
  const previous = { auth: useAuthStore.getState(), data: useDataNeedsStore.getState(), ledger: useLedgerStore.getState() };
  beforeEach(() => {
    useAuthStore.setState({ user: null, isGuest: true, currentWorkspaceId: ws, workspaces: [workspace] });
    useDataNeedsStore.setState({ loaded: { accounts: true, transactions: true }, failed: {} });
  });
  afterEach(() => {
    cleanup();
    useAuthStore.setState(previous.auth, true); useDataNeedsStore.setState(previous.data, true); useLedgerStore.setState(previous.ledger, true);
  });

  test('the windows start on 1 January of the year before; every sale reaches the ceiling; the loaded one does not', () => {
    assert.equal(thresholdWindowStart(asOf), '2025-01-01');
    const all = watch(ws, entries(ws)), loaded = watch(ws, entries(ws).slice(2));
    assert.deepEqual(brief(all), ['2026-01-01…2026-12-31 at 12283300/12283300']);
    assert.deepEqual(brief(loaded), ['2026-01-01…2026-12-31 below 283300/12283300']);
  });

  test('screen: capped entries give the server\'s comparison, with a note and no provisional alert', async () => {
    useLedgerStore.setState({ accounts: [sales(ws)], transactions: entries(ws).slice(2), dimensionNodes: nodes(ws), truncatedCollections: { transactions: true } } as never);
    const asked: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      asked.push(String(u));
      return Response.json({ status: 'success', report: watch(ws, entries(ws)) });
    }) as typeof fetch;
    render(<RegistrationThresholdWatchReportView endDate={asOf} />);
    await waitFor(() => assert.ok(screen.queryByText('At threshold — review scope and dates'), document.body.textContent!), { timeout: 5000 });
    assert.match(screen.getByTestId('registration-threshold-source').textContent || '', /read from every entry on the server/);
    assert.equal(screen.queryByText(/history is incomplete/i), null);
    assert.ok(asked.some(u => u.includes(`/api/v1/balances/registration-threshold?workspaceId=${ws}&from=2025-01-01&to=${asOf}&entity=world&activity=activity`)), asked.join('\n'));
  });

});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4n: GET /api/v1/balances/registration-threshold', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const api = balanceRouteHarness('ws_l123q', 'L-123 step 4n');
  const ws = api.ws;
  const get = (q: Record<string, string>, uid?: string) => api.get<{ report: RegistrationThresholdWatch; entriesRead: number }>('registration-threshold', { workspaceId: ws, ...q }, uid);
  before(() => api.start({ chartAccounts: [sales(ws), cash(ws)], transactions: entries(ws), dimensionNodes: nodes(ws) }, { currency: 'ILS', dimensions, taxProfiles }));
  after(() => api.stop());

  test('every entry from the window start: the same comparison as every sale; the window is required; members only', async () => {
    const q = { from: '2025-01-01', to: asOf, entity: 'world', activity: 'activity' };
    const r = await get(q);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(brief(r.body.report), ['2026-01-01…2026-12-31 at 12283300/12283300']);
    assert.equal(r.body.entriesRead, 3);
    assert.equal((await get({ ...q, from: '2026-01-01' })).status, 400, 'not the window start');
    assert.equal((await get(q, 'stranger')).status, 403);
  });
});
