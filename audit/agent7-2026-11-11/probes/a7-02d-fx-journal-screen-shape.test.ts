/**
 * Agent #7 probe A7-02d (review-only): a foreign-currency journal exactly as the journal screen sends it.
 *
 * Why: at main 2708f47c a journal that carries a rate on its lines is refused when it is created (probe A7-02b,
 * cases 2 and 3). This probe checks that the journal SCREEN is not caught by that refusal.
 *
 * src/components/ledger/JournalEntryModal.tsx (handleSave, lines 242-331) takes a currency and a rate, converts every
 * line to the books' currency in the browser (Math.round(amount × rate)), puts any rounding difference on the
 * exchange-rounding account, and posts an entry whose `currency` is the books' currency; `originalCurrency` and
 * `exchangeRate` are kept on the entry as a note. This probe sends that payload through POST /transactions, then uses
 * "Reverse & Correct" (POST /transactions/:id/reverse).
 *
 * Books in ILS; 24.70 USD at 3.7, worked by hand the way the screen does it:
 *   Bank    +24.70 USD → Math.round( 2470 × 3.7) = +9139
 *   Income  −12.35 USD → Math.round(−1235 × 3.7) = Math.round(−4569.5) = −4569   (JavaScript rounds −x.5 up)
 *   Income  −12.35 USD →                                                 −4569
 *   sum = +1 agora, so the screen adds −1 on the rounding account; total 9139.
 * Expected: accepted; the books hold exactly those four amounts; the reversal is accepted and leaves 0.00 everywhere.
 *
 * (b) The details window of the ledger list ("Currency Context", TransactionEditModal.tsx:235-249) saves
 * `originalCurrency` and `exchangeRate` on the entry and leaves `currency` and the lines as they are. Expected: the
 * amounts in the books do not change (the rate is a note, the lines are already in the books' currency).
 *
 * Run: LF_TEST_DATABASE_URL=… NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
 *      npx tsx --test --test-force-exit audit/agent7-2026-11-11/probes/a7-02d-fx-journal-screen-shape.test.ts
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DB_URL, named, openBooks, type Books } from './harness';

describe('A7-02d a foreign-currency journal as the journal screen sends it', { skip: !DB_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  let b: Books;
  before(async () => { b = await openBooks('fxscreen', 'ILS'); });
  after(async () => { await b.close(); await b.db.terminate(); });

  const RATE = 3.7;
  const usd = [{ key: 'bank', cents: 2470 }, { key: 'sales', cents: -1235 }, { key: 'sales2', cents: -1235 }] as const;

  test('(a) POST /transactions with the screen\'s payload, then "Reverse & Correct"', async () => {
    const lines: Array<{ accountId: string; accountName: string; amountCents: number }> =
      usd.map(l => ({ accountId: b.acct[l.key], accountName: l.key, amountCents: Math.round(l.cents * RATE) }));
    const over = lines.reduce((s, l) => s + l.amountCents, 0);
    if (over !== 0) lines.push({ accountId: b.acct.fx, accountName: 'fx', amountCents: -over });
    const id = `tx_je_${b.ws}_screen`;
    const payload = {
      id, uid: b.BOOKKEEPER, workspaceId: b.ws, date: '2026-10-05', description: 'USD journal typed on the journal screen', reference: 'JE-1',
      totalAmountCents: lines.filter(l => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0),
      currency: 'ILS', originalCurrency: 'USD', exchangeRate: RATE, type: 'journal', status: 'completed', lines, isCleared: true,
    };
    console.log(`(a) payload lines (agorot): ${JSON.stringify(lines.map(l => l.amountCents))}, total ${payload.totalAmountCents}`);
    assert.deepEqual(lines.map(l => l.amountCents), [9139, -4569, -4569, -1], 'worked by hand in the header');

    const posted = await b.send(b.BOOKKEEPER, 'POST', '/api/v1/transactions', { transaction: payload }, { 'Idempotency-Key': id });
    console.log(`(a) POST /transactions -> ${posted.status} ${posted.status === 200 ? '' : JSON.stringify(posted.body).slice(0, 200)}`);
    assert.equal(posted.status, 200, JSON.stringify(posted.body).slice(0, 300));
    const bal = named(b, await b.balances());
    console.log(`(a) the books (ILS, agorot): ${JSON.stringify(bal)}`);
    assert.deepEqual(bal, { bank: 9139, sales: -4569, sales2: -4569, fx: -1 });
    assert.equal((await b.unbalanced()).length, 0, 'balanced in the books\' currency');

    const reversed = await b.send(b.BOOKKEEPER, 'POST', `/api/v1/transactions/${id}/reverse`, { workspaceId: b.ws, reversalDate: '2026-10-06', reason: 'probe' });
    console.log(`(a) POST /transactions/:id/reverse -> ${reversed.status} ${reversed.status === 200 ? '' : JSON.stringify(reversed.body).slice(0, 200)}`);
    assert.equal(reversed.status, 200, JSON.stringify(reversed.body).slice(0, 300));
    assert.deepEqual(named(b, await b.balances()), {}, 'every account back to 0.00');
    console.log('(a) OK: accepted, valued at 3.7 by the screen\'s own arithmetic, reversed exactly');
  });

  test('(b) the details window saves a currency and a rate on a home-currency entry: the amounts stay', async () => {
    const id = `${b.ws}_plain`;
    const plain = {
      id, uid: b.BOOKKEEPER, workspaceId: b.ws, date: '2026-10-07', description: 'plain ILS journal', totalAmountCents: 5000,
      currency: 'ILS', type: 'journal', status: 'completed',
      lines: [{ accountId: b.acct.bank, amountCents: 5000 }, { accountId: b.acct.sales, amountCents: -5000 }],
    };
    const posted = await b.send(b.BOOKKEEPER, 'POST', '/api/v1/transactions', { transaction: plain }, { 'Idempotency-Key': id });
    assert.equal(posted.status, 200, JSON.stringify(posted.body).slice(0, 300));
    const before = named(b, await b.balances());
    const stored = (await b.entries()).find(e => e.id === id)!;
    const saved = await b.send(b.BOOKKEEPER, 'PUT', `/api/v1/transactions/${id}`, {
      transaction: { ...stored, originalCurrency: 'USD', exchangeRate: RATE, updatedAt: new Date().toISOString() },
    });
    console.log(`(b) PUT /transactions/:id with originalCurrency USD and rate 3.7 -> ${saved.status} ${saved.status === 200 ? '' : JSON.stringify(saved.body).slice(0, 200)}`);
    const afterSave = named(b, await b.balances());
    const now = (await b.entries()).find(e => e.id === id)!;
    console.log(`(b) the books before ${JSON.stringify(before)}, after ${JSON.stringify(afterSave)}; entry now: originalCurrency ${String((now as { originalCurrency?: string }).originalCurrency)}, rate ${String(now.exchangeRate)}`);
    assert.equal(saved.status, 200, JSON.stringify(saved.body).slice(0, 300));
    assert.deepEqual(afterSave, before, 'the amounts in the books did not change');
    console.log('(b) OK: the rate is kept as a note; the amounts in the books are unchanged');
  });
});
