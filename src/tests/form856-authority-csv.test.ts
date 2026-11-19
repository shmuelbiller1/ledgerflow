/**
 * E-17: the authority-order Form 856 CSV. The field table is checked against the Tax Authority's
 * published record-60 layout (20 fields, content columns 1–216, then CR/LF = the 218-byte record),
 * the cells are hand-worked under the authority's numeric rules (whole agorot, no decimal point,
 * zero-padded to the field width, empty → zeros), and the payment mapping produces one record per
 * withholding rate exactly as the authority requires — a rate is never guessed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORM_856_RECORD_60_FIELDS,
  form856AuthorityCsv,
  form856AuthorityPayees,
  ilWithholdingFileNo,
  type Form856AuthorityPayee,
} from '../lib/tax/form856AuthorityCsv';
import type { Form856Payment } from '../lib/tax/form856';
import { toCsv } from '../lib/csvExport';
import { parseCsv } from '../lib/csv';

const payer = { withholdingFileNo: '912345678', taxYear: '2025' };

const payee: Form856AuthorityPayee = {
  name: 'Alpha Ltd',
  payeeFileType: '3',
  payeeItFileNo: '511111111',
  supplierAccountNo: '12345',
  street: 'Herzl 1',
  city: 'Tel Aviv',
  paymentsCents: 118_000,
  taxWithheldCents: 30_000,
  vatTransferredCents: 0,
  yearEndBalanceCents: 0,
  withholdingRatePercent: 10,
  approvingOffice: 'טבריה 01',
  occupation: 'consulting',
  withholdingTypeCode: '03',
};

test('E-17 the field table is the authority record-60 layout: 20 fields, columns 1–216', () => {
  assert.equal(FORM_856_RECORD_60_FIELDS.length, 20);
  let expectedFrom = 1;
  let widthSum = 0;
  for (const field of FORM_856_RECORD_60_FIELDS) {
    assert.equal(field.startCol, expectedFrom, `field ${field.no} must start where the previous ended`);
    assert.equal(field.width, field.endCol - field.startCol + 1, `field ${field.no} width`);
    expectedFrom = field.endCol + 1;
    widthSum += field.width;
  }
  assert.equal(FORM_856_RECORD_60_FIELDS.at(-1)?.endCol, 216, 'content ends at column 216; CR/LF are 217–218');
  assert.equal(widthSum, 216, 'the content of every record type is 216 bytes + CR/LF = 218');
  assert.deepEqual(
    FORM_856_RECORD_60_FIELDS.map(field => field.no),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  );
  const recordType = FORM_856_RECORD_60_FIELDS.at(-1);
  assert.equal(recordType?.key, 'recordType');
  assert.equal(recordType?.startCol, 215, 'the authority places the record-type code at 215–216');
  const reportCode = FORM_856_RECORD_60_FIELDS[1];
  assert.deepEqual([reportCode.startCol, reportCode.width], [10, 2], 'report code at 10–11');
  const payments = FORM_856_RECORD_60_FIELDS.find(field => field.key === 'payments');
  assert.deepEqual([payments?.startCol, payments?.width], [97, 11], 'gross payments at 97–107');
});

test('E-17 a typed fixture becomes the record-60 row in the authority field order', () => {
  const result = form856AuthorityCsv(payer, [payee]);
  assert.equal(result.readyForFiling, false);
  assert.equal(result.canDownload, true, JSON.stringify(result.blockers));
  assert.deepEqual(result.blockers, []);
  assert.equal(result.headers.length, 20);
  assert.equal(result.headers[0], '1. מספר תיק ניכויים / Withholding file no. (1-9, 9)');
  assert.equal(result.headers[10], '11. סה״כ תשלומים ששולמו ברוטו (כולל מע״מ) / Gross payments (incl. VAT) (97-107, 11)');
  assert.deepEqual(result.rows, [[
    '912345678', // 1 file no, already nine digits
    '96',        // 2 report code, on every record
    '2025',      // 3 tax year
    '0',         // 4 worker flag: the authority's empty numeric
    '3',         // 5 licensed dealer
    '511111111', // 6 payee ID, nine digits
    '00000000012345', // 7 supplier account, zero-padded to 14
    'Alpha Ltd', // 8 name
    'Herzl 1',   // 9 street
    'Tel Aviv',  // 10 city
    '00000118000', // 11 1,180.00 ILS = 118,000 agorot, no decimal point, 11 digits
    '000030000',   // 12 300.00 ILS = 30,000 agorot, 9 digits
    '00000000', // 13 VAT transferred: empty → zeros
    '00000000', // 14 year-end balance: empty → zeros
    '10',       // 15 rate 10% without the % sign
    'טבריה 01', // 16 approving office
    'consulting', // 17 occupation
    '',         // 18 filler
    '03',       // 19 withholding type
    '60',       // 20 record type
  ]]);
});

test('E-17 the CSV reads back with its header order and Hebrew name intact', () => {
  const result = form856AuthorityCsv(payer, [payee]);
  const parsed = parseCsv(toCsv([...result.headers], result.rows));
  assert.equal(parsed.length, 2, 'header + one record');
  assert.deepEqual(parsed[0], [...result.headers]);
  assert.deepEqual(parsed[1], result.rows[0]);
  assert.match(parsed[1][7], /Alpha Ltd/);
  assert.equal(parsed[1][19], '60');
});

test('E-17 empty numeric fields are zeros, a missing rate is reported, never invented', () => {
  const minimal: Form856AuthorityPayee = {
    name: 'Beta Works', paymentsCents: 236_000, taxWithheldCents: 10_000,
  };
  const result = form856AuthorityCsv(payer, [minimal]);
  assert.equal(result.canDownload, true, JSON.stringify(result.blockers));
  const row = result.rows[0];
  assert.equal(row[3], '0', 'worker flag empty → 0');
  assert.equal(row[5], '000000000', 'no tax ID → zeros');
  assert.equal(row[6], '00000000000000', 'no supplier account → 14 zeros');
  assert.equal(row[8], '', 'no street → blank');
  assert.equal(row[14], '00', 'no rate → 00');
  assert.equal(row[18], '00', 'no type code → 00');
  assert.ok(result.problems.some(problem => /no tax ID/.test(problem)), JSON.stringify(result.problems));
  assert.ok(result.problems.some(problem => /no withholding rate/.test(problem)), JSON.stringify(result.problems));
  assert.ok(result.notices.some(notice => /218-byte/.test(notice)));
  assert.ok(result.notices.some(notice => /agorot/.test(notice)));
});

test('E-17 invalid payer input blocks the file instead of writing a plausible fake', () => {
  for (const [payerInput, pattern] of [
    [{ withholdingFileNo: '123', taxYear: '2025' }, /nine digits/],
    [{ withholdingFileNo: '912345678', taxYear: '25' }, /four digits/],
    [{ withholdingFileNo: '912345678', taxYear: '0000' }, /four digits/],
  ] as Array<[{ withholdingFileNo: string; taxYear: string }, RegExp]>) {
    const result = form856AuthorityCsv(payerInput, [payee]);
    assert.equal(result.canDownload, false, JSON.stringify(payerInput));
    assert.deepEqual(result.rows, [], JSON.stringify(payerInput));
    assert.ok(result.blockers.some(blocker => pattern.test(blocker)), JSON.stringify(result.blockers));
  }
  assert.equal(form856AuthorityCsv(payer, []).canDownload, false, 'no payees, nothing to download');
});

test('E-17 negative money, impossible rates and malformed codes refuse the record', () => {
  for (const [bad, pattern] of [
    [{ ...payee, paymentsCents: -1 }, /non-negative/],
    [{ ...payee, taxWithheldCents: -10 }, /non-negative/],
    [{ ...payee, withholdingRatePercent: 100 }, /whole percent/],
    [{ ...payee, withholdingRatePercent: 10.5 }, /whole percent/],
    [{ ...payee, withholdingTypeCode: '3' }, /two digits/],
    [{ ...payee, name: '   ' }, /no name/],
  ] as Array<[Form856AuthorityPayee, RegExp]>) {
    const result = form856AuthorityCsv(payer, [bad]);
    assert.equal(result.canDownload, false, JSON.stringify(bad));
    assert.deepEqual(result.rows, [], JSON.stringify(bad));
    assert.ok(result.blockers.some(blocker => pattern.test(blocker)), JSON.stringify(result.blockers));
  }
});

test('E-17 overflows keep the full value and say so; a file no. without the 9 prefix is flagged', () => {
  const result = form856AuthorityCsv({ withholdingFileNo: '812345678', taxYear: '2025' }, [{
    ...payee,
    name: 'A'.repeat(30),
    paymentsCents: 100_000_000_000, // 12 digits, one more than field 11 holds
    payeeItFileNo: 'not-an-id',
  }]);
  assert.equal(result.canDownload, true, JSON.stringify(result.blockers));
  const row = result.rows[0];
  assert.equal(row[7], 'A'.repeat(30), 'the CSV keeps the full name');
  assert.equal(row[10], '100000000000', 'the CSV keeps the full amount');
  assert.equal(row[5], 'not-an-id', 'a non-numeric ID is written as recorded');
  assert.ok(result.problems.some(problem => /30 characters/.test(problem)), JSON.stringify(result.problems));
  assert.ok(result.problems.some(problem => /more than the field's 11 digits/.test(problem)), JSON.stringify(result.problems));
  assert.ok(result.problems.some(problem => /not up to 9 digits/.test(problem)), JSON.stringify(result.problems));
  assert.ok(result.problems.some(problem => /does not start with 9/.test(problem)), JSON.stringify(result.problems));
});

test('E-17 payments map to one record per withholding rate, unrated ones reported', () => {
  const payments: Form856Payment[] = [
    { id: 'p1', date: '2026-03-10', direction: 'made', contactId: 'v1', contactName: 'Alpha Ltd', contactTaxId: '511111111', amountCents: 118_000, withheldCents: 30_000, withholdingRatePercent: 10 },
    { id: 'p2', date: '2026-09-02', direction: 'made', contactId: 'v1', contactName: 'Alpha Ltd', contactTaxId: '511111111', amountCents: 59_000, withheldCents: 10_000, withholdingRatePercent: 5 },
    { id: 'p3', date: '2026-05-05', direction: 'made', contactId: 'v2', contactName: 'Beta Works', amountCents: 236_000, withheldCents: 10_000 },
    { id: 'p4', date: '2025-12-31', direction: 'made', contactId: 'v3', contactName: 'Old Co', amountCents: 100_000, withheldCents: 30_000, withholdingRatePercent: 10 },
    { id: 'p5', date: '2026-04-01', direction: 'received', contactId: 'v4', contactName: 'Customer', amountCents: 50_000, withheldCents: 10_000, withholdingRatePercent: 10 },
    { id: 'p6', date: '2026-06-01', direction: 'made', contactId: 'v1', contactName: 'Alpha Ltd', contactTaxId: '599999999', amountCents: 10_000, withheldCents: 2_000, withholdingRatePercent: 10 },
    { id: 'p7', date: '2026-07-01', direction: 'made', contactId: 'v5', contactName: 'Odd Rate', amountCents: 10_000, withheldCents: 1_000, withholdingRatePercent: 10.5 },
  ];
  const { payees, problems } = form856AuthorityPayees(payments, '2026');
  assert.deepEqual(payees.map(p => [p.name, p.withholdingRatePercent, p.paymentsCents, p.taxWithheldCents]), [
    ['Alpha Ltd', 5, 59_000, 10_000],
    ['Alpha Ltd', 10, 128_000, 32_000], // p1 + p6, the conflicting tax ID reported
    ['Beta Works', undefined, 236_000, 10_000],
    ['Odd Rate', undefined, 10_000, 1_000], // 10.5 is not a whole percent: unrated + reported
  ], JSON.stringify(payees));
  assert.ok(problems.some(problem => /different tax IDs/.test(problem)), JSON.stringify(problems));
  assert.ok(problems.some(problem => /10.5/.test(problem)), JSON.stringify(problems));

  const result = form856AuthorityCsv(payer, payees);
  assert.equal(result.canDownload, true, JSON.stringify(result.blockers));
  assert.equal(result.rows.length, 4);
  assert.ok(
    result.problems.some(problem => /Beta Works/.test(problem) && /no withholding rate/.test(problem)),
    'the missing rate surfaces per vendor in the written result',
  );
  const alpha10 = result.rows.find(row => row[7] === 'Alpha Ltd' && row[14] === '10');
  assert.deepEqual(alpha10?.slice(10, 15), ['00000128000', '000032000', '00000000', '00000000', '10']);
});

test('E-17 the withholding file number comes only from a nine-digit Israeli employer registration', () => {
  const registration = (kind: string, country: string, number: string) =>
    ({ kind, number, place: { country } }) as never;
  assert.equal(ilWithholdingFileNo(undefined), '');
  assert.equal(ilWithholdingFileNo(null), '');
  assert.equal(ilWithholdingFileNo({ books: { registrations: [registration('vat', 'IL', '511111111')] } }), '', 'a dealer number is not a withholding file');
  assert.equal(ilWithholdingFileNo({ books: { registrations: [registration('employer', 'US', '12-3456789')] } }), '', 'a US EIN is not it');
  assert.equal(ilWithholdingFileNo({ books: { registrations: [registration('employer', 'IL', '12345')] } }), '', 'nine digits required');
  assert.equal(
    ilWithholdingFileNo({ books: { registrations: [registration('employer', 'US', '123456789'), registration('employer', 'IL', '912345678')] } }),
    '912345678',
  );
});
