import { test, expect } from '@playwright/test';

test('reconciliation retains mixed-language search between empty streams and matched history', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 200, json: {} }));
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js';
    const domPath = '/node_modules/.vite/deps/react-dom_client.js';
    const screenPath = '/src/components/ledger/Reconciliation.tsx';
    const authPath = '/src/stores/useAuthStore.ts';
    const ledgerPath = '/src/stores/useLedgerStore.ts';
    const [{ default: React }, { default: { createRoot } }, { default: Reconciliation }, { useAuthStore }, { useLedgerStore }] = await Promise.all([
      import(reactPath), import(domPath), import(screenPath), import(authPath), import(ledgerPath),
    ]);
    // This independently mounted empty-state probe must not leave the full app's guest seeder active.
    useAuthStore.getState().setIsGuest(false);
    useAuthStore.setState({ user: null, isGuest: false, currentWorkspaceId: null, workspaces: [] });
    useLedgerStore.setState({ transactions: [], accounts: [], bankLines: [], autoRules: [] });
    const host = document.createElement('div');
    host.id = 'reconciliation-navigation-probe';
    host.style.cssText = 'position:fixed;inset:0;z-index:999999;background:white;overflow:auto';
    document.body.append(host);
    createRoot(host).render(React.createElement(Reconciliation));
  });
  const screen = page.locator('#reconciliation-navigation-probe');
  await expect(screen.getByText('Nothing to review')).toBeVisible();
  const search = screen.getByRole('textbox', { name: 'Search reconciliation amounts or descriptions' });
  await search.fill('קבלה receipt');
  await screen.getByRole('button', { name: 'Matched (0)' }).click();
  await expect(screen.getByText('No matched items yet')).toBeVisible();
  await expect(search).toHaveValue('קבלה receipt');
  await screen.getByRole('button', { name: 'To review (0)' }).click();
  await expect(screen.getByText('Nothing to review')).toBeVisible();
});

test('B-3 age review groups loaded pending lines oldest first without losing search or selection', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-20T12:00:00Z') });
  await page.route('**/api/**', route => route.fulfill({ status: 200, json: {} }));
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js';
    const domPath = '/node_modules/.vite/deps/react-dom_client.js';
    const screenPath = '/src/components/ledger/Reconciliation.tsx';
    const authPath = '/src/stores/useAuthStore.ts';
    const ledgerPath = '/src/stores/useLedgerStore.ts';
    const [{ default: React }, { default: { createRoot } }, { default: Reconciliation }, { useAuthStore }, { useLedgerStore }] = await Promise.all([
      import(reactPath), import(domPath), import(screenPath), import(authPath), import(ledgerPath),
    ]);
    useAuthStore.getState().setIsGuest(false);
    useAuthStore.setState({ user: null, isGuest: false, currentWorkspaceId: null, workspaces: [] });
    useLedgerStore.setState({ transactions: [], accounts: [], autoRules: [], bankLines: [
      { id: 'young', date: '2026-11-14', description: 'Young statement', amountCents: -100, status: 'pending' },
      { id: 'middle', date: '2026-11-13', description: 'Middle statement', amountCents: -200, status: 'pending' },
      { id: 'old', date: '2026-10-20', description: 'Old statement', amountCents: -300, status: 'pending' },
      { id: 'matched', date: '2026-01-01', description: 'Matched statement', amountCents: -400, status: 'matched' },
    ] });
    const host = document.createElement('div');
    host.id = 'age-review-probe';
    host.style.cssText = 'position:fixed;inset:0;z-index:999999;background:var(--surface);overflow:auto';
    document.body.append(host);
    createRoot(host).render(React.createElement(Reconciliation));
  });
  const probe = page.locator('#age-review-probe');
  await probe.getByRole('combobox', { name: 'Bank line review order' }).selectOption('age');
  await expect(probe.locator('[data-bank-line-id]')).toHaveCount(3);
  expect(await probe.locator('[data-bank-line-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-bank-line-id')))).toEqual(['old', 'middle', 'young']);
  for (const heading of ['Over 30 days', '7–30 days', 'Under 7 days']) {
    await expect(probe.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await probe.getByRole('button', { name: /Old statement/ }).click();
  await expect(probe.getByRole('button', { name: /Old statement/ })).toHaveAttribute('aria-pressed', 'true');
  await probe.getByRole('textbox', { name: 'Search reconciliation amounts or descriptions' }).fill('Young');
  await expect(probe.locator('[data-bank-line-id]')).toHaveCount(1);
  await expect(probe.getByRole('heading', { name: 'Under 7 days', exact: true })).toBeVisible();
  await expect(probe.getByRole('heading', { name: 'Over 30 days', exact: true })).toHaveCount(0);
});
