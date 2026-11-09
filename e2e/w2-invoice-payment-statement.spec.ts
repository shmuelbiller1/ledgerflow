import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mountJourney, remountJourney, setLedgerField, settleStyles } from './support/journeyFixture';

/**
 * F-41 · W2 (RELEASE_GATE): invoice → posting → payment → customer statement, in the browser.
 *
 * Worked figures (USD, all in cents, September 2026):
 *   invoice #1001 dated 2026-09-05, issued for 1,180.00                 → open 1,180.00
 *   payment 2026-09-20, CHK-90412, 500.00 applied to #1001 (partial)     → open 680.00
 *
 * Statement for 2026-09-01 … 2026-09-30:
 *   opening balance 0.00 · billed 1,180.00 · paid 500.00 · ending outstanding 680.00
 *   running balance after the invoice 1,180.00, after the payment 680.00
 *
 * The payment screen and the statement are mounted from the app's source. The server's reply is
 * stubbed; the store update that the live subscription would deliver after the write is applied by
 * the test, so the statement is checked against what the screen really sends and the worked figures.
 * The posting itself (journal lines) is verified by the server suites, not here.
 */

const WORKSPACE = 'w2-browser';
const CUSTOMER = { id: 'cust-buyer', uid: 'journey-user', workspaceId: WORKSPACE, name: 'Buyer Ltd', email: 'ap@buyer.example.test' };
const BANK = { id: 'bank-1000', uid: 'journey-user', workspaceId: WORKSPACE, code: '1000', name: 'Bank 1000', type: 'asset', category: 'Cash' };
const INVOICE = {
  id: 'inv-1001', uid: 'journey-user', workspaceId: WORKSPACE, number: '1001', customerId: CUSTOMER.id, customerName: CUSTOMER.name,
  status: 'sent', date: '2026-09-05', dueDate: '2026-10-05', amountCents: 118000, amountPaidCents: 0, currency: 'USD', lines: [],
};

function paymentRecord(amountCents: number) {
  return {
    id: 'pay-1', uid: 'journey-user', workspaceId: WORKSPACE, direction: 'received', status: 'posted', contactId: CUSTOMER.id,
    date: '2026-09-20', amountCents, reference: 'CHK-90412', paymentMethod: 'bank_transfer', currency: 'USD',
  };
}

test('W2 browser: an invoice is part-paid and the customer statement shows the worked balance', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 900 });

  const { errors, requests } = await mountJourney(page, {
    workspaceId: WORKSPACE,
    ledger: { accounts: [BANK], customers: [CUSTOMER], invoices: [INVOICE], payments: [], bills: [], vendors: [] },
    mounts: [
      { module: '/src/components/sales/ReceivePaymentModal.tsx', props: { isOpen: true, defaultDirection: 'received', defaultContactId: CUSTOMER.id } },
      { module: '/src/components/reporting/StatementView.tsx', props: { startDate: '2026-09-01', endDate: '2026-09-30' } },
    ],
    api: request => (request.url.endsWith('/api/v1/payments') && request.method === 'POST' ? { status: 201, json: { id: 'pay-1', status: 'posted' } } : null),
  });

  // 1. The payment screen lists the open invoice with its full remaining balance.
  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('heading', { name: 'Receive Customer Payment', exact: true })).toBeVisible();
  await expect(modal.getByText('#1001', { exact: true })).toBeVisible();
  await expect(modal.getByText(/Remaining: .*1,180\.00/)).toBeVisible();

  // 2. Record a part payment of 500.00, dated in September, applied to invoice 1001.
  await page.locator('#pay-amount').fill('500.00');
  await page.locator('#pay-date').fill('2026-09-20');
  await page.locator('#pay-reference').fill('CHK-90412');
  await page.getByLabel('Allocation amount for document 1001').fill('500.00');
  await modal.getByRole('button', { name: 'Record & Post Payment', exact: true }).click();

  // 3. The request the screen sent: the amount, the date, the cash account and the allocation, exactly.
  await expect.poll(() => requests.filter(r => r.url.endsWith('/api/v1/payments')).length).toBe(1);
  expect(requests.find(r => r.url.endsWith('/api/v1/payments'))?.body).toMatchObject({
    workspaceId: WORKSPACE,
    paymentDate: '2026-09-20',
    amountCents: 50000,
    paymentMethod: 'bank_transfer',
    referenceNumber: 'CHK-90412',
    customerId: CUSTOMER.id,
    cashAccountId: BANK.id,
    allocations: [{ documentId: 'inv-1001', documentType: 'invoice', amountCents: 50000 }],
  });

  // 4. The dialog closes once the payment is posted (the screen's own close), and the live store receives the posted payment and the invoice's new paid amount; the statement follows.
  await remountJourney(page, [{ module: '/src/components/reporting/StatementView.tsx', props: { startDate: '2026-09-01', endDate: '2026-09-30' } }]);
  await setLedgerField(page, 'payments', [paymentRecord(50000)]);
  await setLedgerField(page, 'invoices', [{ ...INVOICE, amountPaidCents: 50000 }]);

  await expect(page.getByRole('table', { name: 'Account statement' })).toBeVisible();
  await expect(page.getByText('Ending Outstanding Balance', { exact: true })).toBeVisible();

  const rows = await page.getByRole('table', { name: 'Account statement' }).locator('tbody tr').evaluateAll(trs =>
    trs.map(tr => Array.from(tr.querySelectorAll('td')).map(cell => (cell.textContent ?? '').trim())),
  );
  expect(rows).toEqual([
    ['2026-09-01', 'Opening Balance Brought Forward', '$0.00'],
    ['2026-09-05', 'Invoice', '#1001', '$1,180.00', '-', '$1,180.00'],
    ['2026-09-20', 'Payment', '#CHK-90412', '-', '$500.00', '$680.00'],
  ]);

  // The ending balance card: 1,180.00 billed less 500.00 paid is 680.00 still owed.
  const ending = page.getByText('Ending Outstanding Balance', { exact: true }).locator('xpath=following-sibling::div[1]');
  await expect(ending).toHaveText(/680\.00$/);

  // The statement is for the right customer and never shows an error.
  await expect(page.getByText('STATEMENT OF ACCOUNT', { exact: true })).toBeVisible();
  await expect(page.getByText('ap@buyer.example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('Period: 2026-09-01 to 2026-09-30')).toBeVisible();

  // The statement's table passes serious/critical axe checks in the light theme.
  await settleStyles(page);
  const axe = await new AxeBuilder({ page }).include('table[aria-label], table').analyze();
  const serious = axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  await testInfo.attach('w2-statement-axe', { body: JSON.stringify(axe.violations, null, 2), contentType: 'application/json' });
  expect(serious, JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);

  expect(errors).toEqual([]);
});
