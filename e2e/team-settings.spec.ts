import { inlineEditName } from '../src/tests/helpers/inlineEditName';
import { test, expect } from '@playwright/test';

test('team inline edits and named removal work by keyboard on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes: { url: string; method: string }[] = [];
  await page.route('**/api/**', route => {
    const request = route.request(), url = request.url();
    // only the team's own calls: health checks and error reports also POST in the background
    if (request.method() !== 'GET' && url.includes('/api/v1/workspaces/')) writes.push({ url, method: request.method() });
    const data = url.endsWith('/members') ? { status: 'success', members: ['member-א'], ownerUid: 'test-user' }
      : url.endsWith('/roles') ? { status: 'success', roles: { 'member-א': 'viewer' } }
      : { status: 'success', invites: [] };
    return route.fulfill({ status: 200, json: data });
  });
  await page.addInitScript(() => { localStorage.setItem('isGuest', 'true'); localStorage.setItem('has_seen_onboarding', 'true'); });
  await page.goto('/');
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js', domPath = '/node_modules/.vite/deps/react-dom_client.js';
    const teamPath = '/src/components/platform/settings/TeamSettings.tsx', fixturePath = '/src/tests/helpers/componentFixtures.ts';
    const [{ default: React }, { default: { createRoot } }, { default: TeamSettings }, { setComponentWorkspace }] = await Promise.all([
      import(reactPath), import(domPath), import(teamPath), import(fixturePath),
    ]);
    setComponentWorkspace('owner');
    const container = document.createElement('div'); container.id = 'team-fixture'; document.body.appendChild(container);
    createRoot(container).render(React.createElement(TeamSettings));
  });
  const team = page.locator('#team-fixture');
  const role = team.getByRole('button', { name: inlineEditName('Edit Role of member-א') });
  await role.focus(); await role.press('Enter');
  const choice = team.getByRole('combobox', { name: 'Role of member-א' });
  await choice.selectOption('bookkeeper'); await choice.press('Enter');
  await expect(role).toHaveText('Bookkeeper');
  expect(writes.filter(write => write.method === 'PATCH')).toHaveLength(1);
  const email = team.getByRole('textbox', { name: 'Invite team member email' });
  await email.fill('person@example.test'); await email.press('Enter');
  await expect(email).toHaveValue('');
  expect(writes.filter(write => write.method === 'POST')).toHaveLength(1);
  const revoke = team.getByRole('button', { name: 'Revoke', exact: true });
  await revoke.focus(); await revoke.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Remove member-א?' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  await dialog.getByRole('button', { name: 'Cancel' }).focus(); await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(revoke).toBeFocused();
  expect(writes.filter(write => write.method === 'DELETE')).toHaveLength(0);
  await revoke.press('Enter'); await dialog.getByRole('button', { name: 'Remove member' }).focus(); await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  expect(writes.filter(write => write.method === 'DELETE')).toHaveLength(1);
});
