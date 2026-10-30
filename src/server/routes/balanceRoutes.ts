import express from 'express';
import { errorMessage, requestUser } from '../auth/requestUser';
import { getDb, validateWorkspaceMember } from '../db/firestore';
import { activityOver, balancesAsOf, topLinesOver } from '../services/balanceService';

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

balanceRouter.get('/', async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : '';
  const byLabel = req.query.byLabel === '1' || req.query.byLabel === 'true';
  if (!workspaceId || !DATE.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
    return res.status(400).json({ status: 'error', message: 'workspaceId and asOf (YYYY-MM-DD) are required' });
  }
  const db = getDb();
  try {
    await validateWorkspaceMember(db, workspaceId, requestUser(req));
  } catch (err) {
    const message = errorMessage(err);
    if (/not found/i.test(message)) return res.status(404).json({ status: 'error', message: 'Workspace not found' });
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  }
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

const validDate = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
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
  try {
    await validateWorkspaceMember(db, workspaceId, requestUser(req));
  } catch (err) {
    const message = errorMessage(err);
    if (/not found/i.test(message)) return res.status(404).json({ status: 'error', message: 'Workspace not found' });
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  }
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
  try {
    await validateWorkspaceMember(db, workspaceId, requestUser(req));
  } catch (err) {
    const message = errorMessage(err);
    if (/not found/i.test(message)) return res.status(404).json({ status: 'error', message: 'Workspace not found' });
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  }
  try {
    const result = await topLinesOver(db, workspaceId, from, to, limit);
    res.json({ status: 'success', workspaceId, from, to, limit, topExpenses: result.topExpenses, topIncome: result.topIncome, entriesRead: result.entriesRead });
  } catch (err) {
    console.error('[balances] could not read the top lines', errorMessage(err));
    res.status(500).json({ status: 'error', message: 'Could not read the top lines', details: errorMessage(err) });
  }
});
