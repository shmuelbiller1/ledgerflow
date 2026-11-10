/**
 * Agent #6 probe (2026-11-10) — issue #161 / AF-012: chained rule overrides depend on array order.
 *
 * Imports the SHIPPED `evaluateRules` from `src/lib/rules/rules.ts` at the pin
 * (dc40739708a013ad080ffb306fe461554a2391fc). Nothing is re-implemented here.
 *
 * Run: NODE_ENV=test npx tsx --test audit/agent6-2026-11-10/probes/af012-rule-chain-order.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRules, type Rule } from '../../../src/lib/rules/rules.ts';
import type { ComposedFacts } from '../../../src/lib/rules/facts.ts';

const override = (id: string, targets: string[]): Rule<string> => ({
  id, name: id, scope: 'line', when: [], combine: 'override', targets,
  effect: id, validFrom: '2026-01-01', status: 'reviewed',
  source: { authority: 'probe', url: 'https://example.invalid' },
});

const facts: ComposedFacts = { facts: {}, conflicts: [] };
const run = (rules: Rule<string>[]) =>
  evaluateRules(rules, facts, { date: '2026-08-01', scope: 'line' })
    .applied.map(a => a.rule.id).join(',');

test('AF-012 / #161: three chained overrides resolve differently per input order', () => {
  // A overrides B, B overrides C: the most specific rule is A, the least is C.
  const rules = [override('A', ['B']), override('B', ['C']), override('C', [])];
  const [A, B, C] = rules;
  const abc = run([A, B, C]);
  const bac = run([B, A, C]);
  const cba = run([C, B, A]);
  console.log(`  order A,B,C -> applied ${abc}\n  order B,A,C -> applied ${bac}\n  order C,B,A -> applied ${cba}`);
  assert.equal(abc, 'A,C', 'OBSERVED: C survives although B (which replaces C) is itself replaced by A');
  assert.equal(bac, 'A');
  assert.equal(cba, 'A');
  assert.notEqual(abc, bac, 'the applied set depends on array order — the defect, restated as an assertion');
});

test('AF-012 / #161: a two-rule cycle resolves order-dependently instead of being refused', () => {
  const [A, B] = [override('A', ['B']), override('B', ['A'])];
  console.log(`  cycle A>B,B>A: order A,B -> ${run([A, B])}; order B,A -> ${run([B, A])}`);
  assert.equal(run([A, B]), 'A');
  assert.equal(run([B, A]), 'B');
});
