import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { BRAND_NAME } from '../src/config/brand';
/**
 * W9 (RELEASE_GATE): month-end close and reopen, driven on the real screen.
 *
 * The Month-End Close view is mounted against the app's own stores and its real request boundary is
 * stubbed, so this is a browser test of the screen and its server contract — not of a live
 * database. Two months are exercised:
 *
 *  - a month that still has work (a draft, unmatched bank lines, an open invoice and bill): the
 *    read-only Close journey (A-151) shows every step, each bank apart, the money in the period,
 *    the blocker and the next step; the close is refused, and each step opens its screen;
 *  - a clean month: the owner closes it (the real POST body is checked), the screen says it is
 *    closed, the journey's lock step turns done, and the owner reopens it with a reason.
 *
 * Nothing here writes to a database: every API and REST request is fulfilled by the test.
 */

type Seed = 'work' | 'clean';

const WORKSPACE = 'close-browser';
const USER = { uid: 'close-user', email: 'close@example.test', displayName: 'Closing Owner' };

async function mount(page: Page, seed: Seed): Promise<{ errors: string[]; requests: Array<{ url: string; method: string; body: unknown }> }> {
  const errors: string[] = [];
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  page.on('pageerror', error => errors.push(error.message));

  // The database layer is not under test here; an empty list is an empty collection.
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : {} }));

  // The screen's own API: close, reopen, balance check. Every other API call is inert.
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = request.url();
    const body = (() => { try { return request.postDataJSON(); } catch { return request.postData(); } })();
    if (url.includes('/periods/')) requests.push({ url, method: request.method(), body });
    if (request.method() === 'POST' && /\/periods\/\d{4}-\d{2}\/close$/.test(url)) {
      return route.fulfill({ json: { lockDate: '2026-09-30', softLockDate: '2026-09-30' } });
    }
    if (request.method() === 'POST' && /\/periods\/\d{4}-\d{2}\/reopen$/.test(url)) {
      return route.fulfill({ json: { lockDate: null, softLockDate: null } });
    }
    if (url.includes('/balance-check')) return route.fulfill({ json: { snapshot: null, changes: [] } });
    if (url.includes('/close-steps')) return route.fulfill({ json: { closeSteps: [] } });
    return route.fulfill({ json: {} });
  });

  await page.route('**/close-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="en" class="light"><head><title>${BRAND_NAME} close</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div></body></html>`,
  }));
  await page.goto('/close-fixture');

  await page.evaluate(async ({ seed, workspaceId, user }) => {
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    const paths = [
      '/node_modules/.vite/deps/react.js', '/node_modules/.vite/deps/react-dom_client.js',
      '/src/stores/useAuthStore.ts', '/src/stores/useLedgerStore.ts', '/src/stores/useDataNeedsStore.ts',
      '/src/components/ledger/MonthEndCloseView.tsx',
    ];
    const [{ default: React }, { default: { createRoot } }, { useAuthStore }, { useLedgerStore }, { useDataNeedsStore }, { default: MonthEndClose }] =
      await Promise.all(paths.map(path => import(path)));

    const signedIn = { ...user, isAnonymous: false, getIdToken: async () => 'browser-fixture-token' };
    const workspace = {
      id: workspaceId, uid: user.uid, name: 'Browser Books', currency: 'USD', fiscalYearStartMonth: 1,
      roles: { [user.uid]: 'owner' },
    };
    useAuthStore.setState({ user: signedIn, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [workspace] });

    const work = seed === 'work';
    const accounts = work ? [
      { id: 'bank-1000', uid: user.uid, workspaceId, code: '1000', name: 'Bank 1000', type: 'asset', category: 'Cash' },
      { id: 'bank-1010', uid: user.uid, workspaceId, code: '1010', name: 'Bank 1010', type: 'asset', category: 'Cash' },
      { id: 'expense-1', uid: user.uid, workspaceId, code: '5000', name: 'Office costs', type: 'expense', category: 'Expenses' },
    ] : [];
    const bankLines = work ? [
      { id: 'bl-1', workspaceId, accountId: 'bank-1000', date: '2026-09-03', status: 'matched', matchedTransactionId: 't1', amountCents: 125000 },
      { id: 'bl-2', workspaceId, accountId: 'bank-1000', date: '2026-09-10', status: 'pending', amountCents: -42000 },
      { id: 'bl-3', workspaceId, accountId: 'bank-1010', date: '2026-09-02', status: 'matched', matchedTransactionId: 't2', amountCents: 8000 },
      { id: 'bl-4', workspaceId, date: '2026-09-30', status: 'pending', amountCents: 1900 },
    ] : [];
    const transactions = work ? [
      { id: 'draft-1', uid: user.uid, workspaceId, date: '2026-09-12', status: 'draft', description: 'Late supplier bill', totalAmountCents: 5000, currency: 'USD',
        lines: [{ accountId: 'expense-1', amountCents: 5000 }, { accountId: 'bank-1000', amountCents: -5000 }] },
    ] : [];
    const invoices = work ? [
      { id: 'invoice-1001', uid: user.uid, workspaceId, number: '1001', customerName: 'Buyer Ltd', status: 'sent', date: '2026-09-05', dueDate: '2026-09-30', amountCents: 118000, amountPaidCents: 18000, currency: 'USD' },
    ] : [];
    const bills = work ? [
      { id: 'bill-9001', uid: user.uid, workspaceId, number: '9001', vendorName: 'Supplier Ltd', status: 'pending', date: '2026-09-08', dueDate: '2026-09-20', amountCents: 60000, currency: 'USD' },
    ] : [];
    const journalEntries = work ? [
      { id: 'j1', uid: user.uid, workspaceId, date: '2026-09-30', description: 'Accrual', status: 'posted', lines: [] },
      { id: 'j2', uid: user.uid, workspaceId, date: '2026-09-15', description: 'Deleted', status: 'posted', deletedAt: '2026-09-16T00:00:00.000Z', lines: [] },
      { id: 'j3', uid: user.uid, workspaceId, date: '2026-10-01', description: 'Next month', status: 'posted', lines: [] },
    ] : [];

    useLedgerStore.setState({
      accounts, bankLines, transactions, invoices, bills, journalEntries, assets: [], truncatedCollections: {}, baseCurrency: 'USD',
    });
    useDataNeedsStore.setState({
      loaded: { assets: true, bankLines: true, bills: true, invoices: true, transactions: true, accounts: true, journalEntries: true, customers: true, vendors: true, creditNotes: true, vendorCredits: true },
      loadedWorkspaceId: workspaceId, failed: {},
    });

    createRoot(document.getElementById('root')!).render(React.createElement(MonthEndClose));
  }, { seed, workspaceId: WORKSPACE, user: USER });

  await expect(page.getByRole('heading', { name: 'Month-End Close', exact: true })).toBeVisible();
  // A fixed month: 2026-09 is past, so the close controls are available and the figures are stable.
  await page.locator('#close-month').fill('2026-09');
  await expect(page.locator('#close-month')).toHaveValue('2026-09');
  const journey = page.locator('section[aria-labelledby="close-journey"]');
  await expect(journey.getByRole('heading', { name: 'Close journey', exact: true })).toBeVisible();
  return { errors, requests };
}

