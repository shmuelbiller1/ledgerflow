/**
 * Agent #6 (12 Nov 2026, second session) — invariant sweep over money functions that no probe in this
 * repository exercised as a set. The question is not "does the function run" but "does the figure it
 * produces obey the arithmetic an accountant would check by hand":
 *
 *   A loans            principal parts add up to the principal, the schedule closes at zero, payments
 *                      equal principal + interest, and every payment is the level payment but the last.
 *   B depreciation     the schedule sums to cost − salvage, never depreciates below salvage, and the
 *                      book value ends at salvage (straight-line and declining-balance).
 *   C allocation       allocateCents never loses or invents a cent, whatever the weights.
 *   D US withholding   IRS Pub 15-T's own cross-check: 2 × Step2(W/2) === Std(W) (the AF6-004 relation),
 *                      monotonic in wages, and FICA capped at the Social Security wage base.
 *   E minor units      a same-currency conversion is the rate alone; JPY/KWD conversions round-trip.
 *
 * Run: NODE_ENV=test npx tsx audit/agent6-2026-11-12b/probes/invariants.ts
 * Prints OK/DEFECT and exits 0: it documents behaviour, it is not a CI gate (the regression tests for
 * anything it finds go into src/tests/).
 */
import { buildLoanSchedule } from '../../../src/lib/loanSchedule';
import { depreciationSchedule, calculateStraightLineDepreciation } from '../../../src/lib/depreciationEngine';
import { allocateCents } from '../../../src/lib/Allocation';
import { calculateFederalIncomeTaxWithholding, calculateFicaTax } from '../../../src/lib/tax/usFederalPayroll';
import { convertMinorUnits, minorUnitRate } from '../../../src/lib/currencyMinorUnits';
import type { FixedAsset } from '../../../src/types';

let failures = 0;
const report = (id: string, ok: boolean, detail: string, why?: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK    ' : 'DEFECT'} ${id}: ${detail}${ok || !why ? '' : `\n         why: ${why}`}`);
};

// ---------------------------------------------------------------------------------------------
// A. Loans
// ---------------------------------------------------------------------------------------------
console.log('=== A: loan schedules ===');
{
  const cases: Array<[string, number, number, number]> = [
    ['$10,000.00 at 6.5% over 36 months', 1_000_000, 0.065, 36],
    ['$250,000.00 at 3.25% over 360 months', 25_000_000, 0.0325, 360],
    ['$1,234.57 at 12% over 7 months', 123_457, 0.12, 7],
    ['$99.99 at 0% over 3 months', 9_999, 0, 3],
    ['$50,000.00 at 24% over 12 months', 5_000_000, 0.24, 12],
    ['$1.00 at 6% over 1 month', 100, 0.06, 1],
  ];
  for (const [label, principalCents, annualRate, termMonths] of cases) {
    const result = buildLoanSchedule({ principalCents, annualRate, termMonths, startDate: '2026-01-15' });
    if (!result.ok) {
      report(`A ${label}`, false, `refused: ${result.problem}`);
      continue;
    }
    const s = result.schedule;
    const principalSum = s.installments.reduce((sum, i) => sum + i.principalCents, 0);
    const paymentSum = s.installments.reduce((sum, i) => sum + i.paymentCents, 0);
    const interestSum = s.installments.reduce((sum, i) => sum + i.interestCents, 0);
    const lastBalance = s.installments[s.installments.length - 1]?.balanceCents;
    const level = s.installments.slice(0, -1).every(i => i.paymentCents === s.paymentCents);
    const parts = s.installments.every(i => Math.abs(i.interestCents + i.principalCents - i.paymentCents) <= 1);
    const problems: string[] = [];
    if (principalSum !== principalCents) problems.push(`principal parts sum ${principalSum} ≠ ${principalCents}`);
    if (lastBalance !== 0) problems.push(`final balance ${lastBalance} ≠ 0`);
    if (interestSum !== s.totalInterestCents) problems.push(`interest sum ${interestSum} ≠ total ${s.totalInterestCents}`);
    if (paymentSum !== s.totalPaymentsCents) problems.push(`payment sum ${paymentSum} ≠ total ${s.totalPaymentsCents}`);
    if (paymentSum !== principalCents + interestSum) problems.push(`payments ${paymentSum} ≠ principal + interest ${principalCents + interestSum}`);
    if (!level) problems.push('a payment before the last is not the level payment');
    if (!parts) problems.push('interest + principal ≠ payment on some line');
    if (s.installments.length !== termMonths) problems.push(`${s.installments.length} installments for a ${termMonths}-month term`);
    report(`A ${label}`, problems.length === 0, problems.length ? problems.join('; ') : `${termMonths} payments, principal ${principalSum}, interest ${interestSum}, closes at 0`);
  }
}

