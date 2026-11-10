import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMerchantName, wideGapStart } from '../lib/merchantNames';
import { parseReceiptOCR } from '../lib/algorithms/receipt-capture';

function strings(alphabet: string[], maxLength: number): string[] {
  let level = [''];
  const all = [''];
  for (let n = 0; n < maxLength; n++) {
    level = level.flatMap(s => alphabet.map(c => s + c));
    for (const s of level) all.push(s);
  }
  return all;
}

const pairs: Array<[string, RegExp, RegExp, string[], number]> = [
  ['postal label', /(?:\b(?:zip)\b|מיקוד)\s*[:#-]?\s*(\d{2})(?!\d)/giu, /(?:\b(?:zip)\b|מיקוד)\s*(?:[:#-]\s*)?(\d{2})(?!\d)/giu, ['zip', ' ', ':', '1', 'מיקוד', 'a'], 6],
  ['alphanumeric id', /[0-9]+[a-z]+[0-9]+/g, /(?<![0-9])[0-9]+[a-z]+[0-9]+/g, ['1', 'a', ' ', 'B'], 7],
  ['card ending', /\bcard\s*(ending|no\.?)?\s*\d{4}\b/gi, /\bcard\s*(?:(?:ending|no\.?)\s*)?\d{4}\b/gi, ['card', ' ', 'no', '.', '1234', '5', 'x'], 5],
  ['digit codes', /\b[A-Z0-9]*\d[A-Z0-9]*\b/g, /\b(?=[A-Z0-9]*\d)[A-Z0-9]+\b/g, ['A', '1', 'a', ' ', '-', 'é'], 7],
];

describe('S8786 batch h: rewritten patterns replace exactly what the old ones did', () => {
  for (const [name, oldRe, newRe, alphabet, max] of pairs) {
    it(name, () => {
      for (const s of strings(alphabet, max)) assert.equal(s.replace(newRe, '|'), s.replace(oldRe, '|'), JSON.stringify(s));
    });
  }
});

describe('wideGapStart', () => {
  it('finds where /\\s{2,}.*$/ matches', () => {
    for (const s of strings([' ', 'a', '\n', '\t', '\u00a0'], 7)) {
      const m = /\s{2,}.*$/.exec(s);
      assert.equal(wideGapStart(s), m ? m.index : -1, JSON.stringify(s));
    }
  });
});

describe('the rewritten patterns through their callers', () => {
  it('cleanMerchantName drops a wide-gap city and state, and keeps other text after a wide gap', () => {
    assert.equal(cleanMerchantName('JOES COFFEE  NEW YORK NY'), 'Joes Coffee');
    assert.equal(cleanMerchantName('JOES  COFFEE SHOP'), 'Joes Coffee Shop');
  });
  it('a long "sub … TOTAL" line is read quickly and is not taken for a sub-total', () => {
    const t0 = Date.now();
    const reading = parseReceiptOCR(['Shop', 'sub' + ' '.repeat(50_000) + 'x TOTAL $1.00'], []);
    assert.equal(reading.totalCents, 100);
    assert.ok(Date.now() - t0 < 1000, 'linear time');
  });
});
