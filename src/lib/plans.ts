/**
 * The one plan table (owner, 13 Oct: two pricing pages and the checkout disagreed). The public
 * pricing page, Settings → Billing & Plan, the admin policy dialog, the server's plan limits and
 * the Stripe checkout all read from here, so a price or limit is changed in one place.
 * Prices are the owner's to set (docs/FOR_YOU.md); features list only what the app does today.
 */
export type PlanId = 'free' | 'growth' | 'pro' | 'enterprise';

export interface Plan {
  id: PlanId;
  name: string;
  monthlyUsd: number;
  description: string;
  limits: { transactions: number; seats: number; storageMb: number };
  features: string[];
  recommended?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: 'free', name: 'Free', monthlyUsd: 0,
    description: 'For trying LedgerFlow and very small businesses',
    limits: { transactions: 100, seats: 1, storageMb: 500 },
    features: ['Up to 100 entries', '1 person', 'All standard reports', 'Invoices in English and Hebrew'],
  },
  {
    id: 'growth', name: 'Growth', monthlyUsd: 29,
    description: 'For a small team keeping its books every week',
    limits: { transactions: 1000, seats: 5, storageMb: 5000 },
    features: ['Up to 1,000 entries', '5 people', 'Bank import and reconciliation', 'Multiple currencies', 'Invoices by email'],
  },
  {
    id: 'pro', name: 'Pro', monthlyUsd: 99, recommended: true,
    description: 'For a growing business with staff, stock and payroll',
    limits: { transactions: 10000, seats: 25, storageMb: 25000 },
    features: ['Up to 10,000 entries', '25 people', 'AI assistant', 'Approvals and audit trail', 'Payroll and stock'],
  },
  {
    id: 'enterprise', name: 'Enterprise', monthlyUsd: 299,
    description: 'For groups of companies',
    limits: { transactions: 1000000, seats: 1000, storageMb: 100000 },
    features: ['Up to 1,000,000 entries', '1,000 people', 'Groups of books and consolidation', 'Two-person rule', 'Priority email support'],
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