// ---------------------------------------------------------------------------------------------
// B. Depreciation
// ---------------------------------------------------------------------------------------------
console.log('');
console.log('=== B: depreciation schedules ===');
{
  const asset = (over: Partial<FixedAsset>): FixedAsset => ({
    id: 'fa1', uid: 'u1', workspaceId: 'w', name: 'Machine', purchaseDate: '2026-02-10',
    purchasePriceCents: 1_000_000, salvageValueCents: 100_000, usefulLifeYears: 5,
    depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0, status: 'active', createdAt: '2026-02-10',
    ...over,
  } as FixedAsset);

  for (const over of [
    { depreciationMethod: 'straight-line' as const },
    { depreciationMethod: 'declining-balance' as const },
    { depreciationMethod: 'straight-line' as const, usefulLifeYears: 0.5, purchasePriceCents: 99_999, salvageValueCents: 0 },
    { depreciationMethod: 'straight-line' as const, salvageValueCents: 1_000_000 },
    { depreciationMethod: 'declining-balance' as const, purchasePriceCents: 333_333, salvageValueCents: 33_333, usefulLifeYears: 3 },
  ]) {
    const a = asset(over);
    const months = depreciationSchedule(a);
    const sum = months.reduce((s, m) => s + m.amountCents, 0);
    const depreciable = a.purchasePriceCents - Math.min(a.salvageValueCents, a.purchasePriceCents);
    const floor = Math.min(a.salvageValueCents, a.purchasePriceCents);
    const below = months.filter(m => m.bookValueCents < floor);
    const negative = months.filter(m => m.amountCents < 0);
    const problems: string[] = [];
    if (sum !== depreciable) problems.push(`sum ${sum} ≠ cost − salvage ${depreciable}`);
    if (below.length) problems.push(`${below.length} months below salvage (lowest book value ${Math.min(...below.map(m => m.bookValueCents))})`);
    if (negative.length) problems.push(`${negative.length} negative months`);
    if (months.length && months[months.length - 1].bookValueCents !== floor) problems.push(`ends at book value ${months[months.length - 1].bookValueCents}, not salvage ${floor}`);
    // the legacy monthly entry list must agree with the schedule it was kept for
    const legacy = calculateStraightLineDepreciation(a).reduce((s, e) => s + e.depreciationAmountCents, 0);
    if (over.depreciationMethod === 'straight-line' && legacy !== sum) problems.push(`calculateStraightLineDepreciation sums ${legacy} but the schedule ${sum}`);
    report(
      `B ${over.depreciationMethod} ${a.usefulLifeYears}y cost ${a.purchasePriceCents} salvage ${a.salvageValueCents}`,
      problems.length === 0,
      problems.length ? problems.join('; ') : `${months.length} months, ${sum} depreciated, ends at ${floor}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// C. Allocation
// ---------------------------------------------------------------------------------------------
console.log('');
console.log('=== C: allocateCents ===');
{
  const cases: Array<[string, number, number[]]> = [
    ['1,000.00 over 3 equal parts', 100_000, [1, 1, 1]],
    ['0.01 over 3 parts', 1, [1, 1, 1]],
    ['100.00 by weights 1:2:3:4', 10_000, [1, 2, 3, 4]],
    ['99.99 by weights 0:5:0', 9_999, [0, 5, 0]],
    ['-500.00 over 4 parts (a credit)', -50_000, [1, 1, 1, 1]],
  ];
  for (const [label, total, weights] of cases) {
    const out = allocateCents(total, weights);
    const sum = out.reduce((s, n) => s + n, 0);
    const integers = out.every(n => Number.isInteger(n));
    report(`C ${label}`, sum === total && integers, `parts ${out.join(', ')} sum ${sum} (total ${total})`);
  }
}

// ---------------------------------------------------------------------------------------------
// D. US withholding — IRS Pub 15-T's relation, monotonicity, FICA cap
// ---------------------------------------------------------------------------------------------
console.log('');
console.log('=== D: US federal withholding and FICA ===');
{
  let worst: { wage: number; std: number; twoStep2: number; gap: number } | null = null;
  for (let wage = 2_000_000; wage <= 30_000_000; wage += 250_000) {
    const std = calculateFederalIncomeTaxWithholding(wage, 'single', false, 'annually', '2026-05-01');
    const twoStep2 = 2 * calculateFederalIncomeTaxWithholding(Math.round(wage / 2), 'single', true, 'annually', '2026-05-01');
    const gap = Math.abs(twoStep2 - std);
    if (!worst || gap > worst.gap) worst = { wage, std, twoStep2, gap };
  }
  report(
    'D1 two equal half-salary Step-2 jobs withhold the same as one job (2 x Step2(W/2) = Std(W))',
    Boolean(worst) && worst!.gap <= 200,
    worst ? `worst gap ${worst.gap} cents at annual wages ${worst.wage} (std ${worst.std} vs 2 x step2 ${worst.twoStep2})` : 'no cases',
    'the AF6-004 fix (patches 02) made the Step-2 tables half of (Table 1(a) + Step 1g); a larger gap means a bracket ' +
      'threshold or base tax is not exactly halved for some band',
  );

  let monotonic = true;
  let monotonicAt = '';
  for (const status of ['single', 'married_filing_jointly', 'head_of_household'] as const) {
    let previous = 0;
    for (let wage = 0; wage <= 40_000_000; wage += 100_000) {
      const tax = calculateFederalIncomeTaxWithholding(wage, status, false, 'annually', '2026-05-01');
      if (tax < previous) { monotonic = false; monotonicAt = `${status} at ${wage} cents`; break; }
      previous = tax;
    }
  }
  report('D2 withholding never falls when wages rise', monotonic, monotonic ? 'non-decreasing for all three filing statuses, 0 to $400,000' : `falls at ${monotonicAt}`);

  // FICA: employee Social Security stops at the wage base; Medicare does not.
  const base = 18_450_000; // 2026 SSA contribution and benefit base, $184,500
  const first = calculateFicaTax(base + 1_000_000, 0, 'single', '2026-05-01');
  const second = calculateFicaTax(1_000_000, base, 'single', '2026-05-01');
  report(
    'D3 Social Security stops at the wage base and does not restart for the next period',
    first.socialSecurityEmployeeCents === Math.round(base * 0.062) && second.socialSecurityEmployeeCents === 0,
    `first period (base + $10,000) employee SS ${first.socialSecurityEmployeeCents}, next period ${second.socialSecurityEmployeeCents}`,
  );
  report(
    'D4 Medicare has no wage base',
    second.medicareEmployeeCents > 0,
    `a period paid entirely above the base still has employee Medicare ${second.medicareEmployeeCents}`,
  );
}

// ---------------------------------------------------------------------------------------------
// E. Minor units
// ---------------------------------------------------------------------------------------------
console.log('');
console.log('=== E: minor-unit conversion ===');
{
  const cases: Array<[string, number, number, string, string, number]> = [
    ['USD → USD is the rate alone', 12_345, 1, 'USD', 'USD', 12_345],
    ['EUR 100.00 at 1.0842 → USD', 10_000, 1.0842, 'EUR', 'USD', 10_842],
    ['JPY 100,000 at 0.0067 → USD', 100_000, 0.0067, 'JPY', 'USD', 67_000],
    ['KWD 100.000 at 3.25 → USD', 100_000, 3.25, 'KWD', 'USD', 32_500],
    // $670.00 at ¥149.25 is ¥99,997.50: whole yen, so 99,998 — the half-yen is rounded, not truncated
    ['USD 67,000 at 149.25 → JPY', 67_000, 149.25, 'USD', 'JPY', 99_998],
  ];
  for (const [label, amount, rate, from, to, expected] of cases) {
    const got = convertMinorUnits(amount, rate, from, to);
    report(`E ${label}`, got === expected, `${got} (expected ${expected}, minor-unit rate ${minorUnitRate(rate, from, to)})`);
  }
  const roundTrip = convertMinorUnits(convertMinorUnits(100_000, 0.0067, 'JPY', 'USD'), 1 / 0.0067, 'USD', 'JPY');
  report('E JPY → USD → JPY returns the yen', Math.abs(roundTrip - 100_000) <= 1, `${roundTrip} (from 100,000)`);
}

console.log('');
console.log(failures === 0 ? 'all invariants hold' : `${failures} case(s) reported DEFECT`);
process.exit(0);
