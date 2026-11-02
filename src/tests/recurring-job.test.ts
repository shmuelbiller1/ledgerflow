/**
 * The daily recurring job (src/server/services/recurringService.ts, BE-03): paused schedules don't
 * run; a recurring invoice becomes a draft invoice (numbered, due date kept, team told), once per
 * date; a recurring entry is posted only with real, balanced accounts, otherwise nothing is
 * written and the schedule shows why. Before, invoice schedules wrote ledger entries with blank
 * accounts and no workspace. Needs LF_TEST_DATABASE_URL.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { invalidEntryReason, isBillSchedule, isEstimateSchedule, isInvoiceSchedule } from '../server/services/recurringService';
import { recurringBillSchedule } from '../lib/recurringBills';
import { recurringEstimateSchedule } from '../lib/recurringEstimates';
import type { Firestore } from '../server/db/pgFirestore';

describe('Recurring schedules: checks', () => {
  test('which schedules are invoices', () => {
    assert.equal(isInvoiceSchedule({ type: 'invoice' }), true);
    assert.equal(isInvoiceSchedule({ template: { tags: ['recurring', 'invoice'] } }), true, 'saved before this change');
    assert.equal(isInvoiceSchedule({ template: { lines: [] } }), false);
    assert.equal(isBillSchedule({ type: 'bill' }), true);
    assert.equal(isBillSchedule({ type: 'invoice' }), false);
    assert.equal(isEstimateSchedule({ type: 'estimate' }), true);
    assert.equal(isEstimateSchedule({ type: 'bill' }), false);
  });

  test('a repeating bill\'s schedule copies the vendor, lines and tax, not its number, dates or payments', () => {
    const schedule = recurringBillSchedule({ id: 'b1', number: 'V-9', vendorId: 'v1', vendorName: 'Landlord', date: '2026-01-31', dueDate: '2026-02-14',
      amountCents: 5000, status: 'pending', amountPaidCents: 100, splits: [{ accountId: 'rent', amountCents: 5000 }], metadata: { memo: 'x' } }, 'monthly');
    assert.equal(schedule.type, 'bill');
    assert.equal(schedule.nextOccurrence, '2026-02-28', 'the 31st becomes the last day of February');
    assert.deepEqual(Object.keys(schedule.billTemplate).sort(), ['amountCents', 'dueDays', 'splits', 'vendorId', 'vendorName']);
    assert.equal(schedule.billTemplate.dueDays, 14);
  });

  test('an entry needs two lines, real accounts, whole cents, and must balance', () => {
    const accounts = new Set(['a', 'b']);
    assert.equal(invalidEntryReason([{ accountId: 'a', amountCents: 100 }, { accountId: 'b', amountCents: -100 }], accounts), null);
    assert.match(String(invalidEntryReason([{ accountId: '', amountCents: 100 }, { accountId: 'b', amountCents: -100 }], accounts)), /no account/);
    assert.match(String(invalidEntryReason([{ accountId: 'a', amountCents: 100 }, { accountId: 'x', amountCents: -100 }], accounts)), /not in this workspace/);
    assert.match(String(invalidEntryReason([{ accountId: 'a', amountCents: 100 }, { accountId: 'b', amountCents: -90 }], accounts)), /not equal/);
    assert.match(String(invalidEntryReason(undefined, accounts)), /two lines/);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('The daily recurring job', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_rec_${crypto.randomBytes(4).toString('hex')}`;
  const id = (name: string) => `${ws}_${name}`;
  let db: Firestore;
  let processRecurring: typeof import('../server/services/recurringService').processRecurring;
  const rule = (name: string, fields: Record<string, unknown>) => db.collection('recurring').doc(id(name)).set({
    workspaceId: ws, uid: `${ws}-owner`, description: name, frequency: 'monthly', nextOccurrence: '2026-09-01', anchorDay: 1,
    isActive: true, amountCents: 5000, createdAt: '2026-08-01T00:00:00Z', template: {}, ...fields,
  });

  before(async () => {
    process.env.DATABASE_URL = url;
    ({ processRecurring } = await import('../server/services/recurringService'));
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: `${ws}-owner`, name: 'Rec Co', currency: 'EUR', timezone: 'UTC' });
    await db.collection('chartAccounts').doc(id('rent')).set({ workspaceId: ws, name: 'Rent', type: 'expense', code: '6000' });
    await db.collection('chartAccounts').doc(id('bank')).set({ workspaceId: ws, name: 'Bank', type: 'asset', category: 'Cash', code: '1000' });
    await rule('inv', {
      type: 'invoice', payee: 'Acme',
      invoiceTemplate: { customerId: 'c1', customerName: 'Acme', currency: 'EUR', amountCents: 5000, dueDays: 14,
        items: [{ id: 'l1', description: 'Support plan', quantity: 1, rateCents: 5000, amountCents: 5000, accountId: 'rev' }] },
    });
    await rule('legacy', { amountCents: 2500, template: { description: 'Invoice: Old Co', amountCents: 2500, customerId: 'c2', tags: ['recurring', 'invoice'] } });
    await rule('rent', { template: { lines: [{ accountId: id('rent'), amountCents: 100000 }, { accountId: id('bank'), amountCents: -100000 }] } });
    await rule('broken', { template: {} });
    await rule('paused', { type: 'invoice', isActive: false, invoiceTemplate: { customerId: 'c3', amountCents: 1 } });
    await rule('bill', {
      type: 'bill', payee: 'Landlord', nextOccurrence: '2026-09-02', anchorDay: 2,
      billTemplate: { vendorId: 'v1', vendorName: 'Landlord', currency: 'EUR', amountCents: 120000, dueDays: 10, taxVersion: 2,
        splits: [{ accountId: id('rent'), amountCents: 120000, description: 'Office rent' }] },
    });
  });

  after(async () => {
    for (const table of ['recurring', 'invoices', 'bills', 'transactions', 'chartAccounts', 'notifications', 'numberingSeries', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  test('invoices become drafts, the good entry is posted, the broken one is reported, paused ones wait', async () => {
    const result = await processRecurring(db, '2026-09-01');
    assert.equal(result.processedCount, 3, JSON.stringify(result.details));
    assert.equal(result.failedCount, 1);

    const invoices = (await db.collection('invoices').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
    const acme = invoices.find(i => i.customerId === 'c1');
    assert.equal(acme?.status, 'draft');
    assert.equal(acme?.date, '2026-09-01');
    assert.equal(acme?.dueDate, '2026-09-15');
    assert.equal(acme?.items?.[0]?.description, 'Support plan');
    assert.ok(String(acme?.number).length > 0, 'numbered');
    const old = invoices.find(i => i.customerId === 'c2');
    assert.equal(old?.amountCents, 2500, 'schedules saved before this change still work');
    assert.equal(invoices.some(i => i.customerId === 'c3'), false, 'paused');

    const entries = (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
    assert.equal(entries.length, 1, 'only the rent entry; invoices are not ledger entries');
    assert.deepEqual(entries[0].lines.map((l: { amountCents: number }) => l.amountCents), [100000, -100000]);
    assert.equal(entries[0].currency, 'EUR');

    const broken = (await db.collection('recurring').doc(id('broken')).get()).data();
    assert.match(String(broken?.lastErrorCode), /two lines/);
    assert.equal(broken?.nextOccurrence, '2026-09-01', 'not moved on');
    const next = (await db.collection('recurring').doc(id('inv')).get()).data();
    assert.equal(next?.nextOccurrence, '2026-10-01');

    const notes = (await db.collection('notifications').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
    assert.equal(notes.filter(n => n.kind === 'invoice.draft_ready').length, 2, 'the owner is told about each draft');
    const failed = notes.filter(n => n.kind === 'recurring.failed');
    assert.equal(failed.length, 1, 'and about the entry that could not be created (S-12)');
    assert.match(String(failed[0].message), /2026-09-01: .*two lines/);
    assert.equal(failed[0].linkTab, 'recurring');
  });

  test('running again the same day creates nothing new', async () => {
    const again = await processRecurring(db, '2026-09-01');
    assert.equal(again.processedCount, 0);
    const failedNotes = (await db.collection('notifications').where('workspaceId', '==', ws).get()).docs.filter(d => d.data().kind === 'recurring.failed');
    assert.equal(failedNotes.length, 1, 'the same failure is not announced twice');
    assert.equal((await db.collection('invoices').where('workspaceId', '==', ws).get()).docs.length, 2);
  });

  test('a recurring bill (BE-08) becomes a draft bill for its date, once; nothing is posted until it is saved', async () => {
    const result = await processRecurring(db, '2026-09-02');
    assert.equal(result.processedCount, 1, JSON.stringify(result.details));
    const bills = (await db.collection('bills').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
    assert.equal(bills.length, 1);
    assert.deepEqual([bills[0].status, bills[0].date, bills[0].dueDate, bills[0].vendorName, bills[0].amountCents, bills[0].number],
      ['draft', '2026-09-02', '2026-09-12', 'Landlord', 120000, '']);
    assert.equal(bills[0].splits[0].description, 'Office rent');
    assert.equal(bills[0].dueDays, undefined);
    assert.equal((await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.length, 1, 'still only the rent entry from before');
    assert.equal((await db.collection('recurring').doc(id('bill')).get()).data()?.nextOccurrence, '2026-10-02');
    const notes = (await db.collection('notifications').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
    assert.ok(notes.some(n => n.kind === 'bill.draft_ready'));
    assert.equal((await processRecurring(db, '2026-09-02')).processedCount, 0, 'once per date');
  });

  test('a recurring estimate (CC-04) becomes a numbered draft estimate for its date, once; nothing is sent', async () => {
    const schedule = recurringEstimateSchedule({ id: 'e1', number: 'EST-1', customerId: 'c9', customerName: 'Acme', date: '2026-08-05', expiryDate: '2026-08-19',
      status: 'accepted', amountCents: 9900, lines: [{ description: 'Retainer', quantity: 1, unitPriceCents: 9900, amountCents: 9900 }], signToken: 'secret' } as never, 'monthly', '2026-08-06');
    await rule('est', { ...schedule, nextOccurrence: '2026-09-05', anchorDay: 5, createdAt: '2026-08-06T00:00:00Z' });
    // the same estimate set to repeat a second time: only the first schedule makes drafts
    await rule('est2', { ...schedule, nextOccurrence: '2026-09-05', anchorDay: 5, createdAt: '2026-08-07T00:00:00Z' });
    // a schedule whose estimate has no lines makes nothing and says why
    await rule('estbad', { ...schedule, sourceEstimateId: 'e-bad', estimateTemplate: { ...schedule.estimateTemplate, lines: [] }, nextOccurrence: '2026-09-05', anchorDay: 5 });
    const result = await processRecurring(db, '2026-09-05');
    assert.equal(result.details.filter(d => d.estimateId).length, 1, JSON.stringify(result.details));
    const estimates = (await db.collection('estimates').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
    assert.equal(estimates.length, 1);
    const e = estimates[0];
    assert.deepEqual([e.status, e.date, e.expiryDate, e.customerName, e.amountCents, e.currency], ['draft', '2026-09-05', '2026-09-19', 'Acme', 9900, 'EUR']);
    assert.ok(e.number && e.number !== 'EST-1', 'a new number');
    assert.equal(e.signToken, undefined, 'no signing link carried over');
    assert.equal(e.validityDays, undefined);
    assert.equal(e.lines[0].description, 'Retainer', 'the lines are copied');
    assert.match(String((await db.collection('recurring').doc(id('estbad')).get()).data()?.lastErrorCode), /no lines/);
    assert.equal((await db.collection('recurring').doc(id('est')).get()).data()?.nextOccurrence, '2026-10-05');
    const notes = (await db.collection('notifications').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
    assert.ok(notes.some(n => n.kind === 'estimate.draft_ready'));
    assert.equal((await processRecurring(db, '2026-09-05')).details.filter(d => d.estimateId).length, 0, 'once per date');
  });
});
