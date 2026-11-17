import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('phone feedback previews a Hebrew screenshot and retries its upload without creating another ticket', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.route('**/feedback-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="fixture"></div></body></html>' }));
  let tickets = 0, uploads = 0;
  const targets: string[] = [];
  // Playwright matches the most recently registered route first: the blanket routes go first so the two specific
  // ones below win for their paths.
  await page.route('**/api/**', route => route.fulfill({ status: 200, json: {} }));
  await page.route('**/rest/v1/**', async route => {
    const request = route.request();
    await route.fulfill({ status: 200, json: request.method() === 'GET' ? [] : null });
  });
  await page.route('**/api/v1/commands/support.ticket', async route => {
    const input = route.request().postDataJSON() as { input: { id: string } };
    tickets++;
    await route.fulfill({ status: 200, json: { ok: true, data: { id: input.input.id, messageId: `${input.input.id}-message`, created: true } } });
  });
  await page.route('**/api/v1/commands/document.save', async route => {
    const input = route.request().postDataJSON() as { input: Record<string, unknown> };
    uploads++;
    targets.push(String(input.input.linkedId));
    expect(input.input.linkedCollection).toBe('supportTickets');
    expect(input.input.name).toBe('צילום-מסך.png');
    if (uploads === 1) return await route.fulfill({ status: 403, json: { message: 'Screenshot refused' } });
    await route.fulfill({ status: 200, json: { ok: true, data: { id: `file-${uploads}` } } });
  });
  await page.goto('/feedback-fixture');
  await page.evaluate(async () => {
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    const paths = ['/node_modules/.vite/deps/react.js', '/node_modules/.vite/deps/react-dom_client.js', '/src/components/support/FeedbackWidget.tsx', '/src/stores/useAuthStore.ts', '/src/stores/useUIStore.ts'];
    const [{ default: React }, { default: { createRoot } }, { default: Widget }, { useAuthStore }, { useUIStore }] = await Promise.all(paths.map(path => import(path)));
    useAuthStore.setState({ user: { uid: 'screenshot-user', getIdToken: async () => 'browser-test-token' }, currentWorkspaceId: 'screenshot-workspace', workspaces: [{ id: 'screenshot-workspace', uid: 'screenshot-user', name: 'Screenshot test', currency: 'USD', roles: { 'screenshot-user': 'owner' } }], isGuest: false });
    useUIStore.setState({ activeTab: 'reports', activeReportTab: 'budget-actual' });
    createRoot(document.getElementById('fixture')).render(React.createElement(Widget));
  });
  const opener = page.getByRole('button', { name: 'Send feedback' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Send feedback' });
  const text = dialog.getByLabel('What happened?');
  await text.fill('Screenshot of Hebrew rows שלום');
  const image = await readFile(new URL('../public/pwa-192x192.png', import.meta.url));
  const file = dialog.getByLabel('Add a screenshot (optional)');
  await file.setInputFiles({ name: 'צילום-מסך.png', mimeType: 'image/png', buffer: image });
  await expect(dialog.getByAltText('Selected screenshot preview')).toBeVisible();
  const form = dialog.locator('form');
  expect((await form.boundingBox())!.height).toBeLessThanOrEqual(608);
  const send = dialog.getByRole('button', { name: 'Send', exact: true });
  await send.scrollIntoViewIfNeeded();
  expect((await send.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await send.click();
  await expect(dialog.getByRole('alert')).toContainText('Screenshot refused');
  await expect(dialog.getByRole('status')).toContainText('Feedback saved');
  await expect(text).toHaveValue('Screenshot of Hebrew rows שלום');
  await expect(text).toHaveAttribute('readonly', '');
  await expect(dialog.getByText('צילום-מסך.png', { exact: true })).toBeVisible();
  const retry = dialog.getByRole('button', { name: 'Retry screenshot' });
  await retry.scrollIntoViewIfNeeded(); await retry.focus(); await retry.press('Enter');
  await expect(dialog).toHaveCount(0);
  expect(tickets).toBe(1); expect(uploads).toBe(2); expect(targets[0]).toBe(targets[1]);
  await expect(opener).toBeFocused();
});
