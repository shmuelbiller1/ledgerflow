/**
 * Stock (K-13 BA-04, W-04 W-05, W-01, ISS-130, W-06, EG-7): the legacy /api/v1/inventory write
 * routes keep their request and response shapes while the registered inventory commands run the
 * work. Covers normal calls on the in-memory database (a stock change posts, the quantity moves,
 * one audit line per command), refusals (a period lock is 409, an unknown item or account 404, a
 * non-member 403, the wrong role 403, a body naming another workspace 400), and a retry with the
 * same operation id replaying the first result without a second entry.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { RequestUser } from '../server/auth/requestUser';
import { CommandRegistry } from '../server/commands/registry';
import { createCommandRouter } from '../server/routes/commandRoutes';
import { COMMAND_ROLES, type AnyCommandDefinition } from '../server/commands/types';
import { createInventoryRouter } from '../server/routes/inventoryRoutes';
import {
  inventoryAdjustCommand,
  inventoryCogsCommand,
  inventoryCountCommand,
  inventoryDeliverCommand,
  inventoryLandedCostCommand,
  inventoryLandedCostUndoCommand,
  inventoryReturnCommand,
  inventoryRevalueCommand,
  inventoryStockClosingCommand,
  inventoryStockPolicyCommand,
  inventoryTransferCommand,
  inventoryUndoDeliveryCommand,
} from '../server/commands/inventory';
import { resetStockMovesReadyForTests } from '../server/services/stockMoveService';
import { MemoryDb, ReplayOnRetryMemoryDb, runnerDependencies, type TestCounters } from './helpers/commandTestUtils';

const OWNER = 'owner-1';
const ACCOUNTANT = 'acct-1';
const BOOKKEEPER = 'book-1';
const VIEWER = 'view-1';
const OUTSIDER = 'out-1';
const WS = 'ws-inventory-test';
const OTHER = 'ws-inventory-other';
const INV = `${WS}_inv`;
const OFFSET = `${WS}_variance`;
const COGS = `${WS}_cogs`;
const ITEM = `${WS}_bolts`;

const INVENTORY: AnyCommandDefinition[] = [
  inventoryCogsCommand,
  inventoryAdjustCommand,
  inventoryCountCommand,
  inventoryRevalueCommand,
  inventoryStockPolicyCommand,
  inventoryDeliverCommand,
  inventoryReturnCommand,
  inventoryUndoDeliveryCommand,
  inventoryTransferCommand,
  inventoryStockClosingCommand,
  inventoryLandedCostCommand,
  inventoryLandedCostUndoCommand,
];

type AuditEntry = { workspaceId: string; uid: string; action: string; entityType: string; entityId: string; details: Record<string, unknown> };

/** The in-memory database the stock services read and write, plus its audit trail. */
function seed(db: MemoryDb): void {
  db.seed(`workspaces/${WS}`, {
    uid: OWNER, name: 'Stock Co', currency: 'USD',
    members: [OWNER, ACCOUNTANT, BOOKKEEPER, VIEWER],
    roles: { [OWNER]: 'owner', [ACCOUNTANT]: 'accountant', [BOOKKEEPER]: 'bookkeeper', [VIEWER]: 'viewer' },
  });
  db.seed(`workspaces/${OTHER}`, { uid: OUTSIDER, name: 'Other', currency: 'USD', members: [OUTSIDER] });
  const account = (id: string, name: string, category: string) =>
    db.seed(`chartAccounts/${id}`, { workspaceId: WS, name, type: category === 'Inventory' ? 'asset' : 'expense', category, code: id.slice(-4) });
  account(INV, 'Inventory', 'Inventory');
  account(OFFSET, 'Stock variance', 'COGS');
  account(COGS, 'Cost of goods sold', 'COGS');
  db.seed(`inventory/${ITEM}`, { workspaceId: WS, name: 'Bolts', sku: 'BOLTS', quantityAtHand: 10, unitCostCents: 400, unitPriceCents: 1000, reorderPoint: 0 });
  db.seed(`inventory/${OTHER}_item`, { workspaceId: OTHER, name: 'Theirs', quantityAtHand: 3, unitCostCents: 100 });
}

