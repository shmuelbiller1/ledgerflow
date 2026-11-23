/**
 * Sales returns (BF-06): a credit note for an invoice can list the goods that came back. Posting puts
 * them back into stock at the cost they left at (DR Inventory, CR Cost of goods sold), once. A line
 * can't take back more than was sold on it, less earlier returns, checked on the screen and again by
 * the server. Each return is recorded in the stock history; voiding the credit note takes the units
 * out again. The database part runs when LF_TEST_DATABASE_URL is set.
 */
import './helpers/dom';
import test, { after, afterEach, before, beforeEach, describe } from 'node:test';
import { commitAsServer } from './helpers/serverCommit';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { planReturnEntries, returnableLines, returnProblem, SALES_RETURN_TYPE } from '../lib/salesReturns';
import { planInvoiceCogs } from '../services/invoiceCogs';
import { orderedMoves, type StockMove } from '../lib/stockMoves';
import CreditNotesView from '../components/finance/CreditNotesView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import { makeChartAccount, makeInvoice } from './fixtures';
import type { Customer, Invoice, Transaction } from '../types';

const invoice = (id = 'inv1', itemId = 'chair'): Invoice => makeInvoice({
  id, customerId: 'acme', number: 'INV-7', status: 'sent', date: '2026-05-05', currency: 'USD',
  items: [
    { id: 'l1', itemId, description: 'Chair', quantity: 5, rateCents: 9000, amountCents: 45000, accountId: 'sales', unitCostCents: 400 },
    { id: 'l2', description: 'Delivery', quantity: 1, rateCents: 2500, amountCents: 2500, accountId: 'sales' },
  ],
});
const cogsOf = (inv: Invoice, ws = 'w1', ids = { inv: 'inv-acct', cogs: 'cogs-acct' }) => planInvoiceCogs({
  invoiceId: inv.id, invoice: inv, date: '2026-05-05', uid: 'u', workspaceId: ws, baseCurrency: 'USD',
  inventoryAccount: { id: ids.inv, name: 'Inventory' }, cogsAccount: { id: ids.cogs, name: 'COGS' }, items: [{ id: 'chair', name: 'Chair', unitCostCents: 400 }],
}).entries.map((e, i) => ({ ...e, id: `${inv.id}-cogs-${i}` }) as unknown as Transaction);
const back = (id: string, quantity: number, over: Partial<Transaction> = {}) => ({
  id, date: '2026-05-10', status: 'completed', totalAmountCents: quantity * 400, lines: [],
  metadata: { type: SALES_RETURN_TYPE, creditNoteId: `cn-${id}`, invoiceId: 'inv1', returnForLineId: 'l1', inventoryItemId: 'chair', quantity }, ...over,
}) as unknown as Transaction;

