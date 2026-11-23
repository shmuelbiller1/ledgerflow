import { test, expect } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';

for (const width of [390, 1280]) test(`floating assistant preserves page work and can be moved and resized ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 });
  const { errors, requests } = await mountJourney(page, {
    workspaceId: 'floating-assistant', ledger: {},
    mounts: [{ module: '/src/components/intelligence/FloatingAssistant.tsx' }],
    api: ({ url }) => url.endsWith('/sandboxes') ? { json: { sandboxes: [] } } : null,
  });
  await page.evaluate(() => {
    const input = document.createElement('input'); input.setAttribute('aria-label', 'Unsaved invoice note');
    document.body.prepend(input);
  });
  const invoice = page.getByLabel('Unsaved invoice note');
  await invoice.fill('A draft that stays here');
  await page.getByRole('button', { name: 'AI assistant' }).click();
  const panel = page.getByRole('dialog', { name: 'Floating AI assistant' });
  await expect(panel.getByRole('button', { name: 'Start assistant' })).toBeVisible();
  await panel.getByLabel('Your question').fill('open sales');
  await panel.getByRole('button', { name: 'Send question' }).click();
  const link = panel.getByRole('link', { name: 'Open sales in a new tab' });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(invoice).toHaveValue('A draft that stays here');
  const before = await panel.boundingBox();
  await panel.getByRole('button', { name: 'Make assistant smaller' }).click();
  const smaller = await panel.boundingBox();
  expect(smaller!.width).toBeLessThan(before!.width);
  const move = panel.getByRole('button', { name: /Move assistant/ });
  const dragBox = await move.boundingBox();
  const panelBeforeDrag = await panel.boundingBox();
  await page.mouse.move(dragBox!.x + 15, dragBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(dragBox!.x + 45, dragBox!.y + 30, { steps: 4 });
  await page.mouse.up();
  expect((await panel.boundingBox())!.x).not.toBe(panelBeforeDrag!.x);
  await move.focus();
  await page.keyboard.press('ArrowLeft');
  const moved = await panel.boundingBox();
  expect(moved!.x).toBeGreaterThanOrEqual(0);
  expect(moved!.x + moved!.width).toBeLessThanOrEqual(width);
  await panel.getByRole('button', { name: 'Minimize assistant' }).click();
  await expect(invoice).toHaveValue('A draft that stays here');
  await page.getByRole('button', { name: 'AI assistant' }).click();
  await expect(panel.getByRole('link', { name: 'Open sales in a new tab' })).toBeVisible();
  expect(requests).toEqual([]); // a page shortcut never sends the page, form or question to the model
  expect(errors).toEqual([]);
});
