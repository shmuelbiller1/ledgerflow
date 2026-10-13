import test from 'node:test';
import assert from 'node:assert/strict';
import { israel102Review, type Israel102ReviewRun } from '../lib/tax/israel102Review';

const first: Israel102ReviewRun = {
  id: 'oct-01', period: '2026-10', status: 'processed', currency: 'ILS',
  employeeCount: 2, sourceReviewed: true, incomeTaxWithheldCents: 60000,
  nationalEmployeeCents: 12345, nationalEmployerCents: 23456, healthEmployeeCents: 7890,
};
const second: Israel102ReviewRun = {
  id: 'oct-02', period: '2026-10', status: 'processed', currency: 'ILS',
  employeeCount: 1, sourceReviewed: true, incomeTaxWithheldCents: 5000,
  nationalEmployeeCents: 1000, nationalEmployerCents: 2000, healthEmployeeCents: 300,
};

test('E-18 exact cents: only posted October ILS runs count; income tax remains outside NII totals', () => {
  const review = israel102Review([second, first, {
    ...first, id: 'oct-reversal', status: 'undone',
  }, { ...first, id: 'nov', period: '2026-11' }], '2026-10');
  assert.equal(review.readyForFiling, false);
  assert.equal(review.canReview, true);
  assert.equal(review.runCount, 2);
  assert.equal(review.employeeOccurrences, 3);
  assert.equal(review.incomeTaxWithheldCents, 65000);
  assert.equal(review.nationalEmployeeCents, 13345);
  assert.equal(review.nationalEmployerCents, 25456);
  assert.equal(review.healthEmployeeCents, 8190);
  assert.equal(review.nationalAndHealthCents, 46991);
  assert.match(review.warnings.join(' '), /excluded/);
});

test('E-18 missing values are NEVER silently zero or converted from US FICA', () => {
  for (const variation of [
    { healthEmployeeCents: undefined },
    { nationalEmployeeCents: 3.14 },
    { incomeTaxWithheldCents: -1 },
    { incomeTaxWithheldCents: NaN },
    { incomeTaxWithheldCents: Number.MAX_SAFE_INTEGER + 1 },
    { sourceReviewed: false },
    { currency: 'USD' },
    { employeeCount: 0 },
  ]) {
    const review = israel102Review([{ ...first, ...variation }], '2026-10');
    assert.equal(review.canReview, false, JSON.stringify(variation));
    assert.equal(review.runCount, 0, JSON.stringify(variation));
    assert.equal(review.nationalAndHealthCents, 0, JSON.stringify(variation));
    assert.ok(review.errors.length > 0);
  }
});

test('E-18 no double counting, year boundaries and overflowing totals', () => {
  assert.equal(israel102Review([first, first], '2026-10').canReview, false);
  assert.equal(israel102Review([first], '2026-00').canReview, false);
  assert.equal(israel102Review([first], '2026-13').canReview, false);
  assert.equal(israel102Review([first], '2025-10').canReview, false);
  const huge: Israel102ReviewRun = {
    ...first, incomeTaxWithheldCents: Number.MAX_SAFE_INTEGER - 1000,
  };
  assert.equal(israel102Review([huge, second], '2026-10').canReview, false);
});

test('E-18 does not mutate frozen inputs and permits verified zero categories', () => {
  const zero = Object.freeze({ ...first, nationalEmployeeCents: 0, nationalEmployerCents: 0, healthEmployeeCents: 0 });
  const input = Object.freeze([zero]);
  const summary = israel102Review(input, '2026-10');
  assert.equal(summary.canReview, true);
  assert.equal(summary.nationalAndHealthCents, 0);
  assert.equal(summary.incomeTaxWithheldCents, 60000);
  assert.equal(summary.readyForFiling, false);
});
