import type { Page } from '@playwright/test';

/**
 * Load the US demo books into the guest workspace, so a screen has rows to show.
 * The demo seed is the guest workspace's own sample company (DEMO-US-001 and friends).
 */
export async function seedDemoBooks(page: Page) {
  await page.evaluate(async () => {
    const { seedCountryDemoWorkspace } = await import('/src/lib/countryDemoWorkspace.ts');
    const { useLedgerStore } = await import('/src/stores/useLedgerStore.ts');
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    const workspaceId = useAuthStore.getState().currentWorkspaceId || 'ws-guest';
    const data = seedCountryDemoWorkspace(workspaceId, 'US');
    useLedgerStore.setState({
      accounts: data.accounts, transactions: data.transactions, invoices: data.invoices,
      bills: data.bills, customers: data.customers, vendors: data.vendors,
    });
  });
}
