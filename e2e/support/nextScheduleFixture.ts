import { expect, type Page } from '@playwright/test';
import { openComparison, pressAt, workspaceId } from './comparisonReportFixture';
import { book, dbRows, history, reps, stockPlaces } from './nextScheduleBook';
import { nextSchedules, type NextSchedule } from './nextSchedules';
import { setLedgerField } from './journeyFixture';
import { tabTo } from './tabTo';

const dates = { startDate: '2026-02-01', endDate: '2026-02-28', asOfDate: '2026-02-28', compareStartDate: '2026-01-01', compareEndDate: '2026-01-31' };
export async function openNextSchedule(page: Page, id: NextSchedule, width: number, theme: 'light' | 'dark') {
  const result = await openComparison(page, { module: `/src/components/reporting/${nextSchedules[id]}.tsx`, props: dates }, width, theme, 'viewer', { ledger: book, api: ({ url, method }) => {
    const path = new URL(url);
    if (method === 'GET' && path.pathname === '/api/v1/reports/inventory-details' && path.searchParams.get('workspaceId') === workspaceId && path.searchParams.get('startDate') === '1900-01-01') return { json: { items: history } };
    return null;
  } }, async () => {
    await setLedgerField(page, 'dimensionNodes', stockPlaces);
    await page.evaluate(async reps => {
      const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
      useAuthStore.setState(s => ({ workspaces: s.workspaces.map(w => ({ ...w, salesReps: reps })) }));
    }, reps);
    for (const [collection, rows] of Object.entries(dbRows)) await page.route(`**/rest/v1/${collection}?*`, route => {
      const query = new URL(route.request().url()).searchParams;
      return route.fulfill({ json: query.get('workspace_id') === `eq.${workspaceId}` && !Number(query.get('offset')) ? rows.map(data => ({ id: data.id, data })) : [] });
    });
  });
  if (id === 'cycle-count') await pressAt(page, page.getByRole('button', { name: result.he ? 'פתיחת דף הספירה' : 'Open the count sheet' }));
  if (id === 'party-linked-trial-balance') await pressAt(page, page.locator('select[data-record-kind]'), 'ArrowDown');
  if (id === 'tax-code-suggestions') await pressAt(page, page.locator('summary'));
  if (id === 'us-filing-calendar') { await tabTo(page, page.getByRole('textbox').first()); await page.keyboard.type('TX'); }
  if (id === 'rule-pack-coverage') await pressAt(page, page.getByRole('combobox').first(), 'i');
  await expect(page.locator('table:visible tbody tr').first()).toBeVisible();
  if (id === 'stock-value-by-location-lot') await expect(page.getByRole('table').last()).toContainText('LOT-א');
  return result;
}
