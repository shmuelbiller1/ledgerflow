/**
 * L-123 step 5c: the Query screen (QueryView) reads its matches from the server (GET /api/v1/balances/entry-query,
 * useServerEntryQuery) when the loaded entries are capped and the dates reach the oldest loaded day; the Reports year
 * list adds the server's years (GET /api/v1/balances/entry-years, useServerEntryYears) when capped.
 *
 * Hand-worked case, the seven entries of helpers/l123RangeLedger (year Y), totals E1 900 · E2 1,500 · E3 300 · E4 700 ·
 * E5 800 · E6 200 · E7 300. Query "at least 500" over the year: E5, E4, E2, E1 (newest first), 4 matches.
 * The loaded four (E4…E7, capped) alone: E5, E4 — E1 and E2 are missing.
 * Years: the seven entries are in Y, plus one entry E8 dated 2021-06-30: the server's years are Y and 2021.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Y, from, to, chart, entries, loadedOf, balanceRouteHarness } from './helpers/l123RangeLedger';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useServerEntryQuery } from '../hooks/useServerEntryQuery';
import { useServerEntryYears } from '../hooks/useServerEntryYears';
import { entryMatches, type EntryQuery } from '../lib/entryQuery';
import type { Transaction } from '../types';

const FILTER: EntryQuery = { startDate: from, endDate: to, minAmountCents: 500 };
const names = (list: Transaction[]) => list.map(t => t.description).join(' ');
const newestFirst = (list: Transaction[]) => [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

function QueryProbe({ filter }: { filter: EntryQuery }) {
  const { results, total, source } = useServerEntryQuery(filter);
  return <p data-testid="probe">{`${source}|${total}|${names(results)}`}</p>;
}
function YearsProbe() {
  return <p data-testid="years">{useServerEntryYears().join(',')}</p>;
}

describe('L-123 step 5c: query and years (no database)', () => {
  const ws = 'component-workspace';
  const all = entries(ws), loaded = loadedOf(all);
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every entry gives the hand-worked matches; the loaded four do not', () => {
    assert.equal(names(newestFirst(all.filter(t => entryMatches(t, FILTER)))), 'E5 E4 E2 E1');
    assert.equal(names(newestFirst(loaded.filter(t => entryMatches(t, FILTER)))), 'E5 E4');
  });

  test('query: capped entries give the server\'s matches; not capped, the loaded ones and nothing is asked', async () => {
    setComponentWorkspace('owner');
    markComponentCollectionsLoaded('transactions');
    useLedgerStore.setState({ accounts: chart(ws), transactions: loaded, truncatedCollections: {} } as never);
    const asked: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => { asked.push(String(u)); return Response.json({ status: 'success', entries: newestFirst(all.filter(t => entryMatches(t, FILTER))), total: 4 }); }) as typeof fetch;
    const first = render(<QueryProbe filter={FILTER} />);
    assert.equal(screen.getByTestId('probe').textContent, 'loaded|2|E4 E5');
    assert.equal(asked.length, 0);
    first.unmount();
    useLedgerStore.setState({ truncatedCollections: { transactions: true } });
    render(<QueryProbe filter={FILTER} />);
    await waitFor(() => assert.equal(screen.getByTestId('probe').textContent, 'server|4|E5 E4 E2 E1'), { timeout: 5000 });
    assert.ok(asked.some(u => u.includes(`/api/v1/balances/entry-query?workspaceId=${ws}&from=${from}&to=${to}&min=500`)), asked.join('\n'));
  });

  test('years: asked only when capped; the server\'s years are given', async () => {
    setComponentWorkspace('owner');
    let asked = 0;
    globalThis.fetch = (async () => { asked++; return Response.json({ status: 'success', years: [Y, 2021] }); }) as typeof fetch;
    const first = render(<YearsProbe />);
    assert.equal(screen.getByTestId('years').textContent, '');
    first.unmount();
    assert.equal(asked, 0);
    useLedgerStore.setState({ truncatedCollections: { transactions: true } });
    render(<YearsProbe />);
    await waitFor(() => assert.equal(screen.getByTestId('years').textContent, `${Y},2021`), { timeout: 5000 });
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 5c: GET /api/v1/balances/entry-query and /entry-years', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const withOld = (w: string): Transaction[] => [...entries(w), { ...entries(w)[0], id: `${w}_e8`, description: 'E8', date: '2021-06-30' }];
  const db = balanceRouteHarness(url, 'l123q', w => ({ accounts: chart(w), entries: withOld(w) }));
  const ws = db.ws;
  before(() => db.start());
  after(() => db.stop());

  test('the hand-worked matches over every entry of the range; text, account and bad input; members only', async () => {
    const r = await db.get<{ entries: Transaction[]; total: number }>('entry-query', { workspaceId: ws, from, to, min: '500' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(names(r.body.entries), 'E5 E4 E2 E1');
    assert.equal(r.body.total, 4);
    assert.equal(r.cacheControl, 'no-store');
    assert.equal(names((await db.get<{ entries: Transaction[] }>('entry-query', { workspaceId: ws, from, to, accounts: `${ws}_fuel` })).body.entries), 'E7 E6 E3');
    assert.equal(names((await db.get<{ entries: Transaction[] }>('entry-query', { workspaceId: ws, from, to, q: 'e2' })).body.entries), 'E2');
    assert.equal((await db.get('entry-query', { workspaceId: ws, from, to, min: '1.5' })).status, 400);
    assert.equal((await db.get('entry-query', { workspaceId: ws, from, to }, 'stranger')).status, 403);
  });

  test('years: every year with an entry, newest first; members only', async () => {
    const r = await db.get<{ years: number[] }>('entry-years', { workspaceId: ws });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.years, [Y, 2021]);
    assert.equal((await db.get('entry-years', { workspaceId: ws }, 'stranger')).status, 403);
    assert.equal((await db.get('entry-years', {})).status, 400);
  });
});
