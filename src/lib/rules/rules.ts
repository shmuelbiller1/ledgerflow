/**
 * Rules (docs/PLAN.md §10): what the law or a policy makes of the facts. A rule says when it applies
 * (conditions on composed facts), over what scope (a line, a document, an entity for a period), from
 * and until when, on whose authority, and how it combines with others:
 *  - accumulate: it adds to what other rules do (a state rate and a city rate);
 *  - override: it replaces named rules (a reduced rate in place of the standard one);
 *  - exclude: it switches named rules off (exemption from VAT for an osek patur).
 * A rule may require some facts to be verified, not only declared: then a label alone is not
 * enough, and the rule is reported as blocked with what is missing. Every answer says which rules
 * applied, why, which did not and why: the evidence trail. Pure; no rule is guessed.
 */
import type { ComposedFacts, FactAttribute } from './facts';

export type RuleScope = 'line' | 'document' | 'entity-period';

export interface Condition {
  attribute: FactAttribute;
  /** equals one of these (in), equals none of these (notIn), or is stated at all (exists) */
  op: 'in' | 'notIn' | 'exists' | 'missing';
  values?: string[];
}

export interface Rule<E = unknown> {
  id: string;
  name: string;
  scope: RuleScope;
  when: Condition[];
  /** facts that must be verified (with evidence), not just declared by a label */
  requiresVerified?: FactAttribute[];
  combine: 'accumulate' | 'override' | 'exclude';
  /** the rule ids an override replaces or an exclusion switches off */
  targets?: string[];
  effect: E;
  validFrom: string;
  validTo?: string;
  source: { authority: string; url: string; retrieved?: string };
  /** how far it has been checked (strategic review: calculation / reviewed / filing-ready) */
  status: 'calculation' | 'reviewed' | 'filing-ready';
}

export interface RuleOutcome<E = unknown> {
  applied: Array<{ rule: Rule<E>; because: string[] }>;
  /** the conditions held but verified facts are missing */
  blocked: Array<{ rule: Rule<E>; unverified: FactAttribute[] }>;
  /** replaced or switched off by another rule */
  displaced: Array<{ rule: Rule<E>; by: string }>;
  /** the facts conflict on an attribute a rule reads, or the rule sits in a loop of overrides (`cycle`, the other
   *  rules in it): nothing is decided until a person resolves it */
  undecided: Array<{ rule: Rule<E>; conflicting: FactAttribute[]; cycle?: string[] }>;
}

function holds(c: Condition, facts: ComposedFacts['facts']): boolean {
  const values = facts[c.attribute]?.values || [];
  switch (c.op) {
    case 'exists': return values.length > 0;
    case 'missing': return values.length === 0;
    case 'in': return values.some(v => (c.values || []).includes(v));
    case 'notIn': return values.length > 0 && !values.some(v => (c.values || []).includes(v));
  }
}

const describe = (c: Condition) => `${c.attribute} ${c.op}${c.values ? ` ${c.values.join('|')}` : ''}`;

export function evaluateRules<E>(rules: Rule<E>[], composed: ComposedFacts, input: { date: string; scope: RuleScope }): RuleOutcome<E> {
  const out: RuleOutcome<E> = { applied: [], blocked: [], displaced: [], undecided: [] };
  const conflicted = new Set(composed.conflicts.map(c => c.attribute));
  const candidates: Array<{ rule: Rule<E>; because: string[] }> = [];
  for (const rule of rules) {
    if (rule.scope !== input.scope) continue;
    if (rule.validFrom > input.date || (rule.validTo && input.date > rule.validTo)) continue;
    if (!rule.when.every(c => holds(c, composed.facts))) continue;
    const conflicting = rule.when.map(c => c.attribute).filter(a => conflicted.has(a));
    if (conflicting.length) { out.undecided.push({ rule, conflicting: [...new Set(conflicting)] }); continue; }
    const unverified = (rule.requiresVerified || []).filter(a => !composed.facts[a]?.verified);
    if (unverified.length) { out.blocked.push({ rule, unverified }); continue; }
    candidates.push({ rule, because: rule.when.map(describe) });
  }
  // Exclusions first: an excluded rule never applies and never replaces another.
  const excludedBy = new Map<string, string>();
  for (const { rule } of candidates) if (rule.combine === 'exclude') for (const t of rule.targets || []) if (!excludedBy.has(t)) excludedBy.set(t, rule.id);
  // Then overrides, independent of the order the rules are listed in (#161). A switched-off rule cannot replace
  // another, so a rule stands when every rule overriding it is itself switched off, and is switched off when a rule
  // that stands overrides it. Rules in a loop of overrides are neither: they are left for a person to decide.
  const live = candidates.filter(c => !excludedBy.has(c.rule.id));
  const liveIds = new Set(live.map(c => c.rule.id));
  const overriders = new Map<string, string[]>();
  for (const { rule } of live) if (rule.combine === 'override') for (const t of rule.targets || []) {
    if (t !== rule.id && liveIds.has(t)) overriders.set(t, [...(overriders.get(t) || []), rule.id]);
  }
  const stands = new Set<string>();
  const displacedBy = new Map<string, string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const { rule } of live) {
      const id = rule.id;
      if (stands.has(id) || displacedBy.has(id)) continue;
      const by = (overriders.get(id) || []).filter(o => stands.has(o)).sort()[0];
      if (by) { displacedBy.set(id, by); changed = true; continue; }
      if ((overriders.get(id) || []).every(o => displacedBy.has(o))) { stands.add(id); changed = true; }
    }
  }
  for (const c of candidates) {
    const id = c.rule.id;
    const excluded = excludedBy.get(id);
    if (excluded) out.displaced.push({ rule: c.rule, by: excluded });
    // named once everything is settled, so the same rule is named whatever the listing order
    else if (displacedBy.has(id)) out.displaced.push({ rule: c.rule, by: (overriders.get(id) || []).filter(o => stands.has(o)).sort()[0] });
    else if (stands.has(id)) out.applied.push(c);
    else out.undecided.push({ rule: c.rule, conflicting: [], cycle: (overriders.get(id) || []).filter(o => !displacedBy.has(o)).sort() });
  }
  return out;
}
