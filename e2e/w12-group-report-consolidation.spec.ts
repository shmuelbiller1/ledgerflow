import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { mountJourney, settleStyles } from './support/journeyFixture';

/**
 * F-47 · W12 (RELEASE_GATE): Group report across several books, in the browser.
 *
 * Exercises the complete consolidation workflow in `GroupSummaryReportView`:
 *   1. Loads a two-company multi-currency group (`Parent US` in USD + `Dublin EU` in EUR)
 *   2. Selects `USD` under `In one currency` and clicks `Fill from the rate service for EUR`
 *   3. Verifies translation rates are fetched (`/api/v1/currency/historical` + `/timeframe`),
 *      persisted (`PUT /api/v1/account/groups/:id/rates`), and rendered with `of which translation difference`,
 *      intercompany receivable/payable eliminations, and intercompany sales eliminations
 *   4. Enables `Account by account`, clicks `Export CSV`, and proves byte-for-byte figure parity
 *      between the rendered screen tables and the downloaded CSV file.
 */

const WORKSPACE = 'w12-browser';
const GROUP_ID = 'grp-atlantic';

function buildSummaryPayload(translated: boolean, includeAccountLines: boolean) {
  const usFigures = {
    income: 1200000,
    cogs: 300000,
    grossProfit: 900000,
    expense: 250000,
    netIncome: 650000,
    totalAssets: 2500000,
    totalLiabilities: 400000,
    totalEquity: 2100000,
  };
  const euNativeFigures = {
    income: 800000,
    cogs: 200000,
    grossProfit: 600000,
    expense: 150000,
    netIncome: 450000,
    totalAssets: 1500000,
    totalLiabilities: 500000,
    totalEquity: 1000000,
  };
  const euTranslatedUsd = {
    income: 864000,
    cogs: 216000,
    grossProfit: 648000,
    expense: 162000,
    netIncome: 486000,
    totalAssets: 1650000,
    totalLiabilities: 550000,
    totalEquity: 1100000,
    cta: 14000,
  };

  return {
    group: { id: GROUP_ID, name: 'Atlantic Holdings Group' },
    members: [
      {
        workspaceId: 'ws-us',
        name: 'Parent US',
        currency: 'USD',
        isBalanced: true,
        ...usFigures,
        ...(translated ? { translated: { ...usFigures, cta: 0 } } : {}),
      },
      {
        workspaceId: 'ws-eu',
        name: 'Dublin EU',
        currency: 'EUR',
        isBalanced: true,
        ...euNativeFigures,
        ...(translated ? { translated: euTranslatedUsd } : {}),
      },
    ],
    total: translated
      ? {
          currency: 'USD',
          income: 1864000,
          cogs: 316000,
          grossProfit: 1548000,
          expense: 412000,
          netIncome: 1136000,
          totalAssets: 3650000,
          totalLiabilities: 450000,
          totalEquity: 3200000,
          cta: 14000,
          eliminated: {
            assets: 500000,
            liabilities: 500000,
            difference: 0,
            income: 200000,
            cogs: 200000,
          },
        }
      : null,
    accountLines:
      translated && includeAccountLines
        ? [
            {
              key: 'asset|code:1000',
              section: 'asset',
              code: '1000',
              name: 'Operating Cash',
              byMember: { 'ws-us': 2000000, 'ws-eu': 1150000 },
              total: 3150000,
            },
            {
              key: 'income|code:4000',
              section: 'income',
              code: '4000',
              name: 'Advisory Revenue',
              byMember: { 'ws-us': 1200000, 'ws-eu': 864000 },
              total: 2064000,
            },
          ]
        : undefined,
    notIncluded: 0,
    intercompany: { matched: 2, unmatched: [] },
  };
}

