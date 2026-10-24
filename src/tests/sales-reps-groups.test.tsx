/**
 * A-123: Commission plans by item group (pure whole-cent calculation + CommissionReportView).
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { commissionLines, salesRepsProblem, type SalesRep } from '../lib/salesReps';
import CommissionReportView from '../components/reporting/CommissionReportView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';

describe('A-123 commission plans by item group', () => {
  afterEach(() => cleanup());

  test('validates groupRates and applies category-specific rates proportionally before tax', () => {
    const rep: SalesRep = {
      id: 'sr_rep001',
      name: 'Maya Cohen',
      commissionPercent: 5,
      customerIds: ['cust-1'],
      groupRates: { Hardware: 3, Software: 12 },
    };
    assert.equal(salesRepsProblem([rep]), null);
    assert.match(
      salesRepsProblem([{ ...rep, groupRates: { Hardware: 120 } }]) || '',
      /between 0 and 100/,
    );

    // Invoice pre-tax $1,000 ($600 Hardware @ 3% = $18.00 + $400 Software @ 12% = $48.00 => $66.00 on full payment),
    // plus $170 tax = $1,170 gross. Half paid ($585 gross -> $500 pre-tax -> $300 Hardware @3% = $9.00 + $200 Software @12% = $24.00 = $33.00 = 3300 cents).
    const lines = commissionLines(
      [rep],
      [{
        id: 'inv-100',
        uid: 'u1',
        workspaceId: 'ws1',
        customerId: 'cust-1',
        customerName: 'Northwind',
        number: 'INV-100',
        date: '2026-10-05',
        dueDate: '2026-11-05',
        status: 'partially_paid',
        currency: 'USD',
        amountCents: 117_000,
        taxAmountCents: 17_000,
        items: [
          { id: 'li-1', itemId: 'it-hw', description: 'Server rack', quantity: 1, unitPriceCents: 60_000, amountCents: 60_000 },
          { id: 'li-2', itemId: 'it-sw', description: 'Annual license', quantity: 1, unitPriceCents: 40_000, amountCents: 40_000 },
        ],
      } as never],
      [{
        id: 'pay-1',
        date: '2026-10-15',
        allocations: [{ documentId: 'inv-100', documentType: 'invoice', amountCents: 58_500 }],
      }],
      '2026-10-01',
      '2026-10-31',
      [
        { id: 'it-hw', category: 'Hardware' },
        { id: 'it-sw', category: 'Software' },
      ],
    );

    assert.equal(lines.length, 1);
    assert.equal(lines[0].netCents, 50_000);
    assert.equal(lines[0].commissionCents, 3_300);
  });

  test('CommissionReportView displays group rates caption and computed commission', () => {
    const today = new Date().toISOString().slice(0, 10);
    useAuthStore.setState({
      user: { uid: 'u1' } as never,
      currentWorkspaceId: 'ws-comm',
      workspaces: [{
        id: 'ws-comm',
        uid: 'u1',
        name: 'Northwind Books',
        currency: 'USD',
        salesReps: [{
          id: 'sr_rep001',
          name: 'Maya Cohen',
          commissionPercent: 5,
          customerIds: ['cust-1'],
          groupRates: { Software: 10 },
        }],
      }] as never,
    });
    useLedgerStore.setState({
      inventory: [{ id: 'it-sw', name: 'License', category: 'Software' } as never],
      invoices: [{
        id: 'inv-200', uid: 'u1', workspaceId: 'ws-comm', customerId: 'cust-1', customerName: 'Acme',
        number: 'INV-200', date: today, dueDate: today, status: 'paid', currency: 'USD',
        amountCents: 20_000, taxAmountCents: 0,
        items: [{ id: 'l1', itemId: 'it-sw', description: 'License', quantity: 1, unitPriceCents: 20_000, amountCents: 20_000 }],
      } as never],
      payments: [{
        id: 'p-200', date: today, allocations: [{ documentId: 'inv-200', documentType: 'invoice', amountCents: 20_000 }],
      } as never],
    });

    render(<CommissionReportView />);
    assert.match(screen.getByText(/Maya Cohen/).parentElement?.textContent || '', /Software: 10%.*\$20\.00/);
  });
});
