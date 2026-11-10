import { test, expect } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';

import { BRAND_NAME } from '../src/config/brand';
/**
 * D-97 (G-02): plain-language evidence for the first-hour path. The reconciliation
 * screen, the chart template selector and the reconciliation wizard must name things
 * the way a bookkeeper would — no invented jargon ("Streams", "Synapse", "Topology",
 * "Invariant", "Cognitive"). Display-only wording; no money or server behaviour changes.
 */

const WORKSPACE = 'd97-plain-language';

const accounts = [
  { id: 'bank', workspaceId: WORKSPACE, code: '1000', name: 'Business Checking', type: 'asset', category: 'Cash' },
  { id: 'card', workspaceId: WORKSPACE, code: '1010', name: 'Savings Bank', type: 'asset', category: 'Cash' },
  { id: 'sales', workspaceId: WORKSPACE, code: '4000', name: 'Sales', type: 'revenue', category: 'Revenue' },
  { id: 'rent', workspaceId: WORKSPACE, code: '5100', name: 'Rent', type: 'expense', category: 'Expenses' },
];

const transactions = [
  { id: 't1', workspaceId: WORKSPACE, date: '2026-10-01', description: 'Payment from Acme Corp', totalAmountCents: 50000, currency: 'USD', status: 'completed',
    lines: [{ id: 'l1', accountId: 'bank', amountCents: 50000 }, { id: 'l2', accountId: 'sales', amountCents: -50000 }] },
  { id: 't2', workspaceId: WORKSPACE, date: '2026-10-02', description: 'October office rent', totalAmountCents: 120000, currency: 'USD', status: 'completed',
    lines: [{ id: 'l3', accountId: 'rent', amountCents: 120000 }, { id: 'l4', accountId: 'bank', amountCents: -120000 }] },
];

const bankLines = [
  { id: 'b1', workspaceId: WORKSPACE, date: '2026-10-01', description: 'ACME CORP DEP 4411', amountCents: 50000, status: 'pending', accountId: 'bank' },
  { id: 'b2', workspaceId: WORKSPACE, date: '2026-10-02', description: 'LANDLORD LTD OCT', amountCents: -120000, status: 'pending', accountId: 'bank' },
  { id: 'b3', workspaceId: WORKSPACE, date: '2026-10-03', description: 'Coffee shop', amountCents: -450, status: 'pending', accountId: 'card' },
  { id: 'm1', workspaceId: WORKSPACE, date: '2026-09-01', description: 'DEPOSIT 0901', amountCents: 10000, status: 'matched', matchedTransactionId: 't1', accountId: 'bank' },
];

const OLD_JARGON = ['Streams', 'Synapse', 'Cognitive', 'Registry', 'Invariant', 'Topology', 'Assert Match', 'Revert Verification'];