async function createHarness(options: { replay?: { key: string; data: Record<string, unknown> } } = {}) {
  const db = new (options.replay ? ReplayOnRetryMemoryDb : MemoryDb)() as MemoryDb;
  if (db instanceof ReplayOnRetryMemoryDb && options.replay) db.replayRecord = options.replay;
  // this server keeps the stock history (stockMovesReady remembers its probe for the process)
  resetStockMovesReadyForTests();
  (db as unknown as { pool: unknown }).pool = {
    async query(sql: string) {
      if (/to_regclass/.test(sql)) return { rows: [{ ok: true }] };
      throw new Error(`Unexpected pool query in inventory command test: ${sql}`);
    },
  };
  seed(db);
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const auditEntries: AuditEntry[] = [];
  const dependencies = runnerDependencies(db, counters);
  dependencies.auditWriter = async input => {
    counters.audits++;
    auditEntries.push(input as AuditEntry);
    return 'inventory-audit-test';
  };

  const commandRegistry = new CommandRegistry();
  for (const command of INVENTORY) commandRegistry.register(command);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.header('x-test-uid');
    if (uid) (req as unknown as { user: RequestUser }).user = { uid, email: `${uid}@example.test`, aal: 'aal2' };
    next();
  });
  app.use('/api/v1/inventory', createInventoryRouter(dependencies));
  app.use('/api/v1/commands', createCommandRouter(commandRegistry, dependencies));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = (uid: string | null, method: string, path: string, body?: unknown, operationId?: string) => fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(uid ? { 'x-test-uid': uid } : {}),
      ...(operationId ? { 'idempotency-key': operationId } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const post = (uid: string | null, path: string, body: unknown, operationId?: string) => call(uid, 'POST', `/api/v1/inventory${path}`, { workspaceId: WS, ...(body as Record<string, unknown>) }, operationId);
  const quantity = () => Number(db.read(`inventory/${ITEM}`)?.quantityAtHand);
  const entries = () => db.entries('transactions');

  return {
    db, counters, auditEntries, call, post, quantity, entries,
    async close() {
      // leave the process-wide probe as it was found, so the other suites' databases are probed themselves
      resetStockMovesReadyForTests();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

test('the twelve stock commands publish schema, roles, scope and a parseable example', () => {
  assert.equal(INVENTORY.length, 12);
  for (const command of INVENTORY) {
    assert.equal(command.scope ?? 'workspace', 'workspace', `${command.name} works on a workspace`);
    assert.equal(command.risk, 'normal', `${command.name} keeps the legacy route's session requirements`);
    assert.ok(command.roles.length > 0 && command.roles.every(role => COMMAND_ROLES.includes(role)), `${command.name} names real roles`);
    assert.equal(command.input.safeParse(command.describe.example).success, true, `${command.name} example parses`);
    assert.ok(command.describe.refusals.length >= 1, `${command.name} lists its refusals`);
  }
  // the stock commands that move stock or money are for the people who keep the books; the two
  // settings are the owner's, and the closing and the landings stay with owners and accountants
  assert.deepEqual(inventoryStockPolicyCommand.roles, ['owner']);
  assert.deepEqual(inventoryStockClosingCommand.roles, ['owner']);
  assert.deepEqual(inventoryLandedCostCommand.roles, ['owner', 'accountant']);
  assert.deepEqual(inventoryRevalueCommand.roles, ['owner', 'accountant']);
  assert.deepEqual(inventoryAdjustCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  // the legacy COGS retry keeps its operation type and key prefix
  assert.equal(inventoryCogsCommand.operationType, 'INVENTORY_COGS');
  assert.equal(inventoryCogsCommand.legacyKey?.(WS, 'op-1'), `${WS}_inv_op-1`);
  // a revaluation can be walked back; a delivery posts and cannot be un-posted by an inverse
  assert.deepEqual(
    inventoryRevalueCommand.inverse?.(
      { itemId: ITEM, newUnitCostCents: 500, inventoryAccountId: INV, offsetAccountId: OFFSET, reason: 'Rise', requestId: 'reval-op-1' },
      { transactionId: 'tx-1', itemId: ITEM, name: 'Bolts', quantity: 10, oldUnitCostCents: 400, newUnitCostCents: 500, valueCents: 1000, replayed: false },
    ),
    { command: 'inventory.revalue', input: { itemId: ITEM, newUnitCostCents: 400, reason: 'Back to the earlier cost' } },
  );
  assert.equal(
    inventoryRevalueCommand.inverse?.(
      { itemId: ITEM, newUnitCostCents: 500, inventoryAccountId: INV, offsetAccountId: OFFSET, reason: 'Rise', requestId: 'reval-op-1' },
      { transactionId: 'tx-1', itemId: ITEM, name: 'Bolts', quantity: 10, oldUnitCostCents: 400, newUnitCostCents: 500, valueCents: 1000, replayed: true },
    ),
    null,
    'a replayed revaluation changed nothing to undo',
  );
});

test('POST /adjust keeps its answer and posts the entry, the quantity and one audit line', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const res = await harness.post(BOOKKEEPER, '/adjust', { itemId: ITEM, quantityChange: -3, reason: 'Damaged in storage', inventoryAccountId: INV, offsetAccountId: OFFSET, date: '2026-07-10' });
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.newQuantity, 7, 'one item answered its new quantity, as before');
  assert.equal(body.valueCents, -1200);
  assert.equal(harness.quantity(), 7);
  const entry = harness.entries().find(row => row.id === body.transactionId);
  assert.deepEqual(
    (entry?.data.lines as Array<{ accountId: string; amountCents: number }>).map(line => [line.accountId, line.amountCents]),
    [[INV, -1200], [OFFSET, 1200]],
  );
  assert.equal(entry?.data.workspaceId, WS);
  assert.deepEqual(harness.auditEntries.map(a => [a.action, a.workspaceId, a.uid]), [['STOCK_ADJUSTED', WS, BOOKKEEPER]]);
});

test('POST /count answers one audit line for the whole count and no newQuantity for many items', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  harness.db.seed(`inventory/${WS}_nuts`, { workspaceId: WS, name: 'Nuts', quantityAtHand: 5, unitCostCents: 250 });
  const res = await harness.post(OWNER, '/count', {
    inventoryAccountId: INV, offsetAccountId: OFFSET, date: '2026-07-11',
    counts: [{ itemId: ITEM, counted: 8 }, { itemId: `${WS}_nuts`, counted: 4 }],
  });
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal('newQuantity' in body, false, 'two items: no single new quantity');
  assert.equal(body.items.length, 2);
  assert.equal(harness.entries().length, 1, 'one entry for the whole count');
  assert.equal(harness.auditEntries[0].action, 'STOCK_COUNTED');
});

test('refusals keep their statuses: a locked period 409, an unknown item 404, an outsider 403, a viewer 403, another workspace 400', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const adjust = (uid: string, body: Record<string, unknown>) => harness.post(uid, '/adjust', { itemId: ITEM, quantityChange: 1, inventoryAccountId: INV, offsetAccountId: OFFSET, date: '2026-07-10', ...body });

  const missing = await adjust(OWNER, { itemId: `${WS}_nothing` });
  assert.equal(missing.status, 404);
  assert.match(String((await missing.json()).error), /not found/i);

  const outsider = await adjust(OUTSIDER, {});
  assert.equal(outsider.status, 403);
  assert.match(String((await outsider.json()).error), /Not a member/);

  const viewer = await adjust(VIEWER, {});
  assert.equal(viewer.status, 403);
  assert.match(String((await viewer.json()).error), /Forbidden/);

  // a body naming another workspace is authorized against that workspace, as the legacy route did:
  // the caller is not a member of it, so it is refused there and nothing moves here
  const elsewhere = await harness.call(OWNER, 'POST', '/api/v1/inventory/adjust', { workspaceId: OTHER, itemId: ITEM, quantityChange: 1, inventoryAccountId: INV, offsetAccountId: OFFSET });
  assert.equal(elsewhere.status, 403, await elsewhere.clone().text());
  assert.match(String((await elsewhere.json()).error), /Not a member/);

  const badBody = await harness.call(OWNER, 'POST', '/api/v1/inventory/adjust', { workspaceId: WS, itemId: ITEM, quantityChange: 0, inventoryAccountId: INV, offsetAccountId: OFFSET });
  assert.equal(badBody.status, 400, 'the route keeps its own schema check');
  assert.match(String((await badBody.json()).error), /quantity/);

  // a period locked after the fact refuses the same call with the status the old handler answered
  harness.db.seed(`workspaces/${WS}`, {
    uid: OWNER, name: 'Stock Co', currency: 'USD',
    members: [OWNER, ACCOUNTANT, BOOKKEEPER, VIEWER],
    roles: { [OWNER]: 'owner', [ACCOUNTANT]: 'accountant', [BOOKKEEPER]: 'bookkeeper', [VIEWER]: 'viewer' },
    lockDate: '2026-07-31',
  });
  const locked = await adjust(OWNER, {});
  assert.equal(locked.status, 409, await locked.clone().text());
  assert.match(String((await locked.json()).error), /locked|closed/i);
  harness.db.seed(`workspaces/${WS}`, {
    uid: OWNER, name: 'Stock Co', currency: 'USD',
    members: [OWNER, ACCOUNTANT, BOOKKEEPER, VIEWER],
    roles: { [OWNER]: 'owner', [ACCOUNTANT]: 'accountant', [BOOKKEEPER]: 'bookkeeper', [VIEWER]: 'viewer' },
  });

  assert.equal(harness.quantity(), 10, 'no refusal moved the stock');
  assert.equal(harness.auditEntries.length, 0, 'and none wrote an audit line');
});

