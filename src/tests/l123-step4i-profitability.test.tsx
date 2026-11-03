/**
 * L-123 step 4i: Profitability (ProfitabilityByView) reads its lines from the server
 * (GET /api/v1/balances/profitability, src/hooks/useServerProfitability.ts) when the loaded lists are capped.
 *
 * Hand-worked case (cents) on the step 4 sales ledger (src/tests/helpers/l123SalesLedger.ts), year Y:
 *   by customer  Acme (I1 W×2 2,000, cost posted 700; I3 W×1 1,000, posted cost reversed so the estimate 300)
 *                  → revenue 3,000 · cost 1,000 · margin 2,000
 *                Beta (I2 G×1 1,500, no cost posted so the estimate 500) → 1,500 · 500 · 1,000
 *   by item      Widget 3,000 · 1,000 · 2,000; Gadget 1,500 · 500 · 1,000 (as in step 4b); I4 is a draft, left out
 * The browser holds the newest two invoices (I3, I4) and the entries C3, C3R: by customer only Acme 1,000 · 300 · 700.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { balanceRouteHarness } from './helpers/balanceRouteHarness';
import { Y, from, to, chart, stock, invoices, entries, clients } from './helpers/l123SalesLedger';
import { ProfitabilityByView } from '../components/reporting/ProfitabilityByView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { profitabilityLines, type ProfitabilityBy, type ProfitabilityLine } from '../lib/profitabilityLines';

const brief = (lines: ProfitabilityLine[]) => lines.map(l => `${l.label} ${l.revenueCents}/${l.costCents}/${l.marginCents}`).sort();
const TRUTH: Record<'customer' | 'item', string[]> = {
  customer: ['Acme 3000/1000/2000', 'Beta 1500/500/1000'],
  item: ['Gadget 1500/500/1000', 'Widget 3000/1000/2000'],
};
const input = (ws: string, loadedOnly = false) => ({
  customers: clients(ws), invoices: loadedOnly ? invoices(ws).slice(2) : invoices(ws), items: stock(ws),
  transactions: loadedOnly ? entries(ws).slice(1) : entries(ws), accounts: chart(ws), projects: [], startDate: from, endDate: to,
});

describe('L-123 step 4i: profitability (no database)', () => {
  const ws = 'component-workspace';
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every invoice gives the hand-worked lines by customer and by item; the loaded two do not', () => {
    for (const by of ['customer', 'item'] as const) assert.deepEqual(brief(profitabilityLines(by, input(ws))), TRUTH[by], by);
    assert.deepEqual(brief(profitabilityLines('customer', input(ws, true))), ['Acme 1000/300/700']);
  });

  test('screen: the server\'s lines when the invoices are capped, with a note', async () => {
    setComponentWorkspace('owner');
    const own = input(ws, true);
    useLedgerStore.setState({ customers: own.customers, invoices: own.invoices, inventory: own.items, transactions: own.transactions,
      accounts: own.accounts, projects: [], truncatedCollections: { invoices: true } } as never);
    markComponentCollectionsLoaded('customers', 'invoices', 'inventory', 'transactions', 'accounts', 'projects');
    const asked: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      asked.push(String(url));
      const by = new URL(String(url), 'http://x').searchParams.get('by') as ProfitabilityBy;
      return Response.json({ status: 'success', lines: profitabilityLines(by, input(ws)) });
    }) as typeof fetch;
    render(<ProfitabilityByView selectedYear={Y} />);
    await waitFor(() => assert.ok(document.body.textContent!.includes('Beta'), document.body.textContent!), { timeout: 5000 });
    assert.match(screen.getByTestId('profitability-source').textContent || '', /read from every entry on the server/);
    assert.ok(asked.some(u => u.includes(`/api/v1/balances/profitability?workspaceId=${ws}&from=${from}&to=${to}&by=customer`)), asked.join('\n'));
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4i: GET /api/v1/balances/profitability', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const api = balanceRouteHarness('ws_l123l', 'L-123 step 4i');
  const ws = api.ws;
  const get = (q: Record<string, string>, uid?: string) => api.get<{ lines: ProfitabilityLine[]; invoicesRead: number }>('profitability', { workspaceId: ws, from, to, ...q }, uid);
  before(() => api.start({ chartAccounts: chart(ws), inventory: stock(ws), invoices: invoices(ws), transactions: entries(ws), customers: clients(ws) }));
  after(() => api.stop());

  test('every invoice: the hand-worked lines by customer and by item; by is required; members only', async () => {
    for (const by of ['customer', 'item'] as const) {
      const r = await get({ by });
      assert.equal(r.status, 200, by);
      assert.deepEqual(brief(r.body.lines), TRUTH[by], by);
      assert.equal(r.body.invoicesRead, 4);
    }
    assert.equal((await get({ by: 'project' })).status, 200, 'by project reads the entries too');
    assert.equal((await get({ by: 'region' })).status, 400);
    assert.equal((await get({})).status, 400, 'by is required');
    assert.equal((await get({ by: 'customer' }, 'stranger')).status, 403);
  });
});
