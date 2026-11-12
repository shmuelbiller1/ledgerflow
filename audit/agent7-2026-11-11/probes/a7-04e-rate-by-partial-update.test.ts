/**
 * Agent #7 probe A7-04e (review-only): can the value of a posted entry be changed without touching its lines?
 *
 * PUT /transactions/:id { partialUpdate } refuses `lines`, `amountCents`, `totalAmountCents`, `date`, `workspaceId`
 * and `uid` (crudRoutes.ts:292) and writes every other field as sent, without the validator (crudRoutes.ts:307).
 * Reports value a line with `lineAmount` (src/lib/txFilters.ts:90): the line's own rate, else THE ENTRY'S rate.
 * So for an entry whose stored lines carry no rate of their own, the entry's `exchangeRate` is a multiplier.
 *
 * Books in USD. Invoice INV-9 for 500.00, paid in full: Bank +500.00, Accounts Receivable 0.00, Sales -500.00.
 * A bookkeeper sends { partialUpdate: { exchangeRate: 100 } } to (a) the invoice's entry, (b) the payment's entry,
 * (c) a journal typed by hand (posted through POST /transactions, whose line schema gives each line rate 1).
 * Expected for a correct system: refused, or accepted with every balance unchanged.
 *
 * Run: LF_TEST_DATABASE_URL=… NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
 *      npx tsx --test --test-force-exit audit/agent7-2026-11-11/probes/a7-04e-rate-by-partial-update.test.ts
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DB_URL, named, openBooks, type Books } from './harness';

describe('A7-04e the entry rate as a multiplier, set by a partial update', { skip: !DB_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  let b: Books;
  const invoiceId = () => `${b.ws}_inv9`;
  let accrualId = '', paymentEntryId = '';
  const journalId = () => `${b.ws}_hand`;
  before(async () => { b = await openBooks('ratepatch'); });
  after(async () => { await b.close(); await b.db.terminate(); });
  const lineRates = async (id: string) => JSON.stringify((await b.entries()).find(e => e.id === id)!.lines.map(l => (l as { exchangeRate?: number }).exchangeRate ?? 'none'));
  const facts: Record<string, unknown> = {};

  test('setup: invoice 500.00 paid in full, and a hand journal of 70.00', async () => {
    await b.db.collection('customers').doc(`${b.ws}_c1`).set({ id: `${b.ws}_c1`, workspaceId: b.ws, name: 'Acme' } as never);
    const data = { id: invoiceId(), workspaceId: b.ws, number: 'INV-9', customerName: 'Acme', customerId: `${b.ws}_c1`, date: '2026-08-03', dueDate: '2026-09-02', status: 'sent', currency: 'USD',
      amountCents: 50_000, items: [{ id: 'l1', description: 'Work', quantity: 1, rateCents: 50_000, amountCents: 50_000 }] };
    const posted = await b.send(b.OWNER, 'POST', `/api/v1/documents/invoices/${invoiceId()}/post`, { workspaceId: b.ws, action: 'create', data }, { 'idempotency-key': 'a7-04e-inv' });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    const paid = await b.send(b.OWNER, 'POST', '/api/v1/payments', { workspaceId: b.ws, amountCents: 50_000, paymentDate: '2026-08-10', cashAccountId: b.acct.bank, customerId: `${b.ws}_c1`,
      allocations: [{ documentId: invoiceId(), documentType: 'invoice', amountCents: 50_000 }] }, { 'x-operation-id': 'a7-04e-pay' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    paymentEntryId = paid.body.data.transactionId;
    accrualId = (await b.entries()).find(e => e.metadata?.type === 'invoice-accrual')!.id;
    const hand = await b.send(b.BOOKKEEPER, 'POST', '/api/v1/transactions', { transaction: { id: journalId(), uid: b.BOOKKEEPER, workspaceId: b.ws, date: '2026-08-12', description: 'hand journal', currency: 'USD', type: 'journal', status: 'completed', totalAmountCents: 7_000,
      lines: [{ accountId: b.acct.supplies, amountCents: 7_000 }, { accountId: b.acct.bank, amountCents: -7_000 }] } }, { 'x-operation-id': 'a7-04e-hand' });
    assert.equal(hand.status, 200, JSON.stringify(hand.body));
    assert.deepEqual(named(b, await b.balances()), { bank: 43_000, sales: -50_000, supplies: 7_000 });
    console.log(`stored line rates — invoice entry: ${await lineRates(accrualId)}; payment entry: ${await lineRates(paymentEntryId)}; hand journal: ${await lineRates(journalId())}`);
  });

  for (const [label, id] of [['(a) the invoice\'s entry', () => accrualId], ['(b) the payment\'s entry', () => paymentEntryId], ['(c) the hand journal', journalId]] as const) {
    test(`${label}: { partialUpdate: { exchangeRate: 100 } } as a bookkeeper`, async () => {
      const before = named(b, await b.balances());
      const res = await b.send(b.BOOKKEEPER, 'PUT', `/api/v1/transactions/${id()}`, { workspaceId: b.ws, partialUpdate: { exchangeRate: 100 } });
      const after = named(b, await b.balances());
      const changed = JSON.stringify(before) !== JSON.stringify(after);
      console.log(`${label}: PUT … { partialUpdate: { exchangeRate: 100 } } -> ${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body).slice(0, 160)}`);
      console.log(`${label}: books before ${JSON.stringify(before)}`);
      console.log(`${label}: books after  ${JSON.stringify(after)}${changed ? '   <-- CHANGED' : '   (unchanged)'}`);
      facts[label] = { status: res.status, changed };
      if (changed) {
        const stored = (await b.entries()).find(e => e.id === id())!;
        console.log(`${label}: the entry as stored: totalAmountCents ${stored.totalAmountCents}, lines ${JSON.stringify(stored.lines.map(l => l.amountCents))}, exchangeRate ${stored.exchangeRate} (lines and total untouched)`);
        const tb = await b.send(b.OWNER, 'GET', `/api/v1/reports/trial-balance?workspaceId=${b.ws}&endDate=2026-12-31`);
        console.log(`${label}: trial balance route: debits ${tb.body.totalDebit}, credits ${tb.body.totalCredit}, isBalanced ${tb.body.isBalanced}`);
        const bs = await b.send(b.OWNER, 'GET', `/api/v1/reports/balance-sheet?workspaceId=${b.ws}&endDate=2026-12-31`);
        console.log(`${label}: balance sheet route: bank ${bs.body.assets?.[b.acct.bank]}, isBalanced ${bs.body.isBalanced}`);
        const health = await b.dataHealth();
        console.log(`${label}: Data Health: ${health.length ? health.map(f => `(${f.severity}) [${f.checkId}] ${f.title}`).join(' | ') : 'none'}`);
        const { findPostingMismatches } = await import('../../../src/lib/postingCheck');
        const invoices = (await b.db.collection('invoices').where('workspaceId', '==', b.ws).get()).docs.map(d => ({ ...d.data(), id: d.id }));
        const mismatches = findPostingMismatches({ invoices: invoices as never, bills: [], transactions: (await b.entries()) as never });
        console.log(`${label}: month-end posting check: ${mismatches.length ? mismatches.map(m => `${m.kind} ${m.number}: ${m.issue}`).join(' | ') : 'nothing found'}`);
        const audit = (await b.db.collection('auditLogs').where('workspaceId', '==', b.ws).get()).docs.map(d => d.data()).filter(l => l.entityId === id() && l.action === 'TRANSACTION_UPDATED_PARTIAL');
        console.log(`${label}: audit rows for the change: ${audit.length}; details of the last: ${JSON.stringify(audit.at(-1)?.details)}`);
        console.log(`DEFECT A7-04e: one header field multiplied the value of ${label.slice(4)} by 100 in every report; its lines and total still read 500.00`);
        // put it back so the next case starts from the same books
        const back = await b.send(b.OWNER, 'PUT', `/api/v1/transactions/${id()}`, { workspaceId: b.ws, partialUpdate: { exchangeRate: 1 } });
        assert.equal(back.status, 200);
        assert.deepEqual(named(b, await b.balances()), before, 'restored');
      }
    });
  }

  test('summary: what main does today', () => {
    console.log(JSON.stringify(facts));
    // the payment's entry is written by paymentService itself and stores no rate on its lines, so the entry's rate
    // multiplies it; the invoice's entry and the hand journal went through the line schema (rate 1 on every line)
    assert.deepEqual(facts, {
      '(a) the invoice\'s entry': { status: 200, changed: false },
      '(b) the payment\'s entry': { status: 200, changed: true },
      '(c) the hand journal': { status: 200, changed: false },
    });
  });
});