test('reconciliation screen speaks plain language, desktop light', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { errors } = await mountJourney(page, {
    workspaceId: WORKSPACE,
    ledger: { accounts, transactions, bankLines },
    mounts: [{ module: '/src/components/ledger/Reconciliation.tsx' }],
  });

  await expect(page.getByRole('heading', { name: 'Smart Matching & Bank Reconciliation' })).toBeVisible();
  await expect(page.getByRole('button', { name: /To review \(3\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Matched \(1\)/ })).toBeVisible();
  await expect(page.getByText('Bank statement lines')).toBeVisible();
  await expect(page.getByText('Ledger entries')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Auto-match all' })).toBeVisible();
  await expect(page.getByText('Pick a bank statement line, then pick the ledger entry that matches it.')).toBeVisible();

  // The suggested-match review modal keeps the same plain language.
  const review = page.getByRole('button', { name: /Review \d+ suggested matches/ });
  await expect(review).toBeVisible();
  await review.click();
  const modal = page.getByRole('dialog', { name: 'Review suggested matches' });
  await expect(modal).toBeVisible();
  // useDialog contract: focus moves into the dialog and Tab stays trapped inside it.
  await expect(modal.locator(':focus')).toHaveCount(1);
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    expect(await modal.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  // Escape closes the dialog and returns focus to the trigger.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Review suggested matches' })).toHaveCount(0);
  await expect(review).toBeFocused();

  // Reopen to keep the pointer (Cancel) path covered as well.
  await review.click();
  await expect(modal).toBeVisible();
  // The button's aria-label is its accessible name (the count stays in the visible text).
  await expect(page.getByRole('button', { name: 'Apply selected matches' })).toBeVisible();
  await expect(page.getByText(/Apply selected matches \(\d+\)/)).toBeVisible();
  await expect(page.getByText('Bank statement line', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(page.getByRole('heading', { name: 'Review suggested matches' })).toHaveCount(0);

  const body = page.locator('body');
  for (const word of OLD_JARGON) {
    await expect(body, `jargon must not return: ${word}`).not.toContainText(word);
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('reconcile-plain-1280-light.png'), fullPage: true });
  await page.screenshot({ path: 'docs/verification/images/d97b/reconcile-plain-1280-light.png', fullPage: true });

  // The same screen must stay readable on a 390px phone.
  await page.setViewportSize({ width: 390, height: 850 });
  await expect(page.getByRole('button', { name: /To review \(3\)/ })).toBeVisible();
  const phoneOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(phoneOverflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('reconcile-plain-390-light.png'), fullPage: true });
  await page.screenshot({ path: 'docs/verification/images/d97b/reconcile-plain-390-light.png', fullPage: true });

  // The suggested-match review modal, captured on its own for the evidence pack.
  await page.setViewportSize({ width: 1280, height: 900 });
  await review.click();
  await expect(modal).toBeVisible();
  await modal.screenshot({ path: testInfo.outputPath('suggested-matches-1280-light.png') });
  await modal.screenshot({ path: 'docs/verification/images/d97b/suggested-matches-1280-light.png' });
});

test('chart template selector speaks plain language on phone and desktop', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 850 });
  const { errors } = await mountJourney(page, {
    workspaceId: WORKSPACE,
    ledger: { accounts, transactions: [], bankLines: [] },
    mounts: [{
      module: '/src/components/layout/TemplateSelector.tsx',
      props: { isOpen: true, currentType: '', onSelect: '__capture:select', onOpenAI: '__capture:ai' },
    }],
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Choose a chart of accounts' })).toBeVisible();
  await expect(dialog.getByText('Ready-to-use templates')).toBeVisible();
  await expect(dialog.getByText('Ready-made templates')).toBeVisible();
  await expect(dialog.getByText('AI-built chart of accounts')).toBeVisible();
  expect(await dialog.getByRole('button', { name: 'Use template' }).count()).toBeGreaterThan(0);

  for (const word of ['Invariant', 'Blueprint', 'Topology', 'Engage', 'Synthesis', 'Cognitive', 'Protocol']) {
    await expect(dialog, `jargon must not return: ${word}`).not.toContainText(word);
  }
  expect(errors).toEqual([]);

  // Phone layout: no horizontal overflow and the template actions are reachable.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const firstUse = dialog.getByRole('button', { name: 'Use template' }).first();
  await firstUse.scrollIntoViewIfNeeded();
  expect((await firstUse.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('template-plain-390-light.png'), fullPage: true });
  await page.screenshot({ path: 'docs/verification/images/d97b/template-plain-390-light.png', fullPage: true });

  // The inspector pane (key equation, account list, connection map) is desktop-only.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(dialog.getByText('Key equation')).toBeVisible();
  await expect(dialog.getByText('Accounts in this template')).toBeVisible();
  await expect(dialog.getByText('How the accounts connect')).toBeVisible();
  await expect(dialog.getByText('Balanced books, enforced')).toBeVisible();
  const useThis = dialog.getByRole('button', { name: 'Use this template' });
  await expect(useThis).toBeVisible();
  expect((await useThis.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('template-plain-1280-light.png'), fullPage: true });
  await page.screenshot({ path: 'docs/verification/images/d97b/template-plain-1280-light.png', fullPage: true });
});

test('reconciliation wizard step two speaks plain language', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/**', route => route.fulfill({ status: 200, json: {} }));
  await page.route('**/rest/v1/**', route => route.fulfill({ status: 200, json: [] }));
  await page.route('**/journey-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="en" class="light"><head><title>${BRAND_NAME} journey</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div></body></html>`,
  }));
  await page.goto('/journey-fixture');

  await page.evaluate(async ({ accounts }) => {
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    const [{ default: React }, { default: { createRoot } }, { useAuthStore }, { useLedgerStore }, { useDataNeedsStore }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/stores/useAuthStore.ts'),
      import('/src/stores/useLedgerStore.ts'),
      import('/src/stores/useDataNeedsStore.ts'),
    ]);
    const user = { uid: 'journey-user', email: 'owner@example.test', displayName: 'Journey Owner', isAnonymous: false, getIdToken: async () => 't' };
    const workspace = { id: 'd97-plain-language', uid: user.uid, name: 'Journey Books', currency: 'USD', fiscalYearStartMonth: 1, roles: { [user.uid]: 'owner' } };
    useAuthStore.setState({ user, isGuest: false, currentWorkspaceId: workspace.id, workspaces: [workspace] } as never);
    useLedgerStore.setState({ accounts, transactions: [], bankLines: [], autoRules: [], truncatedCollections: {}, baseCurrency: 'USD' } as never);
    useDataNeedsStore.setState({ loaded: { bankLines: true, transactions: true, accounts: true, reconciliations: true }, loadedWorkspaceId: workspace.id, failed: {} } as never);
    const [{ default: ReconciliationWizard }] = await Promise.all([import('/src/components/ledger/ReconciliationWizard.tsx')]);
    const root = createRoot(document.getElementById('root')!);
    root.render(React.createElement(ReconciliationWizard, {
      isOpen: true,
      accounts,
      onClose: () => {},
      onComplete: () => {},
      formatCurrency: (cents: number) => `$${(cents / 100).toFixed(2)}`,
    }));
  }, { accounts });

  await expect(page.getByRole('heading', { name: 'Reconcile account' })).toBeVisible();
  await page.getByRole('combobox').selectOption('Business Checking');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Transactions to clear' })).toBeVisible();
  await expect(page.getByText('Tick the entries shown on the statement')).toBeVisible();
  await expect(page.getByText('Statement ending balance')).toBeVisible();
  await expect(page.getByText('Cleared in this session')).toBeVisible();
  await expect(page.getByText('Book balance')).toBeVisible();
  await expect(page.getByText('Difference')).toBeVisible();
  await expect(page.getByPlaceholder('Search transactions...')).toBeVisible();
  await expect(page.getByText('No transactions to clear for this statement date.')).toBeVisible();
  for (const word of ['Topology', 'Orphaned', 'Quanta', 'Registry', 'Alignment']) {
    await expect(page.locator('body'), `jargon must not return: ${word}`).not.toContainText(word);
  }

  await page.screenshot({ path: testInfo.outputPath('wizard-step2-plain-1280-light.png'), fullPage: true });
  await page.screenshot({ path: 'docs/verification/images/d97b/wizard-step2-plain-1280-light.png', fullPage: true });
});
