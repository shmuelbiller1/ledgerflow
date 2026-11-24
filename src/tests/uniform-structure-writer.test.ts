/**
 * E-33: the Uniform Structure writer. Hand-worked from UNIFORM_FIXTURE (E-54): every record
 * is exactly its spec width, record numbers run 1…12 across the file, A000's total equals
 * Z900's, the INI summary counts equal the records actually written, and the amount fields
 * carry the implied-decimal figures the fixture records (1180000 agorot → "+00000001180000").
 * Sources: docs/UNIFORM_STRUCTURE_RESEARCH.md and the SHAAM field tables it cites.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIFORM_RECORD_LAYOUTS,
  UNIFORM_A000,
  UNIFORM_A100,
  UNIFORM_B100,
  UNIFORM_B110,
  UNIFORM_C100,
  UNIFORM_D110,
  UNIFORM_D120,
  UNIFORM_M100,
  UNIFORM_Z900,
  UNIFORM_FIXTURE,
  type UniformFixtureInput,
  type UniformRecordLayout,
} from '../lib/tax/uniformStructure';
import {
  writeUniformFiles,
  encodeUniformIso88598,
  normalizeUniformText,
  uniformCharByte,
  type UniformWriteOptions,
} from '../lib/tax/uniformStructureWriter';

const OPTIONS: UniformWriteOptions = {
  processDate: '20260115',
  processTime: '0930',
  primaryIdentifier: '42',
  baseCurrency: 'ILS',
  software: {
    name: 'Ledgerflow',
    version: 'draft',
    vendorName: 'Ledgerflow',
    registrationNo: '',
    vendorTaxId: '',
  },
};

const LAYOUT_BY_CODE = new Map(UNIFORM_RECORD_LAYOUTS.map(layout => [layout.code, layout]));

function bkmvLines(text: string): string[] {
  return text.split('\r\n').filter(line => line.length > 0);
}

/** Byte offset of a field inside its record, from the pinned layout. */
function fieldOffset(layout: UniformRecordLayout, key: string): { offset: number; width: number } {
  let offset = 0;
  for (const field of layout.fields) {
    if (field.key === key && field.width > 0) return { offset, width: field.width };
    offset += field.width;
  }
  throw new Error(`No field ${key} on ${layout.code}`);
}

function sliceField(line: string, layout: UniformRecordLayout, key: string): string {
  const { offset, width } = fieldOffset(layout, key);
  return line.slice(offset, offset + width);
}

test('the clean fixture writes with no problems (control for the refusal cases)', () => {
  const out = writeUniformFiles(UNIFORM_FIXTURE, OPTIONS);
  assert.deepEqual(out.problems, []);
  assert.equal(out.canDownload, true);
  assert.equal(out.readyForFiling, false);
});

test('every BKMVDATA line is exactly its layout width, A100 first and Z900 last', () => {
  const out = writeUniformFiles(UNIFORM_FIXTURE, OPTIONS);
  const lines = bkmvLines(out.bkmvdataText);
  assert.equal(lines.length, 12, 'A100 + 3 B100 + 3 B110 + C100 + D110 + D120 + M100 + Z900');
  assert.equal(lines[0].slice(0, 4), 'A100');
  assert.equal(lines[lines.length - 1].slice(0, 4), 'Z900');
  for (const line of lines) {
    const layout = LAYOUT_BY_CODE.get(line.slice(0, 4));
    assert.ok(layout, `unknown record code ${line.slice(0, 4)}`);
    assert.equal(line.length, layout.width, `${layout.code} is ${line.length}, spec says ${layout.width}`);
  }
});

test('record numbers run sequentially 1…12 across the file, and Z900 carries the total', () => {
  const out = writeUniformFiles(UNIFORM_FIXTURE, OPTIONS);
  const lines = bkmvLines(out.bkmvdataText);
  const numberKeys: Record<string, string> = {
    A100: 'recordNoInFile', B100: 'recordNoInFile', B110: 'recordNoInFile', C100: 'recordNoInFile',
    D110: 'recordNoInFile', D120: 'recordNoInFile', M100: 'recordNoInFile', Z900: 'recordNoInFile',
  };
  lines.forEach((line, index) => {
    const code = line.slice(0, 4);
    const layout = LAYOUT_BY_CODE.get(code)!;
    const actual = Number(sliceField(line, layout, numberKeys[code]));
    assert.equal(actual, index + 1, `${code} record number`);
  });
  const z900 = lines[lines.length - 1];
  assert.equal(sliceField(z900, UNIFORM_Z900, 'totalRecordsInFile'), '000000000000012');
  assert.equal(out.totalRecords, 12);
});

