import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * G-24 — W1 first-hour journey test (RELEASE_GATE W1, P2-1):
 * sign up → company details → chart of accounts → first invoice → first report.
 *
 * The journey uses the app's own stores with stubbed request boundaries, so this is a
 * browser test of the screens a new user reaches — not of a live database or auth
 * provider. Sign-up itself is represented by the signed-in state the app sees after a
 * successful sign-up (the auth provider is not under test here).
 *
 * Test 1 drives the real SetupWizard: business details → chart template →
 * done and the "Create the first invoice" handoff, then the optional opening-balance editor.
 * Test 2 drives the real InvoiceModal for the first invoice (worked figures below)
 * and then the customer statement report for that invoice.
 *
 * Worked figures (USD, whole cents):
 *   Opening balances: Business Checking +$5,000.00 = 500000 cents
 *     → debits 500000 = credits 500000, $5,000.00 to Opening Balance Equity
 *   First invoice: 2 × $150.00 Website design = $300.00 = 30000 cents, no tax,
 *     sent to Acme Corp → customer statement shows $300.00 outstanding.
 *
 * Nothing here writes to a database: every API and REST request is fulfilled by the test.
 */

const WORKSPACE = 'w1-first-hour';
const USER = { uid: 'w1-user', email: 'w1@example.test', displayName: 'First Hour' };

async function shell(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : {} }));
  await page.route('**/w1-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="en" class="light"><head><title>W1 journey</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div></body></html>',
  }));
  // Load the ordinary entry once so a fresh Vite cache has React's client module (as the other fixture specs do).
  await page.goto('/');
  await page.waitForFunction(() => Boolean(document.querySelector('#root')?.childElementCount));
  await page.goto('/w1-fixture');
  // Components are imported straight into the fixture page: install the React refresh preamble first.
  await page.evaluate(async () => {
    const refresh = await import('/@react-refresh'); refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
  });
  return { errors };
}

/** The signed-in state the app sees right after sign-up: an owner with a fresh workspace. */
async function seedSignedUp(page: Page, workspaceName: string) {
  await page.evaluate(async ({ workspaceId, workspaceName, user }) => {
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    // The wizard compares the form timezone with the stored one; using the same
    // device value keeps "company details" a no-change save in the fixture.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const signedIn = { ...user, isAnonymous: false, getIdToken: async () => 'browser-fixture-token' };
    const workspace = {
      id: workspaceId, uid: user.uid, name: workspaceName, currency: 'USD',
      fiscalYearStartMonth: 1, timezone: tz,
      roles: { [user.uid]: 'owner' },
    };
    useAuthStore.setState({ user: signedIn, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [workspace] } as never);
  }, { workspaceId: WORKSPACE, workspaceName, user: USER });
}

async function expectFits(page: Page, selector: string, label: string) {
  const fits = await page.locator(selector).evaluate(el => ({ w: (el as HTMLElement).clientWidth, s: (el as HTMLElement).scrollWidth }));
  expect(fits.s, `${label} overflows on a phone`).toBeLessThanOrEqual(fits.w);
}

