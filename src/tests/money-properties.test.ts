import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDecimal,
  formatSignedAmount,
  getCurrencyDivisor,
  getCurrencyFractionDigits,
  parseAmountToCents,
  readAmountCents,
} from '../lib/moneyFormat';

function createRng(seed = 987123456) {
  let s = seed;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Money Formatting and Parsing Property Invariants (D-64)', () => {
  const rng = createRng(111222333);

  const currencies = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD', 'CHF', 'JPY', 'BHD'];

  it('Property 1 (Decimal Round-Trip): parseAmountToCents(formatDecimal(cents)) === cents for all integer cents', () => {
    // Test boundary values
    const boundaryCents = [
      0,
      1,
      -1,
      10,
      -10,
      99,
      -99,
      100,
      -100,
      105,
      -105,
      1000,
      -1000,
      999999,
      -999999,
      100000000, // $1,000,000.00
      -100000000,
      2147483647, // max 32-bit signed
      -2147483647,
    ];

    for (const cents of boundaryCents) {
      const formatted = formatDecimal(cents);
      const parsed = parseAmountToCents(formatted);
      assert.equal(parsed, cents, `Boundary cents ${cents} -> ${formatted} -> ${parsed}`);
    }

    // Randomized test cases
    for (let trial = 0; trial < 1000; trial++) {
      const isNegative = rng() < 0.3;
      const raw = Math.floor(rng() * 100000000); // up to $1,000,000.00
      const cents = isNegative ? -raw : raw;

      const formatted = formatDecimal(cents);
      const parsed = parseAmountToCents(formatted);

      assert.equal(parsed, cents, `Random cents ${cents} formatted as ${formatted} parsed as ${parsed}`);
    }
  });

  it('Property 2 (Accounting Notation Parse): ($123.45) and (123.45) correctly parse to negative cents', () => {
    for (let trial = 0; trial < 200; trial++) {
      const absCents = Math.floor(rng() * 5000000) + 1; // $0.01 to $50,000.00
      const decimalStr = formatDecimal(absCents);

      const accountingParen = `(${decimalStr})`;
      const accountingCurrencyParen = `($${decimalStr})`;

      assert.equal(
        parseAmountToCents(accountingParen),
        -absCents,
        `Expected ${accountingParen} to parse to -${absCents}`,
      );
      assert.equal(
        parseAmountToCents(accountingCurrencyParen),
        -absCents,
        `Expected ${accountingCurrencyParen} to parse to -${absCents}`,
      );
    }
  });

  it('Property 3 (Signed Amount Direction Invariant): formatSignedAmount produces consistent directional markers', () => {
    for (const currency of ['USD', 'ILS', 'EUR', 'GBP']) {
      const inText = formatSignedAmount(12345, 'in', currency, { locale: 'en-US' });
      assert.ok(inText.startsWith('+'), `Money in should start with +, got: ${inText}`);

      const outText = formatSignedAmount(12345, 'out', currency, { locale: 'en-US' });
      assert.ok(outText.startsWith('\u2212') || outText.startsWith('-'), `Money out should start with minus sign, got: ${outText}`);

      const noneText = formatSignedAmount(12345, 'none', currency, { locale: 'en-US' });
      assert.ok(!noneText.startsWith('+') && !noneText.startsWith('\u2212') && !noneText.startsWith('-'), `Money none should have no prefix, got: ${noneText}`);
    }
  });

  it('Property 4 (Currency Minor Units and Divisors): Minor unit digits are non-negative and divisor is 10^digits', () => {
    for (const cur of currencies) {
      const digits = getCurrencyFractionDigits(cur);
      const divisor = getCurrencyDivisor(cur);

      assert.ok(digits >= 0 && digits <= 4, `Digits for ${cur} must be between 0 and 4, got ${digits}`);
      assert.equal(divisor, Math.pow(10, digits), `Divisor for ${cur} must be 10^${digits}`);
    }

    // Specific well-known checks
    assert.equal(getCurrencyFractionDigits('JPY'), 0);
    assert.equal(getCurrencyDivisor('JPY'), 1);

    assert.equal(getCurrencyFractionDigits('USD'), 2);
    assert.equal(getCurrencyDivisor('USD'), 100);

    assert.equal(getCurrencyFractionDigits('BHD'), 3);
    assert.equal(getCurrencyDivisor('BHD'), 1000);
  });

  it('Property 5 (readAmountCents Graceful Non-Throw): readAmountCents never throws on invalid/malformed input and returns null', () => {
    const invalidInputs = [
      '',
      '   ',
      'abc',
      '1.2.3.4',
      '1,,00',
      '(100',
      '100)',
      '$$$',
      '--10',
      '++20',
      '12 + 34',
      '100 * 5',
      null,
      undefined,
    ];

    for (const input of invalidInputs) {
      assert.doesNotThrow(() => {
        const res = readAmountCents(input as string);
        assert.equal(res, null, `Invalid input '${input}' should return null`);
      });
    }

    const validInputs = [
      { text: '100', expected: 10000 },
      { text: '$100', expected: 10000 },
      { text: '100.50', expected: 10050 },
      { text: '$1,234.56', expected: 123456 },
      { text: '-$50.25', expected: -5025 },
      { text: '($50.25)', expected: -5025 },
    ];

    for (const { text, expected } of validInputs) {
      const res = readAmountCents(text);
      assert.equal(res, expected, `Valid text '${text}' should parse to ${expected}`);
    }
  });
});
