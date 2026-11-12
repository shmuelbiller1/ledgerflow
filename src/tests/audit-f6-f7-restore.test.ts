/**
 * Audit F6 and F7 (independent readiness audit, 5 Nov 2026), as safety tests. The ledger door, which restore and
 * every server ledger write go through:
 *   F6  refuses a completed entry with a total and no lines; a draft or void header with no lines still passes.
 *   F7  refuses an entry whose stored home-currency amounts do not balance (+100/−100 nominal, base +99,999/−100:
 *       99,899 cents over), and one whose base amount is not whole cents; a valid foreign entry (€100 at 1.1:
 *       base +11,000/−11,000) passes.
 * Against migrated Postgres, a restore holding such an entry refuses the whole backup and writes nothing.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { checkLedgerEntry, LedgerDoorError } from '../server/services/ledgerDoor';
import { Firestore } from '../server/db/pgFirestore';
import { restoreWorkspaceBackup } from '../server/services/workspaceRestoreService';

const url = process.env.LF_TEST_DATABASE_URL;
const entry = (lines: unknown[], extra: Record<string, unknown> = {}) =>
  ({ workspaceId: 'ws', status: 'completed', date: '2026-11-01', totalAmountCents: 100, lines, ...extra });

describe('audit F6/F7: the ledger door', () => {
  test('F6: a completed entry with no lines is refused; a draft or void header passes', () => {
    assert.throws(() => checkLedgerEntry(entry([])), LedgerDoorError);
    assert.throws(() => checkLedgerEntry(entry([], { lines: undefined })), LedgerDoorError);
    assert.doesNotThrow(() => checkLedgerEntry(entry([], { status: 'draft' })));
    assert.doesNotThrow(() => checkLedgerEntry(entry([], { status: 'void' })));
  });

  test('F7: home-currency amounts that do not balance are refused (99,899 cents over)', () => {
    assert.throws(() => checkLedgerEntry(entry([
      { accountId: 'cash', amountCents: 100, baseAmountCents: 99999 },
      { accountId: 'ar', amountCents: -100, baseAmountCents: -100 },
    ])), /99899 cents over/);
  });

  test('F7: a base amount that is not whole cents is refused', () => {
    assert.throws(() => checkLedgerEntry(entry([
      { accountId: 'cash', amountCents: 100, baseAmountCents: 110.5 },
      { accountId: 'ar', amountCents: -100, baseAmountCents: -110.5 },
    ])), /whole cents/);
  });

  test('F7: a valid foreign entry (€100 at 1.1, base ±11,000) passes', () => {
    assert.doesNotThrow(() => checkLedgerEntry(entry([
      { accountId: 'cash', amountCents: 10000, baseAmountCents: 11000 },
      { accountId: 'ar', amountCents: -10000, baseAmountCents: -11000 },
    ], { totalAmountCents: 10000, currency: 'EUR', exchangeRate: 1.1 })));
  });
});

describe('audit F6/F7: restore refuses the whole backup', { skip: !url }, () => {
  async function isolated(run: (db: Firestore, ws: string, accounts: Array<Record<string, string>>) => Promise<void>) {
    const db = new Firestore({ connectionString: url });
    const ws = `auditf6_${crypto.randomUUID()}`;
    const accounts = [
      { id: `${ws}_cash`, workspaceId: ws, name: 'Cash', type: 'asset', category: 'Cash' },
      { id: `${ws}_ar`, workspaceId: ws, name: 'Accounts Receivable', type: 'asset', category: 'Receivables' },
    ];
    try {
      await db.collection('workspaces').doc(ws).set({ uid: 'owner', members: ['owner'], roles: {}, currency: 'USD' });
      await run(db, ws, accounts);
    } finally {
      for (const table of await db.tables()) await db.pool.query(`delete from public."${table.replaceAll('"', '""')}" where data->>'workspaceId' = $1`, [ws]);
      await db.collection('workspaces').doc(ws).delete();
      await db.terminate();
    }
  }
  const countIn = async (db: Firestore, ws: string, c: string) => (await db.collection(c).where('workspaceId', '==', ws).get()).size;

  test('F6: a completed entry with no lines: nothing is restored', async () => {
    await isolated(async (db, ws, accounts) => {
      await assert.rejects(restoreWorkspaceBackup(db, ws, { accounts, transactions: [{ id: `${ws}_e`, status: 'completed', date: '2026-11-01', totalAmountCents: 10000, lines: [] }] }));
      assert.equal(await countIn(db, ws, 'transactions'), 0);
      assert.equal(await countIn(db, ws, 'chartAccounts'), 0);
    });
  });

  test('F7: unbalanced home-currency amounts: nothing is restored', async () => {
    await isolated(async (db, ws, accounts) => {
      await assert.rejects(restoreWorkspaceBackup(db, ws, { accounts, transactions: [{ id: `${ws}_e`, status: 'completed', date: '2026-11-01', totalAmountCents: 100, lines: [
        { accountId: accounts[0].id, amountCents: 100, baseAmountCents: 99999 },
        { accountId: accounts[1].id, amountCents: -100, baseAmountCents: -100 },
      ] }] }));
      assert.equal(await countIn(db, ws, 'transactions'), 0);
    });
  });

  test('F7: a valid foreign entry restores with its home amounts kept', async () => {
    await isolated(async (db, ws, accounts) => {
      await restoreWorkspaceBackup(db, ws, { accounts, transactions: [{ id: `${ws}_e`, status: 'completed', date: '2026-11-01', totalAmountCents: 10000, currency: 'EUR', exchangeRate: 1.1, lines: [
        { accountId: accounts[0].id, amountCents: 10000, baseAmountCents: 11000 },
        { accountId: accounts[1].id, amountCents: -10000, baseAmountCents: -11000 },
      ] }] });
      const saved = (await db.collection('transactions').doc(`${ws}_e`).get()).data() as { lines: Array<{ baseAmountCents: number }> };
      assert.deepEqual(saved.lines.map(l => l.baseAmountCents), [11000, -11000]);
    });
  });

  test('F7: the database trigger matches application FX settlement for line rates, negative halves and residuals', async () => {
    await isolated(async (db, ws, accounts) => {
      const put = async (id: string, exchangeRate: number, lines: Array<Record<string, unknown>>) => {
        await db.collection('transactions').doc(`${ws}_${id}`).set({
          workspaceId: ws,
          date: '2026-11-01',
          status: 'completed',
          currency: 'EUR',
          exchangeRate,
          lines,
        });
        return (await db.collection('transactions').doc(`${ws}_${id}`).get()).data() as { lines: Array<Record<string, unknown>> };
      };

      // The line rate must win over the header rate. At 1.015, JS Math.round settles this
      // residual to [33, 33, -66]; using the header rate 1.25 would produce a different result.
      const lineRate = await put('line-rate', 1.25, [
        { accountId: accounts[0].id, amountCents: 33, exchangeRate: 1.015 },
        { accountId: accounts[1].id, amountCents: 33, exchangeRate: 1.015 },
        { accountId: accounts[0].id, amountCents: -66, exchangeRate: 1.015 },
      ]);
      assert.deepEqual(lineRate.lines.map(l => l.baseAmountCents), [33, 33, -66]);

      // PostgreSQL round(-1.5) is -2, whereas Math.round(-1.5) is -1. The trigger must
      // use the application rule and persist the same one-cent residual settlement.
      const negativeHalf = await put('negative-half', 1.5, [
        { accountId: accounts[0].id, amountCents: 1, exchangeRate: 1.5 },
        { accountId: accounts[1].id, amountCents: -1, exchangeRate: 1.5 },
      ]);
      assert.deepEqual(negativeHalf.lines.map(l => l.baseAmountCents), [1, -1]);

      const commonRateResidual = await put('common-rate-residual', 1.015, [
        { accountId: accounts[0].id, amountCents: 33 },
        { accountId: accounts[1].id, amountCents: 33 },
        { accountId: accounts[0].id, amountCents: -66 },
      ]);
      assert.deepEqual(commonRateResidual.lines.map(l => l.baseAmountCents), [33, 33, -66]);

      await assert.rejects(
        db.collection('transactions').doc(`${ws}_different-rates`).set({
          workspaceId: ws,
          date: '2026-11-01',
          status: 'completed',
          currency: 'EUR',
          exchangeRate: 1.25,
          lines: [
            { accountId: accounts[0].id, amountCents: 100, exchangeRate: 1.1 },
            { accountId: accounts[1].id, amountCents: -100, exchangeRate: 1.2 },
          ],
        }),
        /exchange-difference|home-currency amounts must sum to 0/,
      );
    });
  });
});
