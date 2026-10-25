/**
 * A-72: a statement scoped to one entity label, with worked figures.
 *
 * The numbers below are worked by hand. Customer "Northwind" has two entities:
 *   Entity A: invoice INV-A 1,000.00 on 10 Mar, paid 400.00 on 20 Apr
 *   Entity B: invoice INV-B   600.00 on 15 Mar, unpaid
 *   before the period: invoice INV-A0 250.00 on 1 Jan, Entity A
 *   no entity label: invoice INV-N 90.00 on 5 Mar
 *   a posted payment of 1,000.00 on 25 Apr: 400.00 to INV-A, 600.00 to INV-B
 *   a posted payment of 300.00 on 26 Apr with no allocation (money on account)
 *
 * Whole account, 1 Mar – 30 Apr 2026: opening 250.00, invoices 1,000 + 600 + 90, payments 1,000 + 300
 *   → closing = 250 + 1,690 − 1,300 = 640.00
 * Entity A only: opening 250.00, invoice 1,000, payment 400 → closing 850.00, and the 300.00
 *   unallocated payment is reported as left out.
 * Entity B only: opening 0, invoice 600, payment 600 → closing 0.00.
 * No entity label: opening 0, invoice 90, no payment → closing 90.00.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNLABELLED_ENTITY,
  entityLabelOf,
  entityLabelsOf,
  entityOptions,
  entityStatementNote,
  hasMixedEntityLabels,
  isPostedPayment,
  matchesEntity,
  scopeStatementDocuments,
} from '../lib/statementByEntity';
import { computeStatement } from '../server/reports/computeReports';
import type { Invoice, Payment } from '../types';

const customer = { id: 'c1', name: 'Northwind', workspaceId: 'ws' } as never;

function invoice(id: string, amountCents: number, date: string, entity?: string): Invoice {
  return {
    id,
    number: id,
    customerId: 'c1',
    workspaceId: 'ws',
    date,
    amountCents,
    status: 'sent',
    lines: entity ? [{ dimensions: { world: entity } }] : [],
  } as unknown as Invoice;
}

function payment(id: string, amountCents: number, date: string, allocations: Array<{ documentId: string; amountCents: number }>): Payment {
  const allocated = allocations.reduce((sum, a) => sum + a.amountCents, 0);
  return {
    id,
    contactId: 'c1',
    contactName: 'Northwind',
    workspaceId: 'ws',
    direction: 'received',
    date,
    amountCents,
    method: 'bank_transfer',
    status: 'posted',
    allocations: allocations.map(a => ({ ...a, documentType: 'invoice' as const })),
    unappliedCents: amountCents - allocated,
  } as unknown as Payment;
}

const invoices = [
  invoice('INV-A0', 25000, '2026-01-01', 'Entity A'),
  invoice('INV-N', 9000, '2026-03-05'),
  invoice('INV-A', 100000, '2026-03-10', 'Entity A'),
  invoice('INV-B', 60000, '2026-03-15', 'Entity B'),
];
const payments = [
  payment('PAY-1', 100000, '2026-04-25', [
    { documentId: 'INV-A', amountCents: 40000 },
    { documentId: 'INV-B', amountCents: 60000 },
  ]),
  payment('PAY-2', 30000, '2026-04-26', []),
];

const whole = computeStatement(customer, invoices, [], payments, '2026-03-01', '2026-04-30', 'customer');

test('A-72: the entity label is read from the document, then from its lines', () => {
  assert.equal(entityLabelOf({ dimensions: { world: 'Entity A' } }), 'Entity A');
  assert.equal(entityLabelOf({ dimensions: { World: ' Entity B ' } }), 'Entity B');
  assert.equal(entityLabelOf({ lines: [{ dimensions: { world: 'Entity A' } }] }), 'Entity A');
  assert.equal(entityLabelOf({ dimensions: { world: 'Unassigned' } }), '');
  assert.equal(entityLabelOf({}), '');
  assert.equal(entityLabelOf(null), '');
  // a custom world dimension id is honoured
  assert.equal(entityLabelOf({ dimensions: { company: 'Sub 1' } }, 'company'), 'Sub 1');
});

test('A-72: the labels a contact actually uses, and documents with none', () => {
  assert.deepEqual(entityOptions(invoices), ['Entity A', 'Entity B']);
  assert.equal(matchesEntity(invoices[0], 'Entity A'), true);
  assert.equal(matchesEntity(invoices[0], 'Entity B'), false);
  assert.equal(matchesEntity(invoices[1], UNLABELLED_ENTITY), true);
  assert.equal(matchesEntity(invoices[1], 'Entity A'), false);
  // the whole account matches everything
  assert.equal(matchesEntity(invoices[1], ''), true);
});

test('A-72: whole account, worked by hand: 250.00 + 1,690.00 − 1,300.00 = 640.00', () => {
  assert.equal(whole.openingBalanceCents, 25000);
  assert.equal(whole.entries.filter(e => e.type === 'Invoice').length, 3);
  assert.equal(whole.endingBalanceCents, 64000);
});

test('A-72: Entity A only: 250.00 + 1,000.00 − 400.00 = 850.00', () => {
  const scoped = scopeStatementDocuments({ invoices, bills: [], payments, credits: [] }, 'Entity A');
  assert.deepEqual(scoped.invoices.map(i => i.id), ['INV-A0', 'INV-A']);
  assert.deepEqual(scoped.payments.map(p => p.id), ['PAY-1']);
  // the payment copy carries only the part allocated to this entity's invoice
  assert.equal(scoped.payments[0].amountCents, 40000);
  assert.equal(scoped.payments[0].allocations?.length, 1);
  // the unallocated 300.00 payment is reported, not silently dropped
  // Codex review on PR #403: PAY-1's 600.00 applied to Entity B and PAY-2's 300.00 applied to
  // nothing are both money of posted payments that this statement does not show — both are counted
  assert.equal(scoped.paymentsWithoutScope, 2);
  assert.equal(scoped.paymentsWithoutScopeCents, 90000);
  assert.equal(scoped.allocatedElsewhereCents, 60000);
  assert.equal(scoped.unappliedCents, 30000);
  assert.equal(scoped.mixedLabelDocuments, 0);

  const statement = computeStatement(customer, scoped.invoices, [], scoped.payments, '2026-03-01', '2026-04-30', 'customer');
  assert.equal(statement.openingBalanceCents, 25000);
  assert.equal(statement.endingBalanceCents, 85000);
});

test('A-72: Entity B only: 0.00 + 600.00 − 600.00 = 0.00', () => {
  const scoped = scopeStatementDocuments({ invoices, bills: [], payments, credits: [] }, 'Entity B');
  assert.deepEqual(scoped.invoices.map(i => i.id), ['INV-B']);
  assert.equal(scoped.payments[0].amountCents, 60000);
  const statement = computeStatement(customer, scoped.invoices, [], scoped.payments, '2026-03-01', '2026-04-30', 'customer');
  assert.equal(statement.openingBalanceCents, 0);
  assert.equal(statement.endingBalanceCents, 0);
});

test('A-72: documents with no entity label are their own scope: 90.00', () => {
  const scoped = scopeStatementDocuments({ invoices, bills: [], payments, credits: [] }, UNLABELLED_ENTITY);
  assert.deepEqual(scoped.invoices.map(i => i.id), ['INV-N']);
  const statement = computeStatement(customer, scoped.invoices, [], scoped.payments, '2026-03-01', '2026-04-30', 'customer');
  assert.equal(statement.endingBalanceCents, 9000);
});

test('A-72: the whole account leaves nothing out and copies nothing', () => {
  const scoped = scopeStatementDocuments({ invoices, bills: [], payments, credits: [] }, '');
  assert.equal(scoped.wholeAccount, true);
  assert.equal(scoped.paymentsWithoutScope, 0);
  assert.equal(scoped.invoices, invoices);
  assert.equal(scoped.payments, payments);
});

test('A-72: the stored payment is never changed by scoping', () => {
  const before = JSON.stringify(payments);
  scopeStatementDocuments({ invoices, bills: [], payments, credits: [] }, 'Entity A');
  assert.equal(JSON.stringify(payments), before);
  // and a second scope reads the original 1,000.00 again
  const second = scopeStatementDocuments({ invoices, bills: [], payments, credits: [] }, 'Entity B');
  assert.equal(second.payments[0].amountCents, 60000);
});

test('A-72: the note says the three things a reader must know', () => {
  const note = entityStatementNote({
    entity: 'Entity A',
    paymentsWithoutScope: 1,
    paymentsWithoutScopeCents: 30000,
    formattedMissing: '$300.00',
  });
  assert.match(note, /entity “Entity A” only/);
  assert.match(note, /Of 1 posted payment, \$300\.00 is not in this statement/);
  const detailed = entityStatementNote({
    entity: 'Entity A',
    paymentsWithoutScope: 2,
    paymentsWithoutScopeCents: 90000,
    formattedMissing: '$900.00',
    allocatedElsewhereCents: 60000,
    formattedElsewhere: '$600.00',
    unappliedCents: 30000,
    formattedUnapplied: '$300.00',
    mixedLabelDocuments: 1,
  });
  assert.match(detailed, /Of 2 posted payments, \$900\.00 are not in this statement: \$600\.00 applied to documents outside this entity and \$300\.00 applied to no document yet\./);
  assert.match(detailed, /1 document carries lines for more than one entity and is in no single-entity statement/);
  assert.match(note, /PDF and the server statement still cover the whole account/);
  // nothing to say for the whole account
  assert.equal(entityStatementNote({ entity: '', paymentsWithoutScope: 0, paymentsWithoutScopeCents: 0 }), '');
  // documents with no label read as what they are
  assert.match(entityStatementNote({ entity: UNLABELLED_ENTITY, paymentsWithoutScope: 0, paymentsWithoutScopeCents: 0 }), /documents with no entity label/);
});

// ---- Codex review findings on PR #403 ------------------------------------------------------------

test('A-72 review: a credit with no source document and no label belongs with the unlabelled documents', () => {
  const credit = { id: 'CN-1', amountCents: 2000, date: '2026-03-06', status: 'open' };
  const sourceOf = (c: { invoiceId?: string }) => c.invoiceId;
  const unlabelled = scopeStatementDocuments(
    { invoices, bills: [], payments: [], credits: [credit] }, UNLABELLED_ENTITY, 'world', { creditSourceId: sourceOf },
  );
  assert.deepEqual(unlabelled.credits.map(c => c.id), ['CN-1']);
  assert.deepEqual(unlabelled.invoices.map(i => i.id), ['INV-N']);
  // and it is in no named entity's statement
  const a = scopeStatementDocuments({ invoices, bills: [], payments: [], credits: [credit] }, 'Entity A', 'world', { creditSourceId: sourceOf });
  assert.deepEqual(a.credits, []);
  // a credit with a source still follows its invoice
  const linked = { ...credit, id: 'CN-2', invoiceId: 'INV-A' };
  const a2 = scopeStatementDocuments({ invoices, bills: [], payments: [], credits: [linked] }, 'Entity A', 'world', { creditSourceId: sourceOf });
  assert.deepEqual(a2.credits.map(c => c.id), ['CN-2']);
  const n2 = scopeStatementDocuments({ invoices, bills: [], payments: [], credits: [linked] }, UNLABELLED_ENTITY, 'world', { creditSourceId: sourceOf });
  assert.deepEqual(n2.credits, []);
});

test('A-72 review: a draft or void payment is neither included nor reported as missing', () => {
  const draft = { ...payment('PAY-D', 500000, '2026-04-27', []), status: 'draft' } as unknown as Payment;
  const voided = { ...payment('PAY-V', 70000, '2026-04-27', [{ documentId: 'INV-A', amountCents: 70000 }]), status: 'void' } as unknown as Payment;
  assert.equal(isPostedPayment(draft), false);
  assert.equal(isPostedPayment(payments[0]), true);
  const scoped = scopeStatementDocuments({ invoices, bills: [], payments: [...payments, draft, voided], credits: [] }, 'Entity A');
  // the same two posted payments as before; the 5,000.00 draft is not "missing" money
  assert.equal(scoped.paymentsWithoutScope, 2);
  assert.equal(scoped.paymentsWithoutScopeCents, 90000);
  // the void payment is passed through (scoped to its allocation) and computeStatement ignores it, as it does whole-account
  const statement = computeStatement(customer, scoped.invoices, [], scoped.payments, '2026-03-01', '2026-04-30', 'customer');
  assert.equal(statement.endingBalanceCents, 85000);
});

test('A-72 review: a partly applied payment reports its unapplied remainder', () => {
  const inv = [invoice('INV-X', 10000, '2026-03-01', 'Entity A')];
  const pay = [payment('PAY-X', 15000, '2026-03-02', [{ documentId: 'INV-X', amountCents: 10000 }])];
  const scoped = scopeStatementDocuments({ invoices: inv, bills: [], payments: pay, credits: [] }, 'Entity A');
  assert.equal(scoped.payments[0].amountCents, 10000);
  assert.equal(scoped.paymentsWithoutScope, 1);
  assert.equal(scoped.unappliedCents, 5000);
  assert.equal(scoped.allocatedElsewhereCents, 0);
  assert.equal(scoped.paymentsWithoutScopeCents, 5000);
  const statement = computeStatement(customer, scoped.invoices, [], scoped.payments, '2026-03-01', '2026-03-31', 'customer');
  assert.equal(statement.endingBalanceCents, 0);
});

test('A-72 review: a document split between two entities is in no single-entity statement, and the screen says so', () => {
  const split = {
    ...invoice('INV-S', 30000, '2026-03-20'),
    lines: [{ dimensions: { world: 'Entity A' }, amountCents: 10000 }, { dimensions: { world: 'Entity B' }, amountCents: 20000 }],
  } as unknown as Invoice;
  assert.deepEqual(entityLabelsOf(split), ['Entity A', 'Entity B']);
  assert.equal(hasMixedEntityLabels(split), true);
  assert.equal(hasMixedEntityLabels(invoices[0]), false);
  // both labels are offered, so the reader can find the note under either
  assert.deepEqual(entityOptions([split]), ['Entity A', 'Entity B']);
  assert.equal(matchesEntity(split, 'Entity A'), false);
  assert.equal(matchesEntity(split, 'Entity B'), false);
  assert.equal(matchesEntity(split, UNLABELLED_ENTITY), false);
  assert.equal(matchesEntity(split, ''), true);
  const pay = [payment('PAY-S', 30000, '2026-03-21', [{ documentId: 'INV-S', amountCents: 30000 }])];
  const a = scopeStatementDocuments({ invoices: [...invoices, split], bills: [], payments: pay, credits: [] }, 'Entity A');
  assert.deepEqual(a.invoices.map(i => i.id), ['INV-A0', 'INV-A']);
  assert.equal(a.mixedLabelDocuments, 1);
  // its payment is money applied outside this entity's documents
  assert.equal(a.allocatedElsewhereCents, 30000);
  // the whole account still has all of it: 250 + 90 + 1,000 + 600 + 300 − 300 = 1,940.00
  const whole = computeStatement(customer, [...invoices, split], [], pay, '2026-01-01', '2026-04-30', 'customer');
  assert.equal(whole.endingBalanceCents, 194000);
});
