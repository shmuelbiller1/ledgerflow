/**
 * EU-C3: "Always do this for Shell" makes a rule from the decision — the merchant to the account, with the labels —
 * and the next Shell line then says "rule: Shell → Fuel" (the same bank-rule engine the import and server run).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { merchantKey, ruleFromDecision } from '../lib/ruleFromDecision';
import { reviewReason } from '../lib/reviewReason';
import { suggestFromRules } from '../lib/bankRules';
import { makeTransaction } from './fixtures';
import { expenseAccounts } from './helpers/expenseAccounts';
import type { AutoRule } from '../types';

const accounts = expenseAccounts('fuel');

test('EU-C3: the merchant is the first real word', () => {
  assert.equal(merchantKey(undefined, 'SHELL 0042'), 'shell');
  assert.equal(merchantKey(undefined, 'POS PURCHASE Corner Cafe'), 'corner');
  assert.equal(merchantKey('Acme Hosting', 'ACH 99812'), 'acme', 'the payee first');
  assert.equal(merchantKey(undefined, '0042 12/11'), '');
});

test('EU-C3: the rule carries the account and the labels, and the next Shell line follows it', () => {
  const rule = ruleFromDecision({ description: 'SHELL 0042', accountId: 'fuel', accountName: 'Fuel', labels: { property: 'maui', category: 'Fuel' } });
  assert.ok(rule);
  assert.deepEqual([rule!.name, rule!.condition, rule!.action], ['Shell → Fuel', { descriptionContains: 'shell' }, { targetAccountId: 'fuel', targetCategory: 'Fuel', targetDimensions: { property: 'maui' } }]);
  const saved = { ...rule!, id: 'r-new', uid: 'u' } as AutoRule;
  const next = suggestFromRules([saved], { description: 'Shell 1187 Main St', amountCents: 5200, date: '2026-11-12' }, { accounts });
  assert.deepEqual([next?.accountId, next?.dimensions], ['fuel', { property: 'maui' }]);
  const line = makeTransaction({ id: 'n', description: 'Shell 1187 Main St', status: 'draft', totalAmountCents: 5200, lines: [{ accountId: 'uncategorized', amountCents: 5200 }, { accountId: 'bank', amountCents: -5200 }] });
  assert.equal(reviewReason({ tx: line, rules: [saved], accounts }).text, 'rule: Shell → Fuel');
  assert.equal(ruleFromDecision({ description: '0042', accountId: 'fuel' }), null, 'no merchant, no rule');
});
