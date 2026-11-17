/**
 * `estimate.save` / `estimate.status` and `chartaccount.update` — the quote's stages and an account's own fields.
 *
 * The quote wrote its terms with `addDoc`, moved through four stages with `updateDoc` and rewrote its milestone
 * schedule from two more places; the chart renamed, regrouped, archived and gave workpapers to accounts. These tests
 * hold the two families to the promises those writes made only in the screen: a converted quote cannot go back, an
 * accepted order's terms are the customer's, a system account keeps its code, and a group cannot be impossible.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { estimateSaveCommand, estimateSaveInput, estimateStatusCommand, estimateStatusInput } from '../server/commands/estimates';
import { chartAccountCreateCommand, chartAccountCreateInput, chartAccountUpdateCommand, chartAccountUpdateInput } from '../server/commands/chartAccounts';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const runEstimateSave = (input: unknown, db: MemoryDb) =>
  executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: estimateSaveCommand, workspaceId, input }, runnerDependencies(db));
const runEstimateStatus = (input: unknown, db: MemoryDb) =>
  executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: estimateStatusCommand, workspaceId, input }, runnerDependencies(db));
const runAccountCreate = (input: unknown, db: MemoryDb, user = owner) =>
  executeCommand(fakeRequest(user, { workspaceId, input }), captureResponse().response,
    { definition: chartAccountCreateCommand, workspaceId, input }, runnerDependencies(db));
const runAccount = (input: unknown, db: MemoryDb, user = owner) =>
  executeCommand(fakeRequest(user, { workspaceId, input }), captureResponse().response,
    { definition: chartAccountUpdateCommand, workspaceId, input }, runnerDependencies(db));

const quote = {
  number: 'EST-1042', customerId: 'cust_1', customerName: 'Acme', date: '2026-11-16', expiryDate: '2026-12-16',
  amountCents: 250000, currency: 'USD', description: 'Three chairs',
} as const;

test('a quote is written with the number its series gave it, as a draft', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const outcome = await runEstimateSave(estimateSaveInput.parse(quote), db);
  assert.equal(outcome.ok, true);
  const saved = (outcome as unknown as { data: { id: string; status: string } }).data;
  assert.equal(saved.status, 'draft');
  const row = db.read(`estimates/${saved.id}`)!;
  assert.equal(row.number, 'EST-1042');
  assert.equal(row.workspaceId, workspaceId);
  assert.equal(row.customerName, 'Acme');
});

test('a new quote without a number or its terms is refused, with what is missing', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const outcome = await runEstimateSave(estimateSaveInput.parse({ customerName: 'Acme' }), db);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as unknown as { code?: string }).code, 'INVALID_INPUT');
  assert.match((outcome as unknown as { message: string }).message, /number/);
  assert.equal(db.entries('estimates').length, 0);
});

test('the milestone schedule is written on the quote, and its shape is the command\'s rule', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('estimates/est_1', { id: 'est_1', workspaceId, status: 'sent', number: 'EST-1', customerName: 'Acme' });
  const milestones = [{ id: 'm1', label: 'On signing', percent: 30 }, { id: 'm2', label: 'On delivery', percent: 70, due: '2026-12-01' }];
  const outcome = await runEstimateSave(estimateSaveInput.parse({ id: 'est_1', milestones }), db);
  assert.equal(outcome.ok, true);
  assert.deepEqual(db.read('estimates/est_1')!.milestones, milestones);
  assert.equal(estimateSaveInput.safeParse({ id: 'est_1', milestones: [{ id: 'm', label: 'Half', percent: 60 }, { id: 'n', label: 'Rest', percent: 60 }] }).success, true, 'the sum is the screen\'s rule; the shape is the command\'s');
});

test('an accepted order cannot have its lines and total rewritten', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('estimates/est_1', { id: 'est_1', workspaceId, status: 'accepted', number: 'EST-1' });
  const refused = await runEstimateSave(estimateSaveInput.parse({ id: 'est_1', amountCents: 1 }), db);
  assert.equal(refused.ok, false);
  assert.equal((refused as unknown as { code?: string }).code, 'CONFLICT');
  assert.equal(db.read('estimates/est_1')!.amountCents, undefined);
  // the milestone schedule is still the order's own, so it may be edited
  const allowed = await runEstimateSave(estimateSaveInput.parse({ id: 'est_1', milestones: [{ id: 'm1', label: 'On signing', percent: 100 }] }), db);
  assert.equal(allowed.ok, true);
});

test('accept, decline and convert move the stage, and a converted quote stays converted', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('estimates/est_1', { id: 'est_1', workspaceId, status: 'sent', number: 'EST-1' });
  const accepted = await runEstimateStatus(estimateStatusInput.parse({ id: 'est_1', status: 'accepted', customerReference: 'PO-7' }), db);
  assert.equal(accepted.ok, true);
  const afterAccept = db.read('estimates/est_1')!;
  assert.equal(afterAccept.status, 'accepted');
  assert.equal(afterAccept.customerReference, 'PO-7');
  assert.equal(afterAccept.orderedBy, owner.uid);
  assert.equal(typeof afterAccept.orderedAt, 'string');

  const declined = await runEstimateStatus(estimateStatusInput.parse({ id: 'est_1', status: 'declined' }), db);
  assert.equal(declined.ok, true);

  const noInvoice = await runEstimateStatus(estimateStatusInput.parse({ id: 'est_1', status: 'converted' }), db);
  assert.equal(noInvoice.ok, false, 'a conversion names the invoice that took it over');
  assert.equal((noInvoice as unknown as { code?: string }).code, 'INVALID_INPUT');

  const converted = await runEstimateStatus(estimateStatusInput.parse({ id: 'est_1', status: 'converted', convertedInvoiceId: 'inv_9' }), db);
  assert.equal(converted.ok, true);
  assert.equal(db.read('estimates/est_1')!.convertedInvoiceId, 'inv_9');

  const back = await runEstimateStatus(estimateStatusInput.parse({ id: 'est_1', status: 'accepted' }), db);
  assert.equal(back.ok, false);
  assert.equal((back as unknown as { code?: string }).code, 'CONFLICT');
  assert.equal(db.read('estimates/est_1')!.status, 'converted');
});

test('an account keeps its code when it is a system account, and changes it when it is not', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('chartAccounts/acct_ar', { id: 'acct_ar', workspaceId, name: 'Accounts Receivable', code: '1100', type: 'asset', isSystem: true });
  db.seed('chartAccounts/acct_rent', { id: 'acct_rent', workspaceId, name: 'Rent', code: '6100', type: 'expense' });
  const refused = await runAccount(chartAccountUpdateInput.parse({ id: 'acct_ar', code: '1200' }), db);
  assert.equal(refused.ok, false);
  assert.equal((refused as unknown as { code?: string }).code, 'CONFLICT');
  assert.equal(db.read('chartAccounts/acct_ar')!.code, '1100');
  const renamed = await runAccount(chartAccountUpdateInput.parse({ id: 'acct_ar', name: 'Receivables' }), db);
  assert.equal(renamed.ok, true, 'the name is still the owner\'s');
  const recoded = await runAccount(chartAccountUpdateInput.parse({ id: 'acct_rent', code: '6200' }), db);
  assert.equal(recoded.ok, true);
  assert.equal(db.read('chartAccounts/acct_rent')!.code, '6200');
});

test('a group cannot be another type, a loop, or too deep, and archiving moves both flags', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('chartAccounts/grp_a', { id: 'grp_a', workspaceId, name: 'A', type: 'expense', code: '6000' });
  db.seed('chartAccounts/grp_b', { id: 'grp_b', workspaceId, name: 'B', type: 'expense', code: '6001', parentId: 'grp_a' });
  db.seed('chartAccounts/asset_1', { id: 'asset_1', workspaceId, name: 'Cash', type: 'asset', code: '1000' });

  const wrongType = await runAccount(chartAccountUpdateInput.parse({ id: 'asset_1', parentId: 'grp_a' }), db);
  assert.equal(wrongType.ok, false);
  assert.equal((wrongType as unknown as { code?: string }).code, 'CONFLICT');

  const loop = await runAccount(chartAccountUpdateInput.parse({ id: 'grp_a', parentId: 'grp_b' }), db);
  assert.equal(loop.ok, false);
  assert.match((loop as unknown as { message: string }).message, /already inside/);

  const grouped = await runAccount(chartAccountUpdateInput.parse({ id: 'grp_b', parentId: null }), db);
  assert.equal(grouped.ok, true, 'taking it back to the top level is always allowed');
  assert.equal(db.read('chartAccounts/grp_b')!.parentId, null);

  const archived = await runAccount(chartAccountUpdateInput.parse({ id: 'asset_1', archived: true }), db);
  assert.equal(archived.ok, true);
  assert.equal(db.read('chartAccounts/asset_1')!.isArchived, true);
  assert.equal(db.read('chartAccounts/asset_1')!.isActive, false, 'the two halves of the flag agree');
  await runAccount(chartAccountUpdateInput.parse({ id: 'asset_1', archived: false }), db);
  assert.equal(db.read('chartAccounts/asset_1')!.isArchived, false);
  assert.equal(db.read('chartAccounts/asset_1')!.isActive, true);
});

test('workpapers are merged per month and a balance cannot be written through the chart', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('chartAccounts/acct_rent', { id: 'acct_rent', workspaceId, name: 'Rent', type: 'expense', workpapers: { '2026-01': { note: 'kept' } } });
  const outcome = await runAccount(chartAccountUpdateInput.parse({ id: 'acct_rent', workpapers: { '2026-02': { note: 'new' } } }), db);
  assert.equal(outcome.ok, true);
  assert.deepEqual(db.read('chartAccounts/acct_rent')!.workpapers, { '2026-01': { note: 'kept' }, '2026-02': { note: 'new' } });
  assert.equal(chartAccountUpdateInput.safeParse({ id: 'acct_rent', balanceCents: 5 }).success, false);
  assert.equal(chartAccountUpdateInput.safeParse({ id: 'acct_rent', openingBalanceCents: 5 }).success, false);
  assert.equal(chartAccountUpdateInput.safeParse({ id: 'acct_rent', isSystem: true }).success, false);
  assert.equal(chartAccountUpdateInput.safeParse({ id: 'acct_rent', workpapers: { '2026-1': {} } }).success, false, 'a month is YYYY-MM');
});

test('a bookkeeper may write quotes but not the chart', async () => {
  const db = new MemoryDb();
  seedWorkspace(db, workspaceId, { uid: 'someone-else', roles: { [owner.uid]: 'bookkeeper' } });
  db.seed('chartAccounts/acct_rent', { id: 'acct_rent', workspaceId, name: 'Rent', type: 'expense' });
  const chart = await runAccount(chartAccountUpdateInput.parse({ id: 'acct_rent', name: 'Rent (office)' }), db);
  assert.equal(chart.ok, false);
  assert.equal((chart as unknown as { code?: string }).code, 'ROLE_REQUIRED');
  const wrote = await runEstimateSave(estimateSaveInput.parse(quote), db);
  assert.equal(wrote.ok, true, 'a bookkeeper keeps the quotes');
});

test('a new account opens at zero, in the workspace it was added to, and its code must be free', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const created = await runAccountCreate(chartAccountCreateInput.parse({ code: '1010', name: 'Checking', type: 'asset', category: 'Assets' }), db);
  assert.equal(created.ok, true);
  const id = (created as unknown as { data: { id: string } }).data.id;
  const row = db.read(`chartAccounts/${id}`)!;
  assert.equal(row.code, '1010');
  assert.equal(row.workspaceId, workspaceId, 'the workspace comes from the request');
  assert.equal(row.balanceCents, 0, 'an account starts empty: its balance comes from the entries that name it');
  assert.equal(row.openingBalanceCents, 0);
  assert.equal(row.createdAt, row.updatedAt);

  // a second tab adding the same code is refused, not merged into the first account by every report that groups by code
  const clash = await runAccountCreate(chartAccountCreateInput.parse({ code: '1010', name: 'Cash at bank', type: 'asset' }), db);
  assert.equal(clash.ok, false);
  assert.equal((clash as unknown as { code: string }).code, 'CONFLICT');
  assert.match(String((clash as unknown as { message: string }).message), /1010/);
  assert.equal(db.entries('chartAccounts').length, 1);
});

test('a balance cannot be sent with a new account, and the five types are the only ones', () => {
  assert.equal(chartAccountCreateInput.safeParse({ code: '1010', name: 'Checking', type: 'asset', balanceCents: 500 }).success, false);
  assert.equal(chartAccountCreateInput.safeParse({ code: '1010', name: 'Checking', type: 'cash' }).success, false);
  assert.equal(chartAccountCreateInput.safeParse({ name: 'Checking', type: 'asset' }).success, false, 'a code is what a report groups by');
});

test('a group that would be impossible is refused when the account is added', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('chartAccounts/parent', { id: 'parent', workspaceId, code: '1000', name: 'Current assets', type: 'asset' });
  const wrongType = await runAccountCreate(chartAccountCreateInput.parse({ code: '1010', name: 'Checking', type: 'expense', parentId: 'parent' }), db);
  assert.equal(wrongType.ok, false);
  assert.equal((wrongType as unknown as { code: string }).code, 'CONFLICT');
});

test('a bookkeeper cannot add an account to the chart', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const bookkeeper = { ...owner, uid: 'keeper-1', email: 'keeper@example.test' };
  db.seed(`workspaces/${workspaceId}`, { uid: owner.uid, members: [owner.uid, bookkeeper.uid], roles: { [bookkeeper.uid]: 'bookkeeper' }, currency: 'USD' });
  const result = await runAccountCreate(chartAccountCreateInput.parse({ code: '1010', name: 'Checking', type: 'asset' }), db, bookkeeper);
  assert.equal(result.ok, false);
  assert.equal((result as unknown as { code: string }).code, 'ROLE_REQUIRED');
  assert.deepEqual(db.entries('chartAccounts'), []);
});

test('a save cannot move a quote’s stage: accepting, declining and converting are the stage command’s own', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const created = await runEstimateSave(estimateSaveInput.parse(quote), db);
  const id = (created as unknown as { data: { id: string } }).data.id;
  db.seed(`estimates/${id}`, { ...db.read(`estimates/${id}`)!, status: 'accepted' });

  const sneaky = await runEstimateSave(estimateSaveInput.parse({ id, status: 'draft' }), db);
  assert.equal(sneaky.ok, false);
  assert.equal((sneaky as unknown as { code: string }).code, 'CONFLICT');
  assert.equal(db.read(`estimates/${id}`)!.status, 'accepted', 'the stage is where it was');

  // saving the terms while naming the stage it already has is allowed: the screen sends the row it read
  const sameStage = await runEstimateSave(estimateSaveInput.parse({ id, status: 'accepted', description: 'Three chairs, delivered' }), db);
  assert.equal(sameStage.ok, true);
  assert.equal(db.read(`estimates/${id}`)!.description, 'Three chairs, delivered');
});

test('a quote cannot be born accepted or converted: it starts as a draft, or sent if it goes out at once', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);

  const accepted = await runEstimateSave(estimateSaveInput.parse({ ...quote, status: 'accepted' }), db);
  assert.equal(accepted.ok, false);
  assert.equal((accepted as unknown as { code: string }).code, 'CONFLICT');
  assert.deepEqual(db.entries('estimates'), [], 'no order is opened with a status and no acceptance behind it');

  const converted = await runEstimateSave(estimateSaveInput.parse({ ...quote, status: 'converted' }), db);
  assert.equal((converted as unknown as { code: string }).code, 'CONFLICT');

  const sent = await runEstimateSave(estimateSaveInput.parse({ ...quote, status: 'sent' }), db);
  assert.equal(sent.ok, true, 'a quote issued straight away is still a quote');
  assert.equal((sent as unknown as { data: { status: string } }).data.status, 'sent');
});
