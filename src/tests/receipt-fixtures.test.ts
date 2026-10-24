/**
 * E-35: the labelled receipt fixture set (20 images, English/Hebrew/mixed) that D-31's evaluation harness scores a
 * reader against. These tests keep the answer key sound and the committed images tied to it:
 *
 *  - every image is a real PNG whose bytes hash to the manifest's SHA-256 and whose IHDR size is the recorded size,
 *    so a replaced or half-written image fails here rather than quietly mislabelling an evaluation;
 *  - every fixture's own arithmetic closes (items → subtotal → discount/service → tax at the printed rate → total)
 *    and the transcription shows the merchant, the date, every item and the total it claims;
 *  - figures that are printed but are not the amount paid (cash tendered, change, a refundable deposit) are held
 *    apart in `notInTotal`, so a reader that adds them is scored wrong;
 *  - the set still contains the hard cases (tax included, zero tax, exempt dealer, stated tax, discount before tax,
 *    tip, service charge, thousand separators, decimal quantities, ambiguous dates, two subtotal-looking labels);
 *  - the scorer behaves: a perfect read scores 100%, an abstention is missing (never correct), and a wrong figure
 *    (for example the tendered cash read as the total) is caught on that receipt.
 *
 * Worked figures used below are the fixtures' own; no money code is imported or changed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  RECEIPT_FIXTURES, RECEIPT_FIXTURE_SET, RECEIPT_FIXTURE_DIR, checkFixture, fixtureById, fixturePath, fixtureText,
  money, sameText, scoreFixtureReads, type FixtureRead, type ReceiptFixture,
} from '../lib/receiptFixtures';

const root = path.resolve(import.meta.dirname, '..', '..');
const bytesOf = (fixture: ReceiptFixture) => readFileSync(path.join(root, fixturePath(fixture)));

/** A read that answers every scored field from the answer key — the harness's own self-check. */
const perfectRead = (fixture: ReceiptFixture): FixtureRead => ({
  id: fixture.id,
  merchant: fixture.merchant,
  dateISO: fixture.dateISO,
  dateAsPrinted: fixture.datePrinted,
  totalCents: fixture.totalCents,
  taxCents: fixture.taxCents,
  currency: fixture.currency,
  itemAmountsCents: fixture.items.map((item) => item.amountCents),
});

test('the set is twenty receipts and every language and country D-31 needs is represented', () => {
  assert.equal(RECEIPT_FIXTURE_SET.schema, 'ledgerflow-receipt-fixtures/1');
  assert.equal(RECEIPT_FIXTURES.length, 20);
  assert.deepEqual(RECEIPT_FIXTURE_SET.counts, {
    total: 20,
    en: RECEIPT_FIXTURES.filter((r) => r.language === 'en').length,
    he: RECEIPT_FIXTURES.filter((r) => r.language === 'he').length,
    mixed: RECEIPT_FIXTURES.filter((r) => r.language === 'mixed').length,
  });
  assert.ok(RECEIPT_FIXTURE_SET.counts.en >= 8 && RECEIPT_FIXTURE_SET.counts.he >= 6 && RECEIPT_FIXTURE_SET.counts.mixed >= 3,
    'at least 8 English, 6 Hebrew and 3 mixed receipts');
  for (const country of ['US', 'IL'] as const) {
    assert.ok(RECEIPT_FIXTURES.filter((r) => r.country === country).length >= 8, `at least 8 ${country} receipts`);
  }
  assert.equal(new Set(RECEIPT_FIXTURES.map((r) => r.id)).size, 20, 'receipt ids are unique');
  assert.equal(new Set(RECEIPT_FIXTURES.map((r) => r.file)).size, 20, 'file names are unique');
  for (const fixture of RECEIPT_FIXTURES) {
    assert.equal(fixture.currency, fixture.country === 'IL' ? 'ILS' : 'USD');
    assert.ok(fixture.merchant.length > 2, `${fixture.id} names a merchant`);
    assert.match(fixture.sha256, /^[0-9a-f]{64}$/);
  }
});

test('each image is a PNG of the recorded size and its bytes are the ones the manifest hashes', () => {
  for (const fixture of RECEIPT_FIXTURES) {
    const file = path.join(root, fixturePath(fixture));
    assert.ok(existsSync(file), `${fixturePath(fixture)} exists`);
    const bytes = bytesOf(fixture);
    assert.ok(bytes.length > 1000, `${fixture.id} is not an empty image`);
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${fixture.id} has the PNG signature`);
    const chunk = bytes.subarray(12, 16).toString('latin1');
    assert.equal(chunk, 'IHDR', `${fixture.id} starts with an IHDR chunk`);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [fixture.width, fixture.height], `${fixture.id} is ${fixture.width}×${fixture.height}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256, `${fixture.id} matches its manifest hash`);
  }
  assert.ok(statSync(path.join(root, RECEIPT_FIXTURE_DIR)).isDirectory());
});

