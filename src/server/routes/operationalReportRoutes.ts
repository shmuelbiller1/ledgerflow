import { budgetLabel } from '../../lib/budgetByLabel';
import express from 'express';
import { z } from 'zod';
import { errorMessage, requestUser } from '../auth/requestUser';
import type { DocumentData, Firestore } from '../db/firestore';
import type { ReportReadScope } from '../reports/readScope';
import { WorkspaceIdSchema } from '../../schemas';
import { computePartyAging } from '../../lib/aging';
import {
  computeContactBalanceSummary,
  computeCustomerBalanceSummary,
  computeVendorBalanceSummary,
} from '../reports/partyReports';
import { paymentMethodSummary } from '../../lib/paymentMethodSummary';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { computeBudgetActual, type SavedBudget } from '../../lib/budgetActual';
import { splitReportPeriods } from '../../lib/reportColumns';
import { serverProvenance } from '../../lib/reportProvenance';
import { logSafe, logSafeDetail } from '../utils/logSafe';
import type {
  Bill,
  ChartAccount,
  CreditNote,
  Customer,
  Invoice,
  Payment,
  Transaction,
  Vendor,
  VendorCredit,
} from '../../types';

function sendReportError(res: express.Response, message: string, status = 500, details?: unknown) {
  console.error(`[API Error] ${status}: ${logSafe(message)}`, logSafeDetail(details));
  res.status(status).json({ status: 'error', message, ...(details ? { details } : {}) });
}

function handleCommonError(res: express.Response, error: unknown, fallback: string) {
  const msg = errorMessage(error);
  if (msg === 'FORBIDDEN') return sendReportError(res, 'Forbidden', 403);
  if (msg === 'NOT_FOUND' || msg.includes('NOT_FOUND')) return sendReportError(res, 'Workspace not found', 404);
  return sendReportError(res, fallback, 500, msg);
}

async function streamWorkspaceCollection<T>(db: Firestore, collectionName: string, workspaceId: string): Promise<T[]> {
  const rows: T[] = [];
  const stream = db.collection(collectionName).where('workspaceId', '==', workspaceId).stream();
  for await (const chunk of stream as AsyncIterable<{ id: string; data: () => DocumentData }>) {
    rows.push({ ...chunk.data(), id: chunk.id } as T);
  }
  return rows;
}

