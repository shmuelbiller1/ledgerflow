/**
 * Sonar S8786: the regex-free checks in src/lib/textShape.ts give the same answer as the patterns they replaced,
 * on hand-worked cases and on every string of up to 5 characters from a small alphabet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmailShape, trimChar, trimEndChar } from '../lib/textShape';

const OLD_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function* strings(alphabet: string[], maxLength: number): Generator<string> {
  let level = [''];
  yield '';
  for (let n = 1; n <= maxLength; n++) {
    const next: string[] = [];
    for (const s of level) for (const c of alphabet) { next.push(s + c); yield s + c; }
    level = next;
  }
}

test('isEmailShape: hand-worked cases', () => {
  for (const ok of ['a@b.co', 'x.y@mail.example.com', 'a@b.c', 'a@.b.c', 'a@b..c']) assert.equal(isEmailShape(ok), true, ok);
  for (const no of ['', 'a@b', 'a@.c', 'a@b.', '@b.co', 'a@@b.co', 'a@b@c.co', 'a b@c.co', 'a@b.c\n', 'a@b. c']) assert.equal(isEmailShape(no), false, JSON.stringify(no));
});

test('isEmailShape matches the old pattern on every short string', () => {
  let n = 0;
  for (const s of strings(['a', '@', '.', ' '], 7)) { assert.equal(isEmailShape(s), OLD_EMAIL.test(s), JSON.stringify(s)); n++; }
  assert.equal(n, 21845); // 1 + 4 + 16 + ... + 4^7
});

test('trimEndChar and trimChar match the old patterns on every short string', () => {
  for (const s of strings(['/', '-', 'a'], 6)) {
    assert.equal(trimEndChar(s, '/'), s.replace(/\/+$/, ''), JSON.stringify(s));
    assert.equal(trimChar(s, '-'), s.replace(/^-+|-+$/g, ''), JSON.stringify(s));
  }
  assert.equal(trimEndChar('https://app.example//', '/'), 'https://app.example');
  assert.equal(trimChar('__a_b__', '_'), 'a_b');
  assert.equal(trimChar('---', '-'), '');
});
