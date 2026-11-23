import { test, expect } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';

for (const width of [390, 1280]) test(`assistant sends a signed-in sandbox turn and offers draft review at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 });
  const sandbox = { id: 'draft-one', createdAt: '2026-11-23T00:00:00Z', expiresAt: '2026-11-24T00:00:00Z', pendingSteps: 0 };
  let opened = false;
  const { requests, errors } = await mountJourney(page, {
    workspaceId: 'assistant-browser', ledger: {},
    mounts: [{ module: '/src/components/intelligence/Copilot.tsx' }],
    api: ({ url, method }) => {
      if (url.endsWith('/sandboxes') && method === 'GET') return { json: { sandboxes: opened ? [sandbox] : [] } };
      if (url.endsWith('/sandboxes') && method === 'POST') { opened = true; return { json: { sandbox } }; }
      if (url.endsWith('/assistant/turn')) return { json: { status: 'success', answer: 'The draft is ready for review.', path: 'model', model: 'example-model' } };
      return null;
    },
  });
  await page.getByRole('button', { name: 'Start assistant' }).click();
  await expect(page.getByLabel('Draft workspace')).toBeVisible();
  await page.getByLabel('Your question').fill('Draft a bill for office supplies.');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('The draft is ready for review.')).toBeVisible();
  expect(requests.find(request => request.url.endsWith('/assistant/turn'))?.body).toEqual({ question: 'Draft a bill for office supplies.' });
  await page.getByRole('button', { name: 'Assistant drafts' }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('lf_assistant_review_assistant-browser'))).toBe('draft-one');
  expect(await page.evaluate(async () => (await import('/src/stores/useUIStore.ts')).useUIStore.getState().activeTab)).toBe('sandbox-review');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
