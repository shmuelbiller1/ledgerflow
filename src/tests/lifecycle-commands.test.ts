/**
 * The asset-lifecycle, document-adjustment, return-authorization and client-query batch: seventeen
 * registered commands behind addresses that already existed.
 *
 * Each service here owns its rule, its own serializable transaction, its audit line and its words;
 * the command adds the registered door — one name, one schema, a role list, a read-only preview, an
 * inverse where one exists, and the runner's checks — while the route keeps the answer it gave
 * before. The tests below prove the parts a route move can break: the metadata an assistant reads,
 * the preview that writes nothing, the runner's role and workspace checks, the service's status and
 * words coming back out of the runner, and the inverse. The route tests themselves run against a
 * database (they mount `workspaceRoutes`, which needs one), so this file covers the layer that moved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMAND_ROLES, type AnyCommandDefinition } from '../server/commands/types';
import {
  ASSET_COMMANDS, assetDisposeCommand, assetPlaceInServiceCommand, assetTransferCommand, assetUndoDisposalCommand,
} from '../server/commands/assets';
import { DOCUMENT_ADJUSTMENT_COMMANDS, billSpreadCommand, invoiceWriteOffCommand } from '../server/commands/documentAdjustments';
import { RMA_COMMANDS, rmaMoveCommand, rmaRequestCommand } from '../server/commands/returns';
import { CLIENT_QUERY_COMMANDS, queryAskCommand, queryCloseCommand } from '../server/commands/clientQueries';
import { commandHarness, MemoryDb } from './helpers/commandTestUtils';

const OWNER = 'owner-1';
const ACCOUNTANT = 'acct-1';
const BOOKKEEPER = 'book-1';
const VIEWER = 'view-1';
const OUTSIDER = 'out-1';
const WS = 'ws-lifecycle-test';
const OTHER = 'ws-lifecycle-other';

const COMMANDS: AnyCommandDefinition[] = [...ASSET_COMMANDS, ...DOCUMENT_ADJUSTMENT_COMMANDS, ...RMA_COMMANDS, ...CLIENT_QUERY_COMMANDS];

function seed(db: MemoryDb): void {
  db.seed(`workspaces/${WS}`, {
    uid: OWNER, name: 'Lifecycle Co', currency: 'USD',
    members: [OWNER, ACCOUNTANT, BOOKKEEPER, VIEWER],
    roles: { [OWNER]: 'owner', [ACCOUNTANT]: 'accountant', [BOOKKEEPER]: 'bookkeeper', [VIEWER]: 'viewer' },
  });
  db.seed(`workspaces/${OTHER}`, { uid: OUTSIDER, name: 'Other', currency: 'USD', members: [OUTSIDER] });
}

const createHarness = () => commandHarness({ commands: COMMANDS, workspaceId: WS, seed });

test('the seventeen commands publish a schema, roles, scope, a parseable example and refusals', () => {
  assert.equal(COMMANDS.length, 17);
  for (const command of COMMANDS) {
    assert.equal(command.scope ?? 'workspace', 'workspace', `${command.name} works on a workspace`);
    assert.equal(command.risk, 'normal', `${command.name} keeps the legacy route's session requirements`);
    assert.ok(command.roles.length > 0 && command.roles.every(role => COMMAND_ROLES.includes(role)), `${command.name} names real roles`);
    assert.equal(command.input.safeParse(command.describe.example).success, true, `${command.name} example parses`);
    assert.ok(command.describe.refusals.length >= 1, `${command.name} lists its refusals`);
    assert.ok(command.describe.sentence.length > 40, `${command.name} says what it is for and when not to use it`);
    // none of these writes declares a runner date: the service answers a closed period with its own
    // 409 and its own words, and the runner's dated check would answer 400 before the service ran
    assert.equal(command.dated, undefined, `${command.name} leaves the period lock to its service`);
    // the service writes its own audit line, so the runner adds no second one
    assert.equal(command.audit({ invoiceId: 'i' } as never, {} as never), null, `${command.name} audits nothing itself`);
  }
  assert.deepEqual(assetDisposeCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(assetTransferCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(assetPlaceInServiceCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(invoiceWriteOffCommand.roles, ['owner', 'accountant'], 'bad debt stays with owners and accountants');
  assert.deepEqual(rmaMoveCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(COMMANDS.map(command => command.name).sort(), [
    'asset.dispose', 'asset.placeservice', 'asset.transfer', 'asset.undispose', 'asset.undoplaceservice', 'asset.undotransfer',
    'bill.spread', 'bill.spreadundo', 'invoice.spread', 'invoice.spreadundo', 'invoice.writeoff', 'invoice.writeoffreverse',
    'query.ask', 'query.close', 'query.reply', 'rma.move', 'rma.request',
  ]);
});

test('the undos answer as inverses and the one-way moves answer null', () => {
  assert.deepEqual(
    assetDisposeCommand.inverse?.({ assetId: 'a1', date: '2026-06-30', proceedsCents: 100 }, { transactionId: 't1', gainLossCents: 0, catchUpCents: 0 }),
    { command: 'asset.undispose', input: { assetId: 'a1' } },
  );
  assert.deepEqual(
    assetTransferCommand.inverse?.({ assetId: 'a1', date: '2026-06-30', location: 'Depot' }, { transactionId: 't1' }),
    { command: 'asset.undotransfer', input: { assetId: 'a1' } },
  );
  assert.deepEqual(
    invoiceWriteOffCommand.inverse?.({ invoiceId: 'i1' }, { invoiceId: 'i1', transactionId: 't1', writtenOffCents: 100 }),
    { command: 'invoice.writeoffreverse', input: { invoiceId: 'i1' } },
  );
  assert.deepEqual(
    billSpreadCommand.inverse?.({ billId: 'b1', expenseAccountId: 'a', amountCents: 1, months: 2 }, { billId: 'b1' }),
    { command: 'bill.spreadundo', input: { billId: 'b1' } },
  );
  assert.equal(assetUndoDisposalCommand.inverse?.({ assetId: 'a1' }, {}), null);
  assert.equal(rmaMoveCommand.inverse?.({} as never, {} as never), null, 'a move on an RMA is walked back by another move, not an inverse');
  assert.deepEqual(
    rmaRequestCommand.inverse?.(
      {} as never,
      { record: { id: 'rma_1', customerId: 'c1' }, replayed: false },
    ),
    { command: 'rma.move', input: { rmaId: 'rma_1', customerId: 'c1', action: 'decline', expectedStatus: 'requested', requestKey: 'undo_rma_1' } },
  );
});

/**
 * An inverse is a promise to whoever reads it — an assistant, an undo screen — that running it works.
 * A shape-only assertion cannot keep that promise: `{ command: 'asset.undispose', input: {} }` deep-equals
 * cleanly and then fails as INVALID_INPUT when it is actually run, because the undo needs the asset id.
 * This walks every inverse the batch publishes and parses it against the target command's own schema.
 */