export function createOperationalReportRouter({ db, authorize }: ReportReadScope): express.Router {
  const operationalReportRouter = express.Router();

  /** M-1: Uncapped server-computed A/R or A/P party aging rows (`computePartyAging`). */
  operationalReportRouter.get('/party-aging', async (req, res) => {
    const parsed = WorkspaceIdSchema.extend({
      side: z.enum(['customer', 'vendor']),
      asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).safeParse(req.query);
    if (!parsed.success) return sendReportError(res, 'Invalid parameters', 400, parsed.error.issues);
    const { workspaceId, side, asOfDate } = parsed.data;

    try {
      const { data: workspace } = await authorize(workspaceId, requestUser(req));
      const baseCurrency = String(workspace.currency || 'USD');
      const [parties, documents] = await Promise.all([
        streamWorkspaceCollection<Customer | Vendor>(db, side === 'customer' ? 'customers' : 'vendors', workspaceId),
        streamWorkspaceCollection<Invoice | Bill>(db, side === 'customer' ? 'invoices' : 'bills', workspaceId),
      ]);
      const rows = computePartyAging(parties, documents, side, asOfDate, baseCurrency);
      return res.json({ rows, provenance: serverProvenance() });
    } catch (error) {
      return handleCommonError(res, error, 'Failed to generate party aging report');
    }
  });

  /** M-1: Uncapped server-computed customer, vendor, and combined contact balances. */
  operationalReportRouter.get('/party-balances', async (req, res) => {
    const parsed = WorkspaceIdSchema.extend({
      asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).safeParse(req.query);
    if (!parsed.success) return sendReportError(res, 'Invalid parameters', 400, parsed.error.issues);
    const { workspaceId, asOfDate } = parsed.data;

    try {
      const { data: workspace } = await authorize(workspaceId, requestUser(req));
      const baseCurrency = String(workspace.currency || 'USD');
      const [customers, vendors, invoices, bills, payments, creditNotes, vendorCredits] = await Promise.all([
        streamWorkspaceCollection<Customer>(db, 'customers', workspaceId),
        streamWorkspaceCollection<Vendor>(db, 'vendors', workspaceId),
        streamWorkspaceCollection<Invoice>(db, 'invoices', workspaceId),
        streamWorkspaceCollection<Bill>(db, 'bills', workspaceId),
        streamWorkspaceCollection<Payment>(db, 'payments', workspaceId),
        streamWorkspaceCollection<CreditNote>(db, 'creditNotes', workspaceId),
        streamWorkspaceCollection<VendorCredit>(db, 'vendorCredits', workspaceId),
      ]);
      const customerRows = computeCustomerBalanceSummary(customers, invoices, payments, creditNotes, asOfDate, undefined, undefined, baseCurrency);
      const vendorRows = computeVendorBalanceSummary(vendors, bills, payments, vendorCredits, asOfDate, undefined, undefined, baseCurrency);
      const contactRows = computeContactBalanceSummary(customerRows, vendorRows);
      return res.json({ customerRows, vendorRows, contactRows, provenance: serverProvenance() });
    } catch (error) {
      return handleCommonError(res, error, 'Failed to generate party balance summary');
    }
  });

  /** M-1: Uncapped server-computed payment receipts summary by method. */
  operationalReportRouter.get('/payment-methods', async (req, res) => {
    const parsed = WorkspaceIdSchema.extend({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      compareStartDate: z.string().optional(),
      compareEndDate: z.string().optional(),
    }).safeParse(req.query);
    if (!parsed.success) return sendReportError(res, 'Invalid parameters', 400, parsed.error.issues);
    const { workspaceId, startDate, endDate, compareStartDate = '', compareEndDate = '' } = parsed.data;
    if (!validCustomReportPeriod({ startDate, endDate })) {
      return sendReportError(res, 'Invalid report period', 400);
    }

    try {
      const { data: workspace } = await authorize(workspaceId, requestUser(req));
      const baseCurrency = String(workspace.currency || 'USD');
      const [customers, payments] = await Promise.all([
        streamWorkspaceCollection<Customer>(db, 'customers', workspaceId),
        streamWorkspaceCollection<Payment>(db, 'payments', workspaceId),
      ]);
      const rows = paymentMethodSummary(customers, payments, { startDate, endDate }, baseCurrency);
      const previousRows = validCustomReportPeriod({ startDate: compareStartDate, endDate: compareEndDate })
        ? paymentMethodSummary(customers, payments, { startDate: compareStartDate, endDate: compareEndDate }, baseCurrency)
        : [];
      return res.json({ rows, previousRows, provenance: serverProvenance() });
    } catch (error) {
      return handleCommonError(res, error, 'Failed to generate payment method summary');
    }
  });

  /** M-1: Uncapped server-computed multi-period budget vs actual report. */
  operationalReportRouter.get('/budget-actual-periods', async (req, res) => {
    const parsed = WorkspaceIdSchema.extend({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      mode: z.enum(['total', 'months']).default('total'),
      budgetId: z.string().optional(),
    }).safeParse(req.query);
    if (!parsed.success) return sendReportError(res, 'Invalid parameters', 400, parsed.error.issues);
    const { workspaceId, startDate, endDate, mode, budgetId } = parsed.data;

    try {
      await authorize(workspaceId, requestUser(req));
      const [allBudgets, accounts, transactions] = await Promise.all([
        streamWorkspaceCollection<SavedBudget>(db, 'budgets', workspaceId),
        streamWorkspaceCollection<ChartAccount>(db, 'chartAccounts', workspaceId),
        streamWorkspaceCollection<Transaction>(db, 'transactions', workspaceId),
      ]);
      // EU-E5: label budgets are compared in Profit by Label; this report is account-wide.
      const budgets = allBudgets.filter(b => !budgetLabel(b));
      const budget = (budgetId ? budgets.find(b => b.id === budgetId) : undefined)
        || budgets.find(b => b.targetType === 'account');
      const periods = splitReportPeriods(startDate, endDate, mode);
      const report = budget ? computeBudgetActual(budget, accounts, transactions, periods) : null;
      return res.json({ budgets, report, provenance: serverProvenance() });
    } catch (error) {
      return handleCommonError(res, error, 'Failed to generate budget vs actual periods report');
    }
  });
  return operationalReportRouter;
}
