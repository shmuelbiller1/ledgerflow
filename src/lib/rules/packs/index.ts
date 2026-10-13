/**
 * A-38 / PLAN §10: every tax table this lane owns, written as rule packs. One place lists them, one
 * function reads them all, and one check holds them to their promises: every rule has a source, a
 * status of 'calculation' (nothing here is reviewed or filing-ready), and no two rules of the same
 * pack overlap in time on the same facts with a different rate.
 *
 * The packs are content for `evaluateRules`; the engine (AI #1's lane) decides when to read them.
 */
import type { Rule } from '../rules';
import { usSalesTaxPack } from './usSalesTaxPack';
import { canadaVatPack } from './canadaVatPack';
import { euVatPack } from './euVatPack';
import { ukVatPack } from './ukVatPack';
import { ilVatPack } from './ilVatPack';
import { usNexusPack } from './usNexusPack';
import { productTaxabilityPack } from './productTaxabilityPack';
import { filingPack } from './filingPack';
import { registrationThresholdPack } from './registrationThresholdPack';
import { marketplaceChannelPack } from './marketplacePack';
import { ilWithholdingPack } from './ilWithholdingPack';
import type { TaxEffect, TaxRulePack, UnmappedRow } from './shared';

export { usSalesTaxPack } from './usSalesTaxPack';
export { canadaVatPack } from './canadaVatPack';
export { euVatPack, categoriesInWords } from './euVatPack';
export { ukVatPack } from './ukVatPack';
export { ilVatPack } from './ilVatPack';
export { usNexusPack } from './usNexusPack';
export { productTaxabilityPack, stateSalesRuleIds } from './productTaxabilityPack';
export { registrationThresholdPack } from './registrationThresholdPack';
export { marketplaceChannelPack, marketplaceRuleId } from './marketplacePack';
export { ilWithholdingPack } from './ilWithholdingPack';
// the packs' own tooling (A-59, A-60): what the source pages answered, and what changed since a snapshot
export {
  ruleSourceIndex, checkRuleSources, sourceReportLines, sourceReportSummary, sourceReportMarkdown,
  type RuleSourceEntry, type SourceCheckResult, type SourceCheckStatus, type SourceReport, type CheckRuleSourcesOptions,
} from '../sourceCheck';
export {
  snapshotRule, diffRuleSnapshots, diffIsEmpty, packDiffMarkdown, RULE_DIFF_FIELDS,
  type RuleSnapshot, type RulePackDiff, type ChangedField,
} from '../packDiff';
export {
  usLocalRatePack, localRateKey,
  type LocalKeyAttribute, type LocalRateEffect, type LocalRateKeyResult,
} from './usLocalRatePack';
export { filingPack } from './filingPack';
export { rateRule, where, slug, type TaxEffect, type TaxRulePack, type RateEffect, type NexusEffect, type RegistrationThresholdEffect, type RegistrationThresholdWindow, type UnmappedRow, type FilingEffect } from './shared';

/** Every pack, in the order a screen should list them. */
export function taxRulePacks(): TaxRulePack[] {
  return [ilVatPack(), usSalesTaxPack(), usNexusPack(), productTaxabilityPack(), canadaVatPack(), ukVatPack(), euVatPack(), registrationThresholdPack(), filingPack(), marketplaceChannelPack(), ilWithholdingPack()];
}

/** Every rule in every pack. */
export function allTaxRules(): Array<Rule<TaxEffect>> {
  return taxRulePacks().flatMap(pack => pack.rules);
}

/** The rows no pack could turn into a rule, with the pack they came from. */
export function unmappedTaxRows(): Array<UnmappedRow & { pack: string }> {
  return taxRulePacks().flatMap(pack => pack.unmapped.map(u => ({ ...u, pack: pack.id })));
}

export interface PackProblem {
  pack: string;
  rule?: string;
  problem: string;
}

/**
 * What a pack must be able to say about itself. A problem here is a bug in the pack, not a tax
 * opinion: it never decides a rate.
 */
export function taxRulePackProblems(): PackProblem[] {
  const problems: PackProblem[] = [];
  const packs = taxRulePacks();
  // a target may name a rule in another pack (an exemption switches off a state's own rate rule)
  const allIds = new Set(packs.flatMap(p => p.rules.map(r => r.id)));
  const seen = new Set<string>();
  for (const pack of packs) {
    if (!pack.id || !pack.name) problems.push({ pack: pack.id, problem: 'the pack needs an id and a name' });
    for (const rule of pack.rules) {
      if (seen.has(rule.id)) problems.push({ pack: pack.id, rule: rule.id, problem: 'duplicate rule id' });
      seen.add(rule.id);
      if (!rule.source?.url?.startsWith('https://')) problems.push({ pack: pack.id, rule: rule.id, problem: 'the rule needs an https source' });
      if (rule.status !== 'calculation') problems.push({ pack: pack.id, rule: rule.id, problem: `status is ${rule.status}, this lane writes 'calculation'` });
      if (rule.validTo && rule.validTo < rule.validFrom) problems.push({ pack: pack.id, rule: rule.id, problem: 'validTo is before validFrom' });
      if (!rule.when.length) problems.push({ pack: pack.id, rule: rule.id, problem: 'a rule without conditions would apply to everything' });
      for (const target of rule.targets || []) {
        if (!allIds.has(target)) problems.push({ pack: pack.id, rule: rule.id, problem: `targets ${target}, which no pack defines` });
      }
    }
    problems.push(...overlaps(pack));
  }
  return problems;
}

/** The same facts answered twice with two different rates at the same time. */
function overlaps(pack: TaxRulePack): PackProblem[] {
  const problems: PackProblem[] = [];
  // the same tax (same effect name) on the same facts twice with different rates is a conflict;
  // two different taxes that accumulate (Canada's GST and PST) are exactly what the graph is for
  const keyOf = (rule: Rule<TaxEffect>) => rule.effect.kind === 'rate'
    ? `${rule.scope}|${rule.effect.name}|${rule.when.map(c => `${c.attribute}:${(c.values || []).join(',')}`).join('&')}`
    : `${rule.scope}|${rule.id}`;
  for (const rule of pack.rules) {
    if (rule.combine !== 'accumulate' || rule.effect.kind !== 'rate') continue;
    for (const other of pack.rules) {
      if (other === rule || other.combine !== 'accumulate' || other.effect.kind !== 'rate') continue;
      if (keyOf(other) !== keyOf(rule)) continue;
      const startsBeforeOtherEnds = !rule.validTo || !other.validFrom || rule.validTo >= other.validFrom;
      const endsAfterOtherStarts = !other.validTo || rule.validFrom <= other.validTo;
      if (startsBeforeOtherEnds && endsAfterOtherStarts && rule.effect.rate !== other.effect.rate) {
        problems.push({ pack: pack.id, rule: rule.id, problem: `overlaps ${other.id} with a different rate` });
      }
    }
  }
  return problems;
}
