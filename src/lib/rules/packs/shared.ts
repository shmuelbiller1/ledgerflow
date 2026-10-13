/**
 * A-38 / PLAN §10: shared shapes for the tax rule packs. A pack turns a dated rate table into
 * `Rule` rows the rule graph reads, so a country's table is content and `evaluateRules` is the only
 * place that decides. Nothing here posts: the packs are data with sources and a status.
 */
import type { Condition, Rule, RuleScope } from '../rules';
import type { FactAttribute } from '../facts';

/** The effect of a rate rule: one component the line's tax is built from. */
export interface RateEffect {
  kind: 'rate';
  /** country, state, county, city or district — the same levels `resolveLineTax` uses */
  level: 'country' | 'state' | 'county' | 'city' | 'district';
  /** the name shown on the line and in a return */
  name: string;
  rate: number;
}

/** The effect of a nexus rule: the point a state may require registration (never a conclusion). */
export interface NexusEffect {
  kind: 'nexus';
  thresholdCents: number | null;
  transactions: number | null;
  test: 'either' | 'both';
}

/** A dated turnover comparison, not a conclusion that an entity must register. */
export type RegistrationThresholdWindow =
  | 'calendar-year-to-date'
  | 'rolling-12-months'
  | 'canada-single-quarter-series'
  | 'canada-previous-four-quarters'
  | 'eu-current-and-previous-calendar-year';

export interface RegistrationThresholdEffect {
  kind: 'registration-threshold';
  scheme: 'il-osek-patur' | 'uk-vat' | 'ca-gst-small-supplier' | 'eu-oss-place-of-supply';
  currency: string;
  thresholdCents: number;
  activityValue: string;
  window: RegistrationThresholdWindow;
  note: string;
  guidanceUrl?: string;
}

/** The effect of a filing rule (PLAN §10, entity-period scope): a return or form the entity files. */
export interface FilingEffect {
  kind: 'filing';
  /** the form's own name, e.g. "Form 1120-S", "דוח שנתי 1214" */
  form: string;
  frequency: 'monthly' | 'bimonthly' | 'quarterly' | 'yearly';
  /** when it is due, in words from the source ("15th day of the 3rd month after year end") */
  due: string;
}

/**
 * A-41: the effect of a channel rule. It answers who taxes the sale, not how much: 'marketplace'
 * means the facilitator is required to collect, so the seller's own rate rules are switched off.
 * It is never a rate of zero written on the line, so a screen can say why the line has no tax.
 */
export interface MarketplaceEffect {
  kind: 'marketplace';
  state: string;
  stateName: string;
  /** the date this row is asserted from (never the law's own effective date) */
  assertedFrom: string;
  note: string;
}

/**
 * A-43: the effect of a withholding-at-source rule — the default percentage the payer holds back on a
 * payment to a vendor who has no current approval. It is a suggested rate with the source it was read
 * from; the vendor's own approval always replaces it, and a person confirms before the payment.
 */
export interface WithholdingDefaultEffect {
  kind: 'withholding-default';
  paymentType: string;
  /** 'israel' for an Israeli resident, 'foreign' for a non-resident */
  residence: 'israel' | 'foreign';
  ratePercent: number;
  /** what the percentage is taken from, where the source settles it */
  base: 'payment-less-vat' | 'payment-including-vat' | 'unspecified';
  note: string;
}

export type TaxEffect = RateEffect | NexusEffect | RegistrationThresholdEffect | FilingEffect | MarketplaceEffect | WithholdingDefaultEffect;

/** A table row a pack could not turn into a rule (a category it cannot name, a place it does not know). */
export interface UnmappedRow {
  /** what the row was about: a row id, a country and a label */
  row: string;
  /** why no rule was written */
  reason: string;
}

export interface TaxRulePack {
  id: string;
  name: string;
  /** the rules, in the order they were built */
  rules: Array<Rule<TaxEffect>>;
  /** rows deliberately left out, each with the reason (never silently dropped) */
  unmapped: UnmappedRow[];
}

/** One condition on a fact, for readability at the call sites. */
export const where = (attribute: FactAttribute, values: string[]): Condition => ({ attribute, op: 'in', values });

/** A rate rule whose conditions are the facts that must hold and whose effect is one component. */
export function rateRule<E extends TaxEffect = RateEffect>(input: {
  id: string;
  name: string;
  scope?: RuleScope;
  when: Condition[];
  effect: E;
  validFrom: string;
  validTo?: string;
  source: { authority: string; url: string; retrieved?: string };
  status?: Rule<E>['status'];
  combine?: Rule<E>['combine'];
  targets?: string[];
  requiresVerified?: FactAttribute[];
}): Rule<E> {
  return {
    id: input.id,
    name: input.name,
    scope: input.scope || 'line',
    when: input.when,
    combine: input.combine || 'accumulate',
    ...(input.targets ? { targets: input.targets } : {}),
    ...(input.requiresVerified ? { requiresVerified: input.requiresVerified } : {}),
    effect: input.effect,
    validFrom: input.validFrom,
    ...(input.validTo ? { validTo: input.validTo } : {}),
    source: input.source,
    status: input.status || 'calculation',
  };
}

/** A stable rule id piece: dates and codes only, so `targets` can name rules before they are built. */
export const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
