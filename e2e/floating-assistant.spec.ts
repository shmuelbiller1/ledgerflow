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

test('page context is optional, reviewable and never captures the form value', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const { requests } = await mountJourney(page, {
    workspaceId: 'page-context', ledger: {}, mounts: [{ module: '/src/components/intelligence/FloatingAssistant.tsx' }],
    api: ({ url }) => {
      if (url.endsWith('/sandboxes')) return { json: { sandboxes: [{ id: 'draft-1', createdAt: '2026-11-23T00:00:00Z', expiresAt: '2026-11-24T00:00:00Z', pendingSteps: 0 }] } };
      if (url.endsWith('/assistant/turn')) return { json: { status: 'success', answer: 'Check that invoice.', path: 'model' } };
      return null;
    },
  });
  await page.evaluate(() => {
    const main = document.createElement('main'); main.id = 'main-content';
    main.innerHTML = '<h1>Invoice INV-123</h1><p>Acme owes 100</p><input aria-label="Private note" value="unsaved secret">';
    document.body.prepend(main);
  });
  await page.getByRole('button', { name: 'AI assistant' }).click();
  const panel = page.getByRole('dialog', { name: 'Floating AI assistant' });
  await expect(panel.getByLabel('Draft workspace')).toBeVisible();
  await panel.getByLabel('Share page text with the assistant').check();
  await panel.getByRole('button', { name: 'Capture page text' }).click();
  const preview = panel.getByLabel('Page text to share');
  await expect(preview).toHaveValue(/Invoice INV-123/);
  await expect(preview).not.toHaveValue(/unsaved secret/);
  await preview.fill('Invoice INV-123, Acme owes 100');
  await panel.getByLabel('Your question').fill('What is this invoice?');
  await panel.getByRole('button', { name: 'Send question' }).click();
  await expect(panel.getByText('Check that invoice.')).toBeVisible();
  const body = requests.find(request => request.url.endsWith('/assistant/turn'))?.body as { question: string };
  expect(body.question).toContain('Invoice INV-123, Acme owes 100');
  expect(body.question).not.toContain('unsaved secret');
});

test('a viewer can ask about live books without starting a draft', async ({ page }) => {
  const { requests, errors } = await mountJourney(page, {
    workspaceId: 'viewer-books', ownerUid: 'another-owner', role: 'viewer', ledger: {},
    mounts: [{ module: '/src/components/intelligence/FloatingAssistant.tsx' }],
    api: ({ url }) => url.endsWith('/sandboxes/assistant/turn') ? { json: { status: 'success', answer: 'Acme is a customer.', path: 'code' } } : null,
  });
  await page.getByRole('button', { name: 'AI assistant' }).click();
  const panel = page.getByRole('dialog', { name: 'Floating AI assistant' });
  await expect(panel.getByText(/Viewers can read but cannot create drafts/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Start assistant' })).toHaveCount(0);
  await panel.getByLabel('Your question').fill('Find customer Acme');
  await panel.getByRole('button', { name: 'Send question' }).click();
  await expect(panel.getByText('Acme is a customer.')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain('/viewer-books/sandboxes/assistant/turn');
  expect(requests[0].body).toEqual({ question: 'Find customer Acme' });
  expect(errors).toEqual([]);
});
