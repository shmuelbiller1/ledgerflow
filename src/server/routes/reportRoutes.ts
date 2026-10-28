import { errorMessage, requestUser } from '../auth/requestUser';
import express from "express";
import type { DecodedIdToken } from "../auth/supabaseAuth";
import type { DocumentData, Query } from "../db/firestore";
import { z } from "zod";
import { getDb, validateWorkspaceMember } from "../db/firestore";
import { isOpenBill, isOpenInvoice, isPostable, lineAmount } from "../../lib/txFilters";
import { ReportRangeSchema, WorkspaceIdSchema } from "../../schemas";
import { getLocalDateISO } from "../../lib/utils";
import crypto from "crypto";
import {
  computeProfitAndLoss,
  computeBalanceSheet,
  computeTrialBalance,
  computeCashFlow,
  computeGeneralLedger,
  isCashFlowCashAccount
} from "../reports/computeReports";
import type { Bill, Budget, ChartAccount, Invoice, Transaction as LedgerTransaction } from "../../types";
import { agingBucket, daysOverdue, outstandingBaseCents } from '../../lib/aging';
import { GroupReportError, groupSummary } from '../reports/groupReport';
import { loadStatement, StatementScopeError } from '../services/statementService';
import { balanceSheetByLabel, profitByLabel } from '../reports/byLabel';
import { cashBasisBalanceSheet, cashBasisEntries, type CashBasisPayment } from '../reports/cashBasis';
import { explainFigure } from '../reports/explain';
import { stockMovesReady } from '../services/stockMoveService';
import { itemDetails, stockAging, type StockMove } from '../../lib/stockMoves';
import { openingDebitCents } from '../../lib/accountUtils';
export { balanceRouter } from './balanceRoutes'; // L-123 step 3, mounted at /api/v1/balances
import { grossOf, labelOpeningOf, openingBefore, openingKey } from '../reports/reportOpening';
import { serverProvenance, type ReportProvenance } from '../../lib/reportProvenance';

export const reportRouter = express.Router();

/** a P&L or balance sheet worked out in the last minute, with the moment it was (`at`) */
const REPORT_CACHE = new Map<string, { data: object; expiry: number; at: number }>();
const CACHE_TTL_MS = 60000; // 60 seconds

/** AUD-10: every report answer says where it comes from (reportProvenance.ts); a cached one says when */
function withProvenance<T extends object>(data: T, cachedAt?: number): T & { provenance: ReportProvenance } {
  return { ...data, provenance: serverProvenance(cachedAt) };
}

function remember(key: string, data: object) {
  REPORT_CACHE.set(key, { data, expiry: Date.now() + CACHE_TTL_MS, at: Date.now() });
}

/** L-123: `snapshot` is the balance snapshot the report reads (openingKey), so a stale or rebuilt one is never answered from the cache. */
export function getCacheKey(req: express.Request, snapshot = 'none'): string {
  const payload = JSON.stringify({ path: req.path, query: req.query, body: req.body, user: requestUser(req)?.uid, snapshot });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

interface AuthUser extends DecodedIdToken {
  email_verified: boolean;
}

interface AuthenticatedRequest extends express.Request {
  user: AuthUser;
}

function sendError(res: express.Response, message: string, status: number = 500, details?: unknown) {
  console.error(`[API Error] ${status}: ${message} (Path: ${res.req?.originalUrl || "unknown"})`, details || "");
  res.status(status).json({
    status: "error",
    message,
    ...(details ? { details } : {})
  });
}

async function authorizeWorkspace(req: AuthenticatedRequest, workspaceId: string) {
  const db = getDb();
  await validateWorkspaceMember(db, workspaceId, req.user);
}

async function getReportContext(req: AuthenticatedRequest, workspaceId: string, startDate?: string, endDate?: string) {
  const db = getDb();
  await authorizeWorkspace(req, workspaceId);
  const accountsSnap = await db.collection("chartAccounts").where("workspaceId", "==", workspaceId).get();
  
  let txQuery: Query = db.collection("transactions").where("workspaceId", "==", workspaceId);
  if (startDate) {
    txQuery = txQuery.where("date", ">=", startDate);
  }
  if (endDate) {
    txQuery = txQuery.where("date", "<=", endDate);
  }
  
  const transactions: LedgerTransaction[] = [];
  const txStream = txQuery.stream();
  
  // the row's own id: a restored entry's data does not repeat it (DA-07)
  for await (const chunk of txStream as AsyncIterable<{ id: string; data: () => DocumentData }>) {
    transactions.push({ ...chunk.data(), id: chunk.id } as LedgerTransaction);
  }
  
  return {
    accounts: accountsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ChartAccount),
    transactions
  };
}

