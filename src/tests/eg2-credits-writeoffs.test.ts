/**
 * EG-2 step 2 (docs/design/EG-2-payment-ledger.md): credits applied, bad-debt write-offs and their reversal
 * write payment-ledger rows, and EG-10's settlement-ledger check agrees with the documents. Books in USD.
 *
 * Hand-worked figures (base = round(amount × minorUnitRate(rate)); receivable FX = settled − cleared,
 * payable FX = cleared − settled):
 * - A2 of the worked example: INV-1 €1,000.00 at 1.10, CN-1 €100.00 at 1.11 applied 10-20:
 *   `credit` 100.00, cleared 110.00, settled 111.00, FX +1.00.
 * - Yen: INV-J ¥10,000 at 0.0067, CN-J ¥3,333 at 0.0068 (minorUnitRate = rate × 100):
 *   cleared round(3333 × 0.67) = round(2233.11) = 22.33, settled round(3333 × 0.68) = round(2266.44) = 22.66, FX +0.33.
 * - Vendor: B-1 $100.00, VC-1 $40.00 applied 10-20: `credit` 40.00 on the payable side, 40.00 / 40.00, FX 0.
 * - Auto-apply (Beta): INV-A €150.00 at 1.10; CN-2 €100.00 at 1.10 (oldest) then CN-3 €100.00 at 1.12:
 *   CN-2 100.00 → cleared 110.00 settled 110.00 FX 0; CN-3 50.00 → cleared 55.00 settled 56.00 FX +1.00.
 *   Two rows (different sourceId), one operationId.
 * - Write-off: INV-W €300.00 at 1.10, €100.00 paid 10-15 at 1.10 (payment row 110.00), written off 10-25:
 *   `write_off` 200.00, cleared = settled = 220.00 (= the entry's 220.00), FX 0. Reversed 10-28: `reversal`
 *   −200.00 / −220.00 dated 10-28, the original marked reversedBy. Written off again 10-30: a new 200.00 row.
 *   Σ rows = 100.00 + 200.00 − 200.00 + 200.00 = 300.00 = amountPaidCents; Σ write-off rows = 200.00 (one write-off).
 * - credit-application-fx entries (control line +fx, FX line −fx, base currency, id `cafx-{rowId}`):
 *   A2: DR A/R 1.00 / CR Exchange gain 1.00. A/R for INV-1: DR 1,100.00 (issue) − CR 111.00 (CN-1 issued at 1.11)
 *   + DR 1.00 = 990.00 = (1,000.00 × 1.10) − cleared 110.00, so EG-10 control-balance has no finding; without the
 *   entry it reports a −1.00 difference. Yen: DR A/R 0.33 / CR gain 0.33; A/R INV-J: 67.00 − 22.66 + 0.33 = 44.67 =
 *   round(10,000 × 0.67) − 22.33. Auto-apply CN-3: DR A/R 1.00 / CR gain 1.00; CN-2 (same rate): no entry.
 * - Vendor FX (sign check): B-E €100.00 at 1.10, VC-E €100.00 at 1.11: payable FX = 110.00 − 111.00 = −1.00 (loss);
 *   entry CR A/P 1.00 / DR Exchange loss 1.00. A/P: CR 110.00 (bill) − DR 111.00 (credit) + CR 1.00 = 0.
 * - Period locks (review 4369192971): hard close through 2099-12-31 refuses applyCredit and autoApplyCredits for
 *   anyone; a soft close refuses the bookkeeper and lets the owner apply CN-4 $10.00 on INV-G.
 * - Bills dated by issueDate (review 4369192974): VC-2 $10.00 for v2; B-F has only issueDate 2099-01-01 (future),
 *   B-G issueDate 2026-10-01: auto-apply settles B-G $10.00 and leaves B-F (sorted first) untouched.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { baseFigures } from '../server/services/allocationLedger';
import { setCredit } from './helpers/creditFixtures';
import { DATA_CHECKS, type CheckContext } from '../lib/dataChecks';

test('base figures round as posting does (yen through minorUnitRate)', () => {
  assert.deepEqual(baseFigures('receivable', 10000, 'EUR', 'USD', 1.1, 1.11), { baseClearedCents: 11000, baseSettledCents: 11100, realizedFxCents: 100 });
  assert.deepEqual(baseFigures('receivable', 3333, 'JPY', 'USD', 0.0067, 0.0068), { baseClearedCents: 2233, baseSettledCents: 2266, realizedFxCents: 33 });
  assert.deepEqual(baseFigures('payable', 10000, 'EUR', 'USD', 1.1, 1.11), { baseClearedCents: 11000, baseSettledCents: 11100, realizedFxCents: -100 });
});

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_eg2s2_${crypto.randomBytes(4).toString('hex')}`;
  let db: import('../server/db/pgFirestore').Firestore;
  let credits: typeof import('../server/services/creditService');
  let badDebt: typeof import('../server/services/badDebtService');
  let payments: typeof import('../server/services/paymentService');
  let ledger: typeof import('../server/services/allocationLedger');
  const id = (s: string) => `${ws}_${s}`;
  const live = async (doc: string) => ledger.allocationsOf(db, null, ws, id(doc));
  const all = async (doc: string) => ledger.allocationsOf(db, null, ws, id(doc), { asOf: '2099-12-31' });
  const pick = (r: import('../server/services/allocationLedger').SettlementAllocation) => [r.kind, r.date, r.amountCents, r.documentRate, r.settlementRate, r.baseClearedCents, r.baseSettledCents, r.realizedFxCents];

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    credits = await import('../server/services/creditService');
    badDebt = await import('../server/services/badDebtService');
    payments = await import('../server/services/paymentService');
    ledger = await import('../server/services/allocationLedger');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'EG2 S2', currency: 'USD', members: ['owner-1'], timezone: 'UTC' });
    const account = (key: string, name: string, type: string, category = '') => db.collection('chartAccounts').doc(id(key)).set({ workspaceId: ws, uid: 'owner-1', name, type, category });
    await account('bank', 'Bank', 'asset', 'Cash');
    await account('ar', 'Accounts Receivable', 'asset', 'Receivables');
    await account('ap', 'Accounts Payable', 'liability', 'Payables');
    await account('fx', 'Exchange gain/loss', 'income', 'Rounding Differences');
    await account('bad', 'Bad Debt Expense', 'expense', 'Operating Expenses');
    const invoice = (key: string, customerId: string, currency: string, amountCents: number, rate: number) => db.collection('invoices').doc(id(key)).set({
      workspaceId: ws, uid: 'owner-1', customerId, customerName: customerId, number: key, date: '2026-10-01', dueDate: '2026-10-31',
      status: 'sent', currency, exchangeRate: rate, amountCents, amountPaidCents: 0, arAccountId: id('ar'),
    });
    const note = (key: string, customerId: string, currency: string, amountCents: number, rate: number, date: string) => setCredit(db, 'creditNotes', id(key), {
      workspaceId: ws, uid: 'owner-1', customerId, number: key, date, status: 'open', currency, exchangeRate: rate, amountCents, remainingCents: amountCents,
    });
    await invoice('INV-1', 'acme', 'EUR', 100000, 1.1);
    await invoice('INV-J', 'acme', 'JPY', 10000, 0.0067);
    await invoice('INV-W', 'acme', 'EUR', 30000, 1.1);
    await invoice('INV-A', 'beta', 'EUR', 15000, 1.1);
    await note('CN-1', 'acme', 'EUR', 10000, 1.11, '2026-10-20');
    await note('CN-J', 'acme', 'JPY', 3333, 0.0068, '2026-10-05');
    await note('CN-2', 'beta', 'EUR', 10000, 1.1, '2026-10-02');
    await note('CN-3', 'beta', 'EUR', 10000, 1.12, '2026-10-03');
    await db.collection('bills').doc(id('B-1')).set({ workspaceId: ws, uid: 'owner-1', vendorId: 'v1', vendorName: 'Supplier', number: 'B-1', date: '2026-10-01', status: 'unpaid', currency: 'USD', amountCents: 10000, amountPaidCents: 0, apAccountId: id('ap') });
    await setCredit(db, 'vendorCredits', id('VC-1'), { workspaceId: ws, uid: 'owner-1', vendorId: 'v1', number: 'VC-1', date: '2026-10-10', status: 'open', currency: 'USD', amountCents: 4000, remainingCents: 4000 });
  });
  after(async () => {
    for (const table of ['paymentAllocations', 'allocationOperations', 'idempotencyKeys', 'transactions', 'payments', 'invoices', 'bills', 'creditNotes', 'vendorCredits', 'chartAccounts', 'auditLogs', 'numberingSeries', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => undefined);
    }
    await db.terminate();
  });

  const fxEntries = async (allocation?: string) => (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.map(d => d.data())
    .filter(t => t.metadata?.type === 'credit-application-fx' && (!allocation || t.metadata.allocationId === allocation))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const fxOf = async (doc: string) => (await fxEntries()).filter(t => t.metadata.documentId === id(doc));
  const pairs = (t: Record<string, unknown>) => (t.lines as Array<{ accountId: string; amountCents: number }>).map(l => [l.accountId, l.amountCents]);

  const apply = (kind: 'customer' | 'vendor', credit: string, doc: string, amountCents: number, date?: string, operationId?: string) =>
    credits.applyCredit(db, { workspaceId: ws, uid: 'owner-1', kind, creditId: id(credit), documentId: id(doc), amountCents, date, operationId });

  test('A2: CN-1 €100 at 1.11 on INV-1 at 1.10 is a credit row, +1.00; a retry with the same key writes nothing', async () => {
    await apply('customer', 'CN-1', 'INV-1', 10000, '2026-10-20', 'op-cn1');
    const again = await apply('customer', 'CN-1', 'INV-1', 10000, '2026-10-20', 'op-cn1');
    assert.equal((again as { replayed?: boolean }).replayed, true);
    const rows = await live('INV-1');
    assert.deepEqual(rows.map(pick), [['credit', '2026-10-20', 10000, 1.1, 1.11, 11000, 11100, 100]]);
    assert.equal(rows[0].allocationId, `credit-op-cn1-${id('CN-1')}-${id('INV-1')}`);
    assert.equal(rows[0].transactionId, `cafx-${rows[0].allocationId}`);
    const fx = await fxEntries();
    assert.equal(fx.length, 1, 'the retry posted no second entry');
    assert.deepEqual(fx[0].lines.map((l: { accountId: string; amountCents: number }) => [l.accountId, l.amountCents]), [[id('ar'), 100], [id('fx'), -100]]);
    assert.deepEqual([fx[0].date, fx[0].currency, fx[0].totalAmountCents, fx[0].metadata.allocationId], ['2026-10-20', 'USD', 100, rows[0].allocationId]);
    const inv = (await db.collection('invoices').doc(id('INV-1')).get()).data()!;
    assert.equal(inv.amountPaidCents, 10000, 'the retry did not settle twice');
    await assert.rejects(apply('customer', 'CN-1', 'INV-1', 5000, '2026-10-20', 'op-cn1'), (e: Error & { status?: number }) => e.status === 409, 'same key, other request: refused');
  });

  test('an application dated before the credit is refused and writes nothing', async () => {
    await assert.rejects(apply('customer', 'CN-J', 'INV-J', 3333, '2026-10-04'), (e: Error & { status?: number }) => e.status === 409 && /credit's date/.test(e.message));
    assert.equal((await live('INV-J')).length, 0);
  });

  test('yen: ¥3,333 at 0.0068 on an invoice at 0.0067: 22.33 cleared, 22.66 settled, +0.33', async () => {
    await apply('customer', 'CN-J', 'INV-J', 3333, '2026-10-06');
    const rows = await live('INV-J');
    assert.deepEqual(rows.map(pick), [['credit', '2026-10-06', 3333, 0.0067, 0.0068, 2233, 2266, 33]]);
    const fx = await fxOf('INV-J');
    assert.deepEqual(fx.map(pairs), [[[id('ar'), 33], [id('fx'), -33]]]);
    assert.equal(rows[0].transactionId, fx[0].id);
  });

  test('vendor credit at another rate: a loss, CR A/P / DR exchange loss', async () => {
    await db.collection('bills').doc(id('B-E')).set({ workspaceId: ws, uid: 'owner-1', vendorId: 've', number: 'B-E', date: '2026-10-01', status: 'unpaid', currency: 'EUR', exchangeRate: 1.1, amountCents: 10000, amountPaidCents: 0, apAccountId: id('ap') });
    await setCredit(db, 'vendorCredits', id('VC-E'), { workspaceId: ws, uid: 'owner-1', vendorId: 've', number: 'VC-E', date: '2026-10-05', status: 'open', currency: 'EUR', exchangeRate: 1.11, amountCents: 10000, remainingCents: 10000 });
    await apply('vendor', 'VC-E', 'B-E', 10000, '2026-10-06');
    const rows = await live('B-E');
    assert.deepEqual(rows.map(r => r.realizedFxCents), [-100]);
    assert.deepEqual((await fxOf('B-E')).map(pairs), [[[id('ap'), -100], [id('fx'), 100]]]);
  });

  test('vendor credit on a bill: a payable credit row', async () => {
    await apply('vendor', 'VC-1', 'B-1', 4000, '2026-10-20');
    const rows = await live('B-1');
    assert.deepEqual(rows.map(pick), [['credit', '2026-10-20', 4000, 1, 1, 4000, 4000, 0]]);
    const raw = (await db.collection('paymentAllocations').doc(rows[0].allocationId).get()).data()!;
    assert.deepEqual([raw.side, raw.sourceType, raw.sourceId, raw.documentType], ['payable', 'vendorCredit', id('VC-1'), 'bill']);
  });

  test('auto-apply: two credits to one invoice are two rows of one operation', async () => {
    const result = await credits.autoApplyCredits(db, { workspaceId: ws, kind: 'customer', partyId: 'beta', uid: 'owner-1' });
    assert.equal(result.totalCents, 15000);
    const rows = await live('INV-A');
    assert.deepEqual(rows.map(r => [r.amountCents, r.settlementRate, r.baseClearedCents, r.baseSettledCents, r.realizedFxCents]).sort((a, b) => b[0] - a[0]), [
      [10000, 1.1, 11000, 11000, 0],
      [5000, 1.12, 5500, 5600, 100],
    ]);
    const raws = await Promise.all(rows.map(async r => (await db.collection('paymentAllocations').doc(r.allocationId).get()).data()!));
    assert.equal(new Set(raws.map(r => r.operationId)).size, 1);
    assert.deepEqual(new Set(raws.map(r => r.sourceId)), new Set([id('CN-2'), id('CN-3')]));
    const fx = await fxOf('INV-A');
    assert.deepEqual(fx.map(pairs), [[[id('ar'), 100], [id('fx'), -100]]], 'one entry, for CN-3 only');
    assert.equal(rows.find(r => r.settlementRate === 1.12)!.transactionId, fx[0].id);
    assert.equal(rows.find(r => r.settlementRate === 1.1)!.transactionId, null);
    assert.deepEqual(result.fxTransactionIds, [fx[0].id]);
  });

  test('write off, reverse, write off again: three rows plus the payment, Σ = one write-off', async () => {
    await payments.createPaymentAtomic(db, {
      workspaceId: ws, uid: 'owner-1', paymentDate: '2026-10-15', amountCents: 10000, cashAccountId: id('bank'), customerId: 'acme', entityName: 'acme',
      allocations: [{ documentId: id('INV-W'), documentType: 'invoice', amountCents: 10000 }],
    });
    const input = { workspaceId: ws, uid: 'owner-1', invoiceId: id('INV-W'), badDebtAccountId: id('bad') };
    const first = await badDebt.writeOffInvoice(db, { ...input, date: '2026-10-25' });
    assert.equal(first.baseCents, 22000);
    await badDebt.reverseWriteOff(db, { ...input, date: '2026-10-28' });
    const second = await badDebt.writeOffInvoice(db, { ...input, date: '2026-10-30' });
    const rows = await all('INV-W');
    assert.deepEqual(rows.map(pick), [
      ['payment', '2026-10-15', 10000, 1.1, 1.1, 11000, 11000, 0],
      ['write_off', '2026-10-25', 20000, 1.1, 1.1, 22000, 22000, 0],
      ['reversal', '2026-10-28', -20000, 1.1, 1.1, -22000, -22000, 0],
      ['write_off', '2026-10-30', 20000, 1.1, 1.1, 22000, 22000, 0],
    ]);
    const firstRow = rows[1];
    assert.equal(firstRow.allocationId, `write_off-${first.transactionId}-${first.transactionId}-${id('INV-W')}`);
    assert.equal(firstRow.reversed, true);
    const reversal = (await db.collection('paymentAllocations').doc(`reversal-${firstRow.allocationId}`).get()).data()!;
    assert.equal(reversal.reversesAllocationId, firstRow.allocationId);
    assert.equal(rows[3].transactionId, second.transactionId);
    assert.equal(rows.reduce((s, r) => s + r.amountCents, 0), 30000);
    assert.equal(rows.filter(r => r.kind !== 'payment').reduce((s, r) => s + r.amountCents, 0), 20000, 'one write-off');
    assert.deepEqual((await live('INV-W')).map(r => r.kind), ['payment', 'write_off']);
  });

  test('period locks: a hard close refuses everyone, a soft close the bookkeeper (manual and auto)', async () => {
    const wsRef = db.collection('workspaces').doc(ws);
    await db.collection('invoices').doc(id('INV-G')).set({ workspaceId: ws, uid: 'owner-1', customerId: 'gamma', number: 'INV-G', date: '2026-10-01', status: 'sent', currency: 'USD', amountCents: 5000, amountPaidCents: 0 });
    await setCredit(db, 'creditNotes', id('CN-4'), { workspaceId: ws, uid: 'owner-1', customerId: 'gamma', number: 'CN-4', date: '2026-10-01', status: 'open', currency: 'USD', amountCents: 1000, remainingCents: 1000 });
    const auto = (uid: string) => credits.autoApplyCredits(db, { workspaceId: ws, kind: 'customer', partyId: 'gamma', uid });
    const locked = (e: Error & { status?: number }) => e.status === 409 && /Period Locked/.test(e.message);
    await wsRef.update({ lockDate: '2099-12-31', roles: { 'bk-1': 'bookkeeper' } });
    await assert.rejects(apply('customer', 'CN-4', 'INV-G', 1000, '2026-10-20'), locked);
    await assert.rejects(auto('owner-1'), locked);
    await wsRef.update({ lockDate: null, softLockDate: '2099-12-31' });
    await assert.rejects(credits.applyCredit(db, { workspaceId: ws, uid: 'bk-1', kind: 'customer', creditId: id('CN-4'), documentId: id('INV-G'), amountCents: 1000, date: '2026-10-20' }), locked);
    await assert.rejects(auto('bk-1'), locked);
    assert.equal((await live('INV-G')).length, 0, 'nothing written while locked');
    await apply('customer', 'CN-4', 'INV-G', 1000, '2026-10-20');
    assert.equal((await live('INV-G')).length, 1, 'the owner may post in a soft-closed period');
    await wsRef.update({ softLockDate: null });
  });

  test('auto-apply dates a bill by issueDate when it has no date', async () => {
    const bill = (key: string, issueDate: string) => db.collection('bills').doc(id(key)).set({ workspaceId: ws, uid: 'owner-1', vendorId: 'v2', number: key, issueDate, status: 'unpaid', currency: 'USD', amountCents: 5000, amountPaidCents: 0 });
    await bill('B-F', '2099-01-01');
    await bill('B-G', '2026-10-01');
    await setCredit(db, 'vendorCredits', id('VC-2'), { workspaceId: ws, uid: 'owner-1', vendorId: 'v2', number: 'VC-2', date: '2026-10-01', status: 'open', currency: 'USD', amountCents: 1000, remainingCents: 1000 });
    const result = await credits.autoApplyCredits(db, { workspaceId: ws, kind: 'vendor', partyId: 'v2', uid: 'owner-1' });
    assert.deepEqual(result.applications.map(a => [a.documentId, a.amountCents]), [[id('B-G'), 1000]]);
    assert.equal((await live('B-F')).length, 0);
    assert.equal((await live('B-G')).length, 1);
  });

  test('EG-10 control-balance: A/R equals the open documents with the FX entries, not without', async () => {
    const load = async (c: string) => (await db.collection(c).where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }));
    const [allInvoices, allocations, accounts] = await Promise.all([load('invoices'), load('paymentAllocations'), load('chartAccounts')]);
    const docs = ['INV-1', 'INV-J'].map(k => id(k));
    const invoices = allInvoices.filter(d => docs.includes(d.id));
    // the issue entries the documents would have posted (seeded directly here): invoice DR A/R, credit note CR A/R, at their rates
    const issued = (key: string, cents: number) => ({ id: id(`issue-${key}`), workspaceId: ws, date: '2026-10-01', status: 'completed', type: 'actual', currency: 'USD', lines: [{ accountId: id('ar'), amountCents: cents }, { accountId: id('sales'), amountCents: -cents }] });
    const issues = [issued('INV-1', 110000), issued('CN-1', -11100), issued('INV-J', 6700), issued('CN-J', -2266)];
    const fx = [...await fxOf('INV-1'), ...await fxOf('INV-J')];
    assert.equal(fx.length, 2);
    const check = DATA_CHECKS.find(c => c.id === 'control-balance')!;
    const ctx = (transactions: unknown[]) => ({ invoices, bills: [], allocations: allocations.filter(r => docs.includes(String((r as { documentId?: string }).documentId))), accounts: accounts.filter(a => a.id === id('ar')), transactions, recurring: [], today: '2026-10-31', baseCurrency: 'USD' }) as unknown as CheckContext;
    assert.deepEqual(check.run(ctx([...issues, ...fx])), [], 'A/R 990.00 + 44.67 = the open documents');
    const without = check.run(ctx(issues));
    assert.deepEqual(without.map(f => f.id), ['control-balance-ar']);
    assert.match(without[0].description, /-\$1\.33|−\$1\.33|\$-1\.33|\(\$1\.33\)/);
  });

  test('EG-10 settlement-ledger agrees for every document; without the reversal row it would not', async () => {
    const load = async (c: string) => (await db.collection(c).where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }));
    const [invoices, bills, allocations] = await Promise.all([load('invoices'), load('bills'), load('paymentAllocations')]);
    const check = DATA_CHECKS.find(c => c.id === 'settlement-ledger')!;
    const ctx = (rows: unknown[]) => ({ invoices, bills, allocations: rows, accounts: [], transactions: [], recurring: [], today: '2026-10-31', baseCurrency: 'USD' }) as unknown as CheckContext;
    assert.deepEqual(check.run(ctx(allocations)), []);
    const withoutReversal = allocations.filter(r => (r as { kind?: string }).kind !== 'reversal');
    assert.deepEqual(check.run(ctx(withoutReversal)).map(f => f.id), [`settlement-ledger-invoice-${id('INV-W')}`]);
  });
});
