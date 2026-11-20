import type { Page } from '@playwright/test';
import { openComparison, workspaceId } from './comparisonReportFixture';
import { loadReportFonts, installReportFonts } from './reportFonts';
import { operationsScreens, type OperationsScreen } from './operationsScreens';
import { database, ledger, openItem, order, orders, run, workspace } from './operationsBook';
import { stockPlaces } from './nextScheduleBook';
import type { JourneyApiHandler, JourneyMount } from './journeyFixture';

const dates = { startDate: '2026-02-01', endDate: '2026-02-28' };
const overrides: Partial<Record<OperationsScreen, Omit<JourneyMount, 'module'>>> = {
  OpeningDocumentsDialog: { props: { side: 'customer' } },
  PayRunHistory: {
    exportName: 'PayRunHistory',
    props: { payRuns: [run], canRunPayroll: true, onDone: '__fn:noop', onError: '__fn:noop' },
  },
  DirectDepositDialog: { exportName: 'DirectDepositDialog', props: { run, workspace } },
  PayrollImportDialog: {
    props: {
      workspaceId,
      accounts: [...ledger.accounts, { id: 'owed', name: 'Payroll owed', type: 'liability' }],
      dimensions: [],
      currency: 'USD',
    },
  },
  StockCountDialog: { props: { workspaceId, items: [ledger.inventory[0]], accounts: ledger.accounts, currency: 'USD' } },
  StockHistoryDialog: { props: { workspaceId, item: ledger.inventory[0], currency: 'USD' } },
  MigrationTrialBalanceProof: { exportName: 'MigrationTrialBalanceProof', props: { workspaceId } },
  ExpenseBillCategories: {
    props: { ...dates, accounts: ledger.accounts, bills: ledger.bills, workspaceId, loading: false, incomplete: false },
  },
  OrderInvoiceDialog: {
    props: {
      estimate: order,
      progress: { totalCents: 20000, invoicedCents: 0, leftCents: 20000, invoices: [] },
      currency: 'USD',
      onCreate: '__capture:create',
    },
  },
  SerialLotLookupReportView: { props: { purchaseOrders: orders } },
};
const api: JourneyApiHandler = ({ url, method }) => {
  const { pathname } = new URL(url);
  if (pathname === `/api/v1/workspaces/${workspaceId}/time` && method === 'GET')
    return {
      json: {
        canApprove: true,
        entries: [
          {
            id: 't1',
            workspaceId,
            person: 'journey-user',
            date: '2026-02-08',
            description: 'Fit valve',
            minutes: 90,
            billable: true,
            status: 'open',
            customerId: 'c',
          },
        ],
      },
    };
  if (pathname === '/api/v1/open-items/preview' && method === 'POST')
    return { json: { status: 'success', rows: [openItem], openTotalCents: 1250 } };
  if (pathname.endsWith('/trial-balance'))
    return {
      json: {
        accounts: [
          { id: 'bank', name: 'Cash', debit: 1250, credit: 0 },
          { id: 'rev', name: 'Sales', debit: 0, credit: 1250 },
        ],
        totalDebit: 1250,
        totalCredit: 1250,
        isBalanced: true,
      },
    };
  if (pathname.endsWith('/profit-and-loss'))
    return {
      json: {
        income: { total: -1250, accounts: { rev: { name: 'Sales', balance: -1250 } } },
        expense: { total: 0, accounts: {} },
        cogs: { total: 0, accounts: {} },
        grossProfit: -1250,
        netIncome: -1250,
      },
    };
  if (pathname.endsWith('/balance-sheet'))
    return {
      json: {
        assets: { bank: 1250 },
        liabilities: {},
        equity: {},
        totalAssets: 1250,
        totalLiabilities: 0,
        totalEquity: 0,
        netIncome: 1250,
        totalClaims: 1250,
        isBalanced: true,
      },
    };
  if (pathname.includes('/aging')) return { json: { current: 1250, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 1250 } };
  return null;
};
export async function openOperationsScreen(
  page: Page,
  id: OperationsScreen,
  width: number,
  theme: 'light' | 'dark',
  role: 'viewer' | 'accountant' = 'accountant',
) {
  await installReportFonts(page);
  const state = await openComparison(
    page,
    { module: operationsScreens[id], props: dates, ...overrides[id] },
    width,
    theme,
    role,
    { ledger, api },
    async () => {
      await loadReportFonts(page);
      await page.evaluate(
        async ({ workspace, places }) => {
          const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
          const { useLedgerStore } = await import('/src/stores/useLedgerStore.ts');
          const { auth } = await import('/src/firebase.ts');
          auth.currentUser = useAuthStore.getState().user;
          useAuthStore.setState((s) => ({ workspaces: s.workspaces.map((w) => ({ ...w, ...workspace })) }));
          useLedgerStore.setState({ dimensionNodes: places } as never);
          localStorage.setItem('lf_petty_cash_' + workspace.id, JSON.stringify({ boxAccountId: 'bank' }));
        },
        { workspace, places: stockPlaces },
      );
      for (const [collection, rows] of Object.entries(database))
        await page.route(`**/rest/v1/${collection}?*`, (route) => {
          const query = new URL(route.request().url()).searchParams;
          return route.fulfill({
            json:
              query.get('workspace_id') === `eq.${workspaceId}` && !Number(query.get('offset'))
                ? rows.map((data) => ({ id: data.id, data }))
                : [],
          });
        });
    },
  );
  const upload = (file: string, text: string) =>
    page
      .locator('input[type=file]')
      .first()
      .setInputFiles({ name: file, mimeType: 'text/csv', buffer: Buffer.from(text) });
  switch (id) {
    case 'PriceListImportView':
      await page.locator('textarea').fill('Item,List,Price\nV-7,Wholesale,12.50\nMissing,Wholesale,1');
      await page.getByRole('button', { name: 'Read the file' }).press('Enter');
      break;
    case 'OpeningDocumentsDialog':
      await page.locator('textarea').fill('Dana דנה\tOPEN-3\t2026-01-10\t2026-02-15\t12.50');
      await page.getByRole('button', { name: /Check/ }).press('Enter');
      break;
    case 'PayrollImportDialog':
      await upload(
        'gusto.csv',
        'Pay Date,Employee,Employee ID,Department,Gross Earnings,Employee Taxes,Employee Deductions,Net Pay,Employer Taxes,Employer Contributions\n02/15/2026,Noa,E1,Shop,4000,800,200,3000,306,120',
      );
      await page.locator('fieldset select').first().waitFor();
      for (const select of await page.locator('fieldset select').all()) await select.selectOption({ index: 1 });
      break;
    case 'MigrationTrialBalanceProof':
      await upload('balance.csv', 'Account,Debit,Credit\nCash,12.50,\nSales,,12.50');
      await page.locator('input[type=date]').fill('2026-02-28');
      await page.getByRole('button', { name: /Compare/ }).press('Enter');
      break;
    case 'PayrollView':
      await page.getByRole('button', { name: /Employee Directory/ }).press('Enter');
      break;
    case 'ExpenseBillCategories':
      await page.locator('button[aria-controls="expense-category-account-list"]').press('Enter');
      break;
    case 'RecordNotesReportView':
      await page.locator('input[type=search]').first().fill('delivery');
      break;
    case 'WarrantyRegisterPanel':
      await page.locator('select').first().selectOption('all');
      break;
    case 'ReportPackDialog':
      await page.getByRole('button', { name: 'Prepare pack' }).press('Enter');
      break;
    case 'AccountantExportPackView':
      await page
        .locator('button')
        .filter({ hasText: /Prepare|הכנת/ })
        .first()
        .press('Enter');
      break;
  }
  return state;
}
