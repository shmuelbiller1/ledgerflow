/**
 * `loan.payment` and `asset.costaddition` — the two records beside the entry.
 *
 * `LoansView` appended a paid instalment to the loan with an `updateDoc` from the tab, and `ConstructionActions`
 * replaced an asset's `costAdditions` list together with its `purchasePriceCents`. Both are lists the screen reads
 * back, and both were read-modify-written in the browser: two tabs keeping only the last one's list, no workspace
 * check on the id, nothing audited, and — for the asset — a basis that could describe a list it no longer had.
 *
 * These tests hold the commands to what replaces them: one instalment recorded once, one cost appended to the list
 * the transaction read, and the totals derived from that read rather than from the payload.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { loanPaymentCommand, loanPaymentInput } from '../server/commands/loans';
import { assetCostAdditionCommand, assetCostAdditionInput } from '../server/commands/assets';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const runLoan = (input: unknown, db: MemoryDb) =>
  executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: loanPaymentCommand, workspaceId, input: loanPaymentInput.parse(input) }, runnerDependencies(db));
const runAsset = (input: unknown, db: MemoryDb) =>
  executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: assetCostAdditionCommand, workspaceId, input: assetCostAdditionInput.parse(input) }, runnerDependencies(db));

const seedLoan = (db: MemoryDb, payments: Array<Record<string, unknown>> = []) => {
  seedWorkspace(db);
  db.seed('loans/loan_1', { id: 'loan_1', workspaceId, lender: 'Bank', principalCents: 1200000, termMonths: 12, payments });
};

const seedAsset = (db: MemoryDb, purchasePriceCents = 500000, costAdditions: Array<Record<string, unknown>> = []) => {
  seedWorkspace(db);
  db.seed('assets/asset_1', { id: 'asset_1', workspaceId, name: 'Van', purchasePriceCents, costAdditions });
};

test('an instalment is appended to the loan the server reads, and the list keeps what was there', async () => {
  const db = new MemoryDb();
  seedLoan(db, [{ installment: 1, date: '2026-10-01' }]);
  const result = await runLoan({ loanId: 'loan_1', installment: 2, date: '2026-11-01', transactionId: 'tx_9' }, db);
  assert.equal(result.ok, true);
  assert.deepEqual(db.read('loans/loan_1')!.payments, [
    { installment: 1, date: '2026-10-01' },
    { installment: 2, date: '2026-11-01', transactionId: 'tx_9' },
  ]);
});

test('recording the same instalment twice is refused, so a retried save does not hide a paid line', async () => {
  const db = new MemoryDb();
  seedLoan(db, [{ installment: 2, date: '2026-11-01' }]);
  const again = await runLoan({ loanId: 'loan_1', installment: 2, date: '2026-11-02' }, db);
  assert.equal(again.ok, false);
  assert.equal((again as unknown as { code: string }).code, 'CONFLICT');
  assert.equal((db.read('loans/loan_1')!.payments as unknown[]).length, 1);
});

test('a loan in another workspace is not found, and its list is untouched', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('loans/loan_other', { id: 'loan_other', workspaceId: 'ws-other', payments: [] });
  const result = await runLoan({ loanId: 'loan_other', installment: 1, date: '2026-11-01' }, db);
  assert.equal(result.ok, false);
  assert.equal((result as unknown as { code: string }).code, 'NOT_FOUND');
  assert.deepEqual(db.read('loans/loan_other')!.payments, []);
});

test('a capitalised cost is appended and the basis is derived from the list that was read', async () => {
  const db = new MemoryDb();
  seedAsset(db, 500000, [{ date: '2026-01-05', amountCents: 100000 }]);
  const result = await runAsset({ assetId: 'asset_1', date: '2026-11-16', amountCents: 25000, note: 'Shelving' }, db);
  assert.equal(result.ok, true);
  assert.equal((result as unknown as { data: { purchasePriceCents: number } }).data.purchasePriceCents, 525000);
  const row = db.read('assets/asset_1')!;
  assert.equal(row.purchasePriceCents, 525000, 'the basis the row already carried plus the one new cost');
  assert.deepEqual(row.costAdditions, [
    { date: '2026-01-05', amountCents: 100000 },
    { date: '2026-11-16', amountCents: 25000, note: 'Shelving' },
  ]);
});

test('a cost of zero or a date that is not a day is not input the screen could have produced', () => {
  assert.equal(assetCostAdditionInput.safeParse({ assetId: 'asset_1', date: '2026-11-16', amountCents: 0 }).success, false);
  assert.equal(assetCostAdditionInput.safeParse({ assetId: 'asset_1', date: '16/11/2026', amountCents: 100 }).success, false);
  assert.equal(assetCostAdditionInput.safeParse({ assetId: 'asset_1', date: '2026-11-16', amountCents: 100, purchasePriceCents: 1 }).success, false,
    'the basis is derived, never sent');
  assert.equal(loanPaymentInput.safeParse({ loanId: 'loan_1', installment: 0, date: '2026-11-01' }).success, false);
});

test('an asset in another workspace is refused, and a viewer may do neither', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('assets/asset_other', { id: 'asset_other', workspaceId: 'ws-other', purchasePriceCents: 100, costAdditions: [] });
  const missing = await runAsset({ assetId: 'asset_other', date: '2026-11-16', amountCents: 500 }, db);
  assert.equal(missing.ok, false);
  assert.equal((missing as unknown as { code: string }).code, 'NOT_FOUND');

  const viewer = { ...owner, uid: 'viewer-2', email: 'viewer@example.test' };
  db.seed('assets/asset_1', { id: 'asset_1', workspaceId, name: 'Van', purchasePriceCents: 500000, costAdditions: [] });
  db.seed(`workspaces/${workspaceId}`, { uid: owner.uid, members: [owner.uid, viewer.uid], roles: { [viewer.uid]: 'viewer' }, currency: 'USD' });
  const refused = await executeCommand(fakeRequest(viewer, { workspaceId, input: assetCostAdditionInput.parse({ assetId: 'asset_1', date: '2026-11-16', amountCents: 500 }) }),
    captureResponse().response,
    { definition: assetCostAdditionCommand, workspaceId, input: assetCostAdditionInput.parse({ assetId: 'asset_1', date: '2026-11-16', amountCents: 500 }) },
    runnerDependencies(db));
  assert.equal(refused.ok, false);
  assert.equal((refused as unknown as { code: string }).code, 'ROLE_REQUIRED');
  assert.equal(db.read('assets/asset_1')!.purchasePriceCents, 500000);
});

test('both writes are audited against the record they changed', () => {
  const loan = loanPaymentCommand.audit({ loanId: 'loan_1', installment: 2, date: '2026-11-01' }, { loanId: 'loan_1', installment: 2, payments: 2, created: true })!;
  assert.equal(loan.action, 'LOAN_PAYMENT_RECORDED');
  assert.equal(loan.entityId, 'loan_1');
  const asset = assetCostAdditionCommand.audit({ assetId: 'asset_1', date: '2026-11-16', amountCents: 25000 }, { assetId: 'asset_1', purchasePriceCents: 525000, additions: 2 })!;
  assert.equal(asset.action, 'ASSET_COST_CAPITALISED');
  assert.deepEqual(asset.details, { purchasePriceCents: 525000, additions: 2 });
});
