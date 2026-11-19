import { test, expect, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mountJourney, remountJourney } from './support/journeyFixture';
import { stockJourneyServer } from './support/stockJourneyServer';
import { tabTo } from './support/tabTo';
import { MINIMAL_INVOICE_PDF_BASE64 } from './helpers/pdfStub';

// Signed-in workspace with an isolated Postgres database. No focus shortcuts, synthetic tab changes
// or direct report mounts. Fixture refreshes represent subscription snapshots, not financial writes.
// Email goes through the production route to the test transport, never a real recipient.
test.use({ reducedMotion: 'reduce', timezoneId: 'UTC' });
for (const width of [390, 1280]) test(`a first-time user at ${width}px, keyboard only: customer → invoice → preview → payment → profit and loss`, async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const databaseUrl = process.env.LF_TEST_DATABASE_URL;
  if (process.env.CI) expect(databaseUrl, 'CI must run this against the real test Postgres').toBeTruthy();
  test.skip(!databaseUrl, 'Requires isolated test Postgres; set LF_TEST_DATABASE_URL and run db:test-setup.');
  await page.setViewportSize({ width, height: 844 });
  await page.clock.setFixedTime(new Date('2026-04-15T12:00:00Z'));
  const workspaceId = `first-hour-${randomUUID()}`;
  const customerName = 'Acme Corp', recipient = `first-hour-${width}@example.test`;
  const server = await stockJourneyServer(workspaceId);
  try {
    const { errors } = await mountJourney(page, { workspaceId, ledger: await server.ledger(), mounts: [] });
    await page.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url());
      const response = await page.request.fetch(`${server.base}${url.pathname}${url.search}`, {
        method: req.method(), headers: req.headers(), data: req.postDataBuffer() ?? undefined,
      });
      await route.fulfill({ response });
    });
    // App normally supplies the full-height shell and initial responsive sidebar state before
    // mounting RootLayout. Set those once; all subsequent navigation happens through its UI.
    await page.evaluate(async () => {
      const { useUIStore } = await import('/src/stores/useUIStore.ts');
      useUIStore.getState().setSidebarOpen(innerWidth >= 1024);
      document.getElementById('root')!.classList.add('h-[100dvh]', 'w-full', 'overflow-hidden', 'flex', 'flex-col');
    });
    await remountJourney(page, [{ module: '/src/core/layout/RootLayout.tsx', exportName: 'RootLayout' }]);
    const button = (name: string | RegExp, root: Locator = page.locator('body')) => root.getByRole('button', { name, exact: true });
    const press = async (target: Locator, backwards = false) => {
      await tabTo(page, target, backwards); await page.keyboard.press('Enter');
    };
    const typeIn = async (target: Locator, value: string) => {
      await tabTo(page, target); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(value);
      await expect(target).toHaveValue(value);
    };
    const submit = async (control: Locator, path: string) => {
      await tabTo(page, control);
      const [reply] = await Promise.all([
        page.waitForResponse(res => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith(path)),
        page.keyboard.press('Enter'),
      ]);
      expect(reply.status(), path).toBe(200);
      return reply;
    };
    const main = page.locator('#main-content'), dialog = page.getByRole('dialog');
    const daily = page.getByRole('navigation', { name: 'Daily tools' });
    // N-8 starts on a fresh Sales screen: the journey fixture seeds a sample "Acme" customer,
    // but the customer this journey creates is not there and there are no invoices to open.
    expect((await server.all('customers')).some(c => c.name === customerName), `${customerName} is not there yet`).toBe(false);
    expect(await server.all('invoices'), 'a new workspace starts with no invoices').toEqual([]);
    if (width === 390) await press(button('Open navigation menu'));
    await press(button('Sales', daily));
    if (width === 390) await expect(daily, 'the chosen page must not be obscured by the phone navigation').toBeHidden();
    else await expect(daily).toBeVisible();
    await press(button('Customers', main));
    await press(button('Add Customer', main));
    await expect(dialog.locator('[name="partyName"]')).toBeFocused();
    await page.keyboard.type(customerName);
    await typeIn(dialog.getByLabel('Email Address'), recipient);
    await submit(button('Save Customer', dialog), '/commands/customer.create');
    await expect(dialog).toHaveCount(0);
    const customers = (await server.all('customers')).filter(c => c.name === customerName);
    expect(customers).toMatchObject([{ email: recipient }]);
    await server.refresh(page);

    await press(button('Invoices', main));
    await submit(button('Add Invoice', main), '/next-number');
    await typeIn(dialog.locator('#inv-customer'), customerName);
    await press(dialog.locator('summary'));
    await typeIn(dialog.locator('#inv-number'), 'INV-FIRST');
    await expect(dialog.locator('#inv-date')).toHaveValue('2026-04-15');
    await typeIn(dialog.locator('#inv-item-desc-0'), 'Website design');
    await typeIn(dialog.locator('#inv-item-rate-0'), '900');
    await typeIn(dialog.locator('#inv-item-acc-0'), 'Sales');
    await expect(dialog.getByText('$900.00').first()).toBeVisible();
    await submit(button(/Save & Close/i, dialog), '/commands/invoice.create');
    await expect(dialog).toHaveCount(0);
    const invoices = await server.all('invoices');
    expect(invoices).toMatchObject([{ number: 'INV-FIRST', customerId: customers[0].id, amountCents: 90000 }]);
    expect(await server.mail(), 'issuing an invoice is not the same as emailing it').toEqual([]);
    await server.refresh(page);

    // N-8: the new invoice can be looked at before it is sent. The preview is opened from the
    // row's own action, asks for this document as a preview, shows a loaded PDF and closes again.
    // PDF rendering itself is not this journey's subject (print-styles.spec.ts covers it and the
    // email step below generates a real one), so the request boundary is stubbed as in the other
    // first-run specs. This route is registered after the catch-all, so it takes precedence.
    let pdfRequest = '';
    await page.route('**/api/v1/documents/invoice/*/pdf*', async route => {
      pdfRequest = route.request().url();
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from(MINIMAL_INVOICE_PDF_BASE64, 'base64') });
    });
    const invoiceRow = main.getByRole('row').filter({ hasText: 'INV-FIRST' }).first();
    await expect(invoiceRow).toBeVisible();
    await press(invoiceRow.getByRole('button', { name: 'Preview PDF', exact: true }));
    const preview = page.getByRole('dialog', { name: /Invoice INV-FIRST/ });
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview.getByText('invoice_INV-FIRST.pdf')).toBeVisible();
    await expect(preview.locator('iframe')).toBeVisible({ timeout: 30_000 });
    await expect(preview.getByText('Unable to render PDF')).toHaveCount(0);
    expect(pdfRequest, 'the preview must ask for this invoice, not a download').toContain(`/invoice/${invoices[0].id}/pdf`);
    expect(pdfRequest).toContain('preview=1');
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await page.unroute('**/api/v1/documents/invoice/*/pdf*');
    await server.refresh(page);

    await press(button('Email the invoice', main));
    await expect(dialog.getByLabel('To', { exact: true })).toHaveValue(recipient);
    await expect(dialog.getByLabel('Email', { exact: true })).toHaveValue('invoice');
    await submit(button('Send', dialog), `/emails/invoices/${invoices[0].id}`);
    await expect(dialog.getByText(`Sent · ${recipient}`, { exact: true })).toBeVisible();
    expect(await server.mail()).toEqual([{ to: recipient, subject: expect.stringContaining('INV-FIRST'), pdfNames: ['invoice_INV-FIRST.pdf'] }]);
    expect((await server.all('invoices'))[0].metadata?.sendCount).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await server.refresh(page);

    await press(button('Receive payment for invoice INV-FIRST', main));
    const receipt = await submit(button('Record & Post Payment', dialog), '/api/v1/payments');
    expect(receipt.request().postDataJSON()).toMatchObject({
      workspaceId, amountCents: 90000, allocations: [{ documentId: invoices[0].id, amountCents: 90000 }],
    });
    await expect(dialog).toHaveCount(0);
    expect((await server.all('invoices'))[0].status).toBe('paid');
    await server.refresh(page);

    await tabTo(page, button('Reports', width === 390 ? page.getByRole('navigation', { name: 'Phone navigation' }) : daily));
    const [pnl] = await Promise.all([
      page.waitForResponse(res => new URL(res.url()).pathname === '/api/v1/reports/profit-and-loss' && res.request().method() === 'GET'),
      page.keyboard.press('Enter'),
    ]);
    await expect(main.getByRole('heading', { name: /Profit & Loss/i }).first()).toBeVisible();
    expect(pnl.status()).toBe(200);
    expect(await pnl.json()).toMatchObject({ income: { total: 90000 }, netIncome: 90000 });
    await expect(main.getByText('$900.00', { exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`first-hour-${width}.png`), fullPage: true });
  } finally { await server.close(); }
});
