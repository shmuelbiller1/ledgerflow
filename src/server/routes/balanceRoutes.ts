import { trendWindowStart } from '../../lib/documentTrends';
import { thresholdWindowStart } from '../../lib/registrationThresholdWatch';
import express from 'express';
import { errorMessage, requestUser } from '../auth/requestUser';
import { getDb, validateWorkspaceMember } from '../db/firestore';
import { activityOver, balancesAsOf, customerGrossProfitOver, itemGroupMarginOver, purchaseTrendsOver, registrationThresholdOver, spreadWaterfallOver, salesTrendsOver, expenseByCategoryOver, incomeBySourceOver, monthlyAveragesOver, profitabilityOver, tagReportOver, salesByItemOver, topLinesOver } from '../services/balanceService';
import { assetRegisterAsOf, depreciationLedgerOver } from '../services/assetRegisterService';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { PROFITABILITY_BY, type ProfitabilityBy } from '../../lib/profitabilityLines';

/**
 * L-123 step 3 (docs/design/L-123-server-balances.md): the account balances the browser shows, read by the server.
 *
 * GET /api/v1/balances?workspaceId=…&asOf=YYYY-MM-DD[&byLabel=1] — any member of the workspace (a viewer too).
 * Answers `balancesAsOf`: per account id the base-currency cents (debit positive) over every postable entry dated on
 * or before `asOf` (the accounts' own opening balances are not in it, as in the reports), the cumulative profit,
 * the snapshot read (or null) and, with byLabel=1, label kind → value → account → cents.
 */
export const balanceRouter = express.Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Any member may read; otherwise 404 (no such workspace) or 403, already sent. */
async function allowMember(db: ReturnType<typeof getDb>, workspaceId: string, req: express.Request, res: express.Response): Promise<boolean> {
  try {
    await validateWorkspaceMember(db, workspaceId, requestUser(req));
    return true;
  } catch (err) {
    if (/not found/i.test(errorMessage(err))) res.status(404).json({ status: 'error', message: 'Workspace not found' });
    else res.status(403).json({ status: 'error', message: 'Forbidden' });
    return false;
  }
}

balanceRouter.get('/', async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : '';
  const byLabel = req.query.byLabel === '1' || req.query.byLabel === 'true';
  if (!workspaceId || !DATE.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
    return res.status(400).json({ status: 'error', message: 'workspaceId and asOf (YYYY-MM-DD) are required' });
  }
  const db = getDb();
  if (!(await allowMember(db, workspaceId, req, res))) return;
  try {
    const result = await balancesAsOf(db, workspaceId, asOf, { byLabel });
    res.json({
      status: 'success', workspaceId, asOf, accounts: result.accounts, retainedEarnings: result.retainedEarnings,
      ...(byLabel ? { byLabel: result.byLabel || {} } : {}), snapshot: result.snapshot, entriesRead: result.entriesRead,
    });
  } catch (err) {
    console.error('[balances] could not read the balances', errorMessage(err));
    res.status(500).json({ status: 'error', message: 'Could not read the balances', details: errorMessage(err) });
  }
});

// a real calendar day: Date.parse would roll 2026-02-30 over to March
const validDate = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
/** Longest range one request may ask for (the browser asks for at most 18 months or a year). */
const MAX_DAYS = 3 * 366;

/** workspaceId, from and to of a range route (from ≤ to, at most MAX_DAYS); otherwise null, the 400 already sent. */
function rangeQuery(req: express.Request, res: express.Response, extraValid = true, extraMessage = ''): { workspaceId: string; from: string; to: string } | null {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  if (!workspaceId || !validDate(from) || !validDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS || !extraValid) {
    res.status(400).json({ status: 'error', message: `workspaceId, from and to (YYYY-MM-DD, from ≤ to, at most ${MAX_DAYS} days)${extraMessage} are required` });
    return null;
  }
  return { workspaceId, from, to };
}

/** Sends a range route's answer (never cached), or its 500 with `what` in the message. */
async function answerRange(res: express.Response, what: string, read: () => Promise<Record<string, unknown>>): Promise<void> {
  // a workspace's figures: no browser keeps them for a later user of the same URL (CodeRabbit on #499, CWE-524)
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json({ status: 'success', ...(await read()) });
  } catch (err) {
    console.error(`[balances] could not read ${what}`, errorMessage(err));
    res.status(500).json({ status: 'error', message: `Could not read ${what}`, details: errorMessage(err) });
  }
}