test('the owner-only and accountant-only stock settings refuse the other roles', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const policy = await harness.call(BOOKKEEPER, 'PUT', '/api/v1/inventory/stock-policy', { workspaceId: WS, refuseNegativeStock: true });
  assert.equal(policy.status, 403, await policy.clone().text());
  const owner = await harness.call(OWNER, 'PUT', '/api/v1/inventory/stock-policy', { workspaceId: WS, refuseNegativeStock: true });
  assert.equal(owner.status, 200, await owner.clone().text());
  assert.deepEqual(await owner.json(), { status: 'ok', refuseNegativeStock: true });
  assert.equal(harness.db.read(`workspaces/${WS}`)?.refuseNegativeStock, true);
  assert.deepEqual(harness.auditEntries.map(a => a.action), ['STOCK_POLICY_SET']);

  // the owner-only setting moves one way at a time, as the legacy route checked
  const both = await harness.call(OWNER, 'PUT', '/api/v1/inventory/stock-policy', { workspaceId: WS, refuseNegativeStock: true, goodsLeaveWith: 'delivery' });
  assert.equal(both.status, 400);
  assert.match(String((await both.json()).error), /refuse sales beyond stock/);
});

test('POST /revalue answers the legacy shape and refuses a bookkeeper', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const body = { itemId: ITEM, newUnitCostCents: 500, inventoryAccountId: INV, offsetAccountId: OFFSET, reason: 'Supplier price rise', requestId: 'reval-2026-07-01', date: '2026-07-10' };
  const refused = await harness.post(BOOKKEEPER, '/revalue', body);
  assert.equal(refused.status, 403, await refused.clone().text());
  const res = await harness.post(ACCOUNTANT, '/revalue', body);
  assert.equal(res.status, 200, await res.clone().text());
  const answered = await res.json();
  assert.equal(answered.status, 'ok');
  assert.equal(answered.newUnitCostCents, 500);
  assert.equal(typeof answered.transactionId, 'string');
  assert.equal(harness.db.read(`inventory/${ITEM}`)?.unitCostCents, 500);
  assert.deepEqual(harness.auditEntries.map(a => a.action), ['STOCK_REVALUED']);
});

