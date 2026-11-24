/**
 * E-33: assemble the Uniform Structure writer's input from the books (read-only).
 *
 * Maps the workspace's own records — postable journal entries, the chart of accounts, issued
 * invoices/bills/credit notes/vendor credits and the payments applied to them — into the
 * `UniformFixtureInput` shape `writeUniformFiles` consumes. Nothing is calculated beyond
 * reading recorded figures (line amounts in the books' minor units via `lineAmount`, document
 * totals as recorded); no money is converted, posted or invented.
 *
 * Deliberate limitations, surfaced as `notes` the screen shows:
 * - Inventory (M100) is not written: opening/in/out totals per item are not carried by the
 *   item records, and fabricating them would misstate the stock file. `inventory` is empty.
 * - Payments only attach to documents this export writes, dated inside the period; unapplied
 *   cash has no document to sit under (D120 needs one) and is counted in `skipped`.
 * - Document numbers come from the record itself; a document with no number is reported by
 *   the writer as a problem rather than given an invented number.
 *
 * Pure: no store, no I/O.
 */
import { isPostable, lineAmount, isTransactionInDateRange } from '../txFilters';
import type {
  Bill,
  ChartAccount,
  CreditNote,
  Invoice,
  Payment,
  Transaction,
  VendorCredit,
} from '../../types';
import type { TaxProfiles } from './profile';
import type { UniformDocumentType, UniformFixtureInput, UniformPaymentMethod } from './uniformStructure';

/**
 * The Israeli dealer number (עוסק מורשה) the books-level tax profile records — A000 field 1003,
 * the file's primary tax identity. Same rule as `ilWithholdingFileNo` (form856AuthorityCsv.ts):
 * an IL registration of the right kind whose number is the right shape; '' when the profile has
 * none, which the writer then reports as a missing tax ID rather than inventing.
 */
export function ilDealerNumber(profiles: TaxProfiles | null | undefined): string {
  const registrations = profiles?.books?.registrations || [];
  const hit = registrations.find(registration =>
    registration.kind === 'vat'
    && String(registration.place?.country || '').trim().toUpperCase() === 'IL'
    && /^\d{9}$/.test(String(registration.number || '').trim()));
  return hit ? String(hit.number).trim() : '';
}

/** The parts of a workspace the assembler reads. */
export interface UniformBooksSource {
  business: {
    name: string;
    /** Israeli dealer number (עוסק מורשה), when the tax profile records one. */
    taxId?: string;
    /** First line of the business address (branding.address), when it fits field 1019. */
    addressLine?: string;
  };
  /** Calendar tax year the export covers, 'YYYY'. */
  taxYear: string;
  baseCurrency: string;
  withholdingFileNo?: string;
  accounts: readonly ChartAccount[];
  transactions: readonly Transaction[];
  invoices: readonly Invoice[];
  bills: readonly Bill[];
  creditNotes: readonly CreditNote[];
  vendorCredits: readonly VendorCredit[];
  payments: readonly Payment[];
  /** Read only to report the M100 gap honestly; never written in this version. */
  inventoryItemCount: number;
}

export interface UniformBooksResult {
  input: UniformFixtureInput;
  /** Assembly-level limitations the screen must show (the writer adds its own `problems`). */
  notes: string[];
  skipped: {
    /** Documents in the period that are drafts/void and therefore not written. */
    documents: number;
    /** Posted payments in the period with no allocation to an exported document. */
    paymentsUnapplied: number;
    /** Allocations in the period whose document is not part of this export. */
    allocationsToSkippedDocuments: number;
  };
  /** Base currency and תיק ניכויים, passed through for the writer's options. */
  baseCurrency: string;
  withholdingFileNo?: string;
}

const INVOICE_STATUSES = new Set(['pending', 'sent', 'paid', 'partially_paid', 'overdue', 'approved', 'invoiced']);
const BILL_STATUSES = new Set(['pending', 'approved', 'paid', 'partially_paid', 'overdue', 'unpaid']);
const CREDIT_STATUSES = new Set(['open', 'applied', 'partially_applied']);

const PAYMENT_METHOD_CODES: Record<string, UniformPaymentMethod> = {
  cash: '1',
  check: '2',
  card: '3',
  bank_transfer: '4',
  other: '9',
};

