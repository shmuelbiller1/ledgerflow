/**
 * E-33: the books → Uniform Structure assembler. Hand-worked from small book records: only
 * postable in-year entries become B100 lines, issued documents map to the spec's Appendix 1
 * types (305/500/330/410), applied posted payments become D120 rows, drafts and unapplied
 * cash are counted and reported instead of written, and the assembled input feeds the writer
 * to a downloadable file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Bill, ChartAccount, CreditNote, Invoice, Payment, Transaction, VendorCredit } from '../types';
import { UNIFORM_D120 } from '../lib/tax/uniformStructure';
import { buildUniformBooksInput, uniformDate8, type UniformBooksSource } from '../lib/tax/uniformBooksInput';
import { writeUniformFiles, type UniformWriteOptions } from '../lib/tax/uniformStructureWriter';

const OPTIONS: UniformWriteOptions = {
  processDate: '20260115',
  processTime: '0930',
  primaryIdentifier: '42',
  baseCurrency: 'ILS',
  software: { name: 'Ledgerflow', version: 'draft', vendorName: 'Ledgerflow' },
};

function account(id: string, code: string, name: string): ChartAccount {
  return { id, code, name, type: 'asset', category: 'current', archived: false, openingBalanceCents: 0 } as ChartAccount;
}

function tx(id: string, date: string, lines: Transaction['lines'], status = 'posted'): Transaction {
  return {
    id,
    workspaceId: 'ws',
    date,
    type: 'journal',
    totalAmountCents: 0,
    currency: 'USD',
    lines,
    status,
  } as Transaction;
}

function line(id: string, accountId: string, amountCents: number): Transaction['lines'][number] {
  return { id, accountId, amountCents } as Transaction['lines'][number];
}

function invoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: 'inv1',
    number: '1001',
    customerName: 'Acme',
    amountCents: 1180000,
    taxAmountCents: 180000,
    status: 'sent',
    date: '2025-03-01',
    ...overrides,
  } as Invoice;
}

function source(overrides: Partial<UniformBooksSource> = {}): UniformBooksSource {
  return {
    business: { name: 'Test Co', taxId: '512345678', addressLine: 'Herzl 12' },
    taxYear: '2025',
    baseCurrency: 'ILS',
    accounts: [account('a1', '1000', 'Cash'), account('a2', '4000', 'Sales'), account('a3', '2100', 'VAT')],
    transactions: [
      tx('t1', '2025-03-01', [
        line('l1', 'a1', 1180000),
        line('l2', 'a2', -1000000),
        line('l3', 'a3', -180000),
      ]),
    ],
    invoices: [invoice({})],
    bills: [],
    creditNotes: [],
    vendorCredits: [],
    payments: [
      {
        id: 'p1',
        direction: 'received',
        method: 'bank_transfer',
        amountCents: 1180000,
        status: 'posted',
        allocations: [{ documentId: 'inv1', documentType: 'invoice', amountCents: 1180000 }],
        unappliedCents: 0,
        date: '2025-03-05',
      } as unknown as Payment,
    ],
    inventoryItemCount: 0,
    ...overrides,
  };
}

test('uniformDate8 normalises only real ISO dates', () => {
  assert.equal(uniformDate8('2025-03-05'), '20250305');
  assert.equal(uniformDate8('2025-03-05T10:30:00.000Z'), '20250305');
  assert.equal(uniformDate8('05/03/2025'), '');
  assert.equal(uniformDate8(undefined), '');
});

test('assembled books feed the writer to a downloadable file with the expected records', () => {
  const result = buildUniformBooksInput(source());
  const out = writeUniformFiles(result.input, { ...OPTIONS, baseCurrency: result.baseCurrency });

  assert.deepEqual(out.problems, []);
  assert.equal(out.canDownload, true);

  const counts = Object.fromEntries(out.recordCounts.map(entry => [entry.code, entry.count]));
  assert.equal(counts.B100, 3, 'three journal lines');
  assert.equal(counts.B110, 3, 'three chart accounts');
  assert.equal(counts.C100, 1, 'one invoice as document 305');
  assert.equal(counts.D120, 1, 'the applied payment');
  assert.equal(out.journalDebitsCents, 1180000);
  assert.equal(out.journalCreditsCents, 1180000);
  assert.deepEqual(out.documentTypeTotals, [
    { documentType: '305', count: 1, totalInclVatCents: 1180000, vatAmountCents: 180000 },
  ]);
  // the payment wrote as bank transfer (method 4) under the invoice
  const d120 = out.bkmvdataText.split('\r\n').find(row => row.startsWith('D120'));
  assert.ok(d120);
  let methodOffset = 0; // the fields array includes recordCode itself
  for (const field of UNIFORM_D120.fields) {
    if (field.key === 'paymentMethod') break;
    methodOffset += field.width;
  }
  assert.equal(d120.slice(methodOffset, methodOffset + 1), '4');
});

test('draft and void documents are skipped and counted, not written', () => {
  const books = source({
    invoices: [
      invoice({ id: 'inv1', number: '1001', status: 'draft' }),
      invoice({ id: 'inv2', number: '1002', status: 'void' }),
      invoice({ id: 'inv3', number: '1003', status: 'sent' }),
    ],
    payments: [],
  });
  const result = buildUniformBooksInput(books);
  assert.equal(result.skipped.documents, 2);
  assert.equal(result.input.documents.length, 1);
  assert.equal(result.input.documents[0].documentNo, '1003');
  assert.ok(result.notes.some(note => /draft or void/.test(note)), result.notes.join(' | '));
});

test('non-postable and out-of-year journal entries never reach B100', () => {
  const books = source({
    transactions: [
      tx('t1', '2025-03-01', [line('l1', 'a1', 100)]),
      tx('t2', '2025-03-02', [line('l2', 'a2', -100)], 'draft'),
      tx('t3', '2026-01-15', [line('l3', 'a1', 500)]),
      tx('t4', '2024-12-31', [line('l4', 'a1', 700)]),
    ],
    invoices: [],
    payments: [],
  });
  const result = buildUniformBooksInput(books);
  assert.equal(result.input.journalEntries.length, 1, 'only the postable 2025 entry');
  assert.equal(result.input.journalEntries[0].transactionNo, '1');
});

test('a posted payment with no exported document is counted and reported, never written', () => {
  const books = source({
    invoices: [],
    payments: [
      {
        id: 'p1',
        direction: 'received',
        method: 'cash',
        amountCents: 5000,
        status: 'posted',
        allocations: [{ documentId: 'missing', documentType: 'invoice', amountCents: 5000 }],
        unappliedCents: 5000,
        date: '2025-03-05',
      } as unknown as Payment,
      {
        id: 'p2',
        direction: 'received',
        method: 'check',
        amountCents: 100,
        status: 'draft',
        allocations: [],
        unappliedCents: 100,
        date: '2025-03-06',
      } as unknown as Payment,
    ],
  });
  const result = buildUniformBooksInput(books);
  assert.equal(result.skipped.paymentsUnapplied, 1, 'the posted one; drafts are ignored entirely');
  assert.equal(result.input.documents.length, 0);
  assert.ok(result.notes.some(note => /not applied to an exported document/.test(note)), result.notes.join(' | '));
});

test('documents map to the spec types: bill 500, credit note 330, vendor credit 410', () => {
  const books = source({
    invoices: [],
    transactions: [],
    bills: [
      {
        id: 'b1',
        number: 'B-9',
        vendorName: 'Supply Co',
        amountCents: 236000,
        taxAmountCents: 36000,
        status: 'approved',
        date: '2025-04-01',
        splits: [{ id: 's1', amountCents: 200000, accountId: 'a1', taxRate: 18 }],
      } as unknown as Bill,
    ],
    creditNotes: [
      { id: 'c1', number: 'CN-1', customerName: 'Acme', amountCents: -118000, taxAmountCents: -18000, status: 'open', date: '2025-05-01' } as CreditNote,
    ],
    vendorCredits: [
      { id: 'v1', number: 'VC-1', vendorName: 'Supply Co', amountCents: -59000, status: 'open', date: '2025-06-01' } as VendorCredit,
    ],
    payments: [],
  });
  const result = buildUniformBooksInput(books);
  const byType = Object.fromEntries(result.input.documents.map(doc => [doc.documentType, doc]));
  assert.deepEqual(Object.keys(byType).sort(), ['330', '410', '500']);
  assert.equal(byType['500'].documentNo, 'B-9');
  assert.equal(byType['500'].customerName, 'Supply Co');
  assert.equal(byType['500'].amountInclVatCents, 236000);
  assert.equal(byType['500'].lines.length, 1, 'one split → one D110 line');
  assert.equal(byType['330'].lines.length, 1, 'line-less credit note → one synthetic line');
  assert.equal(byType['410'].lines[0].quantity, 1);
});

test('inventory never gets invented: M100 is empty and the gap is a note', () => {
  const result = buildUniformBooksInput(source({ inventoryItemCount: 12 }));
  assert.deepEqual(result.input.inventory, []);
  assert.ok(result.notes.some(note => /M100 stock records are not written/.test(note)), result.notes.join(' | '));
  const out = writeUniformFiles(result.input, OPTIONS);
  assert.equal(out.canDownload, true, 'the M100 gap is a note, not a refusal');
  // the screen shows the assembler's notes alongside the writer's, so the gap is visible
  assert.ok([...result.notes, ...out.notes].some(note => /M100/.test(note)));
});

test('a journal account outside the chart is reported and still gets an account record', () => {
  const books = source({
    transactions: [tx('t1', '2025-03-01', [line('l1', 'ghost', 100), line('l2', 'a1', -100)])],
  });
  const result = buildUniformBooksInput(books);
  assert.ok(result.notes.some(note => /not in the chart of accounts/.test(note)), result.notes.join(' | '));
  assert.ok(result.input.accounts.some(entry => entry.accountKey === 'ghost'));
  const out = writeUniformFiles(result.input, { ...OPTIONS, baseCurrency: result.baseCurrency });
  assert.equal(out.canDownload, true, 'the assembler supplied the B110 the journal needs');
});
