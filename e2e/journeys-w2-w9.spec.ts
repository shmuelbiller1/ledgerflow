import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * F-41 … F-45 — Browser journey tests for RELEASE_GATE W2, W3, W4, W6, W9.
 *
 * Each journey mounts the screen a user reaches against the app's own stores and stubs only the
 * request boundary (database and server), so the browser test exercises the real component, its
 * calculations and its save request. Every figure below is hand-worked in the header comment of
 * its test; the assertions check those exact cents, the wiring (payment → statement, match →
 * reconciled, close → refused posting) and that the screen works on a phone.
 *
 * Worked numbers are referenced from:
 *   W2: statement-view.test.tsx / main-path.test.ts — invoice $1,000, payment $600, $400 left
 *   W3: bill $250, fully paid, $0 left
 *   W4: reconciliation-screen.test.tsx — 50,000 + −120,000, one match by hand
 *   W6: DEP-1 / sales-orders.test.tsx — 1,000 goods + 100 delivery = 1,100,
 *       25 % = 275 then rest 825, delivery billed once, a later part refused
 *   W9: period-close.test.ts / month-end-close-journey.spec.ts — September 2026 close/reopen
 *
 * Vite transforms every `.tsx` module with the React refresh runtime, which expects the preamble
 * that the app's index.html installs. A fixture page that mounts a screen itself must install the
 * same runtime first; without it the first import of a screen throws `$RefreshSig$ is not defined`.
 */

const WORKSPACE = 'journey-w2-w9';
const USER = { uid: 'journey-owner', email: 'owner@journeys.test', displayName: 'Journey Owner' };

async function installRefreshRuntime(page: Page) {
  await page.evaluate(async () => {
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, {
      $RefreshReg$: () => {},
      $RefreshSig$: () => (type: unknown) => type,
      __vite_plugin_react_preamble_installed__: true,
    });
  });
}

async function baseFixture(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : {} }));
  await page.route('**/journey-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="en" class="light"><head><title>Journey</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div></body></html>',
  }));
  await page.goto('/journey-fixture');
  await installRefreshRuntime(page);
  await page.evaluate(async ({ workspaceId, user }) => {
    const mod = await import('/src/stores/useAuthStore.ts');
    const { useAuthStore } = mod;
    const signedIn = { ...user, isAnonymous: false, getIdToken: async () => 'browser-fixture-token' };
    const workspace = {
      id: workspaceId, uid: user.uid, name: 'Sample Shop', currency: 'USD',
      dimensions: [{ id: 'world', name: 'World', isWorld: true }],
      roles: { [user.uid]: 'owner' },
    };
    useAuthStore.setState({ user: signedIn, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [workspace] } as never);
  }, { workspaceId: WORKSPACE, user: USER });
  return { errors };
}

/** A phone must not scroll the whole page sideways; wide tables scroll inside their own card. */
async function expectNoPageOverflow(page: Page, label: string) {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.scroll, `${label} scrolls the page sideways`).toBeLessThanOrEqual(widths.view + 1);
}

