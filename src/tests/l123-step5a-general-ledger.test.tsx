/**
 * L-123 step 5a: "General Ledger" (GeneralLedgerView) reads its ledger from the server
 * (GET /api/v1/balances/general-ledger, useServerGeneralLedger) when the loaded entries are capped and the period
 * reaches the oldest loaded day: each opening line is summed by the server through the day before the period.
 *
 * Hand-worked case (cents), the seven entries of helpers/l123RangeLedger (year Y = this year), period Y-02-01…Y-03-31:
 *   Cash opening = E1 −900 + E2 +1,500 = 600; period E3 −300, E4 −700, E5 +800, E6 −200
 *     → debits 800, credits 1,200, ending 200 (E7 is in April, after the period)
 *   Rent opening 900 (E1); period E4 +700 → ending 1,600
 * The loaded four (E4…E7, capped, oldest loaded day Y-02-10) alone: Cash opening 0, debits 800, credits 900, ending −100;
 * Rent opening 0, ending 700.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Y, chart, entries, loadedOf, balanceRouteHarness } from './helpers/l123RangeLedger';
import { setComponentWorkspace } from './helpers/componentFixtures';
import GeneralLedgerView from '../components/ledger/GeneralLedgerView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { formatCurrency } from '../lib/utils';
import { computeGeneralLedger } from '../server/reports/computeReports';

const from = `${Y}-02-01`, to = `${Y}-03-31`;
type Ledger = ReturnType<typeof computeGeneralLedger>;
const brief = (gl: Ledger, ...names: string[]) => gl.accounts.filter(a => names.includes(a.accountName))
  .map(a => `${a.accountName} ${a.openingBalanceCents} ${a.periodDebitsCents}/${a.periodCreditsCents} ${a.endingBalanceCents} ${a.entries.length}`);
const TRUTH = ['Cash 600 800/1200 200 4', 'Rent 900 700/0 1600 1'];

describe('L-123 step 5a: general ledger (no database)', () => {
  const ws = 'component-workspace';
  const all = entries(ws), loaded = loadedOf(all), accounts = chart(ws);
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every entry gives the hand-worked ledger; the loaded four do not', () => {
    assert.deepEqual(brief(computeGeneralLedger(accounts, all, from, to), 'Cash', 'Rent'), TRUTH);
    assert.deepEqual(brief(computeGeneralLedger(accounts, loaded, from, to), 'Cash', 'Rent'), ['Cash 0 800/900 -100 3', 'Rent 0 700/0 700 1']);
  });

  test('screen: capped entries give the server\'s ledger with a note; not capped, nothing is asked', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts, transactions: loaded, truncatedCollections: {} } as never);
    const asked: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => { asked.push(String(u)); return Response.json({ status: 'success', ledger: computeGeneralLedger(accounts, all, from, to) }); }) as typeof fetch;
    const view = render(<GeneralLedgerView startDate={from} endDate={to} />);
    assert.equal(screen.queryByTestId('general-ledger-source'), null);
    assert.equal(asked.length, 0);
    view.unmount();
    useLedgerStore.setState({ truncatedCollections: { transactions: true } });
    render(<GeneralLedgerView startDate={from} endDate={to} />);
    await waitFor(() => assert.match(screen.getByTestId('general-ledger-source').textContent || '', /read from every entry on the server/), { timeout: 5000 });
    assert.ok(document.body.textContent!.includes(formatCurrency(1600)), 'Rent ending 1,600 (opening from E1)');
    assert.ok(asked.some(u => u.includes(`/api/v1/balances/general-ledger?workspaceId=${ws}&from=${from}&to=${to}`)), asked.join('\n'));
  });

  test('screen: the server cannot be asked: the loaded ledger, with a note that it may be incomplete', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts, transactions: loaded, truncatedCollections: { transactions: true } } as never);
    globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
    render(<GeneralLedgerView startDate={from} endDate={to} />);
    await waitFor(() => assert.match(screen.getByTestId('general-ledger-source').textContent || '', /server could not be asked: .* may be incomplete/), { timeout: 5000 });
    assert.ok(!document.body.textContent!.includes(formatCurrency(1600)));
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 5a: GET /api/v1/balances/general-ledger', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const db = balanceRouteHarness(url, 'l123gl', w => ({ accounts: chart(w), entries: entries(w) }));
  const ws = db.ws;
  const get = (q: Record<string, string>, uid?: string) => db.get<{ ledger: Ledger; entriesRead: number }>('general-ledger', q, uid);
  before(() => db.start());
  after(() => db.stop());

  test('the hand-worked ledger: opening lines from the entries before the period; members only; bad ranges', async () => {
    const r = await get({ workspaceId: ws, from, to });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(brief(r.body.ledger, 'Cash', 'Rent'), TRUTH);
    assert.equal(r.body.entriesRead, 6, 'E3…E6 in the period, E1 and E2 for the opening');
    assert.equal(r.cacheControl, 'no-store');
    assert.equal((await get({ workspaceId: ws, from, to }, 'stranger')).status, 403);
    assert.equal((await get({ workspaceId: ws, from: to, to: from })).status, 400);
    assert.equal((await get({ workspaceId: ws, from: '2010-01-01', to })).status, 400, 'more than three years');
  });
});