test('every inverse this batch publishes is accepted by the command it names', () => {
  const byName = new Map(COMMANDS.map(command => [command.name, command]));
  const sampleInputs: Record<string, unknown> = {
    'asset.dispose': { assetId: 'a1', date: '2026-06-30', proceedsCents: 100 },
    'asset.transfer': { assetId: 'a1', date: '2026-06-30', location: 'Depot' },
    'asset.placeservice': { assetId: 'a1', date: '2026-06-30', assetAccountId: 'equip' },
    'invoice.writeoff': { invoiceId: 'i1' },
    'bill.spread': { billId: 'b1', expenseAccountId: 'acc', amountCents: 100, months: 2 },
    'invoice.spread': { invoiceId: 'i1', revenueAccountId: 'rev', amountCents: 100, months: 2 },
    'rma.request': {},
  };
  const sampleResults: Record<string, unknown> = {
    'asset.dispose': { transactionId: 't1', gainLossCents: 0, catchUpCents: 0 },
    'asset.transfer': { transactionId: 't1' },
    'asset.placeservice': { assetId: 'a1' },
    'invoice.writeoff': { invoiceId: 'i1', transactionId: 't1', writtenOffCents: 100 },
    'bill.spread': { billId: 'b1' },
    'invoice.spread': { invoiceId: 'i1' },
    'rma.request': { record: { id: 'rma_1', customerId: 'c1' }, replayed: false },
  };
  let checked = 0;
  for (const command of COMMANDS) {
    if (!command.inverse || !(command.name in sampleInputs)) continue;
    const inverse = command.inverse(sampleInputs[command.name] as never, sampleResults[command.name] as never);
    if (!inverse) continue;
    const target = byName.get(inverse.command as `${string}.${string}`);
    assert.ok(target, `${command.name} names a command this batch registers: ${inverse.command}`);
    const parsed = target.input.safeParse(inverse.input);
    assert.equal(parsed.success, true, `${command.name} → ${inverse.command} parses: ${JSON.stringify(parsed.error?.issues)}`);
    checked += 1;
  }
  assert.equal(checked, 7, 'all seven undoable commands were walked');
});

