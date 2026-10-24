import './helpers/dom';
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { buildCustomerItemCodeRows, upsertCustomerItemCode } from '../lib/customerItemCodes';
import CustomerItemCodesView from '../components/reporting/CustomerItemCodesView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';

describe('A-122 customer-specific item codes', () => {
  afterEach(() => {
    cleanup();
    useLedgerStore.setState({ inventory: [], customers: [] });
  });

  test('maps buyer part numbers, removes blanks cleanly, and flags duplicate part codes per customer', () => {
    const updated = upsertCustomerItemCode(
      [{ customerId: 'c1', customerCode: 'OLD-1' }],
      { customerId: 'c1', customerCode: 'ACME-404', customerDescription: 'Custom widget' },
    );
    assert.equal(updated.length, 1);
    assert.equal(updated[0].customerCode, 'ACME-404');

    const customers = [{ id: 'c1', uid: 'u1', workspaceId: 'ws1', name: 'Acme Corp', email: 'ap@acme.test', phone: '', status: 'active' as const, balanceCents: 0, createdAt: '2026-01-01' }];
    const items = [
      { id: 'i1', uid: 'u1', workspaceId: 'ws1', name: 'Widget A', sku: 'WA-1', unitPriceCents: 1000, unitCostCents: 500, quantityAtHand: 5, reorderPoint: 1, createdAt: '2026-01-01', metadata: { customerItemCodes: [{ customerId: 'c1', customerCode: 'DUP-99' }] } },
      { id: 'i2', uid: 'u1', workspaceId: 'ws1', name: 'Widget B', sku: 'WB-2', unitPriceCents: 1200, unitCostCents: 600, quantityAtHand: 3, reorderPoint: 1, createdAt: '2026-01-01', metadata: { customerItemCodes: [{ customerId: 'c1', customerCode: 'dup-99' }] } },
    ];

    const rows = buildCustomerItemCodeRows(items, customers);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].duplicateForCustomer, true);
    assert.equal(rows[1].duplicateForCustomer, true);

    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: null } as never);
    useLedgerStore.setState({ inventory: items, customers });
    render(<CustomerItemCodesView />);
    assert.ok(screen.getByText('Customer Item Codes'));
    assert.equal(screen.getAllByText('Duplicate for buyer').length, 2);
  });
});