async function expectAxeClean(page: Page, selector: string, label: string) {
  const axe = await new AxeBuilder({ page }).include(selector).analyze();
  const serious = axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label}: ${JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.length })))}`).toEqual([]);
}

// ---------------------------------------------------------------------------
// W2 — Invoice → posting → payment → customer statement
// ---------------------------------------------------------------------------
test('F-41 W2 browser: invoice $1,000, payment $600, customer statement shows $400 outstanding', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await baseFixture(page);
  await page.route('**/api/**', route => route.fulfill({ json: {} }));

  await page.evaluate(async ({ workspaceId }) => {
    const [{ default: React }, { default: { createRoot } }, { useLedgerStore }, { useDataNeedsStore }, { default: StatementView }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/stores/useLedgerStore.ts'),
      import('/src/stores/useDataNeedsStore.ts'),
      import('/src/components/reporting/StatementView.tsx'),
    ]);
    // Worked figures (USD, whole cents):
    //  Invoice INV-1001  $1,000.00 = 100000 cents, sent 2026-05-05
    //  Payment p1  $600.00 = 60000 cents, received 2026-05-20, allocated to INV-1001
    //  Statement 2026-05-01 .. 2026-05-31:
    //    opening 0, billed 100000, paid 60000, outstanding 40000
    const customers = [{ id: 'c1', workspaceId, name: 'Acme Corp', email: 'ap@acme.test' }];
    const invoices = [{
      id: 'inv1', workspaceId, customerId: 'c1', customerName: 'Acme Corp',
      number: 'INV-1001', date: '2026-05-05', dueDate: '2026-06-04', status: 'sent',
      amountCents: 100000, amountPaidCents: 60000, currency: 'USD',
    }];
    const payments = [{
      id: 'p1', workspaceId, contactId: 'c1', date: '2026-05-20', amountCents: 60000,
      direction: 'received', status: 'posted', reference: 'PMT-001',
    }];
    useLedgerStore.setState({
      customers, vendors: [], invoices, bills: [], payments, creditNotes: [], vendorCredits: [], transactions: [], bankLines: [],
      truncatedCollections: {}, baseCurrency: 'USD',
    } as never);
    useDataNeedsStore.setState({ loaded: { customers: true, invoices: true, payments: true, bills: true, creditNotes: true, vendors: true, vendorCredits: true }, loadedWorkspaceId: workspaceId, failed: {} } as never);
    (createRoot(document.getElementById('root')!)).render(React.createElement(StatementView, { startDate: '2026-05-01', endDate: '2026-05-31' }));
  }, { workspaceId: WORKSPACE });

  await expect(page.getByRole('heading', { name: 'Account Statement' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'STATEMENT OF ACCOUNT' })).toBeVisible();
  await expect(page.getByText('Period: 2026-05-01 to 2026-05-31')).toBeVisible();
  // Opening 0.00, Total Period Billed 1,000.00, Ending Outstanding 400.00
  await expect(page.getByText('$400.00').first()).toBeVisible();
  await expect(page.getByText('$1,000.00').first()).toBeVisible();
  await expect(page.getByText('$600.00').first()).toBeVisible();
  const table = page.locator('table');
  await expect(table).toContainText('Invoice');
  await expect(table).toContainText('INV-1001');
  await expect(table).toContainText('Payment');
  await expect(table).toContainText('$1,000.00');
  await expect(table).toContainText('$400.00');

  await expectNoPageOverflow(page, 'W2 statement');
  await expectAxeClean(page, 'table', 'W2 statement table');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// W3 — Bill → posting → payment → vendor statement
// ---------------------------------------------------------------------------
test('F-42 W3 browser: bill $250, fully paid, vendor statement shows $0 outstanding', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await baseFixture(page);
  await page.route('**/api/**', route => route.fulfill({ json: {} }));

  await page.evaluate(async ({ workspaceId }) => {
    const [{ default: React }, { default: { createRoot } }, { useLedgerStore }, { useDataNeedsStore }, { default: StatementView }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/stores/useLedgerStore.ts'),
      import('/src/stores/useDataNeedsStore.ts'),
      import('/src/components/reporting/StatementView.tsx'),
    ]);
    // Worked figures:
    //  Bill B-77 $250.00 = 25000 cents, approved 2026-05-10
    //  Payment $250.00 made 2026-05-22, allocated to B-77
    //  Vendor statement 2026-05-01 .. 2026-05-31: billed 25000, paid 25000, outstanding 0
    const vendors = [{ id: 'v1', workspaceId, name: 'Office Depot', email: 'ap@officedepot.test' }];
    const bills = [{
      id: 'bill1', workspaceId, vendorId: 'v1', vendorName: 'Office Depot',
      number: 'B-77', date: '2026-05-10', dueDate: '2026-06-09', status: 'paid',
      amountCents: 25000, amountPaidCents: 25000, currency: 'USD',
    }];
    const payments = [{
      id: 'pay-b1', workspaceId, contactId: 'v1', date: '2026-05-22', amountCents: 25000,
      direction: 'made', status: 'posted', reference: 'PAY-B1',
    }];
    useLedgerStore.setState({
      customers: [], vendors, invoices: [], bills, payments, creditNotes: [], vendorCredits: [], transactions: [], bankLines: [],
      truncatedCollections: {}, baseCurrency: 'USD',
    } as never);
    useDataNeedsStore.setState({ loaded: { customers: true, vendors: true, bills: true, payments: true, vendorCredits: true, invoices: true, creditNotes: true }, loadedWorkspaceId: workspaceId, failed: {} } as never);
    (createRoot(document.getElementById('root')!)).render(React.createElement(StatementView, { startDate: '2026-05-01', endDate: '2026-05-31' }));
  }, { workspaceId: WORKSPACE });

  await expect(page.getByRole('heading', { name: 'Account Statement' })).toBeVisible();
  // Switch to vendor statement, the screen a vendor balance is checked on.
  await page.getByRole('button', { name: 'Vendor Statement' }).click();
  await expect(page.getByRole('heading', { name: 'STATEMENT OF ACCOUNT' })).toBeVisible();
  await expect(page.getByText('Period: 2026-05-01 to 2026-05-31')).toBeVisible();
  const table = page.locator('table');
  await expect(table).toContainText('B-77');
  await expect(table).toContainText('Bill');
  await expect(table).toContainText('Payment');
  // Billed 250, paid 250, outstanding 0.00
  await expect(page.getByText('$250.00').first()).toBeVisible();
  await expect(page.getByText('$0.00').first()).toBeVisible();

  await expectNoPageOverflow(page, 'W3 vendor statement');
  await expectAxeClean(page, 'table', 'W3 vendor statement table');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// W4 — Bank CSV import → match → reconciled balance (via the Reconciliation screen)
// ---------------------------------------------------------------------------
test('F-43 W4 browser: imported bank lines match ledger entries, one reconciled balance', async ({ page }) => {
  test.setTimeout(90000);
  // Matching is a two-list click; the phone pass below checks the same screen at 390px.
  await page.setViewportSize({ width: 1280, height: 900 });
  const { errors } = await baseFixture(page);

  const apiCalls: Array<{ url: string; method: string; body: unknown }> = [];
  await page.route('**/api/**', async route => {
    const req = route.request();
    const body = (() => { try { return req.postDataJSON(); } catch { return undefined; } })();
    if (req.url().includes('/reconcile')) apiCalls.push({ url: req.url(), method: req.method(), body });
    return route.fulfill({ json: {} });
  });

  await page.evaluate(async ({ workspaceId }) => {
    const [{ default: React }, { default: { createRoot } }, { useLedgerStore }, { useDataNeedsStore }, { default: Reconciliation }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/stores/useLedgerStore.ts'),
      import('/src/stores/useDataNeedsStore.ts'),
      import('/src/components/ledger/Reconciliation.tsx'),
    ]);
    // Worked figures for W4 (mirrors reconciliation-screen.test.tsx):
    //  Bank account Checking, opening $0
    //  Ledger entries:
    //    t1 payment from Acme $500.00 (50000 cents)
    //    t2 rent $1,200.00 (120000 cents out of the bank)
    //  Imported bank lines (CSV):
    //    b1 ACME $500.00 — pairs with t1
    //    b2 LANDLORD $1,200 — pairs with t2
    //  One match by hand reconciles t1; the auto-align action is offered for the rest.
    const accounts = [
      { id: 'bank', workspaceId, code: '1000', name: 'Business Checking', type: 'asset', category: 'Cash', subtype: 'bank' },
      { id: 'sales', workspaceId, code: '4000', name: 'Sales', type: 'revenue', category: 'Revenue' },
      { id: 'rent', workspaceId, code: '6000', name: 'Rent', type: 'expense', category: 'Expenses' },
    ];
    const bankLines = [
      { id: 'b1', workspaceId, accountId: 'bank', date: '2026-10-01', description: 'ACME CORP DEP 4411', amountCents: 50000, status: 'pending' },
      { id: 'b2', workspaceId, accountId: 'bank', date: '2026-10-02', description: 'LANDLORD LTD OCT', amountCents: -120000, status: 'pending' },
      { id: 'm1', workspaceId, accountId: 'bank', date: '2026-09-01', description: 'DEPOSIT 0901', amountCents: 10000, status: 'matched', matchedTransactionId: 't0' },
    ];
    const transactions = [
      { id: 't1', workspaceId, date: '2026-10-01', description: 'Payment from Acme Corp', totalAmountCents: 50000, status: 'completed', lines: [{ id: 'l1', accountId: 'bank', amountCents: 50000 }, { id: 'l2', accountId: 'sales', amountCents: -50000 }] },
      { id: 't2', workspaceId, date: '2026-10-02', description: 'October office rent', totalAmountCents: 120000, status: 'completed', lines: [{ id: 'l3', accountId: 'rent', amountCents: 120000 }, { id: 'l4', accountId: 'bank', amountCents: -120000 }] },
      { id: 't0', workspaceId, date: '2026-09-01', description: 'September deposit', totalAmountCents: 10000, status: 'reconciled', lines: [{ id: 'l5', accountId: 'bank', amountCents: 10000 }, { id: 'l6', accountId: 'sales', amountCents: -10000 }] },
    ];
    useLedgerStore.setState({ accounts, transactions, bankLines, autoRules: [] } as never);
    useDataNeedsStore.setState({ loaded: { accounts: true, transactions: true, bankLines: true }, loadedWorkspaceId: workspaceId, failed: {} } as never);
    (createRoot(document.getElementById('root')!)).render(React.createElement(Reconciliation));
  }, { workspaceId: WORKSPACE });

  // Both lists are on screen; the engine suggests the Acme pair.
  await expect(page.getByRole('button', { name: /Streams \(2\)/ })).toBeVisible();
  await expect(page.getByText('ACME CORP DEP 4411').first()).toBeVisible();
  await expect(page.getByText('LANDLORD LTD OCT').first()).toBeVisible();
  await expect(page.getByText('Payment from Acme Corp').first()).toBeVisible();
  await expect(page.getByText('October office rent').first()).toBeVisible();
  await expect(page.getByText('Match found').first()).toBeVisible();

  // Match by hand: bank line then ledger entry, then assert the pair.
  await page.getByText('ACME CORP DEP 4411').first().click();
  await page.getByText('Payment from Acme Corp').first().click();
  const matchBtn = page.getByRole('button', { name: 'Assert Match Verification' });
  await expect(matchBtn).toBeVisible();
  await matchBtn.click();
  await expect.poll(() => apiCalls.length).toBeGreaterThan(0);
  expect(apiCalls[0].body).toMatchObject({
    workspaceId: WORKSPACE,
    operations: [
      { type: 'updateBankLine', id: 'b1', data: { status: 'matched', matchedTransactionId: 't1' } },
      { type: 'updateTransaction', id: 't1', data: { status: 'reconciled' } },
    ],
  });

  await expect(page.getByRole('button', { name: 'Auto Align All' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Matched History \(1\)/ })).toBeVisible();
  await expectAxeClean(page, 'body', 'W4 reconciliation');

  // Phone pass: the same screen keeps the page at the viewport width.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoPageOverflow(page, 'W4 reconciliation');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// W6 — Order with deposit → part invoices → delivery charged once (DEP-1)
// ---------------------------------------------------------------------------
test('F-44 W6 browser: order 1,100 totals, 25% then rest, delivery charged once, a later part refused', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await baseFixture(page);
  await page.route('**/api/**', route => route.fulfill({ json: {} }));

  await page.evaluate(async ({ workspaceId }) => {
    const [{ default: React }, { default: { createRoot } }, { orderProgress }, { default: OrderInvoiceDialog }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/lib/salesOrders.ts'),
      import('/src/components/sales/OrderInvoiceDialog.tsx'),
    ]);
    // Worked figures (DEP-1):
    //  Order EST-1, 2026-05-01, total 1,100.00 = 110000 cents
    //    Goods    1 × 1,000.00 = 100000
    //    Delivery 1 ×   100.00 =  10000
    //  First part 25%  = 27500 → goods 25000 + delivery 2500
    //  Rest      = 110000 − 27500 = 82500 → goods 75000 + delivery 7500
    //  Both parts together: 110000, delivery exactly 10000 once.
    const est = {
      id: `${workspaceId}_order`, workspaceId, number: 'EST-1', status: 'accepted', orderedAt: '2026-05-01',
      customerName: 'Acme Corp', amountCents: 110000,
      lines: [
        { description: 'Goods', quantity: 1, unitPriceCents: 100000, amountCents: 100000 },
        { description: 'Delivery', quantity: 1, unitPriceCents: 10000, amountCents: 10000 },
      ],
    };
    const root = createRoot(document.getElementById('root')!);
    const created: unknown[] = [];
    const store = { est, created, root, key: 0, render: (_progress: unknown) => {} };
    store.render = (progress: unknown) => {
      store.key += 1;
      root.render(React.createElement(OrderInvoiceDialog, {
        key: store.key,
        estimate: est as never,
        progress: progress as never,
        currency: 'USD',
        canWrite: true,
        onCreate: async (part: unknown) => { created.push(part); },
        onClose: () => {},
      }));
    };
    (window as unknown as { __w6: typeof store }).__w6 = store;
    store.render(orderProgress(est as never, [] as never));
  }, { workspaceId: WORKSPACE });

  // First part: 25% of 1,100 = 275.00, split over the two order lines.
  await expect(page.getByRole('heading', { name: 'Invoice order EST-1' })).toBeVisible();
  await expect(page.getByText(/order of \$1,100\.00 · invoiced \$0\.00/)).toBeVisible();
  await page.getByLabel('A percentage of the order').check();
  await page.getByLabel('Percentage of the order').fill('25');
  await expect(page.getByText('Goods (25% of order EST-1)')).toBeVisible();
  await expect(page.getByText('$250.00')).toBeVisible();
  await expect(page.getByText('Delivery (25% of order EST-1)')).toBeVisible();
  await expect(page.getByText('$25.00')).toBeVisible();
  const firstCreate = page.getByRole('button', { name: 'Create $275.00 invoice' });
  await expect(firstCreate).toBeEnabled();
  await firstCreate.click();
  expect(await page.evaluate(() => (window as unknown as { __w6: { created: unknown[] } }).__w6.created[0]))
    .toEqual({ mode: 'percent', percent: 25 });

  // The first invoice exists now: the same screen offers the rest, 825.00.
  await page.evaluate(async () => {
    const { orderProgress, orderPartInvoice } = await import('/src/lib/salesOrders.ts');
    const w = (window as unknown as { __w6: { est: unknown; created: unknown[]; render: (p: unknown) => void } }).__w6;
    const p1 = { ...orderPartInvoice(w.est as never, orderProgress(w.est as never, [] as never), 27500, '25% of order EST-1', { mode: 'percent', percent: 25 }), id: 'p1', number: 'INV-P1' };
    const progress1 = orderProgress(w.est as never, [p1] as never);
    (w as unknown as { p1: unknown; progress1: unknown }).p1 = p1;
    (w as unknown as { progress1: unknown }).progress1 = progress1;
    w.render(progress1);
  });
  await expect(page.getByText(/order of \$1,100\.00 · invoiced \$275\.00/)).toBeVisible();
  await expect(page.getByText(/left \$825\.00/)).toBeVisible();
  const secondCreate = page.getByRole('button', { name: 'Create $825.00 invoice' });
  await expect(secondCreate).toBeEnabled();
  await expect(page.getByText('Goods (rest of order EST-1)')).toBeVisible();
  await expect(page.getByText('$750.00')).toBeVisible();
  await expect(page.getByText('Delivery (rest of order EST-1)')).toBeVisible();
  await expect(page.getByText('$75.00')).toBeVisible();
  await secondCreate.click();
  expect(await page.evaluate(() => (window as unknown as { __w6: { created: unknown[] } }).__w6.created[1]))
    .toEqual({ mode: 'rest' });

  // Both invoices: 27,500 + 82,500 = 110,000; delivery appears once in total, 10,000.
  const totals = await page.evaluate(async () => {
    const { orderPartInvoice } = await import('/src/lib/salesOrders.ts');
    const w = (window as unknown as { __w6: { est: unknown; progress1: unknown; p1: { items?: Array<{ description: string; amountCents: number }>; amountCents: number } } }).__w6;
    const p2 = orderPartInvoice(w.est as never, w.progress1 as never, 82500, 'rest of order EST-1', { mode: 'rest' });
    const items = [...(w.p1.items || []), ...(p2.items || [])];
    return {
      p1: w.p1.amountCents,
      p2: p2.amountCents,
      delivery: items.filter(i => i.description.includes('Delivery')).reduce((sum, i) => sum + i.amountCents, 0),
    };
  });
  expect(totals.p1).toBe(27500);
  expect(totals.p2).toBe(82500);
  expect(totals.p1 + totals.p2).toBe(110000);
  expect(totals.delivery).toBe(10000);

  // A further part over what is left is refused before anything is sent.
  await page.evaluate(() => {
    const w = (window as unknown as { __w6: { render: (p: unknown) => void; progress1: unknown } }).__w6;
    w.render(w.progress1);
  });
  await page.getByLabel('An amount').check();
  await page.getByLabel('Amount to invoice (USD)').fill('900');
  await expect(page.locator('div[role="dialog"]').getByRole('alert')).toHaveText('That is more than is left to invoice');
  await expect(page.getByRole('button', { name: 'Create $0.00 invoice' })).toBeDisabled();

  await expectNoPageOverflow(page, 'W6 order invoice dialog');
  await expectAxeClean(page, 'div[role="dialog"]', 'W6 order invoice dialog');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// W9 — Close a month → posting refused → reopen with reason (F-45)
// ---------------------------------------------------------------------------
test('F-45 W9 browser: close September 2026, a late posting is refused, reopen with a reason reopens it', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });

  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : {} }));
  await page.route('**/api/**', async route => {
    const req = route.request();
    const url = req.url();
    const body = (() => { try { return req.postDataJSON(); } catch { return req.postData(); } })();
    if (url.includes('/periods/')) requests.push({ url, method: req.method(), body });
    if (req.method() === 'POST' && /\/periods\/\d{4}-\d{2}\/close$/.test(url)) return route.fulfill({ json: { lockDate: '2026-09-30', softLockDate: '2026-09-30' } });
    if (req.method() === 'POST' && /\/periods\/\d{4}-\d{2}\/reopen$/.test(url)) return route.fulfill({ json: { lockDate: null, softLockDate: null } });
    if (url.includes('/balance-check')) return route.fulfill({ json: { snapshot: null, changes: [] } });
    if (url.includes('/close-steps')) return route.fulfill({ json: { closeSteps: [] } });
    return route.fulfill({ json: {} });
  });
  await page.route('**/close-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="en" class="light"><head><title>Close</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div></body></html>',
  }));
  await page.goto('/close-fixture');
  await installRefreshRuntime(page);

  await page.evaluate(async ({ workspaceId, user }) => {
    const [{ default: React }, { default: { createRoot } }, { useAuthStore }, { useLedgerStore }, { useDataNeedsStore }, { default: MonthEndClose }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/stores/useAuthStore.ts'),
      import('/src/stores/useLedgerStore.ts'),
      import('/src/stores/useDataNeedsStore.ts'),
      import('/src/components/ledger/MonthEndCloseView.tsx'),
    ]);
    const signedIn = { ...user, isAnonymous: false, getIdToken: async () => 'browser-fixture-token' };
    const workspace = { id: workspaceId, uid: user.uid, name: 'Books', currency: 'USD', fiscalYearStartMonth: 1, roles: { [user.uid]: 'owner' } };
    useAuthStore.setState({ user: signedIn, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [workspace] } as never);
    // A month with nothing left to do: no drafts, no open documents, no unmatched bank lines.
    useLedgerStore.setState({
      accounts: [], bankLines: [], transactions: [], invoices: [], bills: [], journalEntries: [], assets: [],
      truncatedCollections: {}, baseCurrency: 'USD',
    } as never);
    useDataNeedsStore.setState({
      loaded: { accounts: true, bankLines: true, bills: true, invoices: true, transactions: true, journalEntries: true, customers: true, vendors: true, assets: true },
      loadedWorkspaceId: workspaceId, failed: {},
    } as never);
    (createRoot(document.getElementById('root')!)).render(React.createElement(MonthEndClose));
  }, { workspaceId: WORKSPACE, user: USER });

  await expect(page.getByRole('heading', { name: 'Month-End Close', exact: true })).toBeVisible();
  await page.locator('#close-month').fill('2026-09');
  const journey = page.locator('section[aria-labelledby="close-journey"]');
  await expect(journey.getByRole('heading', { name: 'Close journey' })).toBeVisible();

  // Clean month: 5 of 9 steps done, only the lock is left; the owner closes it.
  await expect(journey.getByText(/5 of 9 steps done/)).toBeVisible();
  await expect(journey.getByText('2026-09 is open.')).toBeVisible();
  const closeBtn = page.getByRole('button', { name: 'Close 2026-09', exact: true });
  await expect(closeBtn).toBeEnabled();
  await closeBtn.click();

  const closeCall = requests.find(r => /\/periods\/2026-09\/close$/.test(r.url));
  expect(closeCall?.method).toBe('POST');
  expect(closeCall?.body).toEqual({ mode: 'hard' });
  const statusCard = page.locator('section[aria-labelledby="close-status"]');
  await expect(statusCard.getByText('Closed: nobody can post', { exact: true })).toBeVisible();
  await expect(journey.getByText('2026-09 is closed.')).toBeVisible();

  // The shared posting rule (src/lib/periodLock.ts, used by the app's validation and the server)
  // refuses a late September date now that the screen has written the hard close into the workspace.
  const closedGate = await page.evaluate(async ({ uid }) => {
    const { postingLock, lockMessage } = await import('/src/lib/periodLock.ts');
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    const state = useAuthStore.getState();
    const workspace = state.workspaces.find(w => w.id === state.currentWorkspaceId)!;
    const lock = postingLock('2026-09-25', workspace, uid);
    return { lockDate: workspace.lockDate, lock, message: lock ? lockMessage('2026-09-25', lock) : null };
  }, { uid: USER.uid });
  expect(closedGate.lockDate).toBe('2026-09-30');
  expect(closedGate.lock).toEqual({ kind: 'hard', through: '2026-09-30' });
  expect(closedGate.message).toContain('in a closed period');

  // Reopen needs a reason; it goes through the server and re-opens the month.
  const reopenBtn = page.getByRole('button', { name: 'Reopen 2026-09 and later months' });
  await expect(reopenBtn).toBeDisabled();
  await page.getByLabel('Reason for reopening').fill('Late supplier bill arrived');
  await expect(reopenBtn).toBeEnabled();
  await reopenBtn.click();

  const reopenCall = requests.find(r => /\/periods\/2026-09\/reopen$/.test(r.url));
  expect(reopenCall?.method).toBe('POST');
  expect(reopenCall?.body).toEqual({ reason: 'Late supplier bill arrived' });
  await expect(journey.getByText('2026-09 is open.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close 2026-09', exact: true })).toBeEnabled();

  // Reopened: the same late date is allowed again.
  const openGate = await page.evaluate(async ({ uid }) => {
    const { postingLock } = await import('/src/lib/periodLock.ts');
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    const state = useAuthStore.getState();
    const workspace = state.workspaces.find(w => w.id === state.currentWorkspaceId)!;
    return postingLock('2026-09-25', workspace, uid);
  }, { uid: USER.uid });
  expect(openGate).toBeNull();

  // Phone pass on the close card: its own content fits, no sideways scroll inside it.
  const fit = await statusCard.evaluate(el => ({ width: (el as HTMLElement).clientWidth, scroll: (el as HTMLElement).scrollWidth }));
  expect(fit.scroll, 'W9 close status card overflows').toBeLessThanOrEqual(fit.width + 1);
  const axe = await new AxeBuilder({ page }).include('section[aria-labelledby="close-status"]').analyze();
  const serious = axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
  expect(errors).toEqual([]);
});
