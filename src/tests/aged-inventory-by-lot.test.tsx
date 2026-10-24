import './helpers/dom';
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { computeAgedInventoryByLot } from '../lib/agedInventoryByLot';
import AgedInventoryByLotReportView from '../components/reporting/AgedInventoryByLotReportView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';

import { getSupabase } from '../lib/db/client';

describe('A-140 aged inventory by lot', () => {
  afterEach(async () => {
    cleanup();
    useLedgerStore.setState({ inventory: [], invoices: [] });
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
  });

  test('groups received lots into exact day buckets per PO currency without subtracting un-tracked stock depletion', () => {
    const purchaseOrders = [
      {
        id: 'po-1', uid: 'u1', workspaceId: 'ws1', poNumber: 'PO-001', vendorId: 'v1', vendorName: 'ChemLab',
        issueDate: '2026-03-01', status: 'received' as const, currency: 'USD', totalAmountCents: 100_000,
        items: [{ id: 'poi-1', itemId: 'item-1', description: 'Reagent Pack', quantity: 20, unitPriceCents: 5000, totalCents: 100_000 }],
        receipts: [
          {
            id: 'gr-1', uid: 'u1', workspaceId: 'ws1', poId: 'po-1', poNumber: 'PO-001', vendorId: 'v1', vendorName: 'ChemLab',
            status: 'received' as const, receiptNumber: 'GR-001', receivedDate: '2026-04-01', createdAt: '2026-04-01',
            items: [{ poItemId: 'poi-1', description: 'Reagent Pack', quantityReceived: 10, unitPriceCents: 5000, condition: 'good' as const, lotNumber: 'LOT-OLD', lotExpiryDate: '2026-09-01' }],
          },
          {
            id: 'gr-2', uid: 'u1', workspaceId: 'ws1', poId: 'po-1', poNumber: 'PO-001', vendorId: 'v1', vendorName: 'ChemLab',
            status: 'received' as const, receiptNumber: 'GR-002', receivedDate: '2026-10-10', createdAt: '2026-10-10',
            items: [{ poItemId: 'poi-1', description: 'Reagent Pack', quantityReceived: 10, unitPriceCents: 5200, condition: 'good' as const, lotNumber: 'LOT-FRESH' }],
          },
        ],
        createdAt: '2026-03-01', updatedAt: '2026-10-10',
      },
    ];

    const rows = computeAgedInventoryByLot({ purchaseOrders, asOfDate: '2026-10-23', defaultCurrency: 'USD' });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].lotNumber, 'LOT-OLD');
    assert.equal(rows[0].bucket, '181_plus');
    assert.equal(rows[0].expired, true);
    assert.equal(rows[1].lotNumber, 'LOT-FRESH');
    assert.equal(rows[1].bucket, '0_30');
    assert.equal(rows[1].ageDays, 13);

    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: null } as never);
    useLedgerStore.setState({ inventory: [], invoices: [] });
    render(<AgedInventoryByLotReportView purchaseOrders={purchaseOrders} />);
    assert.ok(screen.getByText('Aged Inventory by Lot'));
    assert.ok(screen.getByText('LOT-OLD'));
    assert.ok(screen.getByText('LOT-FRESH'));
  });
});
