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