/**
 * L-123 step 3e: GET /api/v1/balances/activity?workspaceId=…&from=YYYY-MM-DD&to=YYYY-MM-DD — any member of the
 * workspace (a viewer too), as GET /. Per month (YYYY-MM) of every postable entry dated from…to: per account id the
 * net, gross debits and gross credits (base-currency cents, debit positive), the number of entries and of entries
 * whose lines do not add to zero (src/lib/periodActivity.ts). Optional excludeDocumentId: that document's own
 * postings are left out (the edited bill in BudgetLeft). Read-only.
 */
balanceRouter.get('/activity', async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  const exclude = typeof req.query.excludeDocumentId === 'string' ? req.query.excludeDocumentId : '';
  if (!workspaceId || !validDate(from) || !validDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS || exclude.length > 200) {
    return res.status(400).json({ status: 'error', message: `workspaceId, from and to (YYYY-MM-DD, from ≤ to, at most ${MAX_DAYS} days) are required` });
  }
  const db = getDb();
  if (!(await allowMember(db, workspaceId, req, res))) return;
  try {
    const result = await activityOver(db, workspaceId, from, to, exclude || undefined, requestUser(req).uid);
    res.json({ status: 'success', workspaceId, from, to, months: result.months, entriesRead: result.entriesRead, ...(result.pendingReversal ? { pendingReversal: result.pendingReversal } : {}) });
  } catch (err) {
    console.error('[balances] could not read the activity', errorMessage(err));
    res.status(500).json({ status: 'error', message: 'Could not read the activity', details: errorMessage(err) });
  }
});

/**
 * L-123 step 4a: GET /api/v1/balances/top-lines?workspaceId=…&from=YYYY-MM-DD&to=YYYY-MM-DD[&limit=25] — any member,
 * as GET /. The largest single expense and income lines dated from…to over every postable entry (topLinesOver),
 * for the "Top Financial Line Items" report when the loaded list is capped. limit 1…100 (default 25). Read-only.
 */
balanceRouter.get('/top-lines', async (req, res) => {
  const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
  const range = rangeQuery(req, res, Number.isInteger(limit) && limit >= 1 && limit <= 100, ' and a limit of 1–100');
  if (!range) return;
  const db = getDb();
  if (!(await allowMember(db, range.workspaceId, req, res))) return;
  await answerRange(res, 'the top lines', async () => {
    const result = await topLinesOver(db, range.workspaceId, range.from, range.to, limit);
    return { ...range, limit, topExpenses: result.topExpenses, topIncome: result.topIncome, entriesRead: result.entriesRead };
  });
});

/**
 * L-123 step 4b: GET /api/v1/balances/sales-by-item?workspaceId=…&from=YYYY-MM-DD&to=YYYY-MM-DD — any member. The
 * sales-by-item report over every invoice dated from…to and the cost of goods sold posted for them. Read-only.
 */
balanceRouter.get('/sales-by-item', async (req, res) => {
  const range = rangeQuery(req, res);
  if (!range) return;
  const db = getDb();
  if (!(await allowMember(db, range.workspaceId, req, res))) return;
  await answerRange(res, 'sales by item', async () => {
    const result = await salesByItemOver(db, range.workspaceId, range.from, range.to);
    return { ...range, rows: result.rows, totals: result.totals, invoicesRead: result.invoicesRead };
  });
});

/**
 * L-123 step 4c: GET /api/v1/balances/asset-register?workspaceId=…&asOf=YYYY-MM-DD — any member, as GET /. The
 * fixed-asset register over every asset and posted depreciation run (assetRegisterAsOf), for the register screen
 * when the loaded assets or entries are capped. Read-only.
 */
balanceRouter.get('/asset-register', async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : '';
  // the report's own date rule (from 1900 on), so a date it would refuse is a 400, not a 500
  if (!workspaceId || !validDate(asOf) || !validCustomReportPeriod({ startDate: asOf, endDate: asOf })) return res.status(400).json({ status: 'error', message: 'workspaceId and asOf (YYYY-MM-DD) are required' });
  const db = getDb();
  if (!(await allowMember(db, workspaceId, req, res))) return;
  try {
    res.json({ status: 'success', workspaceId, asOf, ...await assetRegisterAsOf(db, workspaceId, asOf) });
  } catch (err) {
    console.error('[balances] could not read the asset register', errorMessage(err));
    res.status(500).json({ status: 'error', message: 'Could not read the asset register', details: errorMessage(err) });
  }
});

/** A read-only range report route (rangeQuery, any member, answerRange): `read` gives the report's fields. */
function rangeReportRoute(path: string, what: string, read: (db: ReturnType<typeof getDb>, workspaceId: string, from: string, to: string) => Promise<Record<string, unknown>>,
  shape?: { valid: (from: string, to: string) => boolean; message: string }): void {
  balanceRouter.get(path, async (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    const range = rangeQuery(req, res, !shape || shape.valid(from, to), shape ? ` ${shape.message}` : '');
    if (!range) return;
    const db = getDb();
    if (!(await allowMember(db, range.workspaceId, req, res))) return;
    await answerRange(res, what, async () => ({ ...range, ...(await read(db, range.workspaceId, range.from, range.to)) }));
  });
}

