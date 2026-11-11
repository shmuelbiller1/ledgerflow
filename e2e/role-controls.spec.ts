import { mountJourney } from './support/journeyFixture';
import { test, expect } from '@playwright/test';

test('disabled role controls refuse native Enter, Space and direct clicks', async ({ page }) => {
  // A signed-in viewer must stay a viewer; full guest bootstrap can restore its sample owner.
  await mountJourney(page, { workspaceId: 'role-controls', role: 'viewer', ledger: {}, mounts: [] });
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js';
    const domPath = '/node_modules/.vite/deps/react-dom_client.js';
    const gatePath = '/src/components/ui/RequireRole.tsx';
    const [{ default: React }, { default: { createRoot } }, { RequireRole }] = await Promise.all([import(reactPath), import(domPath), import(gatePath)]);
    const host = document.createElement('div');
    host.id = 'role-controls-probe';
    host.style.cssText = 'position:fixed;inset:0;z-index:999999;background:white;color:black;padding:24px';
    host.dataset.calls = '0';
    document.body.append(host);
    const action = () => { host.dataset.calls = String(Number(host.dataset.calls) + 1); };
    createRoot(host).render(React.createElement(React.Fragment, null,
      React.createElement(RequireRole, { role: 'owner', disableOnly: true }, React.createElement('button', { onClick: action }, 'Restricted action')),
      React.createElement(RequireRole, { role: 'viewer' }, React.createElement('button', { onClick: action }, 'Allowed action')),
    ));
  });
  const restricted = page.getByText('Restricted action', { exact: true });
  await expect(restricted).toBeAttached();
  await restricted.evaluate(el => (el as HTMLButtonElement).focus());
  await expect(restricted).not.toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await restricted.evaluate(el => (el as HTMLButtonElement).click());
  await expect(page.locator('#role-controls-probe')).toHaveAttribute('data-calls', '0');
  await page.getByRole('button', { name: 'Allowed action' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#role-controls-probe')).toHaveAttribute('data-calls', '1');
});
