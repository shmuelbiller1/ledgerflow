/**
 * AI credits (docs/design/AI-CREDITS.md): what an AI call costs us, plus a markup, shown as whole
 * credits. 1 credit = $0.001 of price, so 1 cent of price = 10 credits. Failed calls and answers the
 * books give without a model are never charged.
 */

/** Default markup on real model cost (20%); the admin can override it per workspace (`aiCreditMarkup`). */
export const DEFAULT_AI_MARKUP = 0.2;
/** Credits per cent of price. */
export const CREDITS_PER_CENT = 10;

/** Monthly included credits by plan. They reset on the 1st (UTC) and do not roll over. */
export const PLAN_AI_CREDITS: Record<string, number> = {
  free: 250,
  growth: 5_000,
  pro: 25_000,
  enterprise: 125_000,
};

/** The markup for a workspace: its admin override when it is a sensible number (0–5 = 0%–500%), else the default. */
export function markupFor(ws: Record<string, unknown> | undefined): number {
  const m = Number(ws?.aiCreditMarkup);
  return Number.isFinite(m) && m >= 0 && m <= 5 && ws?.aiCreditMarkup !== undefined && ws?.aiCreditMarkup !== null ? m : DEFAULT_AI_MARKUP;
}

/** Credits for a real cost in cents, exact (a 0.06¢ call is 0.72 credits, not rounded up). */
export function creditsForCostCents(costCents: number, markup = DEFAULT_AI_MARKUP): number {
  if (!Number.isFinite(costCents) || costCents <= 0) return 0;
  return costCents * (1 + markup) * CREDITS_PER_CENT;
}

export interface AiCreditBalance {
  /** Included this month by the plan (or the admin's "treat as plan" override). */
  included: number;
  /** Granted by the admin for this month. */
  granted: number;
  used: number;
  /** Rounded down for the screen; never negative. */
  left: number;
  markup: number;
  /** The first day of next month (UTC), YYYY-MM-DD. */
  resetsOn: string;
  /** No AI limit (admin "unlimited AI" or billing bypass). */
  unlimited: boolean;
}

/**
 * The workspace's balance from its plan, its admin overrides and this month's use: `settledCredits` were
 * fixed when each call was charged; `costCentsThisMonth` is uncharged cost (older rows), priced at the current markup.
 */
export function aiCreditBalance(ws: Record<string, unknown>, costCentsThisMonth: number, now = new Date(), settledCredits = 0): AiCreditBalance {
  const planKey = String(ws.aiCreditsPlanOverride || ws.plan || 'free').toLowerCase();
  const included = PLAN_AI_CREDITS[planKey] ?? PLAN_AI_CREDITS.free;
  // A grant counts in the month it was given for (`aiCreditsGrantedMonth`, YYYY-MM) only, so one grant
  // can never be spent again after the monthly reset. Grants that carry over need the credit ledger (phase 2).
  const grantedRaw = Number(ws.aiCreditsGranted);
  const grantMonth = now.toISOString().slice(0, 7);
  const granted = Number.isFinite(grantedRaw) && grantedRaw > 0 && ws.aiCreditsGrantedMonth === grantMonth ? grantedRaw : 0;
  const markup = markupFor(ws);
  const used = creditsForCostCents(costCentsThisMonth, markup) + (Number.isFinite(settledCredits) && settledCredits > 0 ? settledCredits : 0);
  const [y, m] = grantMonth.split('-').map(Number);
  const resetsOn = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return {
    included,
    granted,
    used,
    left: Math.max(0, Math.floor(included + granted - used)),
    markup,
    resetsOn,
    unlimited: ws.aiUnlimited === true || ws.bypassBilling === true,
  };
}

/**
 * Credits held for a model turn from its reservation until it is settled, so turns asked together cannot
 * spend past the balance (about one hard question on the strong model). Settlement replaces the hold with
 * the real charge, or 0 for a failed turn.
 */
export const RESERVED_TURN_CREDITS = 15;

/** The balance after `credits` more are used. */
export function settleCredits(balance: AiCreditBalance, credits: number): AiCreditBalance {
  const used = balance.used + (Number.isFinite(credits) && credits > 0 ? credits : 0);
  return { ...balance, used, left: Math.max(0, Math.floor(balance.included + balance.granted - used)) };
}