test('every fixture’s printed arithmetic closes, and the transcription shows what it claims', () => {
  const problems = RECEIPT_FIXTURES.flatMap((fixture) => checkFixture(fixture));
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('worked figures on three receipts, by hand', () => {
  // r01: 24.99 + 2 × 8.49 + 3 × 4.29 (12.87) + 32.50 = 87.34; 6.25% of 8,734 = 545.875 → 546 cents; total 9,280
  const acme = fixtureById('r01-acme-hardware')!;
  assert.deepEqual([acme.subtotalCents, acme.taxCents, acme.totalCents], [8_734, 546, 9_280]);
  assert.equal(money(acme.totalCents, acme.currency), '$92.80');

  // r10: 7.90 + 8.50 + 6.20 + round(1.2 × 6.90 = 8.28) = 30.88; VAT 18% of 3,088 = 555.84 → 556; total 3,644 agora
  const hadar = fixtureById('r10-hadar-supermarket')!;
  assert.deepEqual([hadar.subtotalCents, hadar.taxCents, hadar.totalCents], [3_088, 556, 3_644]);
  assert.equal(money(hadar.totalCents, hadar.currency), '₪36.44');

  // r03: 89.99 + 2 × 29.95 (59.90) + 8.49 = 158.38; a 10.00 coupon comes off before tax; 8.25% of 14,838 = 1,224.135
  // → 1,224; total 16,062. Tax on 158.38 instead would be 1,307 — a 83-cent difference, which is the point.
  const depot = fixtureById('r03-office-depot')!;
  assert.deepEqual([depot.subtotalCents, depot.discountCents, depot.taxCents, depot.totalCents], [15_838, 1_000, 1_224, 16_062]);
});

test('the set still holds the hard cases, so a later edit cannot quietly drop them', () => {
  const has = (predicate: (f: ReceiptFixture) => boolean) => RECEIPT_FIXTURES.some(predicate);
  const cases: [string, boolean][] = [
    ['a discount taken before tax', has((f) => f.discountCents > 0 && f.taxRate !== null)],
    ['a tip that is part of the total', has((f) => f.tipCents > 0)],
    ['a service charge that is part of the total', has((f) => f.serviceCents > 0)],
    ['an exempt dealer with no VAT', has((f) => f.taxExemptBecause === 'exempt-dealer')],
    ['an explicit zero tax line', has((f) => f.taxCents === 0 && f.taxExemptBecause !== null)],
    ['a tax stated as a sum, not a rate', has((f) => f.taxStatedNotComputed)],
    ['cash tendered and change outside the total', has((f) => f.notInTotal.tenderedCents !== undefined && f.notInTotal.changeCents !== undefined)],
    ['a refundable deposit outside the total', has((f) => f.notInTotal.depositCents !== undefined)],
    ['a decimal quantity (weighted or hourly line)', has((f) => f.items.some((i) => !Number.isInteger(i.quantity)))],
    ['thousands separators in the money', has((f) => f.totalCents >= 100_000)],
    ['a date whose reading depends on the country', has((f) => {
      const printed = f.datePrinted.match(/\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/);
      if (!printed) return false;
      const [a, b] = printed[0].split(/[-/.]/).map(Number);
      return a <= 12 && b <= 12 && a !== b;
    })],
    ['two subtotal-looking labels on one receipt', has((f) => f.language === 'mixed' && f.ocrText.filter((line) => /סה"כ|TOTAL/i.test(line)).length >= 2)],
    ['an item line priced at zero', has((f) => f.items.some((i) => i.unitPriceCents === 0))],
  ];
  for (const [label, present] of cases) assert.ok(present, `the set still has ${label}`);
});

test('the transcription is the document: merchant first, Hebrew in Hebrew, one line per printed row', () => {
  for (const fixture of RECEIPT_FIXTURES) {
    const text = fixtureText(fixture);
    const lines = text.split('\n');
    assert.equal(lines.length, fixture.ocrText.length);
    assert.ok(lines.every((line) => line.trim() === line && line.length > 0), `${fixture.id} has no blank or padded lines`);
    assert.ok(/[\u0590-\u05FF]/.test(text) === (fixture.country === 'IL'), `${fixture.id}: Hebrew only on Israeli receipts`);
    assert.match(text, new RegExp(`\\$|₪`), `${fixture.id} shows a currency symbol on the paper`);
  }
  assert.ok(sameText('  ACME  hardware ltd. ', 'ACME Hardware Ltd'), 'text comparison ignores case, spacing and punctuation');
  assert.ok(!sameText('ACME Hardware', 'ACME Hardware Ltd'), 'a truncated merchant name is not a match');
});

test('a perfect read scores 100%, and the scorecard never turns silence into a pass', () => {
  const perfect = scoreFixtureReads(RECEIPT_FIXTURES.map(perfectRead));
  assert.equal(perfect.receipts, 20);
  assert.equal(perfect.receiptsWithAnyWrongField, 0);
  assert.deepEqual(perfect.wrongFieldsByReceipt, []);
  assert.deepEqual(perfect.unknownIds, []);
  for (const field of perfect.fields) {
    assert.equal(field.correct, 20, `${field.field} is fully answered by the answer key`);
    assert.equal(field.missing, 0);
    assert.equal(field.wrong, 0);
    assert.equal(field.precision, 1);
    assert.equal(field.recall, 1);
  }

  const silent = scoreFixtureReads(RECEIPT_FIXTURES.map((fixture) => ({ id: fixture.id })));
  assert.ok(silent.fields.every((field) => field.correct === 0 && field.wrong === 0 && field.missing === 20));
  assert.ok(silent.fields.every((field) => field.recall === 0), 'no coverage, no credit');
  assert.ok(silent.fields.every((field) => field.precision === null), 'precision is undefined when nothing was answered');
});

test('a reader that reads cash tendered as the total, or the other date order, is caught on that receipt only', () => {
  const diner = fixtureById('r08-mainstreet-diner')!;
  assert.deepEqual([diner.totalCents, diner.notInTotal.tenderedCents, diner.notInTotal.changeCents], [2_274, 5_000, 2_726]);
  const reads = RECEIPT_FIXTURES.map(perfectRead).map((read) => {
    if (read.id === 'r08-mainstreet-diner') return { ...read, totalCents: 5_000 }; // the tendered cash, not the amount paid
    if (read.id === 'r18-alonit-supplies') return { ...read, dateISO: '2026-05-08' }; // month-first read of 05/08/2026 in Israel
    if (read.id === 'r04-shell-fuel') return { ...read, merchant: 'SHELL OIL' }; // a truncation, not a match
    return read;
  });
  const score = scoreFixtureReads(reads);
  assert.equal(score.receiptsWithAnyWrongField, 3);
  assert.deepEqual(score.wrongFieldsByReceipt, [
    { id: 'r04-shell-fuel', fields: ['merchant'] },
    { id: 'r08-mainstreet-diner', fields: ['totalCents'] },
    { id: 'r18-alonit-supplies', fields: ['dateISO'] },
  ]);
  const total = score.fields.find((f) => f.field === 'totalCents')!;
  assert.deepEqual([total.correct, total.wrong, total.missing], [19, 1, 0]);
  assert.equal(total.precision, 19 / 20);

  const unknown = scoreFixtureReads([{ id: 'r99-not-a-fixture', totalCents: 1 }]);
  assert.deepEqual(unknown.unknownIds, ['r99-not-a-fixture']);
  assert.equal(unknown.receipts, 0);
});

test('a receipt whose answer key is broken is refused before it can score anything', () => {
  const good = fixtureById('r01-acme-hardware')!;
  const brokenClaim = { ...good, totalCents: good.totalCents + 1 };
  assert.match(checkFixture(brokenClaim).join('\n'), /the parts add to 9280, but the total is 9281/);
  const brokenRate = { ...good, taxCents: good.taxCents + 10 };
  assert.match(checkFixture(brokenRate).join('\n'), /tax at 0.0625/);
  const brokenLine = { ...good, items: good.items.map((item, index) => (index === 0 ? { ...item, amountCents: item.amountCents + 5 } : item)) };
  assert.match(checkFixture(brokenLine).join('\n'), /does not equal/);
  const brokenDate = { ...good, dateISO: '2026-14-03' };
  assert.match(checkFixture(brokenDate).join('\n'), /not a reading of the printed date|is not YYYY-MM-DD/);
  const brokenTendered = { ...fixtureById('r08-mainstreet-diner')!, notInTotal: { tenderedCents: 5_000, changeCents: 1 } };
  assert.match(checkFixture(brokenTendered).join('\n'), /change does not equal tendered minus total/);
  const brokenLanguage = { ...fixtureById('r17-ronit-hair')!, language: 'en' as const };
  assert.match(checkFixture(brokenLanguage).join('\n'), /English-only receipt contains Hebrew/);
  assert.deepEqual(checkFixture(good), []);
});

test('money() prints each currency the way its own documents do', () => {
  assert.equal(money(9_280, 'USD'), '$92.80');
  assert.equal(money(3_644, 'ILS'), '₪36.44');
  assert.equal(money(123_456, 'EUR'), '1,234.56 EUR');
  assert.equal(money(-500, 'USD'), '-$5.00');
});
