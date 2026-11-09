/**
 * Sonar S8786: the regex-free checks in src/lib/textShape.ts give the same answer as the patterns they replaced,
 * on hand-worked cases and on every string of up to 5 characters from a small alphabet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { firstTwoPlaceAmount, splitLeadingCode, splitTypedAmount, groupThousands, headBeforeFiveDigits, isEmailShape, isPlainDecimal, trimChar, trimEndChar, trimEndChars, trimEndDigits, trimSpacesBeforeNewlines, splitTrailingDigits, splitTrimmedLines } from '../lib/textShape';

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

test('groupThousands, trimEndChars and trimEndDigits match the old patterns', () => {
  for (let n = 0; n <= 1234567; n += 997) {
    const d = String(n);
    assert.equal(groupThousands(d), d.replace(/\B(?=(\d{3})+(?!\d))/g, ','), d);
  }
  assert.equal(groupThousands('1234567'), '1,234,567');
  assert.equal(groupThousands('100'), '100');
  assert.equal(groupThousands(''), '');
  for (const s of strings(['a', '1', '!', '.'], 6)) {
    assert.equal(trimEndChars(s, '!.?'), s.replace(/[!.?]+$/, ''), JSON.stringify(s));
    assert.equal(trimEndDigits(s, 2), s.replace(/\d{2,}$/, ''), JSON.stringify(s));
  }
});

test('isPlainDecimal matches /^-?(\\d+\\.?\\d*|\\.\\d+)$/ on every short string', () => {
  const OLD = /^-?(\d+\.?\d*|\.\d+)$/;
  for (const s of strings(['1', '.', '-', 'x'], 6)) assert.equal(isPlainDecimal(s), OLD.test(s), JSON.stringify(s));
  for (const ok of ['12', '12.', '12.5', '.5', '-3', '-.5']) assert.equal(isPlainDecimal(ok), true, ok);
  for (const no of ['', '-', '.', '-.', '1.2.3', '--1', '1-']) assert.equal(isPlainDecimal(no), false, no);
});

test('trimSpacesBeforeNewlines matches /[ \\t]+\\n/g on every short string', () => {
  for (const s of strings([' ', '\t', '\n', 'a'], 6)) {
    assert.equal(trimSpacesBeforeNewlines(s), s.replace(/[ \t]+\n/g, '\n'), JSON.stringify(s));
  }
});

test('splitTrailingDigits, headBeforeFiveDigits and splitTrimmedLines match the old patterns on every short string', () => {
  const OLD_TRAIL = /^(.*?)(\d+)$/;
  const OLD_CITY = /^(.*?)\s+(\d{5})$/u;
  for (const s of strings(['a', '1', ' ', '\n'], 7)) {
    const old = s.match(OLD_TRAIL);
    assert.deepEqual(splitTrailingDigits(s), old ? { head: old[1], digits: old[2] } : null, JSON.stringify(s));
    assert.equal(splitTrimmedLines(s).join('|'), s.split(/\s*\n\s*/).filter(Boolean).join('|'), JSON.stringify(s));
  }
  for (const s of strings(['a', '1', ' ', '\n'], 6)) {
    const t = `${s}12345`;
    assert.equal(headBeforeFiveDigits(t), t.match(OLD_CITY)?.[1] ?? null, JSON.stringify(t));
    assert.equal(headBeforeFiveDigits(s), s.match(OLD_CITY)?.[1] ?? null, JSON.stringify(s));
  }
  assert.equal(headBeforeFiveDigits('Tel Aviv 61000'), 'Tel Aviv');
  assert.equal(headBeforeFiveDigits('Tel Aviv 610000'), null);
  assert.deepEqual(splitTrailingDigits('INV-0042'), { head: 'INV-', digits: '0042' });
});

test('firstTwoPlaceAmount, splitLeadingCode and splitTypedAmount match the old patterns on every short string', () => {
  const OLD_AMOUNT = /([0-9]+[,.][0-9]{2})/;
  const OLD_LEAD = /^(\d[\w.-]*)\s+(.+)$/;
  const OLD_TYPED = /^\s*(-?)(\d*)(?:\.(\d*))?\s*$/;
  for (const s of strings(['1', ',', '.', 'a'], 7)) assert.equal(firstTwoPlaceAmount(s), s.match(OLD_AMOUNT)?.[1], JSON.stringify(s));
  for (const s of strings(['1', 'a', ' ', '\n', '-'], 6)) {
    const old = s.match(OLD_LEAD);
    assert.deepEqual(splitLeadingCode(s), old ? { code: old[1], rest: old[2] } : null, JSON.stringify(s));
  }
  for (const s of strings(['1', '.', '-', ' ', 'x'], 6)) {
    const old = OLD_TYPED.exec(s);
    assert.deepEqual(splitTypedAmount(s), old ? { sign: old[1], whole: old[2], fraction: old[3] } : null, JSON.stringify(s));
  }
  assert.deepEqual(splitLeadingCode('1200 Accounts Receivable (A/R)'), { code: '1200', rest: 'Accounts Receivable (A/R)' });
  assert.equal(firstTwoPlaceAmount('C1234,56EUR'), '1234,56');
});

test('a scheduled-report recipient that is not a string is refused, not thrown on', async () => {
  const { scheduleProblem, SCHEDULED_REPORTS } = await import('../lib/scheduledReports');
  const report = Object.keys(SCHEDULED_REPORTS)[0];
  const base = { report, frequency: 'monthly' } as never as Record<string, unknown>;
  assert.equal(scheduleProblem({ ...base, recipients: ['a@b.co'] } as never), null);
  assert.equal(scheduleProblem({ ...base, recipients: [123 as unknown as string] } as never), '"123" is not an email address');
});
