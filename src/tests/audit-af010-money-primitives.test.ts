/**
 * Independent audit Pass A — AF-010 high-risk money micro-functions.
 * Pinned against the functions themselves (expected values computed by hand in this file, never
 * derived by calling the function under review). Where a current behavior is a verified defect,
 * the test locks the OBSERVED behavior and names the finding, so a fix must deliberately update
 * both the function and this audit test. Evidence: audit/function-audit/AF-010-money-microfunctions.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAmountText, parseAmountToCents } from '../lib/utils';
import { bankCsvAmountCents } from '../lib/bankCsvRows';
import { allocateCents as canonicalAlloc } from '../lib/Allocation';
import { allocateCents as kernelAlloc } from '../kernel/templates/TransactionTemplates';
import { TruthEngine } from '../modules/integrity/TruthEngine';

test('AF-010 kernel allocateCents: largest remainder, parts always sum to total (incl. negatives)', () => {
  assert.deepEqual(kernelAlloc(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(kernelAlloc(10, [3, 3, 3]), [4, 3, 3]);
  // negative totals stay exact: floors distribute the leftover cent
  assert.deepEqual(kernelAlloc(-101, [1, 1]), [-50, -51]);
  assert.equal(kernelAlloc(-101, [1, 1]).reduce((a, b) => a + b, 0), -101);
  // property over random shapes, totals from -1,000,000 to +1,000,000 cents
  for (let seed = 1; seed <= 3000; seed++) {
    const total = ((seed * 7919) % 2_000_001) - 1_000_000;
    const weights = Array.from({ length: 1 + (seed % 6) }, (_, i) => (seed * (i + 3)) % 500);
    const parts = kernelAlloc(total, weights);
    assert.equal(parts.length, weights.length);
    assert.equal(parts.reduce((a, b) => a + b, 0), total, `sum must equal total for seed ${seed}`);
    assert.ok(parts.every(Number.isSafeInteger), `integer cents only for seed ${seed}`);
  }
});

test('AF-010-F1: the two allocateCents primitives have silently different contracts', () => {
  // The kernel posting allocator COERCES degenerate weights (all zero / negative) onto the first
  // slot; the "canonical" Allocation module THROWS. Both are used in money paths today.
  assert.deepEqual(kernelAlloc(500, [0, 0]), [500, 0], 'kernel: zero weights -> first slot takes all');
  assert.deepEqual(kernelAlloc(100, []), [], 'kernel: empty weights -> empty array');
  assert.deepEqual(kernelAlloc(100, [5, -3, 2]), [71, 0, 29], 'kernel: negative weight clamped to 0');
  assert.throws(() => canonicalAlloc(500, [0, 0]), /totalWeight must be > 0/, 'canonical: zero weights throw');
  assert.throws(() => canonicalAlloc(100, [1, NaN]), /positive finite numbers/, 'canonical: NaN weight throws');
  assert.throws(() => canonicalAlloc(Number.MAX_SAFE_INTEGER + 1, [1, 1]), /safe integer/);
  // where both accept the inputs they agree
  for (const [total, weights] of [[100, [1, 1, 1]], [23499, [10000, 10000]], [-101, [1, 1]], [7, [3, 2, 1]]] as const) {
    assert.deepEqual(kernelAlloc(total, [...weights]), canonicalAlloc(total, [...weights]));
  }
});

test('AF-010-F2: utils.parseAmountToCents reads parenthesized accounting negatives as negative', () => {
  // fixed 28 Oct: an accountant typing (500.00) records -500, as the other two parsers do
  assert.equal(parseAmountToCents('(100.00)'), -10000);
  assert.equal(parseAmountToCents('(0.01)'), -1);
  assert.equal(parseAmountToCents('($1,234.56)'), -123456);
  // the other two primitives get parentheses right
  assert.equal(bankCsvAmountCents('(100.00)'), -10000);
  assert.equal(TruthEngine.parseAmountToCents('(100.00)'), -10000);
});

test('AF-010-F3: utils.parseAmountToCents refuses a typo with a plain error, never another number or 0', () => {
  // savers that accept 0 (prices, budgets, proceeds) must not record a typo as 0; render paths use isAmountText
  for (const typo of ['1.2.3', '1-2', '--5', '(1+2)']) assert.throws(() => parseAmountToCents(typo), /is not an amount/, typo);
  assert.equal(parseAmountToCents('abc'), 0, 'text without a digit is still no amount');
  // half-typed amounts never throw while a screen renders them (Codex on #430)
  for (const draft of ['1,', '1,2', '1,23', '(1', '(100', '-', '$', '1.']) assert.doesNotThrow(() => parseAmountToCents(draft), draft);
  assert.equal(parseAmountToCents('(100'), -10000, 'an unclosed bracket already reads negative');
  // he-IL money text carries direction marks and a no-break space (CodeRabbit on #430)
  const hebrew = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(123456.78);
  assert.equal(isAmountText(hebrew, { complete: true }), true, JSON.stringify(hebrew));
  assert.equal(parseAmountToCents(hebrew), 12345678);
  // qualified symbols the app's own formatter emits (Codex on #430)
  for (const pasted of ['CA$1,234.56', '1,234.56 CA$', 'A$5', '₹100', 'US$ 12.50']) {
    assert.equal(isAmountText(pasted, { complete: true }), true, pasted);
    assert.doesNotThrow(() => parseAmountToCents(pasted), pasted);
  }
  const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(123456.78);
  assert.equal(isAmountText(inr, { complete: true }), true, JSON.stringify(inr));
  assert.equal(parseAmountToCents(inr), 12345678);
  assert.equal(isAmountText('1,23,45', { complete: true }), false, 'an unfinished lakh group');
  const cad = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'CAD' }).format(1234.56);
  assert.equal(parseAmountToCents(cad), 123456, JSON.stringify(cad));
  // the minus may follow the currency, as de-CH writes it (Codex on #430)
  const chf = new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' }).format(-123.45);
  assert.equal(parseAmountToCents(chf), -12345, JSON.stringify(chf));
  assert.equal(isAmountText(chf, { complete: true }), true, JSON.stringify(chf));
  assert.equal(parseAmountToCents('CHF-123.45'), -12345);
  // before a save, only a finished amount passes (CodeRabbit on #430)
  for (const unfinished of ['1,', '1,2', '1,2,3', '(100', '100)', '1,234 567']) assert.equal(isAmountText(unfinished, { complete: true }), false, unfinished);
  for (const done of ['0', '1,234.56', '1,234,567', '1 234', "1'234.50", '(100.00)', '-$99.95', '100 USD', '.5', '5.']) assert.equal(isAmountText(done, { complete: true }), true, done);
  for (const typo of ['1.2.3', '1-2', '--5', '(1+2)', 'abc', '']) assert.equal(isAmountText(typo), false, typo);
  for (const amount of ['0', '0.00', '1,234.56', '-$99.95', '(100.00)', '.5', '5.', 'USD 12.50', '₪40', '100 USD', '1 234.56', "1'234.50", '+5', '12.50 CR']) assert.equal(isAmountText(amount), true, amount);
  // TruthEngine wraps the same class of failure in its own integrity error; OrZero swallows it
  assert.throws(() => TruthEngine.parseAmountToCents('1.2.3'), /Invalid amount format/);
  assert.equal(TruthEngine.parseAmountToCentsOrZero('1.2.3'), 0);
});

test('AF-010-F4: utils.parseAmountToCents boundary table', () => {
  const cases: Array<[unknown, number]> = [
    ['', 0], [null, 0], [undefined, 0], ['abc', 0],
    ['1,234.56', 123456], ['.5', 50], ['5.', 500],
    ['-$99.95', -9995], ['  -12.34 ', -1234], ['1.005', 101],
    [2.675, 268], [NaN, 0],
  ];
  for (const [input, expected] of cases) assert.equal(parseAmountToCents(input as never), expected, String(input));
  assert.ok(parseAmountToCents('-0') === 0, '-0 is numerically zero (strictEqual would see -0)');
  // non-Latin digits are stripped to a silent zero
  assert.equal(parseAmountToCents('۱۲۳'), 0, 'OBSERVED: Arabic-Indic digits become 0, not a refusal');
  // fixed 28 Oct: a non-finite number is no amount
  assert.equal(parseAmountToCents(Infinity), 0);
  assert.equal(parseAmountToCents(-Infinity), 0);
});

test('AF-010: TruthEngine parser handles the notations the utils parser cannot', () => {
  assert.equal(TruthEngine.parseAmountToCents('1,234.56'), 123456);
  assert.equal(TruthEngine.parseAmountToCents('100.00 CR'), -10000, 'CR suffix flips to negative');
  assert.equal(TruthEngine.parseAmountToCents('100.00 DR'), 10000);
  assert.equal(TruthEngine.parseAmountToCents('−50'), -5000, 'unicode minus');
  assert.throws(() => TruthEngine.parseAmountToCents(''), /Amount cannot be empty/, 'empty throws here, returns 0 in utils');
});

test('AF-010: bankCsvAmountCents refuses ambiguity and never invents a sign', () => {
  assert.equal(bankCsvAmountCents('(12.50)'), -1250);
  assert.equal(bankCsvAmountCents('12.50-'), -1250);
  assert.equal(bankCsvAmountCents('$1,234.56'), 123456);
  assert.equal(bankCsvAmountCents('1.234,56'), 123456, 'semicolon-export comma decimal');
  assert.equal(bankCsvAmountCents('12.345'), null, 'three decimals refused, not rounded');
  assert.equal(bankCsvAmountCents('n/a'), null);
  assert.equal(bankCsvAmountCents(''), null);
  assert.equal(bankCsvAmountCents(undefined), null);
});

test('AF-010-F3: a sum with a currency between the numbers is refused; Swiss ’ grouping is an amount', () => {
  for (const sum of ['1 + $2', '1+ USD 2', '$1 * $2']) assert.throws(() => parseAmountToCents(sum), /is not an amount/, sum);
  assert.equal(isAmountText('CHF1’234.56', { complete: true }), true);
  assert.equal(parseAmountToCents('CHF1’234.56'), 123456);
});

test('AF-010: readAmountCents reads a finished amount and gives null (never 0, never a throw) for a typo or a blank', async () => {
  const { readAmountCents } = await import('../lib/utils');
  assert.equal(readAmountCents('1,234.56'), 123456);
  assert.equal(readAmountCents('(100)'), -10000);
  assert.equal(readAmountCents('CHF1’234.56'), 123456);
  assert.equal(readAmountCents('CA$1,234.56'), 123456);
  assert.equal(readAmountCents('CA\u200F$1,234.56'), 123456); // a pasted direction mark between code and symbol
  assert.equal(readAmountCents('1,234.56 USD'), 123456);
  for (const bad of ['', '   ', null, undefined, '1.2.3', '1-2', '(1+2)', '1,', '1,2', '(100', 'abc', '100k', '5 m', '2kg']) {
    assert.equal(readAmountCents(bad as string), null, String(bad));
  }
});

test('AF-011: a decimal comma reads as the decimal point; thousands groups and half-typed amounts read as before', async () => {
  const { readAmountCents } = await import('../lib/utils');
  // the comma is the point when it is last and two digits follow: never 100 times the amount
  const cases: Array<[string, number]> = [
    ['12,50', 1250], ['-12,50', -1250], ['(12,50)', -1250], ['1.234,56', 123456], ['1.234.567,89', 123456789],
    ['1 234,56', 123456], ['12,50 €', 1250], ['€ 1.234,56', 123456], ['CHF-12,50', -1250], ["1'234,50", 123450],
  ];
  for (const [text, cents] of cases) {
    assert.equal(parseAmountToCents(text), cents, text);
    assert.equal(isAmountText(text, { complete: true }), true, text);
    assert.equal(readAmountCents(text), cents, text);
  }
  const de = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(1234.56);
  assert.equal(parseAmountToCents(de), 123456, JSON.stringify(de));
  const fr = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(-1234.56);
  assert.equal(parseAmountToCents(fr), -123456, JSON.stringify(fr));
  // three digits after a comma stay a thousands group (en-US), lakh grouping and dotted decimals are untouched
  for (const [text, cents] of [['12,345', 1234500], ['1,234.56', 123456], ['1,23,456', 12345600], ['1.5', 150], ['1,234,567', 123456700]] as Array<[string, number]>) {
    assert.equal(parseAmountToCents(text), cents, text);
  }
  // still unfinished or wrong, never guessed
  for (const text of ['1,2', '1,', '1.2,34', '1,23,45', '12,50,00', '1.234,5']) assert.equal(readAmountCents(text), null, text);
});
