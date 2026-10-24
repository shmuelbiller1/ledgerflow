import './helpers/dom';
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { compareVendorQuotes } from '../lib/vendorQuotesCompare';
import VendorQuotesCompareView from '../components/reporting/VendorQuotesCompareView';
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
});