test('a preview describes the work and writes nothing', async () => {
  const harness = await createHarness();
  try {
    const res = await harness.preview(BOOKKEEPER, 'asset.dispose', { assetId: 'a1', date: '2026-06-30', proceedsCents: 250_000, portionPercent: 40 });
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json() as { preview: { title: string; lines: string[] } };
    assert.match(body.preview.title, /40%/);
    assert.match(body.preview.lines.join(' '), /gain or loss/);
    const plain = await harness.preview(BOOKKEEPER, 'asset.dispose', { assetId: 'a1', date: '2026-06-30', proceedsCents: 0 });
    assert.equal((await plain.json() as { preview: { title: string } }).preview.title, 'Sell or scrap the asset');
    const spread = await harness.preview(BOOKKEEPER, 'bill.spread', { billId: 'b1', expenseAccountId: 'acc', amountCents: 1200, months: 12 });
    assert.match((await spread.json() as { preview: { title: string } }).preview.title, /Spread the bill/);
    assert.equal(harness.db.directWriteCount, 0, 'a preview touches no record');
    assert.equal(harness.counters.audits, 0);
  } finally {
    await harness.close();
  }
});

test('a malformed body is refused as INVALID_INPUT before any service runs', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const disposal = await harness.run(OWNER, 'asset.dispose', { assetId: 'van', date: '2026-06-30' });
  assert.equal(disposal.status, 400);
  assert.equal((await disposal.json() as Record<string, unknown>).code, 'INVALID_INPUT');
  const spread = await harness.run(BOOKKEEPER, 'bill.spread', { billId: 'b1', expenseAccountId: 'acc', amountCents: 100, months: 1 });
  assert.equal(spread.status, 400, 'one month is outside 2–60');
  const rma = await harness.run(BOOKKEEPER, 'rma.request', { customerId: 'c1', invoiceId: 'i1', reason: 'x', lines: [{ invoiceLineId: 'l1', quantity: 1 }], requestKey: 'short' });
  assert.equal(rma.status, 400, 'a request key shorter than eight characters is refused');
  assert.equal(harness.db.directWriteCount, 0);
});

test('the runner refuses a viewer and an outsider before any service runs', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const input = { assetId: 'van', date: '2026-06-30', proceedsCents: 1000, proceedsAccountId: 'bank', gainLossAccountId: 'gain' };
  const viewer = await harness.run(VIEWER, 'asset.dispose', input);
  assert.equal(viewer.status, 403, 'a viewer is refused by the registered role list');
  assert.equal((await viewer.json() as Record<string, unknown>).code, 'ROLE_REQUIRED');
  const accountantWriteOff = await harness.run(ACCOUNTANT, 'invoice.writeoff', { invoiceId: 'i1' });
  assert.equal(accountantWriteOff.status, 404, 'an accountant may attempt the write-off: the service answers the missing invoice');
  const bookkeeperWriteOff = await harness.run(BOOKKEEPER, 'invoice.writeoff', { invoiceId: 'i1' });
  assert.equal(bookkeeperWriteOff.status, 403, 'a bookkeeper may not write off bad debt');
  const outsider = await harness.run(OUTSIDER, 'asset.dispose', input, WS);
  assert.equal(outsider.status, 403, 'someone outside the workspace is refused');
  assert.equal(harness.counters.audits, 0, 'nothing was audited');
});

