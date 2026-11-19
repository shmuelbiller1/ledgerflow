import { test, expect } from '@playwright/test';
import { mountJourney, remountJourney, captured, settleStyles, JOURNEY_USER as USER } from './support/journeyFixture';

/**
 * AI12-N8: the first invoice, walked exactly the way a new owner meets it.
 *
 * The gap this closes: each screen already had its own spec (the wizard saves, the invoice form
 * validates, the guide navigates, the checklist renders), but nothing checked that the four of them
 * form one path — set the books up, write the first invoice, and see the product notice it. Two
 * things can break only across that seam:
 *
 * - the first-hour guide and the first-week checklist count a step as done from what is *in the
 *   books* (an invoice exists, a customer exists), not from what a spec clicked, so a walk-through
 *   that creates an invoice has to move their counters; and
 * - the numbers the owner reads on the two screens afterwards (the invoice total, the checklist's
 *   "1 of 5") have to be the numbers they just entered.
 *
 * Worked figures, checked by hand: 2 × $120.50 = $241.00, no tax on this workspace, so the invoice
 * is $241.00 and it is not paid — the checklist's bank and payment steps stay open.
 *
 * Honest scope: the journey harness stubs the request boundary (that is the same boundary the other
 * first-run specs use), so this proves the browser path and the figures the screens show, not a live
 * database write. Store reads that feed the counters are the app's own.
 */

const WORKSPACE = 'n8-first-invoice';
/** The chart a new workspace gets before its first invoice: one bank account, one income account. */
const ACCOUNTS = [
  { id: 'cash', uid: USER.uid, workspaceId: WORKSPACE, code: '1000', name: 'Checking', type: 'asset', category: 'Cash' },
  { id: 'sales', uid: USER.uid, workspaceId: WORKSPACE, code: '4000', name: 'Sales', type: 'income', category: 'Revenue' },
];

/** Gitar/CodeRabbit aside, the invoice form's "Send Invoice" is the first save of a new draft here. */
const INVOICE_TOTAL = '$241.00';

