/**
 * Agent #7 probe A7-08 (review-only): the daily recurring-entry job writes its entry itself
 * (recurringService.ts generateEntry, `tx.set(txRef, …)` at line 261) instead of going through the shared
 * validator. What does that cost?
 *
 * Books in USD.
 *  (a) control — a schedule as the Recurring screen saves it (home currency, no rate): 20.00 Supplies / Bank.
 *      Expected: one balanced entry.
 *  (b) a schedule whose template carries a rate: EUR at 1.5, lines 3.33 + 3.33 debit, 6.66 credit.
 *      The screen never sets a rate; the row is written the way a bookkeeper's browser session can write the
 *      `recurring` table. By hand, in USD: 3.33 × 1.5 = 4.995 → 5.00 (twice) = 10.00 debit; 6.66 × 1.5 = 9.99 credit.
 *      A correct writer settles the cent (settleHomeCurrency) so the entry balances in USD; this one does not.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DB_URL, openBooks, type Books } from './harness';

describe('A7-08 recurring-entry job', { skip: !DB_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  let b: Books;
  before(async () => { b = await openBooks('recur'); });
  after(async () => { await b.close(); await b.db.terminate(); });

  test('(a) control: the screen-shaped schedule posts one balanced entry', async () => {
    await b.db.collection('recurring').doc(`${b.ws}_plain`).set({ id: `${b.ws}_plain`, workspaceId: b.ws, uid: b.BOOKKEEPER, isActive: true, description: 'Monthly supplies', frequency: 'monthly', nextOccurrence: '2026-11-05', createdAt: '2026-10-01T00:00:00Z', amountCents: 2_000,
      template: { lines: [{ accountId: b.acct.supplies, amountCents: 2_000 }, { accountId: b.acct.bank, amountCents: -2_000 }] } } as never);
    const { processRecurring } = await import('../../../src/server/services/recurringService');
    const out = await processRecurring(b.db as never, '2026-11-05');
    const mine = out.details.filter(d => d.operationId.startsWith(b.ws));
    console.log(`(a) job: ${mine.map(d => `${d.operationId.split('_').pop()} ${d.status}`).join('; ')}`);
    assert.equal(mine.filter(d => d.status === 'success').length, 1);
    assert.deepEqual(await b.unbalanced(), []);
  });

  test('(b) a template with a rate: the browser can save it, the job posts it, and it does not balance in USD', async () => {
    const row = { id: `${b.ws}_fx`, workspaceId: b.ws, uid: b.BOOKKEEPER, isActive: true, description: 'EUR accrual', frequency: 'monthly', nextOccurrence: '2026-11-06', createdAt: '2026-10-02T00:00:00Z', amountCents: 666,
      template: { currency: 'EUR', exchangeRate: 1.5, lines: [{ accountId: b.acct.supplies, amountCents: 333 }, { accountId: b.acct.sales2, amountCents: 333 }, { accountId: b.acct.bank, amountCents: -666 }] } };
    const saved = await b.asBrowser(b.BOOKKEEPER, 'insert into recurring(id, data) values ($1, $2::jsonb)', [row.id, JSON.stringify(row)]);
    console.log(`(b) bookkeeper's browser saves the schedule: ${saved.ok ? 'accepted' : `refused (${saved.error})`}`);
    if (!saved.ok) await b.db.collection('recurring').doc(row.id).set(row as never);
    const { processRecurring } = await import('../../../src/server/services/recurringService');
    const out = await processRecurring(b.db as never, '2026-11-06');
    const mine = out.details.filter(d => d.operationId.startsWith(`${b.ws}_fx`));
    console.log(`(b) job: ${mine.map(d => `${d.status}${d.error ? `: ${d.error}` : ''}`).join('; ')}`);
    const off = await b.unbalanced();
    console.log(`(b) entries that do not balance: ${JSON.stringify(off.map(o => ({ own: o.own, home: o.home })))}`);
    const tb = await b.send(b.OWNER, 'GET', `/api/v1/reports/trial-balance?workspaceId=${b.ws}&endDate=2026-12-31`);
    console.log(`(b) trial balance route: total debits ${tb.body.totalDebit}, total credits ${tb.body.totalCredit}, isBalanced ${tb.body.isBalanced}`);
    const health = await b.dataHealth();
    console.log(`(b) Data Health findings: ${health.length ? health.map(f => `(${f.severity}) [${f.checkId}] ${f.title}`).join(' | ') : 'none'}`);
    assert.equal(saved.ok, true);
    assert.deepEqual(off.map(o => ({ own: o.own, home: o.home })), [{ own: 0, home: 1 }], 'DEFECT: posted 10.00 debit against 9.99 credit in USD');
    assert.equal(tb.body.isBalanced, false);
    console.log(JSON.stringify({ savedByBrowser: saved.ok, posted: mine.some(d => d.status === 'success'), unbalanced: off.length }));
  });
});
