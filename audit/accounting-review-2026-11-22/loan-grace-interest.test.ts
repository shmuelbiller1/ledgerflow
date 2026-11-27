// Pure loan schedule verification for odd first periods / payment holidays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoanSchedule } from '../../src/lib/loanSchedule';

test('3-month grace period and 7-day stub both charge exactly one month of first-period interest', () => {
  const grace = buildLoanSchedule({
    principalCents: 10_000_000, // $100,000.00
    annualRate: 0.12,
    termMonths: 12,
    startDate: '2026-01-01',
    firstPaymentDate: '2026-04-01', // 3 full months after disbursement
  });
  assert.equal(grace.ok, true);
  if (!grace.ok) return;

  const stub = buildLoanSchedule({
    principalCents: 10_000_000, // $100,000.00
    annualRate: 0.12,
    termMonths: 12,
    startDate: '2026-01-25',
    firstPaymentDate: '2026-02-01', // 7 days after disbursement
  });
  assert.equal(stub.ok, true);
  if (!stub.ok) return;

  // Expected 3-month interest on $100,000 at 12% p.a.:
  // Simple monthly (3 * 1%): 300,000 cents ($3,000.00); monthly compounded: 303,010 cents ($3,030.10); ACT/365 (90/365): 295,890 cents ($2,958.90).
  // Expected 7-day ACT/365 interest (7/365 * 12%): 23,014 cents ($230.14).
  // Current schedule charges 100,000 cents ($1,000.00) in BOTH cases.
  assert.equal(grace.schedule.installments[0].interestCents, 100_000);
  assert.equal(stub.schedule.installments[0].interestCents, 100_000);
  assert.equal(grace.schedule.totalInterestCents, stub.schedule.totalInterestCents);
  console.log(JSON.stringify({
    graceFirstInterestCents: grace.schedule.installments[0].interestCents,
    expectedSimpleThreeMonthInterestCents: 300_000,
    stubSevenDayFirstInterestCents: stub.schedule.installments[0].interestCents,
    expectedAct365SevenDayInterestCents: 23_014,
  }));
});
