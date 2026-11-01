/**
 * A-60: what changed in the rule packs, in words an accountant can read. A dated snapshot of every
 * pack rule is written by hand (`npm run diff:rule-packs -- --snapshot`); the next run compares the
 * packs now against that snapshot and reports the rules that were **added**, the rules that **ended**
 * (they are no longer in the packs) and the rules that **changed** with the field, what it was and
 * what it is now: dates and rates first, which is what a review is for.
 *
 * What this can say: the packs differ from the snapshot in these ways. What it cannot say: that the
 * new value is correct — a person with the source page decides that, which is the whole point of the
 * review. Pure; the snapshot file is read by the script, never by this module.
 */
import type { Rule } from './rules';
import type { TaxEffect } from './packs/shared';

/** The stable, reviewable shape of one rule. Anything not here (ids of targets excluded) is not compared. */
export interface RuleSnapshot {
  pack: string;
  id: string;
  name: string;
  scope: string;
  combine: string;
  validFrom: string;
  validTo?: string;
  isRate: boolean;
  /** for a rate rule: the rate as a fraction; for other rules, undefined */
  rate?: number;
  /** the effect's kind, so a rule that switched kind is visible */
  effectKind: string;
  sourceUrl: string;
  /** the facts it applies to, as `attribute=value` strings sorted for comparison */
  when: string[];
}

/** The fields a review compares, in the order the table shows them. */
export const RULE_DIFF_FIELDS: Array<keyof RuleSnapshot> = [
  'name', 'validFrom', 'validTo', 'rate', 'effectKind', 'combine', 'scope', 'when', 'sourceUrl',
];

const effectOf = (rule: Rule<TaxEffect>) => rule.effect as { kind: string; rate?: number };

export function snapshotRule(pack: string, rule: Rule<TaxEffect>): RuleSnapshot {
  const effect = effectOf(rule);
  return {
    pack,
    id: rule.id,
    name: rule.name,
    scope: rule.scope,
    combine: rule.combine,
    validFrom: rule.validFrom,
    ...(rule.validTo ? { validTo: rule.validTo } : {}),
    isRate: effect.kind === 'rate',
    ...(typeof effect.rate === 'number' ? { rate: effect.rate } : {}),
    effectKind: effect.kind,
    sourceUrl: rule.source?.url || '',
    when: rule.when.map(c => `${c.attribute}=${(c.values || []).join('|')}${c.values ? '' : c.op}`).sort(),
  };
}

export interface ChangedField {
  field: keyof RuleSnapshot;
  before: string;
  after: string;
}

export interface RulePackDiff {
  beforeDate?: string;
  afterDate: string;
  added: RuleSnapshot[];
  ended: RuleSnapshot[];
  changed: Array<{ id: string; pack: string; name: string; fields: ChangedField[] }>;
  unchanged: number;
}

const show = (value: RuleSnapshot[keyof RuleSnapshot] | undefined) =>
  value === undefined ? '—' : Array.isArray(value) ? value.join(', ') : String(value);

/** Compare two snapshots by rule id. Pure. */
export function diffRuleSnapshots(before: RuleSnapshot[], after: RuleSnapshot[], input: { beforeDate?: string; afterDate: string }): RulePackDiff {
  const beforeById = new Map(before.map(rule => [rule.id, rule]));
  const afterById = new Map(after.map(rule => [rule.id, rule]));
  const diff: RulePackDiff = { ...(input.beforeDate ? { beforeDate: input.beforeDate } : {}), afterDate: input.afterDate, added: [], ended: [], changed: [], unchanged: 0 };
  for (const rule of after) if (!beforeById.has(rule.id)) diff.added.push(rule);
  for (const rule of before) if (!afterById.has(rule.id)) diff.ended.push(rule);
  for (const rule of after) {
    const was = beforeById.get(rule.id);
    if (!was) continue;
    const fields: ChangedField[] = [];
    for (const field of RULE_DIFF_FIELDS) {
      const a = show(was[field]);
      const b = show(rule[field]);
      if (a !== b) fields.push({ field, before: a, after: b });
    }
    if (fields.length) diff.changed.push({ id: rule.id, pack: rule.pack, name: rule.name, fields });
    else diff.unchanged += 1;
  }
  return diff;
}

/** True when nothing a review reads has changed. */
export const diffIsEmpty = (diff: RulePackDiff) => !diff.added.length && !diff.ended.length && !diff.changed.length;

const rateInWords = (rule: RuleSnapshot) => (rule.isRate && typeof rule.rate === 'number' ? `${(rule.rate * 100).toFixed(3).replace(/\.?(?<!0)0+$/, '')}%` : '');

/** The readable report for the accountant review. Pure. */
export function packDiffMarkdown(diff: RulePackDiff): string {
  const lines = [
    `# Rule pack changes — ${diff.beforeDate ? `${diff.beforeDate} → ` : ''}${diff.afterDate}`,
    '',
    diffIsEmpty(diff)
      ? 'No rule was added, ended or changed. Nothing to review.'
      : `${diff.added.length} added, ${diff.ended.length} ended, ${diff.changed.length} changed (${diff.unchanged} unchanged).`
        + ' Check each row below against the source it names before a filing position: a change here is what the packs now say, not a reviewed tax answer.',
    '',
  ];
  if (diff.added.length) {
    lines.push('## Added rules', '', '| rule | pack | from | rate | source |', '| --- | --- | --- | --- | --- |');
    for (const rule of diff.added) lines.push(`| ${rule.name} | ${rule.pack} | ${rule.validFrom} | ${rateInWords(rule)} | ${rule.sourceUrl} |`);
    lines.push('');
  }
  if (diff.ended.length) {
    lines.push('## Rules that ended (no longer in the packs)', '', '| rule | pack | was from | was to | rate |', '| --- | --- | --- | --- | --- |');
    for (const rule of diff.ended) lines.push(`| ${rule.name} | ${rule.pack} | ${rule.validFrom} | ${rule.validTo || '—'} | ${rateInWords(rule)} |`);
    lines.push('');
  }
  if (diff.changed.length) {
    lines.push('## Changed rules', '', '| rule | field | was | is now |', '| --- | --- | --- | --- |');
    for (const change of diff.changed) {
      for (const field of change.fields) {
        const shown = field.field === 'rate' && field.before !== '—' && field.after !== '—'
          ? { before: `${(Number(field.before) * 100).toFixed(3).replace(/\.?(?<!0)0+$/, '')}%`, after: `${(Number(field.after) * 100).toFixed(3).replace(/\.?(?<!0)0+$/, '')}%` }
          : { before: field.before, after: field.after };
        lines.push(`| ${change.name} | ${field.field} | ${shown.before} | ${shown.after} |`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n')}`;
}