/**
 * L-123 step 4d: GET /api/v1/balances/expense-by-category?workspaceId=…&from=YYYY-MM-DD&to=YYYY-MM-DD — the expense
 * breakdown by category over every postable entry of the range (expenseByCategoryOver), for "Expense Breakdown by
 * Category" when the loaded lists are capped.
 */
rangeReportRoute('/expense-by-category', 'the expense categories', (db, ws, from, to) => expenseByCategoryOver(db, ws, from, to));

/**
 * L-123 step 4e: GET /api/v1/balances/income-by-source?workspaceId=…&from=YYYY-MM-DD&to=YYYY-MM-DD — income by source
 * over every postable entry of the range (incomeBySourceOver), for "Income by Source & Customer" when the loaded lists
 * are capped.
 */
rangeReportRoute('/income-by-source', 'the income sources', (db, ws, from, to) => incomeBySourceOver(db, ws, from, to));

/**
 * L-123 step 4f: GET /api/v1/balances/monthly-averages?workspaceId=…&from=YYYY-01-01&to=YYYY-12-31 — income and
 * expense per month of that calendar year and their averages over every postable entry (monthlyAveragesOver), for
 * "Monthly Averages" when the loaded lists are capped.
 */
const ONE_CALENDAR_YEAR = {
  valid: (from: string, to: string) => /^\d{4}-01-01$/.test(from) && to === `${from.slice(0, 4)}-12-31`,
  message: 'covering one calendar year',
};
rangeReportRoute('/monthly-averages', 'the monthly averages', (db, ws, from, to) => monthlyAveragesOver(db, ws, from, to), ONE_CALENDAR_YEAR);

/**
 * L-123 step 4g: GET /api/v1/balances/tag-breakdown?workspaceId=…&from=YYYY-MM-DD&to=YYYY-MM-DD — income and expense by
 * tag over every postable entry of the range (tagReportOver), for "Tag & Analytical Dimension Breakdown" when the loaded
 * lists are capped.
 */
rangeReportRoute('/tag-breakdown', 'the tag breakdown', (db, ws, from, to) => tagReportOver(db, ws, from, to));

/**
 * L-123 step 4h: GET /api/v1/balances/depreciation-ledger?workspaceId=…&from=YYYY-MM-DD&to=YYYY-MM-DD — any member. The
 * depreciation ledger over every asset and posted run (depreciationLedgerOver), for the ledger screen when the loaded
 * assets or entries are capped. Only runs are read, so the period is not limited to three years; the report's own date
 * rule (from 1900 on) applies. Read-only.
 */
balanceRouter.get('/depreciation-ledger', async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  if (!workspaceId || !validDate(from) || !validDate(to) || !validCustomReportPeriod({ startDate: from, endDate: to })) {
    return res.status(400).json({ status: 'error', message: 'workspaceId, from and to (YYYY-MM-DD, from ≤ to) are required' });
  }
  const db = getDb();
  if (!(await allowMember(db, workspaceId, req, res))) return;
  await answerRange(res, 'the depreciation ledger', async () => ({ workspaceId, from, to, ...await depreciationLedgerOver(db, workspaceId, from, to) }));
});

/**
 * L-123 step 4i: GET /api/v1/balances/profitability?workspaceId=…&by=customer|item|project&from=YYYY-MM-DD&to=YYYY-MM-DD
 * — any member. Profitability over every invoice of the range and its cost of goods sold (by project, every entry
 * too; profitabilityOver), for the Profitability screen when the loaded lists are capped. Read-only.
 */
balanceRouter.get('/profitability', async (req, res) => {
  const by = typeof req.query.by === 'string' ? req.query.by : '';
  const range = rangeQuery(req, res, (PROFITABILITY_BY as readonly string[]).includes(by), ' and by (customer, item or project)');
  if (!range) return;
  const db = getDb();
  if (!(await allowMember(db, range.workspaceId, req, res))) return;
  await answerRange(res, 'the profitability', async () => ({ ...range, by, ...await profitabilityOver(db, range.workspaceId, by as ProfitabilityBy, range.from, range.to) }));
});

/**
 * L-123 step 4j: GET /api/v1/balances/customer-gross-profit?workspaceId=…&from=YYYY-MM-DD&to=YYYY-MM-DD — gross profit
 * by customer over every invoice of the range and its cost of goods sold (customerGrossProfitOver), for "Gross profit
 * by customer" when the loaded lists are capped.
 */
