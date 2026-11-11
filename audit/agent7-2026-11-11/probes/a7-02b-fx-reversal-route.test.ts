/**
 * Agent #7 probe A7-02b (review-only): entries at a foreign rate, through the real routes.
 *
 * Books in ILS. A bookkeeper records a manual journal in USD at 3.7 through POST /transactions, then uses
 * "Reverse & Correct" (POST /transactions/:id/reverse) on it.
 *
 *  (1) the rate written on the entry only (what the entry screen's "Currency Context" sends):
 *      Bank 24.70 debit, two income lines of 12.35 credit. By hand: 24.70 × 3.7 = 91.39 ILS.
 *  (2) the rate written on every line, same amounts. By hand: 91.39 against 45.695 + 45.695, so one agora is
 *      settled by the server (settleHomeCurrency writes each line's home amount, `baseAmountCents`).
 *  (3) the rate written on every line, nothing to settle: 10.00 against 5.00 + 5.00 (37.00 / 18.50 / 18.50 ILS).
 *
 * Expected for a correct system: (1) is either valued at 3.7 or refused, never silently taken one for one;
 * (2) and (3) are accepted, and their reversals are accepted and bring every account back to 0.00.
 *
 * Scope, so nothing is over-claimed. At this pin no screen and no server writer produces a line with a rate other
 * than 1 (searched src/ for exchangeRate on lines): invoices, bills, credits and payments are stored in the home
 * currency at rate 1 (postingCore inBaseCurrency) and their reversals are exact (probe A7-04 reverses one). Entries
 * with a rate on the lines reach the books through the transaction API (POST /transactions, /bulk, /batch-create),
 * an import or restore, or the recurring job (probe A7-08).
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DB_URL, named, openBooks, type Books } from './harness';
import { lineAmount } from '../../../src/lib/txFilters';

describe('A7-02b a journal at a foreign rate, through the routes', { skip: !DB_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  let b: Books;
  before(async () => { b = await openBooks('fxrev', 'ILS'); });
  after(async () => { await b.close(); await b.db.terminate(); });

  const journal = (id: string, lineRate: number | undefined) => ({ id, uid: b.BOOKKEEPER, workspaceId: b.ws, date: '2026-10-05', description: `USD journal ${id.split('_').pop()}`, currency: 'USD', exchangeRate: 3.7, status: 'completed', type: 'journal', totalAmountCents: 2470,
    lines: [{ accountId: b.acct.bank, amountCents: 2470 }, { accountId: b.acct.sales, amountCents: -1235 }, { accountId: b.acct.sales2, amountCents: -1235 }].map(l => (lineRate ? { ...l, exchangeRate: lineRate } : l)) });
  const stored = (t: { lines: Array<{ amountCents: number; baseAmountCents?: number; exchangeRate?: number }>; currency?: string; exchangeRate?: number }) =>
    `currency ${t.currency}, entry rate ${t.exchangeRate}, lines ${JSON.stringify(t.lines.map(l => ({ amountCents: l.amountCents, rate: l.exchangeRate, baseAmountCents: l.baseAmountCents })))}`;

  test('(1) the rate on the entry only (no rate on the lines): how is 24.70 USD valued in ILS books?', async () => {
    const id = `${b.ws}_j1`;
    const posted = await b.send(b.BOOKKEEPER, 'POST', '/api/v1/transactions', { transaction: journal(id, undefined) }, { 'x-operation-id': 'a7-02b-1' });
    assert.equal(posted.status, 200, JSON.stringify(posted.body).slice(0, 300));
    const original = (await b.entries()).find(e => e.id === id)!;
    console.log(`(1) POST /transactions -> ${posted.status}; stored: ${stored(original)}`);
    const bal = named(b, await b.balances());
    console.log(`(1) the books (ILS, agorot): ${JSON.stringify(bal)}`);
    console.log(`(1) Bank shows ${(bal.bank / 100).toFixed(2)} ILS for 24.70 USD at 3.7 (24.70 × 3.7 = 91.39)`);
    // what the system does today: the rate written on the entry is kept on the record but not used; the amounts count
    // one for one (the line schema gives every line its own rate of 1, and a line's rate comes first)
    assert.equal(bal.bank, 2470);
    assert.equal(original.exchangeRate, 3.7);
    console.log('(1) DEFECT A7-02c: the entry says "USD at 3.7" and is counted as 24.70 ILS');
    const reversed = await b.send(b.BOOKKEEPER, 'POST', `/api/v1/transactions/${id}/reverse`, { workspaceId: b.ws, reversalDate: '2026-10-06', reason: 'probe' });
    assert.equal(reversed.status, 200, JSON.stringify(reversed.body).slice(0, 300));
    assert.deepEqual(named(b, await b.balances()), {}, 'reversed exactly');
    console.log('(1) reversal: exact (nothing left)');
  });

  test('(2) the rate on every line, one agora settled: valued at 3.7; "Reverse & Correct" is refused', async () => {
    const id = `${b.ws}_j2`;
    const posted = await b.send(b.BOOKKEEPER, 'POST', '/api/v1/transactions', { transaction: journal(id, 3.7) }, { 'x-operation-id': 'a7-02b-2' });
    assert.equal(posted.status, 200, JSON.stringify(posted.body).slice(0, 300));
    const original = (await b.entries()).find(e => e.id === id)!;
    console.log(`(2) POST /transactions -> ${posted.status}; stored: ${stored(original)}`);
    console.log(`(2) original in ILS: ${JSON.stringify(original.lines.map(l => lineAmount(l, original)))}`);
    const reversed = await b.send(b.BOOKKEEPER, 'POST', `/api/v1/transactions/${id}/reverse`, { workspaceId: b.ws, reversalDate: '2026-10-06', reason: 'probe' });
    console.log(`(2) POST /transactions/:id/reverse -> ${reversed.status} ${JSON.stringify(reversed.body).slice(0, 200)}`);
    const asOwner = await b.send(b.OWNER, 'POST', `/api/v1/transactions/${id}/reverse`, { workspaceId: b.ws, reversalDate: '2026-10-06', reason: 'probe' });
    console.log(`(2) the same as the owner -> ${asOwner.status}`);
    console.log(`(2) the books (ILS, agorot): ${JSON.stringify(named(b, await b.balances()))}`);
    // what the system does today
    assert.equal(reversed.status, 400);
    assert.match(JSON.stringify(reversed.body), /totalAmountCents/);
    assert.equal(asOwner.status, 400);
    console.log('(2) DEFECT A7-02: an entry whose lines carry a settled home amount cannot be reversed with "Reverse & Correct"');
  });

  test('(3) the rate on every line, nothing to settle: accepted, valued at 3.7; "Reverse & Correct" is refused too', async () => {
    const id = `${b.ws}_j3`;
    const j = journal(id, 3.7);
    j.lines[0].amountCents = 1000; j.lines[1].amountCents = -500; j.lines[2].amountCents = -500; j.totalAmountCents = 1000;
    const posted = await b.send(b.BOOKKEEPER, 'POST', '/api/v1/transactions', { transaction: j }, { 'x-operation-id': 'a7-02b-3' });
    assert.equal(posted.status, 200, JSON.stringify(posted.body).slice(0, 300));
    const original = (await b.entries()).find(e => e.id === id)!;
    console.log(`(3) POST /transactions -> ${posted.status}; stored: ${stored(original)}, totalAmountCents ${original.totalAmountCents}`);
    console.log(`(3) original in ILS: ${JSON.stringify(original.lines.map(l => lineAmount(l, original)))}`);
    const reversed = await b.send(b.BOOKKEEPER, 'POST', `/api/v1/transactions/${id}/reverse`, { workspaceId: b.ws, reversalDate: '2026-10-06', reason: 'probe' });
    console.log(`(3) POST /transactions/:id/reverse -> ${reversed.status} ${JSON.stringify(reversed.body).slice(0, 200)}`);
    // what the system does today: the validator writes the total in the home currency (37.00), the ledger door
    // compares it with the debit lines in the entry's currency (10.00)
    assert.equal(reversed.status, 400);
    assert.match(JSON.stringify(reversed.body), /entry total \(3700\) does not match its lines \(1000\)/);
    console.log('(3) DEFECT A7-02: an entry at a foreign rate cannot be reversed with "Reverse & Correct"');
    // the only way left through the generic routes: mark it void (no reversing entry, no trace in the period it is voided in)
    const voided = await b.send(b.BOOKKEEPER, 'PUT', `/api/v1/transactions/${id}`, { workspaceId: b.ws, partialUpdate: { status: 'void' } });
    console.log(`(3) PUT /transactions/:id { partialUpdate: { status: "void" } } -> ${voided.status}`);
  });

  test('how often a journal at a foreign rate carries a settled home amount (refusal of case 2; all the others get the refusal of case 3)', async () => {
    const { settleHomeCurrency } = await import('../../../src/lib/txFilters');
    for (const rate of [1.1, 1.25, 3.7, 3.65, 0.85, 1.0842, 3.652]) {
      let settled = 0, total = 0;
      for (let a = 1; a <= 5000; a += 7) for (let c = 1; c <= 5000; c += 11) {
        const t = { exchangeRate: rate, lines: [{ accountId: 'x', amountCents: a + c, exchangeRate: rate }, { accountId: 'y', amountCents: -a, exchangeRate: rate }, { accountId: 'z', amountCents: -c, exchangeRate: rate }] };
        settleHomeCurrency(t as never);
        total++; if (t.lines.some(l => Number.isInteger((l as { baseAmountCents?: number }).baseAmountCents))) settled++;
      }
      console.log(`rate ${rate}: ${settled} of ${total} three-line journals (${(100 * settled / total).toFixed(1)}%) carry a settled home amount`);
    }
  });
});
