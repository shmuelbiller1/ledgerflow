/**
 * Agent #7 probe A7-03 (review-only): a foreign-currency invoice paid in instalments.
 *
 * Books in USD. Invoice INV-FX-1 for 100.00 EUR at 1.0842 (no tax). By hand:
 *   receivable booked      100.00 x 1.0842 = 108.42
 *   payment 1   33.33 EUR  33.33 x 1.0842 = 36.136386 -> 36.14
 *   payment 2   33.33 EUR                              -> 36.14
 *   payment 3   33.34 EUR  33.34 x 1.0842 = 36.147228 -> 36.15
 *   cleared from the receivable             36.14 + 36.14 + 36.15 = 108.43
 * The invoice is then fully paid in EUR (33.33 + 33.33 + 33.34 = 100.00) at the SAME rate it was booked at, so nothing
 * is owed and there is no exchange difference. A correct ledger shows the receivable at 0.00.
 *
 * Every step goes through the app's own routes (POST /documents/invoices/:id/post, POST /payments) on the test database.
 * The test asserts what the system does TODAY; the line marked DEFECT is the one that should become 0.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DB_URL, money, named, openBooks, type Books } from './harness';

describe('A7-03 foreign invoice paid in instalments', { skip: !DB_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  let b: Books;
  before(async () => { b = await openBooks('fxinst'); });
  after(async () => { await b.close(); await b.db.terminate(); });

  test('100.00 EUR at 1.0842 paid as 33.33 + 33.33 + 33.34 at the same rate', async () => {
    const id = `${b.ws}_invfx1`;
    await b.db.collection('customers').doc(`${b.ws}_c1`).set({ id: `${b.ws}_c1`, workspaceId: b.ws, name: 'Euro Customer' } as never);
    const data = { id, workspaceId: b.ws, number: 'INV-FX-1', customerName: 'Euro Customer', customerId: `${b.ws}_c1`, date: '2026-07-01', dueDate: '2026-07-31', status: 'sent',
      currency: 'EUR', exchangeRate: 1.0842, amountCents: 10_000, items: [{ id: 'l1', description: 'Consulting', quantity: 1, rateCents: 10_000, amountCents: 10_000 }] };
    const posted = await b.send(b.OWNER, 'POST', `/api/v1/documents/invoices/${id}/post`, { workspaceId: b.ws, action: 'create', data }, { 'idempotency-key': 'a7-03-inv' });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.deepEqual(named(b, await b.balances()), { ar: 10_842, sales: -10_842 }, 'the receivable is booked at 108.42');

    for (const [n, cents] of [[1, 3_333], [2, 3_333], [3, 3_334]] as const) {
      const paid = await b.send(b.OWNER, 'POST', '/api/v1/payments', {
        workspaceId: b.ws, amountCents: cents, paymentDate: `2026-07-1${n}`, cashAccountId: b.acct.bank, customerId: `${b.ws}_c1`,
        allocations: [{ documentId: id, documentType: 'invoice', amountCents: cents }],
      }, { 'x-operation-id': `a7-03-pay-${n}` });
      assert.equal(paid.status, 200, JSON.stringify(paid.body));
    }

    const invoice = (await b.db.collection('invoices').doc(id).get()).data()!;
    const balances = named(b, await b.balances());
    console.log(`invoice status: ${invoice.status}; paid ${money(invoice.amountPaidCents)} EUR of ${money(invoice.amountCents)} EUR`);
    console.log(`ledger (home currency): ${JSON.stringify(balances)}`);
    assert.equal(invoice.status, 'paid');
    assert.equal(invoice.amountPaidCents, 10_000, 'paid in full in its own currency');
    assert.deepEqual(await b.unbalanced(), [], 'every entry balances');
    assert.equal(balances.bank, 10_843, 'the bank received 36.14 + 36.14 + 36.15 = 108.43');

    // the app's own reports
    const aging = await b.send(b.OWNER, 'GET', `/api/v1/reports/aging?workspaceId=${b.ws}&type=ar&asOfDate=2026-12-31`);
    const tb = await b.send(b.OWNER, 'GET', `/api/v1/reports/trial-balance?workspaceId=${b.ws}&endDate=2026-12-31`);
    const arRow = (tb.body.accounts as Array<{ id: string; netSigned: number }>).find(a => a.id === b.acct.ar)!;
    console.log(`A/R ageing report (${aging.status}): ${JSON.stringify(aging.body).slice(0, 300)}`);
    console.log(`trial balance route, Accounts Receivable: ${money(arRow.netSigned)}`);

    // DEFECT: nothing is owed, yet the receivable account keeps -0.01 for ever (no exchange difference was booked:
    // the payments used the invoice's own rate). Expected 0.
    console.log(`DEFECT A7-03: Accounts Receivable after a fully paid invoice = ${money(balances.ar ?? 0)} (expected 0.00)`);
    assert.equal(balances.ar, -1);
    assert.equal(arRow.netSigned, -1);

    // the app's own Data Health check (EG-10 "control-balance") sees the same thing and has nothing to offer for it:
    // its remedy is "look for entries posted by hand, or documents whose posting is missing" — neither is the case
    const health = (await b.dataHealth()).filter(f => f.checkId === 'control-balance');
    for (const f of health) console.log(`Data Health (${f.severity}): ${f.title}`);
    assert.equal(health.length, 1);
    assert.match(health[0].title, /Accounts receivable is .*0\.01.* the open invoices add up to .*0\.00/);
  });
});
