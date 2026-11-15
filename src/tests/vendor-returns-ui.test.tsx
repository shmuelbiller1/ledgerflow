/**
 * Purchase returns on screen (BF-07): a vendor credit for one of the vendor's bills lists the bill's
 * stock lines; what goes back offers its cost as the credit, is saved with the credit, and its entry
 * takes that value off Inventory and lists the units for the server; more than is left is refused.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreditNotesView from '../components/finance/CreditNotesView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import { makeChartAccount } from './fixtures';
import { postVendorCreditLedger } from '../services/ledgerPost/creditPosting';
import type { LedgerPostContext } from '../services/ledgerPost/postingCore';
import type { Bill, Vendor, Workspace } from '../types';

const bill = { id: 'b1', workspaceId: 'component-workspace', vendorId: 'v1', vendorName: 'Furniture Co', number: 'B-1', date: '2026-04-01', dueDate: '2026-05-01', status: 'pending', currency: 'USD', amountCents: 4500,
  splits: [{ amountCents: 4000, accountId: 'office', description: 'Chairs', itemId: 'chair', quantity: 4 }, { amountCents: 500, accountId: 'office', description: 'Delivery' }] } as unknown as Bill;

describe('Sending stock back on a vendor credit', () => {
  let workspace: Workspace;
  let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  beforeEach(() => {
    calls = [];
    workspace = setComponentWorkspace('owner');
    markComponentCollectionsLoaded('bills', 'creditNotes', 'customers', 'invoices', 'vendorCredits', 'vendors');
    useLedgerStore.setState({
      creditNotes: [], vendorCredits: [], invoices: [], customers: [], transactions: [], bills: [bill],
      vendors: [{ id: 'v1', name: 'Furniture Co' } as Vendor],
      accounts: [
        makeChartAccount({ id: 'ap', code: '2000', name: 'Accounts Payable', type: 'liability', category: 'Payables' }),
        makeChartAccount({ id: 'office', code: '6000', name: 'Office expenses', type: 'expense', category: 'Expense' }),
        makeChartAccount({ id: 'inv-acct', code: '1300', name: 'Inventory', type: 'asset', category: 'Inventory' }),
      ],
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: JSON.parse(String(init?.body || '{}')) });
      if (url.endsWith('/next-number')) return new Response(JSON.stringify({ number: 'VC-2026-0001' }), { status: 200 });
      return new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  const open = () => {
    render(<CreditNotesView />);
    fireEvent.click(screen.getByRole('button', { name: /Vendor Credits \(A\/P\)/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /Vendor Credit/i }).find(b => /New/.test(b.textContent || ''))!);
    fireEvent.change(screen.getByLabelText('Select Vendor'), { target: { value: 'v1' } });
    fireEvent.change(screen.getByLabelText('Credited bill (optional)'), { target: { value: 'b1' } });
  };

  test('2 of the 4 chairs go back: their cost is the credit, saved with it, off Inventory', async () => {
    open();
    assert.ok(screen.getByRole('group', { name: 'Goods sent back' }));
    fireEvent.change(screen.getByLabelText('How many of Chairs go back'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Credit their cost: \$20\.00/ }));
    assert.equal((screen.getByLabelText(/^Amount \(/) as HTMLInputElement).value, '20.00');
    await act(async () => { fireEvent.submit(screen.getByLabelText(/^Amount \(/).closest('form')!); });
    // The registered command carries the document input; the server builds its ledger entries from this payload.
    const route = /\/api\/v1\/commands\/vendorcredit\.create$/;
    await waitFor(() => assert.ok(calls.some(c => route.test(c.url))));
    const body = calls.find(c => route.test(c.url))!.body as { workspaceId: string; input: { vendorCredit: Record<string, unknown> } };
    const data = body.input.vendorCredit;
    assert.equal(body.workspaceId, workspace.id);
    assert.deepEqual(data.returnedGoods, [{ billLine: 0, itemId: 'chair', quantity: 2, valueCents: 2000 }]);
    const context: LedgerPostContext = { accounts: useLedgerStore.getState().accounts, workspaces: [workspace], transactions: [], inventory: [], lockDate: null, uid: 'u1', today: '2026-10-22', capture: [] };
    const id = String(data.id);
    await postVendorCreditLedger(id, data as never, workspace.id, 'u1', { collection: 'vendorCredits', docId: id, action: 'create', data }, context);
    const entry = context.capture!.flatMap(c => c.txs).find(t => t.metadata?.type === 'vendor-credit-issuance')!;
    assert.deepEqual(entry.lines.map(l => [l.accountId, l.amountCents]), [['ap', 2000], ['inv-acct', -2000]]);
    // DIM-2 phase 2: each line sent back also names the bill line it came in on
    assert.deepEqual(entry.metadata?.stockOut, [{ itemId: 'chair', quantity: 2, valueCents: 2000, billLine: 0 }]);
    assert.equal(calls.some(c => c.url.endsWith('/transactions/bulk')), false, 'no entries from the browser');
  });

  test('more than the bill brought in is refused before saving', async () => {
    open();
    fireEvent.change(screen.getByLabelText('How many of Chairs go back'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '100' } });
    await act(async () => { fireEvent.submit(screen.getByLabelText(/^Amount \(/).closest('form')!); });
    assert.equal(calls.some(c => /\/transactions\/bulk$|\/documents\/|\/commands\/vendorcredit\.create$/.test(c.url)), false);
  });
});
