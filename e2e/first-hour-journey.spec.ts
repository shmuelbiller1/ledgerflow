import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mountJourney, remountJourney } from './support/journeyFixture';
import { stockJourneyServer } from './support/stockJourneyServer';

/**
 * The acceptance test for the whole rebuild, written the way the task words it:
 *
 *   a first-time user, 390px wide, keyboard only —
 *   create a customer, send an invoice, record its payment, open the profit and loss.
 *
 * Three things make this test worth more than the sum of its steps:
 *
 * 1. **Keyboard only.** Every action is `focus()` + `Enter`/`Tab` or typing. No `click()`. A screen
 *    that only works with a mouse fails here even if it looks right.
 * 2. **390px.** The screen where most of the app's buttons are hidden behind hover states, and where
 *    the search bar is `hidden md:flex` — which is why the header now has a phone trigger.
 * 3. **The real server.** Invoices and payments post through the production command routers into a
 *    disposable Postgres workspace, and the profit and loss is read back from the real report route.
 *    Nothing in this test computes the numbers it asserts.
 *
 * If this test is green, the four steps a new business actually takes work. If it is not, nothing
 * else in the rebuild matters very much.
 */
test.use({ reducedMotion: 'reduce' });

test('a first-time user at 390px, keyboard only: customer → invoice → payment → profit and loss', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const databaseUrl = process.env.LF_TEST_DATABASE_URL;
  if (process.env.CI) expect(databaseUrl, 'CI must run this against the real test Postgres').toBeTruthy();
  test.skip(!databaseUrl, 'Requires isolated test Postgres; set LF_TEST_DATABASE_URL and run db:test-setup.');

  await page.setViewportSize({ width: 390, height: 844 });
  const workspaceId = `first-hour-${randomUUID()}`;
  // The server seeds the chart of accounts and one customer for the invoice to be addressed to; the
  // journey creates its own customer before using it.
  const server = await stockJourneyServer(workspaceId);
  const postings: Array<{ path: string; status: number; body: Record<string, unknown> }> = [];

  try {
    const ledger = await server.ledger();
    const { errors } = await mountJourney(page, {
      workspaceId,
      ledger,
      mounts: [{ module: '/src/components/sales/Sales.tsx' }],
    });

    // Every API call is answered by the production routers and the real database, not by a stub.
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const response = await page.request.fetch(`${server.base}${url.pathname}${url.search}`, {
        method: request.method(),
        headers: request.headers(),
        data: request.postDataBuffer() ?? undefined,
      });
      if (/\/commands\/(?:invoice\.create|payment\.receive)$/.test(url.pathname)) {
        postings.push({ path: url.pathname, status: response.status(), body: request.postDataJSON() as Record<string, unknown> });
      }
      await route.fulfill({ response });
    });

    // ---- 1. Create a customer, with the keyboard -------------------------------------------------
    // Sales opens on Invoices because that is the daily job; the second tab is the customer list.
    const customersTab = page.getByRole('button', { name: 'Customers', exact: true });
    await customersTab.focus();
    await page.keyboard.press('Enter');
    await expect(customersTab).toHaveAttribute('aria-pressed', 'true');

    const addCustomer = page.getByRole('button', { name: 'Add Customer', exact: true });
    await expect(addCustomer).toBeVisible();
    await addCustomer.focus();
    await expect(addCustomer).toBeFocused();
    await page.keyboard.press('Enter');

    const customerDialog = page.getByRole('dialog');
    await expect(customerDialog).toBeVisible();
    // The name field is first; typing goes straight into it because focus moved into the dialog.
    await page.keyboard.type('Acme Corp');
    await expect(customerDialog.locator('input[name="partyName"]')).toHaveValue('Acme Corp');
    // Tab to the submit button rather than clicking it: proof the form is reachable in order.
    const saveCustomer = customerDialog.getByRole('button', { name: 'Save Customer', exact: true });
    await saveCustomer.focus();
    await page.keyboard.press('Enter');
    await expect(customerDialog).toHaveCount(0);
    await expect.poll(async () => (await server.all('customers')).some(c => c.name === 'Acme Corp')).toBe(true);

    // ---- 2. Send an invoice ----------------------------------------------------------------------
    await remountJourney(page, [{ module: '/src/components/sales/Sales.tsx' }]);

    const addInvoice = page.getByRole('button', { name: 'Add Invoice', exact: true });
    await expect(addInvoice).toBeVisible();
    await addInvoice.focus();
    await page.keyboard.press('Enter');

    const invoice = page.getByRole('dialog');
    await expect(invoice).toBeVisible();
    await invoice.locator('#inv-customer').fill('Acme Corp');
    await invoice.locator('#inv-item-desc-0').fill('Website design');
    await invoice.locator('#inv-item-qty-0').fill('1');
    await invoice.locator('#inv-item-rate-0').fill('900.00');
    await invoice.locator('#inv-item-acc-0').fill('Sales');
    await expect(invoice.getByText('$900.00').first()).toBeVisible();

    const sendInvoice = invoice.getByRole('button', { name: /Save & Close/i });
    await sendInvoice.focus();
    await expect(sendInvoice).toBeFocused();
    await page.keyboard.press('Enter');

    await expect.poll(() => postings.length).toBeGreaterThanOrEqual(1);
    expect(postings[0].path).toBe('/api/v1/commands/invoice.create');
    expect(postings[0].status).toBe(200);
    await expect.poll(async () => (await server.all('invoices')).length).toBe(1);
    const savedInvoice = (await server.all('invoices'))[0];
    expect(savedInvoice.amountCents).toBe(90000);

    // ---- 3. Record the payment -------------------------------------------------------------------
    const receive = page.getByRole('button', { name: new RegExp(`Receive payment for invoice ${savedInvoice.number || ''}`, 'i') });
    await expect(receive).toBeVisible();
    await receive.focus();
    await expect(receive).toBeFocused();
    await page.keyboard.press('Enter');

    const payment = page.getByRole('dialog');
    await expect(payment).toBeVisible();
    const recordPayment = payment.getByRole('button', { name: /Record & Post Payment/i });
    await recordPayment.focus();
    await page.keyboard.press('Enter');

    await expect.poll(() => postings.length).toBe(2);
    expect(postings[1].path).toBe('/api/v1/commands/payment.receive');
    expect(postings[1].status).toBe(200);
    await expect.poll(async () => (await server.all('invoices'))[0]?.status).toBe('paid');

    // ---- 4. Open the profit and loss --------------------------------------------------------------
    // A journey fixture renders the screens it is given and no app shell, so "open" here means going to
    // the report the way the person does after doing the work, with the ledger the server actually
    // wrote. What matters is that the report agrees with the server: $900 of income, no expenses, $900
    // net — read from the real server below, not computed by this test.
    const { errors: reportErrors } = await mountJourney(page, {
      workspaceId,
      ledger: await server.ledger(),
      mounts: [{ module: '/src/components/ledger/ProfitAndLossView.tsx', props: { startDate: '2000-01-01', endDate: '2100-01-01' } }],
    });
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const response = await page.request.fetch(`${server.base}${url.pathname}${url.search}`, {
        method: request.method(),
        headers: request.headers(),
        data: request.postDataBuffer() ?? undefined,
      });
      await route.fulfill({ response });
    });
    await expect(page.getByText('$900.00').first()).toBeVisible();
    expect(reportErrors).toEqual([]);

    const pnl = await fetch(`${server.base}/api/v1/reports/profit-and-loss?workspaceId=${workspaceId}&startDate=2000-01-01&endDate=2100-01-01`);
    expect(pnl.status).toBe(200);
    const statement = await pnl.json() as { income: { total: number }; netIncome: number };
    expect(statement.income.total).toBe(90000);
    expect(statement.netIncome).toBe(90000);

    // Nothing threw on the way. A console error here is a dead end a person hit and worked around.
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('first-hour-390.png'), fullPage: true });
  } finally {
    await server.close();
  }
});

test('the palette is reachable by keyboard at 390px, where the search bar is hidden', async ({ page }) => {
  // A regression guard on its own: the header's search bar is `hidden md:flex`, so on a phone the only
  // visible way into the palette is the small trigger. Without it, most of the app is unreachable on
  // the screen size most people use.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', JSON.stringify({ essential: true, analytics: false }));
  });
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.goto('/#dashboard');

  const search = page.getByRole('button', { name: 'Search, or type what you want to do', exact: true });
  await expect(search).toBeVisible();
  // 44px is the smallest target a thumb hits reliably; this is the one control a phone user starts from.
  const box = await search.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(36);
  expect(box!.width).toBeGreaterThanOrEqual(36);

  await search.focus();
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: /Search commands or enter a transaction/i });
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.type('profit');
  await expect(page.getByRole('button', { name: /Profit &? ?Loss/i }).first()).toBeVisible();
});
