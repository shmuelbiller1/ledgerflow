/**
 * CC-11: customer groups. The list rules, a group's default terms on a new invoice, and (with
 * LF_TEST_DATABASE_URL) the server keeping the list one change at a time.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Firestore } from '../server/db/pgFirestore';
import { findCustomerGroup, normalizeCustomerGroups } from '../lib/customerGroups';
import { termsForCustomer } from '../lib/paymentTerms';
import { applyCustomerGroupChange } from '../server/services/customerGroupService';

test('CC-11: groups keep a valid id, a name and valid terms, once each', () => {
  const list = normalizeCustomerGroups([
    { id: 'cg_a', name: '  Wholesale ', paymentTerms: 'net_45' },
    { id: 'cg_a', name: 'Again' },
    { id: 'cg_b', name: 'WHOLESALE' },
    { id: 'cg_c', name: 'Retail', paymentTerms: 'custom' },
    { id: 'BAD', name: 'X' },
    null,
  ]);
  assert.deepEqual(list, [{ id: 'cg_a', name: 'Wholesale', paymentTerms: 'net_45' }, { id: 'cg_c', name: 'Retail' }]);
  assert.equal(findCustomerGroup(list, 'cg_c')?.name, 'Retail');
  assert.equal(findCustomerGroup(list, ''), undefined);
});

test('CC-11: a new invoice takes the customer\'s own terms, else its group\'s, else its last invoice\'s', () => {
  const groups = [{ id: 'cg_w', name: 'Wholesale', paymentTerms: 'net_45' }];
  const past = [{ customerId: 'c1', paymentTerms: 'net_15', date: '2026-10-01' }];
  assert.equal(termsForCustomer({ id: 'c1', paymentTerms: 'net_30', groupId: 'cg_w' }, past, groups), 'net_30');
  assert.equal(termsForCustomer({ id: 'c1', groupId: 'cg_w' }, past, groups), 'net_45');
  assert.equal(termsForCustomer({ id: 'c1', groupId: 'cg_gone' }, past, groups), 'net_15', 'a removed group falls back');
  assert.equal(termsForCustomer({ id: 'c1' }, past, groups), 'net_15');
});

test('CC-11: one change at a time against the current list', () => {
  let n = 0;
  const id = () => `cg_${++n}`;
  let { groups } = applyCustomerGroupChange([], { op: 'add', name: 'Wholesale', paymentTerms: 'net_45' }, id);
  ({ groups } = applyCustomerGroupChange(groups, { op: 'add', name: 'Retail' }, id));
  assert.deepEqual(groups, [{ id: 'cg_1', name: 'Wholesale', paymentTerms: 'net_45' }, { id: 'cg_2', name: 'Retail' }]);
  assert.throws(() => applyCustomerGroupChange(groups, { op: 'add', name: ' retail ' }, id), /already a customer group/);
  assert.throws(() => applyCustomerGroupChange(groups, { op: 'add', name: 'X', paymentTerms: 'net_0' }, id), /Net 1–365/);
  ({ groups } = applyCustomerGroupChange(groups, { op: 'setTerms', id: 'cg_2', paymentTerms: 'due_on_receipt' }, id));
  assert.equal(groups[1].paymentTerms, 'due_on_receipt');
  ({ groups } = applyCustomerGroupChange(groups, { op: 'setTerms', id: 'cg_1', paymentTerms: '' }, id));
  assert.deepEqual(groups[0], { id: 'cg_1', name: 'Wholesale' }, 'terms cleared');
  assert.throws(() => applyCustomerGroupChange(groups, { op: 'rename', id: 'cg_1', name: 'RETAIL' }, id), /already a customer group/);
  ({ groups } = applyCustomerGroupChange(groups, { op: 'rename', id: 'cg_1', name: 'Trade  accounts' }, id));
  assert.equal(groups[0].name, 'Trade  accounts', 'kept as typed');
  ({ groups } = applyCustomerGroupChange(groups, { op: 'remove', id: 'cg_2' }, id));
  assert.throws(() => applyCustomerGroupChange(groups, { op: 'remove', id: 'cg_2' }, id), /removed meanwhile/);
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('Customer groups on the server (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_cgroup_${crypto.randomBytes(4).toString('hex')}`;
  let db: Firestore;
  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../server/db/firestore')).getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Groups', currency: 'USD', members: ['owner-1', 'view-1'], roles: { 'view-1': 'viewer' } });
  });
  after(async () => {
    for (const table of ['auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('two people adding at once both keep theirs; a viewer is refused', async () => {
    const { changeCustomerGroups } = await import('../server/services/customerGroupService');
    const as = (uid: string, change: Record<string, unknown>) => changeCustomerGroups(db, { workspaceId: ws, uid, change: change as never });
    await Promise.all([as('owner-1', { op: 'add', name: 'Wholesale', paymentTerms: 'net_45' }), as('owner-1', { op: 'add', name: 'Retail' })]);
    const saved = normalizeCustomerGroups((await db.collection('workspaces').doc(ws).get()).data()?.customerGroups);
    assert.deepEqual(saved.map(g => g.name).sort(), ['Retail', 'Wholesale']);
    assert.ok(saved.every(g => /^cg_[0-9a-f]{16}$/.test(g.id)));
    await assert.rejects(as('view-1', { op: 'add', name: 'X' }), /owners and accountants/);
  });
});