reportRouter.get(["/profit-and-loss", "/pl"], async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const result = ReportRangeSchema.safeParse(req.query);
  if (!result.success) return sendError(res, "Invalid parameters", 400, result.error.issues);
  const { workspaceId, startDate, endDate } = result.data;
  try {
    // AF-015: membership first, so someone removed from the workspace is not served its cached figures
    await authorizeWorkspace(authReq, workspaceId);
    const cacheKey = getCacheKey(req);
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && cached.expiry > Date.now()) return res.json(withProvenance(cached.data, cached.at));
    // N-08: on cash basis, invoices and bills count when paid (cashBasis.ts): their postings may be
    // older than the period, so the whole history up to the end is read, with the payments
    if (req.query.basis === 'cash') {
      const { accounts, transactions } = await getReportContext(authReq, workspaceId, undefined, endDate || undefined);
      const payments = (await getDb().collection('payments').where('workspaceId', '==', workspaceId).get()).docs.map(d => ({ ...d.data(), id: d.id }) as CashBasisPayment);
      const { entries, leftOut } = cashBasisEntries(accounts, transactions, payments);
      const pl = { ...computeProfitAndLoss(accounts, entries, startDate, endDate), basis: 'cash', leftOut };
      remember(cacheKey, pl);
      return res.json(withProvenance(pl));
    }
    const { accounts, transactions } = await getReportContext(authReq, workspaceId, startDate, endDate);
    const pl = computeProfitAndLoss(accounts, transactions, startDate, endDate);
    remember(cacheKey, pl);
    res.json(withProvenance(pl));
  } catch (error) {
    if (/not a member|Unauthorized|FORBIDDEN/i.test(errorMessage(error))) return sendError(res, "Forbidden", 403);
    if (errorMessage(error) === "NOT_FOUND" || errorMessage(error).includes("NOT_FOUND")) return sendError(res, "Workspace not found", 404);
    sendError(res, "Internal Reporting Error", 500, errorMessage(error));
  }
});

reportRouter.get("/balance-sheet", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const result = ReportRangeSchema.safeParse(req.query);
  if (!result.success) return sendError(res, "Invalid parameters", 400, result.error.issues);
  const { workspaceId, endDate } = result.data;
  try {
    const cash = req.query.basis === 'cash';
    // L-123: the cache key carries the snapshot read, checked only once the person may see the workspace
    await authorizeWorkspace(authReq, workspaceId);
    const cacheKey = getCacheKey(req, cash ? 'none' : await openingKey(getDb(), workspaceId, endDate));
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && cached.expiry > Date.now()) return res.json(withProvenance(cached.data, cached.at));
    if (!cash && endDate) {
      const { accounts, transactions } = await getReportContext(authReq, workspaceId, endDate, endDate);
      const opening = await openingBefore(getDb(), workspaceId, accounts, endDate, { gross: true });
      if (opening) {
        const bs = computeBalanceSheet(accounts, transactions, endDate, opening.accounts);
        remember(cacheKey, bs);
        return res.json(withProvenance(bs));
      }
    }
    const { accounts, transactions } = await getReportContext(authReq, workspaceId, undefined, endDate);
    // N-08: on cash basis, without trade receivables and payables (cashBasis.ts)
    if (cash) {
      const payments = (await getDb().collection('payments').where('workspaceId', '==', workspaceId).get()).docs.map(d => ({ ...d.data(), id: d.id }) as CashBasisPayment);
      const cashBs = cashBasisBalanceSheet(accounts, transactions, payments, endDate || undefined);
      remember(cacheKey, cashBs);
      return res.json(withProvenance(cashBs));
    }
    const bs = computeBalanceSheet(accounts, transactions, endDate);
    remember(cacheKey, bs);
    res.json(withProvenance(bs));
  } catch (error) {
    if (errorMessage(error) === "FORBIDDEN") return sendError(res, "Forbidden", 403);
    if (errorMessage(error) === "NOT_FOUND" || errorMessage(error).includes("NOT_FOUND")) return sendError(res, "Workspace not found", 404);
    sendError(res, "Internal Reporting Error", 500, errorMessage(error));
  }
});

