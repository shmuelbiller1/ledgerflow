import manifest from '../tests/fixtures/receipts/manifest.json';

/**
 * E-35 — the labelled receipt fixture set for D-31's evaluation harness.
 *
 * Twenty invented receipts (English, Hebrew and mixed, US and Israeli formats) live in
 * `src/tests/fixtures/receipts/`. For each one the manifest holds what a perfect OCR of that document returns
 * (`ocrText`, in logical reading order) and the fields a bookkeeper would fill in, worked out from the printed
 * lines: merchant, date, currency, the items with quantity and unit price, the tax with the rate the paper prints,
 * and the total. Nothing here reads a receipt — it is the answer key, so a reader can be scored without any
 * accuracy claim being invented.
 *
 * Deliberate ground-truth conventions (a scorer that disagrees is wrong, not the receipt):
 *  - `dateISO` is the calendar date the receipt means, read in the receipt's own country convention when the
 *    printed date is ambiguous (05/08/2026 is 8 May in the US files and 5 August in the Israeli ones).
 *  - `totalCents` is the amount printed on the total line — never cash tendered, change, or a refundable deposit;
 *    those are in `notInTotal` so a reader that adds them is caught.
 *  - `taxCents` is the tax printed on the receipt. Where the paper states a sum rather than a rate
 *    (`taxRate: null`), the fixture says so with `taxStatedNotComputed`; an exempt dealer prints no VAT and the
 *    expected tax is zero, which is not the same as "unknown".
 *  - `items` are the purchasable lines. A weighted or hourly line has a decimal `quantity`, and `amountCents` is
 *    the printed amount (the paper's own rounding to the cent/agora).
 */

export type ReceiptFixtureLanguage = 'en' | 'he' | 'mixed';

export interface ReceiptFixtureItem {
  /** The line as printed. */
  description: string;
  quantity: number;
  unitPriceCents: number;
  /** The amount printed on the line (quantity × unit, rounded to the cent as the paper does). */
  amountCents: number;
}

/** Figures printed on the receipt that are NOT part of the total. */
export interface NotInTotal {
  tenderedCents?: number;
  changeCents?: number;
  depositCents?: number;
}

export interface ReceiptFixture {
  id: string;
  /** File name inside `src/tests/fixtures/receipts/`. */
  file: string;
  language: ReceiptFixtureLanguage;
  country: 'US' | 'IL';
  /** ISO 4217 code of the currency the receipt is in. */
  currency: string;
  width: number;
  height: number;
  /** SHA-256 of the committed PNG, so the manifest and the image cannot drift apart. */
  sha256: string;
  merchant: string;
  /** The date exactly as printed. */
  datePrinted: string;
  /** The date the receipt means, ISO `YYYY-MM-DD`. */
  dateISO: string;
  paymentMethod: string;
  items: ReceiptFixtureItem[];
  subtotalCents: number;
  discountCents: number;
  serviceCents: number;
  /** The rate the paper prints (0.18 is printed "18%"), or null when the receipt states a sum instead of a rate. */
  taxRate: number | null;
  taxCents: number;
  /** Set when the receipt is tax-exempt ('exempt-dealer', 'food'); the printed tax is zero. */
  taxExemptBecause: string | null;
  /** True when the tax is a stated sum (airline taxes and fees) rather than a rate applied to the items. */
  taxStatedNotComputed: boolean;
  tipCents: number;
  roundingCents: number;
  totalCents: number;
  notInTotal: NotInTotal;
  /** What a perfect OCR of this document returns, one logical line per printed row. */
  ocrText: string[];
  /** What makes this receipt worth including in the set. */
  note: string;
}

export interface ReceiptFixtureSet {
  schema: string;
  generatedBy: string;
  generatedOn: string;
  counts: { total: number; en: number; he: number; mixed: number };
  receipts: ReceiptFixture[];
}

export const RECEIPT_FIXTURE_SET = manifest as ReceiptFixtureSet;

export const RECEIPT_FIXTURES: readonly ReceiptFixture[] = RECEIPT_FIXTURE_SET.receipts;

/** Where the images live in the repository. */
export const RECEIPT_FIXTURE_DIR = 'src/tests/fixtures/receipts';

export function fixtureById(id: string): ReceiptFixture | undefined {
  return RECEIPT_FIXTURES.find((r) => r.id === id);
}

/** Repository-relative path of a receipt image. */
export function fixturePath(fixture: ReceiptFixture): string {
  return `${RECEIPT_FIXTURE_DIR}/${fixture.file}`;
}

