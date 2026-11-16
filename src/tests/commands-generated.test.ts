import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { z } from 'zod';
import { commandRegistry } from '../server/commands/defaultRegistry';
import { COMMAND_MANIFEST } from '../lib/commands.generated';
import { COMMAND_INPUT_SCHEMA_NAMES } from '../server/commands/openApiSchemas.generated';
import { openApiDocument } from '../server/openapi';
import { REGISTERED_COMMAND_NAMES } from '../../sdk/commands.generated';
import { renderCommandArtifacts } from '../../scripts/generate-commands';
import type { CommandInput } from '../../sdk/commands.generated';

test('generated SDK inputs follow command schemas while remaining browser-safe', () => {
  const alertInput: CommandInput<'alerts.update'> = { cashLowCents: 50000, closeReminderDay: 5, budgetAlerts: true };
  const customerInput: CommandInput<'customer.create'> = { customer: { name: 'Acme' } };
  const customerUpdate: CommandInput<'customer.update'> = { id: 'customer-1', data: { email: 'billing@example.test' } };
  const vendorInput: CommandInput<'vendor.create'> = { vendor: { name: 'Paper Co', category: 'Office Supplies' } };
  const vendorUpdate: CommandInput<'vendor.update'> = { id: 'vendor-1', data: { billsExpected: false } };
  const warrantyUpdate: CommandInput<'warranty.update'> = {
    candidate: { id: 'w_example', workspaceId: 'workspace-1', customerId: 'customer-1', invoiceId: 'invoice-1', invoiceLineId: 'line-1', itemId: 'item-1', serial: 'SN-100' },
    endDate: '2028-01-15',
  };
  const autoRuleCreate: CommandInput<'autorule.create'> = { rule: { condition: { descriptionContains: 'Shell' }, action: { targetAccountId: 'expense' } } };
  const autoRuleGroup: CommandInput<'autorule.group'> = { groupName: 'General', groupIsActive: false };
  const numberingUpdate: CommandInput<'numbering.update'> = { type: 'invoice', prefix: 'INV-2027-', nextNumber: 1, padding: 4 };
  const invoiceInput: CommandInput<'invoice.create'> = { invoice: { status: 'sent' } };
  const billInput: CommandInput<'bill.create'> = { bill: { vendorId: 'vendor-1', amountCents: 1200, dueDate: '2026-12-15', status: 'pending' } };
  const invoiceUpdate: CommandInput<'invoice.update'> = { id: 'invoice-1', data: { status: 'sent' } };
  const creditNoteInput: CommandInput<'creditnote.create'> = { creditNote: { customerId: 'customer-1', amountCents: 1200, date: '2026-11-15' } };
  const vendorCreditInput: CommandInput<'vendorcredit.create'> = { vendorCredit: { vendorId: 'vendor-1', amountCents: 900, date: '2026-11-15' } };
  const invoiceDelete: CommandInput<'invoice.delete'> = { id: 'invoice-1' };
  const taskInput: CommandInput<'tasks.create'> = { task: { title: 'Review the Acme invoice', assignee: 'user_123' } };
  const watchInput: CommandInput<'watches.create'> = { record: { type: 'invoice', id: 'invoice_1', label: 'Invoice INV-1' } };
  const linkInput: CommandInput<'entrylink.create'> = { a: 'transaction_1', b: 'transaction_2', note: 'Correction' };
  const timeInput: CommandInput<'time.log'> = { entry: { date: '2026-11-15', minutes: 60, description: 'Close the month' } };
  const stageInput: CommandInput<'stages.move'> = { kind: 'bill', id: 'bill_1', stage: 'Checked' };
  const notifyEmailInput: CommandInput<'account.setnotificationemail'> = { mode: 'daily' };
  const groupShareInput: CommandInput<'groups.share'> = { groupId: 'grp_0123456789abcdef0123', email: 'accountant@example.test' };
  const groupDeleteInput: CommandInput<'groups.delete'> = { groupId: 'grp_0123456789abcdef0123' };
  assert.equal(alertInput.cashLowCents, 50000);
  assert.equal(customerInput.customer.name, 'Acme');
  assert.equal(customerUpdate.data.email, 'billing@example.test');
  assert.equal(vendorInput.vendor.name, 'Paper Co');
  assert.equal(vendorUpdate.data.billsExpected, false);
  assert.equal(warrantyUpdate.candidate.serial, 'SN-100');
  assert.equal(autoRuleCreate.rule.action.targetAccountId, 'expense');
  assert.equal(autoRuleGroup.groupIsActive, false);
  assert.equal(numberingUpdate.type, 'invoice');
  assert.equal(invoiceInput.invoice.status, 'sent');
  assert.equal(billInput.bill.dueDate, '2026-12-15');
  assert.equal(invoiceUpdate.data.status, 'sent');
  assert.equal(creditNoteInput.creditNote.customerId, 'customer-1');
  assert.equal(vendorCreditInput.vendorCredit.vendorId, 'vendor-1');
  assert.equal(invoiceDelete.id, 'invoice-1');
  assert.equal(taskInput.task.title, 'Review the Acme invoice');
  assert.equal((watchInput.record as { label: string }).label, 'Invoice INV-1');
  assert.equal(linkInput.note, 'Correction');
  assert.equal(timeInput.entry.description, 'Close the month');
  assert.equal(stageInput.stage, 'Checked');
  assert.equal(notifyEmailInput.mode, 'daily');
  assert.equal(groupShareInput.email, 'accountant@example.test');
  assert.equal(groupDeleteInput.groupId, 'grp_0123456789abcdef0123');
  // @ts-expect-error the notice-email mode is the registry's enum, not arbitrary text.
  const invalidNotifyMode: CommandInput<'account.setnotificationemail'> = { mode: 'weekends' };
  void invalidNotifyMode;
  // @ts-expect-error customer names are strings in the registry schema.
  const invalidCustomer: CommandInput<'customer.create'> = { customer: { name: 42 } };
  // @ts-expect-error a customer balance is server-managed, not an editable profile field.
  const invalidCustomerBalance: CommandInput<'customer.update'> = { id: 'customer-1', data: { balanceCents: 100 } };
  // @ts-expect-error vendor balances are server-managed, not part of vendor creation.
  const invalidVendorBalance: CommandInput<'vendor.create'> = { vendor: { name: 'Paper Co', balanceCents: 100 } };
  // @ts-expect-error invoice status is a registry enum, not arbitrary text.
  const invalidInvoiceStatus: CommandInput<'invoice.create'> = { invoice: { status: 'posted' } };
  // @ts-expect-error bill dueDate is required by the document schema.
  const missingBillDueDate: CommandInput<'bill.create'> = { bill: { vendorId: 'vendor-1', amountCents: 1200, status: 'pending' } };
  // @ts-expect-error invoice updates retain the schema's status enum.
  const invalidInvoiceUpdateStatus: CommandInput<'invoice.update'> = { id: 'invoice-1', data: { status: 'posted' } };
  // @ts-expect-error credit notes require an integer amount and a date.
  const invalidCreditNote: CommandInput<'creditnote.create'> = { creditNote: { customerId: 'customer-1', amountCents: '1200' } };
  void invalidCustomer;
  void invalidCustomerBalance;
  void invalidVendorBalance;
  void invalidInvoiceStatus;
  void missingBillDueDate;
  void invalidInvoiceUpdateStatus;
  void invalidCreditNote;
});

