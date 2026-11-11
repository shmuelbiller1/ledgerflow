import type { Bill, Invoice, Payment } from '../types';
import { calculateAmountDue } from './documentMath';

/**
 * Strategy 6 — Plain-English Owner Advisor:
 *  1. Learned Customer Days-to-Pay (predicts when cash actually lands, not invoice dueDate)
 *  2. 13-Week Cash + Tax Reserve Runway (separates Spendable Cash from Sales Tax/VAT & Income Tax Reserves)
 *  3. "Can I Afford to Hire?" Interactive What-If Simulator
 */

export interface CustomerPaymentProfile {
  customerId: string;
  customerName: string;
  paidInvoiceCount: number;
  medianDaysToPay: number;
  weightedAvgDaysToPay: number;
  avgDaysLateVsTerms: number;
  lateRateBps: number;
  reliabilityTier: 'early_or_prompt' | 'predictable_lag' | 'chronic_late' | 'insufficient_history';
}

export interface PredictedReceivableInflow {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  openAmountCents: number;
  statedDueDate: string;
  predictedCollectionDate: string;
  expectedDaysShift: number;
}

function parseIsoDay(iso: string): number | null {
  const clean = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  const ms = Date.parse(`${clean}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function addDaysIso(iso: string, days: number): string {
  const ms = parseIsoDay(iso);
  if (ms === null) return iso.slice(0, 10);
  return new Date(ms + Math.round(days) * 86_400_000).toISOString().slice(0, 10);
}

function diffDays(fromIso: string, toIso: string): number | null {
  const a = parseIsoDay(fromIso);
  const b = parseIsoDay(toIso);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Learns each customer's actual payment speed from historical settled invoices & payments,
 * then forecasts realistic collection dates for currently open invoices.
 */
export function learnCustomerPaymentProfiles(
  invoices: readonly Invoice[],
  payments: readonly Payment[],
  fallbackTermsDays = 30,
): {
  profiles: Map<string, CustomerPaymentProfile>;
  predictedInflows: PredictedReceivableInflow[];
} {
  // Index latest payment date per invoice allocation (and fallback by customerId)
  const paidDateByInvoiceId = new Map<string, string>();
  for (const pay of payments) {
    if (pay.status === 'void') continue;
    const payAny = pay as unknown as { paymentDate?: string; date?: string };
    const payDay = String(payAny.paymentDate || payAny.date || '').slice(0, 10);
    if (!payDay) continue;
    for (const alloc of pay.allocations || []) {
      if (alloc.documentType && alloc.documentType !== 'invoice') continue;
      const prev = paidDateByInvoiceId.get(alloc.documentId);
      if (!prev || payDay > prev) {
        paidDateByInvoiceId.set(alloc.documentId, payDay);
      }
    }
  }

  const samplesByCustomer = new Map<
    string,
    { name: string; rows: Array<{ daysToPay: number; daysLate: number; weightCents: number }> }
  >();

  for (const inv of invoices) {
    if (!inv.customerId || inv.status !== 'paid') continue;
    const issueDay = String(inv.date || '').slice(0, 10);
    const paidDay =
      paidDateByInvoiceId.get(inv.id) ||
      String((inv as unknown as { paidAt?: string }).paidAt || inv.updatedAt || '').slice(0, 10);
    const daysToPay = diffDays(issueDay, paidDay);
    if (daysToPay === null || daysToPay < 0 || daysToPay > 365) continue;

    const statedTerms = inv.dueDate ? (diffDays(issueDay, inv.dueDate) ?? fallbackTermsDays) : fallbackTermsDays;
    const daysLate = daysToPay - Math.max(0, statedTerms);
    const bucket = samplesByCustomer.get(inv.customerId) || {
      name: inv.customerName || inv.customerId,
      rows: [],
    };
    bucket.rows.push({
      daysToPay,
      daysLate,
      weightCents: Math.max(100, Math.trunc(inv.amountCents || 0)),
    });
    samplesByCustomer.set(inv.customerId, bucket);
  }

  const profiles = new Map<string, CustomerPaymentProfile>();
  for (const [customerId, { name, rows }] of samplesByCustomer.entries()) {
    const sortedDays = rows.map(r => r.daysToPay).sort((a, b) => a - b);
    const mid = Math.floor(sortedDays.length / 2);
    const medianDaysToPay =
      sortedDays.length % 2 === 1
        ? sortedDays[mid]
        : Math.round((sortedDays[mid - 1] + sortedDays[mid]) / 2);

    const totalWeight = rows.reduce((s, r) => s + r.weightCents, 0);
    const weightedAvgDaysToPay = Math.round(
      rows.reduce((s, r) => s + r.daysToPay * r.weightCents, 0) / Math.max(1, totalWeight),
    );
    const avgDaysLateVsTerms = Math.round(
      rows.reduce((s, r) => s + r.daysLate, 0) / rows.length,
    );
    const lateCount = rows.filter(r => r.daysLate > 2).length;
    const lateRateBps = Math.round((lateCount * 10_000) / rows.length);

    let reliabilityTier: CustomerPaymentProfile['reliabilityTier'] = 'insufficient_history';
    if (rows.length >= 2) {
      if (avgDaysLateVsTerms <= 2) reliabilityTier = 'early_or_prompt';
      else if (avgDaysLateVsTerms <= 14) reliabilityTier = 'predictable_lag';
      else reliabilityTier = 'chronic_late';
    }

    profiles.set(customerId, {
      customerId,
      customerName: name,
      paidInvoiceCount: rows.length,
      medianDaysToPay,
      weightedAvgDaysToPay,
      avgDaysLateVsTerms,
      lateRateBps,
      reliabilityTier,
    });
  }

  const predictedInflows: PredictedReceivableInflow[] = [];
  for (const inv of invoices) {
    if (inv.status === 'draft' || inv.status === 'void' || inv.status === 'paid') continue;
    const openAmountCents = calculateAmountDue(inv);
    if (openAmountCents <= 0) continue;

    const issueDay = String(inv.date || '').slice(0, 10);
    const statedDueDate = String(inv.dueDate || addDaysIso(issueDay, fallbackTermsDays)).slice(0, 10);
    const profile = inv.customerId ? profiles.get(inv.customerId) : undefined;

    let predictedCollectionDate = statedDueDate;
    if (profile && profile.paidInvoiceCount >= 2 && issueDay) {
      const fromIssue = addDaysIso(issueDay, profile.weightedAvgDaysToPay);
      predictedCollectionDate = fromIssue;
    }

    const expectedDaysShift = diffDays(statedDueDate, predictedCollectionDate) ?? 0;
    predictedInflows.push({
      invoiceId: inv.id,
      invoiceNumber: inv.number || inv.id,
      customerId: inv.customerId || '',
      customerName: inv.customerName || profile?.customerName || 'Customer',
      openAmountCents,
      statedDueDate,
      predictedCollectionDate,
      expectedDaysShift,
    });
  }

  return { profiles, predictedInflows };
}

export interface ThirteenWeekBucket {
  weekNumber: number;
  weekStart: string;
  weekEnd: string;
  arInflowCents: number;
  apAndRecurringOutflowCents: number;
  endingGrossCashCents: number;
  cumulativeTaxReserveCents: number;
  endingSpendableCashCents: number;
}

export interface ThirteenWeekRunwayResult {
  startDate: string;
  startingGrossCashCents: number;
  startingSpendableCashCents: number;
  weeks: ThirteenWeekBucket[];
  lowestSpendableCashCents: number;
  lowestWeekNumber: number;
  lowestWeekStart: string;
  weeksUntilSpendableNegative: number | null;
  plainEnglishHeadline: string;
}

export function computeThirteenWeekTaxSafeRunway(input: {
  startingCashCents: number;
  startDate: string;
  openInvoices: readonly Invoice[];
  openBills: readonly Bill[];
  payments?: readonly Payment[];
  recurringWeeklyPayrollCents?: number;
  recurringWeeklyOpexCents?: number;
  /** Unremitted sales tax / VAT already sitting in bank cash that belongs to tax authorities. */
  existingTaxTrustLiabilityCents?: number;
  /** Estimated income/estimated-tax set-aside rate on positive net operating inflow in bps (e.g. 2000 = 20%). */
  estimatedIncomeTaxReserveBps?: number;
}): ThirteenWeekRunwayResult {
  const { predictedInflows } = learnCustomerPaymentProfiles(
    input.openInvoices,
    input.payments || [],
  );

  const weeklyPayroll = Math.max(0, Math.trunc(input.recurringWeeklyPayrollCents || 0));
  const weeklyOpex = Math.max(0, Math.trunc(input.recurringWeeklyOpexCents || 0));
  const incomeTaxBps = Math.max(0, Math.min(6000, Math.trunc(input.estimatedIncomeTaxReserveBps ?? 2000)));

  let grossCash = Math.trunc(input.startingCashCents);
  let taxReserve = Math.max(0, Math.trunc(input.existingTaxTrustLiabilityCents || 0));
  const startingSpendableCashCents = grossCash - taxReserve;

  const weeks: ThirteenWeekBucket[] = [];
  let lowestSpendableCashCents = startingSpendableCashCents;
  let lowestWeekNumber = 0;
  let lowestWeekStart = input.startDate;
  let weeksUntilSpendableNegative: number | null = startingSpendableCashCents < 0 ? 0 : null;

  for (let w = 0; w < 13; w++) {
    const weekStart = addDaysIso(input.startDate, w * 7);
    const weekEnd = addDaysIso(input.startDate, w * 7 + 6);

    // Include overdue predicted inflows in Week 1 so nothing vanishes before startDate
    const arInflowCents = predictedInflows
      .filter(p => (w === 0 ? p.predictedCollectionDate <= weekEnd : p.predictedCollectionDate >= weekStart && p.predictedCollectionDate <= weekEnd))
      .reduce((s, p) => s + p.openAmountCents, 0);

    const apBillsDueCents = input.openBills
      .filter(b => {
        if (b.status === 'draft' || b.status === 'void' || b.status === 'paid') return false;
        const dueDay = String(b.dueDate || b.date || input.startDate).slice(0, 10);
        return w === 0 ? dueDay <= weekEnd : dueDay >= weekStart && dueDay <= weekEnd;
      })
      .reduce((s, b) => s + calculateAmountDue(b), 0);

    const apAndRecurringOutflowCents = apBillsDueCents + weeklyPayroll + weeklyOpex;
    const netOperatingDelta = arInflowCents - apAndRecurringOutflowCents;

    if (netOperatingDelta > 0 && incomeTaxBps > 0) {
      taxReserve += Math.round((netOperatingDelta * incomeTaxBps) / 10_000);
    }

    grossCash += netOperatingDelta;
    const endingSpendableCashCents = grossCash - taxReserve;

    if (endingSpendableCashCents < lowestSpendableCashCents) {
      lowestSpendableCashCents = endingSpendableCashCents;
      lowestWeekNumber = w + 1;
      lowestWeekStart = weekStart;
    }
    if (weeksUntilSpendableNegative === null && endingSpendableCashCents < 0) {
      weeksUntilSpendableNegative = w + 1;
    }

    weeks.push({
      weekNumber: w + 1,
      weekStart,
      weekEnd,
      arInflowCents,
      apAndRecurringOutflowCents,
      endingGrossCashCents: grossCash,
      cumulativeTaxReserveCents: taxReserve,
      endingSpendableCashCents,
    });
  }

  const plainEnglishHeadline =
    weeksUntilSpendableNegative !== null
      ? `Heads up: after setting aside taxes, spendable cash dips below zero in Week ${weeksUntilSpendableNegative} (${lowestWeekStart}).`
      : `Spendable cash stays positive across all 13 weeks after tax reserves (lowest point: Week ${lowestWeekNumber || 1}).`;

  return {
    startDate: input.startDate,
    startingGrossCashCents: Math.trunc(input.startingCashCents),
    startingSpendableCashCents,
    weeks,
    lowestSpendableCashCents,
    lowestWeekNumber: lowestWeekNumber || 1,
    lowestWeekStart,
    weeksUntilSpendableNegative,
    plainEnglishHeadline,
  };
}

export interface HiringAffordabilityResult {
  verdict: 'comfortable' | 'tight_but_feasible' | 'wait_or_stage';
  fullyLoadedAnnualCostCents: number;
  fullyLoadedMonthlyCostCents: number;
  fullyLoadedWeeklyCostCents: number;
  postHireLowestSpendableCashCents: number;
  safetyBufferCents: number;
  safetyBufferBreached: boolean;
  earliestSafeStartWeek: number | null;
  explanation: string;
}

/**
 * Interactive "Can I Afford to Hire?" simulator over the 13-week tax-safe cash runway.
 */
export function evaluateHiringAffordability(input: {
  runway: ThirteenWeekRunwayResult;
  annualBaseSalaryCents: number;
  /** Employer taxes + benefits burden in bps (default 1800 = 18%). */
  payrollBurdenBps?: number;
  /** One-time laptop, recruiting, or onboarding spend in Week `startWeekNumber`. */
  onboardingCostCents?: number;
  /** 1-indexed week in the 13-week window when the hire starts (default 1). */
  startWeekNumber?: number;
  /** Desired cash cushion that spendable cash should never drop below (default: 4 weeks of hire cost). */
  minSafetyBufferCents?: number;
  /** Optional expected monthly gross profit lift after ramp. */
  expectedMonthlyRevenueLiftCents?: number;
  rampWeeks?: number;
}): HiringAffordabilityResult {
  const burdenBps = Math.max(0, Math.trunc(input.payrollBurdenBps ?? 1800));
  const fullyLoadedAnnualCostCents = Math.round(
    (Math.max(0, Math.trunc(input.annualBaseSalaryCents)) * (10_000 + burdenBps)) / 10_000,
  );
  const fullyLoadedMonthlyCostCents = Math.round(fullyLoadedAnnualCostCents / 12);
  const fullyLoadedWeeklyCostCents = Math.round(fullyLoadedAnnualCostCents / 52);
  const onboarding = Math.max(0, Math.trunc(input.onboardingCostCents ?? 0));
  const safetyBufferCents =
    input.minSafetyBufferCents !== undefined
      ? Math.max(0, Math.trunc(input.minSafetyBufferCents))
      : fullyLoadedWeeklyCostCents * 4;
  const weeklyLiftAfterRamp = Math.round(Math.max(0, Math.trunc(input.expectedMonthlyRevenueLiftCents ?? 0)) * 12 / 52);
  const rampWeeks = Math.max(0, Math.trunc(input.rampWeeks ?? 8));

  const simulateFromStartWeek = (startWeek: number): number => {
    let cumulativeHireDrain = 0;
    let lowest = Infinity;
    for (const wk of input.runway.weeks) {
      if (wk.weekNumber >= startWeek) {
        const weeksEmployed = wk.weekNumber - startWeek;
        cumulativeHireDrain += fullyLoadedWeeklyCostCents;
        if (weeksEmployed === 0) cumulativeHireDrain += onboarding;
        if (weeksEmployed >= rampWeeks && weeklyLiftAfterRamp > 0) {
          cumulativeHireDrain -= weeklyLiftAfterRamp;
        }
      }
      const postHireSpendable = wk.endingSpendableCashCents - cumulativeHireDrain;
      if (postHireSpendable < lowest) lowest = postHireSpendable;
    }
    return Number.isFinite(lowest) ? lowest : input.runway.startingSpendableCashCents;
  };

  const chosenStart = Math.min(13, Math.max(1, Math.trunc(input.startWeekNumber ?? 1)));
  const postHireLowestSpendableCashCents = simulateFromStartWeek(chosenStart);
  const safetyBufferBreached = postHireLowestSpendableCashCents < safetyBufferCents;

  let earliestSafeStartWeek: number | null = null;
  for (let candidate = 1; candidate <= 13; candidate++) {
    if (simulateFromStartWeek(candidate) >= safetyBufferCents) {
      earliestSafeStartWeek = candidate;
      break;
    }
  }

  let verdict: HiringAffordabilityResult['verdict'];
  let explanation: string;

  if (postHireLowestSpendableCashCents >= safetyBufferCents) {
    verdict = 'comfortable';
    explanation = `Yes — hiring in Week ${chosenStart} keeps tax-safe spendable cash at or above your safety cushion across all 13 weeks.`;
  } else if (postHireLowestSpendableCashCents >= 0) {
    verdict = 'tight_but_feasible';
    explanation = earliestSafeStartWeek
      ? `Tight in Week ${chosenStart} (dips below your safety cushion, though still above $0). Waiting until Week ${earliestSafeStartWeek} keeps your full cushion intact.`
      : `Spendable cash stays above $0, but dips below your recommended 4-week safety buffer during the next 13 weeks.`;
  } else {
    verdict = 'wait_or_stage';
    explanation = earliestSafeStartWeek
      ? `Starting in Week ${chosenStart} pushes tax-safe spendable cash negative. Delaying the start to Week ${earliestSafeStartWeek} avoids a cash shortfall.`
      : `Not yet without new collections or financing — this hire pushes spendable cash below $0 within the 13-week window.`;
  }

  return {
    verdict,
    fullyLoadedAnnualCostCents,
    fullyLoadedMonthlyCostCents,
    fullyLoadedWeeklyCostCents,
    postHireLowestSpendableCashCents,
    safetyBufferCents,
    safetyBufferBreached,
    earliestSafeStartWeek,
    explanation,
  };
}