/** 'YYYY-MM-DD…' → 'YYYYMMDD' for the fixed-width date fields; '' when there is no real date. */
export function uniformDate8(date: string | undefined): string {
  const day = (date || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.replace(/-/g, '') : '';
}

/** First line of a free-text address, the only part field 1019 can carry without guessing. */
function firstAddressLine(address: string | undefined): string | undefined {
  const line = (address || '').split(/\r?\n/)[0]?.trim();
  return line ? line : undefined;
}

type ExportableDocument = Invoice | Bill | CreditNote | VendorCredit;

function documentTaxCents(doc: ExportableDocument): number {
  const legacy = 'taxCents' in doc ? doc.taxCents : undefined;
  const sales = 'salesTaxCents' in doc ? doc.salesTaxCents : undefined;
  return doc.taxAmountCents ?? legacy ?? sales ?? 0;
}

function documentTaxRate(doc: ExportableDocument): number | undefined {
  return 'taxRate' in doc ? doc.taxRate : undefined;
}

function documentNumber(doc: { number?: string; id: string }): string {
  return doc.number || doc.id;
}

function inYear(date8: string, year: string): boolean {
  return date8.slice(0, 4) === year;
}

/**
 * Build the writer's input for one calendar tax year.
 *
 * Journal lines carry the books' own home-currency amounts (`lineAmount`: `baseAmountCents`
 * when the posting stored one, otherwise the rate-adjusted line amount), so the exported
 * journal is the same money the reports read — no conversion of our own.
 */
export function buildUniformBooksInput(source: UniformBooksSource): UniformBooksResult {
  const notes: string[] = [];
  const skipped = { documents: 0, paymentsUnapplied: 0, allocationsToSkippedDocuments: 0 };
  const year = source.taxYear;
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  // ---- Journal: postable entries of the year, one B100 line per line of the entry ----
  const transactions = source.transactions
    .filter(tx => isPostable(tx) && isTransactionInDateRange(tx, start, end))
    .slice()
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));

  const accountById = new Map(source.accounts.map(account => [account.id, account]));
  const debitByAccount = new Map<string, number>();
  const creditByAccount = new Map<string, number>();
  const journalEntries: UniformFixtureInput['journalEntries'] = [];
  let transactionNo = 0;
  for (const tx of transactions) {
    transactionNo += 1;
    const date8 = uniformDate8(tx.date);
    for (const line of tx.lines) {
      const amountCents = lineAmount(line, tx);
      if (!amountCents) continue;
      const account = accountById.get(line.accountId);
      const accountKey = account?.code || line.accountId;
      if (amountCents > 0) debitByAccount.set(accountKey, (debitByAccount.get(accountKey) ?? 0) + amountCents);
      else creditByAccount.set(accountKey, (creditByAccount.get(accountKey) ?? 0) + -amountCents);
      journalEntries.push({
        transactionNo: String(transactionNo),
        date: date8,
        valueDate: date8,
        accountKey,
        debitCredit: amountCents > 0 ? '1' : '2',
        amountCents: Math.abs(amountCents),
        details: (line.description || tx.description || '').slice(0, 50),
      });
    }
  }

  // ---- Accounts: every chart account, plus the period's debit/credit totals from the journal ----
  const referencedKeys = new Set(journalEntries.map(entry => entry.accountKey));
  const seenKeys = new Set<string>();
  const accounts: UniformFixtureInput['accounts'] = [];
  for (const account of source.accounts) {
    const accountKey = account.code || account.id;
    if (seenKeys.has(accountKey)) continue;
    seenKeys.add(accountKey);
    accounts.push({
      accountKey,
      accountName: account.name,
      trialBalanceCode: account.code || account.id,
      trialBalanceCodeDescription: account.category || account.type || account.name,
      openingBalanceCents: account.openingBalanceCents,
      totalDebitsCents: debitByAccount.get(accountKey) ?? 0,
      totalCreditsCents: creditByAccount.get(accountKey) ?? 0,
    });
  }
  // An entry line whose account is not in the chart would reference a missing B110: report it.
  for (const key of referencedKeys) {
    if (seenKeys.has(key)) continue;
    notes.push(`Journal account ${key} is not in the chart of accounts; the writer will report the missing B110 record.`);
    accounts.push({
      accountKey: key,
      accountName: key,
      trialBalanceCode: key,
      trialBalanceCodeDescription: 'Not in the chart of accounts',
      totalDebitsCents: debitByAccount.get(key) ?? 0,
      totalCreditsCents: creditByAccount.get(key) ?? 0,
    });
    seenKeys.add(key);
  }

  // ---- Documents: issued records of the year, mapped to the spec's Appendix 1 types ----
  const exportedDocumentIds = new Map<string, { documentType: UniformDocumentType; documentNo: string }>();
  const documents: UniformFixtureInput['documents'] = [];

  const addDocument = (
    doc: ExportableDocument,
    documentType: UniformDocumentType,
    counterpartyName: string | undefined,
    statuses: Set<string>,
  ): void => {
    const date8 = uniformDate8(doc.date);
    if (!inYear(date8, year)) return;
    if (!statuses.has(doc.status)) {
      skipped.documents += 1;
      return;
    }
    const taxCents = documentTaxCents(doc);
    const amountInclVatCents = doc.amountCents;
    const documentNo = documentNumber(doc);
    exportedDocumentIds.set(doc.id, { documentType, documentNo });

    const lines: UniformFixtureInput['documents'][number]['lines'] = [];
    if ('items' in doc && doc.items && doc.items.length > 0) {
      for (const item of doc.items) {
        lines.push({
          description: item.description,
          quantity: item.quantity,
          unitPriceExclVatCents: item.rateCents,
          vatRatePercent: item.taxRate,
        });
      }
    } else if ('splits' in doc && doc.splits && doc.splits.length > 0) {
      for (const split of doc.splits) {
        const quantity = split.quantity && split.quantity > 0 ? split.quantity : 1;
        lines.push({
          description: split.description || documentNo,
          quantity,
          unitPriceExclVatCents: Math.round(split.amountCents / quantity),
          vatRatePercent: split.taxRate ?? documentTaxRate(doc),
        });
      }
    } else {
      // No recorded lines (credits, line-less invoices): one line carrying the document's own
      // figures — quantity 1 so the line total is exactly the amount, never a rounded guess.
      lines.push({
        description: documentNo,
        quantity: 1,
        unitPriceExclVatCents: Math.max(0, amountInclVatCents - taxCents),
        vatRatePercent: documentTaxRate(doc),
      });
    }

    documents.push({
      documentType,
      documentNo,
      issueDate: date8,
      customerName: counterpartyName,
      amountAfterDiscountExclVatCents: amountInclVatCents - taxCents,
      vatAmountCents: taxCents,
      amountInclVatCents,
      lines,
      payments: [],
    });
  };

  for (const invoice of source.invoices) addDocument(invoice, '305', invoice.customerName, INVOICE_STATUSES);
  for (const bill of source.bills) addDocument(bill, '500', bill.vendorName, BILL_STATUSES);
  for (const credit of source.creditNotes) addDocument(credit, '330', credit.customerName, CREDIT_STATUSES);
  for (const credit of source.vendorCredits) addDocument(credit, '410', credit.vendorName, CREDIT_STATUSES);

  documents.sort((a, b) => (a.issueDate === b.issueDate ? a.documentNo.localeCompare(b.documentNo) : a.issueDate.localeCompare(b.issueDate)));

  // ---- Payments applied to exported documents, as D120 rows under their document ----
  for (const payment of source.payments) {
    const date8 = uniformDate8(payment.date);
    if (!inYear(date8, year) || payment.status !== 'posted') continue;
    const code = PAYMENT_METHOD_CODES[payment.method] ?? '9';
    let applied = 0;
    for (const allocation of payment.allocations || []) {
      const target = exportedDocumentIds.get(allocation.documentId);
      if (!target) {
        if (allocation.amountCents > 0) skipped.allocationsToSkippedDocuments += 1;
        continue;
      }
      if (allocation.amountCents <= 0) continue;
      const document = documents.find(doc => doc.documentNo === target.documentNo && doc.documentType === target.documentType);
      if (!document) continue;
      applied += 1;
      document.payments.push({ paymentMethod: code, amountCents: allocation.amountCents, date: date8 });
    }
    if (applied === 0) skipped.paymentsUnapplied += 1;
  }

  if (skipped.documents > 0) {
    notes.push(`${skipped.documents} draft or void document(s) in ${year} are not written to the file.`);
  }
  if (skipped.paymentsUnapplied > 0) {
    notes.push(`${skipped.paymentsUnapplied} posted payment(s) in ${year} are not applied to an exported document and are not written as D120 records.`);
  }
  if (skipped.allocationsToSkippedDocuments > 0) {
    notes.push(`${skipped.allocationsToSkippedDocuments} payment allocation(s) in ${year} point at documents this file does not include.`);
  }
  if (source.inventoryItemCount > 0) {
    notes.push(`${source.inventoryItemCount} inventory item(s) exist, but M100 stock records are not written by this version: opening/in/out totals are not carried by the item records and are not invented.`);
  }

  const input: UniformFixtureInput = {
    business: {
      taxId: source.business.taxId ?? '',
      name: source.business.name,
      street: firstAddressLine(source.business.addressLine),
      taxYear: year,
      startDate: `${year}0101`,
      endDate: `${year}1231`,
    },
    accounts,
    journalEntries,
    documents,
    inventory: [],
  };
  return { input, notes, skipped, baseCurrency: source.baseCurrency, withholdingFileNo: source.withholdingFileNo };
}
