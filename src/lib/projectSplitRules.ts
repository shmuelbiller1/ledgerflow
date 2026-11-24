/**
 * R-10 (#924), the screen half: a project's split rules are percentages of a whole, so the
 * screen must refuse a share outside 0–100 (two decimals) and a set that does not add to 100
 * **before** it saves — and it must say which line is off, not just "invalid".
 *
 * `ProjectSchema` (src/schemas.ts) is the write-time guard the server and bulk import share; this
 * module is the same rules with a per-line message for a person typing, so the two cannot drift:
 * the test drives both against the same table.
 *
 * Why 100 exactly and not "at most 100": a split rule says how a project's result is divided
 * between its partners. A set that adds to 70% leaves 30% of the result with nobody, which is not
 * a split; `ProjectSchema` is deliberately looser (≤ 100) because it also validates restored and
 * imported history, where an incomplete set may already exist. The screen is the place that asks
 * the person to finish the set.
 */

export interface SplitRuleLine {
  partnerId: string;
  partnerName?: string;
  percentage: number;
}

export type SplitRuleProblem =
  | { kind: 'missing-partner'; line: number; message: string }
  | { kind: 'out-of-range'; line: number; message: string }
  | { kind: 'too-many-decimals'; line: number; message: string }
  | { kind: 'duplicate-partner'; line: number; message: string }
  | { kind: 'total-not-100'; total: number; message: string };

/** Two decimal places is the most a screen can accept without silently rounding a share away. */
const MAX_DECIMALS = 2;

function decimalsOf(value: number): number {
  // toFixed is the shortest faithful decimal for a double within this range; a share is typed by a person
  const text = value.toFixed(10).replace(/0+$/, '');
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Every problem with one line, in the order a person fills the form (top to bottom). */
export function splitRuleProblems(rules: readonly SplitRuleLine[]): SplitRuleProblem[] {
  const problems: SplitRuleProblem[] = [];
  const seen = new Map<string, number>();

  rules.forEach((rule, index) => {
    const line = index + 1;
    const name = rule.partnerName?.trim() || rule.partnerId?.trim() || `line ${line}`;
    if (!rule.partnerId || !rule.partnerId.trim()) {
      problems.push({ kind: 'missing-partner', line, message: `Line ${line} names no partner: choose one.` });
    } else if (seen.has(rule.partnerId.trim())) {
      problems.push({
        kind: 'duplicate-partner', line,
        message: `Line ${line} repeats ${name}, already on line ${seen.get(rule.partnerId.trim())}: each partner appears once.`,
      });
    } else {
      seen.set(rule.partnerId.trim(), line);
    }
    if (!Number.isFinite(rule.percentage)) {
      problems.push({ kind: 'out-of-range', line, message: `Line ${line} (${name}) has no percentage.` });
    } else if (rule.percentage <= 0 || rule.percentage > 100) {
      problems.push({
        kind: 'out-of-range', line,
        message: `Line ${line} (${name}) is ${rule.percentage}%: a share must be above 0% and at most 100%.`,
      });
    } else if (decimalsOf(rule.percentage) > MAX_DECIMALS) {
      problems.push({
        kind: 'too-many-decimals', line,
        message: `Line ${line} (${name}) has more than two decimals: round it to ${MAX_DECIMALS}.`,
      });
    }
  });

  // the total is checked last, so a line's own problem is read before the sum it would have changed
  const total = rules.reduce((sum, rule) => sum + (Number.isFinite(rule.percentage) ? rule.percentage : 0), 0);
  if (!problems.length && Math.abs(total - 100) > 0.005) {
    problems.push({
      kind: 'total-not-100', total,
      message: total < 100
        ? `The shares add up to ${Number(total.toFixed(2))}%: ${Number((100 - total).toFixed(2))}% of the project belongs to nobody.`
        : `The shares add up to ${Number(total.toFixed(2))}%: more than the whole project.`,
    });
  }
  return problems;
}

/** What the screen shows above the save button: nothing when the set is ready to save. */
export function splitRulesSaveProblem(rules: readonly SplitRuleLine[]): string | null {
  if (!rules.length) return 'Add at least one partner share before saving.';
  const problems = splitRuleProblems(rules);
  return problems.length ? problems.map(problem => problem.message).join(' ') : null;
}

/** A share as the screen prints it: two decimals at most, never `12.340000000001`. */
export function formatSplitPercentage(percentage: number): string {
  if (!Number.isFinite(percentage)) return '—';
  const rounded = Math.round(percentage * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '');
}
