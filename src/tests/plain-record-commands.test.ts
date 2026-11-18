import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestUser } from '../server/auth/requestUser';
import { executeCommand } from '../server/utils/commandExecutor';
import { recordDeleteCommand, recordDeleteInput, recordSaveCommand, recordSaveInput } from '../server/commands/plainRecords';
import { createDefaultCommandRegistry } from '../server/commands/defaultRegistry';
import { PLAIN_RECORD_COLLECTIONS } from '../lib/plainRecords';
import {
  captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, type TestCounters, workspaceId,
} from './helpers/commandTestUtils';

const counters = (): TestCounters => ({ runs: 0, previews: 0, afterCommit: 0, audits: 0 });

function seeded(): MemoryDb {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('purchaseOrders/po-1', {
    id: 'po-1', uid: 'someone', workspaceId, poNumber: 'PO-1', status: 'draft', totalCents: 4_500,
  });
  db.seed('taxRates/tax-1', { id: 'tax-1', workspaceId, name: 'VAT 17', rate: 17 });
  db.seed('purchaseOrders/other-1', { id: 'other-1', workspaceId: 'ws-someone-else', poNumber: 'PO-X' });
  return db;
}

async function save(db: MemoryDb, input: unknown, user: RequestUser = owner) {
  const parsed = recordSaveInput.parse(input);
  return executeCommand(fakeRequest(user, { workspaceId, input: parsed }), captureResponse().response,
    { definition: recordSaveCommand, workspaceId, input: parsed }, runnerDependencies(db, counters()));
}

async function remove(db: MemoryDb, input: unknown, user: RequestUser = owner) {
  const parsed = recordDeleteInput.parse(input);
  return executeCommand(fakeRequest(user, { workspaceId, input: parsed }), captureResponse().response,
    { definition: recordDeleteCommand, workspaceId, input: parsed }, runnerDependencies(db, counters()));
}