rangeReportRoute('/customer-gross-profit', 'the customer gross profit', (db, ws, from, to) => customerGrossProfitOver(db, ws, from, to));

/**
 * L-123 step 4k: GET /api/v1/balances/item-group-margin?workspaceId=…&from=YYYY-01-01&to=YYYY-12-31 — gross margin by
 * item group for each month of that calendar year over every invoice and its cost of goods sold (itemGroupMarginOver),
 * for "Gross margin by item group" when the loaded lists are capped.
 */
rangeReportRoute('/item-group-margin', 'the gross margin by item group', (db, ws, from, to) => itemGroupMarginOver(db, ws, from, to), ONE_CALENDAR_YEAR);

/** The window of a sales trend: `from` is the first day of the twelve months that end on `to`. */
function isTrendWindow(from: string, to: string): boolean {
  try { return from === trendWindowStart(to); } catch { return false; }
}

/**
 * L-123 step 4l: GET /api/v1/balances/sales-trends?workspaceId=…&group=customer|item&from=…&to=YYYY-MM-DD — sales per
 * month by customer or item over the twelve months ending `to` (`from` is the window's first day) over every invoice of
 * the window and its cost of goods sold (salesTrendsOver), for "Sales trends" when the loaded lists are capped.
 */
balanceRouter.get('/sales-trends', async (req, res) => {
  const group = typeof req.query.group === 'string' ? req.query.group : '';
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  const range = rangeQuery(req, res, (group === 'customer' || group === 'item') && isTrendWindow(from, to), ' covering the twelve months that end on to, and group (customer or item)');
  if (!range) return;
  const db = getDb();
  if (!(await allowMember(db, range.workspaceId, req, res))) return;
  await answerRange(res, 'the sales trends', async () => ({ ...range, group, ...await salesTrendsOver(db, range.workspaceId, group as 'customer' | 'item', range.from, range.to) }));
});

/**
 * L-123 step 4m: GET /api/v1/balances/purchase-trends?workspaceId=…&from=…&to=YYYY-MM-DD — amounts billed per month by
 * vendor over the twelve months ending `to` (`from` is the window's first day) over every bill of the window
 * (purchaseTrendsOver), for "Purchase trends by vendor" when the loaded lists are capped.
 */
rangeReportRoute('/purchase-trends', 'the purchase trends', (db, ws, from, to) => purchaseTrendsOver(db, ws, from, to),
  { valid: isTrendWindow, message: 'covering the twelve months that end on to' });

/**
 * L-123 step 4n: GET /api/v1/balances/registration-threshold?workspaceId=…&from=…&to=YYYY-MM-DD&entity=…&activity=… —
 * the registration-threshold watch as of `to` over every postable entry from `from` (1 January of the year before `to`)
 * through `to` (registrationThresholdOver), for "Registration threshold watch" when the loaded lists are capped.
 * `entity` and `activity` are the dimension ids the reader chose, or empty.
 */
balanceRouter.get('/registration-threshold', async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  const dim = (key: string) => (typeof req.query[key] === 'string' ? (req.query[key] as string) : '');
  const entityDimensionId = dim('entity'), activityDimensionId = dim('activity');
  const shapeOk = /^\d{4}-\d{2}-\d{2}$/.test(to) && from === thresholdWindowStart(to) && entityDimensionId.length <= 200 && activityDimensionId.length <= 200;
  const range = rangeQuery(req, res, shapeOk, ' starting on 1 January of the year before to');
  if (!range) return;
  const db = getDb();
  if (!(await allowMember(db, range.workspaceId, req, res))) return;
  await answerRange(res, 'the registration-threshold watch', async () => ({ ...range, ...await registrationThresholdOver(db, range.workspaceId, range.from, range.to, { entityDimensionId, activityDimensionId }) }));
});

/**
 * L-123 step 4o: GET /api/v1/balances/spread-waterfall?workspaceId=…&side=invoice|bill&from=YYYY-MM-DD&to=YYYY-MM-DD —
 * the deferred-revenue or prepaid-expense waterfall for the period over every recognition entry of that side, at any
 * date (spreadWaterfallOver), for the Spread waterfall screen when the loaded lists are capped.
 */
balanceRouter.get('/spread-waterfall', async (req, res) => {
  const side = typeof req.query.side === 'string' ? req.query.side : '';
  const range = rangeQuery(req, res, side === 'invoice' || side === 'bill', ' and side (invoice or bill)');
  if (!range) return;
  const db = getDb();
  if (!(await allowMember(db, range.workspaceId, req, res))) return;
  await answerRange(res, 'the spread waterfall', async () => ({ ...range, side, ...await spreadWaterfallOver(db, range.workspaceId, side as 'invoice' | 'bill', range.from, range.to) }));
});
