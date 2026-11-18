/** Regression checks for Sonar maintenance fixes; all fixes ship in one PR. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classOf, topLevelIndexOf, matchingColon, readEmptyStateRow } from '../../scripts/codemod-row-table.js';
import { headerKeys, readResponseJsonTail } from '../../scripts/codemod-run-command.js';
import { wizardStepInRange } from '../../scripts/quality-metrics.js';

test('table class parser keeps literals and single templates, refuses ambiguous alternatives', () => {
  assert.deepEqual(classOf('<th className="text-right py-2">'), ['text-right', 'py-2']);
  assert.deepEqual(classOf('<th className={flag && `text-right py-2`}>'), ['text-right', 'py-2']);
  assert.deepEqual(classOf('<th className={flag ? `left` : `right`}>'), []);
  assert.deepEqual(classOf('<th className={flag}>'), []);
});

test('table ternary scanners do not skip the next operator after a string literal', () => {
  const question = "'ready'? <tr>yes</tr> : null";
  assert.equal(topLevelIndexOf(question, '?'), question.indexOf('?'));
  const colon = "ready ? 'x': fallback";
  assert.equal(matchingColon(colon, colon.indexOf('?')), colon.indexOf(':'));
  assert.equal(topLevelIndexOf("(amount + 2) ? yes : no", '?'), 13);
});

test('empty-row scanner only accepts the correct list and optional parentheses', () => {
  const row = '<tr><td>Nothing waiting</td></tr>';
  assert.equal(readEmptyStateRow(`{rows.length === 0 && ${row}}`, 'rows'), row);
  assert.equal(readEmptyStateRow(`{rows.length === 0 && ( ${row} )}`, 'rows'), row);
  assert.equal(readEmptyStateRow(`{other.length === 0 && ${row}}`, 'rows'), undefined);
  assert.equal(readEmptyStateRow(`{rows.length === 0 && <trash>Not a row</trash>}`, 'rows'), undefined);
});

test('header parser identifies idempotency keys but not normal auth/content-type keys', () => {
  assert.deepEqual(
    headerKeys("'Content-Type': 'application/json', Authorization: token, 'Idempotency-Key': key"),
    ['content-type', 'authorization', 'idempotency-key'],
  );
  const large = " 'x-operation-id'  : requestId," + " ".repeat(50000);
  assert.deepEqual(headerKeys(large), ['x-operation-id']);
});

test('JSON response tail parser preserves the following status check', () => {
  const source = "  const body: Result = await res.json().catch(() => ({}));\n  if (!res.ok) throw new Error('failed');\n  return body;";
  const tail = readResponseJsonTail(source);
  assert.ok(tail);
  assert.equal(tail.variable, 'body');
  assert.equal(source.slice(0, tail.length).split('\n').length, 3);
  assert.equal(readResponseJsonTail('  const body = await somethingElse();\n'), undefined);
});

test('wizard step scanner advances through JSX once and keeps the latest valid step', () => {
  const first = "{step === 'details' && (<button>Continue</button>)}";
  const second = "{step === 'review' && (<button>Save</button>)}";
  const source = first + second;
  assert.equal(wizardStepInRange(source, 0, first.indexOf('<button>')), "'details'");
  assert.equal(wizardStepInRange(source, 0, source.lastIndexOf('<button>')), "'review'");
  assert.equal(wizardStepInRange(source, first.length, source.lastIndexOf('<button>')), "'review'");
  assert.equal(wizardStepInRange("{steps === 'wrong' && (<button/>)}", 0, 50), undefined);
});
