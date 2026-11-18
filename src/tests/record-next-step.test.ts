/**
 * A record page shows what comes next, and the manifest is where "next" is written down.
 *
 * The page used to decide for itself: `if (isDraft) "Send invoice" else "Record payment"`. That is a promise
 * made in one file about a command defined in another, and nothing checked that the command offered it, that its
 * label matched, or that the person's role could run it. These tests hold the manifest to the registry — every
 * offered step names a command that exists — and hold the record pages to the manifest.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { COMMAND_MANIFEST } from '../lib/commands.generated';
import { offeredSteps } from '../hooks/useCommand';
import { invoiceSavedSteps } from '../lib/nextSteps';

const registered = new Set(COMMAND_MANIFEST.map(command => command.name));

test('every offered step names a command that exists, and says what it is in words', () => {
  const dead: string[] = [];
  const silent: string[] = [];
  for (const command of COMMAND_MANIFEST) {
    const next = (command.description as { next?: ReadonlyArray<{ command?: string; label?: string }> }).next;
    if (!Array.isArray(next)) continue;
    for (const step of next) {
      if (!step?.command || !registered.has(step.command)) dead.push(`${command.name} → ${String(step?.command)}`);
      if (!step?.label || !step.label.trim()) silent.push(command.name);
    }
  }
  assert.deepEqual(dead, [], 'an offered step must be a registered command, or the button goes nowhere');
  assert.deepEqual(silent, [], 'an offered step must have words a person can read');
});

test('an invoice that has been created or updated offers the payment, in the same words', () => {
  const created = offeredSteps('invoice.create');
  const updated = offeredSteps('invoice.update');
  assert.deepEqual(created, updated, 'the step after a document does not depend on how it got there');
  assert.deepEqual(updated, [{ command: 'payment.receive', label: 'Record a payment' }]);
  assert.deepEqual(offeredSteps('bill.update'), [{ command: 'payment.receive', label: 'Pay this bill' }]);
  // a delete has no next step, and says so rather than offering a dead end
  assert.deepEqual(offeredSteps('invoice.delete'), []);
});

test('the invoice record page takes its payment step from the manifest', () => {
  const source = fs.readFileSync(path.join('src', 'components', 'sales', 'InvoiceRecordPage.tsx'), 'utf8');
  assert.match(source, /offeredSteps\('invoice\.update'\)/, 'the page reads the step instead of deciding it');
  assert.match(source, /label: paymentStep\?\.label/, 'and shows the manifest’s words for it');
  assert.doesNotMatch(source, /label: 'Record payment'/, 'the hard-coded label is gone, not left beside the new one');
});

test('the toast after an invoice save offers the same payment step the page does', () => {
  const payment = offeredSteps('invoice.update').find(step => step.command === 'payment.receive');
  assert.ok(payment, 'the manifest still offers the payment, or the toast has nothing to show');
  const labels = invoiceSavedSteps({ status: 'issued', amountCents: 10_000, amountPaidCents: 0 }).map(step => step.label);
  assert.deepEqual(labels, [payment.label], 'the payment button says what the manifest says, and only that is left to do');
});

test('a fresh draft can be sent, paid or replaced; a sent one only waited on', () => {
  assert.deepEqual(invoiceSavedSteps({ status: 'draft', amountCents: 10_000, amountPaidCents: 0 }).map(step => step.action), ['send', 'payment', 'new']);
  // once it has left the building there is nothing to send and nothing to replace
  assert.deepEqual(invoiceSavedSteps({ status: 'issued', amountCents: 10_000, amountPaidCents: 0 }).map(step => step.action), ['payment']);
  // a settled invoice owes nothing, so the toast does not offer to take a payment
  assert.deepEqual(invoiceSavedSteps({ status: 'issued', amountCents: 10_000, amountPaidCents: 10_000 }).map(step => step.action), []);
  // paid off but never issued: still yours to send, and a payment is not one of them
  assert.deepEqual(invoiceSavedSteps({ status: 'draft', amountCents: 5_000, amountPaidCents: 5_000 }).map(step => step.action), ['send', 'new']);
  // nothing owed is nothing to collect, even when the document is only a draft
  assert.deepEqual(invoiceSavedSteps({}).map(step => step.action), ['new']);
});

test('the toast is built from buttons, not a single action, and every step opens the screen it names', () => {
  const source = fs.readFileSync(path.join('src', 'components', 'common', 'NextStepToast.tsx'), 'utf8');
  assert.match(source, /toast\.custom/, 'a saved document has more than one next step, so the toast draws them');
  assert.match(source, /<button/, 'a step is a button a person can reach, not a link-shaped div');
  assert.match(source, /toast\.dismiss\(id\)/, 'the offer closes before the next screen opens');
  const sales = fs.readFileSync(path.join('src', 'components', 'sales', 'Sales.tsx'), 'utf8');
  assert.match(sales, /showSavedToast\(/, 'the save ends with the offer');
  assert.match(sales, /invoiceSavedSteps\(savedInvoice\)/, 'and the offer comes from the saved document, not a guess');
});
