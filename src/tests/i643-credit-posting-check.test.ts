/**
 * #643: the month-end posting check covers credit notes and vendor credits, by hand.
 * A credit note of 120.00 credits Accounts Receivable 120.00 (DR Sales returns 120.00); a vendor credit of 80.00 debits
 * Accounts Payable 80.00 (CR Expense 80.00) — creditPosting.ts. Per kind: one correct, one missing, one doubled, one
 * posted at the wrong amount (100.00 instead of 120.00 / 60.00 instead of 80.00), one void with an entry left.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findPostingMismatches } from '../lib/postingCheck';
import { buildCloseChecklist } from '../lib/closeChecklist';
import type { CreditNote, Transaction, VendorCredit } from '../types';

const cnEntry = (id: string, cn: string, cents: number) => ({ id, workspaceId: 'w', date: '2026-03-10', status: 'posted', description: 'CN',
  metadata: { creditNoteId: cn, type: 'credit-note-issuance' },
  lines: [{ accountId: 'returns', amountCents: cents }, { accountId: 'ar', amountCents: -cents }] }) as unknown as Transaction;
const vcEntry = (id: string, vc: string, cents: number) => ({ id, workspaceId: 'w', date: '2026-03-10', status: 'posted', description: 'VC',
  metadata: { vendorCreditId: vc, type: 'vendor-credit-issuance' },
  lines: [{ accountId: 'ap', amountCents: cents }, { accountId: 'expense', amountCents: -cents }] }) as unknown as Transaction;
const cn = (id: string, status = 'open', amountCents = 12000) => ({ id, number: id, customerName: 'Acme', status, amountCents, date: '2026-03-10' }) as unknown as CreditNote;
const vc = (id: string, status = 'open', amountCents = 8000) => ({ id, number: id, vendorName: 'Supply Co', status, amountCents, date: '2026-03-10' }) as unknown as VendorCredit;

const transactions = [
  cnEntry('t1', 'cn-ok', 12000), cnEntry('t2', 'cn-dup', 12000), cnEntry('t3', 'cn-dup', 12000), cnEntry('t4', 'cn-amt', 10000), cnEntry('t5', 'cn-void', 12000),
  vcEntry('t6', 'vc-ok', 8000), vcEntry('t7', 'vc-dup', 8000), vcEntry('t8', 'vc-dup', 8000), vcEntry('t9', 'vc-amt', 6000), vcEntry('t10', 'vc-void', 8000),
];
const creditNotes = [cn('cn-ok'), cn('cn-missing'), cn('cn-dup'), cn('cn-amt'), cn('cn-void', 'void')];
const vendorCredits = [vc('vc-ok'), vc('vc-missing'), vc('vc-dup'), vc('vc-amt'), vc('vc-void', 'void')];

test('#643: credit notes and vendor credits are checked against the ledger like invoices and bills', () => {
  const found = findPostingMismatches({ invoices: [], bills: [], creditNotes, vendorCredits, transactions });
  const by = Object.fromEntries(found.map(m => [m.id, m]));
  assert.equal(by['cn-ok'], undefined);
  assert.equal(by['vc-ok'], undefined);
  assert.deepEqual([by['cn-missing'].issue, by['cn-missing'].kind, by['cn-missing'].expectedCents, by['cn-missing'].postedCents], ['missing', 'credit-note', 12000, 0]);
  assert.deepEqual([by['cn-dup'].issue, by['cn-dup'].postedCents], ['duplicate', 24000]);
  assert.deepEqual([by['cn-amt'].issue, by['cn-amt'].expectedCents, by['cn-amt'].postedCents], ['amount', 12000, 10000]);
  assert.deepEqual([by['cn-void'].issue, by['cn-void'].expectedCents], ['orphan', 0]);
  assert.deepEqual([by['vc-missing'].issue, by['vc-missing'].kind, by['vc-missing'].expectedCents], ['missing', 'vendor-credit', 8000]);
  assert.deepEqual([by['vc-dup'].issue, by['vc-dup'].postedCents], ['duplicate', 16000]);
  assert.deepEqual([by['vc-amt'].issue, by['vc-amt'].expectedCents, by['vc-amt'].postedCents], ['amount', 8000, 6000]);
  assert.equal(by['vc-void'].issue, 'orphan');
  assert.equal(found.length, 8);
});

test('#643: a reversed credit-note entry no longer counts', () => {
  const reversal = { id: 'r1', workspaceId: 'w', date: '2026-03-11', status: 'posted', metadata: { isReversal: true, reversesTxId: 't1' }, lines: [] } as unknown as Transaction;
  const found = findPostingMismatches({ invoices: [], bills: [], creditNotes: [cn('cn-ok')], transactions: [cnEntry('t1', 'cn-ok', 12000), reversal] });
  assert.equal(found[0]?.issue, 'missing');
});

test('#643: the month-end checklist counts them and says so', () => {
  const items = buildCloseChecklist({ month: '2026-03', transactions, bankLines: [], invoices: [], bills: [], creditNotes, vendorCredits });
  const postings = items.find(i => i.id === 'postings')!;
  assert.equal(postings.count, 8);
  assert.equal(postings.title, 'Invoices, bills and credits match the ledger');
  const clean = buildCloseChecklist({ month: '2026-03', transactions: [cnEntry('t1', 'cn-ok', 12000)], bankLines: [], invoices: [], bills: [], creditNotes: [cn('cn-ok')] }).find(i => i.id === 'postings')!;
  assert.equal(clean.detail, 'Every invoice, bill, credit note and vendor credit is in the ledger once, with the right amount.');
});
