/**
 * EU-B6: "paid $40 gas" no longer posts to the first expense account. By hand, in a shekel workspace:
 * - a rule "gas → Fuel": Fuel · ₪40.00 from Bank (rule: Gas);
 * - no rule, "Acme Hosting" filed to Hosting 3 times: Hosting (same as the last 3 times);
 * - nothing known: it asks "Which account…", and posts only after the person chooses;
 * - "#maui" sets Property = Maui house; "@Shell" is the payee; "#nowhere" is said, not dropped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planTypedEntry, splitTyped } from '../lib/typedEntryPlan';
import { makeTransaction } from './fixtures';
import { expenseAccounts } from './helpers/expenseAccounts';
import { formatCurrency } from '../lib/utils';
import type { AutoRule } from '../types';

const accounts = expenseAccounts('office', 'fuel', 'hosting');
const gasRule = { id: 'r1', uid: 'u', name: 'Gas', condition: { descriptionContains: 'gas' }, action: { targetAccountId: 'fuel' }, isActive: true } as unknown as AutoRule;
const nodes = [{ id: 'maui', dimensionId: 'property', description: 'Maui house' }];
const ils = (c: number) => formatCurrency(c, 'ILS');
const base = { amountCents: 4000, isExpense: true, accounts, rules: [] as AutoRule[], history: [], nodes, labelNames: { property: 'Property' }, format: ils };
const hosting = (n: number) => makeTransaction({ id: `h${n}`, description: 'Acme Hosting', payee: 'Acme Hosting', status: 'completed', totalAmountCents: 4000,
  lines: [{ accountId: 'hosting', accountName: 'Hosting', amountCents: 4000 }, { accountId: 'bank', amountCents: -4000 }] });

test('EU-B6: a bank rule chooses the account; the preview is in shekels', () => {
  const plan = planTypedEntry({ ...base, text: 'paid $40 gas', description: 'gas', rules: [gasRule] });
  assert.deepEqual([plan.question, plan.accountId, plan.because], ['', 'fuel', 'rule: Gas']);
  assert.equal(plan.preview, `Fuel · ${ils(4000)} from Bank`);
  assert.ok(!plan.preview.includes('$'), 'no dollars in a shekel workspace');
});

test("EU-B6: the payee's history, when every earlier entry went to one account", () => {
  const plan = planTypedEntry({ ...base, text: 'paid 40 Acme Hosting', description: 'Acme Hosting', history: [hosting(1), hosting(2), hosting(3)] });
  assert.deepEqual([plan.accountId, plan.because], ['hosting', 'same as the last 3 times']);
});

test('EU-B6: nothing known — it asks, and the chosen account is used', () => {
  const asked = planTypedEntry({ ...base, text: 'paid $40 mystery', description: 'mystery' });
  assert.equal(asked.accountId, undefined, 'never "the first expense account" (Office)');
  assert.match(asked.question, /Which account is "mystery"\?/);
  const chosen = planTypedEntry({ ...base, text: 'paid $40 mystery', description: 'mystery', chosenAccountId: 'office' });
  assert.deepEqual([chosen.question, chosen.accountId, chosen.because], ['', 'office', 'chosen by you']);
});

test('EU-B6: #label and @vendor', () => {
  assert.deepEqual(splitTyped('paid $40 gas #maui @Shell'), { rest: 'paid $40 gas', tags: ['maui'], payee: 'Shell' });
  const plan = planTypedEntry({ ...base, text: 'paid $40 gas #maui #nowhere @Shell', description: 'gas #maui #nowhere @Shell', rules: [gasRule] });
  assert.deepEqual([plan.labels, plan.unknownLabels, plan.payee, plan.description], [{ property: 'maui' }, ['nowhere'], 'Shell', 'gas']);
  assert.equal(plan.preview, `Fuel · Property: Maui house · ${ils(4000)} from Bank`);
});
