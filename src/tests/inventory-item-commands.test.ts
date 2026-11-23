/**
 * `inventoryitem.save` / `.field` / `.delete` — the item card as commands.
 *
 * The browser wrote all four with `addDoc`/`updateDoc`/`deleteDoc`, `metadata.documentDefaults` as a dotted path, and
 * `quantityAtHand` sitting in the same payload as the price. These tests hold the commands to the split the stock
 * commands next door depend on: a card cannot move stock, and a card with stock on it cannot be removed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import {
  inventoryItemDeleteCommand, inventoryItemDeleteInput, inventoryItemFieldCommand, inventoryItemFieldInput,
  inventoryItemSaveCommand, inventoryItemSaveInput,
} from '../server/commands/inventoryItems';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const runSave = (input: unknown, db: MemoryDb, user = owner) =>
  executeCommand(fakeRequest(user, { workspaceId, input }), captureResponse().response,
    { definition: inventoryItemSaveCommand, workspaceId, input }, runnerDependencies(db));
const runField = (input: unknown, db: MemoryDb) =>
  executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: inventoryItemFieldCommand, workspaceId, input }, runnerDependencies(db));
const runDelete = (input: unknown, db: MemoryDb) =>
  executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: inventoryItemDeleteCommand, workspaceId, input }, runnerDependencies(db));

const card = { name: 'Office chair', sku: 'CH-01', description: '', unitPriceCents: 24900, unitCostCents: 12000, reorderPoint: 5, category: 'Furniture' } as const;

test('a new card starts with no stock, and the stock cannot be sent with it', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const outcome = await runSave(inventoryItemSaveInput.parse(card), db);
  assert.equal(outcome.ok, true);
  const id = (outcome as unknown as { data: { id: string } }).data.id;
  const row = db.read(`inventory/${id}`)!;
  assert.equal(row.quantityAtHand, 0);
  assert.equal(row.workspaceId, workspaceId);
  assert.equal(inventoryItemSaveInput.safeParse({ ...card, quantityAtHand: 12 }).success, false, 'stock moves through its own commands');
});

test('the sale defaults live in the metadata and a change keeps the keys it was not sent', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('inventory/item_1', { id: 'item_1', workspaceId, name: 'Chair', metadata: { note: 'kept', documentDefaults: { taxCodeId: 'old' } } });
  const outcome = await runSave(inventoryItemSaveInput.parse({ ...card, id: 'item_1', documentDefaults: { taxCodeId: 'tax_sales' } }), db);
  assert.equal(outcome.ok, true);
  assert.deepEqual(db.read('inventory/item_1')!.metadata, { note: 'kept', documentDefaults: { taxCodeId: 'tax_sales' } });
  await runSave(inventoryItemSaveInput.parse({ ...card, id: 'item_1', documentDefaults: null }), db);
  assert.deepEqual(db.read('inventory/item_1')!.metadata, { note: 'kept' }, 'null takes the defaults away, the rest stays');
});

test('one cell changes one field, and only the fields a list corrects', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('inventory/item_1', { id: 'item_1', workspaceId, name: 'Chair', unitPriceCents: 100 });
  const outcome = await runField(inventoryItemFieldInput.parse({ id: 'item_1', field: 'unitPriceCents', value: 25900 }), db);
  assert.equal(outcome.ok, true);
  assert.equal(db.read('inventory/item_1')!.unitPriceCents, 25900);
  assert.equal(inventoryItemFieldInput.safeParse({ id: 'item_1', field: 'quantityAtHand', value: 3 }).success, false);
  // a blank name is refused where the field's own rule lives, and the row is untouched
  const blank = await runField(inventoryItemFieldInput.parse({ id: 'item_1', field: 'name', value: '   ' }), db);
  assert.equal(blank.ok, false);
  assert.equal((blank as unknown as { code?: string }).code, 'INVALID_INPUT');
  assert.equal(db.read('inventory/item_1')!.name, 'Chair');
});

test('an item with stock on hand is refused for removal, and one without is removed', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('inventory/item_1', { id: 'item_1', workspaceId, name: 'Chair', quantityAtHand: 4 });
  db.seed('inventory/item_2', { id: 'item_2', workspaceId, name: 'Desk', quantityAtHand: 0 });
  const refused = await runDelete(inventoryItemDeleteInput.parse({ id: 'item_1' }), db);
  assert.equal(refused.ok, false);
  assert.equal((refused as unknown as { code?: string }).code, 'CONFLICT');
  assert.match((refused as unknown as { message: string }).message, /still has 4 on hand/);
  assert.ok(db.read('inventory/item_1'));
  const removed = await runDelete(inventoryItemDeleteInput.parse({ id: 'item_2' }), db);
  assert.equal(removed.ok, true);
  assert.equal(db.read('inventory/item_2'), undefined);
});

test('an item from another workspace is not found for any of the three', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('inventory/item_9', { id: 'item_9', workspaceId: 'someone-else', name: 'Not mine' });
  for (const outcome of [
    await runSave(inventoryItemSaveInput.parse({ ...card, id: 'item_9' }), db),
    await runField(inventoryItemFieldInput.parse({ id: 'item_9', field: 'name', value: 'x' }), db),
    await runDelete(inventoryItemDeleteInput.parse({ id: 'item_9' }), db),
  ]) {
    assert.equal(outcome.ok, false);
    assert.equal((outcome as unknown as { code?: string }).code, 'NOT_FOUND');
  }
  assert.equal(db.read('inventory/item_9')!.workspaceId, 'someone-else');
});

test('the commands say what they are not: stock moves through the stock commands', async () => {
  assert.match(inventoryItemSaveCommand.describe.sentence, /do not use it to move stock/);
  assert.match(inventoryItemDeleteCommand.describe.sentence, /count or adjustment/);
  assert.equal(inventoryItemSaveCommand.risk, 'normal');
  assert.ok(inventoryItemSaveCommand.describe.next?.some(step => step.command === 'inventory.adjust'));
});

test('an edit may leave the cost out — the screen does that on purpose while the item has stock', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const created = await runSave({ name: 'Office chair', unitPriceCents: 24900, unitCostCents: 12000, reorderPoint: 5 }, db);
  const id = (created as unknown as { data: { id: string } }).data.id;

  const edited = await runSave({ id, name: 'Office chair (black)' }, db);
  assert.equal(edited.ok, true);
  const row = db.read(`inventory/${id}`)!;
  assert.equal(row.name, 'Office chair (black)');
  assert.equal(row.unitCostCents, 12000, 'the cost the person did not touch is kept');
});

test('a new card still needs its name, its price and its cost', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const missing = await runSave({ name: 'Lamp' }, db);
  assert.equal(missing.ok, false);
  assert.equal((missing as unknown as { code: string }).code, 'INVALID_INPUT');
  assert.equal(db.entries('inventory').length, 0);
});

test('#839: with stock on hand the cost is not changed on the card, by the form or by a cell', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('inventory/item_1', { id: 'item_1', workspaceId, name: 'Chair', quantityAtHand: 10, unitCostCents: 1000 });
  for (const outcome of [
    await runSave({ id: 'item_1', unitCostCents: 1 }, db),
    await runField({ id: 'item_1', field: 'unitCostCents', value: 1 }, db),
  ]) {
    assert.equal(outcome.ok, false);
    assert.equal((outcome as unknown as { code?: string }).code, 'CONFLICT');
  }
  assert.equal(db.read('inventory/item_1')?.unitCostCents, 1000, 'the stock keeps the value the ledger has');
  // the same cost, or a price, still saves
  assert.equal((await runSave({ id: 'item_1', unitCostCents: 1000, unitPriceCents: 2500 }, db)).ok, true);
  // without stock the cost is the card's to set
  db.seed('inventory/item_2', { id: 'item_2', workspaceId, name: 'Desk', quantityAtHand: 0, unitCostCents: 500 });
  assert.equal((await runField({ id: 'item_2', field: 'unitCostCents', value: 700 }, db)).ok, true);
});

test('M-21 step 2: with standard-cost posting on, the standard is not changed on the card with stock on hand', async () => {
  const db = new MemoryDb();
  // the workspace has standard-cost posting on
  seedWorkspace(db, workspaceId, { standardCosting: { enabled: true, varianceAccountId: 'acc_ppv' } });
  db.seed('inventory/item_1', { id: 'item_1', workspaceId, name: 'Chair', quantityAtHand: 10, unitCostCents: 5000, standardCostCents: 4000 });
  for (const outcome of [
    await runSave({ id: 'item_1', standardCostCents: 6000 }, db),
    await runField({ id: 'item_1', field: 'standardCostCents', value: 6000 }, db),
  ]) {
    assert.equal(outcome.ok, false);
    assert.equal((outcome as unknown as { code?: string }).code, 'CONFLICT');
  }
  assert.equal(db.read('inventory/item_1')?.standardCostCents, 4000, 'the stock keeps the standard the books have');
  // the same standard, or a price, still saves
  assert.equal((await runSave({ id: 'item_1', standardCostCents: 4000, unitPriceCents: 2500 }, db)).ok, true);
  // without stock the standard is the card's to set
  db.seed('inventory/item_2', { id: 'item_2', workspaceId, name: 'Desk', quantityAtHand: 0, unitCostCents: 500, standardCostCents: 400 });
  assert.equal((await runField({ id: 'item_2', field: 'standardCostCents', value: 700 }, db)).ok, true);
});

test('#839: the bin levels are the reorder band the screen sends, never a stock quantity', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('inventory/item_1', { id: 'item_1', workspaceId, name: 'Chair', quantityAtHand: 10, unitCostCents: 1000 });
  // the screen always sends the map, empty or not: both used to be refused
  assert.equal((await runSave({ id: 'item_1', name: 'Chair', locationLevels: {} }, db)).ok, true);
  const saved = await runSave({ id: 'item_1', locationLevels: { 'loc-1': { min: 2, max: 8 } } }, db);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.deepEqual(db.read('inventory/item_1')?.locationLevels, { 'loc-1': { min: 2, max: 8 } });
  assert.equal(db.read('inventory/item_1')?.quantityAtHand, 10);
  // the old array of quantities is not a shape the card takes
  const forged = await runSave({ id: 'item_1', locationLevels: [{ locationId: 'loc-1', quantityAtHand: 999 }] }, db);
  assert.equal(forged.ok, false);
  assert.equal((await runSave({ id: 'item_1', locationLevels: { 'loc-1': { min: 9, max: 2 } } }, db)).ok, false, 'max below min');
});
