/**
 * Service items (BF-01): picking a service fills an invoice or estimate line's name and price but
 * leaves the line unlinked, so it moves no stock and books no cost; bills don't offer services as
 * stock; the item form asks for the kind, and an item with stock on hand stays a stock item.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { applyInventoryItem, setLineDescription, type InvoiceLineDraft } from '../lib/invoiceLines';
import InvoiceModal from '../components/sales/InvoiceModal';
import { EstimateLinesEditor } from '../components/sales/EstimateLinesEditor';
import BillModal from '../components/purchases/BillModal';
import InventoryItemDialog from '../components/inventory/InventoryItemDialog';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { stubFetch } from './helpers/dom';
import { makeChartAccount, makeCustomer, makeVendor } from './fixtures';
import type { Invoice, InventoryItem, Workspace } from '../types';

const chair = { id: 'chair', name: 'Chair', sku: 'CH', unitPriceCents: 5000, unitCostCents: 2000, quantityAtHand: 4 } as InventoryItem;
const setup = { id: 'setup', name: 'Setup', sku: 'SV', unitPriceCents: 12000, unitCostCents: 0, quantityAtHand: 0, itemType: 'service' } as InventoryItem;
const line: InvoiceLineDraft = { id: 'l', description: '', quantity: 2, rateCents: 0, amountCents: 0, accountId: '' };

describe('Service items', () => {
  afterEach(() => { cleanup(); });

  test('a service fills the name and price, unlinked; a stock item links and carries its cost', () => {
    assert.deepEqual(applyInventoryItem({ ...line, itemId: 'chair', unitCostCents: 2000 }, setup), { ...line, itemId: undefined, description: 'Setup', rateCents: 12000, unitCostCents: undefined, amountCents: 24000 });
    assert.deepEqual([setLineDescription(line, 'Chair', [chair, setup]).itemId, setLineDescription(line, 'Chair', [chair, setup]).unitCostCents], ['chair', 2000]);
    assert.equal(setLineDescription(line, 'Setup', [chair, setup]).itemId, undefined);
  });

  describe('on documents', () => {
    test('an invoice line with a service is saved without an item, so no stock moves', async () => {
      stubFetch(404);
      useAuthStore.setState({ currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' } as Workspace] });
      useLedgerStore.setState({ inventory: [chair, setup], taxRates: [] });
      const saved: Partial<Invoice>[] = [];
      render(<InvoiceModal isOpen onClose={() => {}} onSave={inv => { saved.push(inv); }} customers={[makeCustomer({ id: 'c1', name: 'Acme Ltd' })]} accounts={[makeChartAccount({ id: 'rev', name: 'Sales', type: 'income' })]} />);
      fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Acme Ltd' } });
      fireEvent.change(screen.getByLabelText('Item / Description'), { target: { value: 'Setup' } });
      assert.equal((screen.getByLabelText(/^Rate/) as HTMLInputElement).value, '120');
      await act(async () => { fireEvent.click(screen.getByText('Save Draft')); });
      await waitFor(() => assert.equal(saved.length, 1));
      assert.deepEqual(saved[0].items?.map(i => [i.description, i.itemId, i.rateCents]), [['Setup', undefined, 12000]]);
    });

    test('an estimate line shows the service\'s price', () => {
      useLedgerStore.setState({ inventory: [chair, setup] });
      let lines: Array<Record<string, unknown>> = [{ id: 'e1', description: '', quantity: 1, rateCents: 0, amountCents: 0, accountId: '', priceText: '' }];
      render(<EstimateLinesEditor lines={lines as never} onChange={next => { lines = next as never; }} currency="USD" />);
      fireEvent.change(screen.getByLabelText('Item or description, line 1'), { target: { value: 'Setup' } });
      assert.deepEqual([lines[0].itemId, lines[0].priceText], [undefined, '120.00']);
    });

    test('a bill offers only stock items to bring into stock', () => {
      stubFetch(404);
      useAuthStore.setState({ currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' } as Workspace] });
      useLedgerStore.setState({ inventory: [chair, setup], bills: [], transactions: [], taxRates: [] });
      render(<BillModal isOpen onClose={() => {}} onSave={() => {}} vendors={[makeVendor({ id: 'v1', name: 'Supplier' })]} accounts={[makeChartAccount({ id: 'exp', name: 'Purchases', type: 'expense' })]} />);
      const options = [...(screen.getByLabelText('Stock item on line 1') as HTMLSelectElement).options].map(o => o.textContent);
      assert.deepEqual(options, ['None', 'Chair']);
    });
  });

  test('the item form asks for the kind; an item with stock on hand stays a stock item', () => {
    const view = render(<InventoryItemDialog open editingItem={null} categories={[]} canChangeStock onClose={() => {}} onSubmit={() => {}} onAdjust={() => {}} />);
    assert.equal((screen.getByLabelText('Kind') as HTMLSelectElement).value, 'stock');
    assert.equal((screen.getByLabelText('Kind') as HTMLSelectElement).disabled, false);
    view.rerender(<InventoryItemDialog open editingItem={chair} categories={[]} canChangeStock onClose={() => {}} onSubmit={() => {}} onAdjust={() => {}} />);
    assert.equal((screen.getByLabelText('Kind') as HTMLSelectElement).disabled, true);
    assert.ok(screen.getByText('It has stock on hand, so it stays a stock item.'));
  });
});
