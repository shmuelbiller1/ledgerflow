import { test, expect } from '@playwright/test';
import { mountJourney, captured, remountJourney } from './support/journeyFixture';

/**
 * F-44 · W6 (RELEASE_GATE): order with a 25% deposit → part invoices → delivery charged once, in the browser.
 * The figures are the owner's QuickBooks example (docs/TRACKER.md DEP-1), in cents:
 *
 *   accepted order EST-1 (2026-05-01): goods 100,000 + delivery 10,000 = 110,000 (1,100.00)
 *
 *   1. deposit 25% = 27,500 (275.00) received 2026-09-20 into Bank 1000. A deposit is a payment,
 *      not an invoice, so the order is still 110,000 to invoice.
 *   2. first part invoice, 25% of the order = 27,500:
 *        draft invoice: goods 25,000 (250.00) + delivery 2,500 (25.00) = 27,500
 *   3. second part invoice, all that is left = 82,500:
 *        draft invoice: goods 75,000 (750.00) + delivery 7,500 (75.00) = 82,500
 *      The delivery was invoiced exactly once: 2,500 + 7,500 = 10,000 (100.00).
 *   4. nothing is left: the screen refuses another invoice (a second delivery charge can't be made).
 *
 * The screens are mounted from the app's source; the server replies are stubbed, and the order's invoices
 * reach the screen the way the live subscription delivers them. The server-side guard that stops two
 * people invoicing the same order at once is covered by src/tests/order-invoice-limit.test.ts.
 */

const WORKSPACE = 'w6-browser';
const CUSTOMER = { id: 'cust-acme', uid: 'journey-user', workspaceId: WORKSPACE, name: 'Acme Retail', email: 'ap@acme.example.test' };
const BANK = { id: 'bank-1000', uid: 'journey-user', workspaceId: WORKSPACE, code: '1000', name: 'Bank 1000', type: 'asset', category: 'Cash' };
const ORDER = {
  id: 'est-1', uid: 'journey-user', workspaceId: WORKSPACE, number: 'EST-1', customerId: CUSTOMER.id, customerName: CUSTOMER.name,
  status: 'accepted', orderedAt: '2026-05-01', date: '2026-04-28', amountCents: 110000, currency: 'USD',
  lines: [
    { description: 'Goods', quantity: 1, unitPriceCents: 100000, amountCents: 100000 },
    { description: 'Delivery', quantity: 1, unitPriceCents: 10000, amountCents: 10000 },
  ],
};

const progressAfter = (invoicedCents: number, invoices: unknown[]) => ({
  totalCents: 110000, invoicedCents, leftCents: 110000 - invoicedCents, invoices,
});
const firstPart = { id: 'inv-p1', number: 'INV-101', status: 'sent', date: '2026-09-21', amountCents: 27500, currency: 'USD', metadata: { convertedFromEstimateId: ORDER.id } };
const secondPart = { id: 'inv-p2', number: 'INV-102', status: 'sent', date: '2026-09-22', amountCents: 82500, currency: 'USD', metadata: { convertedFromEstimateId: ORDER.id } };

/** The draft invoice's lines as the screen shows them: description and amount, in order. */
async function draftLines(page: import('@playwright/test').Page): Promise<Array<[string, string]>> {
  const table = page.getByRole('table', { name: 'The draft invoice' });
  return table.locator('tbody tr, tfoot tr').evaluateAll(trs => trs.map(tr => {
    const cells = Array.from(tr.cells).map(td => (td.textContent ?? '').trim());
    return [cells[0], cells[1]] as [string, string];
  }));
}

