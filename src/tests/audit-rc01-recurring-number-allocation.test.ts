// RC-01 acceptance: generateInvoice takes the invoice number inside the same database transaction
// as the write, so a skipped occurrence (already generated / paused) burns no number.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('a skipped recurring invoice generation burns no invoice number', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const { getDb } = await import('../../src/server/db/firestore');
  const { processRecurring } = await import('../../src/server/services/recurringService');
  const db = getDb();
  const ws = `ws_audit_rc_${crypto.randomBytes(5).toString('hex')}`;
  const id = (s: string) => `${ws}_${s}`;

  try {
    await db.collection('workspaces').doc(ws).set({
      uid: 'audit-owner', members: ['audit-owner'], name: 'Synthetic Recurring',
      currency: 'USD', timezone: 'UTC',
    });
    await db.collection('chartAccounts').doc(id('sales')).set({ workspaceId: ws, name: 'Sales', type: 'revenue', category: 'Revenue' });

    await db.collection('recurring').doc(id('rule')).set({
      workspaceId: ws, uid: 'audit-owner', isActive: true, type: 'invoice',
      description: 'Monthly retainer',
      nextOccurrence: '2026-05-01',
      invoiceTemplate: {
        customerId: id('cust'), customerName: 'Acme',
        amountCents: 1_000_00, dueDays: 30,
        items: [{ id: 'l1', description: 'Retainer', quantity: 1, rateCents: 1_000_00, amountCents: 1_000_00, accountId: id('sales') }],
      },
    });

    // first run: the occurrence is generated and takes the first number (re-read the schedule
    // through the same query processRecurring uses, so the write is visible to it)
    const first = await processRecurring(db, '2026-05-10');
    assert.equal(first.processedCount, 1, JSON.stringify(first));
    const generated = (await db.collection('invoices').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
    assert.equal(generated.length, 1);
    const firstNumber = String(generated[0].number);
    assert.match(firstNumber, /^INV-\d{4}-0001$/, `first number was ${firstNumber}`);

    // RC-01 race: the occurrence is still due (its nextOccurrence was not advanced, as when another
    // worker generated it concurrently) but the invoice already exists -> generateInvoice skips it.
    // The skip must not advance the numbering series, so the next real invoice has no gap.
    const ruleAgain = (await db.collection('recurring').doc(id('rule')).get()).data();
    await db.collection('recurring').doc(id('rule')).set({ ...ruleAgain, nextOccurrence: '2026-05-01' });
    const second = await processRecurring(db, '2026-05-10');
    assert.equal(second.skippedCount, 1, JSON.stringify(second));
    assert.equal(second.processedCount, 0);

    const series = (await db.collection('numberingSeries').doc(`${ws}_invoice`).get()).data()!;
    assert.equal(series.nextNumber, 2, 'RC-01: the skipped occurrence burned no invoice number');

    // a real second generation gets the next sequential number
    const rule = (await db.collection('recurring').doc(id('rule')).get()).data();
    await db.collection('recurring').doc(id('rule')).set({ ...rule, nextOccurrence: '2026-06-01' });
    await db.collection('recurring').where('isActive', '==', true).get();
    const third = await processRecurring(db, '2026-06-10');
    assert.equal(third.processedCount, 1, JSON.stringify(third));
    const all = (await db.collection('invoices').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
    assert.deepEqual(all.map(i => i.number).sort(), [firstNumber, firstNumber.replace('0001', '0002')].sort(), 'the numbers stay sequential with no gap');

    console.log(JSON.stringify({ firstNumber, skippedBurned: series.nextNumber, invoices: all.map(i => i.number) }));
  } finally {
    for (const table of ['recurring', 'invoices', 'numberingSeries', 'chartAccounts', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]).catch(() => {});
    }
    await db.terminate();
  }
});