reportRouter.get("/aging", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const result = WorkspaceIdSchema.extend({ type: z.enum(['ar', 'ap']) }).safeParse(req.query);
  if (!result.success) return sendError(res, "Invalid parameters", 400, result.error.issues);
  const { workspaceId, type } = result.data;

  try {
    await authorizeWorkspace(authReq, workspaceId);
    const db = getDb();
    const collectionName = type === 'ar' ? 'invoices' : 'bills';
    const snap = await db.collection(collectionName)
      .where("workspaceId", "==", workspaceId)
      .get();

    let items = snap.docs.map((doc) => doc.data() as Invoice | Bill);
    
    // open documents only (approved bills too; drafts, void, cancelled and paid are not owed)
    items = items.filter(item => (type === 'ar' ? isOpenInvoice(item) : isOpenBill(item)));
    const aging = {
      current: 0,
      "1-30": 0,
      "31-60": 0,
      "61-90": 0,
      "90+": 0,
      total: 0
    };

    // the same rule as the aging screens (src/lib/aging.ts): what is still owed, base currency, by due date
    const side = type === 'ar' ? 'customer' : 'vendor';
    const keyOf = { current: 'current', d1_30: '1-30', d31_60: '31-60', d61_90: '61-90', d90plus: '90+' } as const;
    const todayIso = getLocalDateISO();
    items.forEach((item) => {
      const outstanding = outstandingBaseCents(item, side);
      if (outstanding <= 0) return;
      aging[keyOf[agingBucket(daysOverdue(item, todayIso))]] += outstanding;
      aging.total += outstanding;
    });

    res.json(aging);
  } catch (error) {
    if (errorMessage(error) === "FORBIDDEN") return sendError(res, "Forbidden", 403);
    if (errorMessage(error) === "NOT_FOUND" || errorMessage(error).includes("NOT_FOUND")) return sendError(res, "Workspace not found", 404);
    sendError(res, "Failed to generate aging report", 500, errorMessage(error));
  }
});

/**
 * N-12: explain this number. The lines behind a report figure (accounts, period, optional label),
 * from the full history, adding up to the figure (explain.ts), with each line's document, bank match
 * and attached files.
 */
/**
 * J-10: inventory item details for a period, from the stock-moves ledger (every change to each item's
 * quantity, written by the server with the change): opening, each movement, closing. Any member reads.
 */
reportRouter.get("/inventory-details", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const parsed = z.object({ workspaceId: z.string().min(1).max(200), startDate: day, endDate: day }).safeParse(req.query);
  if (!parsed.success || parsed.data.startDate > parsed.data.endDate) return sendError(res, "Say the workspace and the period (from before to)", 400);
  const q = parsed.data;
  try {
    const db = getDb();
    await validateWorkspaceMember(db, q.workspaceId, authReq.user);
    if (!(await stockMovesReady(db))) return sendError(res, "Stock history is not set up in this database yet", 503);
    const moves = (await db.collection('stockMoves').where('workspaceId', '==', q.workspaceId).where('date', '<=', q.endDate).get()).docs.map(d => ({ ...d.data(), id: d.id }) as StockMove);
    res.json({ startDate: q.startDate, endDate: q.endDate, items: itemDetails(moves, q.startDate, q.endDate) });
  } catch (error) {
    if (/not a member|Unauthorized|FORBIDDEN/i.test(errorMessage(error))) return sendError(res, "Forbidden", 403);
    if (/not found/i.test(errorMessage(error))) return sendError(res, "Workspace not found", 404);
    sendError(res, "Could not read the stock history", 500, errorMessage(error));
  }
});

