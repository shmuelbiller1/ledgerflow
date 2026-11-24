/**
 * R-10 (#924): a project's partner shares are percentages of the whole project, so the screen
 * refuses a share outside 0–100, a share with more than two decimals, a partner listed twice, and
 * a set that does not add to exactly 100 — naming the line that is off rather than saying "invalid".
 *
 * The schema (what a write and a restore check) and this screen helper must give the same answer
 * about the same share; the last test drives both, so one cannot drift from the other.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitRuleProblems, splitRulesSaveProblem, formatSplitPercentage, type SplitRuleLine } from '../lib/projectSplitRules';
import { ProjectSchema } from '../schemas';

const splitRules = ProjectSchema.shape.splitRules;

const rule = (partnerId: string, percentage: number, partnerName?: string): SplitRuleLine =>
  ({ partnerId, percentage, ...(partnerName ? { partnerName } : {}) });

test('a set that adds to 100 is ready to save', () => {
  assert.equal(splitRulesSaveProblem([]), 'Add at least one partner share before saving.');
  assert.equal(splitRulesSaveProblem([rule('p1', 60), rule('p2', 40)]), null);
  assert.equal(splitRulesSaveProblem([rule('p1', 33.33), rule('p2', 33.33), rule('p3', 33.34)]), null);
  assert.deepEqual(splitRuleProblems([rule('p1', 60), rule('p2', 40)]), []);
});

test('a share outside 0–100 is refused, and the line is named', () => {
  for (const percentage of [0, -10, 120]) {
    const problems = splitRuleProblems([rule('p1', percentage, 'Dana')]);
    assert.equal(problems[0]?.kind, 'out-of-range', String(percentage));
    assert.match(problems[0]!.message, /Line 1 \(Dana\)/, String(percentage));
  }
  assert.match(splitRuleProblems([rule('p1', 150)])[0]!.message, /at most 100%/);
});

test('more than two decimals is refused before it is silently rounded', () => {
  const problems = splitRuleProblems([rule('p1', 33.333), rule('p2', 66.667)]);
  assert.equal(problems[0]?.kind, 'too-many-decimals');
  assert.match(problems[0]!.message, /Line 1/);
  assert.match(problems[1]!.message, /Line 2/);
});

test('the same partner twice is refused, naming both lines', () => {
  const problems = splitRuleProblems([rule('p1', 50, 'Dana'), rule('p1', 50, 'Dana')]);
  assert.equal(problems[0]?.kind, 'duplicate-partner');
  assert.match(problems[0]!.message, /repeats Dana, already on line 1/);
});

test('a line with no partner is refused', () => {
  assert.equal(splitRuleProblems([rule('', 100)])[0]?.kind, 'missing-partner');
});

test('a set that adds to less or more than 100 says by how much, and the line problems come first', () => {
  const short = splitRuleProblems([rule('p1', 60), rule('p2', 35)]);
  assert.equal(short[0]?.kind, 'total-not-100');
  assert.match(short[0]!.message, /add up to 95%: 5% of the project belongs to nobody/);

  const over = splitRuleProblems([rule('p1', 60), rule('p2', 50)]);
  assert.match(over[0]!.message, /add up to 110%: more than the whole project/);

  // a bad line is reported on its own, not buried under a sum message it caused
  const both = splitRuleProblems([rule('p1', -20), rule('p2', 120)]);
  assert.deepEqual(both.map(p => p.kind), ['out-of-range', 'out-of-range']);
});

test('the save sentence lists each line that is off', () => {
  const message = splitRulesSaveProblem([rule('p1', 33.333, 'Dana'), rule('p2', 0, 'Avi')]);
  assert.match(message!, /Line 1 \(Dana\)/);
  assert.match(message!, /Line 2 \(Avi\)/);
});

test('a share is printed with two decimals at most', () => {
  assert.equal(formatSplitPercentage(60), '60');
  assert.equal(formatSplitPercentage(33.34), '33.34');
  assert.equal(formatSplitPercentage(12.3), '12.3');
  assert.equal(formatSplitPercentage(12.3456789), '12.35');
  assert.equal(formatSplitPercentage(Number.NaN), '—');
});

test('the screen helper and ProjectSchema agree on range; only decimals differ, on purpose', () => {
  // each percentage in this table is either fine for both or refused by both
  for (const percentage of [0, -1, 0.01, 12.5, 12.34, 100, 100.01, 250]) {
    const schemaOk = splitRules.safeParse([{ partnerId: 'p1', percentage }]).success;
    const screenOk = !splitRuleProblems([rule('p1', percentage)]).some(p =>
      p.kind === 'out-of-range' || p.kind === 'too-many-decimals');
    assert.equal(screenOk, schemaOk, `percentage ${percentage}: screen ${screenOk}, schema ${schemaOk}`);
  }
  // the one deliberate difference: the screen keeps shares to two decimals, the schema does not limit
  // decimals (older stored rules may have more), so 12.345 is refused on screen but still accepted on save
  assert.equal(splitRules.safeParse([{ partnerId: 'p1', percentage: 12.345 }]).success, true);
  assert.equal(splitRuleProblems([rule('p1', 12.345)]).some(p => p.kind === 'too-many-decimals'), true);
  // a set summing to 120 is refused by both, by different words
  assert.equal(splitRules.safeParse([{ partnerId: 'p1', percentage: 70 }, { partnerId: 'p2', percentage: 50 }]).success, false);
  assert.equal(splitRuleProblems([rule('p1', 70), rule('p2', 50)])[0]?.kind, 'total-not-100');
});
