import { inlineEditName } from '../src/tests/helpers/inlineEditName';
import { test, expect } from '@playwright/test';

type Rule = { id: string; uid: string; workspaceId: string; name: string; groupName: string; groupIsActive?: boolean; priority: number; isActive: boolean; condition: { descriptionContains: string }; action: { addTags: string[] }; confidence: number; isHardened: boolean; createdAt: string };
let records: Rule[];
let refuse = false;
let errors: string[];

test.beforeEach(async ({ page }) => {
  errors = []; refuse = false;
  page.on('pageerror', error => errors.push(error.message));
  records = ['AWS', 'Paused'].map((name, i) => ({ id: `rule-${i}`, uid: 'rules-user', workspaceId: 'rules-browser', name,
    groupName: 'תוכנה / SaaS', priority: (i + 1) * 10, isActive: i === 0, condition: { descriptionContains: 'AWS' }, action: { addTags: ['cloud'] }, confidence: 1, isHardened: true, createdAt: '2026-10-01' }));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'POST') return route.fulfill({ status: 200, json: {} });
    const body = request.postDataJSON() as { input?: Record<string, unknown> };
    const input = body.input || {};
    if (pathname === '/api/v1/commands/autorule.group') {
      if (refuse) return route.fulfill({ status: 403, json: { status: 'error', message: 'Rule save refused', code: 'FORBIDDEN' } });
      const groupName = String(input.groupName || '');
      const newName = typeof input.newName === 'string' ? input.newName : undefined;
      const groupIsActive = typeof input.groupIsActive === 'boolean' ? input.groupIsActive : undefined;
      const ruleIds: string[] = [];
      records = records.map(rule => {
        if (rule.groupName !== groupName) return rule;
        ruleIds.push(rule.id);
        return { ...rule, ...(newName ? { groupName: newName } : {}), ...(groupIsActive !== undefined ? { groupIsActive } : {}) };
      });
      return route.fulfill({ status: 200, json: {
        status: 'success', command: 'autorule.group', replayed: false,
        data: { groupName: newName || groupName, ruleIds, ...(groupIsActive !== undefined ? { groupIsActive } : {}) },
      } });
    }
    if (pathname === '/api/v1/commands/autorule.update') {
      const ruleId = String(input.id || '');
      const data = input.data as Partial<Rule> | undefined;
      let saved: Rule | undefined;
      records = records.map(rule => {
        if (rule.id !== ruleId) return rule;
        saved = { ...rule, ...(data || {}) };
        return saved;
      });
      return route.fulfill({ status: 200, json: { status: 'success', command: 'autorule.update', data: { rule: saved }, replayed: false } });
    }
    return route.fulfill({ status: 200, json: {} });
  });
  await page.route('**/rest/v1/**', async route => {
    const url = route.request().url();
    if (url.includes('/rpc/lf_batch')) {
      if (refuse) { await route.fulfill({ status: 403, json: { message: 'Permission denied', code: '42501' } }); return; }
      const { p_ops } = route.request().postDataJSON() as { p_ops: { id: string; data: Partial<Rule> }[] };
      for (const op of p_ops) records = records.map(rule => rule.id === op.id ? { ...rule, ...op.data } : rule);
      await route.fulfill({ status: 200, json: null }); return;
    }
    if (url.includes('/rpc/lf_update')) {
      const { p_id, p_set } = route.request().postDataJSON() as { p_id: string; p_set: Partial<Rule> };
      records = records.map(rule => rule.id === p_id ? { ...rule, ...p_set } : rule);
      await route.fulfill({ status: 200, json: null }); return;
    }
    await route.fulfill({ status: 200, json: url.includes('/workspaces') ? [{ id: 'rules-browser', data: { uid: 'rules-user', name: 'Rules test', currency: 'USD', businessType: 'custom', createdAt: '2026-01-01' } }] : url.includes('/autoRules') ? records.map(rule => ({ id: rule.id, data: rule })) : [] });
  });
  await page.addInitScript(() => { localStorage.setItem('isGuest', 'true'); localStorage.setItem('has_seen_onboarding', 'true'); });
  await page.goto('/#settings');
  const guest = page.getByRole('button', { name: 'Continue as Guest' });
  if (await guest.isVisible()) await guest.click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const authPath = '/src/stores/useAuthStore.ts'; const uiPath = '/src/stores/useUIStore.ts';
    const { useAuthStore } = await import(authPath); const { useUIStore } = await import(uiPath);
    const user = { uid: 'rules-user', email: 'rules@example.test', isAnonymous: false, getIdToken: async () => 'fixture-token' };
    useAuthStore.setState({ user, isGuest: false, currentWorkspaceId: 'rules-browser', workspaces: [{ id: 'rules-browser', uid: user.uid, name: 'Rules test', currency: 'USD', businessType: 'custom', createdAt: '2026-01-01' }] });
    useUIStore.setState({ activeSettingsTab: 'rules' });
  });
  await expect(page.getByRole('button', { name: 'Enable group תוכנה / SaaS' })).toBeVisible();
});

test('keyboard rename retries a refused save, priority saves, and group toggle preserves individual state', async ({ page }) => {
  const rename = page.getByRole('button', { name: inlineEditName('Edit Name of group תוכנה / SaaS') });
  await rename.focus(); await page.keyboard.press('Enter');
  const draft = page.getByRole('combobox', { name: 'Name of group תוכנה / SaaS' });
  await expect(draft).toBeFocused(); await draft.fill('ענן / Cloud');
  refuse = true; await draft.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible(); await expect(draft).toHaveValue('ענן / Cloud');
  refuse = false; await draft.press('Enter');
  await expect(page.getByRole('button', { name: inlineEditName('Edit Name of group ענן / Cloud') })).toBeVisible();
  await page.getByRole('button', { name: inlineEditName('Edit Priority of AWS') }).click();
  const priority = page.getByRole('textbox', { name: 'Priority of AWS' });
  await priority.fill('0'); await priority.press('Enter');
  await expect(page.getByRole('button', { name: inlineEditName('Edit Priority of AWS') })).toContainText('Priority #0');
  const toggle = page.getByRole('button', { name: 'Enable group ענן / Cloud' });
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('checkbox', { name: 'Enable rule Paused' })).not.toBeChecked();
  await toggle.press('Enter'); await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('checkbox', { name: 'Enable rule Paused' })).not.toBeChecked();
  expect(records.every(rule => rule.groupName === 'ענן / Cloud')).toBe(true);
  expect(records[0].priority).toBe(0); expect(records[1].isActive).toBe(false); expect(errors).toEqual([]);
});

test('phone group controls have 44px targets and bounded content; rule editor Escape restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const groups = page.getByRole('region', { name: 'Rule groups' });
  for (const button of await groups.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Create Rule' }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Priority (lower runs first)')).toBeVisible();
  await dialog.getByLabel('Rule Name').fill('טיוטה / draft');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Rule' })).toBeFocused();
  expect(errors).toEqual([]);
});