test('INI.TXT is A000 plus one 19-char summary per record type, counts hand-worked', () => {
  const out = writeUniformFiles(UNIFORM_FIXTURE, OPTIONS);
  const lines = out.iniText.split('\r\n').filter(line => line.length > 0);
  assert.equal(lines.length, 1 + 8, 'A000 + eight summary lines (A100 B100 B110 C100 D110 D120 M100 Z900)');
  const a000 = lines[0];
  assert.equal(a000.length, UNIFORM_A000.width);
  assert.equal(a000.slice(0, 4), 'A000');
  // field 1002: A000 total must equal Z900's total (spec note on both fields)
  assert.equal(sliceField(a000, UNIFORM_A000, 'totalRecordsInBkmvdata'), '000000000000012');
  assert.equal(sliceField(a000, UNIFORM_A000, 'systemConstant'), '&OF1.31&');
  assert.equal(sliceField(a000, UNIFORM_A000, 'characterEncoding'), '1', 'ISO-8859-8-i');
  assert.equal(sliceField(a000, UNIFORM_A000, 'accountingType'), '2', 'double-entry');
  assert.match(sliceField(a000, UNIFORM_A000, 'fileOutputPath'), /^OPENFRMT\/512345678\.2025\/01150930/);

  const expected: Record<string, number> = {
    A100: 1, B100: 3, B110: 3, C100: 1, D110: 1, D120: 1, M100: 1, Z900: 1,
  };
  for (const summary of lines.slice(1)) {
    assert.equal(summary.length, 19, 'summary line is field 1050 (4) + field 1051 (15)');
    const code = summary.slice(0, 4);
    const count = Number(summary.slice(4));
    assert.equal(count, expected[code], `summary count for ${code}`);
  }
  // and those counts equal the records actually in BKMVDATA
  const actual: Record<string, number> = {};
  for (const line of bkmvLines(out.bkmvdataText)) {
    actual[line.slice(0, 4)] = (actual[line.slice(0, 4)] ?? 0) + 1;
  }
  assert.deepEqual(actual, expected);
});

test('amount, quantity and rate fields carry the fixture figures in implied decimal', () => {
  const out = writeUniformFiles(UNIFORM_FIXTURE, OPTIONS);
  const lines = bkmvLines(out.bkmvdataText);

  const b100 = lines.filter(line => line.startsWith('B100'));
  // debit: cash 1180000 agorot; credits: sales 1000000, VAT 180000
  assert.equal(sliceField(b100[0], UNIFORM_B100, 'amountLocal'), '+00000001180000');
  assert.equal(sliceField(b100[0], UNIFORM_B100, 'debitCreditIndicator'), '1');
  assert.equal(sliceField(b100[1], UNIFORM_B100, 'amountLocal'), '+00000001000000');
  assert.equal(sliceField(b100[1], UNIFORM_B100, 'debitCreditIndicator'), '2');
  assert.equal(sliceField(b100[2], UNIFORM_B100, 'amountLocal'), '+00000000180000');
  assert.equal(sliceField(b100[0], UNIFORM_B100, 'transactionNo'), '0000000001');
  assert.equal(sliceField(b100[0], UNIFORM_B100, 'transactionLineNo'), '00001');
  assert.equal(sliceField(b100[2], UNIFORM_B100, 'transactionLineNo'), '00003');

  const c100 = lines.find(line => line.startsWith('C100'))!;
  assert.equal(sliceField(c100, UNIFORM_C100, 'documentType'), '305');
  assert.equal(sliceField(c100, UNIFORM_C100, 'documentNo').trim(), '1001');
  assert.equal(sliceField(c100, UNIFORM_C100, 'documentIssueDate'), '20250115');
  assert.equal(sliceField(c100, UNIFORM_C100, 'customerTaxId'), '514000111');
  assert.equal(sliceField(c100, UNIFORM_C100, 'amountAfterDiscountExclVat'), '+00000001000000');
  assert.equal(sliceField(c100, UNIFORM_C100, 'vatAmount'), '+00000000180000');
  assert.equal(sliceField(c100, UNIFORM_C100, 'amountInclVat'), '+00000001180000');

  const d110 = lines.find(line => line.startsWith('D110'))!;
  assert.equal(sliceField(d110, UNIFORM_D110, 'description').trim(), 'Consulting services');
  assert.equal(sliceField(d110, UNIFORM_D110, 'quantity'), '+0000000000100000', '10 units at X9(12)V9999');
  assert.equal(sliceField(d110, UNIFORM_D110, 'unitPriceExclVat'), '+00000000100000', '1000.00');
  assert.equal(sliceField(d110, UNIFORM_D110, 'lineTotal'), '+00000001000000', '10 × 1000.00 = 10000.00');
  assert.equal(sliceField(d110, UNIFORM_D110, 'vatRate'), '1800', '18% at V99(2)');

  const d120 = lines.find(line => line.startsWith('D120'))!;
  assert.equal(sliceField(d120, UNIFORM_D120, 'paymentMethod'), '1', 'cash');
  assert.equal(sliceField(d120, UNIFORM_D120, 'lineAmount'), '+00000001180000');
  assert.equal(sliceField(d120, UNIFORM_D120, 'documentDate'), '20250115');

  const m100 = lines.find(line => line.startsWith('M100'))!;
  assert.equal(sliceField(m100, UNIFORM_M100, 'openingStockQty'), '+00000010000', '100 at X9(9)V99');
  assert.equal(sliceField(m100, UNIFORM_M100, 'totalStockIn'), '+00000005000');
  assert.equal(sliceField(m100, UNIFORM_M100, 'totalStockOut'), '+00000003000');
});