test('record.save and record.delete are registered beside the other record commands', () => {
  const registry = createDefaultCommandRegistry();
  assert.equal(registry.get('record.save'), recordSaveCommand);
  assert.equal(registry.get('record.delete'), recordDeleteCommand);
  assert.deepEqual(recordSaveCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(recordDeleteCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(recordSaveCommand.describe.refusals.map(refusal => refusal.code),
    ['INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'ROLE_REQUIRED']);
});

test('the allow-list names ordinary records only, never a collection a command owns', () => {
  const registry = createDefaultCommandRegistry();
  // the ledger collections the hook branches to before it ever reaches the generic door
  for (const owned of ['invoices', 'bills', 'creditNotes', 'vendorCredits', 'transactions', 'journalEntries', 'chartAccounts']) {
    assert.equal((PLAIN_RECORD_COLLECTIONS as readonly string[]).includes(owned), false, `${owned} must keep its own command`);
  }
  assert.ok(registry.get('chartaccount.create'), 'the account the hook creates has a command of its own');
  assert.deepEqual([...PLAIN_RECORD_COLLECTIONS], [...PLAIN_RECORD_COLLECTIONS].sort());
});

test('a refused collection is named in the refusal, so a caller knows which command owns it', () => {
  assert.equal(recordSaveInput.safeParse({ collection: 'invoices', id: 'inv-1', data: { status: 'paid' } }).success, false);
  assert.equal(recordDeleteInput.safeParse({ collection: 'transactions', id: 't-1' }).success, false);
  // the caller's own bookkeeping is not part of the request
  assert.equal(recordSaveInput.safeParse({ collection: 'taxRates', data: { name: 'x' }, workspaceId }).success, false);
  assert.equal(recordSaveInput.safeParse({ collection: 'taxRates', data: {} }).success, false);
  assert.equal(recordSaveInput.safeParse({ collection: 'taxRates', id: 'a/b', data: { name: 'x' } }).success, false);
});

test('a create takes its identity and clock from the session, whatever the caller sent', async () => {
  const db = seeded();
  const outcome = await save(db, {
    collection: 'recurring', id: 'rule-new', create: true,
    data: {
      description: 'Rent', frequency: 'monthly', amountCents: 120_000,
      uid: 'spoofed-user', workspaceId: 'ws-someone-else', createdAt: '1999-01-01', updatedAt: '1999-01-01',
    },
  });
  assert.equal(outcome.ok, true);
  const row = db.read('recurring/rule-new')!;
  assert.equal(row.uid, owner.uid, 'the session owns the row, not the request body');
  assert.equal(row.workspaceId, workspaceId);
  assert.equal(row.createdAt, row.updatedAt);
  assert.ok(Math.abs(Date.parse(String(row.createdAt)) - Date.now()) < 60_000, 'the clock is the server’s');
  assert.equal(row.description, 'Rent');
  // the id the caller named is the id that was written, and it is answered with
  if (outcome.ok) assert.equal((outcome.data as { id?: string } | undefined)?.id, 'rule-new');
});

test('a create with no id gets one from the server, and a taken id is a conflict rather than a replace', async () => {
  const db = seeded();
  const chosen = await save(db, { collection: 'taxRates', create: true, data: { name: 'VAT 18', rate: 18 } });
  assert.equal(chosen.ok, true);
  const id = chosen.ok ? (chosen.data as { id?: string })?.id : undefined;
  assert.ok(id, 'the server answered with the id it stored');
  assert.equal(db.read(`taxRates/${String(id)}`)?.name, 'VAT 18');

  const taken = await save(db, { collection: 'purchaseOrders', id: 'po-1', create: true, data: { poNumber: 'PO-2' } });
  assert.equal(taken.ok, false);
  if (!taken.ok) assert.equal(taken.code, 'CONFLICT');
  assert.equal(db.read('purchaseOrders/po-1')?.poNumber, 'PO-1', 'the existing row is untouched');
});

test('a save is a patch over the row that was read, stamped by the server', async () => {
  const db = seeded();
  const outcome = await save(db, { collection: 'purchaseOrders', id: 'po-1', data: { status: 'approved' } });
  assert.equal(outcome.ok, true);
  const row = db.read('purchaseOrders/po-1')!;
  assert.equal(row.status, 'approved');
  assert.equal(row.totalCents, 4_500, 'a field the caller did not send is not erased');
  assert.equal(row.poNumber, 'PO-1');
  assert.equal(row.uid, 'someone', 'a save does not take ownership of a row the workspace already had');
  assert.notEqual(row.updatedAt, undefined);
});

test('a row in another workspace, or one that is not there, is NOT_FOUND and is never written', async () => {
  const db = seeded();
  const outside = await save(db, { collection: 'purchaseOrders', id: 'other-1', data: { status: 'cancelled' } });
  assert.equal(outside.ok, false);
  if (!outside.ok) assert.equal(outside.code, 'NOT_FOUND');
  assert.equal(db.read('purchaseOrders/other-1')?.status, undefined);

  const missing = await save(db, { collection: 'purchaseOrders', id: 'no-such-1', data: { status: 'draft' } });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, 'NOT_FOUND');

  // an explicit create into another workspace's id is refused too: a copied id must not become a second row
  const copied = await save(db, { collection: 'purchaseOrders', id: 'other-1', create: true, data: { poNumber: 'PO-Y' } });
  assert.equal(copied.ok, false);
  if (!copied.ok) assert.equal(copied.code, 'NOT_FOUND');
});

test('a delete removes the row it read and refuses another workspace’s', async () => {
  const db = seeded();
  const outside = await remove(db, { collection: 'purchaseOrders', id: 'other-1' });
  assert.equal(outside.ok, false);
  if (!outside.ok) assert.equal(outside.code, 'NOT_FOUND');
  assert.ok(db.read('purchaseOrders/other-1'), 'nothing was deleted');

  const deleted = await remove(db, { collection: 'taxRates', id: 'tax-1' });
  assert.equal(deleted.ok, true);
  assert.equal(db.read('taxRates/tax-1'), undefined);

  const again = await remove(db, { collection: 'taxRates', id: 'tax-1' });
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.code, 'NOT_FOUND');
});

test('a viewer is ROLE_REQUIRED for both commands, and writes and audits nothing', async () => {
  const db = seeded();
  const viewer: RequestUser = { uid: 'viewer-1', aal: 'aal2' };
  seedWorkspace(db, workspaceId, { uid: owner.uid, members: [owner.uid, viewer.uid], roles: { 'viewer-1': 'viewer' } });
  const saved = await save(db, { collection: 'taxRates', create: true, data: { name: 'VAT 18' } }, viewer);
  assert.equal(saved.ok, false);
  if (!saved.ok) assert.equal(saved.code, 'ROLE_REQUIRED');
  const deleted = await remove(db, { collection: 'taxRates', id: 'tax-1' }, viewer);
  assert.equal(deleted.ok, false);
  if (!deleted.ok) assert.equal(deleted.code, 'ROLE_REQUIRED');
  assert.equal(db.read('taxRates/tax-1')?.name, 'VAT 17');
});

test('the audit line says which collection and which fields, and the preview names them', async () => {
  const db = seeded();
  const audit = counters();
  const parsed = recordSaveInput.parse({ collection: 'purchaseOrders', id: 'po-1', data: { status: 'approved' } });
  const outcome = await executeCommand(fakeRequest(owner, { workspaceId, input: parsed }), captureResponse().response,
    { definition: recordSaveCommand, workspaceId, input: parsed }, runnerDependencies(db, audit));
  assert.equal(outcome.ok, true);
  assert.equal(audit.audits, 1);
  const line = recordSaveCommand.audit(parsed, { collection: 'purchaseOrders', id: 'po-1', created: false, updatedAt: '' });
  assert.ok(line, 'a save leaves a line');
  assert.deepEqual([line.action, line.entityType, line.entityId, line.details], ['RECORD_SAVED', 'purchaseOrders', 'po-1', { fields: 'status' }]);
  const created = recordSaveCommand.audit(parsed, { collection: 'purchaseOrders', id: 'po-1', created: true, updatedAt: '' });
  assert.equal(created?.action, 'RECORD_CREATED');
  assert.deepEqual(await recordSaveCommand.preview!({ db, workspaceId, user: owner } as never, parsed),
    { title: 'Save purchaseOrders', lines: ['status'] });
});

test('a dotted path lands inside the object, and a removed path is removed from the row that was read', async () => {
  const db = seeded();
  db.seed('inventory/item-1', {
    id: 'item-1', workspaceId, name: 'Widget',
    binLocations: { 'store-1': { locationId: 'store-1', bin: 'A1' }, 'store-2': { locationId: 'store-2', bin: 'B2' } },
  });
  // a bin is assigned by writing into `binLocations`, not by creating a field called "binLocations.store-1"
  const assigned = await save(db, {
    collection: 'inventory', id: 'item-1', data: { 'binLocations.store-3': { locationId: 'store-3', bin: 'C3' } },
  });
  assert.equal(assigned.ok, true);
  const afterAssign = db.read('inventory/item-1')!;
  assert.deepEqual(Object.keys(afterAssign.binLocations as object).sort(), ['store-1', 'store-2', 'store-3']);
  assert.equal('binLocations.store-3' in afterAssign, false, 'the path is not a literal key');

  // clearing a bin names the removal; the other bins stay where they were
  const cleared = await save(db, { collection: 'inventory', id: 'item-1', data: {}, unset: ['binLocations.store-1'] });
  assert.equal(cleared.ok, true);
  assert.deepEqual(Object.keys(db.read('inventory/item-1')!.binLocations as object).sort(), ['store-2', 'store-3']);

  // nothing to write and nothing to remove is not a save
  assert.equal(recordSaveInput.safeParse({ collection: 'inventory', id: 'item-1', data: {} }).success, false);
});

test('a field path cannot walk into the prototype chain', async () => {
  const db = seeded();
  // the schema refuses the segments outright, before a handler ever sees them
  for (const path of ['__proto__.polluted', 'constructor.prototype.polluted', 'binLocations.__proto__']) {
    assert.equal(recordSaveInput.safeParse({ collection: 'inventory', id: 'item-1', data: { [path]: true } }).success, false, path);
    assert.equal(recordSaveInput.safeParse({ collection: 'inventory', id: 'item-1', data: {}, unset: [path] }).success, false, path);
  }
  // and the walk itself only follows own properties, so a nested path cannot reach Object.prototype
  db.seed('inventory/item-1', { id: 'item-1', workspaceId, name: 'Lamp' });
  const outcome = await save(db, { collection: 'inventory', id: 'item-1', data: { 'binLocations.bin': 'A1' } });
  assert.equal(outcome.ok, true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined, 'nothing leaked onto every object in the process');
});

test('money fields stay with the commands that post them (#822)', async () => {
  const db = seeded();
  db.seed('assets/a-1', { id: 'a-1', workspaceId, name: 'Van', status: 'active', accumulatedDepreciationCents: 1_000, depreciatedThrough: '2026-09-30' });
  db.seed('assets/a-2', { id: 'a-2', workspaceId, name: 'Desk', status: 'active' });
  db.seed('inventory/i-1', { id: 'i-1', workspaceId, name: 'Bolt', quantityAtHand: 5, unitCostCents: 100 });
  db.seed('inventory/i-2', { id: 'i-2', workspaceId, name: 'Nut', quantityAtHand: 0, unitCostCents: 50 });
  db.seed('estimates/e-1', { id: 'e-1', workspaceId, status: 'accepted', totalCents: 9_000 });
  db.seed('purchaseOrders/po-r', { id: 'po-r', workspaceId, status: 'received' });

  const conflict = async (p: Promise<{ ok: boolean; code?: string }>) => {
    const r = await p; assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'CONFLICT');
  };
  await conflict(save(db, { collection: 'assets', id: 'a-1', data: { accumulatedDepreciationCents: 0 } }));
  await conflict(save(db, { collection: 'assets', id: 'a-2', data: { status: 'disposed' } }));
  await conflict(save(db, { collection: 'assets', create: true, data: { name: 'X', disposalTransactionId: 't' } }));
  await conflict(save(db, { collection: 'inventory', id: 'i-1', data: { unitCostCents: 1 } }));
  await conflict(save(db, { collection: 'inventory', id: 'i-1', data: { quantityAtHand: 50 } }));
  await conflict(save(db, { collection: 'estimates', id: 'e-1', data: { totalCents: 1 } }));
  await conflict(save(db, { collection: 'purchaseOrders', id: 'po-r', data: { status: 'draft' } }));
  await conflict(remove(db, { collection: 'assets', id: 'a-1' }));
  await conflict(remove(db, { collection: 'inventory', id: 'i-1' }));
  await conflict(remove(db, { collection: 'purchaseOrders', id: 'po-r' }));
  assert.equal(db.read('assets/a-1')?.accumulatedDepreciationCents, 1_000);
  assert.equal(db.read('inventory/i-1')?.unitCostCents, 100);

  const badRate = await save(db, { collection: 'taxRates', id: 'tax-1', data: { rate: 170 } });
  assert.equal(badRate.ok, false);
  if (!badRate.ok) assert.equal(badRate.code, 'INVALID_INPUT');

  // ordinary edits still go through
  assert.equal((await save(db, { collection: 'assets', id: 'a-1', data: { name: 'Blue van' } })).ok, true);
  assert.equal((await save(db, { collection: 'inventory', id: 'i-1', data: { name: 'Bolt M6' } })).ok, true);
  assert.equal((await save(db, { collection: 'inventory', id: 'i-2', data: { unitCostCents: 60 } })).ok, true);
  assert.equal((await remove(db, { collection: 'assets', id: 'a-2' })).ok, true);
  assert.equal((await remove(db, { collection: 'inventory', id: 'i-2' })).ok, true);
});