describe('The rules', () => {
  test('only lines whose goods left stock; sold, already back and what can still come back', () => {
    const ledger = [...cogsOf(invoice()), back('r1', 2), back('r2', 1), { ...back('r2x', 1), metadata: { isReversal: true, reversesTxId: 'r2' } } as unknown as Transaction];
    assert.deepEqual(returnableLines(invoice(), ledger), [{
      invoiceLineId: 'l1', itemId: 'chair', description: 'Chair', sold: 5, returned: 2, returnable: 3, unitCostCents: 400, saleTotalCents: 2000, returnedCents: 800, unitPriceCents: 9000,
    }]);
    assert.equal(returnableLines(invoice(), ledger, 'cn-r1')[0].returnable, 5, 'a credit note being edited doesn\'t count its own returns');
    assert.deepEqual(returnableLines(invoice(), []), [], 'nothing left stock: nothing to return');
  });

  test('more than can come back, a line of another invoice or a broken quantity is refused', () => {
    const lines = returnableLines(invoice(), [...cogsOf(invoice()), back('r1', 2)]);
    assert.equal(returnProblem([{ invoiceLineId: 'l1', itemId: 'chair', quantity: 3 }], lines), null);
    assert.equal(returnProblem([{ invoiceLineId: 'l1', itemId: 'chair', quantity: 4 }], lines), 'Only 3 of Chair can come back (5 sold, 2 already returned)');
    assert.equal(returnProblem([{ invoiceLineId: 'l2', itemId: 'x', quantity: 1 }], lines), 'Goods can be returned only from the stock lines of the credited invoice');
    assert.equal(returnProblem([{ invoiceLineId: 'l1', itemId: 'chair', quantity: 1.0000001 }], lines), 'Enter how many of Chair came back');
  });

  test('the entry: stock back in at the cost it left at', () => {
    const lines = returnableLines(invoice(), cogsOf(invoice()));
    const [entry] = planReturnEntries({
      creditNote: { id: 'cn1', number: 'CN-1', invoiceId: 'inv1', date: '2026-05-10', returnedGoods: [{ invoiceLineId: 'l1', itemId: 'chair', quantity: 2 }] },
      lines, uid: 'u', workspaceId: 'w1', baseCurrency: 'USD', inventoryAccount: { id: 'inv-acct', name: 'Inventory' }, cogsAccount: { id: 'cogs-acct', name: 'COGS' },
    });
    assert.deepEqual(entry.lines.map(l => [l.accountId, l.amountCents]), [['inv-acct', 800], ['cogs-acct', -800]]);
    assert.deepEqual(entry.metadata, { type: SALES_RETURN_TYPE, creditNoteId: 'cn1', invoiceId: 'inv1', returnForLineId: 'l1', inventoryItemId: 'chair', quantity: 2 });
  });
});

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_returns_${crypto.randomBytes(4).toString('hex')}`;
  const item = `${ws}_chair`;
  const invId = `${ws}_inv`;
  let db: import('../server/db/pgFirestore').Firestore;
  // L94-STEP2B: entries that name a document are the server's own (its posting builds them); sent to the shared commit as the server does
  const post = (transactions: unknown[]) => commitAsServer(db, 'owner-1', { workspaceId: ws, transactions: transactions as never });
  const stock = async () => (await db.collection('inventory').doc(item).get()).data()?.quantityAtHand;
  const ret = (id: string, quantity: number) => {
    const inv = { ...invoice(invId, item), workspaceId: ws } as Invoice;
    const [entry] = planReturnEntries({
      creditNote: { id: `${ws}_cn_${id}`, number: id, invoiceId: invId, date: '2026-05-10', returnedGoods: [{ invoiceLineId: 'l1', itemId: item, quantity }] },
      lines: [{ invoiceLineId: 'l1', itemId: item, description: 'Chair', sold: 5, returned: 0, returnable: 5, unitCostCents: 400, unitPriceCents: 9000 }],
      uid: 'owner-1', workspaceId: ws, baseCurrency: 'USD', inventoryAccount: { id: `${ws}_inv_acct`, name: 'Inventory' }, cogsAccount: { id: `${ws}_cogs`, name: 'COGS' },
    });
    void inv;
    return { ...entry, id: `${ws}_${id}` };
  };

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Chairs', currency: 'USD', members: ['owner-1'] });
    await db.collection('chartAccounts').doc(`${ws}_inv_acct`).set({ workspaceId: ws, name: 'Inventory', type: 'asset', category: 'Inventory', code: '1300' });
    await db.collection('chartAccounts').doc(`${ws}_cogs`).set({ workspaceId: ws, name: 'COGS', type: 'expense', category: 'COGS', code: '5000' });
    await db.collection('inventory').doc(item).set({ workspaceId: ws, name: 'Chair', sku: 'CH-1', unitCostCents: 400, unitPriceCents: 9000, quantityAtHand: 10 });
    const [sale] = cogsOf({ ...invoice(invId, item), workspaceId: ws } as Invoice, ws, { inv: `${ws}_inv_acct`, cogs: `${ws}_cogs` })
      .map(e => ({ ...e, id: `${ws}_sale`, metadata: { ...e.metadata, inventoryItemId: item } }));
    assert.equal((await post([sale])).status, 200);
  });

  after(async () => {
    for (const table of ['transactions', 'inventory', 'stockMoves', 'chartAccounts', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  test('a return puts the units back once; more than was sold is refused; voiding it takes them out again', async () => {
    assert.equal(await stock(), 5, 'five sold');
    const first = ret('r1', 2);
    assert.equal((await post([first])).status, 200);
    assert.equal(await stock(), 7);
    const tooMany = await post([ret('r2', 4)]);
    assert.equal(tooMany.status, 409, JSON.stringify(tooMany.body));
    assert.match(String(tooMany.body.error), /Return at most what was sold/);
    assert.equal(await stock(), 7, 'nothing written');
    assert.equal((await post([ret('r3', 3)])).status, 200);
    assert.equal(await stock(), 10, 'all five back');
    // as the credit note's posting voids it: the reversal names the credit note (the server finds it all the same)
    const voided = { ...first, id: `${ws}_r1x`, description: 'Reversal', metadata: { creditNoteId: first.metadata?.creditNoteId, isReversal: true, reversesTxId: first.id },
      lines: first.lines.map(l => ({ ...l, amountCents: -l.amountCents, debitCents: l.creditCents, creditCents: l.debitCents })) };
    assert.equal((await post([voided])).status, 200);
    assert.equal(await stock(), 8, 'the voided return\'s two go out again');
    // with that return voided, two more may come back again
    assert.equal((await post([ret('r4', 2)])).status, 200);
    assert.equal(await stock(), 10);
    const moves = orderedMoves((await db.collection('stockMoves').where('workspaceId', '==', ws).get()).docs.map(d => d.data() as StockMove));
    assert.deepEqual(moves.map(m => [m.kind, m.quantity, m.quantityAfter, m.documentType]), [
      ['sale', -5, 5, 'invoice'], ['return', 2, 7, 'credit-note'], ['return', 3, 10, 'credit-note'], ['return-reversal', -2, 8, 'credit-note'], ['return', 2, 10, 'credit-note'],
    ]);
  });
});

describe('In the credit note form', () => {
  let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  beforeEach(() => {
    calls = [];
    setComponentWorkspace('owner');
    markComponentCollectionsLoaded('bills', 'creditNotes', 'customers', 'invoices', 'vendorCredits', 'vendors');
    useLedgerStore.setState({
      creditNotes: [], vendorCredits: [], bills: [], vendors: [], invoices: [invoice()], transactions: cogsOf(invoice()),
      customers: [{ id: 'acme', name: 'Acme' } as Customer],
      accounts: [
        makeChartAccount({ id: 'ar', code: '1100', name: 'Accounts Receivable', type: 'asset', category: 'Receivables', role: 'ar' }),
        makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'income', category: 'Revenue' }),
        makeChartAccount({ id: 'inv-acct', code: '1300', name: 'Inventory', type: 'asset', category: 'Inventory' }),
        makeChartAccount({ id: 'cogs-acct', code: '5000', name: 'Cost of Goods Sold', type: 'cost_of_goods', category: 'COGS' }),
      ],
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: JSON.parse(String(init?.body || '{}')) });
      if (url.endsWith('/next-number')) return new Response(JSON.stringify({ number: 'CN-2026-0009' }), { status: 200 });
      return new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('for an invoice: what came back, its price as the credit, and the stock entry posted with it', async () => {
    render(<CreditNotesView />);
    fireEvent.click(screen.getAllByRole('button', { name: /Credit Note/i })[0]);
    fireEvent.change(screen.getByLabelText('Select Customer'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('For invoice (optional)'), { target: { value: 'inv1' } });
    assert.ok(screen.getByRole('group', { name: 'Goods returned' }));
    fireEvent.change(screen.getByLabelText('How many of Chair came back'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Credit their price: \$180\.00/ }));
    assert.equal((screen.getByLabelText(/^Amount \(/) as HTMLInputElement).value, '180.00');
    await act(async () => { fireEvent.submit(screen.getByLabelText(/^Amount \(/).closest('form')!); });
    // only the credit note reaches the command API; the server rebuilds its accounting and stock entries
    // (2 × 4.00 = 8.00 back to Inventory, the return entry checked above)
    const isSave = (c: { url: string }) => c.url.endsWith('/api/v1/commands/creditnote.create');
    await waitFor(() => assert.ok(calls.some(isSave)));
    const body = calls.find(isSave)!.body as { input: { creditNote: Record<string, unknown> } };
    assert.equal('transactions' in body.input, false, 'no entries are sent');
    assert.deepEqual(body.input.creditNote.returnedGoods, [{ invoiceLineId: 'l1', itemId: 'chair', quantity: 2 }]);
  });

  test('more than was sold is refused before saving', async () => {
    render(<CreditNotesView />);
    fireEvent.click(screen.getAllByRole('button', { name: /Credit Note/i })[0]);
    fireEvent.change(screen.getByLabelText('Select Customer'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('For invoice (optional)'), { target: { value: 'inv1' } });
    fireEvent.change(screen.getByLabelText('How many of Chair came back'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '100' } });
    await act(async () => { fireEvent.submit(screen.getByLabelText(/^Amount \(/).closest('form')!); });
    assert.equal(calls.some(c => c.url.includes('/transactions/bulk') || c.url.includes('/documents/creditNotes/') || c.url.endsWith('/commands/creditnote.create')), false);
  });
});