test('totals: journal balances, document type totals and record counts agree', () => {
  const out = writeUniformFiles(UNIFORM_FIXTURE, OPTIONS);
  assert.equal(out.journalDebitsCents, 1180000);
  assert.equal(out.journalCreditsCents, 1180000);
  assert.deepEqual(out.documentTypeTotals, [
    { documentType: '305', count: 1, totalInclVatCents: 1180000, vatAmountCents: 180000 },
  ]);
  assert.deepEqual(out.recordCounts, [
    { code: 'A100', count: 1 }, { code: 'B100', count: 3 }, { code: 'B110', count: 3 },
    { code: 'C100', count: 1 }, { code: 'D110', count: 1 }, { code: 'D120', count: 1 },
    { code: 'M100', count: 1 }, { code: 'Z900', count: 1 },
  ]);
});

test('both files are CRLF throughout, with no bare line feeds', () => {
  const out = writeUniformFiles(UNIFORM_FIXTURE, OPTIONS);
  for (const text of [out.iniText, out.bkmvdataText]) {
    assert.ok(text.endsWith('\r\n'), 'file ends with CRLF');
    assert.equal(text.replace(/\r\n/g, '').includes('\n'), false, 'no bare LF');
    assert.equal(text.replace(/\r\n/g, '').includes('\r'), false, 'no bare CR');
    for (const line of text.split('\r\n').filter(part => part.length > 0)) {
      assert.ok(line.length > 0);
    }
  }
});

test('ISO-8859-8 encoding: Hebrew letters, ASCII passthrough, refusal outside the repertoire', () => {
  // שלום → shin 0xF9, lamed 0xEC, vav 0xE5, final mem 0xED (Python iso8859-8, verified)
  assert.deepEqual([...encodeUniformIso88598('שלום')], [0xf9, 0xec, 0xe5, 0xed]);
  assert.deepEqual([...encodeUniformIso88598('AB1')], [0x41, 0x42, 0x31]);
  assert.equal(uniformCharByte('א'), 0xe0);
  assert.equal(uniformCharByte('ך'), 0xea, 'final kaf has its own byte');
  assert.equal(uniformCharByte('€'), undefined, 'euro sign is not in ISO-8859-8');
  assert.throws(() => encodeUniformIso88598('Café'), /not in ISO-8859-8/);
  // gershayim and dashes are substituted (documented), never silently dropped
  assert.equal(normalizeUniformText('ח״פ'), 'ח"פ');
  assert.equal(normalizeUniformText('a—b'), 'a-b');
  assert.deepEqual([...encodeUniformIso88598('ח״פ')], [0xe7, 0x22, 0xf4]);
});

test('a character ISO-8859-8 cannot hold blocks the download and is named', () => {
  const input: UniformFixtureInput = {
    ...UNIFORM_FIXTURE,
    business: { ...UNIFORM_FIXTURE.business, name: 'Café GmbH 😀' },
  };
  const out = writeUniformFiles(input, OPTIONS);
  assert.equal(out.canDownload, false);
  assert.ok(out.problems.some(problem => /Business name .*ISO-8859-8/.test(problem)), out.problems.join(' | '));
});

test('a gershayim in the business name is substituted and reported as a note, not a problem', () => {
  const input: UniformFixtureInput = {
    ...UNIFORM_FIXTURE,
    business: { ...UNIFORM_FIXTURE.business, name: 'עמותת צעד״ קדימה' },
  };
  const out = writeUniformFiles(input, OPTIONS);
  assert.equal(out.canDownload, true, 'substituted characters do not block');
  assert.ok(out.notes.some(note => /substitution list/.test(note)), out.notes.join(' | '));
  const a000 = out.iniText.split('\r\n')[0];
  assert.ok(sliceField(a000, UNIFORM_A000, 'businessName').includes('"'), 'gershayim written as a quote');
});