/** W-09: how old the stock on hand is, item by item, from the stock-moves ledger (stockMoves.ts `stockAging`). */
reportRouter.get("/stock-aging", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = z.object({ workspaceId: z.string().min(1).max(200), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(req.query);
  if (!parsed.success) return sendError(res, "Say the workspace and the day (YYYY-MM-DD)", 400);
  const q = parsed.data;
  try {
    const db = getDb();
    await validateWorkspaceMember(db, q.workspaceId, authReq.user);
    if (!(await stockMovesReady(db))) return sendError(res, "Stock history is not set up in this database yet", 503);
    const moves = (await db.collection('stockMoves').where('workspaceId', '==', q.workspaceId).where('date', '<=', q.asOf).get()).docs.map(d => ({ ...d.data(), id: d.id }) as StockMove);
    res.json({ asOf: q.asOf, items: stockAging(moves, q.asOf) });
  } catch (error) {
    if (/not a member|Unauthorized|FORBIDDEN/i.test(errorMessage(error))) return sendError(res, "Forbidden", 403);
    if (/not.found/i.test(errorMessage(error))) return sendError(res, "Workspace not found", 404);
    sendError(res, "Could not read the stock history", 500, errorMessage(error));
  }
});

const explainDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const explainFilters = { startDate: explainDay.optional(), endDate: explainDay.optional(), labelDimension: z.string().max(100).optional(), labelValue: z.string().max(200).optional() };
type ExplainQuery = { workspaceId: string; accountIds: string[]; startDate?: string; endDate?: string; labelDimension?: string; labelValue?: string };

async function sendExplanation(authReq: AuthenticatedRequest, res: express.Response, q: ExplainQuery) {
  try {
    const { accounts, transactions } = await getReportContext(authReq, q.workspaceId, undefined, q.endDate);
    const explanation = explainFigure(accounts, transactions, {
      accountIds: q.accountIds, ...(q.startDate ? { startDate: q.startDate } : {}), ...(q.endDate ? { endDate: q.endDate } : {}),
      ...(q.labelDimension && q.labelValue ? { label: { dimensionId: q.labelDimension, value: q.labelValue } } : {}),
    });
    // attached files, counted without reading them
    const documentIds = [...new Set(explanation.lines.map(l => l.document?.type !== 'transaction' ? l.document?.id : undefined).filter((x): x is string => Boolean(x)))];
    if (documentIds.length > 0) {
      const { rows } = await getDb().pool.query(`select data->>'linkedId' as id, count(*)::int as n from public.documents where workspace_id = $1 and data->>'linkedId' = any($2) group by 1`, [q.workspaceId, documentIds]);
      const counts = new Map(rows.map(r => [String(r.id), Number(r.n)]));
      for (const line of explanation.lines) if (line.document) line.attachments = counts.get(line.document.id) || 0;
    }
    res.json(explanation);
  } catch (error) {
    if (/not a member|Unauthorized|FORBIDDEN/i.test(errorMessage(error))) return sendError(res, "Forbidden", 403);
    if (/not found/i.test(errorMessage(error))) return sendError(res, "Workspace not found", 404);
    sendError(res, "Could not explain this number", 500, errorMessage(error));
  }
}

reportRouter.get("/explain", async (req, res) => {
  const parsed = z.object({ workspaceId: z.string().min(1), accountIds: z.string().min(1).max(4000), ...explainFilters }).safeParse(req.query);
  if (!parsed.success) return sendError(res, "Say which accounts and which period", 400, parsed.error.issues);
  await sendExplanation(req as AuthenticatedRequest, res, { ...parsed.data, accountIds: parsed.data.accountIds.split(',').filter(Boolean) });
});

/** The same, with the accounts in the body: a total over a large chart of accounts does not fit in a link. Reads only. */
reportRouter.post("/explain", async (req, res) => {
  const parsed = z.object({ workspaceId: z.string().min(1).max(200), accountIds: z.array(z.string().min(1).max(200)).min(1).max(5000), ...explainFilters }).safeParse(req.body);
  if (!parsed.success) return sendError(res, "Say which accounts and which period", 400, parsed.error.issues);
  await sendExplanation(req as AuthenticatedRequest, res, parsed.data);
});

/** CB-25: the profit and loss split by the values of one label, adding back to the P&L (byLabel.ts). */
reportRouter.get("/by-label", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const parsed = z.object({ workspaceId: z.string().min(1).max(200), dimensionId: z.string().min(1).max(100), startDate: day, endDate: day }).safeParse(req.query);
  if (!parsed.success || parsed.data.startDate > parsed.data.endDate) return sendError(res, "Choose a label and the period (from before to)", 400);
  const q = parsed.data;
  try {
    const { accounts, transactions } = await getReportContext(authReq, q.workspaceId, q.startDate, q.endDate);
    res.json(profitByLabel(accounts, transactions, q.dimensionId, q.startDate, q.endDate));
  } catch (error) {
    if (/not a member|Unauthorized|FORBIDDEN/i.test(errorMessage(error))) return sendError(res, "Forbidden", 403);
    if (/not.found/i.test(errorMessage(error))) return sendError(res, "Workspace not found", 404);
    sendError(res, "Could not make the report by label", 500, errorMessage(error));
  }
});