test('W6 browser: a 25% deposit is taken, the order is invoiced in two parts, and the delivery is charged once', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 900 });

  // 1. The deposit is a payment received against the order.
  const { errors, requests } = await mountJourney(page, {
    workspaceId: WORKSPACE,
    ledger: { accounts: [BANK], customers: [CUSTOMER], estimates: [ORDER], invoices: [], payments: [] },
    mounts: [{ module: '/src/components/sales/EstimateDepositDialog.tsx', props: { estimate: ORDER } }],
    api: request => (request.url.endsWith('/api/v1/payments') && request.method === 'POST' ? { status: 201, json: { id: 'pay-dep-1', status: 'posted' } } : null),
  });

  const deposit = page.getByRole('dialog');
  await expect(deposit.getByRole('heading', { name: 'Deposit for estimate EST-1' })).toBeVisible();
  await deposit.getByRole('button', { name: '25%', exact: true }).click();
  await expect(deposit.getByLabel('Deposit (USD)')).toHaveValue('275.00');
  await deposit.getByLabel('Received on').fill('2026-09-20');
  await deposit.getByRole('button', { name: 'Record $275.00 deposit', exact: true }).click();

  await expect.poll(() => requests.filter(r => r.url.endsWith('/api/v1/payments')).length).toBe(1);
  expect(requests[0].body).toMatchObject({
    workspaceId: WORKSPACE, amountCents: 27500, paymentDate: '2026-09-20', cashAccountId: BANK.id,
    paymentMethod: 'bank_transfer', customerId: CUSTOMER.id, entityName: CUSTOMER.name, estimateId: ORDER.id,
    memo: 'Deposit for estimate EST-1', allocations: [],
  });

  // 2. First part invoice: 25% of the order. The draft shows goods and delivery, each with its share.
  await remountJourney(page, [{
    module: '/src/components/sales/OrderInvoiceDialog.tsx',
    props: { estimate: ORDER, progress: progressAfter(0, []), currency: 'USD', onCreate: '__capture:create' },
  }]);
  const first = page.getByRole('dialog');
  await expect(first.getByRole('heading', { name: 'Invoice order EST-1' })).toBeVisible();
  await expect(first.getByText(/order of \$1,100\.00 · invoiced \$0\.00/)).toBeVisible();
  await first.getByRole('radio', { name: 'A percentage of the order' }).check();
  await first.getByRole('textbox', { name: 'Percentage of the order' }).fill('25');
  await expect(first.getByRole('button', { name: 'Create $275.00 invoice', exact: true })).toBeEnabled();
  expect(await draftLines(page)).toEqual([
    ['Goods (25% of order EST-1)', '$250.00'],
    ['Delivery (25% of order EST-1)', '$25.00'],
    ['Total', '$275.00'],
  ]);
  await first.getByRole('button', { name: 'Create $275.00 invoice', exact: true }).click();
  await expect.poll(() => captured(page, 'create')).toHaveLength(1);
  expect((await captured(page, 'create'))[0][0]).toEqual({ mode: 'percent', percent: 25 });

  // 3. Second part invoice: all that is left, now that the first part is in the books.
  await remountJourney(page, [{
    module: '/src/components/sales/OrderInvoiceDialog.tsx',
    props: { estimate: ORDER, progress: progressAfter(27500, [firstPart]), currency: 'USD', onCreate: '__capture:create' },
  }]);
  const second = page.getByRole('dialog');
  await expect(second.getByText(/order of \$1,100\.00 · invoiced \$275\.00 \(INV-101\) · left \$825\.00/)).toBeVisible();
  await second.getByRole('radio', { name: 'All that is left ($825.00)' }).check();
  await expect(second.getByRole('button', { name: 'Create $825.00 invoice', exact: true })).toBeEnabled();
  expect(await draftLines(page)).toEqual([
    ['Goods (rest of order EST-1)', '$750.00'],
    ['Delivery (rest of order EST-1)', '$75.00'],
    ['Total', '$825.00'],
  ]);
  await second.getByRole('button', { name: 'Create $825.00 invoice', exact: true }).click();
  await expect.poll(() => captured(page, 'create')).toHaveLength(2);
  expect((await captured(page, 'create'))[1][0]).toEqual({ mode: 'rest' });

  // 4. Everything is invoiced. The delivery was charged once (2,500 + 7,500 = 10,000) and nothing is left to bill.
  await remountJourney(page, [{
    module: '/src/components/sales/OrderInvoiceDialog.tsx',
    props: { estimate: ORDER, progress: progressAfter(110000, [firstPart, secondPart]), currency: 'USD', onCreate: '__capture:create' },
  }]);
  const done = page.getByRole('dialog');
  await expect(done.getByText(/invoiced \$1,100\.00 \(INV-101, INV-102\) · left \$0\.00/)).toBeVisible();
  await expect(done.getByRole('alert')).toHaveText('Nothing is left to invoice on this order');
  await expect(done.getByRole('button', { name: /Create \$0\.00 invoice/ })).toBeDisabled();
  expect(await captured(page, 'create')).toHaveLength(2);

  expect(errors).toEqual([]);
});
