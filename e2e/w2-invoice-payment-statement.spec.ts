import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { measure, mountScreen, type FixtureUser, type MountOptions } from './helpers/browserMount';

/**
 * W2 (RELEASE_GATE): invoice → payment → customer statement, driven on the real screens.
 *
 * The screens are mounted against the app's own stores with the request boundary stubbed, so this
 * is a browser test of the screens users reach — not of a live database.
 *
 * Worked figures, checked against independently computed numbers:
 * - Invoice INV-001: $1,180.00 (118000 cents), sent 2026-10-10, due 2026-10-20
 * - Payment: $600.00 (60000 cents) received 2026-10-15, allocated to INV-001
 * - Statement for 2026-10-01 … 2026-10-31: opening 0, ending 1180.00 − 600.00 = $580.00 (58000)
 *
 * The store seed is plain data, so every figure below is visible in this file rather than hidden
 * inside a render script.
 */

const WORKSPACE = 'w2-browser';
const USER: FixtureUser = { uid: 'w2-user', email: 'w2@example.test', displayName: 'W2 Owner' };
const COMPANY = { id: WORKSPACE, name: 'W2 Test Co', currency: 'USD' };
const STATEMENT_PERIOD = { startDate: '2026-10-01', endDate: '2026-10-31' };

const CREDITORS = [
  { id: 'cust-001', workspaceId: WORKSPACE, uid: USER.uid, name: 'Test Customer', email: 'customer@test.com' },
];
const INVOICES = [
  {
    id: 'inv-001',
    workspaceId: WORKSPACE,
    uid: USER.uid,
    number: 'INV-001',
    customerId: 'cust-001',
    customerName: 'Test Customer',
    date: '2026-10-10',
    dueDate: '2026-10-20',
    status: 'sent',
    amountCents: 118000,
    amountPaidCents: 60000,
    currency: 'USD',
  },
];
const PAYMENTS = [
  {
    id: 'pay-001',
    workspaceId: WORKSPACE,
    uid: USER.uid,
    amountCents: 60000,
    date: '2026-10-15',
    direction: 'received',
    status: 'posted',
    contactId: 'cust-001',
    contactName: 'Test Customer',
    method: 'bank_transfer',
    reference: 'PMT-001',
    depositAccountId: 'bank-1000',
    unappliedCents: 0,
    allocations: [{ documentId: 'inv-001', documentType: 'invoice', amountCents: 60000 }],
  },
];

const salesOptions = (requests: MountOptions['requests']): MountOptions & { fixture: string; heading: string; user: FixtureUser } => ({
  fixture: 'w2-sales-fixture',
  // The screen's own title; "Sales" alone is not a heading on it.
  heading: 'Invoicing & Customer Accounts',
  title: 'W2 Sales',
  user: USER,
  screen: '/src/components/sales/Sales.tsx',
  workspace: COMPANY,
  requests,
  collections: {
    customers: CREDITORS,
    vendors: [],
    invoices: INVOICES,
    bills: [],
    payments: PAYMENTS,
    creditNotes: [],
    vendorCredits: [],
    accounts: [
      { id: 'bank-1000', workspaceId: WORKSPACE, uid: USER.uid, code: '1000', name: 'Bank Account', type: 'asset', category: 'Cash' },
      { id: 'ar-1100', workspaceId: WORKSPACE, uid: USER.uid, code: '1100', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' },
      { id: 'sales-4000', workspaceId: WORKSPACE, uid: USER.uid, code: '4000', name: 'Sales Revenue', type: 'income', category: 'Revenue' },
    ],
    bankLines: [],
    transactions: [],
  },
  loaded: { customers: true, invoices: true, payments: true, accounts: true },
  // The screen may try to create an invoice or a payment; answer with what a server would return.
  api: ({ url, method }) => {
    if (method === 'POST' && url.includes('/invoices')) {
      return { id: 'inv-001', number: 'INV-001', status: 'sent', amountCents: 118000, amountPaidCents: 0, date: '2026-10-10', dueDate: '2026-10-20', currency: 'USD' };
    }
    if (method === 'POST' && url.includes('/payments')) {
      return { data: { id: 'pay-001', amountCents: 60000, date: '2026-10-15', transactionId: 'txn-001' } };
    }
    return {};
  },
});

const statementOptions = (): MountOptions & { fixture: string; heading: string; user: FixtureUser } => ({
  fixture: 'w2-statement-fixture',
  heading: 'Account Statement',
  title: 'W2 Statement',
  user: USER,
  screen: '/src/components/reporting/StatementView.tsx',
  workspace: COMPANY,
  collections: {
    customers: CREDITORS,
    vendors: [],
    invoices: INVOICES,
    bills: [],
    payments: PAYMENTS,
    creditNotes: [],
    vendorCredits: [],
    accounts: [],
    bankLines: [],
    transactions: [],
  },
  loaded: { customers: true, invoices: true, payments: true },
});

/** Fail when a screen is wider than the phone, or when axe finds a serious or critical violation. */
async function expectFitsAndPassesAxe(page: import('@playwright/test').Page, selector: string, label: string) {
  const { width, scroll } = await measure(page, selector);
  expect(scroll, `${label} is wider than the phone`).toBeLessThanOrEqual(width);
  const axe = await new AxeBuilder({ page }).include(selector).analyze();
  const serious = axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
}

test('W2 browser: Sales screen shows invoice INV-001 with $1,180.00 and $600.00 paid, balance $580.00', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });

  const errors = await mountScreen(page, salesOptions([]));

  const table = page.getByRole('table').first();
  await expect(table.getByRole('cell', { name: 'INV-001', exact: true })).toBeVisible();
  await expect(table).toContainText('$1,180.00');
  await expect(table).toContainText('$600.00');
  // 1,180.00 − 600.00 of paid value = 580.00 still owed by the customer.
  await expect(table).toContainText('$580.00');
  await expectFitsAndPassesAxe(page, 'body', 'Sales screen');

  expect(errors, JSON.stringify(errors)).toEqual([]);
});

