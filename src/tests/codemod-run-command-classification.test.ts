/**
 * What the codemod is allowed to call "mechanical".
 *
 * This exists because the classifier was wrong in the expensive direction: it looked for a `headers: {` object and
 * nothing else, so a call carrying an **idempotency key** (`x-operation-id`, `Idempotency-Key`) came back with no
 * blocker and was counted among the mechanical ones. That key is the only thing stopping a retried posting from
 * being recorded twice — a rewrite that dropped it would change how money is posted, which is the one thing the
 * checklist forbids.
 *
 * So the rule is pinned here rather than left in a comment: a header other than the two `runCommand` writes itself
 * is a decision for a person.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findCandidates } from '../../scripts/codemod-run-command';

const candidateFor = (body: string) => {
  const found = findCandidates('src/components/fake/Screen.tsx', `async function go() {\n${body}\n}\n`);
  assert.equal(found.length, 1, 'expected exactly one call');
  return found[0];
};

test('a plain authorised call is mechanical', () => {
  const found = candidateFor(`
    const res = await fetch('/api/v1/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ a: 1 }),
    });`);
  assert.deepEqual(found.blockers, []);
});

test('an idempotency key is a person\'s decision, not a mechanical rewrite', () => {
  for (const header of ["'x-operation-id': id", "'Idempotency-Key': operationId"]) {
    const found = candidateFor(`
      const res = await fetch('/api/v1/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ${header} },
        body: JSON.stringify({ transaction }),
      });`);
    assert.match(found.blockers.join(' '), /sends its own header/);
  }
});

test('a call that sends no session is flagged to pass token: null', () => {
  const found = candidateFor(`
    const res = await fetch('/api/v1/public/status', { headers: { 'Content-Type': 'application/json' } });`);
  // not a blocker — convertible — but `runCommand` would attach a session unless told not to
  assert.deepEqual(found.blockers, []);
  assert.match((found.reasons ?? []).join(" "), /token: null/);
});
