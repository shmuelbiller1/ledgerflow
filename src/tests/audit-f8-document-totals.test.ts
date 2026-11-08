/**
 * Audit F8 (independent readiness audit, 5 Nov 2026): an invoice or bill whose total is less than its own items allow.
 * Hand-worked: items of 10,000 cents. Whatever the tax rule, the total owed is at least the items less the header
 * discount and retainage, with a cent per item for rounding:
 *   total 1 → refused · 10,000 (tax included) → fine · 10,800 (8% added) → fine · 9,000 with a 1,000 discount → fine
 *   8,999 with a 1,000 discount → refused · 9,999 (one cent of rounding) → fine · items without whole-cent amounts → not judged
 * Against migrated Postgres, the audit's sent invoice (one $100 item, total $0.01) is refused with 400 and nothing posts;
 * the same as a draft is saved, since a draft is not posted.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { itemsExceedTotal } from '../lib/documentItemsCheck';
import { Firestore } from '../server/db/pgFirestore';
import { postDocument } from '../server/services/documentPostService';
import { getDb } from '../server/db/firestore';

const items = [{ amountCents: 6000 }, { amountCents: 4000 }];

describe('audit F8: totals against items', () => {
  test('the hand-worked cases', () => {
    assert.ok(itemsExceedTotal({ amountCents: 1, items }));
    assert.equal(itemsExceedTotal({ amountCents: 10000, items }), null);
    assert.equal(itemsExceedTotal({ amountCents: 10800, items }), null);
    assert.equal(itemsExceedTotal({ amountCents: 9000, items, discountCents: 1000 }), null);
    assert.ok(itemsExceedTotal({ amountCents: 8997, items, discountCents: 1000 }));
    assert.equal(itemsExceedTotal({ amountCents: 9998, items }), null);
    assert.equal(itemsExceedTotal({ amountCents: 9000, items, retainageCents: 1000 }), null);
    assert.equal(itemsExceedTotal({ amountCents: 1, items: [{ amountCents: 10000 }, { rate: 5 }] }), null);
    assert.equal(itemsExceedTotal({ amountCents: 1, items: [] }), null);
  });
});

describe('audit F8: the posting path', { skip: !process.env.LF_TEST_DATABASE_URL }, () => {
  async function isolated(run: (db: Firestore, ws: string) => Promise<void>) {
    const url = process.env.LF_TEST_DATABASE_URL;
    process.env.DATABASE_URL = url;
    const db = new Firestore({ connectionString: url });
    const ws = `auditf8_${crypto.randomUUID()}`;
    try {
      await db.collection('workspaces').doc(ws).set({ uid: 'owner', members: ['owner'], roles: {}, currency: 'USD' });
      await db.collection('chartAccounts').doc(`${ws}_ar`).set({ workspaceId: ws, name: 'Accounts Receivable', type: 'asset', category: 'Receivables' });
      await db.collection('chartAccounts').doc(`${ws}_cash`).set({ workspaceId: ws, name: 'Cash', type: 'asset', category: 'Cash' });
      await db.collection('chartAccounts').doc(`${ws}_sales`).set({ workspaceId: ws, name: 'Sales', type: 'income', category: 'Revenue' });
      await run(db, ws);
    } finally {
      for (const table of await db.tables()) await db.pool.query(`delete from public."${table.replaceAll('"', '""')}" where data->>'workspaceId' = $1`, [ws]);
      await db.collection('workspaces').doc(ws).delete();
      await db.terminate();
      await getDb().terminate();
    }
  }
  const invoice = (ws: string, status: string) => ({ collection: 'invoices' as const, docId: `${ws}_inv`, workspaceId: ws, action: 'create' as const,
    data: { workspaceId: ws, customerId: 'customer', date: '2026-11-01', amountCents: 1, status, items: [{ id: 'one', description: 'Service', quantity: 1, rateCents: 10000, amountCents: 10000 }] } });
  const posted = async (db: Firestore, ws: string) => (await db.collection('transactions').where('workspaceId', '==', ws).get()).size;

  test('a sent invoice with a $0.01 total and a $100 item is refused; nothing posts', async () => {
    await isolated(async (db, ws) => {
      await assert.rejects(postDocument(db, { uid: 'owner' } as never, invoice(ws, 'sent')), (err: { status?: number; body?: { error?: string } }) =>
        err.status === 400 && /less than its items allow/.test(String(err.body?.error)));
      assert.equal(await posted(db, ws), 0);
    });
  });

  test('the same as a draft is saved: a draft is not posted', async () => {
    await isolated(async (db, ws) => {
      await postDocument(db, { uid: 'owner' } as never, invoice(ws, 'draft'));
      assert.equal(await posted(db, ws), 0);
    });
  });
});