/** W5-BS: the balance sheet of one label value at a date, and what has no value for that label (byLabel.ts). */
reportRouter.get("/balance-sheet-by-label", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = z.object({ workspaceId: z.string().min(1).max(200), dimensionId: z.string().min(1).max(100), value: z.string().min(1).max(200), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(req.query);
  if (!parsed.success) return sendError(res, "Choose a label, one of its values and the date", 400);
  const q = parsed.data;
  try {
    // L-123: the opening by label from balancesAsOf, then the entries of the day
    const day = await getReportContext(authReq, q.workspaceId, q.endDate, q.endDate);
    const opening = await openingBefore(getDb(), q.workspaceId, day.accounts, q.endDate, { byLabel: true, gross: true });
    if (opening) return res.json(balanceSheetByLabel(day.accounts, day.transactions, q.dimensionId, q.value, q.endDate, labelOpeningOf(opening, q.dimensionId, q.value)));
    const { accounts, transactions } = await getReportContext(authReq, q.workspaceId, undefined, q.endDate);
    res.json(balanceSheetByLabel(accounts, transactions, q.dimensionId, q.value, q.endDate));
  } catch (error) {
    if (/not a member|Unauthorized|FORBIDDEN/i.test(errorMessage(error))) return sendError(res, "Forbidden", 403);
    if (/not.found/i.test(errorMessage(error))) return sendError(res, "Workspace not found", 404);
    sendError(res, "Could not make the balance sheet by label", 500, errorMessage(error));
  }
});

/** Z-20: one of the person's groups of books, each member side by side and the total (groupReport.ts). */
reportRouter.get("/group-summary", async (req, res) => {
  const parsed = z.object({
    groupId: z.string().min(1).max(100), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // Z-17: translate into one currency, with rates as JSON { "EUR": { "closing": 1.1, "average": 1.08, "historical": 1.05 } }
    reportCurrency: z.string().regex(/^[A-Z]{3}$/).optional(), rates: z.string().max(5000).optional(),
    // Z-20: account by account as well
    detail: z.enum(['accounts']).optional(),
  }).safeParse(req.query);
  if (!parsed.success) return sendError(res, "Choose a group and the period (YYYY-MM-DD)", 400, parsed.error.issues);
  let rates: Record<string, { closing: number; average: number; historical: number }> | undefined;
  try {
    rates = parsed.data.rates ? z.record(z.string().regex(/^[A-Z]{3}$/), z.object({ closing: z.number(), average: z.number(), historical: z.number() })).parse(JSON.parse(parsed.data.rates)) : undefined;
  } catch {
    return sendError(res, "The rates could not be read", 400);
  }
  const user = requestUser(req);
  // an API key belongs to one workspace: a group report is for people
  if (user.developerWorkspaceId) return sendError(res, "Group reports are not available with an API key", 403);
  try {
    res.json(await groupSummary(getDb(), { uid: user.uid, ...parsed.data, rates }));
  } catch (error) {
    if (error instanceof GroupReportError) return sendError(res, error.message, error.status);
    sendError(res, "Could not make the group summary", 500, errorMessage(error));
  }
});

reportRouter.get("/trial-balance", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const result = WorkspaceIdSchema.safeParse(req.query);
  if (!result.success) return sendError(res, "Invalid parameters", 400, result.error.issues);
  const { workspaceId } = result.data;

  const rawAsOfDate = req.query.asOfDate || req.query.endDate;
  if (rawAsOfDate !== undefined && typeof rawAsOfDate !== 'string') {
    return sendError(res, "Invalid parameters", 400, [{ path: ['asOfDate'], message: "Must be a single date string" }]);
  }
  const asOfDate = rawAsOfDate;
  if (asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    return sendError(res, "Invalid parameters", 400, [{ path: ['asOfDate'], message: "Use YYYY-MM-DD" }]);
  }

  try {
    // L-123: the opening (gross debits and credits) from balancesAsOf, then the entries of the day
    if (asOfDate) {
      const day = await getReportContext(authReq, workspaceId, asOfDate, asOfDate);
      const opening = await openingBefore(getDb(), workspaceId, day.accounts, asOfDate, { gross: true });
      if (opening) return res.json(withProvenance(computeTrialBalance(day.accounts, day.transactions, asOfDate, grossOf(opening))));
    }
    const { accounts, transactions } = await getReportContext(authReq, workspaceId, undefined, asOfDate);
    const tb = computeTrialBalance(accounts, transactions, asOfDate);
    res.json(withProvenance(tb));
  } catch (error) {
    if (errorMessage(error) === "FORBIDDEN") return sendError(res, "Forbidden", 403);
    if (errorMessage(error) === "NOT_FOUND" || errorMessage(error).includes("NOT_FOUND")) return sendError(res, "Workspace not found", 404);
    sendError(res, "Trial Balance Failure", 500, errorMessage(error));
  }
});

