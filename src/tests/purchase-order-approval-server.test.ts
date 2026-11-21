/**
 * #921 (purchase-order half): `record.save` holds and decides purchase orders the way the screen's rule does
 * (K-23, A-120), so a bookkeeper or an API caller cannot commit an order that needs approval.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestUser } from '../server/auth/requestUser';
import { executeCommand } from '../server/utils/commandExecutor';
import { recordSaveCommand, recordSaveInput } from '../server/commands/plainRecords';
import { purchaseOrderTotalCents } from '../server/commands/purchaseOrderApprovalGuard';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const accountant: RequestUser = { uid: 'acc-1', email: 'acc@example.test', aal: 'aal2' };
const bookkeeper: RequestUser = { uid: 'book-1', email: 'book@example.test', aal: 'aal2' };
const members = { members: [owner.uid, accountant.uid, bookkeeper.uid], roles: { [accountant.uid]: 'accountant', [bookkeeper.uid]: 'bookkeeper' } };
const lines = (cents: number) => [{ id: 'l1', description: 'Paper', quantity: 1, unitPriceCents: cents, totalCents: cents, receivedQuantity: 0 }];
const order = (cents: number, status: string) => ({ poNumber: 'PO-9', vendorId: 'v1', vendorName: 'Paper Co', status, items: lines(cents), totalAmountCents: cents, currency: 'USD' });

function db(fields: Record<string, unknown> = {}): MemoryDb {
  const d = new MemoryDb();
  seedWorkspace(d, workspaceId, { ...members, ...fields });
  return d;
}
async function save(d: MemoryDb, input: unknown, user: RequestUser) {
  const parsed = recordSaveInput.parse(input);
  return executeCommand(fakeRequest(user, { workspaceId, input: parsed }), captureResponse().response,
    { definition: recordSaveCommand, workspaceId, input: parsed }, runnerDependencies(d, { runs: 0, previews: 0, afterCommit: 0, audits: 0 }));
}
const create = (d: MemoryDb, id: string, data: Record<string, unknown>, user: RequestUser) => save(d, { collection: 'purchaseOrders', id, create: true, data }, user);
const update = (d: MemoryDb, id: string, data: Record<string, unknown>, user: RequestUser) => save(d, { collection: 'purchaseOrders', id, data }, user);

test('K-23 (no limit set): a bookkeeper\'s order saved as approved is held; the accountant approves it, stamped by the server', async () => {
  const d = db();
  assert.equal((await create(d, 'po-a', { ...order(10_000, 'approved'), approvedBy: 'owner-1' }, bookkeeper)).ok, true);
  const held = d.read('purchaseOrders/po-a')!;
  assert.equal(held.status, 'pending_approval');
  assert.equal(held.approvedBy, null, 'a forged approver is not kept');
  assert.equal((await update(d, 'po-a', { status: 'approved' }, bookkeeper)).ok, false, 'the bookkeeper cannot approve it');
  assert.equal((await update(d, 'po-a', { status: 'approved', approvedBy: 'someone-else' }, accountant)).ok, true);
  const approved = d.read('purchaseOrders/po-a')!;
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approvedBy, accountant.uid);
  assert.equal(approved.approvalStatus, 'approved');
});

test('an accountant does not approve their own request; the owner may', async () => {
  const d = db({ invoiceApproval: { poEnabled: true, poThresholdCents: 50_000 } });
  await create(d, 'po-b', order(90_000, 'approved'), accountant);
  assert.equal(d.read('purchaseOrders/po-b')?.status, 'pending_approval');
  assert.equal((await update(d, 'po-b', { status: 'approved' }, accountant)).ok, false);
  assert.equal((await update(d, 'po-b', { status: 'approved' }, owner)).ok, true);
});

test('A-120 limit: under it nothing waits; over it waits; receiving goods on a held order is refused', async () => {
  const d = db({ invoiceApproval: { poEnabled: true, poThresholdCents: 50_000 } });
  await create(d, 'po-c', order(40_000, 'approved'), bookkeeper);
  assert.equal(d.read('purchaseOrders/po-c')?.status, 'approved');
  assert.equal((await create(d, 'po-d', order(90_000, 'received'), bookkeeper)).ok, false);
  assert.equal(d.read('purchaseOrders/po-d'), undefined);
});

test('raising an approved order over the limit sends it back; approving a request raised on the way is refused', async () => {
  const d = db({ invoiceApproval: { poEnabled: true, poThresholdCents: 50_000 } });
  await create(d, 'po-e', order(40_000, 'approved'), bookkeeper);
  await update(d, 'po-e', { items: lines(90_000), totalAmountCents: 90_000 }, bookkeeper);
  assert.equal(d.read('purchaseOrders/po-e')?.status, 'pending_approval');
  assert.equal((await update(d, 'po-e', { status: 'approved', items: lines(120_000), totalAmountCents: 120_000 }, accountant)).ok, false);
});

test('a request is declined by an approver or withdrawn by the person who asked; not by another bookkeeper', async () => {
  const d = db();
  d.seed('purchaseOrders/po-f', { id: 'po-f', workspaceId, uid: 'other-book', ...order(10_000, 'pending_approval') });
  assert.equal((await update(d, 'po-f', { status: 'cancelled' }, bookkeeper)).ok, false);
  assert.equal((await update(d, 'po-f', { status: 'cancelled' }, accountant)).ok, true);
  assert.equal(d.read('purchaseOrders/po-f')?.approvalStatus, 'rejected');
});

test('an understated total does not slip under the limit', () => {
  assert.equal(purchaseOrderTotalCents({ totalAmountCents: 1, items: lines(90_000) }), 90_000);
  // a small stated line total does not hide quantity × unit price (what the bill is built from)
  assert.equal(purchaseOrderTotalCents({ totalAmountCents: 10_000, items: [{ quantity: 1, unitPriceCents: 90_000, totalCents: 10_000 }] }), 90_000);
});

test('a raise that also moves the order into receiving is refused (#980 review)', async () => {
  const d = db({ invoiceApproval: { poEnabled: true, poThresholdCents: 50_000 } });
  await create(d, 'po-g', order(40_000, 'approved'), bookkeeper);
  assert.equal((await update(d, 'po-g', { status: 'partially_received', items: lines(9_000_000), totalAmountCents: 9_000_000 }, bookkeeper)).ok, false);
  assert.equal(d.read('purchaseOrders/po-g')?.totalAmountCents, 40_000);
});

test('whoever raised an order into review cannot approve it, even if someone else made the order (#980 review)', async () => {
  const d = db({ invoiceApproval: { poEnabled: true, poThresholdCents: 50_000 } });
  await create(d, 'po-h', order(40_000, 'approved'), bookkeeper);
  await update(d, 'po-h', { items: lines(90_000), totalAmountCents: 90_000 }, accountant);
  const held = d.read('purchaseOrders/po-h')!;
  assert.equal(held.status, 'pending_approval');
  assert.equal(held.requestedBy, accountant.uid);
  assert.equal((await update(d, 'po-h', { status: 'approved' }, accountant)).ok, false);
  assert.equal((await update(d, 'po-h', { status: 'approved', requestedBy: 'someone' }, owner)).ok, true);
});
