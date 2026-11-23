/**
 * CR-01 regression (audit PR #1002, CREDITS-REVIEW): a foreign-currency credit
 * refund must clear the control balance in the home currency.
 *
 * USD books issue a customer credit of €100 at $1.20/€ (issuance credits A/R
 * by $120). Refunding the full €100 at the same rate must debit A/R and credit
 * cash by $120, leaving nothing on A/R. The audit found the refund builder
 * supplied no line rates, the schema defaulted them to 1, and the validator
 * settled 1:1 — debit A/R $100 / credit cash $100, credit marked used, $20
 * left stuck in A/R. This test inverts that: the refund journal settles at the
 * header rate (baseAmountCents $12,000) and the net A/R across issuance and
 * refund is exactly zero.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Firestore } from '../server/db/pgFirestore';
import { postDocument } from '../server/services/documentPostService';
import { refundCredit } from '../server/services/creditService';
import { lineAmount } from '../lib/txFilters';

const url = process.env.LF_TEST_DATABASE_URL;
type Run = (db: Firestore, ws: string) => Promise<void>;

async function isolated(run: Run) {
  process.env.DATABASE_URL = url;
  const db = new Firestore({ connectionString: url });
  const ws = `auditcr01_${crypto.randomUUID()}`;
  try {
    await db.collection('workspaces').doc(ws).set({ uid: 'owner', members: ['owner'], roles: {}, currency: 'USD' });
    await db.collection('chartAccounts').doc(`${ws}_ar`).set({ workspaceId: ws, name: 'Accounts Receivable', type: 'asset', category: 'Receivables' });
    await db.collection('chartAccounts').doc(`${ws}_sales`).set({ workspaceId: ws, name: 'Sales Returns', type: 'income', category: 'Revenue' });
    await db.collection('chartAccounts').doc(`${ws}_cash`).set({ workspaceId: ws, name: 'Cash', type: 'asset', category: 'Cash', role: 'cash' });
    await run(db, ws);
  } finally {
    for (const table of await db.tables()) await db.pool.query(`delete from public."${table.replaceAll('"', '""')}" where data->>'workspaceId' = $1`, [ws]);
    await db.collection('workspaces').doc(ws).delete();
    await db.terminate();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the seeded rows are read by property name in the assertions
const entriesOf = async (db: Firestore, ws: string): Promise<Array<Record<string, any>>> =>
  (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.map(d => ({
    id: d.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the seeded rows are read by property name in the assertions
    ...(d.data() as Record<string, any>),
  }));

describe('audit CR-01: foreign credit refund settles at the header rate', { skip: !url }, () => {
  test('a full €100 @ 1.20 refund clears A/R exactly — no $20 residue', async () => {
    await isolated(async (db, ws) => {
      const cn = `${ws}_cn`;
      const user = { uid: 'owner' } as never;
      await postDocument(db, user, {
        collection: 'creditNotes', docId: cn, workspaceId: ws, action: 'create',
        data: {
          id: cn, workspaceId: ws, uid: 'owner', customerId: 'customer', customerName: 'Customer',
          number: 'CN-1', date: '2026-05-10', status: 'open', currency: 'EUR', exchangeRate: 1.2,
          amountCents: 10000, remainingCents: 10000,
        },
      });

      const issuance = (await entriesOf(db, ws)).find(t => t.metadata?.creditNoteId === cn)!;
      const arOf = (tx: Record<string, unknown>, account: string) =>
        (tx.lines as Array<Record<string, unknown>>).find(l => l.accountId === account)!;
      assert.equal(arOf(issuance, `${ws}_ar`).amountCents, -12000,
        'issuance posts the credit in the home currency: A/R credited $120');

      const refund = await refundCredit(db, {
        workspaceId: ws, uid: 'owner', kind: 'customer', creditId: cn,
        amountCents: 10000, cashAccountId: `${ws}_cash`, date: '2026-05-15',
      });
      const refundTx = (await db.collection('transactions').doc(refund.transactionId).get()).data() as Record<string, unknown>;

      assert.equal(arOf(refundTx, `${ws}_ar`).amountCents, 10000, 'the refund journal stays in the credit currency (EUR 100)');
      assert.equal(lineAmount(arOf(refundTx, `${ws}_ar`) as never, refundTx as never), 12000,
        'A/R debited $120 at the header rate, not $100 at a defaulted 1:1 line rate');
      assert.equal(lineAmount(arOf(refundTx, `${ws}_cash`) as never, refundTx as never), -12000,
        'cash credited $120, not $100');
      assert.equal(refundTx.totalAmountCents, 12000, 'the entry total follows the settled home amounts');
      assert.equal((refundTx.lines as Array<Record<string, unknown>>).every(l => l.exchangeRate === undefined), true,
        'the refund must not inject a default 1:1 line rate');

      const all = await entriesOf(db, ws);
      const homeOn = (tx: Record<string, unknown>, account: string) =>
        (tx.lines as Array<Record<string, unknown>>).filter(l => l.accountId === account)
          .reduce((s, l) => s + lineAmount(l as never, tx as never), 0);
      assert.equal(all.reduce((s, t) => s + homeOn(t, `${ws}_ar`), 0), 0,
        'issuance and refund net to zero on A/R — the $20 residue is gone');
      assert.equal((await db.collection('creditNotes').doc(cn).get()).data()?.remainingCents, 0, 'credit fully consumed');
    });
  });
});
