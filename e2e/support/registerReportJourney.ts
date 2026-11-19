import { expect, type Page } from '@playwright/test';
import { downloadAt, inspectComparison, item, pressAt } from './comparisonReportFixture';
import { remountJourney, setLedgerField } from './journeyFixture';
import { books, fullBills, openRegister, registerLedger } from './registerReportFixture';

const buttons = (page: Page, he: boolean) => ({
  columns: page.getByRole('button', { name: he ? 'עמודות' : 'Columns', exact: true }),
  displayed: page.getByRole('button', { name: he ? 'ייצוא השורות המוצגות ל־CSV' : 'Export displayed rows CSV' }),
});
const earlier = (name: string, he: boolean) => he ? `הקדמת העמודה ${name}` : `Move ${name} earlier`;

export async function checkItemRegister(page: Page, width: number, theme: 'light' | 'dark') {
  const { he, errors } = await openRegister(page, 'items', width, theme);
  const table = page.getByRole('table'), headers = table.getByRole('columnheader');
  const { columns, displayed } = buttons(page, he);
  const financial = page.getByRole('button', { name: he ? 'ייצוא מגמות פריטים ל-CSV' : 'Export item trends CSV' });
  const load = page.getByRole('button', { name: he ? 'טעינה / רענון של ההיסטוריה המלאה' : 'Load / refresh full history' });
  const labels = he ? ['פריט', 'חלון', 'חודש', 'סכום השורה', 'מטבע', 'יחידות', 'שורות פריטים'] : ['Item', 'Window', 'Month', 'Line amount', 'Currency', 'Units', 'Item lines'];
  const curr = he ? 'נוכחית' : 'Current', prev = he ? 'קודמת' : 'Previous';
  await expect(headers).toHaveText(labels);
  await expect(table.getByRole('rowheader')).toHaveText([item, item, item]);
  await expect(table.locator('tbody tr').first().getByRole('cell')).toHaveText([curr, '2026-01', '$12.50', 'USD', '0.75', '2']);
  await expect(financial).toBeDisabled();
  if (width === 390) await expect(table.getByRole('rowheader').first()).toHaveCSS('position', 'sticky');
  await inspectComparison(page, `purchase-item-register-${width}-${theme}`);
  await pressAt(page, columns);
  const templates = page.getByText(he ? 'תבניות ייצוא' : 'Export templates', { exact: true });
  await expect(displayed).toHaveCount(0); await expect(templates).toHaveCount(0);
  await pressAt(page, page.getByRole('button', { name: earlier(labels[3], he) }));
  await pressAt(page, page.getByRole('checkbox', { name: labels[5], exact: true }), 'Space');
  const visible = [labels[0], labels[1], labels[3], labels[2], labels[4], labels[6]];
  await expect(headers).toHaveText(visible);

  const reads: string[] = [];
  await page.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('workspace_id')).toBe(`eq.${books}`);
    const collection = url.pathname.split('/').at(-1)!; reads.push(collection);
    const data = collection === 'bills' ? fullBills : registerLedger.inventory;
    return route.fulfill({ json: data.map(row => ({ id: row.id, data: row })) });
  });
  await pressAt(page, load, 'Enter', true);
  await expect(financial).toBeEnabled(); await expect(templates).toBeVisible();
  expect(reads).toHaveLength(2);
  expect(reads).toEqual(expect.arrayContaining(['bills', 'inventory']));
  const ledger = await downloadAt(page, financial);
  expect(ledger.name).toBe('purchase-items-2026-02-28.csv');
  expect(ledger.rows).toEqual([
    ['Window', 'Month', 'Item ID', 'Item', 'Currency', 'Units', 'Line amount (minor units)', 'Item lines'],
    ['Current', '2026-01', 'valve', item, 'USD', '0.75', '1250', '2'], ['Current', '2026-02', 'valve', item, 'EUR', '2', '3640', '1'],
    ['Current', '2026-02', 'valve', item, 'USD', '1.5', '1815', '1'], ['Previous', '2026-01', 'valve', item, 'USD', '0.75', '1250', '2'],
  ]);
  expect((await downloadAt(page, displayed)).rows).toEqual([visible,
    [item, curr, '$12.50', '2026-01', 'USD', '2'], [item, curr, '€36.40', '2026-02', 'EUR', '1'],
    [item, curr, '$18.15', '2026-02', 'USD', '1'], [item, prev, '$12.50', '2026-01', 'USD', '2'],
  ]);
  // A new mount must re-confirm the data, but not forget the user's column choices.
  const mount = { module: '/src/components/reporting/PurchaseItemTrendsView.tsx', props: { endDate: '2026-02-28', compareEndDate: '2026-01-31' } };
  await remountJourney(page, []); await expect(table).toHaveCount(0);
  await remountJourney(page, [mount]); await expect(headers).toHaveText(visible); await expect(financial).toBeDisabled();
  await remountJourney(page, [{ ...mount, props: { ...mount.props, compareEndDate: '' } }]);
  await expect(headers).toHaveText(labels.filter((_, i) => i !== 1));
  expect(errors).toEqual([]);
}