reportRouter.get("/cash-flow", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const result = ReportRangeSchema.safeParse(req.query);
  if (!result.success) return sendError(res, "Invalid parameters", 400, result.error.issues);
  const { workspaceId, startDate, endDate } = result.data;

  try {
    const { accounts, transactions } = await getReportContext(authReq, workspaceId, startDate, endDate);
    const cf = computeCashFlow(accounts, transactions, startDate, endDate);
    // L-123: the cash at the start (the accounts' opening balances and every entry before the period, from
    // balancesAsOf) and at the end (the start plus the net change)
    const before = startDate ? (await openingBefore(getDb(), workspaceId, accounts, startDate))?.accounts || {} : {};
    const openingCashCents = accounts.filter(isCashFlowCashAccount).reduce((sum, acc) => sum + openingDebitCents(acc) + (before[acc.id] || 0), 0);
    res.json(withProvenance({ ...cf, openingCashCents, closingCashCents: openingCashCents + cf.netChange }));
  } catch (error) {
    if (errorMessage(error) === "FORBIDDEN") return sendError(res, "Forbidden", 403);
    if (errorMessage(error) === "NOT_FOUND" || errorMessage(error).includes("NOT_FOUND")) return sendError(res, "Workspace not found", 404);
    sendError(res, "Failed to generate cash flow statement", 500, errorMessage(error));
  }
});

function calculateMonthDateRange(monthStr: string): { startDate: string; endDate: string } {
  const [yearStr, monthNumStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10);
  if (!year || !month || month < 1 || month > 12) {
    return { startDate: `${monthStr}-01`, endDate: `${monthStr}-31` };
  }
  const lastDay = new Date(year, month, 0).getDate();
  const mPadded = String(month).padStart(2, '0');
  const dPadded = String(lastDay).padStart(2, '0');
  return {
    startDate: `${year}-${mPadded}-01`,
    endDate: `${year}-${mPadded}-${dPadded}`
  };
}

