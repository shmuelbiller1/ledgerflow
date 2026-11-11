import type { Page } from '@playwright/test';
import { seedDemoWorkspace } from './demoWorkspaceSeeder';

/** Deterministic two-entry books for tests about rows/keyboard/visuals, not the default sample year. */
export async function installSmallSample(page: Page, empty = false) {
  const books = seedDemoWorkspace('guest');
  const tables: Record<string, Record<string, unknown>> = {
    workspaces: { guest: { id: 'guest', uid: 'owner-sample', name: 'Sample company', currency: 'USD' } },
    chartAccounts: Object.fromEntries(books.accounts.map(row => [row.id, row])),
    transactions: Object.fromEntries((empty ? [] : books.transactions).map(row => [row.id, row])),
    customers: Object.fromEntries(books.customers.map(row => [row.id, row])),
    vendors: Object.fromEntries(books.vendors.map(row => [row.id, row])),
  };
  await page.addInitScript(data => {
    // Preserve real local writes over reload; each Playwright test starts with fresh tab storage.
    if (!sessionStorage.getItem('ledgerflow_sample_company_v1')) sessionStorage.setItem('ledgerflow_sample_company_v1', JSON.stringify(data));
  }, tables);
}