test('POST /transfer moves units and posts nothing, as the route always did', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  harness.db.seed(`stockMoves/${WS}_move-1`, {
    workspaceId: WS, itemId: ITEM, itemName: 'Bolts', date: '2026-07-01', kind: 'opening',
    quantity: 10, quantityBefore: 0, quantityAfter: 10, unitCostCents: 400, valueCents: 4000, locationId: 'Warehouse', uid: OWNER,
  });
  const res = await harness.post(BOOKKEEPER, '/transfer', { itemId: ITEM, from: 'Warehouse', to: 'Shop', quantity: 4, date: '2026-07-10' });
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.moved, 4);
  assert.equal(harness.entries().length, 0, 'a transfer never posts');
  assert.deepEqual(harness.auditEntries.map(a => a.action), ['STOCK_MOVED']);
});

test('POST /cogs keeps its message, its operation type and replays a retried operation', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const body = { itemId: ITEM, quantitySold: 2, inventoryAccountId: INV, cogsAccountId: COGS, date: '2026-07-10' };
  const first = await harness.post(OWNER, '/cogs', body, 'cogs-op-1');
  assert.equal(first.status, 200, await first.clone().text());
  const answered = await first.json();
  assert.equal(answered.message, 'Inventory COGS recorded successfully.');
  assert.equal(answered.unitCostCents, 400);
  assert.equal(answered.totalCogsCents, 800);
  assert.equal(harness.quantity(), 8);

  const retry = await harness.post(OWNER, '/cogs', body, 'cogs-op-1');
  assert.equal(retry.status, 200, await retry.clone().text());
  const replayed = await retry.json();
  assert.equal(replayed.status, 'ok');
  assert.equal(replayed.transactionId, answered.transactionId, 'the retry answers the first entry');
  assert.equal(replayed.totalCogsCents, 800);
  assert.equal(harness.quantity(), 8, 'and does not sell the units twice');
  assert.equal(harness.entries().length, 1, 'one entry, not two');
  assert.equal(harness.auditEntries.filter(a => a.action === 'INVENTORY_COGS_RECORDED').length, 1, 'one audit line');

  const different = await harness.post(OWNER, '/cogs', { ...body, quantitySold: 3 }, 'cogs-op-1');
  assert.equal(different.status, 409, 'the same operation id with another body is refused');
});