test('a record that is not in this workspace answers the status and words its service gave', async t => {
  const harness = await createHarness();
  t.after(harness.close);

  const inService = await harness.run(BOOKKEEPER, 'asset.placeservice', { assetId: 'van', date: '2026-06-30', assetAccountId: 'equip' });
  assert.equal(inService.status, 404);
  assert.match(String((await inService.json() as Record<string, unknown>).message), /not in this workspace/);

  const transfer = await harness.run(BOOKKEEPER, 'asset.transfer', { assetId: 'van', date: '2026-06-30', location: 'Depot 2' });
  assert.equal(transfer.status, 404, 'a missing asset is a 404, not a 500');
  const undo = await harness.run(BOOKKEEPER, 'asset.undotransfer', { assetId: 'van' });
  assert.equal(undo.status, 404);

  const writeOff = await harness.run(OWNER, 'invoice.writeoff', { invoiceId: 'inv1' });
  assert.equal(writeOff.status, 404, 'a missing invoice keeps its 404');
  assert.equal((await writeOff.json() as Record<string, unknown>).message, 'Invoice not found');

  const spread = await harness.run(BOOKKEEPER, 'bill.spread', { billId: 'b1', expenseAccountId: 'acc', amountCents: 100, months: 12 });
  assert.equal(spread.status, 404, 'a missing bill keeps its 404');
  assert.equal((await spread.json() as Record<string, unknown>).message, 'Bill not found');

  const revenue = await harness.run(BOOKKEEPER, 'invoice.spread', { invoiceId: 'inv9', revenueAccountId: 'rev', amountCents: 100_000, months: 12 });
  assert.equal(revenue.status, 404);
  assert.equal((await revenue.json() as Record<string, unknown>).message, 'Invoice not found');
});

test('a posted bill that is already spread, a draft bill and an unspread undo keep the service 409 sentences', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  harness.db.seed('bills/b1', {
    workspaceId: WS, vendorId: 'v1', vendorName: 'Insurer', number: 'B-1', amountCents: 120_000, status: 'open', date: '2026-09-15',
    prepaidSchedule: { id: 'ps_1', months: 12, transactionIds: [] },
  });
  harness.db.seed('bills/b2', { workspaceId: WS, vendorId: 'v1', number: 'B-2', amountCents: 120_000, status: 'draft', date: '2026-09-15' });
  harness.db.seed('bills/b3', { workspaceId: WS, vendorId: 'v1', number: 'B-3', amountCents: 120_000, status: 'open', date: '2026-09-15' });

  const already = await harness.run(BOOKKEEPER, 'bill.spread', { billId: 'b1', expenseAccountId: 'acc', amountCents: 100_000, months: 12 });
  assert.deepEqual([already.status, (await already.json() as Record<string, unknown>).message], [409, 'This bill is already spread over months']);

  const draft = await harness.run(BOOKKEEPER, 'bill.spread', { billId: 'b2', expenseAccountId: 'acc', amountCents: 100_000, months: 12 });
  assert.deepEqual([draft.status, (await draft.json() as Record<string, unknown>).message], [409, 'The bill is draft; only a posted bill can be spread']);

  const undo = await harness.run(BOOKKEEPER, 'bill.spreadundo', { billId: 'b3' });
  assert.deepEqual([undo.status, (await undo.json() as Record<string, unknown>).message], [409, 'This bill is not spread over months']);
});

test('a bad-debt write-off on a draft invoice is a 409 in the service’s words, and a viewer cannot reach it', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  harness.db.seed('invoices/inv1', { workspaceId: WS, customerId: 'c1', number: 'INV-1', status: 'draft', amountCents: 12_000, date: '2026-06-01' });
  harness.db.seed('chartAccounts/ar', { workspaceId: WS, name: 'Accounts Receivable', type: 'asset', category: 'Receivables' });
  const res = await harness.run(OWNER, 'invoice.writeoff', { invoiceId: 'inv1' });
  assert.equal(res.status, 409);
  assert.equal((await res.json() as Record<string, unknown>).message, 'The invoice is draft; only open invoices can be written off');
});

test('an RMA for a customer outside the workspace keeps the service 404 and its words', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const res = await harness.run(BOOKKEEPER, 'rma.request', {
    customerId: 'nobody', invoiceId: 'inv1', reason: 'Damaged', lines: [{ invoiceLineId: 'l1', quantity: 1 }], requestKey: 'rma-2026-06-30-1',
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json() as Record<string, unknown>).message, 'That customer is not in this workspace');
});