test('W12 browser: fills multi-currency translation rates, shows CTA & intercompany eliminations, and exports matching CSV', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 900 });

  const { errors, requests } = await mountJourney(page, {
    workspaceId: WORKSPACE,
    ledger: {},
    mounts: [{ module: '/src/components/reporting/GroupSummaryReportView.tsx', props: {} }],
    api: (req) => {
      if (req.url.endsWith('/api/v1/account/groups') && req.method === 'GET') {
        return {
          status: 200,
          json: {
            groups: [
              {
                id: GROUP_ID,
                name: 'Atlantic Holdings Group',
                workspaceIds: ['ws-us', 'ws-eu'],
              },
            ],
          },
        };
      }
      if (req.url.includes('/api/v1/reports/group-summary?')) {
        const parsedUrl = new URL(req.url);
        const hasRates = Boolean(parsedUrl.searchParams.get('rates'));
        const wantAccounts = parsedUrl.searchParams.get('detail') === 'accounts';
        return { status: 200, json: buildSummaryPayload(hasRates, wantAccounts) };
      }
      if (req.url.includes('/api/v1/currency/historical?')) {
        return { status: 200, json: { quotes: { USDEUR: 0.909091 } } };
      }
      if (req.url.includes('/api/v1/currency/timeframe?')) {
        return { status: 200, json: { quotes: { '2026-06-15': { USDEUR: 0.925926 } } } };
      }
      if (req.url.endsWith(`/api/v1/account/groups/${GROUP_ID}/rates`) && req.method === 'PUT') {
        return {
          status: 200,
          json: {
            group: {
              id: GROUP_ID,
              name: 'Atlantic Holdings Group',
              workspaceIds: ['ws-us', 'ws-eu'],
            },
          },
        };
      }
      return null;
    },
  });

  // 1. Multi-currency group starts in native currencies without a single-currency total
  await expect(page.getByText(/No group total: these books are in USD, EUR/)).toBeVisible();

  // 2. Choose USD reporting currency and fill EUR closing/average/historical rates from rate service
  await page.getByLabel('In one currency').selectOption('USD');
  await page.getByRole('button', { name: 'Fill from the rate service for EUR' }).click();
  await expect.poll(() => requests.some((r) => r.url.endsWith(`/api/v1/account/groups/${GROUP_ID}/rates`))).toBe(true);

  // 3. Consolidated P&L, Balance Sheet, translation difference (CTA), and intercompany eliminations
  await expect(page.getByText('$18,640.00').first()).toBeVisible();
  await expect(page.getByText('$11,360.00').first()).toBeVisible();
  await expect(page.getByText('of which translation difference')).toBeVisible();
  await expect(page.getByText('$140.00').first()).toBeVisible();
  await expect(page.getByText(/Taken out of the group total: \$5,000\.00 owed to the companies by each other/)).toBeVisible();
  await expect(page.getByText(/Sales between the companies taken out: \$2,000\.00 of income/)).toBeVisible();

  // 4. Enable account-by-account cross-company breakdown and verify lines
  await page.getByRole('checkbox', { name: /Account by account/i }).check();
  await expect(page.getByText('Operating Cash')).toBeVisible();
  await expect(page.getByText('$31,500.00')).toBeVisible();

  // 5. Export CSV and verify exact byte-level figure parity with screen
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  const csvPath = await download.path();
  expect(csvPath).toBeTruthy();
  const csvText = await readFile(csvPath!, 'utf8');

  expect(csvText).toContain('Parent US');
  expect(csvText).toContain('Dublin EU');
  expect(csvText).toContain('$18,640.00');
  expect(csvText).toContain('$11,360.00');
  expect(csvText).toContain('of which translation difference');
  expect(csvText).toContain('$140.00');
  expect(csvText).toContain('$5,000.00');
  expect(csvText).toContain('$31,500.00');

  await settleStyles(page);
  const axe = await new AxeBuilder({ page }).include('table').analyze();
  const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  await testInfo.attach('w12-group-summary-axe', {
    body: JSON.stringify(axe.violations, null, 2),
    contentType: 'application/json',
  });
  expect(serious).toEqual([]);
  expect(errors).toEqual([]);
});

const GOLD_GROUP_ID = 'grp-w12-gold';

/** The independently worked W12-GOLD answer, in cents (src/tests/w12-gold.test.ts). */
function goldSummary(translated: boolean) {
  const parent = {
    income: 71000, cogs: 0, grossProfit: 71000, expense: 20000, netIncome: 51000,
    totalAssets: 151000, totalLiabilities: 0, totalEquity: 151000,
  };
  const daughter = {
    income: 40000, cogs: 0, grossProfit: 40000, expense: 20000, netIncome: 20000,
    totalAssets: 80000, totalLiabilities: 10000, totalEquity: 70000,
  };
  const daughterUsd = {
    income: 44000, cogs: 0, grossProfit: 44000, expense: 22000, netIncome: 22000,
    totalAssets: 96000, totalLiabilities: 12000, totalEquity: 84000, cta: 12000,
  };
  return {
    group: { id: GOLD_GROUP_ID, name: 'Parent group' },
    parent: { workspaceId: 'ws-parent', name: 'Parent Co' },
    members: [
      { workspaceId: 'ws-parent', name: 'Parent Co', currency: 'USD', isBalanced: true, ...parent, ...(translated ? { translated: { ...parent, cta: 0 } } : {}) },
      { workspaceId: 'ws-daughter', name: 'Daughter GmbH', currency: 'EUR', isBalanced: true, share: 100, ...daughter, ...(translated ? { translated: daughterUsd } : {}) },
    ],
    total: translated ? {
      currency: 'USD',
      income: 104000, cogs: 0, grossProfit: 104000, expense: 31000, netIncome: 73000,
      totalAssets: 236000, totalLiabilities: 0, totalEquity: 236000, cta: 12000,
      eliminated: { assets: 11000, liabilities: 12000, difference: -1000, income: 11000, cogs: 0, expense: 11000, profitDifference: 0 },
    } : null,
    notIncluded: 0,
    intercompany: { matched: 1, unmatched: [] },
  };
}