for (const width of [390, 1280]) {
  test(`N-8 first invoice: set up the books, write invoice one, and the guide notices (${width}px)`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => Boolean(document.getElementById('root')?.childElementCount));

    // ---- 1. Set the books up: the wizard's business step, saved the way the app saves it.
    const setup = await mountJourney(page, {
      workspaceId: WORKSPACE,
      ledger: { accounts: ACCOUNTS },
      mounts: [{ module: '/src/components/onboarding/SetupWizard.tsx', props: { onStarted: '__fn:noop', onDone: '__capture:setup-done' } }],
      api: request => (request.url.endsWith('/apply-template') || request.url.endsWith('/setup-complete')
        ? { json: { status: 'success' } }
        : null),
    });
    await page.route('**/api/v1/commands/workspace.settings**', route => route.fulfill({
      status: 200, json: { status: 'success', data: { changed: [], updatedAt: '2026-01-01T00:00:00Z' } },
    }));
    await page.route('**/api/v1/commands/workspace.dimensionaxes**', route => route.fulfill({
      status: 200, json: { status: 'success', data: { dimensions: [] } },
    }));

    await expect(page.getByRole('heading', { name: 'What kind of business?' })).toBeVisible();
    await page.getByLabel('Shop', { exact: true }).check();
    await page.getByLabel('Business name').fill('Northwind Workshop');
    await page.getByLabel('Financial year starts in').selectOption('1');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Chart of accounts' })).toBeVisible();
    await page.locator('#tpl-retail').check();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your books are set up' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to Overview', exact: true }).click();
    await expect.poll(() => captured(page, 'setup-done')).toHaveLength(1);
    expect(setup.errors, 'the setup walk raised no page error').toEqual([]);

    // ---- 2. Write the first invoice on the real form.
    const saved: Array<Record<string, unknown>> = [];
    await page.route('**/api/v1/commands/sales.invoice**', async route => {
      try { saved.push(route.request().postDataJSON() as never); } catch { /* asserted below */ }
      await route.fulfill({ status: 200, json: { status: 'success', data: { id: 'inv-1' } } });
    });
    await remountJourney(page, [{
      module: '/src/components/sales/InvoiceModal.tsx',
      props: { isOpen: true, customers: [], accounts: ACCOUNTS, onSave: '__capture:invoice' },
    }]);
    const form = page.getByRole('dialog', { name: 'New invoice', exact: true });
    await expect(form).toBeVisible();
    await settleStyles(page);
    await form.getByLabel('Customer', { exact: true }).fill('Acme Ltd');
    await page.locator('#inv-item-desc-0').fill('Sign painting');
    await page.locator('#inv-item-qty-0').fill('2');
    await page.locator('#inv-item-rate-0').fill('120.50');
    // The total the owner reads before saving is the total the books get.
    await expect(form.getByLabel('Invoice totals').getByText(INVOICE_TOTAL)).toBeVisible();
    await testInfo.attach(`first-invoice-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

    // Send Invoice is the first save of a new draft: it sets the status to 'sent', which is what the
    // first-week checklist counts as an issued invoice.
    await form.getByRole('button', { name: 'Send Invoice', exact: true }).click();
    await expect.poll(() => captured(page, 'invoice').then(rows => rows.length)).toBe(1);
    const written = (await captured(page, 'invoice'))[0][0] as {
      customerName?: string; amountCents?: number; status?: string;
      items?: Array<{ description?: string; quantity?: number; rateCents?: number }>;
    };
    expect(written.customerName).toBe('Acme Ltd');
    expect(written.amountCents).toBe(24100);
    expect(written.status).toBe('sent');
    expect(written.items?.[0]).toMatchObject({ description: 'Sign painting', quantity: 2, rateCents: 12050 });

    // ---- 3. The guide and the checklist notice the invoice, from the books rather than from a click.
    const books = await mountJourney(page, {
      workspaceId: WORKSPACE,
      ledger: {
        accounts: ACCOUNTS,
        customers: [{ id: 'cust-acme', uid: USER.uid, workspaceId: WORKSPACE, name: 'Acme Ltd', email: 'ap@acme.test' }],
        invoices: [{
          id: 'inv-1', uid: USER.uid, workspaceId: WORKSPACE, number: 'INV-0001', customerId: 'cust-acme',
          customerName: 'Acme Ltd', date: '2026-02-02', dueDate: '2026-03-04', status: 'sent',
          amountCents: 24100, amountPaidCents: 0, currency: 'USD',
        }],
        payments: [],
      },
      mounts: [
        { module: '/src/components/onboarding/FirstHourGuide.tsx' },
        { module: '/src/components/dashboard/FirstWeekChecklist.tsx' },
      ],
    });

    const guide = page.getByRole('region', { name: 'First-hour bookkeeping guide' });
    await expect(guide).toBeVisible();
    // The guide is a navigation list, not a scoreboard: it marks nothing complete (its own words say
    // so), so what matters here is that it still offers all eight steps beside the new books.
    await expect(guide.getByRole('listitem')).toHaveCount(8);

    // The checklist is the part that reads the books. With a bank account, a customer and one sent
    // invoice — and no payment — three of its five steps are done and two are open.
    const checklist = page.getByRole('region', { name: 'Your first week' });
    await expect(checklist).toBeVisible();
    await expect(checklist.getByText('3 of 5 steps complete')).toBeVisible();
    for (const title of ['Add a bank account', 'Add a customer', 'Send your first invoice', 'Record a customer payment']) {
      await expect(checklist.getByText(title)).toBeVisible();
    }
    // 390 px: nothing is pushed off the side of the phone by the longer first sentence.
    for (const button of await checklist.getByRole('button').all()) {
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.height, 'a checklist control a thumb has to hit is 44 px').toBeGreaterThanOrEqual(44);
      expect(box.x + box.width, 'a control stays inside the viewport').toBeLessThanOrEqual(width + 1);
    }
    await testInfo.attach(`first-day-overview-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(books.errors).toEqual([]);
    expect(saved).toEqual([]); // the invoice was saved through the screen's own callback, not a command
  });
}