reportRouter.get("/budget-vs-actual", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const result = WorkspaceIdSchema.extend({ month: z.string().optional() }).safeParse(req.query);
  if (!result.success) return sendError(res, "Invalid parameters", 400, result.error.issues);
  const { workspaceId, month } = result.data;

  try {
    await authorizeWorkspace(authReq, workspaceId);
    const db = getDb();

    let txQuery: Query = db.collection("transactions").where("workspaceId", "==", workspaceId);
    
    const targetMonth = month ? String(month) : getLocalDateISO(new Date()).substring(0, 7);
    const { startDate: mStart, endDate: mEnd } = calculateMonthDateRange(targetMonth);
    txQuery = txQuery.where("date", ">=", mStart).where("date", "<=", mEnd);

    const [budgetsSnap, accountsSnap] = await Promise.all([
      db.collection("budgets").where("workspaceId", "==", workspaceId).get(),
      db.collection("chartAccounts").where("workspaceId", "==", workspaceId).get()
    ]);

    let transactions: LedgerTransaction[] = [];
    await new Promise<void>((resolve, reject) => {
      txQuery.stream()
        .on("data", (doc: { id: string; data: () => DocumentData }) => transactions.push({ ...doc.data(), id: doc.id } as LedgerTransaction))
        .on("end", () => resolve())
        .on("error", async (err: unknown) => {
          try {
            const snap = await txQuery.get();
            transactions = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as LedgerTransaction);
            resolve();
          } catch {
            reject(err);
          }
        });
    });

    // Budgets name their account in targetId (by id, name or code, as Budgets → BudgetManager
    // shows them); older budgets used accountId.
    const budgets = budgetsSnap.docs.map((doc) => doc.data() as Budget & { accountId?: string });
    const accounts = accountsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ChartAccount);

    transactions = transactions.filter(tx => tx.date && tx.date.startsWith(targetMonth));

    const report = budgets.map((b) => {
      const target = b.targetId || b.accountId || '';
      const targetLower = target.toLowerCase();
      const account = accounts.find(a =>
        a.id === target || (a.name || '').toLowerCase() === targetLower || (a.code || '').toLowerCase() === targetLower);
      let actual = 0;
      transactions.forEach((tx) => {
        if (!isPostable(tx)) return;
        tx.lines?.forEach((line) => {
          if (line.accountId === target || (account && line.accountId === account.id)) {
            actual += Math.max(0, lineAmount(line, tx));
          }
        });
      });

      return {
        accountId: account?.id || target || null,
        accountCode: account?.code || null,
        accountName: account?.name || target || 'Unknown',
        budget: b.amountCents,
        actual,
        variance: b.amountCents - actual,
        percent: b.amountCents > 0 ? (actual / b.amountCents) * 100 : 0
      };
    });

    res.json(report);
  } catch (error) {
    if (errorMessage(error) === "FORBIDDEN") return sendError(res, "Forbidden", 403);
    if (errorMessage(error) === "NOT_FOUND" || errorMessage(error).includes("NOT_FOUND")) return sendError(res, "Workspace not found", 404);
    sendError(res, "Failed to generate budget vs actual report", 500, errorMessage(error));
  }
});

reportRouter.get("/general-ledger", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const result = ReportRangeSchema.extend({ accountId: z.string().optional() }).safeParse(req.query);
  if (!result.success) return sendError(res, "Invalid parameters", 400, result.error.issues);
  const { workspaceId, startDate, endDate, accountId } = result.data;

  try {
    // L-123: the opening line from balancesAsOf (the day before the period), then the period's entries
    if (startDate) {
      const period = await getReportContext(authReq, workspaceId, startDate, endDate);
      const opening = await openingBefore(getDb(), workspaceId, period.accounts, startDate);
      if (opening) return res.json(withProvenance(computeGeneralLedger(period.accounts, period.transactions, startDate, endDate, accountId, opening.accounts)));
    }
    const { accounts, transactions } = await getReportContext(authReq, workspaceId, undefined, endDate);
    const gl = computeGeneralLedger(accounts, transactions, startDate, endDate, accountId);
    res.json(withProvenance(gl));
  } catch (error) {
    if (errorMessage(error) === "FORBIDDEN") return sendError(res, "Forbidden", 403);
    if (errorMessage(error) === "NOT_FOUND" || errorMessage(error).includes("NOT_FOUND")) return sendError(res, "Workspace not found", 404);
    sendError(res, "Failed to generate General Ledger report", 500, errorMessage(error));
  }
});

/** AUD-01: a customer's or vendor's statement, by the scope the screen and the PDF use (statementService.ts). */
reportRouter.get("/statement", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const result = WorkspaceIdSchema.extend({
    type: z.enum(['customer', 'vendor']),
    contactId: z.string().min(1),
    startDate: z.string().optional(),
    endDate: z.string().optional()
  }).safeParse(req.query);
  if (!result.success) return sendError(res, "Invalid parameters", 400, result.error.issues);
  const { workspaceId, type, contactId, startDate, endDate } = result.data;

  try {
    await authorizeWorkspace(authReq, workspaceId);
    // another workspace's contact answers like a missing one
    const loaded = await loadStatement(getDb(), workspaceId, contactId, { startDate, endDate }, type);
    if (!loaded) return sendError(res, "Contact not found", 404);
    res.json(loaded.statement);
  } catch (error) {
    if (error instanceof StatementScopeError) return sendError(res, error.message, 400);
    if (errorMessage(error) === "FORBIDDEN") return sendError(res, "Forbidden", 403);
    if (errorMessage(error) === "NOT_FOUND" || errorMessage(error).includes("NOT_FOUND")) return sendError(res, "Workspace not found", 404);
    sendError(res, "Failed to generate Statement", 500, errorMessage(error));
  }
});

