/**
 * Automation rules are saved (found by Codex during C-5): Settings → Rules and "Create rule" in
 * the transaction list only changed the copy in the open page, in a format the engine ignored,
 * and "apply to existing" reported success without saving the transactions. Budgets could never
 * be added (the workspace was read from a store that doesn't hold it).
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { changedRuleFields } from '../hooks/useAutoRules';
import { makeTransaction } from './fixtures';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('Saving automation rules', () => {
  test('only the fields a rule changed are sent to the server', () => {
    const before = makeTransaction({ id: 't1', description: 'AWS invoice', tags: ['cloud'], lines: [{ accountId: 'a', amountCents: 100 }, { accountId: 'b', amountCents: -100 }] });
    const after = { ...before, description: '[IT] AWS invoice', tags: ['cloud', 'it'] };
    assert.deepEqual(changedRuleFields(before, after), { description: '[IT] AWS invoice', tags: ['cloud', 'it'] });
    assert.deepEqual(changedRuleFields(before, { ...before }), {});
  });

  test('rule state changes follow successful persistence commands', () => {
    const allowed = new Set([
      'src/hooks/useAutoRules.ts', 'src/hooks/useLedgerData.ts', 'src/stores/useLedgerStore.ts',
      'src/hooks/transactionActions/ruleActions.ts',
    ]);
    const offenders = files('src').filter(f => !f.includes('/tests/'))
      .map(f => relative(process.cwd(), f).replace(/\\/g, '/'))
      .filter(f => !allowed.has(f) && /\bsetAutoRules\(/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(offenders, [], 'screens must not set automation rules directly');
    const actions = readFileSync('src/hooks/transactionActions/ruleActions.ts', 'utf8');
    for (const command of ['autorule.create', 'autorule.update', 'autorule.delete']) {
      assert.ok(actions.includes(`runCommand('${command}'`), `rule actions must persist ${command} before updating cached state`);
    }
  });

  test('no screen reads the open workspace from the ledger store', () => {
    const offenders = files('src/components').filter(f => /useLedgerStore\([^)]*currentWorkspaceId/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(offenders, []);
  });
});
