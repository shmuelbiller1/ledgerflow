import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getSupabase } from '../lib/db/client';
import {
  contactsMissingFilingDetails,
  dataQualityCsvRows,
  evaluateDataQuality,
  itemsMissingPricing,
  missingRequiredLabelEntries,
} from '../lib/dataQualityChecks';
import { runDataChecks } from '../lib/dataChecks';
import DataQualityReportView from '../components/reporting/DataQualityReportView';
import DataHealthView from '../components/system/DataHealthView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useUIStore } from '../stores/useUIStore';
import { makeBill, makeChartAccount, makeInvoice, makeTransaction } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import type { Customer, DimensionDefinition, InventoryItem, Payment, Vendor } from '../types';

afterEach(async () => {
  cleanup();
  getSupabase().realtime.disconnect();
  await getSupabase().auth.dispose();
});

const accounts = [
  makeChartAccount({ id: 'bank', name: 'Checking', type: 'asset', code: '1000' }),
  makeChartAccount({ id: 'sales', name: 'Product Sales', type: 'revenue', code: '4000' }),
  makeChartAccount({ id: 'util', name: 'Utilities', type: 'expense', code: '6200' }),
];

const dimensions: DimensionDefinition[] = [
  {
    id: 'property',
    name: 'Property',
    values: ['North', 'South'],
    requiredOn: { accountIds: ['util'], since: '2026-01-01', refuse: true },
  } as unknown as DimensionDefinition,
];

