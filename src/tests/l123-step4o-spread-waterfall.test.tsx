/**
 * L-123 step 4o: the Spread waterfall (SpreadWaterfallView) reads its rows from the server
 * (GET /api/v1/balances/spread-waterfall, useServerSpreadWaterfall) when the loaded entries, invoices or bills are capped.
 *
 * Hand-worked case (cents), deferred revenue for January 2026 (2026-01-01 … 2026-01-31):
 *   Invoice I-1 · Acme  shares 2025-12-15 100, 2026-01-15 100, 2026-02-15 100 → January 100; earned 200 (to 31 Jan), deferred 100
 *   Invoice I-2 · Beta  share 2026-01-20 50 (a voided 999 on 2026-01-25 and a draft 777 on 2026-01-26 are left out:
 *                       only postable entries count) → January 50; earned 50, deferred 0
 *   totals: January 150, earned 250, deferred 100.
 * The browser holds only the newest three entries (I-1's February share, the void and the draft): earned 0, deferred 100, no I-2.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { balanceRouteHarness } from './helpers/balanceRouteHarness';
import SpreadWaterfallView from '../components/reporting/SpreadWaterfallView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { spreadWaterfall, type Waterfall } from '../lib/spreadWaterfall';
import type { Invoice, Transaction } from '../types';
import { isPostable } from '../lib/txFilters';

const from = '2026-01-01', to = '2026-01-31';
const share = (ws: string, id: string, invoice: string, date: string, cents: number, status = 'completed') => ({
  id: `${ws}_${id}`, workspaceId: ws, uid: 'owner-1', date, status, type: 'journal', description: id, currency: 'USD', totalAmountCents: cents,
  metadata: { type: 'revenue-recognition', spreadOfInvoiceId: `${ws}_${invoice}` }, lines: [],
}) as unknown as Transaction;
const entries = (ws: string) => [
  share(ws, 'R1', 'I1', '2025-12-15', 100), share(ws, 'R2', 'I1', '2026-01-15', 100), share(ws, 'R4', 'I2', '2026-01-20', 50),
  share(ws, 'R3', 'I1', '2026-02-15', 100), share(ws, 'R5', 'I2', '2026-01-25', 999, 'void'), share(ws, 'R6', 'I2', '2026-01-26', 777, 'draft'),
];
const invoices = (ws: string) => [
  { id: `${ws}_I1`, workspaceId: ws, uid: 'owner-1', number: 'I-1', customerName: 'Acme', date: '2025-12-01', status: 'sent', items: [] },
  { id: `${ws}_I2`, workspaceId: ws, uid: 'owner-1', number: 'I-2', customerName: 'Beta', date: '2026-01-01', status: 'sent', items: [] },
] as unknown as Invoice[];
const brief = (w: Waterfall) => [...w.rows.map(r => `${r.label} ${r.byMonth['2026-01'] ?? 0}/${r.earnedCents}/${r.deferredCents}`), `total ${w.totals.byMonth['2026-01'] ?? 0}/${w.totals.earnedCents}/${w.totals.deferredCents}`];
const TRUTH = ['Invoice I-1 · Acme 100/200/100', 'Invoice I-2 · Beta 50/50/0', 'total 150/250/100'];

describe('L-123 step 4o: spread waterfall (no database)', () => {
  const ws = 'component-workspace';
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every share gives the hand-worked waterfall; the loaded two do not', () => {
    assert.deepEqual(brief(spreadWaterfall(entries(ws).filter(isPostable), invoices(ws), 'invoice', { startDate: from, endDate: to })), TRUTH);
    assert.notDeepEqual(brief(spreadWaterfall(entries(ws), invoices(ws), 'invoice', { startDate: from, endDate: to })), TRUTH, 'the draft counts unless filtered');
    assert.deepEqual(brief(spreadWaterfall(entries(ws).slice(3).filter(isPostable), invoices(ws), 'invoice', { startDate: from, endDate: to })), ['Invoice I-1 · Acme 0/0/100', 'total 0/0/100']);
  });

  test('screen: capped entries give the server\'s waterfall, with a note and no provisional alert', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ transactions: entries(ws).slice(3), invoices: invoices(ws), bills: [], truncatedCollections: { transactions: true } } as never);
    markComponentCollectionsLoaded('transactions', 'invoices', 'bills');
    const asked: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      asked.push(String(u));
      return Response.json({ status: 'success', waterfall: spreadWaterfall(entries(ws).filter(isPostable), invoices(ws), 'invoice', { startDate: from, endDate: to }) });
    }) as typeof fetch;
    render(<SpreadWaterfallView startDate={from} endDate={to} />);
    await waitFor(() => assert.ok(document.body.textContent!.includes('Invoice I-2'), document.body.textContent!), { timeout: 5000 });
    assert.match(screen.getByTestId('spread-waterfall-source').textContent || '', /read from every entry on the server/);
    assert.equal(screen.queryByText(/These figures are provisional/), null);
    assert.ok(asked.some(u => u.includes(`/api/v1/balances/spread-waterfall?workspaceId=${ws}&from=${from}&to=${to}&side=invoice`)), asked.join('\n'));
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4o: GET /api/v1/balances/spread-waterfall', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const api = balanceRouteHarness('ws_l123r', 'L-123 step 4o');
  const ws = api.ws;
  const get = (q: Record<string, string>, uid?: string) => api.get<{ waterfall: Waterfall; entriesRead: number }>('spread-waterfall', { workspaceId: ws, from, to, ...q }, uid);
  before(() => api.start({ transactions: entries(ws), invoices: invoices(ws) }));
  after(() => api.stop());

  test('every share at any date: the hand-worked waterfall with labels; bills have none here; side is required; members only', async () => {
    const r = await get({ side: 'invoice' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(brief(r.body.waterfall), TRUTH);
    assert.equal(r.body.entriesRead, 6, 'every revenue-recognition entry, before, in and after the period (the void and the draft are read, then left out)');
    assert.deepEqual(brief((await get({ side: 'bill' })).body.waterfall), ['total 0/0/0']);
    assert.equal((await get({ side: 'other' })).status, 400);
    assert.equal((await get({ side: 'invoice', from: '2026-01-01', to: '2029-01-01' })).status, 400, '37 months: more than the waterfall lists');
    assert.equal((await get({ side: 'invoice', from: '2026-01-01', to: '2028-12-31' })).status, 200, '36 months');
    assert.equal((await get({ side: 'invoice' }, 'stranger')).status, 403);
  });
});
