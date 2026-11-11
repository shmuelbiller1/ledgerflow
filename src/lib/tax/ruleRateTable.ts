/**
 * Line tax from the rule packs (PLAN §10, the step after A-38): the buyer's place and the item's
 * tax category become facts, `evaluateRules` decides which rate rules apply on the date, and their
 * components are the line's rate. `resolveLineTax` uses this for any place without its own table,
 * so every pack (US states, Canada, the EU, the UK, Israel) prices lines with no code per country.
 * Exclusions and overrides in the packs (exempt categories, reduced rates) work as the engine says.
 * Pure.
 */
import { composeFacts, type Fact } from '../rules/facts';
import { evaluateRules, type Rule } from '../rules/rules';
import { allTaxRules, type RateEffect, type TaxEffect } from '../rules/packs';
import { placeState, type TaxPlace } from './profile';
import type { RateTable, TaxComponent } from './resolveLineTax';

/** The facts a sale line gives the rules: where the buyer is and what is sold. */
export function lineFacts(place: TaxPlace, category?: string): Fact[] {
  const out: Fact[] = [];
  if (place.country) out.push({ attribute: 'country', value: String(place.country) });
  const st = placeState(place);
  if (st) out.push({ attribute: 'state', value: st });
  for (const attribute of ['county', 'city', 'district'] as const) {
    if (place[attribute]) out.push({ attribute, value: String(place[attribute]) });
  }
  if (category) out.push({ attribute: 'productCategory', value: category });
  return out;
}

/** A rate table backed by rules: the applied rate rules' components, or undefined when none apply. */
export function ruleRateTable(rules: Array<Rule<TaxEffect>> = allTaxRules()): RateTable {
  const rateRules = rules.filter(r => r.scope === 'line');
  return (place, date, category) => {
    const facts = composeFacts({ books: lineFacts(place, category) }, {}, [], date);
    const outcome = evaluateRules(rateRules, facts, { date, scope: 'line' });
    const components: TaxComponent[] = outcome.applied
      .map(a => a.rule.effect)
      .filter((e): e is RateEffect => e.kind === 'rate')
      .map(e => ({ level: e.level, name: e.name, rate: e.rate }));
    // an exclusion that applied (an exempt category) means zero, which is an answer, not "no table"
    const excluded = outcome.applied.some(a => a.rule.combine === 'exclude');
    return components.length || excluded ? components : undefined;
  };
}
