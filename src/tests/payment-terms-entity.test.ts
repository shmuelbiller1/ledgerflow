import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDueDate, isFixedTerm, normalizeTermDays, termDays, termOptions, termsForCustomer } from '../lib/paymentTerms';

test('CC-08: any Net N from 1 to 365 is a fixed term with that many days', () => {
  assert.equal(termDays('due_on_receipt'), 0);
  assert.equal(termDays('net_7'), 7);
  assert.equal(termDays('net_90'), 90);
  assert.equal(termDays('net_365'), 365);
  for (const bad of ['net_0', 'net_366', 'net_1000', 'net_x', 'custom', '', undefined, 30]) {
    assert.equal(termDays(bad), null, String(bad));
    assert.equal(isFixedTerm(bad), false, String(bad));
  }
  assert.equal(isFixedTerm('net_45'), true);
});

test('CC-08: the due date is the invoice date plus the term days', () => {
  assert.equal(calculateDueDate('2026-11-02', 'net_7'), '2026-11-09');
  assert.equal(calculateDueDate('2026-11-02', 'net_90'), '2027-01-31');
  assert.equal(calculateDueDate('2026-11-02', 'due_on_receipt'), '2026-11-02');
  assert.equal(calculateDueDate('2026-11-02', 'custom', 10), '2026-11-12');
});

test('CC-08: workspace terms are whole days 1–365, once each, ascending', () => {
  assert.deepEqual(normalizeTermDays([90, 7, 7, 0, 400, 2.5, '14', -3, 45]), [7, 45, 90]);
  assert.deepEqual(normalizeTermDays(undefined), []);
  assert.deepEqual(normalizeTermDays('net_7'), []);
});

test('CC-08: invoice choices are the standard terms, the workspace\'s own, and the current one', () => {
  const values = (o: ReturnType<typeof termOptions>) => o.map(t => t.value);
  assert.deepEqual(values(termOptions(undefined)), ['due_on_receipt', 'net_15', 'net_30', 'net_60']);
  assert.deepEqual(values(termOptions([90, 7, 30])), ['due_on_receipt', 'net_7', 'net_15', 'net_30', 'net_60', 'net_90']);
  // a term since removed from the workspace stays selectable on the invoice that uses it
  assert.deepEqual(values(termOptions([], 'net_45')), ['due_on_receipt', 'net_15', 'net_30', 'net_45', 'net_60']);
  assert.deepEqual(values(termOptions([], 'custom')), ['due_on_receipt', 'net_15', 'net_30', 'net_60']);
  assert.equal(termOptions([7])[1].label, 'Net 7');
});

test('CC-08: a customer\'s own Net N carries to their new invoice', () => {
  assert.equal(termsForCustomer({ id: 'c1', paymentTerms: 'net_7' }, []), 'net_7');
  assert.equal(termsForCustomer({ id: 'c1' }, [{ customerId: 'c1', paymentTerms: 'net_90', date: '2026-10-01' }]), 'net_90');
});