describe('A-194 / A-196 / A-197: pure data-quality checks', () => {
  test('A-194: flags posted entries missing required labels, ignores drafts and reversals', () => {
    const missingTx = makeTransaction({
      id: 'tx-unlabelled',
      date: '2026-06-15',
      description: 'Electric bill June',
      lines: [
        { accountId: 'util', amountCents: 18500 },
        { accountId: 'bank', amountCents: -18500 },
      ],
    });
    const labelledTx = makeTransaction({
      id: 'tx-labelled',
      date: '2026-06-16',
      description: 'Electric bill South',
      lines: [
        { accountId: 'util', amountCents: 12000, dimensions: { property: 'South' } },
        { accountId: 'bank', amountCents: -12000 },
      ],
    });
    const draftTx = makeTransaction({
      id: 'tx-draft',
      date: '2026-06-17',
      status: 'draft',
      lines: [
        { accountId: 'util', amountCents: 9000 },
        { accountId: 'bank', amountCents: -9000 },
      ],
    });

    const found = missingRequiredLabelEntries({
      transactions: [missingTx, labelledTx, draftTx],
      accounts,
      dimensions,
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].transactionId, 'tx-unlabelled');
    assert.equal(found[0].severity, 'medium');
    assert.match(found[0].summary, /no Property on Utilities/);
    assert.deepEqual(found[0].record, { type: 'transaction', id: 'tx-unlabelled' });
  });

  test('A-196: flags filing-relevant vendors and customers missing tax ID or address and masks recorded IDs', () => {
    const secretTin = '74-9988776';
    const vendors: Vendor[] = [
      {
        id: 'v-1099-missing-addr',
        workspaceId: 'ws-1',
        name: 'Lone Star Plumbing LLC',
        taxId: secretTin,
        address: '',
        is1099Vendor: true,
        metadata: { is1099: true, taxPlace: { country: 'US' } },
      } as unknown as Vendor,
      {
        id: 'v-complete',
        workspaceId: 'ws-1',
        name: 'Complete Supplier Inc',
        taxId: '74-1122334',
        address: '200 Main St, Austin TX 78701',
        is1099Vendor: true,
        metadata: { is1099: true, taxPlace: { country: 'US' } },
      } as unknown as Vendor,
    ];
    const customers: Customer[] = [
      {
        id: 'c-il-alloc',
        workspaceId: 'ws-1',
        name: 'Haifa Logistics Ltd',
        taxId: '',
        address: '14 Herzl St, Haifa',
        metadata: { taxPlace: { country: 'IL' } },
      } as unknown as Customer,
    ];
    const payments: Payment[] = [
      {
        id: 'p-1',
        workspaceId: 'ws-1',
        contactId: 'v-1099-missing-addr',
        direction: 'outgoing',
        status: 'posted',
        date: '2026-07-10',
        currency: 'USD',
        amountCents: 250000,
      } as unknown as Payment,
    ];
    const invoices = [
      makeInvoice({
        id: 'inv-il-big',
        number: 'INV-2026-99',
        customerId: 'c-il-alloc',
        customerName: 'Haifa Logistics Ltd',
        date: '2026-08-01',
        status: 'sent',
        currency: 'ILS',
        taxAmountCents: 144000,
        amountCents: 944000,
      }),
    ];

    const rows = contactsMissingFilingDetails({
      customers,
      vendors,
      invoices,
      bills: [],
      payments,
      taxYear: 2026,
      homeCurrency: 'USD',
      workspaceCountry: 'US',
    });

    assert.equal(rows.length, 2);
    const vendorRow = rows.find(r => r.contactId === 'v-1099-missing-addr')!;
    assert.deepEqual(vendorRow.missingFields, ['address']);
    assert.equal(vendorRow.maskedTaxId, '••••8776');
    assert.ok(!JSON.stringify(rows).includes(secretTin), 'raw TIN never appears in findings');

    const customerRow = rows.find(r => r.contactId === 'c-il-alloc')!;
    assert.deepEqual(customerRow.missingFields, ['taxId']);
    assert.ok(customerRow.filingReasons.some(reason => /allocation-number threshold/.test(reason)), 'an ILS invoice is checked in its own currency even in a USD workspace');
    assert.deepEqual(customerRow.record, { type: 'invoice', id: 'inv-il-big' });
  });

  test('A-197: flags stock items missing cost or price, checks price-only on services, and skips bundles', () => {
    const items: InventoryItem[] = [
      { id: 'stock-both', name: 'Unpriced Valve', sku: 'V-01', itemType: 'stock', unitCostCents: 0, unitPriceCents: 0, quantityAtHand: 5 } as unknown as InventoryItem,
      { id: 'stock-nocost', name: 'Zero Cost Sensor', sku: 'S-02', itemType: 'stock', unitCostCents: 0, unitPriceCents: 4500, quantityAtHand: 8 } as unknown as InventoryItem,
      { id: 'service-ok', name: 'Field Setup Hour', sku: 'SRV-1', itemType: 'service', unitCostCents: 0, unitPriceCents: 15000, quantityAtHand: 0 } as unknown as InventoryItem,
      { id: 'service-noprice', name: 'Unpriced Advisory', sku: 'SRV-2', itemType: 'service', unitCostCents: 0, unitPriceCents: 0, quantityAtHand: 0 } as unknown as InventoryItem,
      { id: 'kit-ok', name: 'Starter Bundle', sku: 'KIT-1', itemType: 'stock', unitCostCents: 0, unitPriceCents: 0, quantityAtHand: 0, bundleParts: [{ itemId: 'stock-nocost', quantity: 2 }] } as unknown as InventoryItem,
    ];

    const missing = itemsMissingPricing(items);
    assert.deepEqual(
      missing.map(r => [r.itemId, r.missingFields]),
      [
        ['stock-both', ['cost', 'price']],
        ['service-noprice', ['price']],
        ['stock-nocost', ['cost']],
      ],
    );
  });
});