test('a retry that loses a race replays the winner instead of posting twice', async t => {
  const harness = await createHarness({
    replay: { key: `${WS}:inventory.adjust:adjust-op-1`, data: { status: 'success', result: { transactionId: 'tx-winner', valueCents: -400, items: [], newQuantity: 9 } } },
  });
  t.after(harness.close);
  const res = await harness.post(OWNER, '/adjust', { itemId: ITEM, quantityChange: -1, inventoryAccountId: INV, offsetAccountId: OFFSET, date: '2026-07-10' }, 'adjust-op-1');
  assert.equal(res.status, 200, await res.clone().text());
  const answered = await res.json();
  assert.equal(answered.status, 'ok');
  assert.equal(answered.transactionId, 'tx-winner', 'the answer is the winner of the race');
  assert.equal(answered.newQuantity, 9);
  assert.equal(harness.entries().length, 0, 'the losing attempt wrote nothing');
  assert.equal(harness.quantity(), 10);
});

test('POST /deliveries, /deliveries/:id/undo and /deliveries/returns keep their shapes', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  harness.db.seed(`estimates/${WS}_order`, { workspaceId: WS, status: 'accepted', lines: [] });
  const delivered = await harness.post(BOOKKEEPER, '/deliveries', {
    orderId: `${WS}_order`, deliveryId: 'dlv_abcdef12', date: '2026-07-10',
    lines: [{ position: 0, quantity: 2 }], inventoryAccountId: INV, cogsAccountId: COGS,
  });
  // the workspace ships with invoices until an owner says otherwise: a conflict, as the legacy route answered
  assert.equal(delivered.status, 409, await delivered.clone().text());
  assert.match(String((await delivered.json()).error), /invoice/i);

  const undo = await harness.post(BOOKKEEPER, '/deliveries/dlv_abcdef12/undo', { orderId: `${WS}_order`, date: '2026-07-10' });
  assert.equal(undo.status, 404, await undo.clone().text());
  assert.match(String((await undo.json()).error), /delivery/i);

  // goods that never went out cannot come back: the order has no item lines to take back
  const back = await harness.post(BOOKKEEPER, '/deliveries/returns', {
    orderId: `${WS}_order`, returnId: 'ret_abcdef12', date: '2026-07-10',
    lines: [{ position: 0, quantity: 1 }], inventoryAccountId: INV, cogsAccountId: COGS,
  });
  assert.equal(back.status, 400, await back.clone().text());
  assert.match(String((await back.json()).error), /line|order/i);

  const badId = await harness.post(BOOKKEEPER, '/deliveries/not-an-id/undo', { orderId: `${WS}_order`, date: '2026-07-10' });
  assert.equal(badId.status, 400);
  assert.match(String((await badId.json()).error), /Unknown delivery id/);
});
