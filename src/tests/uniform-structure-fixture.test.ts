/**
 * E-54: the Uniform Structure research fixture. These tests pin the transcribed spec layouts
 * (field numbers, widths, record totals) and the sample fixture, so E-33's writer builds on
 * verified widths rather than re-deriving them. Sources: docs/UNIFORM_STRUCTURE_RESEARCH.md.
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
  UNIFORM_SYSTEM_CONSTANT,
  UNIFORM_DOCUMENT_TYPES,
  UNIFORM_PAYMENT_METHODS,
  UNIFORM_FIXTURE,
} from '../lib/tax/uniformStructure';

test('every record layout width equals the sum of its field widths', () => {
  for (const layout of UNIFORM_RECORD_LAYOUTS) {
    const sum = layout.fields.reduce((acc, field) => acc + field.width, 0);
    assert.equal(sum, layout.width, `${layout.code}: fields sum to ${sum}, layout says ${layout.width}`);
  }
});

test('record widths match the spec tables (A000 466, A100 95, B100 317, B110 376, C100 445, D110 339, D120 222, M100 294, Z900 110)', () => {
  assert.equal(UNIFORM_A000.width, 466);
  assert.equal(UNIFORM_A100.width, 95);
  assert.equal(UNIFORM_B100.width, 317);
  assert.equal(UNIFORM_B110.width, 376);
  assert.equal(UNIFORM_C100.width, 445);
  assert.equal(UNIFORM_D110.width, 339);
  assert.equal(UNIFORM_D120.width, 222);
  assert.equal(UNIFORM_M100.width, 294);
  assert.equal(UNIFORM_Z900.width, 110);
});

test('field numbers are strictly increasing within each record and start at the spec base', () => {
  const bases: Record<string, number> = {
    A000: 1000, A100: 1100, B100: 1350, B110: 1400, C100: 1200, D110: 1250, D120: 1300, M100: 1450, Z900: 1150,
  };
  for (const layout of UNIFORM_RECORD_LAYOUTS) {
    assert.equal(layout.fields[0].no, bases[layout.code], `${layout.code} first field`);
    for (let i = 1; i < layout.fields.length; i++) {
      assert.ok(layout.fields[i].no > layout.fields[i - 1].no, `${layout.code} field ${layout.fields[i].no} out of order`);
    }
  }
});

test('key fields sit at the spec positions', () => {
  const find = (layout: typeof UNIFORM_C100, key: string) => layout.fields.find((field) => field.key === key);
  // C100: document type 1203 (3), document number 1204 (20), total incl. VAT 1223 (15)
  assert.equal(find(UNIFORM_C100, 'documentType')?.no, 1203);
  assert.equal(find(UNIFORM_C100, 'documentNo')?.no, 1204);
  assert.equal(find(UNIFORM_C100, 'amountInclVat')?.no, 1223);
  // B100: debit/credit indicator 1366 (1), amount 1368 (15)
  assert.equal(find(UNIFORM_B100, 'debitCreditIndicator')?.no, 1366);
  assert.equal(find(UNIFORM_B100, 'amountLocal')?.no, 1368);
  // D120: payment method 1306 (1)
  assert.equal(find(UNIFORM_D120, 'paymentMethod')?.no, 1306);
  // A000: total records 1002 (15) must match Z900 total 1155 (15)
  assert.equal(find(UNIFORM_A000, 'totalRecordsInBkmvdata')?.no, 1002);
  assert.equal(find(UNIFORM_Z900, 'totalRecordsInFile')?.no, 1155);
});

test('the system constant is the spec version marker', () => {
  assert.equal(UNIFORM_SYSTEM_CONSTANT, '&OF1.31&');
});

test('document types and payment methods cover the spec appendices', () => {
  assert.equal(UNIFORM_DOCUMENT_TYPES['305'], 'Tax Invoice');
  assert.equal(UNIFORM_DOCUMENT_TYPES['320'], 'Tax Invoice / Receipt');
  assert.equal(UNIFORM_DOCUMENT_TYPES['330'], 'Credit Tax Invoice');
  assert.equal(Object.keys(UNIFORM_DOCUMENT_TYPES).length, 17);
  assert.equal(UNIFORM_PAYMENT_METHODS['1'], 'Cash');
  assert.equal(UNIFORM_PAYMENT_METHODS['3'], 'Credit card');
  assert.equal(Object.keys(UNIFORM_PAYMENT_METHODS).length, 9);
});

test('the sample fixture covers every record type and is internally consistent', () => {
  const fixture = UNIFORM_FIXTURE;
  assert.match(fixture.business.taxId, /^\d{9}$/);
  assert.equal(fixture.business.taxYear, '2025');
  assert.ok(fixture.accounts.length >= 3);
  assert.ok(fixture.journalEntries.length >= 2);
  assert.ok(fixture.documents.length >= 1);
  assert.ok(fixture.inventory.length >= 1);
  // journal lines balance: debits equal credits
  const debits = fixture.journalEntries.filter((e) => e.debitCredit === '1').reduce((s, e) => s + e.amountCents, 0);
  const credits = fixture.journalEntries.filter((e) => e.debitCredit === '2').reduce((s, e) => s + e.amountCents, 0);
  assert.equal(debits, credits);
  // the sample document's amounts add up: excl-VAT + VAT = incl-VAT
  const doc = fixture.documents[0];
  assert.equal(
    (doc.amountAfterDiscountExclVatCents ?? 0) + (doc.vatAmountCents ?? 0),
    doc.amountInclVatCents,
  );
  // every journal account key exists in the account list
  const keys = new Set(fixture.accounts.map((a) => a.accountKey));
  for (const entry of fixture.journalEntries) assert.ok(keys.has(entry.accountKey), `unknown account ${entry.accountKey}`);
  // the document type is a spec code
  assert.ok(doc.documentType in UNIFORM_DOCUMENT_TYPES);
});