test('the registry resolves every name, and a body naming another workspace is refused', async () => {
  const harness = await createHarness();
  try {
    for (const command of COMMANDS) assert.equal(harness.registry.get(command.name), command, `${command.name} is registered`);
    const elsewhere = await harness.run(OWNER, 'asset.dispose', { workspaceId: OTHER, assetId: 'van', date: '2026-06-30', proceedsCents: 1 });
    assert.equal(elsewhere.status, 400, await elsewhere.clone().text());
    assert.match(String((await elsewhere.json() as Record<string, unknown>).message), /workspaceId must match/);
  } finally {
    await harness.close();
  }
});

test('a question, an answer and a close keep their envelopes: data.query for the first two, a bare success for the close', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  harness.db.seed('transactions/tx1', { workspaceId: WS, date: '2026-09-14', description: 'Amazon', totalAmountCents: 34_000, currency: 'USD' });

  const asked = await harness.run(BOOKKEEPER, 'query.ask', { transactionId: 'tx1', question: '  What was this 340 at Amazon?  ' });
  assert.equal(asked.status, 200, await asked.clone().text());
  const askedBody = await asked.json() as { data: { query: { id: string; status: string; askedBy: string; messages: Array<{ text: string }> } } };
  assert.ok('data' in askedBody && 'status' in askedBody, 'the question keeps `{ status, data: { query } }`');
  const query = askedBody.data.query;
  assert.deepEqual([query.status, query.askedBy, query.messages[0].text], ['open', BOOKKEEPER, 'What was this 340 at Amazon?']);

  const answered = await harness.run(OWNER, 'query.reply', { queryId: query.id, text: 'Office chairs' });
  assert.equal(answered.status, 200);
  assert.equal((await answered.json() as { data: { query: { status: string } } }).data.query.status, 'answered');

  // someone who neither asked it nor is an owner or an accountant is refused in the service's words
  const stranger = await harness.run(ACCOUNTANT, 'query.reply', { queryId: query.id, text: 'A second note' });
  assert.equal(stranger.status, 200, 'any member may add a message');
  const closed = await harness.run(BOOKKEEPER, 'query.close', { queryId: query.id });
  assert.equal(closed.status, 200);
  const closedBody = await closed.json() as Record<string, unknown>;
  assert.equal(closedBody.status, 'success', 'closing answers a success, as it did before');
  assert.deepEqual(closedBody.data, {}, 'and says nothing else about the question');
});

test('a viewer may not ask, and a malformed question is refused before the service', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  harness.db.seed('transactions/tx1', { workspaceId: WS, date: '2026-09-14', description: 'Amazon', totalAmountCents: 34_000, currency: 'USD' });
  const viewer = await harness.run(VIEWER, 'query.ask', { transactionId: 'tx1', question: 'What was this?' });
  assert.equal(viewer.status, 403, 'the service answers the viewer, with its own words');
  assert.match(String((await viewer.json() as Record<string, unknown>).message), /Viewers answer questions/);
  const short = await harness.run(BOOKKEEPER, 'query.ask', { transactionId: 'tx1', question: ' ' });
  assert.equal(short.status, 400);
  assert.equal((await harness.run(BOOKKEEPER, 'query.ask', { transactionId: 'nope', question: 'What was this?' })).status, 404);
  assert.equal((await harness.run(BOOKKEEPER, 'query.reply', { queryId: 'cq_nope', text: 'hi' })).status, 404);
});

test('asking and closing preview without writing', async () => {
  const harness = await createHarness();
  try {
    const ask = await harness.preview(BOOKKEEPER, 'query.ask', { transactionId: 'tx1', question: 'What was this?' });
    assert.match((await ask.json() as { preview: { title: string } }).preview.title, /Ask about the entry/);
    const close = await harness.preview(BOOKKEEPER, 'query.close', { queryId: 'cq_1' });
    assert.match((await close.json() as { preview: { title: string } }).preview.title, /Close the question/);
    assert.equal(harness.db.directWriteCount, 0);
  } finally {
    await harness.close();
  }
});

test('a viewer is in the query role list so the service, not the runner, decides who asks', () => {
  assert.deepEqual(queryAskCommand.roles, ['owner', 'accountant', 'bookkeeper', 'viewer']);
  assert.deepEqual(queryCloseCommand.roles, ['owner', 'accountant', 'bookkeeper', 'viewer']);
});
