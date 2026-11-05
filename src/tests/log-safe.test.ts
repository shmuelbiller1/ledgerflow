/**
 * Log injection (Sonar S5145, CodeRabbit on #450): logged request values cannot start a new log line.
 * "a\nFORGED" → "a FORGED"; U+2028 and DEL become spaces too; an Error logs its stack the same way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { logSafe, logSafeDetail } from '../server/utils/logSafe';

test('control and line-break characters become spaces; length is capped', () => {
  assert.equal(logSafe('a\nFORGED\r x\u007f'), 'a FORGED  x ');
  assert.equal(logSafe('x'.repeat(600)).length, 500);
  assert.equal(logSafe(undefined), '');
});

test('details: errors, objects and strings are all one line', () => {
  const e = new Error('bad id a/\nFORGED');
  assert.ok(!logSafeDetail(e).includes('\n'));
  assert.match(logSafeDetail(e), /bad id a\/ FORGED/);
  assert.equal(logSafeDetail({ k: 'a\nb' }), '{"k":"a\\nb"}');
  assert.equal(logSafeDetail('a\nb'), 'a b');
  assert.equal(logSafeDetail(undefined), '');
});

test('a wrapped database error keeps its cause on the same line', () => {
  const wrapped = new Error('write failed', { cause: Object.assign(new Error('bad key\nX'), { code: '22P02', detail: 'id a/b' }) });
  const line = logSafeDetail(wrapped);
  assert.ok(!line.includes('\n'));
  assert.match(line, /\[cause: 22P02 \| bad key X \| id a\/b\]$/);
});
