import './helpers/dom';
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { allWorkOrdersWithPlans, nextWorkOrderNumber } from '../lib/workOrders';
import WorkOrdersView from '../components/reporting/WorkOrdersView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';

describe('A-169 manufacturing light work orders screen', () => {
  afterEach(() => {
    cleanup();
    useLedgerStore.setState({ inventory: [] });
  });

  test('computes WO numbering and component shortages via kitAssembly without touching quantityAtHand', () => {
    assert.equal(nextWorkOrderNumber([{ woNumber: 'WO-2026-001' }, { woNumber: 'WO-2026-004' }], '2026'), 'WO-2026-005');

    const items = [
      { id: 'part-a', uid: 'u1', workspaceId: 'ws1', name: 'Frame', sku: 'FR-1', unitPriceCents: 2000, unitCostCents: 1000, quantityAtHand: 6, reorderPoint: 2, createdAt: '2026-01-01' },
      { id: 'part-b', uid: 'u1', workspaceId: 'ws1', name: 'Motor', sku: 'MO-1', unitPriceCents: 5000, unitCostCents: 3000, quantityAtHand: 3, reorderPoint: 2, createdAt: '2026-01-01' },
      {
        id: 'kit-1', uid: 'u1', workspaceId: 'ws1', name: 'Starter Kit', sku: 'KIT-01',
        unitPriceCents: 9900, unitCostCents: 4000, quantityAtHand: 0, reorderPoint: 0, createdAt: '2026-01-01',
        bundleParts: [{ itemId: 'part-a', quantity: 1 }, { itemId: 'part-b', quantity: 1 }],
        metadata: {
          workOrders: [
            { id: 'wo-1', woNumber: 'WO-2026-001', kitItemId: 'kit-1', kitName: 'Starter Kit', quantityToBuild: 5, status: 'planned', createdAt: '2026-10-20' },
          ],
        },
      },
    ];

    const list = allWorkOrdersWithPlans(items);
    assert.equal(list.length, 1);
    assert.equal(list[0].plan?.buildableKits, 3);
    assert.match(list[0].plan?.problem || '', /Motor is short 2/);
    // Stock quantities unchanged
    assert.equal(items[1].quantityAtHand, 3);

    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: null } as never);
    useLedgerStore.setState({ inventory: items });
    render(<WorkOrdersView />);
    assert.ok(screen.getByText('Work Orders (Kit Assembly)'));
    assert.ok(screen.getByText('WO-2026-001'));
  });
});