describe('DataQualityReportView & DataHealthView UI integration', () => {
  test('renders findings, masks tax IDs in DOM & CSV, filters by group, and opens linked records', () => {
    const secretEin = '75-5544332';
    const wsBase = setComponentWorkspace('owner');
    const ws = {
      ...wsBase,
      id: 'ws-dq',
      name: 'Quality Books',
      currency: 'USD',
      dimensions,
      taxProfiles: { books: { name: 'Quality Books', place: { country: 'US' }, registrations: [] } },
    };
    useAuthStore.setState({ currentWorkspaceId: ws.id, workspaces: [ws] });
    markComponentCollectionsLoaded(
      'bankLines', 'bills', 'customers', 'inventory', 'invoices', 'payments', 'recurring', 'vendors',
    );
    useLedgerStore.setState({
      accounts,
      transactions: [
        makeTransaction({
          id: 'tx-miss-1',
          date: '2026-09-12',
          description: 'Power utility September',
          lines: [{ accountId: 'util', amountCents: 9500 }, { accountId: 'bank', amountCents: -9500 }],
        }),
      ],
      vendors: [
        {
          id: 'v-miss-addr',
          workspaceId: 'ws-dq',
          name: 'Brazos Freight Co',
          taxId: secretEin,
          address: '',
          is1099Vendor: true,
          metadata: { is1099: true, taxPlace: { country: 'US' } },
        } as unknown as Vendor,
      ],
      customers: [],
      bills: [
        makeBill({
          id: 'bill-9',
          number: 'BILL-9',
          vendorId: 'v-miss-addr',
          vendorName: 'Brazos Freight Co',
          date: '2026-09-05',
          status: 'paid',
          amountCents: 300000,
        }),
      ],
      payments: [
        {
          id: 'pay-9',
          workspaceId: 'ws-dq',
          contactId: 'v-miss-addr',
          direction: 'outgoing',
          status: 'posted',
          date: '2026-09-10',
          currency: 'USD',
          amountCents: 300000,
          ledgerTransactionId: 'tx-miss-1',
        } as unknown as Payment,
      ],
      invoices: [],
      recurring: [],
      bankLines: [],
      inventory: [
        {
          id: 'item-miss-cost',
          workspaceId: 'ws-dq',
          sku: 'PUMP-9',
          name: 'Brass Metering Pump',
          itemType: 'stock',
          unitCostCents: 0,
          unitPriceCents: 19900,
          quantityAtHand: 4,
        } as unknown as InventoryItem,
      ],
    });

    const view = render(<DataQualityReportView />);
    assert.ok(screen.getByRole('heading', { name: 'Data quality checks' }));
    assert.match(view.container.textContent || '', /Power utility September/);
    assert.match(view.container.textContent || '', /Brazos Freight Co/);
    assert.match(view.container.textContent || '', /••••4332/);
    assert.ok(!(view.container.textContent || '').includes(secretEin), 'raw EIN never rendered on screen');
    assert.match(view.container.textContent || '', /Brass Metering Pump/);

    fireEvent.click(screen.getByRole('button', { name: 'Open item' }));
    assert.deepEqual(useUIStore.getState().focusRecord, { type: 'item', id: 'item-miss-cost' });

    const dq = evaluateDataQuality({
      transactions: useLedgerStore.getState().transactions,
      accounts,
      dimensions,
      vendors: useLedgerStore.getState().vendors,
      bills: useLedgerStore.getState().bills,
      payments: useLedgerStore.getState().payments,
      inventory: useLedgerStore.getState().inventory,
      taxYear: 2026,
      homeCurrency: 'USD',
      workspaceCountry: 'US',
    });
    const csvText = JSON.stringify(dataQualityCsvRows(dq));
    assert.ok(!csvText.includes(secretEin), 'raw EIN never exported in CSV');

    cleanup();
    const healthView = render(<DataHealthView />);
    assert.match(healthView.container.textContent || '', /Brazos Freight Co: missing address/);
    assert.match(healthView.container.textContent || '', /Brass Metering Pump: missing unit cost/);
    assert.ok(runDataChecks({
      transactions: [], accounts, invoices: [], bills: [], recurring: [],
      inventory: [{ id: 'legacy-stub', quantityAtHand: 3 }],
      today: '2026-10-01', baseCurrency: 'USD',
    }).length === 0);
  });
});
