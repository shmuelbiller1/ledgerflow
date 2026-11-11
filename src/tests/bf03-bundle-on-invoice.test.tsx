/**
 * BF-03: picking a bundle on an invoice line puts its parts on the invoice, each a line of its own with its own price,
 * cost and stock link. By hand: "Starter kit" = 1 Widget (10.00, cost 4.00) + 2 Cable (2.50, cost 1.00); typed on a line
 * of quantity 3 → Widget 3 × 10.00 = 30.00 and Cable 6 × 2.50 = 15.00; with a customer price of 9.00 for the Widget, 27.00.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DocumentLineEditor, { type InvoiceEditorLine } from '../components/common/DocumentLineEditor';
import { bundleInvoiceLines } from '../lib/itemBundles';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { InventoryItem } from '../types';

afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

const items = [
  { id: 'widget', name: 'Widget', unitPriceCents: 1000, unitCostCents: 400, itemType: 'stock' },
  { id: 'cable', name: 'Cable', unitPriceCents: 250, unitCostCents: 100, itemType: 'stock' },
  { id: 'kit', name: 'Starter kit', unitPriceCents: 0, bundleParts: [{ itemId: 'widget', quantity: 1 }, { itemId: 'cable', quantity: 2 }] },
] as unknown as InventoryItem[];
let n = 0;
const createLine = (): InvoiceEditorLine => ({ id: `l${++n}`, description: '', quantity: 1, rateCents: 0, amountCents: 0, accountId: 'sales' } as InvoiceEditorLine);

test('BF-03: a bundle becomes its parts, priced and linked like typed items', () => {
  const lines = bundleInvoiceLines(items[2], 3, items, createLine);
  assert.deepEqual(lines.map(l => [l.itemId, l.description, l.quantity, l.rateCents, l.amountCents, l.unitCostCents]), [
    ['widget', 'Widget', 3, 1000, 3000, 400],
    ['cable', 'Cable', 6, 250, 1500, 100],
  ]);
  const priced = bundleInvoiceLines(items[2], 3, items, createLine, item => (item.id === 'widget' ? 900 : item.unitPriceCents));
  assert.equal(priced[0].amountCents, 2700, "the customer's price list applies to a part");
  assert.deepEqual(bundleInvoiceLines(items[0], 1, items, createLine), [], 'an ordinary item is not expanded');
});

function typeBundle(quantity: number, accountId = 'sales', loaded = true) {
  setComponentWorkspace('owner');
  if (loaded) markComponentCollectionsLoaded('inventory');
  let latest: InvoiceEditorLine[] = [];
  function Harness() {
    const [lines, setLines] = useState<InvoiceEditorLine[]>([{ ...createLine(), quantity, accountId }]);
    latest = lines;
    return <DocumentLineEditor side="invoice" lines={lines} onChange={setLines} createLine={createLine} accounts={[]} currency="USD" date="2026-03-01" inventoryItems={items} />;
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText(/Item \/ Description/i, { selector: '#inv-item-desc-0' }), { target: { value: 'Starter kit' } });
  return latest;
}

test('BF-03: typing the bundle on an invoice line replaces that line with the parts', () => {
  assert.deepEqual(typeBundle(3).map(l => [l.itemId, l.quantity, l.amountCents]), [['widget', 3, 3000], ['cable', 6, 1500]]);
});

test('BF-03 review: each part keeps the account the line was given', () => {
  assert.deepEqual(typeBundle(1, 'services').map(l => [l.itemId, l.accountId]), [['widget', 'services'], ['cable', 'services']]);
});

test('BF-03 review: a count that is not a whole number of bundles, or an incomplete item list, leaves the line as it was', () => {
  for (const quantity of [1.5, 0]) {
    const lines = typeBundle(quantity);
    assert.deepEqual(lines.map(l => [l.itemId, l.quantity, l.amountCents]), [[undefined, quantity, 0]], `quantity ${quantity}`);
    cleanup();
  }
  useLedgerStore.setState({ truncatedCollections: { inventory: true } });
  assert.deepEqual(typeBundle(2).map(l => l.itemId), [undefined], 'a capped inventory list');
});