for (const width of [1280, 390]) {
  test(`W12-GOLD browser: worked cross-book figures and CSV agree at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    const { errors } = await mountJourney(page, {
      workspaceId: 'w12-gold-browser',
      ledger: {},
      mounts: [{ module: '/src/components/reporting/GroupSummaryReportView.tsx', props: {} }],
      api: req => {
        if (req.url.endsWith('/api/v1/account/groups') && req.method === 'GET') {
          return { status: 200, json: { groups: [{ id: GOLD_GROUP_ID, name: 'Parent group', workspaceIds: ['ws-parent', 'ws-daughter'], parentId: 'ws-parent', ownership: { 'ws-daughter': 100 } }] } };
        }
        if (req.url.includes('/api/v1/reports/group-summary?')) {
          const rates = new URL(req.url).searchParams.get('rates');
          return { status: 200, json: goldSummary(Boolean(rates)) };
        }
        if (req.url.endsWith(`/api/v1/account/groups/${GOLD_GROUP_ID}/rates`) && req.method === 'PUT') {
          return { status: 200, json: { group: { id: GOLD_GROUP_ID, name: 'Parent group', workspaceIds: ['ws-parent', 'ws-daughter'] } } };
        }
        return null;
      },
    });

    await page.getByLabel('From', { exact: true }).fill('2026-01-01');
    await page.getByLabel('To', { exact: true }).fill('2026-12-31');
    await page.getByLabel('In one currency').selectOption('USD');
    await page.getByLabel('At 2026-12-31 (assets, liabilities)').fill('1.2');
    await page.getByLabel('Average (income, costs)').fill('1.1');
    await page.getByLabel('Historical (equity)').fill('1');

    const table = page.locator('table').first();
    await expect(table.getByRole('columnheader', { name: 'Group total' })).toBeVisible();
    const screenRows = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => Array.from(row.children).map(cell => {
      const copy = cell.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('.sr-only').forEach(hidden => hidden.remove());
      return (copy.textContent || '').replace(/\s+/g, ' ').trim();
    })));
    const expectedRows = [
      ['Income', '$710.00', '$440.00', '$1,040.00'],
      ['Cost of goods sold', '$0.00', '$0.00', '$0.00'],
      ['Gross profit', '$710.00', '$440.00', '$1,040.00'],
      ['Expenses', '$200.00', '$220.00', '$310.00'],
      ['Net income', '$510.00', '$220.00', '$730.00'],
      ['Total assets', '$1,510.00', '$960.00', '$2,360.00'],
      ['Total liabilities', '$0.00', '$120.00', '$0.00'],
      ['Equity (with this year’s profit)', '$1,510.00', '$840.00', '$2,360.00'],
      ['of which translation difference', '$0.00', '$120.00', '$120.00'],
    ];
    expect(screenRows).toEqual(expectedRows);
    await expect(page.getByText(/Taken out of the group total: \$110\.00 owed to the companies by each other, and \$120\.00/)).toBeVisible();
    await expect(page.getByText(/Sales between the companies taken out: \$110\.00 of income, and \$110\.00 of costs/)).toBeVisible();
    await expect(page.getByText(/What the companies say they owe each other differs by .*\$10\.00/)).toBeVisible();
    await expect(page.getByText('1 matched on both sides.')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    const csvText = await readFile((await download.path())!, 'utf8');
    const csvRows = parse(csvText, { bom: true }) as string[][];
    expect(csvRows[0]).toEqual(['Line', 'Parent Co', 'Daughter GmbH', 'Group total']);
    expect(csvRows.slice(1, 1 + expectedRows.length)).toEqual(screenRows);
    expect(csvRows.slice(1 + expectedRows.length, 5 + expectedRows.length)).toEqual([
      ['Eliminated intercompany assets', '', '', '$110.00'],
      ['Eliminated intercompany liabilities', '', '', '$120.00'],
      ['Eliminated intercompany income', '', '', '$110.00'],
      ['Eliminated intercompany costs', '', '', '$110.00'],
    ]);

    await settleStyles(page);
    if (width === 390) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    const axe = await new AxeBuilder({ page }).include('table').analyze();
    expect(axe.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
    await testInfo.attach(`w12-gold-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
}