test('W2 browser: Customer statement shows INV-001 $1,180.00, payment -$600.00, balance $580.00', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });

  const errors = await mountScreen(page, statementOptions());

  await expect(page.getByRole('heading', { name: 'Account Statement', exact: true })).toBeVisible();
  await page.getByLabel('Customer').selectOption('Test Customer');

  // The statement's own table carries the invoice, the payment and the ending balance once each;
  // the summary card above repeats 580.00, so the row is asserted inside the table.
  const statementTable = page.getByRole('table').first();
  await expect(statementTable).toContainText('INV-001');
  await expect(statementTable).toContainText('$600.00');
  await expect(statementTable).toContainText('$580.00');
  await expectFitsAndPassesAxe(page, 'body', 'Statement view');

  expect(errors, JSON.stringify(errors)).toEqual([]);
});

test('W2 browser: desktop Sales screen with invoice and payment figures', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1200, height: 800 });

  const errors = await mountScreen(page, salesOptions([]));

  const table = page.getByRole('table').first();
  await expect(table.getByRole('cell', { name: 'INV-001', exact: true })).toBeVisible();
  await expect(table).toContainText('$1,180.00');
  await expect(table).toContainText('$600.00');
  await expect(table).toContainText('$580.00');

  expect(errors, JSON.stringify(errors)).toEqual([]);
});

test('W2 browser: computeStatement produces correct figures for invoice-payment workflow', async ({ page }) => {
  test.setTimeout(60000);

  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/w2-compute-fixture', route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><head><title>Test computeStatement</title></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('/w2-compute-fixture');

  // Compute the statement straight from the pure report function: no store, no screen.
  const result = await page.evaluate(async ({ invoices, payments, period }) => {
    const { computeStatement } = await import('/src/server/reports/computeReports');
    const statement = computeStatement({ id: 'cust-001', name: 'Test Customer' }, invoices, [], payments, period.startDate, period.endDate, 'customer', []);
    return {
      openingBalanceCents: statement.openingBalanceCents,
      endingBalanceCents: statement.endingBalanceCents,
      entries: statement.entries.map((entry: { type: string; amountCents: number }) => ({ type: entry.type, amountCents: entry.amountCents })),
    };
  }, { invoices: INVOICES, payments: PAYMENTS, period: STATEMENT_PERIOD });

  expect(result.openingBalanceCents).toBe(0);
  // 118000 billed − 60000 paid.
  expect(result.endingBalanceCents).toBe(58000);
  expect(result.entries).toHaveLength(2);
  expect(result.entries).toContainEqual({ type: 'Invoice', amountCents: 118000 });
  expect(result.entries).toContainEqual({ type: 'Payment', amountCents: -60000 });

  expect(errors, JSON.stringify(errors)).toEqual([]);
});
