import './helpers/dom';
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { quoteShippingCharge, shippingMethodsFromInventory } from '../lib/shippingMethods';
import ShippingMethodsView from '../components/reporting/ShippingMethodsView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';

describe('A-124 shipping methods and rates table', () => {
  afterEach(() => {
    cleanup();
    useLedgerStore.setState({ inventory: [] });
  });

  test('applies whole-cent free-shipping thresholds and refuses mismatched currencies cleanly', () => {
    const items = [
      {
        id: 'ship-1',
        uid: 'u1',
        workspaceId: 'ws1',
        name: 'Ground Tracked',
        sku: 'SHIP-GROUND',
        itemType: 'service' as const,
        unitPriceCents: 1495,
        unitCostCents: 0,
        quantityAtHand: 0,
        reorderPoint: 0,
        createdAt: '2026-01-01',
        metadata: { shippingMethod: { carrier: 'UPS', zone: 'US Domestic', currency: 'USD', freeAboveCents: 10_000, minDays: 2, maxDays: 4 } },
      },
    ];
    const methods = shippingMethodsFromInventory(items, 'USD');
    assert.equal(methods.length, 1);

    assert.deepEqual(quoteShippingCharge(methods[0], 9_999, 'USD'), { chargeCents: 1495, freeApplied: false });
    assert.deepEqual(quoteShippingCharge(methods[0], 10_000, 'USD'), { chargeCents: 0, freeApplied: true });
    assert.equal(quoteShippingCharge(methods[0], 10_000, 'ILS').chargeCents, null);

    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: null } as never);
    useLedgerStore.setState({ inventory: items });
    render(<ShippingMethodsView />);
    assert.ok(screen.getByText('Shipping Methods & Rates'));
    assert.ok(screen.getByText('Free threshold met'));
  });
});
