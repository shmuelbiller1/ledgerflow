import { test, expect } from '@playwright/test';
import { mountJourney, captured } from './support/journeyFixture';
for (const width of [390, 1280]) test(`EU-F1 daily menu and all tools ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await mountJourney(page, { workspaceId: 'business-menu', ledger: {}, mounts: [{ module: '/src/components/layout/Sidebar.tsx', props: { activeTab: 'dashboard', setActiveTab: '__capture:tab', onLogout: '__fn:noop', projects: [], onNewProject: '__fn:noop', workspaces: [], currentWorkspaceId: 'business-menu', onSelectWorkspace: '__fn:noop', onNewWorkspace: '__fn:noop', onAction: '__fn:noop' } }] });
  await page.evaluate(async () => { const { useUIStore } = await import('/src/stores/useUIStore.ts'); useUIStore.setState({ isSidebarOpen: true }); });
  const daily = page.getByRole('navigation', { name: 'Daily tools' });
  await expect(daily.getByRole('button')).toHaveText(['Overview', 'To review', 'Sales', 'Purchases', 'Bank', 'Reports', 'Settings']);
  await page.getByText('Show all tools', { exact: true }).click();
  await page.getByLabel('Find a tool').fill('journal');
  await expect(page.getByRole('button', { name: 'Ledger & Journal', exact: true })).toBeVisible();
  await page.getByLabel('Find a tool').fill('');
  const eligible = await page.evaluate(async () => {
    const { APP_TABS } = await import('/src/config/registry.tsx');
    return APP_TABS.filter(t => !t.requiresOwner && !t.developerOnly).map(t => ({ id: t.id, name: t.label.en }));
  });
  const all = page.getByRole('navigation', { name: 'All tools', exact: true });
  for (const tool of eligible) {
    await all.getByRole('button', { name: tool.name, exact: true }).click();
    expect((await captured(page, 'tab')).at(-1)).toEqual([tool.id]);
  }
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    useAuthStore.setState({ workspaces: useAuthStore.getState().workspaces.map(w => ({ ...w, businessType: 'retail' })) });
  });
  await page.getByLabel('Pro mode', { exact: true }).check();
  await expect(page.getByRole('navigation', { name: 'Recommended tools' }).getByRole('button', { name: 'Inventory', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    useAuthStore.setState({ workspaces: useAuthStore.getState().workspaces.map(w => ({ ...w, businessType: 'creative' })) });
  });
  await expect(page.getByRole('navigation', { name: 'Recommended tools' }).getByRole('button', { name: 'Inventory', exact: true })).toHaveCount(0);
  await expect(all.getByRole('button', { name: 'Inventory', exact: true })).toBeVisible();
});