async function expectNoSeriousAxe(page: Page, selector: string, attachName: string, testInfo: object) {
  const axe = await new AxeBuilder({ page }).include(selector).analyze();
  const serious = axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  await (testInfo as { attach: (n: string, o: object) => Promise<void> }).attach(attachName, { body: JSON.stringify(axe.violations, null, 2), contentType: 'application/json' });
  expect(serious, JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
}

test('G-24 W1: setup wizard — business → chart template → done, then optional opening balances and first invoice', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await shell(page);

  // The wizard's server calls, recorded; opening balances echo the posted figures.
  const apiCalls: Array<{ url: string; method: string; body: unknown }> = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = request.url();
    const body = (() => { try { return request.postDataJSON(); } catch { return null; } })();
    apiCalls.push({ url, method: request.method(), body });
    if (request.method() === 'POST' && url.includes('/opening-balances')) {
      const balances = ((body as { balances?: Array<{ amountCents: number }> } | null)?.balances) || [];
      const debits = balances.reduce((sum, b) => sum + (b.amountCents || 0), 0);
      return route.fulfill({ json: { debitsCents: debits, equityCents: debits } });
    }
    return route.fulfill({ json: {} });
  });

  await seedSignedUp(page, 'Hour One Books');
  await page.evaluate(async ({ workspaceId, user }) => {
    const [{ default: React }, { default: { createRoot } }, { useLedgerStore }, { useDataNeedsStore }, { default: SetupWizard }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/stores/useLedgerStore.ts'),
      import('/src/stores/useDataNeedsStore.ts'),
      import('/src/components/onboarding/SetupWizard.tsx'),
    ]);
    const accounts = [
      { id: 'bank-1000', uid: user.uid, workspaceId, code: '1000', name: 'Business Checking', type: 'asset', category: 'Cash' },
      { id: 'ar-1200', uid: user.uid, workspaceId, code: '1200', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' },
      { id: 'eq-3200', uid: user.uid, workspaceId, code: '3200', name: 'Opening Balance Equity', type: 'equity', category: 'Equity' },
    ];
    useLedgerStore.setState({ accounts, transactions: [], bankLines: [], invoices: [], bills: [], truncatedCollections: {}, baseCurrency: 'USD' } as never);
    useDataNeedsStore.setState({ loaded: { accounts: true }, loadedWorkspaceId: workspaceId, failed: {} } as never);
    (window as unknown as { __wizardDone: boolean }).__wizardDone = false;
    const root = createRoot(document.getElementById('root')!);
    (window as unknown as { __setupRoot: typeof root }).__setupRoot = root;
    root.render(
      React.createElement(SetupWizard, {
        onStarted: () => {},
        onDone: () => { (window as unknown as { __wizardDone: boolean }).__wizardDone = true; },
      }),
    );
  }, { workspaceId: WORKSPACE, user: USER });

  // Step 1 of 4 — company details: pre-filled, editable, Next moves on.
  await expect(page.getByRole('heading', { name: 'Set up your books' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What kind of business?' })).toBeVisible();
  await page.getByLabel('Services', { exact: true }).check();
  await expect(page.locator('#setup-name')).toHaveValue('Hour One Books');
  await expect(page.locator('#setup-currency')).toHaveValue('USD');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Step 2 of 4 — chart of accounts: the workspace accounts are named, a template is picked.
  await expect(page.getByRole('heading', { name: 'Chart of accounts' })).toBeVisible();
  await expect(page.getByText(/This workspace has 3 accounts/)).toBeVisible();
  await page.locator('label', { hasText: 'Creative Project' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const applyCall = apiCalls.find(c => c.url.includes('/apply-template'));
  expect(applyCall?.method).toBe('POST');
  expect((applyCall?.body as { templateId?: string } | null)?.templateId).toBe('creative');

  await expect(page.getByRole('heading', { name: 'Your books are set up' })).toBeVisible();
  await page.getByRole('button', { name: 'Create the first invoice' }).click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __wizardDone: boolean }).__wizardDone)).toBe(true);
  const tab = await page.evaluate(async () => (await import('/src/stores/useUIStore.ts')).useUIStore.getState().activeTab);
  expect(tab).toBe('sales');

  // Migration figures are optional after setup, using the original endpoint and worked figures.
  await page.evaluate(async () => {
    const [{ default: React }, { default: OpeningBalancesSetup }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'), import('/src/components/onboarding/OpeningBalancesSetup.tsx'),
    ]);
    (window as unknown as { __setupRoot: { render: (el: unknown) => void } }).__setupRoot.render(
      React.createElement('main', null, React.createElement(OpeningBalancesSetup, { onClose: () => {} })),
    );
  });
  // Step 3 of 4 — opening balances: the balance previews balanced before recording.
  await expect(page.getByRole('heading', { name: 'Opening balances' })).toBeVisible();
  await page.locator('#ob-bank-1000').fill('5000');
  await expect(page.getByText(/Debits \$5,000\.00 = credits \$5,000\.00/)).toBeVisible();
  await page.getByRole('button', { name: 'Record opening balances' }).click();
  const balancesCall = apiCalls.find(c => c.url.includes('/opening-balances'));
  expect(balancesCall?.method).toBe('POST');
  expect((balancesCall?.body as { balances?: unknown } | null)?.balances).toEqual([{ accountId: 'bank-1000', amountCents: 500000 }]);

  await expect(page.getByText(/debits and credits are both \$5,000\.00/)).toBeVisible();

  await expectFits(page, 'main', 'setup wizard');
  await expectNoSeriousAxe(page, 'main', 'w1-wizard-axe', testInfo);
  expect(errors).toEqual([]);
});