test('refusals: overflowing text is reported, never truncated', () => {
  const input: UniformFixtureInput = {
    ...UNIFORM_FIXTURE,
    accounts: [{
      ...UNIFORM_FIXTURE.accounts[0],
      accountName: 'A very long account name that does not fit into fifty characters at all, really',
    }],
  };
  const out = writeUniformFiles(input, OPTIONS);
  assert.equal(out.canDownload, false);
  assert.ok(out.problems.some(problem => /Account name .*50/.test(problem)), out.problems.join(' | '));
  // the record is still exactly 376 wide — the field is spaces, not a cut-down value
  const b110 = bkmvLines(out.bkmvdataText).find(line => line.startsWith('B110'))!;
  assert.equal(b110.length, UNIFORM_B110.width);
  assert.equal(sliceField(b110, UNIFORM_B110, 'accountName'), ' '.repeat(50));
});

test('refusals: an amount that does not fit and an unbalanced journal both block', () => {
  const tooBig: UniformFixtureInput = {
    ...UNIFORM_FIXTURE,
    journalEntries: [
      ...UNIFORM_FIXTURE.journalEntries,
      { ...UNIFORM_FIXTURE.journalEntries[0], amountCents: 100_000_000_000_000 },
    ],
  };
  const big = writeUniformFiles(tooBig, OPTIONS);
  assert.equal(big.canDownload, false);
  assert.ok(big.problems.some(problem => /does not fit the 15-character amount field/.test(problem)), big.problems.join(' | '));

  const unbalanced: UniformFixtureInput = {
    ...UNIFORM_FIXTURE,
    journalEntries: [
      ...UNIFORM_FIXTURE.journalEntries,
      { ...UNIFORM_FIXTURE.journalEntries[0], transactionNo: '2', amountCents: 5 },
    ],
  };
  const out = writeUniformFiles(unbalanced, OPTIONS);
  assert.equal(out.canDownload, false);
  assert.ok(out.problems.some(problem => /do not balance/.test(problem)), out.problems.join(' | '));
});

test('refusals: a missing tax ID and an impossible date are named, not filled in', () => {
  const noTaxId = writeUniformFiles({ ...UNIFORM_FIXTURE, business: { ...UNIFORM_FIXTURE.business, taxId: '' } }, OPTIONS);
  assert.equal(noTaxId.canDownload, false);
  assert.ok(noTaxId.problems.some(problem => /Business tax ID .*missing/.test(problem)), noTaxId.problems.join(' | '));

  const badDate = writeUniformFiles({
    ...UNIFORM_FIXTURE,
    documents: [{ ...UNIFORM_FIXTURE.documents[0], issueDate: '20250230' }],
  }, OPTIONS);
  assert.equal(badDate.canDownload, false);
  assert.ok(badDate.problems.some(problem => /not a real calendar day/.test(problem)), badDate.problems.join(' | '));
});

test('the writer refuses a journal account with no B110 record', () => {
  const input: UniformFixtureInput = {
    ...UNIFORM_FIXTURE,
    journalEntries: [
      ...UNIFORM_FIXTURE.journalEntries,
      // a balanced pair on an account the chart does not carry: only the missing B110 fires
      { ...UNIFORM_FIXTURE.journalEntries[0], transactionNo: '2', accountKey: '9999', amountCents: 100 },
      { ...UNIFORM_FIXTURE.journalEntries[1], transactionNo: '2', accountKey: '9999', amountCents: 100, debitCredit: '2' as const },
    ],
  };
  const out = writeUniformFiles(input, OPTIONS);
  assert.equal(out.canDownload, false);
  assert.ok(out.problems.some(problem => /no B110 account record/.test(problem)), out.problems.join(' | '));
  assert.equal(out.problems.some(problem => /do not balance/.test(problem)), false, 'the pair itself balances');
});

test('record layouts used by the writer stay pinned to the spec widths', () => {
  assert.equal(UNIFORM_A100.width, 95);
  assert.equal(UNIFORM_B100.width, 317);
  assert.equal(UNIFORM_B110.width, 376);
  assert.equal(UNIFORM_C100.width, 445);
  assert.equal(UNIFORM_D110.width, 339);
  assert.equal(UNIFORM_D120.width, 222);
  assert.equal(UNIFORM_M100.width, 294);
  assert.equal(UNIFORM_Z900.width, 110);
});
