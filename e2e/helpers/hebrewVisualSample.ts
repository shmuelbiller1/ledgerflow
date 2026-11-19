import type { Page } from '@playwright/test';
import type { BankStatementLine, Bill, ChartAccount, Customer, Invoice, Transaction, Vendor, Workspace } from '../../src/types';
import { installSmallSample } from './sampleFixture';

export const hebrewSample = {
  bankName: 'עו״ש 1010 · Studio',
  expenseName: 'אירוח AWS',
  bankLine: 'תשלום AWS-914',
  invoiceNumber: 'INV-2091',
  billNumber: 'BILL-914',
  vatNumber: '514000001',
  from: '2026-09-01',
  to: '2026-09-30',
};

const books = { workspaceId: 'guest', uid: 'owner-sample' };
const currency = 'ILS';
const createAccount = (id: string, code: string, name: string, type: ChartAccount['type'], category: string): ChartAccount => (
  { ...books, id, code, name, type, category, balanceCents: 0 }
);
const bank = createAccount('he-bank', '1010', hebrewSample.bankName, 'asset', 'Cash');
const ar = createAccount('he-ar', '1200', 'לקוחות', 'asset', 'Receivables');
const ap = createAccount('he-ap', '2000', 'ספקים', 'liability', 'Payables');
const outputVat = createAccount('he-output-vat', '2100', 'מע״מ עסקאות', 'liability', 'Tax');
const inputVat = createAccount('he-input-vat', '1300', 'מע״מ תשומות', 'asset', 'Tax');
const equity = createAccount('he-equity', '3000', 'הון פתיחה', 'equity', 'Equity');
const revenue = createAccount('he-sales', '4000', 'מכירות Studio', 'income', 'Sales');
const expense = createAccount('he-expense', '5000', hebrewSample.expenseName, 'expense', 'Operations');

const customer: Customer = { ...books, id: 'he-customer', name: 'סטודיו North', balanceCents: 118_000 };
const vendor: Vendor = { ...books, id: 'he-vendor', name: 'אירוח AWS בע״מ', category: 'Operations', balanceCents: 141_600 };
const date = '2026-09-17';
const invoice: Invoice = {
  ...books, id: 'he-invoice', number: hebrewSample.invoiceNumber, customerId: customer.id, customerName: customer.name,
  status: 'sent', date, dueDate: '2026-10-17', amountCents: 118_000, taxAmountCents: 18_000, taxRate: 0.18, currency, posted: true,
};
const bill: Bill = {
  ...books, id: 'he-bill', number: hebrewSample.billNumber, vendorId: vendor.id, vendorName: vendor.name,
  status: 'unpaid', date, dueDate: '2026-10-18', amountCents: 141_600, taxAmountCents: 21_600, taxRate: 0.18, currency, posted: true,
};
const bankLine: BankStatementLine = {
  ...books, id: 'he-bank-line', accountId: bank.id, date: '2026-09-28', description: hebrewSample.bankLine,
  amountCents: -141_600, currency, status: 'pending',
};
const workspace: Workspace = {
  id: books.workspaceId, uid: books.uid, name: 'סטודיו North Books', businessType: 'custom',
  createdAt: '2026-09-01T12:00:00Z', currency,
  taxProfiles: { books: { name: 'סטודיו North Books', place: { country: 'IL' }, registrations: [
    { kind: 'vat', number: hebrewSample.vatNumber, place: { country: 'IL' }, filing: 'monthly', validFrom: '2026-01-01' },
  ] } },
};
const line = (account: ChartAccount, amountCents: number) => ({ accountId: account.id, accountName: account.name, amountCents });
const journal = { ...books, currency, exchangeRate: 1, status: 'completed', type: 'journal', posted: true, createdAt: '2026-09-17T12:00:00Z' } as const;
// Opening cash ₪5,000.00; September revenue ₪1,000.00 less expense ₪1,200.00 = a genuine negative result.
// The unmatched bank withdrawal is a statement line only; it is not booked a second time.
const transactions: Transaction[] = [
  { ...journal, id: 'he-opening', date: hebrewSample.from, description: 'הפקדת פתיחה', totalAmountCents: 500_000,
    lines: [line(bank, 500_000), line(equity, -500_000)] },
  { ...journal, id: 'he-accrual', date, description: hebrewSample.invoiceNumber, totalAmountCents: 118_000,
    lines: [line(ar, 118_000), line(revenue, -100_000), line(outputVat, -18_000)] },
  { ...journal, id: 'he-charge', date, description: hebrewSample.billNumber, totalAmountCents: 141_600,
    lines: [line(expense, 120_000), line(inputVat, 21_600), line(ap, -141_600)] },
];

const rows = (records: readonly { id: string }[]) => Object.fromEntries(records.map(record => [record.id, record]));

/** A fixed bilingual sample company using the real browser-local guest transport, not API or report mocks. */
export async function installHebrewVisualSample(page: Page) {
  await installSmallSample(page, false, {
    workspaces: rows([workspace]),
    chartAccounts: rows([bank, ar, ap, outputVat, inputVat, equity, revenue, expense]),
    transactions: rows(transactions),
    customers: rows([customer]), vendors: rows([vendor]), invoices: rows([invoice]), bills: rows([bill]),
    bankLines: rows([bankLine]),
  });
}
