/**
 * F-37 — the importers are fuzzed (like storytold/photocraft's 35 fuzz targets):
 * CSV, QIF, MT940, CAMT.053, BAI2 and the US bank CSV layouts each get a
 * fast-check run. The contract every parser must keep, whatever bytes arrive:
 *
 *   1. no crash — it either returns an array or throws an `Error` with a
 *      plain-word message (never a TypeError such as "Cannot read properties");
 *   2. no partial write — parsers are pure and never write; they only return
 *      candidates for the existing preview;
 *   3. a clear error — a refused file says what is wrong;
 *   4. no impossible values — every returned line has a real calendar date,
 *      a safe whole-cent amount and a debit/credit type.
 *
 * A run is capped so a pathological input cannot hang the suite (the parsers
 * are linear over the input; the cap is a guard, not a timeout).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { parseQIFStatement } from '../lib/qifParser';
import { parseMT940Statement } from '../lib/mt940Parser';
import { parseCamt053Statement } from '../lib/camt053Parser';
import { parseBAI2Statement } from '../lib/bai2Parser';
import { parseUsBankCsv } from '../lib/usBankCsv';
import { parseCsv } from '../lib/csv';

type Line = { date: string; amountCents: number; type: string };
type Parser = { name: string; run: (input: string) => unknown; validate?: (value: unknown, name: string, input: string) => void };

const FORMATS = [
  { name: 'chase-checking', run: (input: string) => parseUsBankCsv(input, 'chase-checking') },
  { name: 'chase-card', run: (input: string) => parseUsBankCsv(input, 'chase-card') },
  { name: 'boa-checking', run: (input: string) => parseUsBankCsv(input, 'boa-checking') },
  { name: 'boa-card', run: (input: string) => parseUsBankCsv(input, 'boa-card') },
  { name: 'wells-fargo-checking', run: (input: string) => parseUsBankCsv(input, 'wells-fargo-checking') },
] as const;

const parsers: Parser[] = [
  { name: 'QIF', run: input => parseQIFStatement(input, 'mdy') },
  { name: 'QIF (day/month)', run: input => parseQIFStatement(input, 'dmy') },
  { name: 'MT940', run: input => parseMT940Statement(input) },
  { name: 'CAMT.053', run: input => parseCamt053Statement(input) },
  { name: 'BAI2', run: input => parseBAI2Statement(input) },
  {
    name: 'CSV',
    run: input => parseCsv(input),
    // The generic reader returns rows of text cells; the importer builds lines from them.
    validate: (value, name) => {
      assert.ok(Array.isArray(value), `${name}: did not return rows`);
      for (const row of value as string[][]) {
        assert.ok(Array.isArray(row), `${name}: a row is not an array`);
        assert.ok(row.every(cell => typeof cell === 'string'), `${name}: a cell is not text`);
      }
    },
  },
  ...FORMATS.map(f => ({ name: `US bank CSV (${f.name})`, run: f.run as (input: string) => unknown })),
];

/** A clear refusal: an Error whose message names the problem, not a runtime crash. */
function assertClearRefusal(error: unknown, parser: string, input: string) {
  assert.ok(error instanceof Error, `${parser}: threw something that is not an Error`);
  const message = error.message || '';
  assert.ok(message.trim().length > 0, `${parser}: refused with an empty message`);
  for (const crash of ['Cannot read properties', 'is not a function', 'undefined is not', 'of undefined', 'of null', 'Maximum call stack']) {
    assert.ok(!message.includes(crash), `${parser}: runtime crash "${message}" for input ${JSON.stringify(input.slice(0, 120))}`);
  }
}

function assertLines(value: unknown, parser: string, input: string) {
  assert.ok(Array.isArray(value), `${parser}: did not return an array`);
  for (const line of value as Line[]) {
    assert.match(String(line.date), /^\d{4}-\d{2}-\d{2}$/, `${parser}: impossible date ${JSON.stringify(line.date)} for input ${JSON.stringify(input.slice(0, 120))}`);
    const [y, m, d] = String(line.date).split('-').map(Number);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    assert.ok(m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1], `${parser}: date ${line.date} is not a calendar day`);
    assert.ok(Number.isSafeInteger(line.amountCents), `${parser}: amount ${line.amountCents} is not whole cents`);
    assert.ok(line.type === 'debit' || line.type === 'credit', `${parser}: type ${String(line.type)}`);
  }
}

/** Text that looks like real statement files: tags, delimiters, dates, amounts. */
const statementish = fc.oneof(
  fc.string({ maxLength: 400 }),
  fc.array(fc.constantFrom(
    '!Type:Bank', '!Type:CCard', '^', 'D01/15/2026', 'T-45.00', 'PShop', ':61:260115C100,00NTRF', ':86:Rent',
    ':20:START', ':62F:C260916USD100,00', '<Ntry>', '</Ntry>', '<Amt>10.00</Amt>', '01,1000,,,', '/',
    'Transaction Date,Description,Amount', '01/15/2026,Shop,-45.00', ',,', '"', '\uFEFF', '2026-13-45', '999999999999999999999',
  ), { maxLength: 40 }).map(parts => parts.join(fc.sample(fc.constantFrom('\n', '\r\n', ',', ' ', ''), 1)[0])),
);

describe('F-37 importers are fuzzed', () => {
  for (const parser of parsers) {
    test(`${parser.name}: never crashes, always a clear refusal or valid lines`, () => {
      fc.assert(
        fc.property(statementish, input => {
          try {
            const result = parser.run(input);
            if (parser.validate) parser.validate(result, parser.name, input);
            else assertLines(result, parser.name, input);
          } catch (error) {
            // A parser may refuse a file; it may not crash on one.
            if (error instanceof assert.AssertionError) throw error;
            assertClearRefusal(error, parser.name, input);
          }
        }),
        { numRuns: 150, verbose: 0 },
      );
    });
  }

  test('MT940 refuses a line whose date is not a calendar day (found by this fuzz run)', () => {
    assert.throws(() => parseMT940Statement(':61:991332C123,45NTRF'), /not a real calendar date/);
    assert.throws(() => parseMT940Statement(':61:260230C10,00NTRF'), /not a real calendar day|not a real calendar date/);
    // A real leap day is accepted, and the plain case still parses.
    assert.equal(parseMT940Statement(':61:240229C100,00NTRF')[0].date, '2024-02-29');
    assert.equal(parseMT940Statement(':61:2609150915C500,00NTRF')[0].amountCents, 50000);
  });

  test('the fuzz targets cover every importer the queue names', () => {
    const names = parsers.map(p => p.name).join(' | ');
    for (const named of ['CSV', 'QIF', 'MT940', 'CAMT.053', 'BAI2', 'US bank CSV']) {
      assert.ok(names.includes(named), `fuzz target missing: ${named}`);
    }
  });
});
