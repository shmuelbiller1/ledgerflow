import express from 'express';
import { errorMessage, requestUser } from '../auth/requestUser';
import { getDb, validateWorkspaceMember } from '../db/firestore';
import { activityOver, balancesAsOf, salesByItemOver, topLinesOver } from '../services/balanceService';
import { assetRegisterAsOf } from '../services/assetRegisterService';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';

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
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
  if (!workspaceId || !validDate(from) || !validDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS
    || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ status: 'error', message: `workspaceId, from and to (YYYY-MM-DD, from ≤ to, at most ${MAX_DAYS} days) and a limit of 1–100 are required` });
  }
  const db = getDb();
  if (!(await allowMember(db, workspaceId, req, res))) return;
  try {
    const result = await topLinesOver(db, workspaceId, from, to, limit);
    res.json({ status: 'success', workspaceId, from, to, limit, topExpenses: result.topExpenses, topIncome: result.topIncome, entriesRead: result.entriesRead });
  } catch (err) {
    console.error('[balances] could not read the top lines', errorMessage(err));
    res.status(500).json({ status: 'error', message: 'Could not read the top lines', details: errorMessage(err) });
  }
});

/**
 * L-123 step 4b: GET /api/v1/balances/sales-by-item?workspaceId=…&from=YYYY-MM-DD&to=YYYY-MM-DD — any member. The
 * sales-by-item report over every invoice dated from…to and the cost of goods sold posted for them. Read-only.
 */
balanceRouter.get('/sales-by-item', async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  if (!workspaceId || !validDate(from) || !validDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) {
    return res.status(400).json({ status: 'error', message: `workspaceId, from and to (YYYY-MM-DD, from ≤ to, at most ${MAX_DAYS} days) are required` });
  }
  const db = getDb();
  if (!(await allowMember(db, workspaceId, req, res))) return;
  try {
    const result = await salesByItemOver(db, workspaceId, from, to);
    res.json({ status: 'success', workspaceId, from, to, rows: result.rows, totals: result.totals, invoicesRead: result.invoicesRead });
  } catch (err) {
    console.error('[balances] could not read sales by item', errorMessage(err));
    res.status(500).json({ status: 'error', message: 'Could not read sales by item', details: errorMessage(err) });
  }
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