/** The transcription as one pasted-text block, the way `parseReceiptOCR` in the receipt-capture algorithm takes it. */
export function fixtureText(fixture: ReceiptFixture): string {
  return fixture.ocrText.join('\n');
}

const fold = (value: string) => value
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g, '') // Hebrew points
  .replace(/["'`׳״.,;:()\-–—/\\]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Value equality for a text field: case, Hebrew points and punctuation do not decide a match; words do. */
export function sameText(actual: string | undefined, expected: string): boolean {
  return typeof actual === 'string' && fold(actual) === fold(expected);
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Days in a month, leap years by the Gregorian rule (no Date object: a calendar count, not an instant). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return MONTH_DAYS[month - 1] ?? 0;
}

/* ------------------------------------------------------------------ the fixture's own arithmetic ----------- */

/**
 * Checks one fixture against what it says about itself: line arithmetic, the stated rate, the total, and that the
 * transcription contains the merchant, the total and every item amount. Returns the problems found (empty = sound).
 * A problem here means the answer key is wrong, so the fixture may not be used to score a reader.
 */
export function checkFixture(fixture: ReceiptFixture): string[] {
  const problems: string[] = [];
  const add = (message: string) => problems.push(`${fixture.id}: ${message}`);

  if (!fixture.items.length) add('no items');
  let itemsSum = 0;
  for (const item of fixture.items) {
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) add(`unit price is not whole cents: ${item.description}`);
    if (!(item.quantity > 0)) add(`quantity is not positive: ${item.description}`);
    const expected = Math.round(item.unitPriceCents * item.quantity);
    if (item.amountCents !== expected) add(`line amount ${item.amountCents} does not equal ${item.quantity} × ${item.unitPriceCents} = ${expected}: ${item.description}`);
    if (!Number.isInteger(item.amountCents)) add(`line amount is not whole cents: ${item.description}`);
    itemsSum += item.amountCents;
  }
  if (itemsSum !== fixture.subtotalCents) add(`item amounts add to ${itemsSum}, but the subtotal is ${fixture.subtotalCents}`);

  for (const value of [fixture.discountCents, fixture.serviceCents, fixture.tipCents, fixture.roundingCents, fixture.taxCents, fixture.totalCents]) {
    if (!Number.isInteger(value)) add('a money figure is not whole cents');
  }
  const taxable = fixture.subtotalCents - fixture.discountCents + fixture.serviceCents;
  if (fixture.taxRate !== null) {
    const computed = Math.round(taxable * fixture.taxRate);
    if (!fixture.taxStatedNotComputed && computed !== fixture.taxCents) {
      add(`tax at ${fixture.taxRate} of ${taxable} is ${computed}, but the fixture says ${fixture.taxCents}`);
    }
  }
  const total = taxable + fixture.taxCents + fixture.tipCents + fixture.roundingCents;
  if (total !== fixture.totalCents) add(`the parts add to ${total}, but the total is ${fixture.totalCents}`);

  const thousands = (cents: number) => `${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;
  const shown = thousands(fixture.totalCents);
  const text = fixtureText(fixture);
  if (!text.includes(shown)) add(`the transcription does not show the total ${shown}`);
  if (!fixture.ocrText.some((line) => sameText(line, fixture.merchant) || fold(line).includes(fold(fixture.merchant)))) {
    add('the transcription does not name the merchant');
  }
  for (const item of fixture.items) {
    if (!fixture.ocrText.some((line) => fold(line).includes(fold(item.description)))) add(`the transcription is missing the item "${item.description}"`);
  }
  const printed = fixture.datePrinted.match(/\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/);
  if (!printed) add('the printed date is not a date on the paper');
  else if (!fixture.ocrText.some((line) => line.includes(printed[0]))) add(`the transcription does not show the printed date ${printed[0]}`);
  const valid = (y: number, m: number, d: number) => y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  const wanted = (() => {
    const [y, m, d] = fixture.dateISO.split('-').map(Number);
    return y * 10000 + m * 100 + d;
  })();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fixture.dateISO)) add(`dateISO is not YYYY-MM-DD: ${fixture.dateISO}`);
  else if (printed) {
    const parts = printed[0].split(/[-/.]/).map(Number);
    if (parts[0] >= 1000) {
      if (!valid(parts[0], parts[1], parts[2])) add(`the printed date ${printed[0]} is not a calendar date`);
      else if (wanted !== parts[0] * 10000 + parts[1] * 100 + parts[2]) add(`dateISO ${fixture.dateISO} is not the printed date ${printed[0]}`);
    } else {
      const [a, b, c] = parts;
      const year = c < 100 ? 2000 + c : c;
      const dayFirst = valid(year, b, a) ? year * 10000 + b * 100 + a : null;
      const monthFirst = valid(year, a, b) ? year * 10000 + a * 100 + b : null;
      const readings = [dayFirst, monthFirst].filter((v): v is number => v !== null);
      if (!readings.length) add(`the printed date ${printed[0]} is not a calendar date`);
      else if (!readings.includes(wanted)) add(`dateISO ${fixture.dateISO} is not a reading of the printed date ${printed[0]}`);
      else if (readings.length > 1) {
        // the country's own order decides: a US receipt is month-first, an Israeli one day-first
        const byConvention = fixture.country === 'IL' ? dayFirst : monthFirst;
        if (byConvention !== wanted) add(`the printed date ${printed[0]} is ambiguous and a ${fixture.country} receipt reads it ${fixture.country === 'IL' ? 'day-first' : 'month-first'}, which is not ${fixture.dateISO}`);
      }
    }
  }
  const extra = fixture.notInTotal;
  if (extra.changeCents !== undefined) {
    if (extra.tenderedCents === undefined) add('change without cash tendered');
    else if (extra.tenderedCents - fixture.totalCents !== extra.changeCents) add('change does not equal tendered minus total');
  }
  if (extra.tenderedCents !== undefined && extra.tenderedCents <= fixture.totalCents) {
    add('cash tendered is not above the total, so it cannot be change');
  }
  if (extra.depositCents !== undefined && extra.depositCents <= 0) add('a deposit must be positive');
  if (fixture.language === 'he' && !/[\u0590-\u05FF]/.test(text)) add('a Hebrew receipt has no Hebrew text');
  if (fixture.language === 'en' && /[\u0590-\u05FF]/.test(text)) add('an English-only receipt contains Hebrew');
  if (fixture.language === 'mixed' && !/[\u0590-\u05FF]/.test(text)) add('a mixed receipt has no Hebrew text');
  return problems;
}

/* ------------------------------------------------------------------ scoring a reader ---------------------- */

/** What a reader (an OCR step, a model, a parser) returned for one receipt. Missing fields stay undefined. */
export interface FixtureRead {
  id: string;
  merchant?: string;
  /** The calendar date it decided, normalized to `YYYY-MM-DD`. */
  dateISO?: string;
  /** The date as the paper prints it (time and all, or just the date), when the reader does not normalize. */
  dateAsPrinted?: string;
  totalCents?: number;
  taxCents?: number;
  currency?: string;
  /** The line amounts it read, if it read lines. */
  itemAmountsCents?: number[];
  /** What the reader itself warned about, carried through so a reviewer can see it. */
  warnings?: string[];
}

export interface FieldScore {
  field: 'merchant' | 'dateISO' | 'dateAsPrinted' | 'totalCents' | 'taxCents' | 'currency' | 'itemsSubtotalCents';
  /** How many receipts are scored for this field. */
  scoreable: number;
  correct: number;
  /** Answered, and not equal to the answer key. */
  wrong: number;
  /** Not answered at all (an abstention is not an error, but it is not coverage). */
  missing: number;
  /** correct / (correct + wrong); null when it answered nothing. */
  precision: number | null;
  /** correct / scoreable. */
  recall: number | null;
}

export interface FixtureScorecard {
  receipts: number;
  /** Receipts with a field that is plain wrong (the number to drive to zero). */
  receiptsWithAnyWrongField: number;
  fields: FieldScore[];
  /** Per receipt, which fields were wrong — the review list. */
  wrongFieldsByReceipt: { id: string; fields: FieldScore['field'][] }[];
  /** Receipts passed in with an id that is not in the set. */
  unknownIds: string[];
  /** Fields a receipt does not state, so they were not scored (for example a tendered/change line is never the total). */
  notes: string[];
}

const FIELDS: FieldScore['field'][] = ['merchant', 'dateISO', 'dateAsPrinted', 'totalCents', 'taxCents', 'currency', 'itemsSubtotalCents'];

/** The date token on a printed date (`03/14/2026 14:23` → `03/14/2026`). */
const dateToken = (value: string) => (value.match(/\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/) || [''])[0];

function judge(field: FieldScore['field'], read: FixtureRead, fixture: ReceiptFixture): { answered: boolean; correct: boolean } {
  switch (field) {
    case 'merchant':
      return { answered: typeof read.merchant === 'string' && read.merchant.trim() !== '', correct: sameText(read.merchant, fixture.merchant) };
    case 'dateISO':
      return { answered: typeof read.dateISO === 'string' && read.dateISO.trim() !== '', correct: (read.dateISO || '').trim() === fixture.dateISO };
    case 'dateAsPrinted':
      return {
        answered: typeof read.dateAsPrinted === 'string' && read.dateAsPrinted.trim() !== '',
        correct: dateToken(read.dateAsPrinted || '') === dateToken(fixture.datePrinted),
      };
    case 'totalCents':
      return { answered: typeof read.totalCents === 'number', correct: read.totalCents === fixture.totalCents };
    case 'taxCents':
      return { answered: typeof read.taxCents === 'number', correct: read.taxCents === fixture.taxCents };
    case 'currency':
      return { answered: typeof read.currency === 'string' && read.currency.trim() !== '', correct: (read.currency || '').trim().toUpperCase() === fixture.currency };
    case 'itemsSubtotalCents': {
      const answered = Array.isArray(read.itemAmountsCents) && read.itemAmountsCents.length > 0;
      const sum = answered ? read.itemAmountsCents!.reduce((n, value) => n + value, 0) : 0;
      const countMatches = answered && read.itemAmountsCents!.length === fixture.items.length;
      return { answered, correct: countMatches && sum === fixture.subtotalCents };
    }
  }
}

/**
 * Scores reads against the answer key. Precision is over the fields it answered (so a reader that guesses is
 * punished) and recall over the receipts (so silence is visible); no combined "accuracy" number is produced,
 * because one number would hide the difference between a wrong figure and a missing one.
 */
export function scoreFixtureReads(reads: readonly FixtureRead[], fixtures: readonly ReceiptFixture[] = RECEIPT_FIXTURES): FixtureScorecard {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const unknownIds = reads.filter((r) => !byId.has(r.id)).map((r) => r.id);
  const known = reads.filter((r) => byId.has(r.id));
  const fields: FieldScore[] = FIELDS.map((field) => {
    let correct = 0;
    let wrong = 0;
    let missing = 0;
    for (const read of known) {
      const verdict = judge(field, read, byId.get(read.id)!);
      if (!verdict.answered) missing += 1;
      else if (verdict.correct) correct += 1;
      else wrong += 1;
    }
    const scoreable = known.length;
    return {
      field,
      scoreable,
      correct,
      wrong,
      missing,
      precision: correct + wrong > 0 ? correct / (correct + wrong) : null,
      recall: scoreable > 0 ? correct / scoreable : null,
    };
  });
  const wrongFieldsByReceipt = known.map((read) => {
    const fixture = byId.get(read.id)!;
    const wrong = FIELDS.filter((field) => {
      const verdict = judge(field, read, fixture);
      return verdict.answered && !verdict.correct;
    });
    return { id: read.id, fields: wrong };
  }).filter((entry) => entry.fields.length > 0);
  return {
    receipts: known.length,
    receiptsWithAnyWrongField: wrongFieldsByReceipt.length,
    fields,
    wrongFieldsByReceipt,
    unknownIds,
    notes: [
      'A missing field is counted as missing, never as correct: coverage is not accuracy.',
      'A total that includes cash tendered, change or a refundable deposit is wrong, even when the arithmetic looks tidy.',
      'A date is scored twice where a reader speaks twice: `dateISO` is the calendar date it decided (an ambiguous date read in the wrong order is wrong), `dateAsPrinted` is the date it found on the paper.',
      'A reader that only repeats the printed date answers `dateAsPrinted`, not `dateISO`; both are reported, never added together.',
      'Nothing in this scorecard is a product metric: it scores whatever reader was passed in, on 20 invented receipts.',
    ],
  };
}

/** Money in the fixture's currency, e.g. `$92.80` / `₪36.44`, for reports and PR evidence. */
export function money(cents: number, currency: string): string {
  const sign = cents < 0 ? '-' : '';
  const value = `${Math.floor(Math.abs(cents) / 100).toLocaleString('en-US')}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
  return currency === 'ILS' ? `${sign}₪${value}` : `${sign}${currency === 'USD' ? '$' : ''}${value}${currency === 'USD' ? '' : ` ${currency}`}`;
}
