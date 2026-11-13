/**
 * EU-C4: a snapped receipt is saved as a draft bill that points at its photo, and posts nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReceiptAmount, readerCentsToMinor, receiptAmountText, receiptDraftBill, receiptDraftProblem, receiptFileName } from '../lib/snapReceipt';

const input = { vendorId: 'v1', vendorName: 'Corner Hardware', amountCents: 4_250, date: '2026-11-12', currency: 'USD', receiptDocId: 'doc-9' };

test('EU-C4: the draft bill a snapped receipt is saved as', () => {
  assert.deepEqual(receiptDraftBill(input), {
    vendorId: 'v1',
    vendorName: 'Corner Hardware',
    amountCents: 4_250,
    amountPaidCents: 0,
    date: '2026-11-12',
    issueDate: '2026-11-12',
    dueDate: '2026-11-12',
    currency: 'USD',
    status: 'draft',
    posted: false,
    tags: ['Receipt'],
    splits: [{ amountCents: 4_250, accountId: '', description: 'Receipt' }],
    metadata: { source: 'phone-receipt', receiptDocId: 'doc-9' },
  });
});

test('EU-C4: a receipt needs a vendor, a date and its photo; the amount may be 0', () => {
  assert.equal(receiptDraftProblem({ ...input, vendorId: '' }), 'Choose who the receipt is from.');
  assert.equal(receiptDraftProblem({ ...input, date: '12/11/2026' }), 'Choose the receipt date.');
  assert.equal(receiptDraftProblem({ ...input, receiptDocId: '' }), 'The photo was not saved.');
  assert.equal(receiptDraftProblem({ ...input, amountCents: -1 }), 'The amount must be zero or more.');
  assert.equal(receiptDraftProblem({ ...input, amountCents: 0 }), null);
  assert.throws(() => receiptDraftBill({ ...input, vendorId: '' }), /Choose who/);
});

test('EU-C4: typed amounts in either decimal mark', () => {
  assert.equal(parseReceiptAmount('42.50'), 4_250);
  assert.equal(parseReceiptAmount('42,5'), 4_250);
  assert.equal(parseReceiptAmount('7'), 700);
  assert.equal(parseReceiptAmount(''), 0);
  assert.equal(parseReceiptAmount('12.345'), null);
  assert.equal(parseReceiptAmount('abc'), null);
});

test('EU-C4: amounts use the currency\'s own decimals', () => {
  assert.equal(parseReceiptAmount('1000', 'JPY'), 1_000, '¥1,000 is 1,000 minor units, not 100,000');
  assert.equal(parseReceiptAmount('10.5', 'JPY'), null);
  assert.equal(parseReceiptAmount('1.250', 'KWD'), 1_250);
  assert.equal(parseReceiptAmount('1.25', 'KWD'), 1_250);
  assert.equal(receiptAmountText(1_000, 'JPY'), '1000');
  assert.equal(receiptAmountText(1_250, 'KWD'), '1.250');
  assert.equal(receiptAmountText(4_250, 'USD'), '42.50');
});

test('EU-C4: the reader\'s two-decimal cents become the currency\'s minor units', () => {
  assert.equal(readerCentsToMinor(125, 'KWD'), 1_250, '1.25 KWD');
  assert.equal(readerCentsToMinor(100_000, 'JPY'), 1_000, '¥1,000');
  assert.equal(readerCentsToMinor(-4_250, 'USD'), 4_250);
  const dialog = readFileSync('src/components/layout/SnapReceiptDialog.tsx', 'utf8');
  assert.match(dialog, /readerCentsToMinor\(parsed\.totalAmountCents, currency\)/);
});

test('EU-C4: the dialog drops the receipt when the person or workspace changes', () => {
  const dialog = readFileSync('src/components/layout/SnapReceiptDialog.tsx', 'utf8');
  assert.match(dialog, /openedIn\.current === scope\) return;[\s\S]{0,120}onClose\(\)/);
  assert.match(dialog, /useAuthStore\(workspaceActor\)/, 'the sample company can save, like other bills');
  assert.match(dialog, /RelatedRecordEditButton target=\{\{ kind: 'vendors', id: vendorId \}\}/);
});

test('EU-C4: the photo is filed under the receipt date', () => {
  assert.equal(receiptFileName('2026-11-12', 'IMG_0042.JPG'), 'Receipt 2026-11-12.jpg');
  assert.equal(receiptFileName('2026-11-12', 'blob'), 'Receipt 2026-11-12.jpg');
});

test('EU-C4: a draft bill posts no ledger line', () => {
  const posting = readFileSync('src/services/ledgerPost/billPosting.ts', 'utf8');
  assert.match(posting, /status === 'draft'[^\n]*\n[^\n]*\n[\s\S]{0,200}return;/);
});

test('EU-C4: the + menu offers "Snap a receipt", which opens a camera input', () => {
  const menu = readFileSync('src/components/layout/QuickCreateMenu.tsx', 'utf8');
  assert.match(menu, /Snap a receipt/);
  const dialog = readFileSync('src/components/layout/SnapReceiptDialog.tsx', 'utf8');
  assert.match(dialog, /accept="image\/\*" capture="environment"/);
  assert.match(dialog, /addEntity\('bills', receiptDraftBill\(/);
  assert.match(dialog, /linkedId: billRef\.id/, 'the document stores the bill id, not the reference');
});
