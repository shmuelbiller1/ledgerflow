/**
 * Sonar S8786: the regex-free checks in src/lib/textShape.ts give the same answer as the patterns they replaced,
 * on hand-worked cases and on every string of up to 5 characters from a small alphabet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskEmails, firstAmtElement, isPhoneText, trailingNumberStart, trailingStateStart, countBeforeWord, firstAmountText, headBeforeUsCountry, restAfterCommandWord, firstTwoPlaceAmount, splitLeadingCode, splitTypedAmount, groupThousands, headBeforeFiveDigits, isEmailShape, isPlainDecimal, trimChar, trimEndChar, trimEndChars, trimEndDigits, trimSpacesBeforeNewlines, splitTrailingDigits, splitTrimmedLines } from '../lib/textShape';

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

test('restAfterCommandWord, firstAmountText, countBeforeWord and headBeforeUsCountry match the old patterns', () => {
  const OLD_QUERY = /^(?:show|find|query|report)\s+(.+)$/i;
  const OLD_AMOUNT = /\$?\s*(\d+(?:\.\d{1,2})?)/;
  const OLD_COUNT = /(\d+)\s*(kids|child|children|dependents)/;
  const OLD_US = /^(.*?)(?:,\s*|\s+)(US|USA|U\.S\.A\.?|UNITED STATES(?: OF AMERICA)?)$/i;
  for (const s of strings(['a', ' ', '\n', 'x'], 5)) {
    for (const head of ['show', 'Find', 'QUERY', 'report', 'shows']) {
      const t = head + s;
      assert.equal(restAfterCommandWord(t, ['show', 'find', 'query', 'report']), t.match(OLD_QUERY)?.[1] ?? null, JSON.stringify(t));
    }
  }
  for (const s of strings(['1', '.', '$', ' ', 'a'], 6)) assert.equal(firstAmountText(s), s.match(OLD_AMOUNT)?.[1], JSON.stringify(s));
  for (const s of strings(['1', ' ', 'k', 'x'], 5)) {
    for (const word of ['kids', 'child', 'children', 'dependents', 'Kids']) {
      const t = s + word;
      assert.equal(countBeforeWord(t, ['kids', 'child', 'children', 'dependents']), t.match(OLD_COUNT)?.[1], JSON.stringify(t));
    }
  }
  for (const s of strings(['a', ' ', ',', '\n'], 5)) {
    for (const country of ['US', 'usa', 'U.S.A.', 'U.S.A', 'United States', 'UNITED STATES OF AMERICA', 'XUS']) {
      const t = s + country;
      assert.equal(headBeforeUsCountry(t), t.match(OLD_US)?.[1] ?? null, JSON.stringify(t));
    }
  }
  assert.equal(headBeforeUsCountry('Austin, TX 78701, USA'), 'Austin, TX 78701');
  assert.equal(firstAmountText('spent $12.345 on fuel'), '12.34');
  assert.equal(countBeforeWord('we have 3 children', ['kids', 'child', 'children', 'dependents']), '3');
});

test('maskEmails and the two rewritten patterns match the old ones', () => {
  const OLD_EMAIL = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g;
  for (const s of strings(['a', '@', '.', '-', ' ', '+'], 7)) assert.equal(maskEmails(s, '#'), s.replace(OLD_EMAIL, '#'), JSON.stringify(s));
  assert.equal(maskEmails('mail a.b+c@ex-ample.co.uk now, x@y', '[E]'), '[E] now, x@y'.replace('[E]', 'mail [E]'));
  const OLD_Q = /sub\s*-?\s*total/i;
  const NEW_Q = /sub\s*(?:-\s*)?total/i;
  for (const s of strings([' ', '-', 'x'], 6)) assert.equal(NEW_Q.test(`sub${s}total`), OLD_Q.test(`sub${s}total`), s);
  const OLD_DIM = /\[([\p{L}\p{M}\p{N}_-]+)\s*[:=]\s*([^\]]+)\]/gu;
  const NEW_DIM = /\[([\p{L}\p{M}\p{N}_-]+)\s*[:=]([^\]]+)\]/gu;
  const pairs = (re: RegExp, s: string) => [...s.matchAll(re)].map(m => `${m.index}|${m[1]}|${m[2].trim()}`);
  for (const s of strings(['[', ']', 'a', ':', ' '], 7)) assert.deepEqual(pairs(NEW_DIM, s), pairs(OLD_DIM, s), JSON.stringify(s));
});

test('trailingNumberStart, trailingStateStart, isPhoneText and firstAmtElement match the old patterns', () => {
  const OLD_NUM = /\s+\d[\d\s-]*$/;
  const OLD_STATE = /\s+[A-Z]{2}$/;
  const OLD_PHONE = /^\+?[0-9\s().-]+(?:\s*(?:ext(?:ension)?\.?|x|#)\s*\d+)?$/i;
  const OLD_AMT = /<Amt\b([^<>]*)>\s*([^<]+)<\/Amt\s*>/i;
  for (const s of strings(['a', '1', ' ', '-'], 7)) assert.equal(trailingNumberStart(s), s.search(OLD_NUM), JSON.stringify(s));
  for (const s of strings(['a', 'W', ' ', 'A'], 6)) assert.equal(trailingStateStart(s), s.search(OLD_STATE), JSON.stringify(s));
  for (const s of strings(['1', ' ', 'x', '+', '#', '.', 'e'], 5)) assert.equal(isPhoneText(s), OLD_PHONE.test(s), JSON.stringify(s));
  for (const tail of ['', ' ext 12', ' Ext. 4', 'extension 9', ' x', 'ext12a']) {
    const t = `+1 (555) 010-2000${tail}`;
    assert.equal(isPhoneText(t), OLD_PHONE.test(t), t);
  }
  for (const s of strings(['<Amt>', '</Amt>', ' ', '5', '<', 'x'], 4)) {
    const old = OLD_AMT.exec(s);
    assert.deepEqual(firstAmtElement(s), old ? { attributes: old[1], value: old[2] } : null, JSON.stringify(s));
  }
  const xml = '<Ntry><AMT Ccy="EUR"> 12.50 </amt ><Amt>1</Amt></Ntry>';
  assert.deepEqual(firstAmtElement(xml), { attributes: ' Ccy="EUR"', value: '12.50 ' });
  assert.equal(firstAmtElement('<Amtx>1</Amt>'), null);
  // a character whose lower case is longer ('İ' → 'i̇') before the amount must not shift the tag positions
  const turkish = '<NtryRef>İ-123</NtryRef><Amt Ccy="EUR">5.00</Amt>';
  const old = OLD_AMT.exec(turkish);
  assert.deepEqual(firstAmtElement(turkish), { attributes: old![1], value: old![2] });
});
