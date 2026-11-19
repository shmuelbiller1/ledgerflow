import { expect, type Page } from '@playwright/test';
import { item, openComparison, pressAt, trends, workspaceId as books } from './comparisonReportFixture';
import type { JourneyApiHandler } from './journeyFixture';

export { books };
const line = (quantity: number, amountCents: number) => ({ itemId: 'valve', description: item, quantity, amountCents, accountId: 'stock' });
const bill = (id: string, date: string, currency: string, splits: ReturnType<typeof line>[]) => ({
  id, workspaceId: books, vendorId: 'north', status: 'approved', number: id, date, currency, splits,
  amountCents: splits.reduce((sum, row) => sum + row.amountCents, 0),
});
const payment = (id: string, date: string, method: string, direction: string, currency: string, amountCents: number) => ({
  id, workspaceId: books, contactId: 'dana', date, method, direction, status: 'posted', currency, amountCents, exchangeRate: currency === 'EUR' ? 2 : 1,
});
export const registerLedger = {
  customers: [{ id: 'dana', name: 'Dana דנה', workspaceId: books }],
  vendors: [{ id: 'north', name: 'North צפון', workspaceId: books }], inventory: [{ id: 'valve', workspaceId: books, name: item }],
  bills: [bill('B-1', '2026-01-14', 'USD', [line(0.25, 375), line(0.5, 875)]), bill('B-2', '2026-02-09', 'EUR', [line(2, 3640)])],
  payments: [payment('p1', '2026-02-09', 'card', 'received', 'USD', 1250), payment('p2', '2026-02-10', 'card', 'received', 'EUR', 1500),
    payment('p3', '2026-02-11', 'check', 'made', 'USD', 2300), payment('p4', '2026-01-08', 'card', 'received', 'USD', 975)],
};
export const fullBills = [...registerLedger.bills, bill('B-3', '2026-02-20', 'USD', [line(1.5, 1815)])];
export const receiptMount = { module: '/src/components/reporting/PaymentMethodSummaryView.tsx', props: {
  startDate: '2026-02-01', endDate: '2026-02-28', compareStartDate: '2026-01-01', compareEndDate: '2026-01-31',
} };

export async function openRegister(page: Page, kind: 'items' | 'receipts', width: number, theme: 'light' | 'dark', api?: JourneyApiHandler) {
  const result = await openComparison(page, kind === 'items' ? trends('purchases') : receiptMount, width, theme, 'viewer', { ledger: registerLedger, api });
  if (kind === 'items') await pressAt(page, page.getByRole('combobox', { name: result.he ? 'קיבוץ הרכישות לפי' : 'Group purchases by' }), 'ArrowDown');
  await expect(page.getByRole('table').first()).toContainText(kind === 'items' ? '€36.40' : '$42.50');
  return result;
}
