/**
 * Merging duplicate contacts (Y-23 BA-01): everything that pointed at the duplicate points at the
 * kept contact (invoices, estimates, credits, payments, schedules, ledger references), no amount
 * changes, details combined, the duplicate removed; owners/accountants only; one workspace.
 * Needs LF_TEST_DATABASE_URL.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';
import { describeUsage, mergedPartyFields } from '../server/services/contactMergeService';

const url = process.env.LF_TEST_DATABASE_URL;

test('the kept contact keeps its details, fills blanks from the duplicate, combines people, tags and notes', () => {
  const merged = mergedPartyFields(
    { name: 'Acme Ltd', email: 'ap@acme.test', phone: '', tags: ['VIP'], contacts: [{ name: 'Dana', email: 'dana@acme.test' }], noteLog: [{ id: 'n1', text: 'Old', at: '2026-01-01T00:00:00Z' }] },
    { name: 'ACME', email: 'other@acme.test', phone: '555', address: '1 Main St', status: 'archived', tags: ['vip', 'wholesale'], contacts: [{ name: 'Dana', email: 'DANA@acme.test' }, { name: 'Lee' }], noteLog: [{ id: 'n2', text: 'Newer', at: '2026-03-01T00:00:00Z' }] },
    { id: 'm', text: 'Merged with "ACME"', at: '2026-10-05T00:00:00Z' },
  );
  assert.equal(merged.email, undefined, 'its own email stays');
  assert.equal(merged.phone, '555', 'a blank is filled');
  assert.equal(merged.address, '1 Main St');
  assert.equal(merged.status, undefined, 'status is never copied');
  assert.deepEqual(merged.tags, ['VIP', 'wholesale']);
  assert.deepEqual(merged.contacts, [{ name: 'Dana', email: 'dana@acme.test' }, { name: 'Lee' }]);
  assert.deepEqual(merged.noteLog.map((n: { id: string }) => n.id), ['m', 'n2', 'n1']);
});

test('what a contact is used by, in words', () => {
  assert.equal(describeUsage({ invoices: 2 }), '2 invoices');
  assert.equal(describeUsage({ invoices: 1, payments: 1, transactions: 3 }), '1 invoice, 1 payment and 3 ledger entries');
  assert.equal(describeUsage({ transactions: 1, recurring: 2 }), '1 ledger entry and 2 recurring schedules');
});

describe('Merging contacts (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_merge_${crypto.randomBytes(4).toString('hex')}`;
  const other = `${ws}_other`;
  const id = (name: string) => `${ws}_${name}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const merge = (uid: string, body: Record<string, unknown>, workspaceId = ws) =>
    fetch(`${base}/api/v1/workspaces/${workspaceId}/contacts/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify(body) });
  const get = async (collection: string, name: string) => (await db.collection(collection).doc(id(name)).get()).data();

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { contactMergeRouter } = await import('../server/routes/contactMergeRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner', name: 'Merge Co', currency: 'USD', members: ['owner', 'book'], roles: { book: 'bookkeeper' } });
    await db.collection('workspaces').doc(other).set({ uid: 'x', name: 'Other', members: ['x'] });
    const set = (collection: string, name: string, data: Record<string, unknown>) => db.collection(collection).doc(id(name)).set({ workspaceId: ws, ...data });
    await set('customers', 'keep', { name: 'Acme Ltd', email: 'ap@acme.test', tags: ['vip'] });
    await set('customers', 'dup', { name: 'ACME', phone: '555', tags: ['wholesale'], linkedVendorId: id('vacme') }); // CA-29: a linked duplicate
    await set('customers', 'bystander', { name: 'Beta' });
    await set('invoices', 'inv1', { customerId: id('dup'), customerName: 'ACME', number: 'INV-1', date: '2026-01-10', amountCents: 10000, status: 'sent' });
    await set('invoices', 'inv2', { customerId: id('bystander'), customerName: 'Beta', number: 'INV-2', date: '2026-01-11', amountCents: 500, status: 'sent' });
    await set('estimates', 'est1', { customerId: id('dup'), customerName: 'ACME', amountCents: 300 });
    await set('creditNotes', 'cn1', { customerId: id('dup'), customerName: 'ACME', amountCents: 200 });
    await set('payments', 'pay1', { contactId: id('dup'), contactName: 'ACME', direction: 'received', amountCents: 4000, date: '2026-02-01' });
    await set('transactions', 'tx1', { date: '2026-01-10', description: 'Invoice INV-1', totalAmountCents: 10000, status: 'completed', metadata: { invoiceId: id('inv1'), customerId: id('dup'), type: 'invoice-accrual' }, lines: [{ accountId: 'merge-debit', amountCents: 10000 }, { accountId: 'merge-credit', amountCents: -10000 }] });
    await set('recurring', 'rec1', { isActive: true, invoiceTemplate: { customerId: id('dup'), customerName: 'ACME', amountCents: 100 } });
    await set('vendors', 'vkeep', { name: 'Paper Co' });
    await set('vendors', 'vdup', { name: 'Paper Company', address: '9 Mill Rd' });
    await set('bills', 'bill1', { vendorId: id('vdup'), vendorName: 'Paper Company', amountCents: 700, date: '2026-03-01', status: 'open' });
    await set('customers', 'paperbuyer', { name: 'Paper Co (as a customer)', linkedVendorId: id('vdup') }); // CA-29
    await db.collection('customers').doc(`${other}_c`).set({ workspaceId: other, name: 'Theirs' });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: `${req.header('x-test-uid')}@test.local` }; next(); });
    app.use('/api/v1/workspaces/:workspaceId/contacts', contactMergeRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['invoices', 'estimates', 'creditNotes', 'payments', 'transactions', 'recurring', 'bills', 'customers', 'vendors', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1)`, [[ws, other]]);
    }
    await db.terminate();
  });

  test('refused: a bookkeeper, the same contact twice, another workspace\'s contact, a missing one; nothing changes', async () => {
    assert.equal((await merge('book', { side: 'customer', keepId: id('keep'), mergeId: id('dup') })).status, 403);
    assert.equal((await merge('owner', { side: 'customer', keepId: id('keep'), mergeId: id('keep') })).status, 400);
    assert.equal((await merge('owner', { side: 'customer', keepId: id('keep'), mergeId: `${other}_c` })).status, 404);
    assert.equal((await merge('owner', { side: 'customer', keepId: id('keep'), mergeId: id('nobody') })).status, 404);
    assert.equal((await merge('owner', { side: 'customer', keepId: id('keep') })).status, 400);
    assert.equal((await get('invoices', 'inv1'))?.customerId, id('dup'));
    assert.ok(await get('customers', 'dup'));
  });

  test('merging ACME into Acme Ltd moves every document and reference, amounts unchanged', async () => {
    const res = await merge('owner', { side: 'customer', keepId: id('keep'), mergeId: id('dup') });
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json();
    assert.deepEqual(body.moved, { invoices: 1, estimates: 1, creditNotes: 1, payments: 1, transactions: 1, recurring: 1 });
    assert.equal((await get('customers', 'keep'))?.linkedVendorId, id('vacme'), 'CA-29: the duplicate\'s vendor link moves to the kept customer without tripping the unique index');
    const inv = await get('invoices', 'inv1');
    assert.deepEqual([inv?.customerId, inv?.customerName, inv?.amountCents], [id('keep'), 'Acme Ltd', 10000]);
    assert.equal((await get('invoices', 'inv2'))?.customerId, id('bystander'), 'other customers untouched');
    assert.equal((await get('estimates', 'est1'))?.customerId, id('keep'));
    assert.equal((await get('creditNotes', 'cn1'))?.customerId, id('keep'));
    const pay = await get('payments', 'pay1');
    assert.deepEqual([pay?.contactId, pay?.contactName, pay?.amountCents], [id('keep'), 'Acme Ltd', 4000]);
    const tx = await get('transactions', 'tx1');
    assert.deepEqual(tx?.metadata, { invoiceId: id('inv1'), customerId: id('keep'), type: 'invoice-accrual' });
    assert.equal((await get('recurring', 'rec1'))?.invoiceTemplate.customerId, id('keep'));
    assert.equal(await get('customers', 'dup'), undefined, 'the duplicate is gone');
    const kept = await get('customers', 'keep');
    assert.deepEqual([kept?.name, kept?.email, kept?.phone, kept?.tags], ['Acme Ltd', 'ap@acme.test', '555', ['vip', 'wholesale']]);
    assert.match(kept?.noteLog[0].text, /Merged with "ACME"/);
    const audit = await db.collection('auditLogs').where('workspaceId', '==', ws).get();
    assert.ok(audit.docs.some(d => d.data().action === 'CUSTOMER_MERGED'));
  });

  test('vendors: bills move to the kept vendor; an accountant may merge', async () => {
    await db.collection('workspaces').doc(ws).set({ roles: { book: 'bookkeeper', acct: 'accountant' }, members: ['owner', 'book', 'acct'] }, { merge: true });
    const res = await merge('acct', { side: 'vendor', keepId: id('vkeep'), mergeId: id('vdup') });
    assert.equal(res.status, 200, await res.clone().text());
    assert.deepEqual((await res.json()).moved, { bills: 1, customers: 1 });
    assert.equal((await get('customers', 'paperbuyer'))?.linkedVendorId, id('vkeep'), 'CA-29: the party link follows the kept vendor');
    const bill = await get('bills', 'bill1');
    assert.deepEqual([bill?.vendorId, bill?.vendorName, bill?.amountCents], [id('vkeep'), 'Paper Co', 700]);
    assert.equal((await get('vendors', 'vkeep'))?.address, '9 Mill Rd');
  });

  test('delete: only a contact nothing refers to; a bookkeeper may; a viewer or another workspace may not', async () => {
    await db.collection('workspaces').doc(ws).set({ roles: { book: 'bookkeeper', acct: 'accountant', view: 'viewer' }, members: ['owner', 'book', 'acct', 'view'] }, { merge: true });
    await db.collection('customers').doc(id('unused')).set({ workspaceId: ws, name: 'Typo Ltd' });
    await db.collection('vendors').doc(id('scheduled')).set({ workspaceId: ws, name: 'Rent Co' });
    await db.collection('recurring').doc(id('rec2')).set({ workspaceId: ws, isActive: true, billTemplate: { vendorId: id('scheduled'), amountCents: 100 } });
    const del = (uid: string, side: string, contactId: string, workspaceId = ws) =>
      fetch(`${base}/api/v1/workspaces/${workspaceId}/contacts/${side}/${contactId}`, { method: 'DELETE', headers: { 'x-test-uid': uid } });

    const inUse = await del('owner', 'customer', id('keep'));
    assert.equal(inUse.status, 409);
    assert.equal((await inUse.json()).message, '"Acme Ltd" is used by 1 invoice, 1 estimate, 1 credit note, 1 payment, 1 ledger entry and 1 recurring schedule: archive it instead (those records keep it)');
    const scheduled = await del('owner', 'vendor', id('scheduled'));
    assert.equal(scheduled.status, 409);
    assert.match((await scheduled.json()).message, /1 recurring schedule/);
    assert.equal((await del('view', 'customer', id('unused'))).status, 403);
    assert.equal((await del('owner', 'customer', `${other}_c`)).status, 404);
    assert.equal((await del('owner', 'customer', id('unused'), other)).status, 403, 'not a writer there');
    assert.equal((await del('owner', 'nobody', id('unused'))).status, 400);
    assert.ok(await get('customers', 'unused'), 'nothing deleted yet');

    // ?check=1 (BO-08): the same checks, nothing deleted, no audit line
    const inUseCheck = await del('owner', 'customer', `${id('keep')}?check=1`);
    assert.equal(inUseCheck.status, 409);
    const check = await del('book', 'customer', `${id('unused')}?check=1`);
    assert.deepEqual([check.status, (await check.json()).deletable], [200, true]);
    assert.ok(await get('customers', 'unused'), 'the check deletes nothing');
    assert.equal((await db.collection('auditLogs').where('workspaceId', '==', ws).get()).docs.filter(d => d.data().action === 'CUSTOMER_DELETED').length, 0);

    const ok = await del('book', 'customer', id('unused'));
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal(await get('customers', 'unused'), undefined);
    assert.ok(await get('customers', 'keep'));
    const audit = await db.collection('auditLogs').where('workspaceId', '==', ws).get();
    assert.ok(audit.docs.some(d => d.data().action === 'CUSTOMER_DELETED' && d.data().uid === 'book'));
  });
});
