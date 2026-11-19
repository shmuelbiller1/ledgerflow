import { expect, type Page } from '@playwright/test';
import type { JourneyMount } from './journeyFixture';
import { openComparison, workspaceId } from './comparisonReportFixture';

const item = 'Valve ברז';
const project = 'Pier רציף';
const line = (accountName: string, project: string, amountCents: number) => ({ accountName, accountId: accountName, project, amountCents, debitCents: Math.max(0, amountCents), creditCents: Math.max(0, -amountCents) });
const transactions = [{ id: 'tx1', workspaceId, date: '2026-02-03', status: 'posted', lines: [
  line('Revenue', project, -12500), line('Expense', project, 3125), line('Expense', 'Jetty', 1575),
] }];
const order = (id: string, quantity: number, orderedAt: string) => ({ workspaceId, id, number: id, orderedAt, status: 'accepted', customerName: 'Dana דנה', lines: [{ itemId: 'v', quantity, description: item }] });
const ledger = {
  transactions, projects: [{ id: 'p', workspaceId, name: project }],
  inventory: [{ workspaceId, id: 'v', name: item, sku: 'V-7', category: 'Parts חלקים', quantityAtHand: 5, unitCostCents: 750 }, { workspaceId, id: 'g', sku: 'G-8', name: 'Gauge מד' }],
  invoices: [{ id: 'inv1', workspaceId, date: '2026-02-04', status: 'paid', currency: 'EUR', exchangeRate: 1.25, amountCents: 4000, items: [{ itemId: 'v', quantity: 2, amountCents: 4000 }] }],
  estimates: [order('SO-1', 3, '2026-02-01'), order('SO-2', 4, '2026-02-02')],
};
const details = { itemId: 'v', itemName: item, opening: { quantity: 4, valueCents: 3000 }, moves: [
  { key: 'm1', kind: 'purchase', date: '2026-02-02', quantity: 2, quantityAfter: 6, valueCents: 1500, unitCostCents: 750, transactionId: 'entry-buy' },
  { key: 'm2', kind: 'sale', date: '2026-02-04', quantity: -2, quantityAfter: 4, valueCents: -1500, unitCostCents: 750, transactionId: 'entry-sale' },
], received: 2, issued: 2, closing: { quantity: 4, valueCents: 3000 } };
const aging = { itemId: 'v', itemName: item, quantity: 4, valueCents: 3000, buckets: { d30: 2, d90: 1, d180: 0, d365: 0, older: 0 }, unknownAge: 1, lastSold: '2026-02-04', daysSinceSold: 24 };
const time = [45, 35].map((minutes, i) => ({ id: `t${i}`, workspaceId, projectId: 'p', date: '2026-02-05', person: 'Avi אבי', minutes, billable: !i, status: i ? 'open' : 'submitted' }));
const transfer = (id: string, kind: string, date: string, quantity: number, locationId: string) => ({ id, data: { workspaceId, itemId: 'v', itemName: item, date, kind, quantity, locationId, createdAt: date, seq: id } });
const stockMoves = [transfer('o1', 'transfer-out', '2026-02-06', -2, 'East'), transfer('i1', 'transfer-in', '2026-02-06', 2, 'West'), transfer('o2', 'transfer-out', '2026-02-07', -1, 'West')];
const po = { id: 'po', data: { workspaceId, status: 'approved', items: [{ itemId: 'v', quantity: 8, receivedQuantity: 2 }] } };
const report = (view: string, props?: JourneyMount['props']) => ({ module: `/src/components/reporting/${view}ReportView.tsx`, props });
const screens = {
  projects: { module: '/src/components/ledger/ProjectProfitabilityView.tsx', props: { transactions, formatCurrency: '__fn:formatCurrency' } },
  time: report('TimeByProject'), sales: report('SalesByItem', { selectedYear: 2026 }), groups: report('GrossMarginByItemGroup'),
  inactive: report('InactiveItems', { endDate: '2026-06-30', compareEndDate: '2026-03-01' }), backorders: report('Backorders'),
  details: report('InventoryDetails'), aging: report('StockAging'), turnover: report('InventoryTurnover'), transfers: report('StockTransfers'),
};
export type Schedule = keyof typeof screens;
export const schedules = Object.keys(screens) as Schedule[];

/** Ten distinct production modules. Only I/O is stubbed; filters, aggregations, columns and CSVs are real. */
export async function openSchedule(page: Page, screen: Schedule, width: number, theme: 'light' | 'dark') {
  const result = await openComparison(page, screens[screen], width, theme, screen === 'time' ? 'accountant' : 'viewer', { ledger, api: ({ url, method }) => {
    const path = new URL(url);
    if (method !== 'GET') return null;
    if (path.pathname === `/api/v1/workspaces/${workspaceId}/time`) return { json: { entries: time } };
    if (path.searchParams.get('workspaceId') !== workspaceId) return null;
    if (path.pathname === '/api/v1/reports/inventory-details') return { json: { items: [details] } };
    if (path.pathname === '/api/v1/reports/stock-aging') return { json: { items: [aging] } };
    return null;
  } }, async () => {
    for (const [collection, records] of [['stockMoves', stockMoves], ['purchaseOrders', [po]]] as const) {
      await page.route(`**/rest/v1/${collection}?*`, route => {
        const query = new URL(route.request().url()).searchParams;
        return route.fulfill({ json: query.get('workspace_id') === `eq.${workspaceId}` ? records : [] });
      });
    }
  });
  await expect(page.locator('table tbody tr').last()).toBeVisible();
  await expect(page.locator('table').last()).toContainText(screen === 'projects' || screen === 'time' ? project : screen === 'groups' ? 'Parts חלקים' : item);
  return result;
}
