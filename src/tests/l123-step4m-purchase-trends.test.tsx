/**
 * L-123 step 4m: Purchase trends by vendor (DocumentTrendsView, kind purchases) read their months from the server
 * (GET /api/v1/balances/purchase-trends, useServerPurchaseTrends) when the loaded bills or vendors are capped, for the
 * period and the comparison period.
 *
 * Hand-worked case (cents), twelve months ending Y-12-31 (window from Y-01-01), exchange rate 1:
 *   Alpha  B1 Jan 500; B3 Feb 200 (unpaid) → Jan 500, Feb 200
 *   Beta   B2 Feb 300 (paid)               → Feb 300
 *   B4 is a draft and B5 is dated the year before: both left out.
 * The browser holds only the newest two bills (B3, B4): Alpha Feb 200.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { balanceRouteHarness } from './helpers/balanceRouteHarness';
import { workspaceYearMonth } from '../lib/utils';
import { PurchaseTrendsView } from '../components/reporting/DocumentTrendsView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { purchaseTrendsByVendor, type TrendRow } from '../lib/documentTrends';
import type { Bill, Vendor } from '../types';

const Y = workspaceYearMonth().year;
const from = `${Y}-01-01`, to = `${Y}-12-31`, prevTo = `${Y - 1}-12-31`;
const vendors = (ws: string): Vendor[] => [
  { id: `${ws}_alpha`, workspaceId: ws, uid: 'owner-1', name: 'Alpha', category: '' } as Vendor,
  { id: `${ws}_beta`, workspaceId: ws, uid: 'owner-1', name: 'Beta', category: '' } as Vendor,
];
const bill = (ws: string, n: number, vendor: string, date: string, status: string, amountCents: number) =>
  ({ id: `${ws}_B${n}`, workspaceId: ws, uid: 'owner-1', number: `B${n}`, vendorId: `${ws}_${vendor}`, date, status, amountCents, exchangeRate: 1, items: [] }) as unknown as Bill;
const bills = (ws: string): Bill[] => [
  bill(ws, 5, 'alpha', `${Y - 1}-06-01`, 'unpaid', 999),
  bill(ws, 1, 'alpha', `${Y}-01-15`, 'unpaid', 500),
  bill(ws, 2, 'beta', `${Y}-02-10`, 'paid', 300),
  bill(ws, 3, 'alpha', `${Y}-02-20`, 'unpaid', 200),
  bill(ws, 4, 'beta', `${Y}-03-01`, 'draft', 700),
];
const brief = (rows: TrendRow[]) => rows.map(r => `${r.month.slice(5)} ${r.name} ${r.cents}`).sort();
const TRUTH = ['01 Alpha 500', '02 Alpha 200', '02 Beta 300'];

describe('L-123 step 4m: purchase trends (no database)', () => {
  const ws = 'component-workspace';
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); useDataNeedsStore.setState({ failed: {} }); });

  test('every bill gives the hand-worked months; the loaded two do not', () => {
    assert.deepEqual(brief(purchaseTrendsByVendor(vendors(ws), bills(ws), to)), TRUTH);
    assert.deepEqual(brief(purchaseTrendsByVendor(vendors(ws), bills(ws).slice(3), to)), ['02 Alpha 200']);
  });

  for (const [what, state] of [
    ['capped bills', () => useLedgerStore.setState({ truncatedCollections: { bills: true } })],
    ['vendors that failed to load', () => useDataNeedsStore.setState({ failed: { vendors: 'offline' } })],
  ] as const) {
    test(`screen: ${what} give the server's months for both periods, with notes and no provisional alert`, async () => {
      setComponentWorkspace('owner');
      useLedgerStore.setState({ customers: [], invoices: [], inventory: [], transactions: [], accounts: [], vendors: vendors(ws), bills: bills(ws).slice(3) } as never);
      markComponentCollectionsLoaded('customers', 'vendors', 'invoices', 'bills', 'inventory', 'transactions', 'accounts');
      state();
      const asked: string[] = [];
      globalThis.fetch = (async (u: RequestInfo | URL) => {
        asked.push(String(u));
        const q = new URL(String(u), 'http://x').searchParams;
        return Response.json({ status: 'success', rows: purchaseTrendsByVendor(vendors(ws), bills(ws), q.get('to')!) });
      }) as typeof fetch;
      render(<PurchaseTrendsView endDate={to} compareEndDate={prevTo} />);
      await waitFor(() => assert.ok(document.body.textContent!.includes('Beta'), document.body.textContent!), { timeout: 5000 });
      assert.match(screen.getByTestId('purchases-trends-source').textContent || '', /read from every entry on the server/);
      assert.match(screen.getByTestId('purchases-trends-compare-source').textContent || '', /read from every entry on the server/);
      assert.equal(screen.queryByText(/These trends are provisional/), null);
      for (const [f, t] of [[from, to], [`${Y - 1}-01-01`, prevTo]]) {
        assert.ok(asked.some(u => u.includes(`/api/v1/balances/purchase-trends?workspaceId=${ws}&from=${f}&to=${t}`)), asked.join('\n'));
      }
    });
  }
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4m: GET /api/v1/balances/purchase-trends', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const api = balanceRouteHarness('ws_l123p', 'L-123 step 4m');
  const ws = api.ws;
  const get = (q: Record<string, string>, uid?: string) => api.get<{ rows: TrendRow[]; billsRead: number }>('purchase-trends', { workspaceId: ws, ...q }, uid);
  before(() => api.start({ vendors: vendors(ws), bills: bills(ws) }));
  after(() => api.stop());

  test('every bill of the window: the hand-worked months; the year before is read separately; the window is required; members only', async () => {
    const r = await get({ from, to });
    assert.equal(r.status, 200);
    assert.deepEqual(brief(r.body.rows), TRUTH);
    assert.equal(r.body.billsRead, 4, 'the four bills dated in the window (the draft is read, then left out)');
    assert.deepEqual(brief((await get({ from: `${Y - 1}-01-01`, to: prevTo })).body.rows), ['06 Alpha 999']);
    assert.equal((await get({ from: `${Y}-02-01`, to })).status, 400, 'not the twelve-month window');
    assert.equal((await get({ from, to }, 'stranger')).status, 403);
  });
});
