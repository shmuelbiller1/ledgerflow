import './helpers/dom';
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { compareVendorQuotes } from '../lib/vendorQuotesCompare';
import VendorQuotesCompareView from '../components/reporting/VendorQuotesCompareView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';

describe('A-119 vendor quotes compare', () => {
  afterEach(() => {
    cleanup();
    useLedgerStore.setState({ inventory: [], bills: [], vendors: [] });
  });

  test('ranks lowest non-expired quote strictly inside each currency and attaches last issued bill cost', () => {
    const items = [
      {
        id: 'it-1',
        uid: 'u1',
        workspaceId: 'ws1',
        name: 'Brass Valve',
        sku: 'BV-10',
        unitPriceCents: 3500,
        unitCostCents: 2000,
        quantityAtHand: 12,
        reorderPoint: 5,
        createdAt: '2026-01-01',
        metadata: {
          vendorQuotes: [
            { id: 'q1', vendorId: 'v1', vendorName: 'Apex Supply', unitPriceCents: 1850, currency: 'USD', minOrderQty: 10, leadDays: 5, validUntil: '2026-12-31' },
            { id: 'q2', vendorId: 'v2', vendorName: 'North Metals', unitPriceCents: 2100, currency: 'USD', minOrderQty: 2, leadDays: 2, validUntil: '2026-12-31' },
            { id: 'q3', vendorId: 'v3', vendorName: 'Stale Quote Co', unitPriceCents: 1200, currency: 'USD', minOrderQty: 50, validUntil: '2026-03-01' },
            { id: 'q4', vendorId: 'v4', vendorName: 'Euro Brass GmbH', unitPriceCents: 1700, currency: 'EUR', minOrderQty: 10, validUntil: '2026-12-31' },
          ],
        },
      },
    ];
    const bills = [
      {
        id: 'b1',
        uid: 'u1',
        workspaceId: 'ws1',
        vendorId: 'v1',
        vendorName: 'Apex Supply',
        number: 'BILL-091',
        date: '2026-09-10',
        dueDate: '2026-10-10',
        amountCents: 19_000,
        currency: 'USD',
        status: 'paid' as const,
        splits: [{ id: 's1', accountId: 'a1', description: 'Valves', amountCents: 19_000, itemId: 'it-1', quantity: 10 }],
        createdAt: '2026-09-10',
      },
    ];

    const rows = compareVendorQuotes({ items, bills, asOfDate: '2026-10-23', defaultCurrency: 'USD' });
    const q1 = rows.find(r => r.id === 'q1')!;
    const q2 = rows.find(r => r.id === 'q2')!;
    const q3 = rows.find(r => r.id === 'q3')!;
    const q4 = rows.find(r => r.id === 'q4')!;

    assert.equal(q1.lowestInCurrency, true);
    assert.equal(q1.deltaFromLowestCents, 0);
    assert.equal(q1.lastBill?.unitCostCents, 1900);
    assert.equal(q2.lowestInCurrency, false);
    assert.equal(q2.deltaFromLowestCents, 250);
    assert.equal(q3.expired, true);
    assert.equal(q3.lowestInCurrency, false);
    // EUR quote is best in EUR without affecting USD rankings
    assert.equal(q4.lowestInCurrency, true);

    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: null } as never);
    useLedgerStore.setState({ inventory: items, bills, vendors: [] });
    render(<VendorQuotesCompareView />);
    assert.ok(screen.getByText('Vendor Quotes Compare'));
    assert.ok(screen.getByText('Lowest (USD)'));
    assert.ok(screen.getByText('Lowest (EUR)'));
    assert.ok(screen.getByText('Expired'));
  });

  test('a refused quote keeps its draft; repeat submit is single-flight and a late reply cannot clear a new workspace', async t => {
    const ws = setComponentWorkspace('bookkeeper');
    const common = { workspaceId: ws.id, uid: 'user' };
    const catalogueItem = { ...common, id: 'valve', name: 'Valve', sku: 'V-7', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 0, reorderPoint: 0, createdAt: '2026-02-01' };
    const supplier = { ...common, id: 'north', name: 'North', category: '' };
    useLedgerStore.setState({ inventory: [catalogueItem], vendors: [supplier], bills: [], truncatedCollections: {} });
    markComponentCollectionsLoaded('inventory', 'vendors', 'bills');
    const writes: { body: string; reply: (response: Response) => void }[] = [];
    t.mock.method(globalThis, 'fetch', (url: RequestInfo | URL, init?: RequestInit) => String(url).endsWith('/commands/record.save')
      ? new Promise<Response>(reply => writes.push({ body: String(init?.body), reply })) : Promise.resolve(Response.json({})));
    const { container } = render(<VendorQuotesCompareView />);
    const type = (id: string, value: string) => fireEvent.change(container.querySelector(id)!, { target: { value } });
    fireEvent.click(container.querySelector('summary')!);
    type('#vq-item', 'valve'); type('#vq-vendor', 'north'); type('#vq-price', '18.75'); type('#vq-notes', 'Keep my terms');
    const form = container.querySelector('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => assert.equal(writes.length, 1));
    assert.equal(container.querySelector<HTMLFieldSetElement>('fieldset')!.disabled, true);
    const { input, workspaceId } = JSON.parse(writes[0].body);
    assert.equal(workspaceId, ws.id); assert.equal(input.collection, 'inventory'); assert.equal(input.id, 'valve');
    assert.equal(input.data.metadata.vendorQuotes[0].unitPriceCents, 1875);
    await act(async () => writes[0].reply(Response.json({ message: 'Write refused' }, { status: 403 })));
    assert.ok(screen.getByRole('alert'));
    assert.equal(container.querySelector<HTMLInputElement>('#vq-price')!.value, '18.75');
    assert.equal(container.querySelector<HTMLInputElement>('#vq-notes')!.value, 'Keep my terms');
    fireEvent.submit(form); await waitFor(() => assert.equal(writes.length, 2));
    await act(async () => {
      const other = { ...ws, id: 'other-books' };
      useAuthStore.setState({ currentWorkspaceId: other.id, workspaces: [other] });
      useLedgerStore.setState({ inventory: [{ ...catalogueItem, workspaceId: other.id }], vendors: [{ ...supplier, workspaceId: other.id }] });
    });
    assert.equal(container.querySelector('details')!.open, false);
    fireEvent.click(container.querySelector('summary')!);
    assert.equal(container.querySelector<HTMLInputElement>('#vq-notes')!.value, '');
    type('#vq-notes', 'New books');
    await act(async () => writes[1].reply(Response.json({ data: { id: 'valve' } })));
    assert.equal(container.querySelector<HTMLInputElement>('#vq-notes')!.value, 'New books');
    assert.equal(screen.queryByRole('alert'), null);
  });
});
