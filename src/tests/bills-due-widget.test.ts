import test from 'node:test';
import assert from 'node:assert/strict';
import { billsDueThisWeek, DASHBOARD_WIDGETS } from '../lib/dashboardOverview';
import type { Bill } from '../types';

function makeBill(overrides: Partial<Bill>): Bill {
  return {
    id: 'b-1', workspaceId: 'ws-1', number: 'BILL-001', vendorId: 'v-1', vendorName: 'Acme Supplies',
    date: '2026-11-01', dueDate: '2026-11-22', amountCents: 10000, amountPaidCents: 0, status: 'open', currency: 'USD', lines: [],
    ...overrides,
  } as Bill;
}

test('D-58: billsDue is a dashboard widget', () => {
  assert.ok(DASHBOARD_WIDGETS.includes('billsDue'));
});

test('D-58: counts bills due within [asOfDate, asOfDate + 7 days] and skips paid, void and out-of-range bills', () => {
  const summary = billsDueThisWeek([
    makeBill({ id: 'b-today', dueDate: '2026-11-20', amountCents: 5000 }),
    makeBill({ id: 'b-7days', dueDate: '2026-11-27', amountCents: 2000 }),
    makeBill({ id: 'b-8days', dueDate: '2026-11-28', amountCents: 9000 }),
    makeBill({ id: 'b-past', dueDate: '2026-11-19', amountCents: 4000 }),
    makeBill({ id: 'b-paid', status: 'paid' }),
    makeBill({ id: 'b-void', status: 'void' }),
  ], '2026-11-20', 'USD');
  assert.equal(summary.count, 2);
  assert.equal(summary.totalCents, 7000);
  assert.deepEqual(summary.bills.map(b => b.id), ['b-today', 'b-7days']);
});

test('D-58: a part-paid bill shows what is still owed; cancelled, rejected and draft bills are not owed', () => {
  const summary = billsDueThisWeek([
    makeBill({ id: 'b-part', number: 'BILL-042', amountCents: 10000, amountPaidCents: 6000, status: 'partially_paid' as Bill['status'] }),
    makeBill({ id: 'b-cancelled', status: 'cancelled' as Bill['status'] }),
    makeBill({ id: 'b-rejected', status: 'rejected' as Bill['status'] }),
    makeBill({ id: 'b-draft', status: 'draft' as Bill['status'] }),
  ], '2026-11-20', 'USD');
  assert.equal(summary.count, 1);
  assert.equal(summary.totalCents, 4000);
  assert.equal(summary.bills[0].billNumber, 'BILL-042');
});

test('D-58: the preview keeps the five earliest due dates', () => {
  const bills = Array.from({ length: 7 }, (_, i) => makeBill({ id: `b-${i}`, dueDate: `2026-11-${String(27 - i).padStart(2, '0')}`, amountCents: 1000 * (i + 1) }));
  const summary = billsDueThisWeek(bills, '2026-11-20', 'USD');
  assert.equal(summary.count, 7);
  assert.equal(summary.bills.length, 5);
  assert.equal(summary.bills[0].dueDate, '2026-11-21');
  assert.equal(summary.bills[4].dueDate, '2026-11-25');
});
