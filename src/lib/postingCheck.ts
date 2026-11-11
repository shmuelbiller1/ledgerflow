/**
 * Repost check (CA-03): invoices, bills, credit notes and vendor credits (#643) whose ledger entry doesn't match the document.
 * Each issued document should have exactly one active entry (not reversed) whose receivable/payable side
 * equals the document total in the base currency (amount × rate): an invoice's debits and a bill's credits;
 * a credit note credits Accounts Receivable and a vendor credit debits Accounts Payable by their amount
 * (src/services/ledgerPost/creditPosting.ts), so those are its credits and its debits.
 * Anything else is listed with the reason; "Repost" reverses what is there and posts it again
 * from the document (LedgerPostService), which fixes all four cases:
 * - missing: an issued document with no entry (e.g. posting failed);
 * - duplicate: more than one active entry;
 * - orphan: an entry left on a draft/void document;
 * - amount: the entry's amount differs (e.g. foreign-currency entries converted twice, L-105).
 */
import type { Bill, CreditNote, Invoice, Transaction, VendorCredit } from '../types';
import { isPostable, lineAmount } from './txFilters';

export type PostingIssue = 'missing' | 'duplicate' | 'orphan' | 'amount';

export interface PostingMismatch {
  kind: DocKind;
  id: string;
  number: string;
  party: string;
  issue: PostingIssue;
  expectedCents: number;
  postedCents: number;
  detail: string;
}

export type DocKind = 'invoice' | 'bill' | 'credit-note' | 'vendor-credit';

const NOT_POSTED = new Set(['draft', 'void', 'cancelled', 'rejected']);

type Meta = { invoiceId?: string; billId?: string; creditNoteId?: string; vendorCreditId?: string; type?: string; reversesTxId?: string; reversedTransactionId?: string; isReversal?: boolean };
const meta = (t: Transaction) => (t.metadata || {}) as Meta;

/** Ids of the entries that a reversal cancels (or that are marked reversed). */
export function reversedTransactionIds(transactions: Transaction[]): Set<string> {
  const reversed = new Set<string>();
  for (const t of transactions) {
    const m = meta(t);
    if (m.isReversal || m.reversesTxId) reversed.add(String(m.reversesTxId || m.reversedTransactionId || ''));
    if (t.reversalEventId) reversed.add(t.id);
  }
  return reversed;
}

/** Accrual entries per document that are still in effect (not reversed). */
export function activeAccruals(transactions: Transaction[], key: 'invoiceId' | 'billId' | 'creditNoteId' | 'vendorCreditId', type: string): Map<string, Transaction[]> {
  const reversed = reversedTransactionIds(transactions);
  const byDoc = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const m = meta(t);
    if (m.type !== type || !m[key] || !isPostable(t) || reversed.has(t.id)) continue;
    const list = byDoc.get(String(m[key])) || [];
    list.push(t);
    byDoc.set(String(m[key]), list);
  }
  return byDoc;
}

/** Whether the document's receivable/payable side is the entry's debits (invoice, vendor credit) or its credits (bill, credit note). */
const DEBIT_SIDE = new Set<DocKind>(['invoice', 'vendor-credit']);

/** The receivable/payable side of an entry, in base currency. */
function postedTotal(t: Transaction, kind: DocKind): number {
  return (t.lines || []).reduce((sum, l) => {
    const amount = lineAmount(l, t);
    return sum + (DEBIT_SIDE.has(kind) ? Math.max(0, amount) : Math.max(0, -amount));
  }, 0);
}

/** What the receivable/payable side of the accrual should be, in base currency. An invoice's
 *  discount is booked on the same side (DR Sales Discounts), so it adds to the invoice's debits. */
function expectedTotal(kind: DocKind, doc: { amountCents?: number; exchangeRate?: number; discountCents?: number }): number {
  const rate = doc.exchangeRate && doc.exchangeRate > 0 ? doc.exchangeRate : 1;
  const total = Math.round((doc.amountCents || 0) * rate);
  return kind === 'invoice' ? total + Math.round((doc.discountCents || 0) * rate) : total;
}

function check(
  kind: DocKind,
  docs: Array<{ id: string; number?: string; status?: string; amountCents?: number; exchangeRate?: number; discountCents?: number; party?: string }>,
  accruals: Map<string, Transaction[]>,
): PostingMismatch[] {
  const out: PostingMismatch[] = [];
  for (const doc of docs) {
    const entries = accruals.get(doc.id) || [];
    const posted = entries.reduce((s, t) => s + postedTotal(t, kind), 0);
    const expected = NOT_POSTED.has(String(doc.status)) || (doc.amountCents || 0) <= 0 ? 0 : expectedTotal(kind, doc);
    const base = { kind, id: doc.id, number: doc.number || doc.id, party: doc.party || '', expectedCents: expected, postedCents: posted };
    if (expected > 0 && entries.length === 0) out.push({ ...base, issue: 'missing', detail: 'Not in the ledger' });
    else if (expected === 0 && entries.length > 0) out.push({ ...base, issue: 'orphan', detail: `Still in the ledger although it is ${doc.status}` });
    else if (entries.length > 1) out.push({ ...base, issue: 'duplicate', detail: `In the ledger ${entries.length} times` });
    else if (expected > 0 && posted !== expected) out.push({ ...base, issue: 'amount', detail: 'The ledger amount differs from the document' });
  }
  return out;
}

export function findPostingMismatches(input: { invoices: Invoice[]; bills: Bill[]; creditNotes?: CreditNote[]; vendorCredits?: VendorCredit[]; transactions: Transaction[] }): PostingMismatch[] {
  const invoices = check('invoice', input.invoices.map(i => ({ ...i, party: i.customerName })), activeAccruals(input.transactions, 'invoiceId', 'invoice-accrual'));
  const bills = check('bill', input.bills.map(b => ({ ...b, party: b.vendorName })), activeAccruals(input.transactions, 'billId', 'bill-accrual'));
  // #643: an issued credit note or vendor credit is checked the same way (a draft or void one posts nothing)
  const creditNotes = check('credit-note', (input.creditNotes || []).map(c => ({ ...c, party: c.customerName })), activeAccruals(input.transactions, 'creditNoteId', 'credit-note-issuance'));
  const vendorCredits = check('vendor-credit', (input.vendorCredits || []).map(v => ({ ...v, party: v.vendorName })), activeAccruals(input.transactions, 'vendorCreditId', 'vendor-credit-issuance'));
  return [...invoices, ...bills, ...creditNotes, ...vendorCredits];
}