test('W9 browser: the close journey shows each bank, the month’s open money, the blocker and opens its screens', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await mount(page, 'work');
  const journey = page.locator('section[aria-labelledby="close-journey"]');

  // Every step of the month's path, in order, read-only.
  const steps = journey.getByRole('heading', { level: 3 });
  await expect(steps).toHaveCount(9);
  expect(await steps.allTextContents()).toEqual([
    '1. Reconcile each bank',
    '2. Give every entry an account',
    '3. Open invoices at month end',
    '4. Open bills at month end',
    '5. Review accruals and prepayments',
    '6. Clear the drafts dated in the month',
    '7. Check the trial balance',
    '8. Lock the month',
    '9. Take the report pack',
  ]);

  // Each bank account apart, and the lines that have no account in their own row.
  const banks = journey.getByRole('table', { name: /Each bank account for 2026-09/ });
  const rows = await banks.locator('tbody tr').evaluateAll(trs => trs.map(tr => Array.from(tr.querySelectorAll('th,td')).map(cell => cell.textContent)));
  expect(rows).toEqual([
    ['Bank 1000', '2', '1'],
    ['Bank 1010', '1', '0'],
    ['Lines with no bank account (check them)', '1', '1'],
  ]);
  await expect(journey.getByText(/2 bank lines of 4 in 2026-09 not matched: Bank 1000 \(1\), Lines with no bank account \(1\)\./)).toBeVisible();

  // The month's open money and the accrual reminder, in the workspace currency.
  await expect(journey.getByText(/1 invoice still open at 2026-09-30, USD 1,000\.00 due in USD\./)).toBeVisible();
  await expect(journey.getByText(/1 bill still open at 2026-09-30, USD 600\.00 due in USD\./)).toBeVisible();
  await expect(journey.getByText(/1 journal entry dated in 2026-09\./)).toBeVisible();

  // The draft is a blocker, carried from the checklist unchanged; the close is refused.
  await expect(journey.getByText('Blocks the close', { exact: true })).toBeVisible();
  await expect(journey.getByText(/2 of 9 steps done · 1 blocking · 2 needing attention · next: Reconcile each bank\./)).toBeVisible();
  const closeButton = page.getByRole('button', { name: 'Close 2026-09', exact: true });
  await expect(closeButton).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Soft close (accountants can still adjust)' })).toBeDisabled();

  // Each step opens the screen that does the work (the app's own navigation state).
  await journey.getByRole('button', { name: 'Open Reconcile', exact: true }).click();
  expect(await page.evaluate(async () => {
    const { useUIStore } = await import('/src/stores/useUIStore.ts');
    return { tab: useUIStore.getState().activeTab, hash: location.hash };
  })).toEqual({ tab: 'reconciliation', hash: '#reconciliation' });

  // The journey panel is usable on a phone and passes serious/critical axe checks.
  const fits = await journey.evaluate(element => ({ width: (element as HTMLElement).clientWidth, scroll: (element as HTMLElement).scrollWidth }));
  expect(fits.scroll).toBeLessThanOrEqual(fits.width);
  const axe = await new AxeBuilder({ page }).include('section[aria-labelledby="close-journey"]').analyze();
  const serious = axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  await testInfo.attach('close-journey-axe-light', { body: JSON.stringify(axe.violations, null, 2), contentType: 'application/json' });
  expect(serious, JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);

  // The same panel in the app's dark theme (the `dark:` half of the attention colour).
  // The theme swap changes colours through CSS transitions; let them finish so axe reads the settled colours.
  await page.evaluate(() => { document.documentElement.classList.remove('light'); document.documentElement.classList.add('dark'); });
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
  const darkAxe = await new AxeBuilder({ page }).include('section[aria-labelledby="close-journey"]').analyze();
  const darkSerious = darkAxe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  await testInfo.attach('close-journey-axe-dark', { body: JSON.stringify(darkAxe.violations, null, 2), contentType: 'application/json' });
  expect(darkSerious, JSON.stringify(darkSerious.map(v => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);

  expect(errors).toEqual([]);
});

test('W9 browser: an owner closes the clean month, sees it closed, and reopens it with a reason', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const { errors, requests } = await mount(page, 'clean');
  const journey = page.locator('section[aria-labelledby="close-journey"]');
  const statusCard = page.locator('section[aria-labelledby="close-status"]');

  // Nothing in the data blocks this month; only the lock is still to do.
  await expect(journey.getByText(/5 of 9 steps done · 1 needing attention · next: Lock the month\./)).toBeVisible();
  await expect(journey.getByText('2026-09 is open.')).toBeVisible();
  await expect(journey.getByText('Needs attention', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close package (.xlsx)', exact: true })).toBeEnabled();

  const closeButton = page.getByRole('button', { name: 'Close 2026-09', exact: true });
  await expect(closeButton).toBeEnabled();
  await closeButton.click();

  // The real request body, then the screen's own closed state.
  const closeCall = requests.find(r => /\/periods\/2026-09\/close$/.test(r.url));
  expect(closeCall?.method).toBe('POST');
  expect(closeCall?.body).toEqual({ mode: 'hard' });
  await expect(statusCard.getByText('Closed: nobody can post', { exact: true })).toBeVisible();
  await expect(journey.getByText('2026-09 is closed.')).toBeVisible();
  await expect(journey.getByText('Done', { exact: true })).toHaveCount(6);
  await expect(journey.getByText(/nothing in the recorded data blocks the close\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close 2026-09', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Balances since the close', exact: true })).toHaveCount(0);

  // A reason is required, and the reopen goes through the server and back to open.
  const reopen = page.getByRole('button', { name: 'Reopen 2026-09 and later months' });
  await expect(reopen).toBeDisabled();
  await page.getByLabel('Reason for reopening').fill('A supplier bill arrived late');
  await expect(reopen).toBeEnabled();
  await reopen.click();

  const reopenCall = requests.find(r => /\/periods\/2026-09\/reopen$/.test(r.url));
  expect(reopenCall?.method).toBe('POST');
  expect(reopenCall?.body).toEqual({ reason: 'A supplier bill arrived late' });
  await expect(journey.getByText('2026-09 is open.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close 2026-09', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Reopen 2026-09 and later months' })).toHaveCount(0);

  const axe = await new AxeBuilder({ page }).include('section[aria-labelledby="close-status"]').analyze();
  const serious = axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  await testInfo.attach('close-status-axe', { body: JSON.stringify(axe.violations, null, 2), contentType: 'application/json' });
  expect(serious, JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);

  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('close-reopened.png'), fullPage: true });
});