test('G-24 W1: first invoice through the invoice form, then the customer statement shows it', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await shell(page);
  await page.route('**/api/**', route => route.fulfill({ json: {} }));

  await seedSignedUp(page, 'Hour One Books');
  await page.evaluate(async ({ workspaceId, user }) => {
    const [{ default: React }, { default: { createRoot } }, { useLedgerStore }, { useDataNeedsStore }, { default: InvoiceModal }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/stores/useLedgerStore.ts'),
      import('/src/stores/useDataNeedsStore.ts'),
      import('/src/components/sales/InvoiceModal.tsx'),
    ]);
    const accounts = [
      { id: 'bank-1000', uid: user.uid, workspaceId, code: '1000', name: 'Business Checking', type: 'asset', category: 'Cash' },
      { id: 'inc-4000', uid: user.uid, workspaceId, code: '4000', name: 'Consulting Revenue', type: 'income', category: 'Revenue' },
    ];
    const customers = [{ id: 'c1', workspaceId, name: 'Acme Corp', email: 'ap@acme.test' }];
    useLedgerStore.setState({
      accounts, customers, vendors: [], invoices: [], payments: [], transactions: [], bankLines: [],
      truncatedCollections: {}, baseCurrency: 'USD',
    } as never);
    useDataNeedsStore.setState({
      loaded: { accounts: true, customers: true, inventory: true, invoices: true, payments: true },
      loadedWorkspaceId: workspaceId, failed: {},
    } as never);
    const w = window as unknown as { __savedInvoice: unknown; __root: { render: (el: unknown) => void } };
    w.__savedInvoice = null;
    w.__root = createRoot(document.getElementById('root')!);
    w.__root.render(
      React.createElement(InvoiceModal, {
        isOpen: true,
        onClose: () => {},
        onSave: (inv: unknown) => { w.__savedInvoice = inv; },
        customers,
        accounts,
      }),
    );
  }, { workspaceId: WORKSPACE, user: USER });

  // The first invoice, filled the way a new user would: customer, one line, income account.
  await expect(page.getByRole('heading', { name: 'New invoice' })).toBeVisible();
  await page.locator('#inv-customer').fill('Acme Corp');
  await page.locator('#inv-item-desc-0').fill('Website design');
  await page.locator('#inv-item-qty-0').fill('2');
  await page.locator('#inv-item-rate-0').fill('150');
  await page.locator('#inv-item-acc-0').fill('Consulting Revenue');
  await expect(page.getByText('$300.00').first()).toBeVisible();
  await page.getByRole('button', { name: 'Send Invoice' }).click();

  await expect.poll(async () => page.evaluate(() => (window as unknown as { __savedInvoice: unknown }).__savedInvoice !== null)).toBe(true);
  const saved = await page.evaluate(() => (window as unknown as { __savedInvoice: {
    customerId?: string; customerName?: string; amountCents?: number; status?: string; number?: string;
  } }).__savedInvoice);
  expect(saved.customerId).toBe('c1');
  expect(saved.amountCents).toBe(30000);
  expect(saved.status).toBe('sent');

  // The first report: the customer statement for the invoice's month shows it outstanding.
  const { startDate, endDate } = await page.evaluate(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return { startDate: `${ym}-01`, endDate: `${ym}-${String(now.getDate()).padStart(2, '0')}` };
  });
  await page.evaluate(async ({ workspaceId, startDate, endDate, saved }) => {
    const [{ default: React }, { useLedgerStore }, { default: StatementView }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/src/stores/useLedgerStore.ts'),
      import('/src/components/reporting/StatementView.tsx'),
    ]);
    const w = window as unknown as { __root: { render: (el: unknown) => void } };
    useLedgerStore.setState({
      invoices: [{ ...saved, id: 'inv-w1-1', workspaceId, amountPaidCents: 0 }],
    } as never);
    w.__root.render(React.createElement(StatementView, { startDate, endDate }));
  }, { workspaceId: WORKSPACE, startDate, endDate, saved });

  await expect(page.getByRole('heading', { name: 'Account Statement' })).toBeVisible();
  await expect(page.getByText('Acme Corp').locator('visible=true').first()).toBeVisible();
  await expect(page.getByText('$300.00').first()).toBeVisible();
  const table = page.locator('table');
  await expect(table).toContainText(saved.number || 'INV-');
  await expect(table).toContainText('Invoice');

  await expectFits(page, 'table', 'W1 statement table');
  await expectNoSeriousAxe(page, 'table', 'w1-statement-axe', testInfo);
  expect(errors).toEqual([]);
});
