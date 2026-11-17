/**
 * The writes that had no command: a contact's cached balance, and the workspace's labels.
 *
 * Both were the browser keeping a copy of something the rows already say. A contact's balance was summed from
 * whatever open documents the tab could see; the label list and the label values were written by the screen that
 * happened to hold them. These tests hold the commands to the arithmetic and the scoping that replaces that.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { customerBalanceCommand, vendorBalanceCommand, contactBalanceInput } from '../server/commands/contactBalances';
import { dimensionAxesCommand, dimensionNodeCommand, dimensionAxesInput, dimensionNodeInput } from '../server/commands/dimensions';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

test('a customer balance is the open invoices’ amount due, in the base currency, and a paid one counts nothing', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed(`customers/c1`, { id: 'c1', workspaceId, name: 'Acme', balanceCents: 999999 });
  db.seed('invoices/inv-open', { id: 'inv-open', workspaceId, customerId: 'c1', status: 'sent', amountCents: 10000, amountPaidCents: 2500, currency: 'USD' });
  db.seed('invoices/inv-paid', { id: 'inv-paid', workspaceId, customerId: 'c1', status: 'paid', amountCents: 5000, amountPaidCents: 5000, currency: 'USD' });
  db.seed('invoices/inv-draft', { id: 'inv-draft', workspaceId, customerId: 'c1', status: 'draft', amountCents: 7000, currency: 'USD' });
  db.seed('invoices/inv-other', { id: 'inv-other', workspaceId, customerId: 'c2', status: 'sent', amountCents: 8000, currency: 'USD' });

  const input = contactBalanceInput.parse({ id: 'c1' });
  const outcome = await executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: customerBalanceCommand, workspaceId, input }, runnerDependencies(db));
  assert.equal(outcome.ok, true);
  // 10000 − 2500 on the open invoice; the paid one nets to nothing, the draft is not issued, the other customer is not counted
  assert.equal(db.read('customers/c1')?.balanceCents, 7500);
  assert.equal(typeof db.read('customers/c1')?.updatedAt, 'string');
});

test('a balance cannot be recalculated for a contact that is not in this workspace', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('customers/elsewhere', { id: 'elsewhere', workspaceId: 'another-workspace', name: 'Not ours' });
  const input = contactBalanceInput.parse({ id: 'elsewhere' });
  const outcome = await executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: customerBalanceCommand, workspaceId, input }, runnerDependencies(db));
  assert.equal(outcome.ok, false);
  assert.equal(db.read('customers/elsewhere')?.balanceCents, undefined, 'the other workspace’s row is untouched');
});

test('a vendor balance sums the open bills, and is the mirror of the customer one', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('vendors/v1', { id: 'v1', workspaceId, name: 'Paper Co' });
  db.seed('bills/bill-open', { id: 'bill-open', workspaceId, vendorId: 'v1', status: 'open', amountCents: 12000, depositCents: 2000, currency: 'USD' });
  const input = contactBalanceInput.parse({ id: 'v1' });
  const outcome = await executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: vendorBalanceCommand, workspaceId, input }, runnerDependencies(db));
  assert.equal(outcome.ok, true);
  assert.equal(db.read('vendors/v1')?.balanceCents, 10000);
});

test('a label value is saved whole, or changed by the fields named — never by both at once', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  assert.equal(dimensionNodeInput.safeParse({ node: { id: 'P1', dimensionId: 'property', description: 'One' }, fields: { description: 'Two' } }).success, false);
  assert.equal(dimensionNodeInput.safeParse({ dimensionId: 'property', fields: { description: 'Two' } }).success, false, 'a change names the value');

  const save = dimensionNodeInput.parse({ node: { id: 'P1', dimensionId: 'property', description: '123 Ocean Ave Maint' } });
  const saved = await executeCommand(fakeRequest(owner, { workspaceId, input: save }), captureResponse().response,
    { definition: dimensionNodeCommand, workspaceId, input: save }, runnerDependencies(db));
  assert.equal(saved.ok, true);
  assert.equal(db.read(`dimensionNodes/${workspaceId}_property_P1`)?.description, '123 Ocean Ave Maint');
  assert.equal(db.read(`dimensionNodes/${workspaceId}_property_P1`)?.workspaceId, workspaceId);

  const change = dimensionNodeInput.parse({ dimensionId: 'property', nodeId: 'P1', fields: { description: '123 Ocean Ave', aliases: ['OCEAN'] } });
  const changed = await executeCommand(fakeRequest(owner, { workspaceId, input: change }), captureResponse().response,
    { definition: dimensionNodeCommand, workspaceId, input: change }, runnerDependencies(db));
  assert.equal(changed.ok, true);
  assert.equal(db.read(`dimensionNodes/${workspaceId}_property_P1`)?.description, '123 Ocean Ave');
  assert.deepEqual(db.read(`dimensionNodes/${workspaceId}_property_P1`)?.aliases, ['OCEAN']);
  assert.equal(db.read(`dimensionNodes/${workspaceId}_property_P1`)?.dimensionId, 'property', 'a patch leaves the rest alone');
});

test('a label value in another workspace cannot be changed through this one', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('dimensionNodes/another-workspace_property_P1', { id: 'another-workspace_property_P1', workspaceId: 'another-workspace', description: 'Theirs' });
  const input = dimensionNodeInput.parse({ dimensionId: 'property', nodeId: 'P1', fields: { description: 'Mine now' } });
  const outcome = await executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: dimensionNodeCommand, workspaceId, input }, runnerDependencies(db));
  assert.equal(outcome.ok, false);
  assert.equal(db.read('dimensionNodes/another-workspace_property_P1')?.description, 'Theirs');
});

test('the workspace label list is written once, and a label cannot appear twice', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  assert.equal(dimensionAxesInput.safeParse({ dimensions: [] }).success, false, 'a workspace with no labels is not a save');
  // a duplicate id is refused by the command rather than the schema: the reason is a conflict with what the
  // workspace already groups by, and it carries the sentence that says so
  const duplicate = dimensionAxesInput.parse({ dimensions: [{ id: 'property', name: 'Property' }, { id: 'property', name: 'Again' }] });
  const refused = await executeCommand(fakeRequest(owner, { workspaceId, input: duplicate }), captureResponse().response,
    { definition: dimensionAxesCommand, workspaceId, input: duplicate }, runnerDependencies(db));
  assert.equal(refused.ok, false);
  assert.equal(db.read(`workspaces/${workspaceId}`)?.dimensions, undefined, 'nothing is written when the list is refused');

  const input = dimensionAxesInput.parse({ dimensions: [{ id: 'property', name: 'Property' }, { id: 'class', name: 'Class', role: 'attributed' }] });
  const outcome = await executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: dimensionAxesCommand, workspaceId, input }, runnerDependencies(db));
  assert.equal(outcome.ok, true);
  assert.deepEqual(db.read(`workspaces/${workspaceId}`)?.dimensions, [
    { id: 'property', name: 'Property' },
    { id: 'class', name: 'Class', role: 'attributed' },
  ]);
});
