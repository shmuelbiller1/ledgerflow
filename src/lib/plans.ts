import { BRAND_NAME } from '../config/brand';
/**
 * The one plan table. The public pricing page, Settings → Billing & Plan, the admin policy dialog,
 * the server's plan capacity meters and Stripe checkout all read from here, so a price or meter is
 * changed in one place.
 *
 * Strategy 7: Ledger entries are unlimited on every plan so bank feeds and automation are never
 * penalized. Plans meter what scales with customer value: companies/entities, accounting-firm
 * client books, active rental units, monthly processed payment volume, team seats, and storage.
 */
export type PlanId = 'free' | 'growth' | 'pro' | 'enterprise';

export interface PlanLimits {
  /** Unlimited (`null`) on standard plans so usage and automation are never penalized. */
  transactions: number | null;
  /** Included legal entities / workspaces in a group. */
  entities: number;
  /** Included client books for accounting firms & bookkeepers. */
  firmClients: number;
  /** Included active rental units for property & landlord books. */
  rentalUnits: number;
  /** Included monthly online invoice & vendor payout volume in cents. */
  paymentVolumeCents: number;
  /** Platform fee in basis points on card payments (ACH capped separately). */
  platformFeeBps: number;
  /** Whether the Owner Advisor (learned days-to-pay, hiring what-if, safe-cash runway) is included. */
  ownerAdvisorIncluded: boolean;
  seats: number;
  storageMb: number;
}

export interface PlanAddOnPricing {
  extraEntityMonthlyUsd: number;
  extraFirmClientMonthlyUsd: number;
  extraRentalUnitMonthlyUsd: number;
  ownerAdvisorMonthlyUsd: number;
}

export const PLAN_ADD_ON_PRICING: PlanAddOnPricing = {
  extraEntityMonthlyUsd: 39,
  extraFirmClientMonthlyUsd: 19,
  extraRentalUnitMonthlyUsd: 1.5,
  ownerAdvisorMonthlyUsd: 29,
};

export interface Plan {
  id: PlanId;
  name: string;
  monthlyUsd: number;
  description: string;
  limits: PlanLimits;
  features: string[];
  recommended?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: 'free', name: 'Free', monthlyUsd: 0,
    description: `For trying ${BRAND_NAME} and solo books with unlimited entries`,
    limits: {
      transactions: null,
      entities: 1,
      firmClients: 1,
      rentalUnits: 2,
      paymentVolumeCents: 1_000_000,
      platformFeeBps: 50,
      ownerAdvisorIncluded: false,
      seats: 1,
      storageMb: 500,
    },
    features: [
      'Unlimited ledger entries & bank rules',
      '1 company, up to 2 rental units',
      '1 person · 500 MB document vault',
      'All standard reports & English/Hebrew invoices',
    ],
  },
  {
    id: 'growth', name: 'Growth', monthlyUsd: 29,
    description: 'For active businesses, landlords and boutique bookkeepers',
    limits: {
      transactions: null,
      entities: 1,
      firmClients: 5,
      rentalUnits: 15,
      paymentVolumeCents: 5_000_000,
      platformFeeBps: 35,
      ownerAdvisorIncluded: false,
      seats: 5,
      storageMb: 5000,
    },
    features: [
      'Unlimited entries & calibrated auto-posting',
      'Up to 5 firm clients or 15 rental units',
      '5 people · $50k/mo payment volume tier',
      'Bank import, Pay-by-Bank (ACH) & multi-currency',
    ],
  },
  {
    id: 'pro', name: 'Pro', monthlyUsd: 99, recommended: true,
    description: 'For multi-entity operators, property portfolios & accounting practices',
    limits: {
      transactions: null,
      entities: 3,
      firmClients: 25,
      rentalUnits: 75,
      paymentVolumeCents: 25_000_000,
      platformFeeBps: 20,
      ownerAdvisorIncluded: true,
      seats: 25,
      storageMb: 25000,
    },
    features: [
      'Unlimited entries · 3 companies ($39/extra)',
      '25 firm clients · 75 rental units',
      'Owner Advisor (late-payer & hiring scenarios)',
      'Self-balancing labels, payroll, stock & lender pack',
    ],
  },
  {
    id: 'enterprise', name: 'Enterprise', monthlyUsd: 299,
    description: 'For consolidated groups, CPA firms & large portfolios',
    limits: {
      transactions: null,
      entities: 50,
      firmClients: 250,
      rentalUnits: 1000,
      paymentVolumeCents: 250_000_000,
      platformFeeBps: 10,
      ownerAdvisorIncluded: true,
      seats: 1000,
      storageMb: 100000,
    },
    features: [
      'Up to 50 consolidated companies & NCI eliminations',
      '250 firm clients · 1,000 rental units',
      'Zero vendor payout platform fee · 0.10% card tier',
      'Tamper-evident hash chain, US+IL dual tax & two-person rule',
    ],
  },
];

/** Older stored names map onto the table ('sandbox' was the free plan's earlier name). */
export function planFor(id: string | undefined | null): Plan {
  const key = String(id || 'free').toLowerCase();
  const alias: Record<string, PlanId> = { sandbox: 'free', starter: 'free', professional: 'pro' };
  return PLANS.find(p => p.id === (alias[key] || key)) || PLANS[0];
}

/** Yearly billing: 20% off, shown per month. */
export const YEARLY_DISCOUNT = 0.2;
export function priceShown(plan: Plan, yearly: boolean): number {
  return yearly ? Math.round(plan.monthlyUsd * (1 - YEARLY_DISCOUNT)) : plan.monthlyUsd;
}