export async function checkReceiptRegister(page: Page, width: number, theme: 'light' | 'dark') {
  const urls: string[] = [];
  let reply: Record<string, unknown> = {};
  const { he, errors } = await openRegister(page, 'receipts', width, theme, request => {
    if (!request.url.includes('/reports/payment-methods?')) return null;
    urls.push(request.url); return { json: reply };
  });
  const cardLabel = he ? 'כרטיס' : 'Card', cashLabel = he ? 'מזומן' : 'Cash';
  const table = page.getByRole('table', { name: he ? 'תקבולי לקוחות לפי אמצעי תשלום' : 'Customer receipts by method', exact: true });
  const financial = page.getByRole('button', { name: he ? 'הורדת CSV לפי אמצעי תשלום' : 'Download payment method CSV' });
  const { columns, displayed } = buttons(page, he);
  const labels = he ? ['שיטה', 'תשלומים', 'התקבל', 'כולל ללא תאריך', 'תקבולים קודמים / שינוי'] : ['Method', 'Payments', 'Received', 'Undated included', 'Previous receipts / change'];
  await expect(table.getByRole('columnheader')).toHaveText(labels);
  await expect(table.getByRole('cell')).toHaveText(['2', '$42.50', '0', '$9.75 / $32.75']);
  if (width === 390) await expect(table.getByRole('rowheader')).toHaveCSS('position', 'sticky');
  await inspectComparison(page, `receipt-methods-${width}-${theme}`);
  const ledger = await downloadAt(page, financial);
  expect(ledger.name).toBe('payment-methods-in-out-2026-02-01-to-2026-02-28.csv');
  expect(ledger.rows).toEqual([['Method', 'Currency', 'Received count', 'Received amount', 'Paid count', 'Paid amount'],
    ['card', 'EUR', '1', '15.00', '0', '0.00'], ['card', 'USD', '1', '12.50', '0', '0.00'], ['check', 'USD', '0', '0.00', '1', '23.00']]);
  await pressAt(page, columns, 'Enter', true);
  await pressAt(page, page.getByRole('button', { name: earlier(labels[2], he) }));
  await pressAt(page, page.getByRole('checkbox', { name: labels[3], exact: true }), 'Space');
  const visible = [labels[0], labels[2], labels[1], labels[4]];
  expect((await downloadAt(page, displayed, true)).rows).toEqual([visible, [cardLabel, '$42.50', '2', '$9.75 / $32.75']]);

  // Both files close on a cap. Only *receipts* can reopen using the authoritative receipts reply.
  await setLedgerField(page, 'truncatedCollections', { payments: true });
  await expect.poll(() => urls.length).toBeGreaterThan(0);
  await expect(financial).toBeDisabled(); await expect(displayed).toHaveCount(0);
  expect(Object.fromEntries(new URL(urls[0]).searchParams)).toEqual({ workspaceId: books, startDate: '2026-02-01', endDate: '2026-02-28', compareStartDate: '2026-01-01', compareEndDate: '2026-01-31' });
  const card = { id: 'card', name: 'card', count: 5, cents: 8800, undated: 0 };
  reply = { rows: [card], previousRows: [{ ...card, cents: 1000 }, { ...card, id: 'cash', name: 'cash', cents: 600 }], provenance: { source: 'server', completeness: 'complete' } };
  await setLedgerField(page, 'payments', registerLedger.payments.map((p, i) => i ? p : { ...p, amountCents: 1251 }));
  await expect(table.getByRole('rowheader')).toHaveText([cardLabel, cashLabel]);
  await expect(financial).toBeDisabled();
  expect((await downloadAt(page, displayed)).rows).toEqual([visible, [cardLabel, '$88.00', '5', '$10.00 / $78.00'], [cashLabel, '$0.00', '0', '$6.00 / -$6.00']]);
  await setLedgerField(page, 'truncatedCollections', {}); await setLedgerField(page, 'payments', []);
  await expect(page.getByRole('table')).toHaveCount(0); await expect(page.getByRole('button')).toHaveCount(1);
  await pressAt(page, page.getByRole('button', { name: he ? 'פתיחת מכירות' : 'Open Sales' }));
  await expect(page).toHaveURL(/#sales$/); expect(errors).toEqual([]);
}
