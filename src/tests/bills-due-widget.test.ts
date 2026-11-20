import { describe, it, expect } from 'vitest';
import { billsDueThisWeek, DASHBOARD_WIDGETS } from '../lib/dashboardOverview';
import type { Bill } from '../types';

function makeBill(overrides: Partial<Bill>): Bill {
  return {
    id: 'b-1',
    workspaceId: 'ws-1',
    reference: 'BILL-001',
    vendorId: 'v-1',
    vendorName: 'Acme Supplies',
    date: '2026-11-01',
    dueDate: '2026-11-22',
    amountCents: 10000,
    paidCents: 0,
    status: 'open',
    currency: 'USD',
    lines: [],
    ...overrides,
  } as Bill;
}

describe('D-58: billsDueThisWeek', () => {
  it('registers billsDue in DASHBOARD_WIDGETS', () => {
    expect(DASHBOARD_WIDGETS).toContain('billsDue');
  });

  it('includes bills due within [asOfDate, asOfDate + 7 days] and excludes paid/void/outside range', () => {
    const bills: Bill[] = [
      makeBill({ id: 'b-today', dueDate: '2026-11-20', amountCents: 5000 }),
      makeBill({ id: 'b-7days', dueDate: '2026-11-27', amountCents: 2000 }),
      makeBill({ id: 'b-8days', dueDate: '2026-11-28', amountCents: 9000 }),
      makeBill({ id: 'b-past', dueDate: '2026-11-19', amountCents: 4000 }),
      makeBill({ id: 'b-paid', dueDate: '2026-11-22', amountCents: 2000, status: 'paid' }),
      makeBill({ id: 'b-void', dueDate: '2026-11-22', amountCents: 2000, status: 'void' }),
    ];

    const summary = billsDueThisWeek(bills, '2026-11-20', 'USD');
    expect(summary.count).toBe(2);
    expect(summary.totalCents).toBe(7000);
    expect(summary.bills.map(b => b.id)).toEqual(['b-today', 'b-7days']);
  });

  it('caps the preview list at 5 bills sorted by dueDate ascending', () => {
    const bills: Bill[] = Array.from({ length: 7 }, (_, i) =>
      makeBill({
        id: `b-${i}`,
        dueDate: `2026-11-${String(27 - i).padStart(2, '0')}`,
        amountCents: 1000 * (i + 1),
      })
    );
    const summary = billsDueThisWeek(bills, '2026-11-20', 'USD');
    expect(summary.count).toBe(7);
    expect(summary.bills).toHaveLength(5);
    expect(summary.bills[0].dueDate).toBe('2026-11-21');
    expect(summary.bills[4].dueDate).toBe('2026-11-25');
  });
});
