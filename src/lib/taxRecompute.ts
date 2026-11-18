/**
 * Tax recompute (AE-04): invoices and bills whose tax in the ledger differs from the tax the
 * document carries (calculateDocumentTax), e.g. documents posted before the tax-inclusive fix
 * (AE-01). The fix never edits the old entry: an adjusting entry moves the difference between
 * the tax account and the revenue (invoice) or expense (bill) account, so receivables and
 * payables stay as they are. Adjustments count as posted tax, so running it twice changes
 * nothing; re-posting the document later reverses them together with its entry.
 * Amounts are in the base currency (document tax × exchange rate), like the postings.
 */
import type { Bill, ChartAccount, Invoice, Transaction, TransactionLine } from '../types';
import { calculateDocumentTax } from './documentMath';
import { minorUnitRate } from './currencyMinorUnits';
import { isPostable, lineAmount } from './txFilters';
import { activeAccruals, reversedTransactionIds } from './postingCheck';

export const TAX_ADJUSTMENT_TYPE = 'tax-adjustment';

const NOT_POSTED = new Set(['draft', 'void', 'cancelled', 'rejected']);
// the lines the posting templates write (src/kernel/templates/TransactionTemplates.ts)
const TAX_LINE = { invoice: /^Sales tax collected on Invoice /, bill: /^Input tax recoverable on Bill / };
const OFFSET_LINE = { invoice: /^Sales Revenue for Invoice /, bill: /^Expense posting for Bill / };

type Kind = 'invoice' | 'bill';
type Meta = { invoiceId?: string; billId?: string; type?: string; taxAccountId?: string };
const meta = (t: Transaction) => (t.metadata || {}) as Meta;

export interface TaxDifference {
  kind: Kind;
  id: string;
  number: string;
  party: string;
  /** Tax in the ledger now (accrual + earlier adjustments), base currency. */
  postedTaxCents: number;
  /** Tax the document carries, base currency. */
  expectedTaxCents: number;
  /** expected − posted: more tax to book when positive. */
  differenceCents: number;
  /** Accounts the adjustment uses, taken from the document's entry when it has them. */
  taxAccount?: { id: string; name: string };
  offsetAccount?: { id: string; name: string };
}

/** A line's amount on the tax side: credits for an invoice's output tax, debits for a bill's input tax. */
const taxSide = (kind: Kind, amount: number) => (kind === 'invoice' ? -amount : amount);

function largestLine(lines: Array<{ line: TransactionLine; amount: number }>) {
  return lines.reduce<{ line: TransactionLine; amount: number } | undefined>((best, x) => (!best || Math.abs(x.amount) > Math.abs(best.amount) ? x : best), undefined);
}

function check(
  kind: Kind,
  docs: Array<(Invoice | Bill) & { party: string }>,
  transactions: Transaction[],
  baseCurrency?: string,
): TaxDifference[] {
  const key = kind === 'invoice' ? 'invoiceId' : 'billId';
  const accruals = activeAccruals(transactions, key, `${kind}-accrual`);
  const reversed = reversedTransactionIds(transactions);
  const adjustments = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const m = meta(t);
    if (m.type !== TAX_ADJUSTMENT_TYPE || !m[key] || !isPostable(t) || reversed.has(t.id)) continue;
    adjustments.set(String(m[key]), [...(adjustments.get(String(m[key])) || []), t]);
  }

  const out: TaxDifference[] = [];
  for (const doc of docs) {
    if (NOT_POSTED.has(String(doc.status)) || (doc.amountCents || 0) <= 0) continue;
    const entries = accruals.get(doc.id) || [];
    // missing or doubled entries are the repost check's job (postingCheck.ts)
    if (entries.length !== 1) continue;
    const [entry] = entries;
    const lines = (entry.lines || []).map(line => ({ line, amount: lineAmount(line, entry) }));
    const taxLines = lines.filter(x => TAX_LINE[kind].test(x.line.description || ''));
    let posted = taxLines.reduce((s, x) => s + taxSide(kind, x.amount), 0);
    for (const adj of adjustments.get(doc.id) || []) {
      for (const line of adj.lines || []) if (line.accountId === meta(adj).taxAccountId) posted += taxSide(kind, lineAmount(line, adj));
    }
    const rate = doc.exchangeRate && doc.exchangeRate > 0 ? doc.exchangeRate : 1;
    const booksCurrency = baseCurrency || (typeof entry.currency === 'string' && entry.currency ? entry.currency : undefined);
    const factor = doc.currency && booksCurrency ? minorUnitRate(rate, doc.currency, booksCurrency) : rate;
    const expected = Math.round(calculateDocumentTax(doc) * factor);
    if (expected === posted) continue;
    const tax = largestLine(taxLines)?.line;
    const offset = largestLine(lines.filter(x => OFFSET_LINE[kind].test(x.line.description || '')))?.line;
    out.push({
      kind, id: doc.id, number: doc.number || doc.id, party: doc.party,
      postedTaxCents: posted, expectedTaxCents: expected, differenceCents: expected - posted,
      taxAccount: tax ? { id: tax.accountId, name: tax.accountName || '' } : undefined,
      offsetAccount: offset ? { id: offset.accountId, name: offset.accountName || '' } : undefined,
    });
  }
  return out;
}

