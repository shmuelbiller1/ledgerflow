/**
 * EG-2 step 4 (docs/design/EG-2-payment-ledger.md): voiding a payment on the server. Books in USD.
 *
 * Hand-worked figures (base = round(amount × rate); receivable FX = settled − cleared):
 * - The worked example: INV-1 €1,000.00 at 1.10 (A/R DR 1,100.00), CN-1 €100.00 at 1.11 applied 10-20
 *   (credit row cleared 110.00, settled 111.00; cafx entry DR A/R 1.00 / CR gain 1.00; the note's own issue entry,
 *   seeded here, CR A/R 111.00). PAY-1 €400.00 received 10-15 at 1.12:
 *     cleared 400.00 × 1.10 = 440.00, settled 400.00 × 1.12 = 448.00, FX +8.00;
 *     entry DR Bank 448.00 / CR A/R 440.00 / CR Exchange gain 8.00.
 *   Void on 10-25: reversing entry dated 10-25, DR A/R 440.00 / DR Exchange gain 8.00 / CR Bank 448.00 (the FX line
 *   reversed with it); a `reversal` row −400.00 / cleared −440.00 / settled −448.00 / FX −8.00 dated 10-25; the
 *   payment row marked reversedBy. INV-1: paid 500.00 − 400.00 = 100.00 (the credit), open €900.00, partially_paid.
 *   A/R = 1,100.00 − 111.00 + 1.00 − 440.00 + 440.00 = 990.00; open documents: 1,100.00 − cleared (110.00 + 440.00
 *   − 440.00) = 990.00, so EG-10 control-balance reports nothing. Bank 448.00 − 448.00 = 0; gain −8.00 + 8.00 = 0.
 * - An advance: INV-D $500.00; PAY-D $800.00 on 10-10 pays $200.00, $600.00 waits in Customer Deposits; $300.00
 *   applied 10-20 (DR Deposits 300.00 / CR A/R 300.00). Void dated 10-15: the posting reversed 10-15, the
 *   application entry reversed 10-20 (never before what it reverses); the payment row's reversal dated 10-15 and
 *   the advance_application row's 10-20. INV-D paid 500.00 − 500.00 = 0, `sent`. A/R: 500 − 200 − 300 + 200 + 300
 *   = 500.00 = due; Deposits: −600 + 300 + 600 − 300 = 0.
 * - A retry of either void: `replayed`, no new entry, no new row, the documents unchanged.
 * - Locks: lockDate 2026-10-31, void dated 10-25 → 409, nothing written; a deposited payment → 409.
 * Review fixes (PR #394):
 * - standalone-payment (the browser's postPaymentLedger): PAY-S $250.00 on INV-S $250.00, entry DR Bank 250.00 /
 *   CR A/R 250.00 seeded as that path writes it (no ledger rows). Void 10-25: one reversing entry DR A/R 250.00 /
 *   CR Bank 250.00; Bank and A/R net 0; INV-S 0 paid, `sent`. Before the fix: no entry, payment marked void anyway.
 * - Cancelled: INV-C $100.00 paid in full by PAY-C, then cancelled. Void: amountPaidCents 10000 → 0, settled 0,
 *   status stays `cancelled` (not re-issued as `sent`).
 * - 102 lines: INV-M $510.00 = 51 items of $10.00, each its own label (project P01…P51). PAY-M $510.00 spreads
 *   bank and A/R over the 51 labels: 51 × (DR Bank 10.00, CR A/R 10.00) = 102 lines. Reversal: chunk 1 = 50 label
 *   pairs = 100 lines, chunk 2 = 1 pair = 2 lines; each sums to 0; together Bank −510.00, A/R +510.00.
 *   balancedChunks unit case: 3 pairs of labels a, b, c with max 4 → [a, b] (4 lines), [c] (2).
 * The database part runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { DATA_CHECKS, type CheckContext } from '../lib/dataChecks';
import { setCredit } from './helpers/creditFixtures';
import { balancedChunks } from '../server/services/paymentVoidService';

test('balancedChunks: label pairs packed into balanced chunks of at most max lines', () => {
  const pair = (k: string, c: number) => [{ accountId: 'bank', amountCents: c, dimensions: { p: k } }, { accountId: 'ar', amountCents: -c, dimensions: { p: k } }];
  const lines = [...pair('a', 100), ...pair('b', 200), ...pair('c', 300)];
  const chunks = balancedChunks(lines, 4);
  assert.deepEqual(chunks.map(c => c.map(l => l.dimensions.p)), [['a', 'a', 'b', 'b'], ['c', 'c']]);
  assert.deepEqual(chunks.map(c => c.reduce((s, l) => s + l.amountCents, 0)), [0, 0]);
  assert.equal(balancedChunks(lines, 100).length, 1);
  assert.throws(() => balancedChunks([...pair('a', 1), ...pair('a', 2), ...pair('a', 3)], 4), /longer than 4/);
});

interface Entry {
  id: string; date?: string; kind?: string; documentId?: string; reversalEventId?: string;
  lines: Array<{ accountId: string; amountCents: number }>; metadata?: { reversesTxId?: string; documentId?: string; paymentId?: string };
}

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_eg2void_${crypto.randomBytes(4).toString('hex')}`;
  let db: import('../server/db/pgFirestore').Firestore;
  let svc: typeof import('../server/services/paymentService');
  let voids: typeof import('../server/services/paymentVoidService');
  let credits: typeof import('../server/services/creditService');
  let ledger: typeof import('../server/services/allocationLedger');
  const id = (s: string) => `${ws}_${s}`;
  const load = async (c: string) => (await db.collection(c).where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as Entry);
  const doc = async (c: string, key: string) => (await db.collection(c).doc(id(key)).get()).data()!;
  const all = async (key: string) => ledger.allocationsOf(db, null, ws, id(key), { asOf: '2099-12-31' });
  const pick = (r: import('../server/services/allocationLedger').SettlementAllocation) => [r.kind, r.date, r.amountCents, r.baseClearedCents, r.baseSettledCents, r.realizedFxCents, r.reversed];
  const balance = (txs: Array<{ lines?: Entry['lines'] }>, account: string) => txs.reduce((s, t) => s + (t.lines || []).filter(l => l.accountId === account).reduce((a, l) => a + l.amountCents, 0), 0);

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    svc = await import('../server/services/paymentService');
    voids = await import('../server/services/paymentVoidService');
    credits = await import('../server/services/creditService');
    ledger = await import('../server/services/allocationLedger');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'EG2 void', currency: 'USD', members: ['owner-1'], timezone: 'UTC' });
    const account = (key: string, name: string, type: string, category = '') => db.collection('chartAccounts').doc(id(key)).set({ workspaceId: ws, uid: 'owner-1', name, type, category });
    await account('bank', 'Bank', 'asset', 'Cash');
    await account('ar', 'Accounts Receivable', 'asset', 'Receivables');
    await account('dep', 'Customer Deposits', 'liability', 'Current Liabilities');
    await account('fx', 'Exchange gain/loss', 'income', 'Rounding Differences');
    await account('sales', 'Sales', 'income', 'Revenue');
    const invoice = (key: string, currency: string, amountCents: number, rate: number) => db.collection('invoices').doc(id(key)).set({
      workspaceId: ws, uid: 'owner-1', customerId: 'acme', customerName: 'Acme', number: key, date: '2026-10-01', dueDate: '2099-12-31',
      status: 'sent', currency, exchangeRate: rate, amountCents, amountPaidCents: 0, arAccountId: id('ar'),
    });
    await invoice('INV-1', 'EUR', 100000, 1.1);
    await invoice('INV-D', 'USD', 50000, 1);
    await setCredit(db, 'creditNotes', id('CN-1'), { workspaceId: ws, uid: 'owner-1', customerId: 'acme', number: 'CN-1', date: '2026-10-20', status: 'open', currency: 'EUR', exchangeRate: 1.11, amountCents: 10000, remainingCents: 10000 });
  });
  after(async () => {
    for (const table of ['paymentAllocations', 'allocationOperations', 'idempotencyKeys', 'transactions', 'payments', 'invoices', 'creditNotes', 'chartAccounts', 'auditLogs', 'numberingSeries', 'workspaceShards', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => undefined);
    }
    await db.terminate();
  });

  const receive = (date: string, currency: 'EUR' | 'USD', amountCents: number, rate: number | undefined, allocations: Array<[string, number]>) => ({
    workspaceId: ws, uid: 'owner-1', paymentDate: date, amountCents, cashAccountId: id('bank'), customerId: 'acme', entityName: 'Acme',
    ...(rate && currency !== 'USD' ? { paymentExchangeRate: rate } : {}),
    allocations: allocations.map(([key, cents]) => ({ documentId: id(key), documentType: 'invoice' as const, amountCents: cents })),
  });
  let pay1 = '';

  test('FX: voiding PAY-1 €400 at 1.12 reverses the entry with its FX line, reverses the row, reopens €900', async () => {
    await credits.applyCredit(db, { workspaceId: ws, uid: 'owner-1', kind: 'customer', creditId: id('CN-1'), documentId: id('INV-1'), amountCents: 10000, date: '2026-10-20', operationId: 'op-cn1' });
    const pay = await svc.createPaymentAtomic(db, receive('2026-10-15', 'EUR', 40000, 1.12, [['INV-1', 40000]]));
    pay1 = pay.paymentId;
    assert.deepEqual(pay.ledgerTransaction.lines.map((l: { accountId: string; amountCents: number }) => [l.accountId, l.amountCents]), [[id('bank'), 44800], [id('ar'), -44000], [id('fx'), -800]]);
    assert.equal((await doc('invoices', 'INV-1')).amountPaidCents, 50000);

    const result = await voids.voidPayment(db, { workspaceId: ws, uid: 'owner-1', paymentId: pay1, date: '2026-10-25', reason: 'bounced' });
    assert.equal(result.replayed, false);
    assert.equal(result.transactionIds.length, 1);
    const reversal = (await load('transactions')).find(t => t.id === result.transactionIds[0])!;
    assert.equal(reversal.date, '2026-10-25');
    assert.equal(reversal.metadata?.reversesTxId, pay.transactionId);
    assert.deepEqual(reversal.lines.map((l: { accountId: string; amountCents: number }) => [l.accountId, l.amountCents]), [[id('bank'), -44800], [id('ar'), 44000], [id('fx'), 800]]);
    assert.equal((await load('transactions')).find(t => t.id === pay.transactionId)!.reversalEventId, reversal.id);

    const rows = (await all('INV-1')).filter(r => r.kind !== 'credit');
    assert.deepEqual(rows.map(pick), [
      ['payment', '2026-10-15', 40000, 44000, 44800, 800, true],
      ['reversal', '2026-10-25', -40000, -44000, -44800, -800, false],
    ]);
    assert.equal(rows[1].transactionId, reversal.id);
    assert.deepEqual((await ledger.allocationsOf(db, null, ws, id('INV-1'))).map(r => r.kind), ['credit'], 'live: only the credit');

    const inv = await doc('invoices', 'INV-1');
    assert.deepEqual([inv.amountPaidCents, inv.settledByRecordsCents, inv.status], [10000, 10000, 'partially_paid'], 'open €900.00 again');
    const payment = (await db.collection('payments').doc(pay1).get()).data()!;
    assert.deepEqual([payment.status, payment.unappliedCents, payment.voidDate], ['void', 0, '2026-10-25']);
    const txs = await load('transactions');
    assert.equal(balance(txs, id('bank')), 0);
    assert.equal(balance(txs, id('fx')) + 100, 0, 'only the credit note FX (−1.00) is left on the gain account');
  });

  test('EG-10 control-balance: A/R equals the open documents after the void', async () => {
    const [invoices, allocations, accounts, txs] = await Promise.all([load('invoices'), load('paymentAllocations'), load('chartAccounts'), load('transactions')]);
    const inv1 = invoices.filter(d => d.id === id('INV-1'));
    const issue = (key: string, cents: number) => ({ id: id(`issue-${key}`), workspaceId: ws, date: '2026-10-01', status: 'completed', type: 'actual', currency: 'USD', lines: [{ accountId: id('ar'), amountCents: cents }, { accountId: id('sales'), amountCents: -cents }] });
    const transactions = [issue('INV-1', 110000), issue('CN-1', -11100), ...txs.filter(t => t.metadata?.documentId === id('INV-1') || t.metadata?.paymentId === pay1)];
    assert.equal(balance(transactions, id('ar')), 99000, 'A/R 990.00');
    const check = DATA_CHECKS.find(c => c.id === 'control-balance')!;
    const ctx = (rows: unknown[]) => ({ invoices: inv1, bills: [], allocations: rows, accounts: accounts.filter(a => a.id === id('ar')), transactions, recurring: [], today: '2026-10-31', baseCurrency: 'USD' }) as unknown as CheckContext;
    const inv1Rows = allocations.filter(r => r.documentId === id('INV-1'));
    assert.deepEqual(check.run(ctx(inv1Rows)), [], '990.00 = 1,100.00 − 110.00');
    // without the reversal row the open documents would read 440.00 lower: the check sees it
    assert.deepEqual(check.run(ctx(inv1Rows.filter(r => r.kind !== 'reversal'))).map(f => f.id), ['control-balance-ar']);
    const settlement = DATA_CHECKS.find(c => c.id === 'settlement-ledger')!;
    assert.deepEqual(settlement.run(ctx(inv1Rows)), []);
  });

  test('a retry posts nothing more', async () => {
    const before = [(await load('transactions')).length, (await load('paymentAllocations')).length];
    const again = await voids.voidPayment(db, { workspaceId: ws, uid: 'owner-1', paymentId: pay1, date: '2026-10-25' });
    assert.equal(again.replayed, true);
    assert.equal(again.transactionIds.length, 1);
    assert.deepEqual([(await load('transactions')).length, (await load('paymentAllocations')).length], before);
    assert.equal((await doc('invoices', 'INV-1')).amountPaidCents, 10000);
    // a payment that is void cannot be applied either
    await assert.rejects(svc.applyUnappliedPayment(db, { workspaceId: ws, uid: 'owner-1', paymentId: pay1, allocations: [{ documentId: id('INV-1'), documentType: 'invoice', amountCents: 1 }], date: '2026-10-26' }), /void/);
  });

  test('an advance: the application entry and row are reversed too, each never before what it reverses', async () => {
    const pay = await svc.createPaymentAtomic(db, receive('2026-10-10', 'USD', 80000, undefined, [['INV-D', 20000]]));
    const applied = await svc.applyUnappliedPayment(db, { workspaceId: ws, uid: 'owner-1', paymentId: pay.paymentId, allocations: [{ documentId: id('INV-D'), documentType: 'invoice', amountCents: 30000 }], date: '2026-10-20', operationId: 'op-d' });
    assert.ok(applied.transactionId);
    const result = await voids.voidPayment(db, { workspaceId: ws, uid: 'owner-1', paymentId: pay.paymentId, date: '2026-10-15' });
    const txs = await load('transactions');
    const reversals = result.transactionIds.map(t => txs.find(x => x.id === t)!);
    assert.deepEqual(reversals.map(r => [r.date, r.metadata?.reversesTxId]), [['2026-10-15', pay.transactionId], ['2026-10-20', applied.transactionId]]);
    assert.deepEqual((await all('INV-D')).map(pick), [
      ['payment', '2026-10-10', 20000, 20000, 20000, 0, true],
      ['reversal', '2026-10-15', -20000, -20000, -20000, 0, false],
      ['advance_application', '2026-10-20', 30000, 30000, 30000, 0, true],
      ['reversal', '2026-10-20', -30000, -30000, -30000, 0, false],
    ]);
    const inv = await doc('invoices', 'INV-D');
    assert.deepEqual([inv.amountPaidCents, inv.status], [0, 'sent']);
    assert.deepEqual(result.documents, [{ documentId: id('INV-D'), amountPaidCents: 0, status: 'sent' }]);
    const mine = txs.filter(t => t.metadata?.paymentId === pay.paymentId);
    assert.deepEqual([balance(mine, id('ar')), balance(mine, id('dep')), balance(mine, id('bank'))], [0, 0, 0]);
    const again = await voids.voidPayment(db, { workspaceId: ws, uid: 'owner-1', paymentId: pay.paymentId });
    assert.equal(again.replayed, true);
    assert.equal((await load('transactions')).length, txs.length);
  });

  test('a void dated in a locked period is refused and writes nothing; so is a deposited payment', async () => {
    await db.collection('invoices').doc(id('INV-L')).set({ workspaceId: ws, uid: 'owner-1', customerId: 'acme', number: 'INV-L', date: '2026-10-01', dueDate: '2099-12-31', status: 'sent', currency: 'USD', exchangeRate: 1, amountCents: 10000, amountPaidCents: 0, arAccountId: id('ar') });
    const pay = await svc.createPaymentAtomic(db, receive('2026-10-12', 'USD', 10000, undefined, [['INV-L', 10000]]));
    const wsRef = db.collection('workspaces').doc(ws);
    await wsRef.update({ lockDate: '2026-10-31' });
    const before = [(await load('transactions')).length, (await load('paymentAllocations')).length];
    try {
      await assert.rejects(voids.voidPayment(db, { workspaceId: ws, uid: 'owner-1', paymentId: pay.paymentId, date: '2026-10-25' }), (e: Error & { status?: number }) => e.status === 409);
    } finally {
      await wsRef.update({ lockDate: null });
    }
    assert.deepEqual([(await load('transactions')).length, (await load('paymentAllocations')).length], before);
    assert.equal((await db.collection('payments').doc(pay.paymentId).get()).data()!.status, 'posted');
    assert.equal((await doc('invoices', 'INV-L')).amountPaidCents, 10000);

    await db.collection('payments').doc(pay.paymentId).update({ depositTransactionId: 'dep-1' });
    await assert.rejects(voids.voidPayment(db, { workspaceId: ws, uid: 'owner-1', paymentId: pay.paymentId, date: '2026-11-02' }), (e: Error & { status?: number }) => e.status === 409 && /deposit/.test(e.message));
  });

  const usd = (key: string, amountCents: number, extra: Record<string, unknown> = {}) => db.collection('invoices').doc(id(key)).set({
    workspaceId: ws, uid: 'owner-1', customerId: 'acme', number: key, date: '2026-10-01', dueDate: '2099-12-31', status: 'sent',
    currency: 'USD', exchangeRate: 1, amountCents, amountPaidCents: 0, arAccountId: id('ar'), ...extra,
  });

  test('a standalone-payment posting (postPaymentLedger) is reversed too', async () => {
    await usd('INV-S', 25000, { amountPaidCents: 25000, settledByRecordsCents: 25000, status: 'paid' });
    await db.collection('payments').doc(id('PAY-S')).set({
      workspaceId: ws, uid: 'owner-1', number: 'PAY-S', direction: 'received', status: 'posted', date: '2026-10-12', amountCents: 25000, currency: 'USD',
      depositAccountId: id('bank'), unappliedCents: 0, allocations: [{ documentId: id('INV-S'), documentType: 'invoice', amountCents: 25000 }],
    });
    await db.collection('transactions').doc(id('tx-S')).set({
      workspaceId: ws, uid: 'owner-1', date: '2026-10-12', status: 'completed', type: 'actual', currency: 'USD', totalAmountCents: 25000,
      metadata: { paymentId: id('PAY-S'), direction: 'received', type: 'standalone-payment' },
      lines: [{ accountId: id('bank'), amountCents: 25000 }, { accountId: id('ar'), amountCents: -25000 }],
    });
    const result = await voids.voidPayment(db, { workspaceId: ws, uid: 'owner-1', paymentId: id('PAY-S'), date: '2026-10-25' });
    assert.equal(result.transactionIds.length, 1, 'the standalone posting was reversed');
    const txs = (await load('transactions')).filter(t => t.metadata?.paymentId === id('PAY-S'));
    const reversal = txs.find(t => t.id === result.transactionIds[0])!;
    assert.deepEqual([reversal.date, reversal.metadata?.reversesTxId], ['2026-10-25', id('tx-S')]);
    assert.deepEqual(reversal.lines.map(l => [l.accountId, l.amountCents]), [[id('bank'), -25000], [id('ar'), 25000]]);
    assert.deepEqual([balance(txs, id('bank')), balance(txs, id('ar'))], [0, 0]);
    const inv = await doc('invoices', 'INV-S');
    assert.deepEqual([inv.amountPaidCents, inv.status], [0, 'sent']);
  });

  test('a cancelled invoice keeps its status; only the settled amounts go', async () => {
    await usd('INV-C', 10000);
    const pay = await svc.createPaymentAtomic(db, receive('2026-10-12', 'USD', 10000, undefined, [['INV-C', 10000]]));
    await db.collection('invoices').doc(id('INV-C')).update({ status: 'cancelled' });
    const result = await voids.voidPayment(db, { workspaceId: ws, uid: 'owner-1', paymentId: pay.paymentId, date: '2026-10-25' });
    const inv = await doc('invoices', 'INV-C');
    assert.deepEqual([inv.amountPaidCents, inv.settledByRecordsCents, inv.status], [0, 0, 'cancelled']);
    assert.deepEqual(result.documents, [{ documentId: id('INV-C'), amountPaidCents: 0, status: 'cancelled' }]);
  });

  test('a 102-line payment entry is reversed in balanced chunks of at most 100 lines', async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ description: `item ${i + 1}`, amountCents: 1000, dimensions: { project: `P${String(i + 1).padStart(2, '0')}` } }));
    await usd('INV-M', 51000, { items });
    const pay = await svc.createPaymentAtomic(db, receive('2026-10-12', 'USD', 51000, undefined, [['INV-M', 51000]]));
    assert.equal(pay.ledgerTransaction.lines.length, 102);
    const result = await voids.voidPayment(db, { workspaceId: ws, uid: 'owner-1', paymentId: pay.paymentId, date: '2026-10-25' });
    const txs = await load('transactions');
    const chunks = result.transactionIds.map(t => txs.find(x => x.id === t)!);
    assert.deepEqual(chunks.map(c => c.lines.length), [100, 2]);
    for (const c of chunks) {
      assert.equal(c.lines.reduce((s, l) => s + l.amountCents, 0), 0, 'each chunk balances');
      assert.equal(c.metadata?.reversesTxId, pay.transactionId);
    }
    assert.deepEqual([balance(chunks, id('bank')), balance(chunks, id('ar'))], [-51000, 51000]);
    const mine = txs.filter(t => t.metadata?.paymentId === pay.paymentId);
    assert.deepEqual([balance(mine, id('bank')), balance(mine, id('ar'))], [0, 0]);
    assert.equal(txs.find(t => t.id === pay.transactionId)!.reversalEventId, chunks[0].id);
    assert.deepEqual((await doc('invoices', 'INV-M')).amountPaidCents, 0);
  });
});
