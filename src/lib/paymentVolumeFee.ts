import { planFor, type PlanId } from './plans';

export type PaymentRail = 'card' | 'us_bank_account' | 'vendor_payout';

export interface PlatformFeeQuote {
  rail: PaymentRail;
  plan: PlanId;
  grossAmountCents: number;
  platformFeeBps: number;
  platformFeeCents: number;
  estimatedProcessorFeeCents: number;
  netToMerchantCents: number;
  cappedAtCents: number | null;
}

/** Pay-by-bank (ACH) platform fee cap ($5.00), keeping bank transfers cheaper than cards on large invoices. */
export const ACH_PLATFORM_FEE_CAP_CENTS = 500;

/** Per-payout fee in cents for processor-backed vendor ACH payouts inside payment runs. */
export const VENDOR_PAYOUT_FEE_CENTS: Record<PlanId, number> = {
  free: 100,
  growth: 75,
  pro: 50,
  enterprise: 0,
};

/**
 * Computes the platform revenue-share fee (`application_fee_amount`) and net settlement for a
 * payment processed through a licensed payment processor (Stripe Connect / Pay-by-Bank / Payouts).
 */
export function computePlatformFeeQuote(
  grossAmountCents: number,
  planInput: string | null | undefined,
  rail: PaymentRail = 'card',
): PlatformFeeQuote {
  const gross = Math.max(0, Math.round(grossAmountCents));
  const plan = planFor(planInput);
  const planId = plan.id;

  if (gross === 0) {
    return {
      rail,
      plan: planId,
      grossAmountCents: 0,
      platformFeeBps: 0,
      platformFeeCents: 0,
      estimatedProcessorFeeCents: 0,
      netToMerchantCents: 0,
      cappedAtCents: null,
    };
  }

  if (rail === 'vendor_payout') {
    const fee = Math.min(gross, VENDOR_PAYOUT_FEE_CENTS[planId]);
    return {
      rail,
      plan: planId,
      grossAmountCents: gross,
      platformFeeBps: 0,
      platformFeeCents: fee,
      estimatedProcessorFeeCents: 25,
      netToMerchantCents: Math.max(0, gross - fee),
      cappedAtCents: VENDOR_PAYOUT_FEE_CENTS[planId],
    };
  }

  if (rail === 'us_bank_account') {
    const achBps = Math.max(5, Math.floor(plan.limits.platformFeeBps / 2));
    const uncapped = Math.round((gross * achBps) / 10_000);
    const platformFeeCents = Math.min(gross, ACH_PLATFORM_FEE_CAP_CENTS, uncapped);
    const estimatedProcessorFeeCents = Math.min(500, Math.round(gross * 0.008));
    return {
      rail,
      plan: planId,
      grossAmountCents: gross,
      platformFeeBps: achBps,
      platformFeeCents,
      estimatedProcessorFeeCents,
      netToMerchantCents: Math.max(0, gross - platformFeeCents - estimatedProcessorFeeCents),
      cappedAtCents: ACH_PLATFORM_FEE_CAP_CENTS,
    };
  }

  const cardBps = plan.limits.platformFeeBps;
  const platformFeeCents = Math.min(gross, Math.round((gross * cardBps) / 10_000));
  const estimatedProcessorFeeCents = Math.min(gross, Math.round(gross * 0.029) + 30);
  return {
    rail: 'card',
    plan: planId,
    grossAmountCents: gross,
    platformFeeBps: cardBps,
    platformFeeCents,
    estimatedProcessorFeeCents,
    netToMerchantCents: Math.max(0, gross - platformFeeCents - estimatedProcessorFeeCents),
    cappedAtCents: null,
  };
}

export interface PaymentVolumeSummary {
  month: string;
  cardVolumeCents: number;
  bankVolumeCents: number;
  vendorPayoutVolumeCents: number;
  totalVolumeCents: number;
  includedVolumeCents: number;
  platformFeesEarnedCents: number;
}

/** Aggregates monthly processed payment volume across invoice collections and vendor payouts. */
export function summarizePaymentVolume(
  payments: ReadonlyArray<{
    paymentDate?: string;
    date?: string;
    amountCents?: number;
    paymentMethod?: string;
    status?: string;
    metadata?: Record<string, unknown>;
  }>,
  month: string,
  planInput?: string | null,
): PaymentVolumeSummary {
  const plan = planFor(planInput);
  let cardVolumeCents = 0;
  let bankVolumeCents = 0;
  let vendorPayoutVolumeCents = 0;
  let platformFeesEarnedCents = 0;

  for (const p of payments) {
    if (p.status === 'void' || p.status === 'failed') continue;
    const d = String(p.paymentDate || p.date || '').slice(0, 7);
    if (month && d !== month) continue;
    const amt = Math.max(0, Math.round(Number(p.amountCents) || 0));
    if (amt <= 0) continue;

    const method = String(p.paymentMethod || p.metadata?.rail || '').toLowerCase();
    const recordedFee = Number(p.metadata?.platformFeeCents);
    if (method === 'vendor_payout' || p.metadata?.payoutBatchId) {
      vendorPayoutVolumeCents += amt;
      platformFeesEarnedCents += Number.isFinite(recordedFee)
        ? Math.round(recordedFee)
        : computePlatformFeeQuote(amt, plan.id, 'vendor_payout').platformFeeCents;
    } else if (method.includes('bank') || method === 'ach' || method === 'us_bank_account') {
      bankVolumeCents += amt;
      platformFeesEarnedCents += Number.isFinite(recordedFee)
        ? Math.round(recordedFee)
        : computePlatformFeeQuote(amt, plan.id, 'us_bank_account').platformFeeCents;
    } else if (method === 'stripe' || method === 'card' || p.metadata?.stripeSessionId) {
      cardVolumeCents += amt;
      platformFeesEarnedCents += Number.isFinite(recordedFee)
        ? Math.round(recordedFee)
        : computePlatformFeeQuote(amt, plan.id, 'card').platformFeeCents;
    }
  }

  return {
    month,
    cardVolumeCents,
    bankVolumeCents,
    vendorPayoutVolumeCents,
    totalVolumeCents: cardVolumeCents + bankVolumeCents + vendorPayoutVolumeCents,
    includedVolumeCents: plan.limits.paymentVolumeCents,
    platformFeesEarnedCents,
  };
}
