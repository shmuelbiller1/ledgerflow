import { expect, test } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';

for (const width of [390, 1280]) {
  test(`list import only sends the reviewed retry file after a broken replacement (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const workspaceId = 'list-import-browser-fixture';
    const { requests, errors } = await mountJourney(page, {
      workspaceId,
      ledger: {},
      mounts: [{ module: '/src/components/platform/settings/ImportSettings.tsx' }],
      api: ({ url }) => url.endsWith('/import-records')
        ? { json: { created: 1, skipped: [], openingStockCents: 0, dryRun: false, batchId: 'imp_retry' } }
        : null,
    });
    const panel = page.getByRole('region', { name: 'Import data', exact: true });
    const picker = panel.getByLabel(/choose the file/i);
    const table = panel.getByRole('table', { name: 'First rows to import' });
    const importButton = panel.getByRole('button', { name: 'Import 1 customers' });
    const upload = (name: string, text: string) => picker.setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });

    await upload('old.csv', 'Name,Email\nOld House,old@example.test');
    await expect(table).toContainText('Old House');
    await expect(importButton).toBeEnabled();
    await upload('broken.csv', 'Name,Email\n"Unclosed');
    await expect(panel.getByRole('alert')).toContainText('broken.csv could not be read');
    await expect(table).toHaveCount(0);
    await expect(importButton).toHaveCount(0);
    expect(requests).toHaveLength(0);

    await upload('retry.csv', 'Name,Email\nNew House,new@example.test');
    await expect(table).toContainText('New House');
    await expect(table).not.toContainText('Old House');
    await importButton.click();
    await expect(panel.getByRole('button', { name: 'Undo this import' })).toBeVisible();
    await expect(table).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe(`/api/v1/workspaces/${workspaceId}/import-records`);
    expect(requests[0].body).toEqual({ kind: 'customers', rows: [{ name: 'New House', email: 'new@example.test' }], dryRun: false });
    expect(errors).toEqual([]);
  });
}
