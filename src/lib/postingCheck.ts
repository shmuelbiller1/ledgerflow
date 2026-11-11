/**
 * Repost check (CA-03): invoices and bills whose ledger entry doesn't match the document.
 * Each issued invoice/bill should have exactly one active accrual entry (not reversed) whose
 * receivable/payable side equals the document total in the base currency (amount × rate).
 * Anything else is listed with the reason; "Repost" reverses what is there and posts it again
 * from the document (LedgerPostService), which fixes all four cases:
 * - missing: an issued document with no entry (e.g. posting failed);
 * - duplicate: more than one active entry;
 * - orphan: an entry left on a draft/void document;
 * - amount: the entry's amount differs (e.g. foreign-currency entries converted twice, L-105).
 */
import type { Bill, Invoice, Transaction } from '../types';
import { isPostable, lineAmount } from './txFilters';
import { minorUnitRate } from './currencyMinorUnits';

export type PostingIssue = 'missing' | 'duplicate' | 'orphan' | 'amount';

export interface PostingMismatch {
  kind: 'invoice' | 'bill';
  id: string;
  number: string;
  party: string;
  issue: PostingIssue;
  expectedCents: number;
  postedCents: number;
  detail: string;
}

const NOT_POSTED = new Set(['draft', 'void', 'cancelled', 'rejected']);

type Meta = { invoiceId?: string; billId?: string; type?: string; reversesTxId?: string; reversedTransactionId?: string; isReversal?: boolean };
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
export function activeAccruals(transactions: Transaction[], key: 'invoiceId' | 'billId', type: string): Map<string, Transaction[]> {
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

/** The receivable (invoice) or payable (bill) side of an entry, in base currency: its debits for an invoice, its credits for a bill. */
function postedTotal(t: Transaction, kind: 'invoice' | 'bill'): number {
  return (t.lines || []).reduce((sum, l) => {
    const amount = lineAmount(l, t);
    return sum + (kind === 'invoice' ? Math.max(0, amount) : Math.max(0, -amount));
  }, 0);
}

/** What the receivable/payable side of the accrual should be, in base currency. An invoice's
 *  discount is booked on the same side (DR Sales Discounts), so it adds to the invoice's debits.
 *
 *  AF13-001: the rate is the posting path's own rate, not the bare exchange rate. A document keeps
 *  its amounts in the minor units of its own currency (BM-04: whole yen for JPY, fils for KWD) and
 *  its entry is in the books' minor units, so the factor is `minorUnitRate(rate, document, books)`
 *  exactly as `documentMinorRate` in src/services/ledgerPost/postingCore.ts computes it — otherwise a
 *  document in a 0- or 3-decimal currency looked 100x (or 10x) wrong when the ledger was right. */
function expectedTotal(
  kind: 'invoice' | 'bill',
  doc: { amountCents?: number; exchangeRate?: number; discountCents?: number; currency?: string },
  baseCurrency?: string,
): number {
  const rate = minorUnitRate(doc.exchangeRate && doc.exchangeRate > 0 ? doc.exchangeRate : 1, doc.currency || baseCurrency, baseCurrency);
  const total = Math.round((doc.amountCents || 0) * rate);
  return kind === 'invoice' ? total + Math.round((doc.discountCents || 0) * rate) : total;
}

function check(
  kind: 'invoice' | 'bill',
  docs: Array<{ id: string; number?: string; status?: string; amountCents?: number; exchangeRate?: number; discountCents?: number; currency?: string; party?: string }>,
  accruals: Map<string, Transaction[]>,
  baseCurrency?: string,
): PostingMismatch[] {
  const out: PostingMismatch[] = [];
  for (const doc of docs) {
    const entries = accruals.get(doc.id) || [];
    const posted = entries.reduce((s, t) => s + postedTotal(t, kind), 0);
    const expected = NOT_POSTED.has(String(doc.status)) || (doc.amountCents || 0) <= 0 ? 0 : expectedTotal(kind, doc, baseCurrency);
    const base = { kind, id: doc.id, number: doc.number || doc.id, party: doc.party || '', expectedCents: expected, postedCents: posted };
    if (expected > 0 && entries.length === 0) out.push({ ...base, issue: 'missing', detail: 'Not in the ledger' });
    else if (expected === 0 && entries.length > 0) out.push({ ...base, issue: 'orphan', detail: `Still in the ledger although it is ${doc.status}` });
    else if (entries.length > 1) out.push({ ...base, issue: 'duplicate', detail: `In the ledger ${entries.length} times` });
    else if (expected > 0 && posted !== expected) out.push({ ...base, issue: 'amount', detail: 'The ledger amount differs from the document' });
  }
  return out;
}

export function findPostingMismatches(input: {
  invoices: Invoice[];
  bills: Bill[];
  transactions: Transaction[];
  /** The books' currency (a workspace's `currency`); a document without a currency is already in it. */
  baseCurrency?: string;
}): PostingMismatch[] {
  const base = input.baseCurrency || 'USD';
  const invoices = check('invoice', input.invoices.map(i => ({ ...i, party: i.customerName })), activeAccruals(input.transactions, 'invoiceId', 'invoice-accrual'), base);
  const bills = check('bill', input.bills.map(b => ({ ...b, party: b.vendorName })), activeAccruals(input.transactions, 'billId', 'bill-accrual'), base);
  return [...invoices, ...bills];
}
