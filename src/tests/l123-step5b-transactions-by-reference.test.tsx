/**
 * L-123 step 5b: "Transactions by Reference" (TransactionsByReferenceView) reads its list from the server
 * (GET /api/v1/balances/transactions-by-reference, useServerTransactionsByReference) when the loaded entries are capped
 * and the period reaches the oldest loaded day, or the invoices or bills are short.
 *
 * Hand-worked case (cents), the seven entries of helpers/l123RangeLedger (year Y = this year), with references
 * E1 "CHK-1", E4 "CHK-2", E6 "CHK-10"; the year:
 *   CHK-1 E1 900 · CHK-2 E4 700 · CHK-10 E6 200 (numbers in order: 2 before 10); 3 references; 4 entries without one.
 * The loaded four (E4…E7, capped) alone: CHK-2 700 · CHK-10 200; 2 without — CHK-1 is missing.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Y, from, to, chart, entries as ledger, loadedOf, balanceRouteHarness } from './helpers/l123RangeLedger';
import { setComponentWorkspace } from './helpers/componentFixtures';
import TransactionsByReferenceView from '../components/reporting/TransactionsByReferenceView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { computeTransactionsByReference, type TransactionsByReference } from '../server/reports/referenceReport';
import type { Transaction } from '../types';

const REFS: Record<number, string> = { 0: 'CHK-1', 3: 'CHK-2', 5: 'CHK-10' };
const entries = (ws: string): Transaction[] => ledger(ws).map((e, k) => (REFS[k] ? { ...e, reference: REFS[k] } : e));
const brief = (r: TransactionsByReference) => [...r.rows.map(x => `${x.reference} ${x.description} ${x.amountCents}`), `${r.referenceCount} refs, ${r.withoutReference} without`];
const TRUTH = ['CHK-1 E1 900', 'CHK-2 E4 700', 'CHK-10 E6 200', '3 refs, 4 without'];

describe('L-123 step 5b: transactions by reference (no database)', () => {
  const ws = 'component-workspace';
  const all = entries(ws), loaded = loadedOf(all);
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every entry gives the hand-worked list; the loaded four do not', () => {
    assert.deepEqual(brief(computeTransactionsByReference(all, {}, from, to)), TRUTH);
    assert.deepEqual(brief(computeTransactionsByReference(loaded, {}, from, to)), ['CHK-2 E4 700', 'CHK-10 E6 200', '2 refs, 2 without']);
  });

  test('screen: capped entries give the server\'s list with a note; the server cannot be asked: the loaded list, may be incomplete', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts: chart(ws), transactions: loaded, invoices: [], bills: [], truncatedCollections: { transactions: true } } as never);
    const asked: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => { asked.push(String(u)); return Response.json({ status: 'success', references: computeTransactionsByReference(all, {}, from, to) }); }) as typeof fetch;
    const view = render(<TransactionsByReferenceView startDate={from} endDate={to} />);
    await waitFor(() => assert.match(screen.getByTestId('transactions-by-reference-source').textContent || '', /read from every entry and every invoice and bill number on the server/), { timeout: 5000 });
    assert.ok(document.body.textContent!.includes('CHK-1'), 'CHK-1 is only on the server');
    assert.ok(asked.some(u => u.includes(`/api/v1/balances/transactions-by-reference?workspaceId=${ws}&from=${from}&to=${to}`)), asked.join('\n'));
    view.unmount();
    globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
    useLedgerStore.setState({ transactions: [...loaded] });
    render(<TransactionsByReferenceView startDate={from} endDate={to} />);
    await waitFor(() => assert.match(screen.getByTestId('transactions-by-reference-source').textContent || '', /server could not be asked: .* may be incomplete/), { timeout: 5000 });
    assert.ok(!document.body.textContent!.includes('CHK-1 '));
  });

  test('screen: whole lists ask nothing and show no note', () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts: chart(ws), transactions: all, invoices: [], bills: [], truncatedCollections: {} } as never);
    let asked = 0;
    globalThis.fetch = (async () => { asked++; return new Response('{}'); }) as typeof fetch;
    render(<TransactionsByReferenceView startDate={from} endDate={to} />);
    assert.equal(screen.queryByTestId('transactions-by-reference-source'), null);
    assert.ok(document.body.textContent!.includes('CHK-1'));
    assert.equal(asked, 0);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 5b: GET /api/v1/balances/transactions-by-reference', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const db = balanceRouteHarness(url, 'l123ref', w => ({ accounts: chart(w), entries: entries(w) }));
  const ws = db.ws;
  const get = (q: Record<string, string>, uid?: string) => db.get<{ references: TransactionsByReference; entriesRead: number }>('transactions-by-reference', q, uid);
  before(() => db.start());
  after(() => db.stop());

  test('the hand-worked list over every entry of the range; a shorter range; members only; bad ranges', async () => {
    const r = await get({ workspaceId: ws, from, to });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(brief(r.body.references), TRUTH);
    assert.equal(r.body.entriesRead, 7);
    assert.equal(r.cacheControl, 'no-store');
    assert.deepEqual(brief((await get({ workspaceId: ws, from: `${Y}-02-01`, to })).body.references), ['CHK-2 E4 700', 'CHK-10 E6 200', '2 refs, 3 without']);
    assert.equal((await get({ workspaceId: ws, from, to }, 'stranger')).status, 403);
    assert.equal((await get({ workspaceId: ws, from: to, to: from })).status, 400);
  });
});