test('generated command metadata, OpenAPI schemas, and SDK names match the registry', () => {
  assert.deepEqual(COMMAND_MANIFEST.map(command => command.name), commandRegistry.names());
  assert.deepEqual(REGISTERED_COMMAND_NAMES, commandRegistry.names());
  const schemas = openApiDocument().components.schemas as Record<string, unknown>;
  for (const definition of COMMAND_MANIFEST) {
    const registered = commandRegistry.get(definition.name);
    assert.ok(registered, `${definition.name} is missing from the server registry`);
    assert.deepEqual(definition.roles, registered.roles, `${definition.name} role metadata is stale`);
    assert.equal('allowPlatformAdmin' in definition ? definition.allowPlatformAdmin : undefined, registered.allowPlatformAdmin || undefined, `${definition.name} platform-admin metadata is stale`);
    assert.equal(
      (definition as { scope?: string }).scope,
      registered.scope === 'person' ? 'person' : undefined,
      `${definition.name} scope metadata is stale`,
    );
    assert.deepEqual(definition.inputSchema, z.toJSONSchema(registered.input, { io: 'input', unrepresentable: 'any' }), `${definition.name} input schema is stale`);
    assert.deepEqual(schemas[COMMAND_INPUT_SCHEMA_NAMES[definition.name]], definition.inputSchema,
      `${definition.name} OpenAPI input schema is stale`);
  }
  const commandRequest = schemas.CommandRequest as { properties?: { input?: { anyOf?: Array<{ $ref?: string }>; oneOf?: Array<{ $ref?: string }> } } };
  assert.deepEqual(commandRequest.properties?.input?.anyOf, COMMAND_MANIFEST.map(command => ({
    $ref: `#/components/schemas/${COMMAND_INPUT_SCHEMA_NAMES[command.name]}`,
  })));
  assert.equal(commandRequest.properties?.input?.oneOf, undefined,
    'shared requests allow inputs that match more than one registered command schema (for example, delete IDs)');
  for (const [relativePath, expected] of Object.entries(renderCommandArtifacts())) {
    assert.equal(fs.readFileSync(relativePath, 'utf8'), expected,
      `${relativePath} is stale; run npm run commands:generate`);
  }
});
