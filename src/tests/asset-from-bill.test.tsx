/**
 * A fixed asset from a bill (X-01): bill lines on a fixed-asset account (not cash, receivables,
 * stock, prepayments or accumulated depreciation; not drafts or voids; not already in the register)
 * are offered in "Add asset"; picking one fills the name, cost, date and asset account, and the
 * asset keeps the bill line it came from.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { assetCandidates, isFixedAssetAccount } from '../lib/assetFromBill';
import FixedAssetsView from '../components/assets/FixedAssetsView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeChartAccount } from './fixtures';
import type { Bill } from '../types';
import { getSupabase } from '../lib/db/client';

const accounts = [
  makeChartAccount({ id: 'equip', code: '1500', name: 'Computer equipment', type: 'asset', category: 'Fixed assets' }),
  makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'prepaid', code: '1300', name: 'Prepaid insurance', type: 'asset', category: 'Current assets' }),
  makeChartAccount({ id: 'accum', code: '1590', name: 'Accumulated Depreciation', type: 'asset', category: 'Fixed assets' }),
  makeChartAccount({ id: 'depexp', code: '6400', name: 'Depreciation Expense', type: 'expense', category: 'Operating' }),
  makeChartAccount({ id: 'office', code: '6100', name: 'Office', type: 'expense', category: 'Operating' }),
];
const bill = (id: string, status: string, splits: Bill['splits'], date = '2026-09-20') =>
  ({ id, uid: 'u', workspaceId: 'component-workspace', vendorId: 'v', vendorName: 'Dell', number: id.toUpperCase(), amountCents: 0, status, date, dueDate: date, splits } as unknown as Bill);
const bills = [
  bill('b1', 'pending', [{ accountId: 'equip', amountCents: 180_000, description: 'Laptop for Dana' }, { accountId: 'office', amountCents: 5_000, description: 'Mouse' }]),
  bill('b2', 'draft', [{ accountId: 'equip', amountCents: 90_000, description: 'Draft monitor' }]),
  bill('b3', 'paid', [{ accountId: 'prepaid', amountCents: 120_000, description: 'Insurance' }, { accountId: 'equip', amountCents: 40_000, description: 'Printer' }], '2026-08-02'),
];

describe('Assets from bills', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('fixed-asset accounts only; drafts and lines already in the register left out; newest first', () => {
    assert.deepEqual(accounts.map(a => isFixedAssetAccount(a)), [true, false, false, false, false, false]);
    assert.deepEqual(assetCandidates(bills, accounts, []).map(c => [c.billId, c.line, c.name, c.costCents, c.date]),
      [['b1', 0, 'Laptop for Dana', 180_000, '2026-09-20'], ['b3', 1, 'Printer', 40_000, '2026-08-02']]);
    assert.deepEqual(assetCandidates(bills, accounts, [{ sourceBillId: 'b3', sourceBillLine: 1 }]).map(c => c.name), ['Laptop for Dana']);
  });

  test('picking a bill line fills the form, and the asset keeps where it came from', async () => {
    setComponentWorkspace('bookkeeper');
    useLedgerStore.setState({ assets: [], accounts, bills } as never);
    markComponentCollectionsLoaded('assets', 'bills');
    const calls: Array<{ url: string; body: { p_table?: string; p_data?: Record<string, unknown> } }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} });
      return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    render(<FixedAssetsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Add asset' }));
    fireEvent.change(screen.getByLabelText('From a bill (optional)'), { target: { value: 'b1#0' } });
    assert.deepEqual([
      (screen.getByLabelText('Name') as HTMLInputElement).value, (screen.getByLabelText('Cost') as HTMLInputElement).value,
      (screen.getByLabelText('Bought on') as HTMLInputElement).value, (screen.getByLabelText('Asset account (optional)') as HTMLSelectElement).value,
    ], ['Laptop for Dana', '1800.00', '2026-09-20', 'equip']);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    // a new asset is an ordinary record: it is created by naming `record.save`
    const creates = () => calls.filter(c => c.url.includes('/commands/record.save'))
      .map(c => (c.body as { input: { collection: string; data: Record<string, unknown> } }).input)
      .filter(input => input.collection === 'assets');
    await waitFor(() => assert.ok(creates().length > 0));
    const saved = creates()[0].data;
    assert.deepEqual([saved.name, saved.purchasePriceCents, saved.sourceBillId, saved.sourceBillLine, saved.assetAccountId], ['Laptop for Dana', 180_000, 'b1', 0, 'equip']);
  });
});