export function findTaxDifferences(input: { invoices: Invoice[]; bills: Bill[]; transactions: Transaction[]; baseCurrency?: string }): TaxDifference[] {
  return [
    ...check('invoice', input.invoices.map(i => ({ ...i, party: i.customerName || '' })), input.transactions, input.baseCurrency),
    ...check('bill', input.bills.map(b => ({ ...b, party: b.vendorName || '' })), input.transactions, input.baseCurrency),
  ];
}

/**
 * The accounts an adjustment needs when the document's entry has no tax line (its tax was
 * posted as 0): the same rule the postings use (LedgerPostService), mappings first.
 */
export function fallbackTaxAccounts(kind: Kind, accounts: ChartAccount[], mappings: Record<string, string> = {}) {
  const live = accounts.filter(a => !a.isArchived);
  const byKeys = (keys: string[]) => keys.map(k => live.find(a => a.id === mappings[k])).find(Boolean);
  const named = (a: ChartAccount) => (a.name || '').toLowerCase().includes('tax');
  const tax = kind === 'invoice'
    ? byKeys(['tax payable', 'sales tax', 'tax liability', 'tax']) || live.find(a => a.type === 'liability' && (named(a) || a.category === 'Taxes'))
    : byKeys(['tax paid', 'input tax', 'tax asset', 'tax', 'tax expense']) || live.find(a => ['asset', 'expense', 'liability'].includes(a.type) && named(a));
  const offset = kind === 'invoice'
    ? byKeys(['revenue', 'sales', 'income']) || live.find(a => a.type === 'income' || a.category === 'Revenue' || a.category === 'Sales')
    : byKeys(['expense', 'expenses', 'operating expenses']) || live.find(a => a.type === 'expense' && !named(a));
  return { tax, offset };
}

export interface TaxAdjustmentEntry {
  date: string;
  description: string;
  totalAmountCents: number;
  metadata: Record<string, unknown>;
  lines: TransactionLine[];
}

/**
 * The adjusting entry for one difference, dated `date`, or the reason it can't be built.
 * Invoice: more tax = CR tax payable, DR revenue. Bill: more tax = DR input tax, CR expense.
 */
export function taxAdjustmentEntry(
  diff: TaxDifference,
  date: string,
  accounts: { tax?: { id: string; name: string }; offset?: { id: string; name: string } } = {},
): { entry?: TaxAdjustmentEntry; error?: string } {
  const tax = diff.taxAccount || accounts.tax;
  const offset = diff.offsetAccount || accounts.offset;
  if (!tax) return { error: `No ${diff.kind === 'invoice' ? 'sales tax payable' : 'input tax'} account to adjust` };
  if (!offset) return { error: `No ${diff.kind === 'invoice' ? 'revenue' : 'expense'} account to adjust` };
  if (tax.id === offset.id) return { error: 'The tax and the revenue/expense are on the same account' };
  const d = diff.differenceCents;
  const taxAmount = diff.kind === 'invoice' ? -d : d;
  const description = `Tax correction for ${diff.kind === 'invoice' ? 'Invoice' : 'Bill'} ${diff.number}: ${diff.postedTaxCents} → ${diff.expectedTaxCents} cents`;
  return {
    entry: {
      date,
      description,
      totalAmountCents: Math.abs(d),
      metadata: {
        type: TAX_ADJUSTMENT_TYPE,
        [diff.kind === 'invoice' ? 'invoiceId' : 'billId']: diff.id,
        taxAccountId: tax.id,
        postedTaxCents: diff.postedTaxCents,
        expectedTaxCents: diff.expectedTaxCents,
      },
      lines: [
        { accountId: tax.id, accountName: tax.name, amountCents: taxAmount, description },
        { accountId: offset.id, accountName: offset.name, amountCents: -taxAmount, description },
      ],
    },
  };
}
