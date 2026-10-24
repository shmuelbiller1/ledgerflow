/**
 * EG-10: Data Health compares each open invoice's and bill's amountPaidCents with the signed sum of its
 * paymentAllocations rows, and the A/R and A/P control balances with the open documents.
 *
 * Hand-worked figures (USD home currency, cents). Every payment below is a payment record, so each document's
 * settledByRecordsCents equals its amountPaidCents (nothing paid with the document) unless a test says otherwise:
 *   INV-1  total 100000, paid 40000; rows payment 30000 + payment 10000 = 40000         -> agrees
 *   INV-2  total  50000, paid 20000; rows payment 25000 + reversal -5000 = 20000        -> agrees (signed sum)
 *   INV-3  total  80000, paid 30000; rows payment 20000 = 20000                         -> mismatch, 30000 - 20000 = 10000 ($100.00)
 *   INV-4  total  20000, paid  5000; no rows                                            -> "no ledger rows yet", not a mismatch
 *   INV-5  draft  99999, paid 0                                                         -> ignored (not issued)
 *   B-1    total  60000, paid 60000 (paid); rows payment 60000                          -> agrees
 *   B-2    EUR 10000 at 1.10, paid 0, no rows                                           -> nothing (no amount paid)
 *
 * A/R: debits 100000 + 50000 + 80000 + 20000 = 250000, credits 40000 + 20000 + 30000 + 5000 = 95000,
 *   balance 155000. Open dues 60000 + 30000 + 50000 + 15000 = 155000 -> agrees.
 *   With a hand entry of 1234 on A/R: 156234 vs 155000 -> difference $12.34.
 * A/P: credit 60000 (B-1) + debit 60000 (its payment) + credit 11000 (B-2, 10000 x 1.10)
 *   = -11000, shown as 11000; open dues 0 + round(10000 x 1.10) = 11000 -> agrees.
 * Review fixes (PR #369):
 *   - JPY invoice ¥100,000 (0 decimals) at 0.0067 = $670.00 = 67000 cents, not 100000 × 0.0067 = 670 cents.
 *   - A/R opening balance 5000 + no entries = 5000; one invoice due 5000 -> agrees (opening counted).
 *   - Bill B-3 `paid` with no amountPaidCents, total 30000, deposit 0: paid = 30000 - 0 = 30000;
 *     rows 30000 -> agrees, due 0. Without the rule it read as 0 paid (mismatch) and 30000 due.
 *   - Bill B-4 status `unpaid`, total 7000, no entries: due 7000 is counted in A/P (shared set missed it).
 *   - Invoice `x` and bill `x` share an id: rows 1000 (invoice) and 2000 (bill) each agree, not 3000 for both.
 *   - transactions read in part (a cap): one low "Not checked" note, no difference.
 * Second review round (PR #369):
 *   - EUR invoice €100.00 at 1.1001, €50.00 paid, no rows: 10000 x 1.1001 = 11001; 5000 x 1.1001 = 5500.5 -> 5501;
 *     due in A/R = 11001 - 5501 = 5500 cents (one conversion of the net 5000 gave 5501).
 *   - Same invoice paid as two payment records (settledByRecordsCents 5000) with rows of €25.00, baseClearedCents 2750 each (2750.25 -> 2750): 11001 - 5500 = 5501.
 *   - Only bank lines cut: truncatedInputs gives ['bankLines'], and a 1234 A/R difference is still reported.
 * Third review round (PR #369):
 *   - $100.00 invoice, $20.00 paid with the document, then a $30.00 payment record: amountPaidCents 5000,
 *     settledByRecordsCents 3000, so cash posted with the document = 5000 - 3000 = 2000.
 *     With a row cleared at 3000: A/R = 10000 - 2000 - 3000 = 5000 ($50.00), not 10000 - 3000 = 7000.
 *     Without rows: 10000 - 2000 - (5000 - 2000) = 5000 as well.
 *   Settlement check, same invoice: amountPaid 5000 = 2000 with the document + row 3000 -> agrees
 *     (comparing the row alone said 5000 vs 3000, a false $20.00 difference). A row of 2500 instead:
 *     2000 + 2500 = 4500 vs 5000 -> $5.00 difference.
 * The database part runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Firestore } from '../server/db/pgFirestore';
import { DATA_CHECKS, truncatedInputs, type CheckContext } from '../lib/dataChecks';
import type { Bill, ChartAccount, Invoice, Transaction } from '../types';

const check = (id: string) => DATA_CHECKS.find(c => c.id === id)!;

const invoices = [
  { id: 'i1', number: 'INV-1', status: 'partially_paid', amountCents: 100000, amountPaidCents: 40000, settledByRecordsCents: 40000, currency: 'USD' },
  { id: 'i2', number: 'INV-2', status: 'partially_paid', amountCents: 50000, amountPaidCents: 20000, settledByRecordsCents: 20000, currency: 'USD' },
  { id: 'i3', number: 'INV-3', status: 'partially_paid', amountCents: 80000, amountPaidCents: 30000, settledByRecordsCents: 30000, currency: 'USD' },
  { id: 'i4', number: 'INV-4', status: 'partially_paid', amountCents: 20000, amountPaidCents: 5000, settledByRecordsCents: 5000, currency: 'USD' },
  { id: 'i5', number: 'INV-5', status: 'draft', amountCents: 99999, amountPaidCents: 0, currency: 'USD' },
] as unknown as Invoice[];
const bills = [
  { id: 'b1', number: 'B-1', status: 'paid', amountCents: 60000, amountPaidCents: 60000, settledByRecordsCents: 60000, currency: 'USD' },
  { id: 'b2', number: 'B-2', status: 'approved', amountCents: 10000, amountPaidCents: 0, currency: 'EUR', exchangeRate: 1.1 },
] as unknown as Bill[];
const allocations = [
  { id: 'a1', documentId: 'i1', documentType: 'invoice', kind: 'payment', amountCents: 30000 },
  { id: 'a2', documentId: 'i1', documentType: 'invoice', kind: 'payment', amountCents: 10000 },
  { id: 'a3', documentId: 'i2', documentType: 'invoice', kind: 'payment', amountCents: 25000 },
  { id: 'a4', documentId: 'i2', documentType: 'invoice', kind: 'reversal', amountCents: -5000 },
  { id: 'a5', documentId: 'i3', documentType: 'invoice', kind: 'payment', amountCents: 20000 },
  { id: 'a6', documentId: 'b1', documentType: 'bill', kind: 'payment', amountCents: 60000 },
];
const accounts = [
  { id: 'ar', name: 'Accounts receivable', type: 'asset', category: 'Receivables', role: 'ar' },
  { id: 'ap', name: 'Accounts payable', type: 'liability', category: 'Payables', role: 'ap' },
  { id: 'bank', name: 'Bank', type: 'asset', role: 'cash' },
  { id: 'sales', name: 'Sales', type: 'income' },
] as unknown as ChartAccount[];
const entry = (id: string, accountId: string, cents: number, other = 'bank', rate?: number): Transaction => ({
  id, date: '2026-10-01', status: 'posted', currency: rate ? 'EUR' : 'USD', exchangeRate: rate,
  lines: [{ accountId, amountCents: cents }, { accountId: other, amountCents: -cents }],
} as unknown as Transaction);
const transactions = [
  entry('t1', 'ar', 250000, 'sales'), entry('t2', 'ar', -95000),
  entry('t3', 'ap', -60000, 'sales'), entry('t4', 'ap', 60000), entry('t5', 'ap', -10000, 'sales', 1.1),
];
const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  invoices, bills, allocations, accounts, transactions, recurring: [], today: '2026-10-23', baseCurrency: 'USD', ...over,
});

describe('EG-10 settlement ledger check', () => {
  test('flags only INV-3, and lists INV-4 as having no rows without counting it', () => {
    const found = check('settlement-ledger').run(ctx());
    assert.deepEqual(found.map(f => [f.id, f.severity]), [
      ['settlement-ledger-invoice-i3', 'medium'],
      ['settlement-ledger-no-rows-invoice', 'low'],
    ]);
    assert.match(found[0].description, /100\.00/);
    assert.match(found[1].title, /^1 open invoice\(s\) .*no ledger rows yet, migration may not be applied$/);
    assert.match(found[1].description, /Not counted as a mismatch: INV-4\./);
  });

  test('says nothing when the rows are not loaded (the browser)', () => {
    assert.deepEqual(check('settlement-ledger').run(ctx({ allocations: undefined })), []);
  });

  test('an empty ledger (migration not applied) gives the no-rows notes only', () => {
    const found = check('settlement-ledger').run(ctx({ allocations: [] }));
    assert.deepEqual(found.map(f => f.id), ['settlement-ledger-no-rows-invoice', 'settlement-ledger-no-rows-bill']);
    assert.match(found[0].title, /^4 open invoice/);
  });
});

describe('EG-10 control balance check', () => {
  test('A/R 155000 and A/P 11000 agree with the open documents', () => {
    assert.deepEqual(check('control-balance').run(ctx()), []);
  });

  test('a hand entry of 1234 on A/R is a difference of $12.34', () => {
    const found = check('control-balance').run(ctx({ transactions: [...transactions, entry('t6', 'ar', 1234)] }));
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'control-balance-ar');
    assert.match(found[0].title, /1,562\.34.*1,550\.00/);
    assert.match(found[0].description, /12\.34 over 4 open invoice/);
  });

  test('no control account, no finding', () => {
    assert.deepEqual(check('control-balance').run(ctx({ accounts: accounts.filter(a => a.id === 'bank') })), []);
  });
});

describe('EG-10 review fixes', () => {
  test('a yen invoice is converted in minor units: ¥100,000 at 0.0067 = $670.00', () => {
    const yen = [{ id: 'j1', number: 'J-1', status: 'sent', amountCents: 100000, amountPaidCents: 0, currency: 'JPY', exchangeRate: 0.0067 }] as unknown as Invoice[];
    const found = check('control-balance').run(ctx({ invoices: yen, bills: [], transactions: [entry('t1', 'ar', 67000, 'sales')] }));
    assert.deepEqual(found, []);
  });

  test('the opening balance of A/R is counted', () => {
    const opened = accounts.map(a => (a.id === 'ar' ? { ...a, openingBalanceCents: 5000 } : a));
    const one = [{ id: 'o1', number: 'O-1', status: 'sent', amountCents: 5000, amountPaidCents: 0, currency: 'USD' }] as unknown as Invoice[];
    assert.deepEqual(check('control-balance').run(ctx({ accounts: opened, invoices: one, bills: [], transactions: [] })), []);
  });

  test('a bill marked paid without an amount counts as fully paid; an unpaid bill counts in A/P', () => {
    const marked = [
      { id: 'b3', number: 'B-3', status: 'paid', amountCents: 30000, currency: 'USD' },
      { id: 'b4', number: 'B-4', status: 'unpaid', amountCents: 7000, amountPaidCents: 0, currency: 'USD' },
    ] as unknown as Bill[];
    const rows = [{ id: 'r', documentId: 'b3', documentType: 'bill', kind: 'manual', amountCents: 30000 }];
    assert.deepEqual(check('settlement-ledger').run(ctx({ invoices: [], bills: marked, allocations: rows })), []);
    const found = check('control-balance').run(ctx({ invoices: [], bills: marked, transactions: [] }));
    assert.equal(found.length, 1);
    assert.match(found[0].title, /Accounts payable is \$0\.00, the open bills add up to \$70\.00/);
  });

  test('an invoice and a bill with the same id keep their own totals', () => {
    const inv = [{ id: 'x', number: 'X', status: 'partially_paid', amountCents: 5000, amountPaidCents: 1000, settledByRecordsCents: 1000, currency: 'USD' }] as unknown as Invoice[];
    const bill = [{ id: 'x', number: 'X', status: 'partially_paid', amountCents: 5000, amountPaidCents: 2000, settledByRecordsCents: 2000, currency: 'USD' }] as unknown as Bill[];
    const rows = [
      { id: 'r1', documentId: 'x', documentType: 'invoice', kind: 'payment', amountCents: 1000 },
      { id: 'r2', documentId: 'x', documentType: 'bill', kind: 'payment', amountCents: 2000 },
    ];
    assert.deepEqual(check('settlement-ledger').run(ctx({ invoices: inv, bills: bill, allocations: rows })), []);
  });

  test('capped inputs say the data is incomplete instead of reporting a difference', () => {
    const control = check('control-balance').run(ctx({ transactions: [...transactions, entry('t6', 'ar', 1234)], truncated: ['transactions'] }));
    assert.deepEqual(control.map(f => [f.id, f.severity]), [['control-balance-incomplete', 'low']]);
    const settled = check('settlement-ledger').run(ctx({ truncated: ['allocations'] }));
    assert.deepEqual(settled.map(f => f.id), ['settlement-ledger-incomplete']);
  });
});

describe('EG-10 second review round', () => {
  const eur = [{ id: 'e1', number: 'E-1', status: 'partially_paid', amountCents: 10000, amountPaidCents: 5000, currency: 'EUR', exchangeRate: 1.1001 }] as unknown as Invoice[];
  const only = (over: Partial<CheckContext>) => check('control-balance').run(ctx({ invoices: eur, bills: [], ...over }));

  test('each part converted and rounded on its own: 11001 - 5501 = 5500', () => {
    assert.deepEqual(only({ allocations: [], transactions: [entry('t1', 'ar', 5500, 'sales')] }), []);
    assert.equal(only({ allocations: [], transactions: [entry('t1', 'ar', 5501, 'sales')] }).length, 1);
  });

  test('with ledger rows, each row\'s baseClearedCents: 11001 - 2750 - 2750 = 5501', () => {
    const rows = [
      { id: 'r1', documentId: 'e1', documentType: 'invoice', kind: 'payment', amountCents: 2500, baseClearedCents: 2750 },
      { id: 'r2', documentId: 'e1', documentType: 'invoice', kind: 'payment', amountCents: 2500, baseClearedCents: 2750 },
    ];
    assert.deepEqual(only({ invoices: [{ ...eur[0], settledByRecordsCents: 5000 }], allocations: rows, transactions: [entry('t1', 'ar', 5501, 'sales')] }), []);
  });

  test('a cut collection the check does not read does not hide an A/R difference', () => {
    const cut = truncatedInputs({ bankLines: true, transactions: false });
    assert.deepEqual(cut, ['bankLines']);
    const found = check('control-balance').run(ctx({ transactions: [...transactions, entry('t6', 'ar', 1234)], truncated: cut }));
    assert.deepEqual(found.map(f => f.id), ['control-balance-ar']);
  });
});

describe('EG-10 third review round', () => {
  const inv = [{ id: 'm1', number: 'M-1', status: 'partially_paid', amountCents: 10000, amountPaidCents: 5000, settledByRecordsCents: 3000, currency: 'USD' }] as unknown as Invoice[];
  const row = [{ id: 'r1', documentId: 'm1', documentType: 'invoice', kind: 'payment', amountCents: 3000, baseClearedCents: 3000 }];
  const run = (rows: CheckContext['allocations'], arCents: number) => check('control-balance').run(ctx({ invoices: inv, bills: [], allocations: rows, transactions: [entry('t1', 'ar', arCents, 'sales')] }));

  test('the part paid with the document plus the rows: A/R $50.00, not $70.00', () => {
    assert.deepEqual(run(row, 5000), []);
    assert.match(run(row, 7000)[0].title, /\$70\.00, the open invoices add up to \$50\.00/);
  });

  test('the settlement check counts the part paid with the document: 2000 + 3000 = 5000, no false $20.00', () => {
    const settle = (rows: CheckContext['allocations']) => check('settlement-ledger').run(ctx({ invoices: inv, bills: [], allocations: rows }));
    assert.deepEqual(settle(row), []);
    const off = settle([{ ...row[0], amountCents: 2500 }]);
    assert.equal(off.length, 1);
    assert.match(off[0].description, /Difference \$5\.00/);
  });

  test('without rows the same $50.00', () => {
    assert.deepEqual(run([], 5000), []);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('EG-10 in the nightly check (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_eg10_${crypto.randomBytes(4).toString('hex')}`;
  let db: Firestore;

  before(async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'EG-10 Co', currency: 'USD', members: ['owner-1'] });
    await db.collection('invoices').doc(`${ws}_i3`).set({ workspaceId: ws, number: 'INV-3', status: 'partially_paid', amountCents: 80000, amountPaidCents: 30000, settledByRecordsCents: 30000, currency: 'USD' });
    await db.collection('paymentAllocations').doc(`payment-p1-p1-${ws}_i3`).set({ workspaceId: ws, documentId: `${ws}_i3`, documentType: 'invoice', kind: 'payment', amountCents: 20000 });
  });

  after(async () => {
    for (const table of ['paymentAllocations', 'invoices', 'notifications']) await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
    await db.collection('workspaces').doc(ws).delete();
  });

  test('the nightly check reads the payment ledger and finds INV-3', async () => {
    const { checkLedgerHealth } = await import('../server/services/ledgerHealthService');
    await checkLedgerHealth(db, ws, new Date('2026-10-23T02:00:00Z'));
    const health = (await db.collection('workspaces').doc(ws).get()).data()?.ledgerHealth as { counts: Record<string, number> };
    // INV-3's mismatch is the only medium finding (no accounts: no control-balance finding)
    assert.equal(health.counts.medium, 1);
  });
});
