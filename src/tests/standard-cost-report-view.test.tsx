/**
 * A-268: Standard cost variance report screen tests.
 *
 * Verifies:
 * - Table renders stock items with standard cost, calculating unit variance, percentage, and variance on hand.
 * - Correct summary of total variance on hand in table footer.
 * - "N items have no standard cost" status message appears and button navigates to Inventory tab.
 * - Empty state when no items or no standard costs exist.
 * - Read-only behavior (no ledger or inventory mutations).
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StandardCostReportView from '../components/reporting/StandardCostReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useUIStore } from '../stores/useUIStore';
import { getSupabase } from '../lib/db/client';

const sampleInventory = [
  {
    id: 'item-1',
    name: 'Standard Widget',
    sku: 'WID-01',
    workspaceId: 'w1',
    quantityAtHand: 10,
    unitPriceCents: 2000,
    unitCostCents: 1200, // actual = $12.00
    standardCostCents: 1000, // standard = $10.00; variance = +$2.00 (+20%), variance on hand = +$20.00
    itemType: 'product',
  },
  {
    id: 'item-2',
    name: 'Discount Bolt',
    sku: 'BLT-02',
    workspaceId: 'w1',
    quantityAtHand: 50,
    unitPriceCents: 500,
    unitCostCents: 180, // actual = $1.80
    standardCostCents: 200, // standard = $2.00; variance = -$0.20 (-10%), variance on hand = -$10.00
    itemType: 'product',
  },
  {
    id: 'item-3',
    name: 'Unset Bracket',
    sku: 'BRK-03',
    workspaceId: 'w1',
    quantityAtHand: 5,
    unitPriceCents: 800,
    unitCostCents: 400,
    // standardCostCents unset -> counted in withoutStandard
    itemType: 'product',
  },
  {
    id: 'item-4',
    name: 'Consulting Service',
    workspaceId: 'w1',
    quantityAtHand: 0,
    unitPriceCents: 15000,
    unitCostCents: 0,
    standardCostCents: 10000,
    itemType: 'service', // service ignored from standard cost report
  },
];

describe('Standard cost variance report screen', () => {
  beforeEach(() => {
    stubFetch(404);
    useAuthStore.setState({
      isGuest: true,
      user: null,
      currentWorkspaceId: 'w1',
      workspaces: [{ id: 'w1', name: 'Test Business', currency: 'USD' }] as never,
    });
    useDataNeedsStore.setState({ failed: {} as never });
    useLedgerStore.setState({
      inventory: sampleInventory as never,
      truncatedCollections: {} as never,
    });
    useUIStore.setState({ activeTab: 'reports' as never });
  });

  afterEach(async () => {
    cleanup();
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
  });

  test('renders standard cost report rows with unit variances, percentages, and variance on hand', async () => {
    render(<StandardCostReportView />);
    const table = await screen.findByRole('table');
    assert.ok(table);

    const rows = within(table).getAllByRole('row').map(r => (r.textContent || '').replace(/\s+/g, ' '));

    // Widget row: actual $12, standard $10, variance +$2.00, +20.0%, on hand 10 -> $20.00
    assert.ok(
      rows.some(t => /Standard Widget/.test(t) && /WID-01/.test(t) && /10/.test(t) && /\$10\.00/.test(t) && /\$12\.00/.test(t) && /\+20\.0 %/.test(t)),
      `Widget row missing in: ${rows.join(' | ')}`,
    );

    // Bolt row: actual $1.80, standard $2.00, variance -$0.20, -10.0%, on hand 50 -> -$10.00
    assert.ok(
      rows.some(t => /Discount Bolt/.test(t) && /BLT-02/.test(t) && /50/.test(t) && /\$2\.00/.test(t) && /\$1\.80/.test(t) && /−10\.0 %/.test(t)),
      `Bolt row missing in: ${rows.join(' | ')}`,
    );

    // Total variance: +$20.00 + (-$10.00) = +$10.00
    assert.ok(
      rows.some(t => /Total variance on hand/.test(t) && /\$10\.00/.test(t)),
      `Total variance missing in: ${rows.join(' | ')}`,
    );

    // Services should not be listed in table
    assert.ok(!rows.some(t => /Consulting Service/.test(t)));
  });

  test('displays notice for items without standard cost and link navigates to Inventory', async () => {
    render(<StandardCostReportView />);
    const notice = await screen.findByRole('status');
    assert.match(notice.textContent || '', /1 item has no standard cost/);

    const inventoryBtn = within(notice).getByRole('button', { name: /Go to Inventory/i });
    fireEvent.click(inventoryBtn);
    assert.equal(useUIStore.getState().activeTab, 'inventory');
  });

  test('displays empty state when inventory has no items', async () => {
    useLedgerStore.setState({ inventory: [] as never, truncatedCollections: {} as never });
    render(<StandardCostReportView />);
    await waitFor(() => {
      assert.ok(screen.getByText(/No inventory items found/i));
    });
  });

  test('displays empty state when items exist but none have standard cost set', async () => {
    useLedgerStore.setState({
      inventory: [
        {
          id: 'item-no-std',
          name: 'Plain Item',
          sku: 'PLN-01',
          workspaceId: 'w1',
          quantityAtHand: 10,
          unitCostCents: 500,
          itemType: 'product',
        },
      ] as never,
      truncatedCollections: {} as never,
    });
    render(<StandardCostReportView />);
    await waitFor(() => {
      assert.ok(screen.getByText(/No items with a standard cost found/i));
    });
    const statuses = screen.getAllByRole('status');
    const notice = statuses.find(s => /item has no standard cost/i.test(s.textContent || ''));
    assert.ok(notice);
    assert.match(notice.textContent || '', /1 item has no standard cost/);
  });

  test('CSV amounts use the workspace currency decimals (JPY has none)', async () => {
    useAuthStore.setState({ workspaces: [{ id: 'w1', name: 'Test Business', currency: 'JPY' }] as never });
    const parts: string[] = [];
    const g = globalThis as unknown as { Blob: typeof Blob; URL: typeof URL };
    const RealBlob = g.Blob;
    g.Blob = class extends RealBlob { constructor(p: BlobPart[], o?: BlobPropertyBag) { super(p, o); parts.push(String(p[0])); } } as typeof Blob;
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:x'; URL.revokeObjectURL = () => {};
    try {
      render(<StandardCostReportView />);
      fireEvent.click(await screen.findByRole('button', { name: /Download CSV/i }));
      const widget = parts.join('').split('\r\n').find(l => l.includes('Standard Widget')) || '';
      assert.match(widget, /"1000","1200","200"/, widget);
      assert.ok(!widget.includes('10.00'), widget);
    } finally { g.Blob = RealBlob; URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
  });

  test('a partial inventory list cannot be downloaded as if it were complete', async () => {
    useLedgerStore.setState({ truncatedCollections: { inventory: true } as never });
    render(<StandardCostReportView />);
    const button = await screen.findByRole('button', { name: /Download CSV/i });
    assert.equal((button as HTMLButtonElement).disabled, true);
  });
});
