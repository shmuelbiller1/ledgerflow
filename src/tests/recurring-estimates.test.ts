/**
 * A-18 (CC-04): recurring estimates. Hand-checked: a monthly estimate set on 31 Jan anchors to the
 * 31st and February gets the 28th (2026 is not a leap year); a schedule three months behind owes
 * three drafts and lands in the future; each draft is a plain draft with a new number and no
 * signing link; daily or weekly repetition is refused in words.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTIMATE_FREQUENCIES, estimateDraftsDue, estimateValidityDays, nextEstimateDraft, recurringEstimateProblem, recurringEstimateSchedule,
} from '../lib/recurringEstimates';

const estimate = {
  id: 'e1', workspaceId: 'w1', uid: 'u1', customerId: 'c1', customerName: 'Acme', number: 'EST-1001',
  amountCents: 123_400, date: '2026-01-31', expiryDate: '2026-03-02', status: 'sent' as const,
  signToken: 'tok', signTokenAt: '2026-01-31T10:00:00Z', convertedInvoiceId: 'inv9', orderedAt: '2026-02-01',
  lines: [{ description: 'Design work', quantity: 1, unitPriceCents: 123_400, amountCents: 123_400 }],
};

test('the schedule copies the customer and lines, never the number, dates or signing', () => {
  const schedule = recurringEstimateSchedule(estimate, 'monthly', '2026-02-01');
  assert.equal(schedule.type, 'estimate');
  assert.equal(schedule.frequency, 'monthly');
  assert.equal(schedule.nextOccurrence, '2026-02-28', 'anchored to the 31st, February gets the 28th');
  assert.equal(schedule.anchorDay, 31);
  assert.equal(schedule.isActive, true);
  assert.equal(schedule.status, 'active');
  assert.equal(schedule.payee, 'Acme');
  const template = schedule.estimateTemplate as Record<string, unknown>;
  assert.equal(template.number, undefined);
  assert.equal(template.status, undefined);
  assert.equal(template.signToken, undefined);
  assert.equal(template.convertedInvoiceId, undefined);
  assert.equal(template.validityDays, 30, '31 Jan to 2 Mar is 30 days');
  assert.equal((template.lines as unknown[]).length, 1);
});

test('only monthly, quarterly and yearly repeat, and only with a customer', () => {
  assert.deepEqual(ESTIMATE_FREQUENCIES, ['monthly', 'quarterly', 'yearly']);
  assert.equal(recurringEstimateProblem({ frequency: 'monthly', customerId: 'c1' }), null);
  assert.equal(recurringEstimateProblem({ frequency: 'daily', customerId: 'c1' }), 'An estimate can repeat monthly, quarterly or yearly.');
  assert.equal(recurringEstimateProblem({ frequency: 'monthly' }), 'A recurring estimate needs a customer.');
});

test('a schedule that was not run owes one draft per missed occurrence, then lands in the future', () => {
  const schedules = [{ id: 's1', isActive: true, status: 'active' as const, frequency: 'monthly' as const, anchorDay: 31, nextOccurrence: '2026-01-31' }];
  const due = estimateDraftsDue(schedules, '2026-04-10');
  assert.deepEqual(due.map(d => d.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(due[due.length - 1].nextOccurrence, '2026-04-30');
  assert.equal(due[0].scheduleId, 's1');
  assert.deepEqual(estimateDraftsDue(schedules, '2026-01-30'), [], 'nothing due before the first date');
  assert.deepEqual(estimateDraftsDue([{ ...schedules[0], isActive: false }], '2026-04-10'), [], 'a paused schedule owes nothing');
  assert.deepEqual(estimateDraftsDue([{ ...schedules[0], status: 'paused' as const }], '2026-04-10'), []);
});

test('each copy is a new draft with the next number and date, and nothing that could send it', () => {
  const draft = nextEstimateDraft({ ...estimate, validityDays: 14 } as never, { id: 'e2', number: 'EST-1002', date: '2026-02-28' });
  assert.equal(draft.id, 'e2');
  assert.equal(draft.number, 'EST-1002');
  assert.equal(draft.date, '2026-02-28');
  assert.equal(draft.expiryDate, '2026-03-14');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.signToken, undefined);
  assert.equal(draft.signature, undefined);
  assert.equal(draft.convertedInvoiceId, undefined);
  assert.equal(draft.orderedAt, undefined);
  assert.equal(draft.lines.length, 1);
  assert.equal(estimateValidityDays({ date: '2026-01-01', expiryDate: '2026-01-01' }), 30, 'a zero-day validity falls back to 30');
});

test('a recurring draft starts with none of its milestones invoiced (CC-04)', () => {
  const draft = nextEstimateDraft({ customerId: 'c1', milestones: [{ id: 'm1', label: 'Deposit', percent: 50, invoicedAt: '2026-01-02' }, { id: 'm2', label: 'Rest', percent: 50 }] } as never,
    { id: 'e2', number: 'EST-2', date: '2026-02-01' });
  assert.deepEqual(draft.milestones?.map(m => m.invoicedAt), [undefined, undefined]);
  assert.deepEqual(draft.milestones?.map(m => m.label), ['Deposit', 'Rest']);
});

test('an old estimate starts repeating after today, not from its own date (CC-04)', () => {
  const schedule = recurringEstimateSchedule({ id: 'e1', customerId: 'c1', date: '2023-03-15' } as never, 'monthly', '2026-11-02');
  assert.equal(schedule.nextOccurrence, '2026-11-15');
  assert.equal(schedule.anchorDay, 15);
  assert.equal(schedule.sourceEstimateId, 'e1');
});

test('an estimate with no lines cannot repeat (CC-04)', () => {
  assert.match(String(recurringEstimateProblem({ frequency: 'monthly', customerId: 'c1', lines: [] })), /no lines/);
  assert.equal(recurringEstimateProblem({ frequency: 'monthly', customerId: 'c1', lines: [{}] }), null);
});
