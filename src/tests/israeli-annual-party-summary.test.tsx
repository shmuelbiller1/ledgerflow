import './helpers/dom';
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { computeIsraeliAnnualSummary, maskPartyTaxId } from '../lib/israeliAnnualPartySummary';
import IsraeliAnnualPartySummaryView from '../components/reporting/IsraeliAnnualPartySummaryView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';

describe('A-189 Israeli annual summary per customer & vendor', () => {
  afterEach(() => {
    cleanup();
    useLedgerStore.setState({ customers: [], vendors: [], invoices: [], creditNotes: [], bills: [], vendorCredits: [], payments: [] });
  });

  test('summarizes annual turnover, VAT, allocation number checks, source tax withheld and masks TINs', () => {
    assert.equal(maskPartyTaxId('515987654'), '••••7654');

    const customers = [
      {
        id: 'c1', uid: 'u1', workspaceId: 'ws1', name: ' Carmel Tech Ltd ', email: 'fin@carmel.co.il',
        phone: '', status: 'active' as const, balanceCents: 0, createdAt: '2026-01-01',
        metadata: { vatNumber: '515987654' },
      },
    ];
    const vendors = [
      {
        id: 'v1', uid: 'u1', workspaceId: 'ws1', name: 'Galil Engineering', category: 'Subcontractor',
        createdAt: '2026-01-01', metadata: { vatNumber: '514111222', withholding: { ratePercent: 5, expires: '2026-12-31' } },
      },
    ];
    const invoices = [
      {
        id: 'inv1', uid: 'u1', workspaceId: 'ws1', customerId: 'c1', customerName: 'Carmel Tech Ltd',
        number: 'INV-2026-01', date: '2026-07-15', dueDate: '2026-08-15',
        // Net = 10,000 ILS (1,000,000 agorot) > 5,000 ILS June 2026 threshold, VAT = 1,800 ILS
        amountCents: 1_180_000, taxAmountCents: 180_000, currency: 'ILS', status: 'sent' as const,
        items: [], createdAt: '2026-07-15',
      },
    ];
    const bills = [
      {
        id: 'b1', uid: 'u1', workspaceId: 'ws1', vendorId: 'v1', vendorName: 'Galil Engineering',
        number: 'B-2026-01', date: '2026-07-20', dueDate: '2026-08-20',
        amountCents: 590_000, taxAmountCents: 90_000, currency: 'ILS', status: 'paid' as const,
        splits: [], createdAt: '2026-07-20',
      },
    ];
    const payments = [
      {
        id: 'p1', uid: 'u1', workspaceId: 'ws1', direction: 'made' as const, contactId: 'v1', contactName: 'Galil Engineering',
        date: '2026-08-01', amountCents: 565_000, withholdingTaxCents: 25_000, currency: 'ILS', status: 'completed' as const,
        allocations: [], createdAt: '2026-08-01',
      },
    ];

    const out = computeIsraeliAnnualSummary({
      year: 2026,
      baseCurrency: 'ILS',
      customers,
      vendors,
      invoices,
      creditNotes: [],
      bills,
      vendorCredits: [],
      payments: payments as never,
    });

    assert.equal(out.customers.length, 1);
    assert.equal(out.customers[0].maskedTaxId, '••••7654');
    assert.equal(out.customers[0].netSalesCents, 1_000_000);
    assert.equal(out.customers[0].vatChargedCents, 180_000);
    assert.equal(out.customers[0].allocationRequiredCount, 1);
    assert.equal(out.customers[0].allocationMissingCount, 1);

    assert.equal(out.vendors.length, 1);
    assert.equal(out.vendors[0].maskedTaxId, '••••1222');
    assert.equal(out.vendors[0].taxWithheldCents, 25_000);

    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: null } as never);
    useLedgerStore.setState({ customers, vendors, invoices, creditNotes: [], bills, vendorCredits: [], payments: payments as never });
    render(<IsraeliAnnualPartySummaryView />);
    assert.ok(screen.getByText('Israel: Annual Customer & Vendor Summary'));
    assert.ok(screen.getByText('••••7654'));
    assert.equal(screen.queryByText('515987654'), null, 'Full TIN must never render unmasked');
    assert.ok(screen.getByText('1 missing of 1'));
  });
});
