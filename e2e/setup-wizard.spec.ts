import { test, expect } from '@playwright/test';
import { mountJourney, remountJourney, captured } from './support/journeyFixture';
import { BUSINESS_TEMPLATES } from '../src/lib/businessTemplates';

/**
 * A-234 browser leg: the set-up wizard (Business type → Chart of accounts → Done, then optional opening balances) in a real browser, saving at every step, then re-opened on what the server kept.
 *
 * It guards the first-run save bug fixed on 27 Oct by migration
 * `20261027000000_server_fields_allowed`: the wizard's workspace write must carry every allowlisted
 * field (`name`, `currency`, `timezone`, `fiscalYearStartMonth`, `fiscalYearStartDay`) — if the
 * wizard stops sending one, or the step stops going through the `workspace.settings` command, this
 * fails here even though the component suite (`setup-wizard-journey.test.tsx`) checks the same walk
 * in jsdom.
 *
 * Honest scope: the database boundary is the journey harness's stub (plus a capture route for the
 * `workspace.settings` command), so this proves the browser walk and the exact writes the screen
 * sends. That a live Supabase row keeps them is proven by the RLS/database suites and the 27 Oct
 * migration tests, not by this spec.
 */

const WORKSPACE = 'setup-wizard-browser';
const ACCOUNTS = [
  { id: 'cash', uid: 'journey-user', workspaceId: WORKSPACE, code: '1000', name: 'Checking', type: 'asset', category: 'Cash' },
  { id: 'loan', uid: 'journey-user', workspaceId: WORKSPACE, code: '2000', name: 'Bank Loan', type: 'liability', category: 'Long-term' },
  { id: 'ar', uid: 'journey-user', workspaceId: WORKSPACE, code: '1100', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' },
  { id: 'obe', uid: 'journey-user', workspaceId: WORKSPACE, code: '3000', name: 'Opening Balance Equity', type: 'equity', category: 'Equity' },
];
const WIZARD = { module: '/src/components/onboarding/SetupWizard.tsx', props: { onStarted: '__fn:noop', onDone: '__capture:done' } };

test('A-234 browser: the set-up wizard saves every step and re-opens on the saved values', async ({ page }) => {
  test.setTimeout(120_000);
  page.on('dialog', (d) => { void d.accept(); });
  await page.setViewportSize({ width: 1280, height: 900 });

  const { errors, requests } = await mountJourney(page, {
    workspaceId: WORKSPACE,
    ledger: { accounts: ACCOUNTS },
    mounts: [WIZARD],
    api: (request) => {
      if (request.url.endsWith('/opening-balances')) {
        return { json: { status: 'success', debitsCents: 100000, equityCents: 70000 } };
      }
      if (request.url.endsWith('/apply-template') || request.url.endsWith('/setup-complete')) {
        return { json: { status: 'success' } };
      }
      return null;
    },
  });

  // Capture the settings command itself (registered after the harness's broad stub, so Playwright runs
  // this handler first for this request). The row patch the wizard used to send is that command now.
  const settingsWrites: Array<{ workspaceId?: string; input?: Record<string, unknown> }> = [];
  await page.route('**/api/v1/commands/workspace.settings**', async (route) => {
    try { settingsWrites.push(route.request().postDataJSON() as never); } catch { /* asserted below */ }
    await route.fulfill({ status: 200, json: { status: 'success', data: { changed: [], updatedAt: '2026-01-01T00:00:00Z' } } });
  });
  await page.route('**/api/v1/commands/workspace.dimensionaxes**', async (route) => {
    await route.fulfill({ status: 200, json: { status: 'success', data: { dimensions: [] } } });
  });

  // ---- Step 1, “Your business”
  await expect(page.getByRole('heading', { name: 'What kind of business?' })).toBeVisible();
  await page.getByLabel('Services', { exact: true }).check();
  await page.getByLabel('Business name').fill('Northwind Ltd');
  await page.getByLabel('Home currency').selectOption('GBP');
  await page.getByLabel('Financial year starts in').selectOption('4');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await expect.poll(() => settingsWrites.length, { message: 'the business step wrote the workspace row' }).toBeGreaterThan(0);
  const write = settingsWrites[0];
  expect(write.workspaceId).toBe(WORKSPACE);
  const written = write.input ?? {};
  for (const field of ['name', 'currency', 'timezone', 'fiscalYearStartMonth', 'fiscalYearStartDay']) {
    expect(field in written, `the wizard sends ${field} (the server allowlist has to keep it)`).toBe(true);
  }
  expect(written.name).toBe('Northwind Ltd');
  expect(written.currency).toBe('GBP');
  expect(written.fiscalYearStartMonth).toBe(4);
  expect(written.fiscalYearStartDay).toBe(1);
  expect(typeof written.timezone).toBe('string');
  expect(String(written.timezone).length).toBeGreaterThan(0);

  // ---- Step 2, “Chart of accounts”: the chosen template is applied on the server
  await expect(page.getByRole('heading', { name: 'Chart of accounts' })).toBeVisible();
  const template = Object.values(BUSINESS_TEMPLATES)[0];
  expect(template, 'a starter template exists').toBeTruthy();
  await page.locator(`#tpl-${template.id}`).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await expect.poll(
    () => requests.filter((r) => r.url.endsWith('/apply-template')).length,
    { message: 'the chart step was saved' },
  ).toBe(1);
  expect(requests.find((r) => r.url.endsWith('/apply-template'))?.body).toEqual({ templateId: template.id });

  // Setup is complete before optional migration figures are requested.
  await expect(page.getByRole('heading', { name: 'Your books are set up' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to Overview', exact: true }).click();
  await expect.poll(() => captured(page, 'done')).toHaveLength(1);
  await remountJourney(page, [{ module: '/src/components/onboarding/OpeningBalancesSetup.tsx', props: { onClose: '__fn:noop' } }]);
  // ---- Step 3, “Opening balances”: Checking 1,000.00 debit, Bank Loan 300.00 credit
  await expect(page.getByRole('heading', { name: 'Opening balances' })).toBeVisible();
  await page.getByLabel(/Checking/).fill('1000');
  await page.getByLabel(/Bank Loan/).fill('300');
  await expect(page.getByText(/Debits £1,000\.00 = credits £1,000\.00/)).toBeVisible();
  await page.getByRole('button', { name: 'Record opening balances', exact: true }).click();

  await expect.poll(
    () => requests.filter((r) => r.url.endsWith('/opening-balances')).length,
    { message: 'the opening balances were saved' },
  ).toBe(1);
  const balancesRequest = requests.find((r) => r.url.endsWith('/opening-balances'))?.body as {
    date: string; balances: Array<{ accountId: string; amountCents: number }>;
  };
  expect(balancesRequest.balances).toEqual([
    { accountId: 'cash', amountCents: 100000 },
    { accountId: 'loan', amountCents: 30000 },
  ]);
  expect(balancesRequest.date).toMatch(/^\d{4}-\d{2}-01$/);

  await expect(page.getByText(/debits and credits are both £1,000\.00/)).toBeVisible();

  // ---- Re-open the wizard fresh: it reads back what step 1 saved, not an empty form.
  await remountJourney(page, []);
  await expect(page.getByRole('heading', { name: 'Your books are set up' })).toHaveCount(0);
  await remountJourney(page, [WIZARD]);
  await expect(page.getByRole('heading', { name: 'What kind of business?' })).toBeVisible();
  await expect(page.getByLabel('Business name')).toHaveValue('Northwind Ltd');
  await expect(page.getByLabel('Home currency')).toHaveValue('GBP');
  await expect(page.getByLabel('Financial year starts in')).toHaveValue('4');
  await expect(page.getByLabel('Time zone')).toHaveValue(String(written.timezone));

  expect(errors).toEqual([]);
});
