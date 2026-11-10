/**
 * Issue #161: overrides decide the same way whatever order the rules are listed in.
 * The engine's documented meaning: a switched-off rule cannot replace another. So with A over B and B over C,
 * A switches B off, B no longer counts, and C stays. Rules in a loop of overrides are left undecided.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRules, type Rule } from '../lib/rules/rules';
import { composeFacts } from '../lib/rules/facts';

const DATE = '2026-10-18';
const facts = composeFacts({ books: [] }, {}, [], DATE);
const rule = (id: string, combine: Rule['combine'], targets: string[] = []): Rule<string> => ({
  id, scope: 'line', when: [], combine, targets, effect: id, validFrom: '2026-01-01',
  source: { authority: 'test', url: 'https://example.test' }, status: 'calculation',
} as unknown as Rule<string>);

const permutations = <T>(xs: T[]): T[][] => xs.length <= 1 ? [xs]
  : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [x, ...rest]));

const summary = (rules: Rule<string>[]) => {
  const out = evaluateRules(rules, facts, { date: DATE, scope: 'line' });
  return {
    applied: out.applied.map(a => a.rule.id).sort(),
    displaced: out.displaced.map(d => `${d.rule.id}<${d.by}`).sort(),
    undecided: out.undecided.map(u => `${u.rule.id}~${(u.cycle || []).join(',')}`).sort(),
  };
};

/** every listing order gives the same answer, and that answer is `expected` */
const sameInEveryOrder = (rules: Rule<string>[], expected: ReturnType<typeof summary>) => {
  for (const order of permutations(rules)) {
    assert.deepEqual(summary(order), expected, `order ${order.map(r => r.id).join(',')}`);
  }
};

test('the issue\'s chain: A over B, B over C — A and C apply, B is replaced by A, in all six orders', () => {
  sameInEveryOrder([rule('A', 'override', ['B']), rule('B', 'override', ['C']), rule('C', 'accumulate')],
    { applied: ['A', 'C'], displaced: ['B<A'], undecided: [] });
});

test('a longer chain alternates: A over B over C over D — A and C apply', () => {
  sameInEveryOrder([rule('A', 'override', ['B']), rule('B', 'override', ['C']), rule('C', 'override', ['D']), rule('D', 'accumulate')],
    { applied: ['A', 'C'], displaced: ['B<A', 'D<C'], undecided: [] });
});

test('two rules override the same one: it is replaced, named by the first id, whatever the order', () => {
  sameInEveryOrder([rule('X', 'override', ['T']), rule('W', 'override', ['T']), rule('T', 'accumulate')],
    { applied: ['W', 'X'], displaced: ['T<W'], undecided: [] });
});

test('a loop (A over B, B over A) is not decided by list order: both are left for a person', () => {
  sameInEveryOrder([rule('A', 'override', ['B']), rule('B', 'override', ['A'])],
    { applied: [], displaced: [], undecided: ['A~B', 'B~A'] });
});

test('an excluded rule neither applies nor replaces: E excludes A, so A cannot switch off B', () => {
  sameInEveryOrder([rule('E', 'exclude', ['A']), rule('A', 'override', ['B']), rule('B', 'accumulate')],
    { applied: ['B', 'E'], displaced: ['A<E'], undecided: [] });
});

test('nothing overridden: every matching rule applies (unchanged behaviour)', () => {
  sameInEveryOrder([rule('A', 'accumulate'), rule('B', 'accumulate')], { applied: ['A', 'B'], displaced: [], undecided: [] });
});
