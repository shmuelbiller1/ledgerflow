import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAbsoluteTotal, lineAmount, settleHomeCurrency } from '../lib/txFilters';
import { checkLedgerEntry } from '../server/services/ledgerDoor';
import type { Transaction } from '../types';

// BUG-07: an entry in a foreign currency balances in the home currency too.
const sumHome = (t: Transaction) => t.lines.reduce((s, l) => s + lineAmount(l, t), 0);

test('rounding at one rate: the cent goes to the largest line and the entry balances at home', () => {
  const t = { lines: [{ accountId: 'a', amountCents: 33, exchangeRate: 1.015 }, { accountId: 'b', amountCents: 33, exchangeRate: 1.015 }, { accountId: 'c', amountCents: -66, exchangeRate: 1.015 }] } as Transaction;
  assert.notEqual(t.lines.reduce((s, l) => s + Math.round(l.amountCents * 1.015), 0), 0, 'converted line by line, it does not balance');
  settleHomeCurrency(t);
  assert.equal(sumHome(t), 0);
  assert.ok(t.lines.every(l => Number.isInteger(l.baseAmountCents)));
});

test('INT-5: two rates even a cent apart are refused — the gap is an exchange difference, not rounding', () => {
  const t = { lines: [{ accountId: 'a', amountCents: 100, exchangeRate: 1.083 }, { accountId: 'b', amountCents: -100, exchangeRate: 1.087 }] } as Transaction;
  assert.throws(() => settleHomeCurrency(t), /exchange-difference/);
});

test('INT-5: different rates that balance through an exchange gain line are accepted unchanged', () => {
  // invoice 100 EUR at 1.08 settled at 1.10: bank +110.00, receivable -108.00, FX gain -2.00 (home)
  const home = { lines: [{ accountId: 'bank', amountCents: 11000 }, { accountId: 'ar', amountCents: -10800 }, { accountId: 'fx', amountCents: -200 }] } as Transaction;
  settleHomeCurrency(home);
  assert.equal(sumHome(home), 0);
});

test('INT-5: opposite signs, several lines, one rate — fractional cents settled on one line, within a cent per line', () => {
  const lines = [333, 333, 334, -250, -750].map((c, i) => ({ accountId: `x${i}`, amountCents: c, exchangeRate: 3.6729 }));
  const t = { lines } as Transaction;
  settleHomeCurrency(t);
  assert.equal(sumHome(t), 0);
  t.lines.forEach(l => assert.ok(Math.abs(lineAmount(l, t) - l.amountCents * 3.6729) <= t.lines.length));
});

test('INT-5: a reversal (all signs flipped) settles to the exact mirror', () => {
  const make = (sign: number) => ({ lines: [33, 33, -66].map((c, i) => ({ accountId: `r${i}`, amountCents: sign * c, exchangeRate: 1.015 })) }) as Transaction;
  const a = make(1), b = make(-1);
  settleHomeCurrency(a); settleHomeCurrency(b);
  assert.equal(sumHome(a), 0); assert.equal(sumHome(b), 0);
  assert.equal(a.lines.reduce((s, l) => s + Math.abs(lineAmount(l, a)), 0), b.lines.reduce((s, l) => s + Math.abs(lineAmount(l, b)), 0));
});

test('different rates far apart are refused: post an exchange difference instead', () => {
  const t = { lines: [{ accountId: 'a', amountCents: 100000, exchangeRate: 1.08 }, { accountId: 'b', amountCents: -100000, exchangeRate: 1.10 }] } as Transaction;
  assert.throws(() => settleHomeCurrency(t), /exchange-difference/);
});

test('home-currency entries are untouched', () => {
  const t = { lines: [{ accountId: 'a', amountCents: 100 }, { accountId: 'b', amountCents: -100 }] } as Transaction;
  settleHomeCurrency(t);
  assert.ok(t.lines.every(l => l.baseAmountCents === undefined));
});


// Regression for #673: already-home-currency journal lines must never be converted again.
// For 101+101-102-100 @ 1.65, multiplying each rounded line yields a 1-cent residual;
// the old settleHomeCurrency then rewrote supplied home amounts, corrupting reports.
test('four-line FX journal preserves explicit home cents and posted total through server ledger checks', () => {
  const tx = {
    id: 'fx-four-lines',
    workspaceId: 'ws-fx',
    currency: 'USD',
    originalCurrency: 'EUR',
    exchangeRate: 1.65,
    totalAmountCents: 202,
    status: 'completed',
    lines: [
      { accountId: 'a', amountCents: 101, baseAmountCents: 101 },
      { accountId: 'b', amountCents: 101, baseAmountCents: 101 },
      { accountId: 'c', amountCents: -102, baseAmountCents: -102 },
      { accountId: 'd', amountCents: -100, baseAmountCents: -100 },
    ],
  } as Transaction;
  assert.equal(tx.lines.reduce((sum, l) => sum + Math.round(l.amountCents * 1.65), 0), 1, 'the old settlement path would rewrite these lines');
  const original = structuredClone(tx.lines);
  settleHomeCurrency(tx);
  assert.deepEqual(tx.lines, original, 'keep the supplied home-currency figures');
  assert.equal(getAbsoluteTotal(tx), 202);
  assert.doesNotThrow(() => checkLedgerEntry(tx as unknown as Record<string, unknown>));
});

test('explicit but unbalanced home-currency lines are rejected instead of silently repaired', () => {
  const tx = {
    exchangeRate: 1.65,
    lines: [
      { accountId: 'a', amountCents: 100, baseAmountCents: 101 },
      { accountId: 'b', amountCents: -100, baseAmountCents: -100 },
    ],
  } as Transaction;
  assert.throws(() => settleHomeCurrency(tx), /explicit home-currency lines do not balance/);
});

test('partially supplied home-currency lines are rejected instead of mixing raw and settled amounts', () => {
  const tx = {
    exchangeRate: 1.65,
    lines: [
      { accountId: 'a', amountCents: 100, baseAmountCents: 165 },
      { accountId: 'b', amountCents: -100 },
    ],
  } as Transaction;
  assert.throws(() => settleHomeCurrency(tx), /present on every line or none/);
});
