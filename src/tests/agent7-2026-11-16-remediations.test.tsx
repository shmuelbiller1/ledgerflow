/**
 * Agent #7 (2026-11-16) authorized-lane remediations A7C-01..A7C-07.
 *
 * Each block locks one direct fix against regression with real behavior (no tautological mocks):
 * - A7C-01: "/" label conversion skips colliding short names (NFC case-insensitive) and converts
 *   case-variant parents under one created parent.
 * - A7C-02: free invoice maker rejects malformed tax/quantity text, overflowing rates, impossible
 *   calendar dates and out-of-range tax %; a stashed draft opens after auth hydration and stays
 *   closed once dismissed, and its customer re-resolves when customers hydrate.
 * - A7C-03: the hash-chain check accepts intervening server-signed unlinked entries and rejects
 *   self/future/stale pointers.
 * - A7C-04 / A7C-05: the Vault cases live in agent7-2026-11-16-vault-remediations.test.tsx; the
 *   Vault and Sales screens cannot share one test process without exhausting its heap.
 * - A7C-06: quick-add defaults to the workspace currency instead of hardcoded USD.
 * - A7C-07: auto-reconcile keeps signatures aligned with postable entries and matches JPY and
 *   fee-netted cash amounts.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DoubleEntryAuditor } from '../services/auditor';
import { slashConversionPlan, slashConversionSkipped } from '../lib/labelTree';
import { SlashConversionOffer } from '../components/platform/settings/LabelTreeControls';
import {
  FREE_INVOICE_STORAGE_KEY, freeInvoiceProblem, parseQuantity, parseRate, parseTaxPercent,
  stashFreeInvoice, type FreeInvoice,
} from '../lib/freeInvoice';
import FreeInvoiceMaker from '../components/public/FreeInvoiceMaker';
import Sales from '../components/sales/Sales';
import { createReconcileActions } from '../hooks/transactionActions/reconcileActions';
import { testEntryActions } from './helpers/entryActions';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount, makeCustomer, makeTransaction } from './fixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { BankStatementLine, ChartAccount, DimensionNode, Transaction } from '../types';

const realFetch = globalThis.fetch;
const realConfirm = window.confirm;

afterEach(async () => {
  cleanup();
  globalThis.fetch = realFetch;
  window.confirm = realConfirm;
  localStorage.clear();
  getSupabase().realtime.disconnect();
  await getSupabase().auth.dispose();
});

// ---------------------------------------------------------------------------
// A7C-01: "/" conversion collision safety (pure plan + offer + convert)
// ---------------------------------------------------------------------------

const vaultAccounts = [
  makeChartAccount({ id: 'bank', name: 'Operating Bank', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'exp', name: 'Office Supplies', type: 'expense', category: 'Expenses' }),
];

const node = (id: string, description: string, extra: Partial<DimensionNode> = {}): DimensionNode =>
  ({ id, dimensionId: 'property', description, ...extra }) as DimensionNode;

describe('A7C-01: slash conversion skips colliding short names', () => {
  test('a short name another value already uses (any case) is skipped, not planned', () => {
    const nodes = [node('R1', 'North'), node('X1', 'Maui House'), node('P1', 'North / maui house')];
    assert.deepEqual(slashConversionPlan(nodes, 'property'), []);
    const skipped = slashConversionSkipped(nodes, 'property');
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].nodeId, 'P1');
    assert.match(skipped[0].reason, /already uses/);
  });

  test('NFC: a decomposed parent matches the composed existing parent; a decomposed short name collides', () => {
    const composed = 'Café'; // NFC: single code point U+00E9
    const decomposed = 'Café'; // e + combining acute U+0301
    assert.notEqual(composed, decomposed);
    const nodes = [node('P', composed), node('C1', `${decomposed} / Bar`), node('C2', `X / ${decomposed}`)];
    const plan = slashConversionPlan(nodes, 'property');
    // C1's parent is the existing composed value (matched through NFC), so it is planned under it
    assert.deepEqual(plan, [{ nodeId: 'C1', from: `${decomposed} / Bar`, newName: 'Bar', parentName: decomposed, parentId: 'P' }]);
    // C2's short name is the composed value's name once normalized: skipped
    const skipped = slashConversionSkipped(nodes, 'property');
    assert.deepEqual(skipped.map(s => s.nodeId), ['C2']);
    assert.match(skipped[0].reason, /already uses/);
  });

  test('a short name that is also a parent to be created is skipped; the parent row itself is planned', () => {
    const nodes = [node('A', 'X / Y'), node('B', 'Z / X')];
    assert.deepEqual(slashConversionPlan(nodes, 'property').map(p => p.nodeId), ['A']);
    const skipped = slashConversionSkipped(nodes, 'property');
    assert.deepEqual(skipped.map(s => s.nodeId), ['B']);
    assert.match(skipped[0].reason, /also a parent to be created/);
  });

  test('two rows that would become the same short name are both skipped', () => {
    const nodes = [node('A', 'North / Unit'), node('B', 'South / Unit')];
    assert.deepEqual(slashConversionPlan(nodes, 'property'), []);
    assert.deepEqual(slashConversionSkipped(nodes, 'property').map(s => s.nodeId).sort(), ['A', 'B']);
  });

  test('non-colliding rows are still planned (existing behavior preserved)', () => {
    const nodes = [node('R1', 'North'), node('P1', 'North / Maui house'), node('P2', 'south/Aspen cabin')];
    assert.deepEqual(slashConversionPlan(nodes, 'property'), [
      { nodeId: 'P1', from: 'North / Maui house', newName: 'Maui house', parentName: 'North', parentId: 'R1' },
      { nodeId: 'P2', from: 'south/Aspen cabin', newName: 'Aspen cabin', parentName: 'south', parentId: null },
    ]);
    assert.deepEqual(slashConversionSkipped(nodes, 'property'), []);
  });

  test('the offer shows skipped rows with reasons and no Convert button when nothing is planned', () => {
    const nodes = [node('R1', 'North'), node('X1', 'Maui House'), node('P1', 'North / maui house')];
    useLedgerStore.setState({ dimensionNodes: nodes });
    render(<SlashConversionOffer dimensionId="property" plan={slashConversionPlan(nodes, 'property')} onChanged={() => {}} />);
    assert.match(document.body.textContent || '', /need unique names before converting/);
    assert.match(document.body.textContent || '', /Skipped/);
    assert.match(document.body.textContent || '', /already uses/);
    assert.equal(screen.queryByRole('button', { name: /Convert these/ }), null);
  });

  test('convert creates one parent for case-variant parent names and links both children under it', async () => {
    setComponentWorkspace('owner');
    const nodes = [node('A', 'North / Unit 1'), node('B', 'north / Unit 2')];
    useLedgerStore.setState({ dimensionNodes: nodes, truncatedCollections: {} });
    const inserts: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      assert.ok(!(url.includes('/rest/v1/dimensionNodes') && method === 'POST'), 'no direct label write');
      if (url.includes('/commands/workspace.dimensionnode') && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { input: Record<string, unknown> };
        if (body.input.createOnly) inserts.push(body.input);
        return new Response(JSON.stringify({ status: 'success', data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    render(<SlashConversionOffer dimensionId="property" plan={slashConversionPlan(nodes, 'property')} onChanged={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Convert these 2/ })); });
    await waitFor(() => {
      const stored = useLedgerStore.getState().dimensionNodes;
      assert.equal(stored.find(n => n.id === 'A')?.parentId !== undefined, true);
      assert.equal(stored.find(n => n.id === 'B')?.parentId !== undefined, true);
    });
    const stored = useLedgerStore.getState().dimensionNodes;
    const parentA = stored.find(n => n.id === 'A')!;
    const parentB = stored.find(n => n.id === 'B')!;
    assert.equal(parentA.parentId, parentB.parentId, 'both children sit under the one created parent');
    assert.equal(parentA.description, 'Unit 1');
    assert.equal(parentB.description, 'Unit 2');
    assert.equal(stored.filter(n => n.description === 'North').length, 1, 'exactly one parent was created');
    assert.equal(inserts.length, 1, 'one create-only insert for the shared parent');
  });
});

// ---------------------------------------------------------------------------
// A7C-02: free invoice maker validation (pure + maker + Sales hydration)
// ---------------------------------------------------------------------------

const freeBase: FreeInvoice = {
  from: 'Dana Design', to: 'Acme Ltd', number: '7', date: '2026-11-16', dueDate: '2026-11-30',
  currency: 'USD', taxRate: 17,
  lines: [{ description: 'Logo design', quantity: 2, rateCents: 12_050 }],
};

describe('A7C-02: free invoice maker validation', () => {
  test('tax % and quantity text: malformed input is null, empty is zero', () => {
    assert.equal(parseTaxPercent('17'), 17);
    assert.equal(parseTaxPercent('8.25'), 8.25);
    assert.equal(parseTaxPercent(''), 0);
    assert.equal(parseTaxPercent('  '), 0);
    assert.equal(parseTaxPercent('abc'), null);
    assert.equal(parseTaxPercent('17,5'), null, 'a comma decimal is not silently read as 175 or 17');
    assert.equal(parseQuantity('2'), 2);
    assert.equal(parseQuantity('1.5'), 1.5);
    assert.equal(parseQuantity(''), 0);
    assert.equal(parseQuantity('abc'), null);
    assert.equal(parseQuantity('1,5'), null);
  });

  test('rates beyond safe integer bounds are refused instead of overflowing', () => {
    assert.equal(parseRate('120.50', 'USD'), 12_050);
    assert.equal(parseRate('99999999999999999999', 'USD'), null);
    assert.equal(parseRate('9007199254740991', 'USD'), null, 'the major part alone overflows once scaled');
    assert.equal(parseRate('90071992547409.92', 'USD'), null, 'the scaled cents exceed the safe range');
  });

  test('impossible calendar dates and out-of-range tax % stop the invoice', () => {
    assert.equal(freeInvoiceProblem(freeBase), null);
    assert.equal(freeInvoiceProblem({ ...freeBase, date: '2026-02-30' }), 'Choose the invoice date.');
    assert.equal(freeInvoiceProblem({ ...freeBase, date: '2026-13-01' }), 'Choose the invoice date.');
    assert.equal(freeInvoiceProblem({ ...freeBase, dueDate: '2026-02-29' }), 'Choose a real due date.', '2026 is not a leap year');
    assert.equal(freeInvoiceProblem({ ...freeBase, taxRate: 101 }), 'Enter a tax % between 0 and 100.');
    assert.equal(freeInvoiceProblem({ ...freeBase, taxRate: -1 }), 'Enter a tax % between 0 and 100.');
    assert.equal(freeInvoiceProblem({ ...freeBase, taxRate: Number.NaN }), 'Enter a tax % between 0 and 100.');
    assert.equal(freeInvoiceProblem({ ...freeBase, taxRate: 100 }), null);
  });

  test('a line amount beyond safe integer bounds stops the invoice', () => {
    assert.equal(
      freeInvoiceProblem({ ...freeBase, lines: [{ description: 'x', quantity: 10_000_000_000, rateCents: 10_000_000_000 }] }),
      'Line amount is too large.',
    );
  });

  test('the maker names the bad field instead of silently zeroing it', () => {
    setComponentWorkspace('owner');
    render(<FreeInvoiceMaker />);
    const print = () => screen.getByRole('button', { name: /Print or save as PDF/ }) as HTMLButtonElement;
    assert.equal(print().disabled, true, 'nothing to bill yet');
    fireEvent.change(screen.getByLabelText('Bill to'), { target: { value: 'Acme Ltd' } });
    fireEvent.change(screen.getByLabelText('Line 1 description'), { target: { value: 'Logo design' } });
    fireEvent.change(screen.getByLabelText('Line 1 price'), { target: { value: '120.50' } });
    assert.equal(print().disabled, false, 'a complete invoice can be printed');
    fireEvent.change(screen.getByLabelText('Tax %'), { target: { value: 'abc' } });
    assert.match(document.body.textContent || '', /Type the tax % as a number/);
    assert.equal(print().disabled, true);
    fireEvent.change(screen.getByLabelText('Tax %'), { target: { value: '17,5' } });
    assert.match(document.body.textContent || '', /Type the tax % as a number/);
    fireEvent.change(screen.getByLabelText('Tax %'), { target: { value: '17' } });
    assert.equal(print().disabled, false);
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: 'abc' } });
    assert.match(document.body.textContent || '', /Line 1: type the quantity as a number/);
    assert.equal(print().disabled, true);
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Line 1 price'), { target: { value: '99999999999999999999' } });
    assert.match(document.body.textContent || '', /Line 1: type the price as a number/);
    assert.equal(print().disabled, true);
  });

  test('a stashed draft opens after auth hydrates, stays closed once dismissed, and re-resolves its customer', async () => {
    const ws = setComponentWorkspace('owner');
    markComponentCollectionsLoaded('creditNotes', 'customers', 'invoices', 'payments', 'accounts');
    const draft: FreeInvoice = { ...freeBase, to: 'acme ltd' };
    assert.equal(stashFreeInvoice(window.localStorage, draft, 'test-user', ws.id), true);
    // pre-hydration: no signed-in user yet, so the draft must not open
    useAuthStore.setState({ user: null, isGuest: false });
    useLedgerStore.setState({ accounts: [], invoices: [], customers: [], payments: [], creditNotes: [] });
    globalThis.fetch = (async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    render(<Sales />);
    assert.equal(screen.queryByRole('dialog'), null, 'no draft before the session hydrates');
    // hydration completes: the signed-in workspace that stashed the draft picks it up
    useAuthStore.setState({ user: ws.uid === 'test-user' ? useAuthStore.getState().user : useAuthStore.getState().user });
    const { setComponentWorkspace: rehydrate } = await import('./helpers/componentFixtures');
    rehydrate('owner');
    await waitFor(() => assert.ok(screen.getByRole('dialog'), 'the draft opens once auth hydrates'));
    const customerInput = () => document.getElementById('inv-customer') as HTMLInputElement;
    assert.equal(customerInput().value, 'acme ltd', 'no customer matched yet');
    // customers hydrate: the provisional new- customer re-resolves to the real one
    useLedgerStore.setState({ customers: [makeCustomer({ id: 'c9', name: 'Acme Ltd' })] });
    await waitFor(() => assert.equal(customerInput().value, 'Acme Ltd', 'the customer re-resolves once customers load'));
    // dismissing clears the stored draft and a later session change must not reopen it
    const dialog = screen.getByRole('dialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Close' })); });
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    assert.equal(localStorage.getItem(FREE_INVOICE_STORAGE_KEY), null, 'the stored copy is cleared on close');
    useAuthStore.setState({ currentWorkspaceId: 'another-workspace' });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    assert.equal(screen.queryByRole('dialog'), null, 'a dismissed draft does not reopen on session change');
  });
});

// ---------------------------------------------------------------------------
// A7C-03: causal hash-chain verification
// ---------------------------------------------------------------------------

const chainAccounts = [{ id: 'ar', name: 'A/R', type: 'asset' }, { id: 'rev', name: 'Sales', type: 'income' }] as ChartAccount[];
const chainEntry = (id: string, createdAt: string, verification?: Record<string, string>): Transaction => ({
  id, workspaceId: 'w', uid: 'u', date: createdAt.slice(0, 10), createdAt, description: id,
  status: 'completed', type: 'actual', totalAmountCents: 1000,
  lines: [{ accountId: 'ar', amountCents: 1000 }, { accountId: 'rev', amountCents: -1000 }],
  ...(verification ? { verification } : {}),
} as unknown as Transaction);

describe('A7C-03: hash chain accepts intervening signed entries, rejects bad pointers', () => {
  test('a linked entry pointing at an intervening unlinked signed entry is valid', () => {
    const result = DoubleEntryAuditor.auditLedger([
      chainEntry('a', '2026-11-01T10:00:00Z', { hash: 'ha', previousHash: 'genesis' }),
      chainEntry('u', '2026-11-02T10:00:00Z', { hash: 'hu' }),
      chainEntry('b', '2026-11-03T10:00:00Z', { hash: 'hb', previousHash: 'hu' }),
    ], chainAccounts);
    assert.equal(result.hashChainValid, true);
    assert.equal(result.brokenChainIndex, null);
  });

  test('the first linked entry may point at an unlinked signed entry before it', () => {
    const result = DoubleEntryAuditor.auditLedger([
      chainEntry('u', '2026-11-01T10:00:00Z', { hash: 'hu' }),
      chainEntry('a', '2026-11-02T10:00:00Z', { hash: 'ha', previousHash: 'hu' }),
    ], chainAccounts);
    assert.equal(result.hashChainValid, true);
  });

  test('a self-link is broken even though the hash exists in the ledger', () => {
    const result = DoubleEntryAuditor.auditLedger([
      chainEntry('a', '2026-11-01T10:00:00Z', { hash: 'ha', previousHash: 'ha' }),
    ], chainAccounts);
    assert.equal(result.hashChainValid, false);
    assert.equal(result.brokenChainIndex, 0);
  });

  test('a pointer to a future entry is broken', () => {
    const result = DoubleEntryAuditor.auditLedger([
      chainEntry('a', '2026-11-01T10:00:00Z', { hash: 'ha', previousHash: 'genesis' }),
      chainEntry('b', '2026-11-02T10:00:00Z', { hash: 'hb', previousHash: 'hc' }),
      chainEntry('c', '2026-11-03T10:00:00Z', { hash: 'hc' }),
    ], chainAccounts);
    assert.equal(result.hashChainValid, false);
    assert.equal(result.brokenChainIndex, 1);
  });

  test('a stale pointer (skipping the preceding linked entry) is broken', () => {
    const result = DoubleEntryAuditor.auditLedger([
      chainEntry('a', '2026-11-01T10:00:00Z', { hash: 'ha', previousHash: 'genesis' }),
      chainEntry('b', '2026-11-02T10:00:00Z', { hash: 'hb', previousHash: 'ha' }),
      chainEntry('c', '2026-11-03T10:00:00Z', { hash: 'hc', previousHash: 'ha' }),
    ], chainAccounts);
    assert.equal(result.hashChainValid, false);
    assert.equal(result.brokenChainIndex, 2);
  });
});

// ---------------------------------------------------------------------------
// A7C-06: quick-add workspace currency default
// ---------------------------------------------------------------------------

describe('A7C-06: quick-add uses the workspace currency', () => {
  test('an entry without a currency posts in the workspace currency; an explicit one is kept', async () => {
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({ workspaces: [{ ...ws, currency: 'ILS' }] });
    const posted: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      posted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ status: 'success', data: { id: 'tx1' } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const actions = testEntryActions('component-workspace', vaultAccounts);
    const lines = [{ accountId: 'bank', amountCents: 1000 }, { accountId: 'exp', amountCents: -1000 }];
    assert.equal(await actions.handleQuickAdd({ description: 'Default currency', totalAmountCents: 1000, lines } as Partial<Transaction>), true);
    assert.equal((posted[0].transaction as Record<string, unknown>).currency, 'ILS');
    assert.equal(await actions.handleQuickAdd({ description: 'Explicit currency', totalAmountCents: 1000, currency: 'EUR', lines } as Partial<Transaction>), true);
    assert.equal((posted[1].transaction as Record<string, unknown>).currency, 'EUR');
  });
});

// ---------------------------------------------------------------------------
// A7C-07: auto-reconcile alignment and minor-unit / cash-delta matching
// ---------------------------------------------------------------------------

const reconcileAccounts = [
  makeChartAccount({ id: 'bank', name: 'Checking', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'sales', name: 'Sales', type: 'income', category: 'Revenue' }),
  makeChartAccount({ id: 'fee', name: 'Bank Fees', type: 'expense', category: 'Expenses' }),
];
const bankLine = (overrides: Partial<BankStatementLine>): BankStatementLine => ({
  id: 'b1', workspaceId: 'component-workspace', date: '2026-10-10', description: 'ACME PAYMENT',
  amountCents: 50_000, status: 'pending', accountId: 'bank', ...overrides,
} as BankStatementLine);

type FetchCall = { url: string; method: string; body: unknown; headers: Record<string, string> };

async function runAutoReconcile(transactions: Transaction[], lines: BankStatementLine[]) {
  setComponentWorkspace('owner');
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input), method: init?.method || 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, headers: {},
    });
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const actions = createReconcileActions(
    { user: { uid: 'test-user' }, currentWorkspaceId: 'component-workspace', accounts: reconcileAccounts, setIsSyncing: () => {} } as never,
    { balanceTransactionLines: (l: unknown) => l } as never,
  );
  await actions.handleAutoReconcile({ bankLines: lines, transactions });
  return calls.filter(c => c.url.includes('/transactions/reconcile'));
}

describe('A7C-07: auto-reconcile stays aligned and respects minor units', () => {
  test('a draft that looks like the bank line cannot lend its signature to a postable entry', async () => {
    // Alignment guard: signatures are built over postable entries only. The draft carries the bank
    // line's words and amount while the postable entry does not, so a signature list built over every
    // transaction would score the postable entry with the draft's signature (verified: 1.0 instead of
    // 0.203) and reconcile two unrelated things.
    const draft = makeTransaction({
      id: 'draft1', date: '2026-10-10', description: 'ACME PAYMENT', totalAmountCents: 50_000, status: 'draft',
      lines: [{ accountId: 'bank', amountCents: 50_000 }, { accountId: 'sales', amountCents: -50_000 }],
    });
    const postable = makeTransaction({
      id: 't1', date: '2026-10-01', description: 'ZQ HOLDINGS TRANSFER', totalAmountCents: 50_000, status: 'completed',
      lines: [{ accountId: 'bank', amountCents: 50_000 }, { accountId: 'sales', amountCents: -50_000 }],
    });
    // 9 days apart, so the date cannot carry the match and the description has to
    const calls = await runAutoReconcile([draft, postable], [bankLine({})]);
    assert.equal(calls.length, 0, 'no confident pair, so nothing is reconciled');
  });

  test('a genuine match is reconciled to its own entry even when drafts sit before it', async () => {
    const drafts = [0, 1].map(i => makeTransaction({
      id: `draft${i}`, date: '2026-10-09', description: `UNRELATED DRAFT ${i}`, totalAmountCents: 1_000 + i, status: 'draft',
      lines: [{ accountId: 'bank', amountCents: 1_000 + i }, { accountId: 'sales', amountCents: -(1_000 + i) }],
    }));
    const postable = makeTransaction({
      id: 't1', date: '2026-10-10', description: 'ACME PAYMENT', totalAmountCents: 50_000, status: 'completed',
      lines: [{ accountId: 'bank', amountCents: 50_000 }, { accountId: 'sales', amountCents: -50_000 }],
    });
    const calls = await runAutoReconcile([...drafts, postable], [bankLine({})]);
    assert.equal(calls.length, 1);
    const operations = (calls[0].body as { operations: Array<{ id: string; data: { matchedTransactionId?: string; status?: string } }> }).operations;
    assert.equal(operations[0].data.matchedTransactionId, 't1');
    assert.equal(operations[1].id, 't1');
    assert.equal(operations[1].data.status, 'reconciled');
  });

  test('a JPY entry matches a USD bank line through minor-unit conversion', async () => {
    const jpy = makeTransaction({
      id: 't-jpy', date: '2026-10-10', description: 'ACME PAYMENT', totalAmountCents: 10_000,
      currency: 'JPY', exchangeRate: 0.0067, status: 'completed',
      lines: [{ accountId: 'bank', amountCents: 10_000 }, { accountId: 'sales', amountCents: -10_000 }],
    });
    // ¥10,000 at 0.0067 is $67.00 = 6,700 USD cents (not 67)
    const calls = await runAutoReconcile([jpy], [bankLine({ amountCents: 6_700 })]);
    assert.equal(calls.length, 1, 'the converted amount matches');
    const operations = (calls[0].body as { operations: Array<{ data: { matchedTransactionId?: string } }> }).operations;
    assert.equal(operations[0].data.matchedTransactionId, 't-jpy');
  });

  test('a fee-netted entry matches the bank line by its cash movement, not its total', async () => {
    const netted = makeTransaction({
      id: 't-net', date: '2026-10-10', description: 'ACME PAYMENT', totalAmountCents: 10_000, status: 'completed',
      lines: [
        { accountId: 'bank', amountCents: 9_500 },
        { accountId: 'fee', amountCents: 500 },
        { accountId: 'sales', amountCents: -10_000 },
      ],
    });
    const calls = await runAutoReconcile([netted], [bankLine({ amountCents: 9_500 })]);
    assert.equal(calls.length, 1, 'the bank saw 9,500 after the 500 fee');
    const operations = (calls[0].body as { operations: Array<{ data: { matchedTransactionId?: string } }> }).operations;
    assert.equal(operations[0].data.matchedTransactionId, 't-net');
  });

  test('an amount that matches nothing sends nothing', async () => {
    const postable = makeTransaction({
      id: 't1', date: '2026-10-10', description: 'ACME PAYMENT', totalAmountCents: 50_000, status: 'completed',
      lines: [{ accountId: 'bank', amountCents: 50_000 }, { accountId: 'sales', amountCents: -50_000 }],
    });
    const calls = await runAutoReconcile([postable], [bankLine({ amountCents: 12_345 })]);
    assert.equal(calls.length, 0, 'no confident pair, no request');
  });
});
