/**
 * Agent #7 probe A7-06 (review-only): a credit note written from the browser is honoured by the server.
 *
 * Context: audit/claude-2026-11-11 C-1 found that a signed-in writer's browser can write ledger tables directly; its fix
 * list (and PR #640's migration) covers transactions, journalEntries, payments, reconciliations and the paid fields of
 * invoices and bills. `creditNotes` and `vendorCredits` stay writable by the browser (a7-06-residual-browser-writes.sql
 * shows that on `main` and with PR #640's migration applied). This probe shows why that matters: the SERVER's own
 * credit routes trust the stored credit.
 *
 * Books in USD. By hand:
 *   invoice INV-1 to Acme, 500.00                              -> A/R +500.00, Sales -500.00
 *   a bookkeeper's browser inserts credit note CN-X, 500.00 "open", never issued: no entry is posted
 *   POST /payments/credits/apply  CN-X -> INV-1, 500.00        -> the server marks INV-1 paid; no entry is posted
 *       correct books would still show A/R 500.00 owed by Acme; the documents now say nothing is owed
 *   a second forged credit CN-Y, 300.00; POST /payments/credits/refund from the bank
 *       -> the server posts A/R +300.00, Bank -300.00: money paid out for a credit that was never given
 *
 * The browser step uses the same technique as supabase/tests/rls.test.sql (the `authenticated` role with the user's
 * claims); everything else goes through the app's real routes. The test asserts what happens TODAY.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DB_URL, named, openBooks, type Books } from './harness';

describe('A7-06 a credit note forged from the browser is applied and refunded by the server', { skip: !DB_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  let b: Books;
  const inv = () => `${b.ws}_inv1`;
  before(async () => { b = await openBooks('forgedcn'); });
  after(async () => { await b.close(); await b.db.terminate(); });

  test('setup: invoice 500.00 issued through the server', async () => {
    await b.db.collection('customers').doc(`${b.ws}_c1`).set({ id: `${b.ws}_c1`, workspaceId: b.ws, name: 'Acme' } as never);
    const data = { id: inv(), workspaceId: b.ws, number: 'INV-1', customerName: 'Acme', customerId: `${b.ws}_c1`, date: '2026-08-03', dueDate: '2026-09-02', status: 'sent', currency: 'USD',
      amountCents: 50_000, items: [{ id: 'l1', description: 'Work', quantity: 1, rateCents: 50_000, amountCents: 50_000 }] };
    const posted = await b.send(b.OWNER, 'POST', `/api/v1/documents/invoices/${inv()}/post`, { workspaceId: b.ws, action: 'create', data }, { 'idempotency-key': 'a7-06-inv' });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.deepEqual(named(b, await b.balances()), { ar: 50_000, sales: -50_000 });
  });

  test('the bookkeeper\'s browser inserts an open credit note of 500.00; the server applies it and the invoice is "paid"', async () => {
    const forged = { workspaceId: b.ws, number: 'CN-X', customerId: `${b.ws}_c1`, customerName: 'Acme', status: 'open', date: '2026-08-04', amountCents: 50_000, remainingCents: 50_000, currency: 'USD' };
    const write = await b.asBrowser(b.BOOKKEEPER, `insert into "creditNotes"(id, data) values ($1, $2::jsonb)`, [`${b.ws}_cnx`, JSON.stringify(forged)]);
    console.log(`browser insert into creditNotes: ${write.ok ? 'ACCEPTED' : `refused: ${write.error}`}`);
    assert.equal(write.ok, true);

    const applied = await b.send(b.BOOKKEEPER, 'POST', '/api/v1/payments/credits/apply', { workspaceId: b.ws, kind: 'customer', creditId: `${b.ws}_cnx`, documentId: inv(), amountCents: 50_000, date: '2026-08-05' });
    console.log(`POST /payments/credits/apply -> ${applied.status} ${JSON.stringify(applied.body).slice(0, 160)}`);
    assert.equal(applied.status, 200);

    const invoice = (await b.db.collection('invoices').doc(inv()).get()).data()!;
    const balances = named(b, await b.balances());
    const aging = await b.send(b.OWNER, 'GET', `/api/v1/reports/aging?workspaceId=${b.ws}&type=ar&asOfDate=2026-12-31`);
    console.log(`invoice INV-1: status ${invoice.status}, paid ${invoice.amountPaidCents} of ${invoice.amountCents}`);
    console.log(`A/R ageing report total: ${aging.body.total}; ledger: ${JSON.stringify(balances)}`);
    // DEFECT: the customer owes 500.00 in the ledger; the invoice is paid and the ageing shows nothing owed. No cash, no
    // credit entry: the receivable has simply stopped being collected.
    console.log('DEFECT A7-06a: invoice "paid" by a credit that was never issued; ledger A/R still 500.00, ageing 0.00');
    assert.equal(invoice.status, 'paid');
    assert.equal(aging.body.total, 0);
    assert.deepEqual(balances, { ar: 50_000, sales: -50_000 });
  });

  test('a second forged credit of 300.00 is refunded from the bank by the server: Bank -300.00', async () => {
    const forged = { workspaceId: b.ws, number: 'CN-Y', customerId: `${b.ws}_c1`, customerName: 'Acme', status: 'open', date: '2026-08-06', amountCents: 30_000, remainingCents: 30_000, currency: 'USD' };
    const write = await b.asBrowser(b.BOOKKEEPER, `insert into "creditNotes"(id, data) values ($1, $2::jsonb)`, [`${b.ws}_cny`, JSON.stringify(forged)]);
    assert.equal(write.ok, true, write.error);
    const refund = await b.send(b.BOOKKEEPER, 'POST', '/api/v1/payments/credits/refund', { workspaceId: b.ws, kind: 'customer', creditId: `${b.ws}_cny`, amountCents: 30_000, cashAccountId: b.acct.bank, date: '2026-08-07' });
    console.log(`POST /payments/credits/refund -> ${refund.status} ${JSON.stringify(refund.body).slice(0, 160)}`);
    assert.equal(refund.status, 200);
    const balances = named(b, await b.balances());
    console.log(`ledger: ${JSON.stringify(balances)}`);
    // DEFECT: the server posted a payout of 300.00 for a credit that has no issuance entry behind it
    console.log('DEFECT A7-06b: the bank is credited 300.00 (a refund) against a credit note that was never issued');
    assert.equal(balances.bank, -30_000);
    assert.equal(balances.ar, 80_000);
    assert.deepEqual(await b.unbalanced(), [], 'each entry balances: the books look tidy');
  });

  test('what the app\'s own Data Health checks say afterwards', async () => {
    const health = await b.dataHealth();
    for (const f of health) console.log(`Data Health (${f.severity}) [${f.checkId}]: ${f.title}`);
    // the difference between the ledger and the open invoices is noticed (medium); nothing names the forged credits
    assert.ok(health.some(f => f.checkId === 'control-balance'));
    assert.ok(!health.some(f => /CN-X|CN-Y|credit/i.test(f.title)));
  });
});
