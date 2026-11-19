/**
 * The month-end revaluation against the books (R-07): what the service writes, and what it refuses
 * to write. It needs a real database, so it skips without LF_TEST_DATABASE_URL (`npm run db:test-setup`
 * makes one locally), like the reminder job and the statement batch tests. The rates are handed to the
 * service by the test — the exchange service is not under test here; what matters is the entry: that
 * the preview writes nothing, that the entry and its next-day reversal are posted together and close
 * to zero, that the same day is not done twice, and that a missing rate or a missing account stops it.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { addDaysYMD } from '../lib/fiscalCalendar';
import { dayBefore } from '../lib/periodLock';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;
/** the workspace's time zone is not set, which the service reads as UTC, so this is its "today" */
const today = new Date().toISOString().slice(0, 10);
const tomorrow = addDaysYMD(today, 1);
const previousMonthEnd = dayBefore(`${today.slice(0, 7)}-01`);
/** the documents existed before the past month-end the historical run looks at (#806) */
const issued = addDaysYMD(previousMonthEnd, -10);

describe('Month-end currency revaluation', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_fx_${crypto.randomBytes(4).toString('hex')}`;
  const nofx = `${ws}_nofx`;
  const id = (name: string) => `${ws}_${name}`;
  let db: Firestore;
  let revaluate: typeof import('../server/services/fxRevaluationService').revaluateForeignBalances;
  let undo: typeof import('../server/services/fxRevaluationService').undoRevaluation;
  let FxRevaluationError: typeof import('../server/services/fxRevaluationService').FxRevaluationError;
  const accounts: Record<string, string> = {};
  const owner = { uid: `${ws}_owner`, email: 'owner@fx.test' };
  const bookkeeper = { uid: `${ws}_book`, email: 'book@fx.test' };
  /** rates into USD, given by the test: both currencies moved up from what was booked */
  const rates = { EUR: 1.2, GBP: 1.5 };

  type Row = Record<string, unknown> & { id: string };
  const rows = async (workspaceId = ws): Promise<Row[]> => (await db.collection('transactions').where('workspaceId', '==', workspaceId).get())
    .docs.map(d => ({ id: d.id, ...(d.data() as object) }) as Row);
  const linesOf = (row: Row) => (row.lines as Array<{ accountId: string; amountCents: number }>);

  /** the status the service answers with, or null when it got through */
  async function failure(work: () => Promise<unknown>): Promise<{ status: number; message: string } | null> {
    try {
      await work();
      return null;
    } catch (err) {
      if (err instanceof FxRevaluationError) return { status: err.status, message: err.message };
      throw err;
    }
  }

  before(async () => {
    process.env.DATABASE_URL = url;
    ({ revaluateForeignBalances: revaluate, undoRevaluation: undo, FxRevaluationError } = await import('../server/services/fxRevaluationService'));
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: owner.uid, name: 'FX Co', currency: 'USD', roles: { [bookkeeper.uid]: 'bookkeeper' } });
    await db.collection('workspaces').doc(nofx).set({ uid: owner.uid, name: 'No FX Account Co', currency: 'USD' });
    await db.collection('customers').doc(id('c1')).set({ workspaceId: ws, name: 'Acme', email: 'ap@fx.test' });
    await db.collection('vendors').doc(id('v1')).set({ workspaceId: ws, name: 'Globex', email: 'ap@globex.test' });
    for (const [key, data] of Object.entries({
      ar: { name: 'Accounts Receivable', type: 'asset', category: 'Receivables' },
      ap: { name: 'Accounts Payable', type: 'liability', category: 'Payables' },
      fx: { name: 'Unrealized FX Gain/Loss', type: 'income', category: 'Revenue' },
    })) {
      const ref = db.collection('chartAccounts').doc(id(key));
      accounts[key] = ref.id;
      await ref.set({ workspaceId: ws, ...data });
    }
    const invoice = (name: string, fields: Record<string, unknown> = {}) => db.collection('invoices').doc(id(name)).set({
      workspaceId: ws, customerId: id('c1'), customerName: 'Acme', number: name.toUpperCase(), status: 'sent',
      currency: 'EUR', exchangeRate: 1.08, amountCents: 100000, date: issued, dueDate: tomorrow, ...fields,
    });
    await invoice('full');
    await invoice('half', { amountPaidCents: 50000 });
    await invoice('paid', { status: 'paid', amountPaidCents: 100000 });
    await invoice('draft', { status: 'draft' });
    await invoice('home', { currency: 'USD', exchangeRate: 1 });
    await invoice('norat', { exchangeRate: undefined });
    await db.collection('bills').doc(id('bill')).set({
      workspaceId: ws, vendorId: id('v1'), vendorName: 'Globex', number: 'BILL-1', status: 'pending',
      currency: 'GBP', exchangeRate: 1.1, amountCents: 50000, date: issued, dueDate: tomorrow,
    });
  });

  after(async () => {
    for (const table of ['transactions', 'invoices', 'bills', 'payments', 'paymentAllocations', 'chartAccounts', 'customers', 'vendors', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1) or data->>'workspaceId' = any($1)`, [[ws, nofx, id('c1'), id('v1'), ...Object.values(accounts)]]);
    }
    await db.terminate();
  });

  test('the preview says what would move, and writes nothing', async () => {
    const plan = await revaluate(db, { workspaceId: ws, user: owner, rates, dryRun: true });
    assert.equal(plan.posted, false);
    assert.equal((await rows()).length, 0, 'looking posts nothing');
    assert.equal(plan.documentCount, 3, 'the two open invoices and the bill');
    assert.deepEqual(plan.currencies, ['EUR', 'GBP']);
    // the draft, the paid one and the one with no rate are said; the USD invoice is not even mentioned
    assert.deepEqual(plan.skipped.map(x => x.number).sort(), ['DRAFT', 'NORAT', 'PAID']);
    assert.equal(plan.lines.length, 3, 'A/R, A/P and the gain/loss line');
    assert.equal(plan.lines.reduce((sum, l) => sum + l.amountCents, 0), 0, 'the entry closes to zero');
    assert.ok(plan.skipped.some(s => s.reason.includes('no exchange rate')), 'a document with no rate is said out loud');
    assert.ok(plan.skipped.some(s => s.reason.includes('nothing is owed')), 'and so is the paid one');
  });

  test('running posts the entry and the one that reverses it tomorrow', async () => {
    const run = await revaluate(db, { workspaceId: ws, user: owner, rates });
    assert.equal(run.posted, true);
    const posted = await rows();
    assert.equal(posted.length, 2, 'both entries are there, in one go');
    const entry = posted.find(r => r.date === today);
    const reversal = posted.find(r => r.date === tomorrow);
    assert.ok(entry && reversal, 'one dated today, one dated the day after');
    assert.deepEqual(linesOf(reversal!).map(l => -l.amountCents), linesOf(entry!).map(l => l.amountCents), 'the reversal is exactly the other way round');
    assert.equal(((entry!.metadata as Record<string, unknown>).reversalTransactionId as string), reversal!.id, 'the entry points at the entry that will reverse it');
    assert.equal(entry!.reversalEventId, undefined, 'and it is not marked as reversed: tomorrow has not come yet');
    assert.equal((entry!.metadata as Record<string, unknown>).type, 'fx-revaluation');
    assert.equal((reversal!.metadata as Record<string, unknown>).type, 'fx-revaluation-reversal');
    assert.equal((entry!.currency as string), 'USD');
    assert.equal((entry!.exchangeRate as number), 1, 'the lines are already in the workspace currency, so the entry converts nothing');

    // 1,500.00 EUR still open (1,000.00 + 500.00) booked at 1.08, 500.00 GBP booked at 1.10
    const expectedAr = Math.round(150000 * rates.EUR) - Math.round(150000 * 1.08);
    const expectedAp = Math.round(50000 * rates.GBP) - Math.round(50000 * 1.1);
    assert.equal(linesOf(entry!).find(l => l.accountId === accounts.ar)?.amountCents, expectedAr);
    assert.equal(linesOf(entry!).find(l => l.accountId === accounts.ap)?.amountCents, -expectedAp, 'a payable that grew is credited');
    assert.equal(linesOf(entry!).find(l => l.accountId === accounts.fx)?.amountCents, -(expectedAr - expectedAp));
    assert.equal((entry!.totalAmountCents as number), expectedAr + Math.max(0, expectedAp - expectedAr), 'the validator took the debit side of the entry, in whole cents');
  });

  test('the same day is not revalued twice', async () => {
    const first = (await rows()).length;
    const again = await failure(() => revaluate(db, { workspaceId: ws, user: owner, rates }));
    assert.equal(again?.status, 409);
    assert.match(String(again?.message), /already in the books/);
    assert.equal((await rows()).length, first, 'and nothing was added');
  });

  test('undoing it posts the early reversal, and there is nothing to undo twice', async () => {
    const before0 = await rows();
    const undone = await undo(db, { workspaceId: ws, user: owner, date: today });
    const after0 = await rows();
    assert.equal(after0.length, before0.length + 1, 'one more entry: the reversal, dated today');
    const original = before0.find(r => r.id === undone.reversesTxId);
    const originalAfter = after0.find(r => r.id === undone.reversesTxId);
    const early = after0.find(r => r.id === undone.transactionId);
    assert.ok(original && originalAfter && early);
    assert.equal(early!.date, today);
    assert.deepEqual(linesOf(early!).map(l => l.amountCents), linesOf(original!).map(l => -l.amountCents), 'the same lines, the other way');
    const scheduledId = (original!.metadata as Record<string, unknown>).reversalTransactionId as string;
    const scheduledBefore = before0.find(r => r.id === scheduledId);
    const scheduledAfter = after0.find(r => r.id === scheduledId);
    assert.equal(scheduledBefore?.status, 'completed', 'the scheduled reversal was active before Undo');
    assert.equal(scheduledAfter?.status, 'void', 'freshly read after Undo, the next-day entry is no longer postable');
    assert.equal(original!.reversalEventId, undefined, 'the before snapshot has not been mutated');
    assert.equal(originalAfter!.reversalEventId, undone.transactionId, 'the entry now reads as reversed');
    const twice = await failure(() => undo(db, { workspaceId: ws, user: owner, date: today }));
    assert.match(String(twice?.message), /already reversed/, 'there is nothing to undo a second time');
  });

  test('a currency with no rate stops the whole run', async (t) => {
    // the exchange service is down (CI has internet, so it would otherwise answer)
    const { FxService } = await import('../server/services/FxService');
    t.mock.method(FxService, 'getRate', async () => { throw new Error('exchange service unavailable'); });
    const before1 = (await rows()).length;
    const onlyEur = await failure(() => revaluate(db, { workspaceId: ws, user: owner, rates: { EUR: 1.2 } }));
    assert.equal(onlyEur?.status, 503);
    assert.match(String(onlyEur?.message), /GBP rate is not available/);
    assert.equal((await rows()).length, before1, 'nothing half-done was posted');
  });

  test('who may do it, what has to exist, and what a still day means', async () => {
    const forbidden = await failure(() => revaluate(db, { workspaceId: ws, user: bookkeeper, rates }));
    assert.equal(forbidden?.status, 403);
    assert.match(String(forbidden?.message), /owners and accountants/i);
    const missing = await failure(() => revaluate(db, { workspaceId: nofx, user: owner, rates }));
    assert.equal(missing?.status, 400);
    assert.match(String(missing?.message), /Unrealized FX Gain\/Loss/, 'it names the account to add rather than making one up');
    const still = await revaluate(db, { workspaceId: ws, user: owner, rates: { EUR: 1.08, GBP: 1.1 } });
    assert.equal(still.posted, false, 'a day when nothing moved posts nothing, and is not an error');
    assert.match(still.summary, /already stands at today's rate/);
  });

  test('a past month-end previews missing rates, requires typed rates to post, and dates the pair correctly', async () => {
    const date = previousMonthEnd;
    const historicalRows = async () => (await rows()).filter(r => (r.metadata as Record<string, unknown> | undefined)?.revaluationDate === date);
    const missingPreview = await revaluate(db, { workspaceId: ws, user: owner, date, dryRun: true });
    assert.equal(missingPreview.posted, false);
    assert.deepEqual(missingPreview.unpriced, ['EUR', 'GBP'], 'the preview names every foreign currency needing a historical rate');
    assert.match(missingPreview.summary, new RegExp(`Type the EUR and GBP rates for ${date}`));
    assert.equal((await historicalRows()).length, 0, 'the rate request posted nothing');

    const missingRun = await failure(() => revaluate(db, { workspaceId: ws, user: owner, date, rates: { EUR: rates.EUR } }));
    assert.equal(missingRun?.status, 400);
    assert.match(String(missingRun?.message), /Enter the GBP rate/);
    assert.equal((await historicalRows()).length, 0, 'a missing rate cannot post a partial revaluation');

    const posted = await revaluate(db, { workspaceId: ws, user: owner, date, rates });
    assert.equal(posted.posted, true);
    assert.equal(posted.date, date);
    assert.equal(posted.reversalDate, addDaysYMD(date, 1));
    assert.equal((await historicalRows()).length, 2, 'both dated entries are posted together');

    const notMonthEnd = await failure(() => revaluate(db, { workspaceId: ws, user: owner, rates, date: dayBefore(date) }));
    assert.equal(notMonthEnd?.status, 400);
    assert.match(String(notMonthEnd?.message), /last day of a month/);
    const malformed = await failure(() => revaluate(db, { workspaceId: ws, user: owner, rates, date: '2026-02-30' }));
    assert.equal(malformed?.status, 400);
    assert.match(String(malformed?.message), /real calendar date/);
    const future = await failure(() => revaluate(db, { workspaceId: ws, user: owner, rates, date: addDaysYMD(today, 1) }));
    assert.equal(future?.status, 400);
    assert.match(String(future?.message), /cannot be after/);
  });

  test('a past date counts only what existed then, and refuses when a payment came after it (#806)', async () => {
    const date = previousMonthEnd;
    await undo(db, { workspaceId: ws, user: owner, date }); // the test above posted this date
    // issued after the month-end: not part of that day's books
    await db.collection('invoices').doc(id('later')).set({ workspaceId: ws, customerId: id('c1'), customerName: 'Acme', number: 'LATER', status: 'sent',
      currency: 'EUR', exchangeRate: 1, amountCents: 999900, date: addDaysYMD(date, 1), dueDate: tomorrow });
    const withLater = await revaluate(db, { workspaceId: ws, user: owner, date, rates, dryRun: true });
    const withoutLater = await (async () => { await db.collection('invoices').doc(id('later')).delete(); return revaluate(db, { workspaceId: ws, user: owner, date, rates, dryRun: true }); })();
    assert.equal(withLater.summary, withoutLater.summary, 'an invoice issued after the date changes nothing');

    // a payment on the cutoff day is that day's; one after it makes the day's open amounts unknowable
    await db.collection('payments').doc(id('p-on')).set({ workspaceId: ws, direction: 'received', contactId: id('c1'), date, amountCents: 100, status: 'posted',
      allocations: [{ documentId: id('half'), documentType: 'invoice', amountCents: 100 }] });
    assert.equal(await failure(() => revaluate(db, { workspaceId: ws, user: owner, date, rates, dryRun: true })), null);
    await db.collection('payments').doc(id('p-after')).set({ workspaceId: ws, direction: 'received', contactId: id('c1'), date: addDaysYMD(date, 1), amountCents: 100, status: 'posted',
      allocations: [{ documentId: id('half'), documentType: 'invoice', amountCents: 100 }] });
    for (const dryRun of [true, false]) {
      const refused = await failure(() => revaluate(db, { workspaceId: ws, user: owner, date, rates, dryRun }));
      assert.equal(refused?.status, 409);
      assert.match(String(refused?.message), /paid, credited or written off after/);
    }
    // a void payment is not a settlement
    await db.collection('payments').doc(id('p-after')).set({ status: 'void' }, { merge: true });
    assert.equal(await failure(() => revaluate(db, { workspaceId: ws, user: owner, date, rates, dryRun: true })), null);

    // a credit applied after the date settles too (allocation ledger), unless it was reversed; so does a later write-off
    await db.collection('paymentAllocations').doc(id('alloc')).set({ workspaceId: ws, kind: 'credit', documentId: id('full'), amountCents: 500, date: addDaysYMD(date, 2) });
    assert.match(String((await failure(() => revaluate(db, { workspaceId: ws, user: owner, date, rates, dryRun: true })))?.message), /credited or written off/);
    await db.collection('paymentAllocations').doc(id('alloc')).set({ reversedBy: 'r1' }, { merge: true });
    assert.equal(await failure(() => revaluate(db, { workspaceId: ws, user: owner, date, rates, dryRun: true })), null);
    await db.collection('invoices').doc(id('full')).set({ writtenOffAt: addDaysYMD(date, 3) }, { merge: true });
    assert.equal((await failure(() => revaluate(db, { workspaceId: ws, user: owner, date, rates, dryRun: true })))?.status, 409);
    await db.collection('invoices').doc(id('full')).set({ writtenOffAt: null }, { merge: true });
  });
});
