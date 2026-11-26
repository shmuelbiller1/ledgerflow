import { isForbidden } from '../http/serverKit';
import type { ChartAccount, Transaction as LedgerTransaction } from "../../types";
import { errorMessage, requestUser } from "../auth/requestUser";
import { sendError, authorizeWorkspace, loadQueriedWorkspaceLedger } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import { apiAuthenticate } from "../auth/apiAuthenticate";
import express from "express";
import { isPostable, lineAmount } from "../../lib/txFilters";
import { getDb } from "../db/firestore";

import { deepAuditCommand } from '../commands/deepAudit';
import { executeCommand } from '../utils/commandExecutor';
/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerMetricsAuditRoutes(app: express.Express, _ctx: ServerContext): void {
  app.get("/api/v1/metrics", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const loaded = await loadQueriedWorkspaceLedger(req);
      if ('error' in loaded) return sendError(res, loaded.error, 400);
      const { workspaceId, db, accounts, transactions } = loaded;

      const wsDoc = await db.collection("workspaces").doc(workspaceId).get();
      const wsData = wsDoc.data() || {};
      const businessType = wsData.businessType || 'general';

      let totalRevenueCents = 0;
      let totalExpenseCents = 0;
      let totalAssetsCents = 0;
      let totalLiabilitiesCents = 0;

      const accountBalances: Record<string, number> = {};

      transactions.forEach(tx => {
         if (!isPostable(tx)) return;
         tx.lines?.forEach((line) => {
             accountBalances[line.accountId] = (accountBalances[line.accountId] || 0) + lineAmount(line, tx);
         });
      });

      accounts.forEach(acc => {
         const bal = accountBalances[acc.id] || 0;
         if (acc.type === 'revenue') totalRevenueCents -= bal; // Revenue is credit (negative)
         if (acc.type === 'expense') totalExpenseCents += bal; // Expense is debit (positive)
         if (acc.type === 'asset') totalAssetsCents += bal;
         if (acc.type === 'liability') totalLiabilitiesCents -= bal;
      });

      // Shifting Metrics Logic based on Business Archetype
      let shiftingMetrics: Record<string, unknown> = {};

      if (businessType === 'saas') {
        const recent3MonthsRevenues = transactions.filter(t => {
          const tDate = new Date(t.date);
          const limitDate = new Date();
          limitDate.setMonth(limitDate.getMonth() - 3);
          return isPostable(t) && tDate >= limitDate;
        }).reduce((acc, t) => {
          let sumRev = 0;
          t.lines?.forEach((l) => {
             const accObj = accounts.find(a => a.id === l.accountId);
             if (accObj?.type === 'revenue') {
               sumRev -= lineAmount(l, t);
             }
          });
          return acc + sumRev;
        }, 0);

        const calculatedMRR = Math.round(recent3MonthsRevenues / 3);
        const arr = calculatedMRR * 12;
        // AUP-29: churn is not measured from the books, so neither it nor a lifetime value built on it is given

        shiftingMetrics = {
          industryType: "SaaS & Subscription",
          metrics: {
            arrCents: arr,
            mrrCents: calculatedMRR,
            ltvCents: null,
            churnPercentage: null,
            grossMarginPercentage: totalRevenueCents > 0 ? Number.parseFloat(((totalRevenueCents - totalExpenseCents) / totalRevenueCents * 100).toFixed(2)) : null
          }
        };
      } else if (businessType === 'realestate' || businessType === 'real_estate') {
        const rentalRevenueCents = transactions.reduce((acc, t) => {
          if (!isPostable(t)) return acc;
          let sumRental = 0;
          t.lines?.forEach((l) => {
             const accObj = accounts.find(a => a.id === l.accountId);
             if (accObj?.type === 'revenue' && (accObj.name.toLowerCase().includes('rent') || accObj.name.toLowerCase().includes('lease'))) {
               sumRental -= lineAmount(l, t);
             }
          });
          return acc + sumRental;
        }, 0);

        const rentalRevenue = rentalRevenueCents || totalRevenueCents;
        const noiCents = rentalRevenue - totalExpenseCents;
        // AUP-29: capital invested is the recorded assets; with none recorded there is no cap rate (no invented baseline)
        const baseCapitalInvested = totalAssetsCents > 0 ? totalAssetsCents : null;
        const capRate = baseCapitalInvested ? Number.parseFloat(((noiCents / baseCapitalInvested) * 100).toFixed(2)) : null;

        shiftingMetrics = {
          industryType: "Real Estate Property Management",
          metrics: {
            noiCents,
            rentalRevenueCents,
            impliedCapitalInvestedCents: baseCapitalInvested,
            capRateRealizedPercentage: capRate,
            expenseToIncomeRatioPercentage: totalRevenueCents > 0 ? Number.parseFloat((totalExpenseCents / totalRevenueCents * 100).toFixed(2)) : 0
          }
        };
      } else if (businessType === 'retail' || businessType === 'manufacturing' || businessType === 'inventory') {
        const isCogsAccount = (a: { type?: string; name: string }) => a.type === 'expense' && /cogs|cost of goods|inventory/i.test(a.name);
        const cogsCents = transactions.reduce((acc, t) => {
          if (!isPostable(t)) return acc;
          let sumCogs = 0;
          t.lines?.forEach((l) => {
             const accObj = accounts.find(a => a.id === l.accountId);
             if (accObj && isCogsAccount(accObj)) sumCogs += lineAmount(l, t);
          });
          return acc + sumCogs;
        }, 0);

        // AUP-29: with no cost-of-goods account the books cannot say what goods cost, so gross profit and
        // margin are unknown (null), not "all revenue" / 100%; a COGS account with no postings is a real 0
        const hasCogsAccount = accounts.some(isCogsAccount);
        const grossProfitCents = hasCogsAccount ? totalRevenueCents - cogsCents : null;
        const grossMargin = grossProfitCents !== null && totalRevenueCents > 0 ? Number.parseFloat((grossProfitCents / totalRevenueCents * 100).toFixed(2)) : null;
        
        // AUP-29: no assumed 40% COGS or invented inventory balance; a ratio without its inputs is not given
        const inventoryAccountVal = accounts.filter(a => a.name.toLowerCase().includes('inventory'))
          .reduce((sum, a) => sum + (accountBalances[a.id] || 0), 0);
        const inventoryTurnover = inventoryAccountVal > 0 ? Number.parseFloat((cogsCents / inventoryAccountVal).toFixed(2)) : null;

        shiftingMetrics = {
          industryType: "Retail Commerce & Goods Optimization",
          metrics: {
            grossProfitCents,
            cogsCents,
            grossMarginPercentage: grossMargin,
            inventoryAccountBalanceCents: inventoryAccountVal,
            inventoryTurnoverRatio: inventoryTurnover
          }
        };
      } else {
        // AUP-29: the recorded expenses spread over a year; no invented 4,000 burn when there are none
        const monthlyBurnRate = Math.round(totalExpenseCents / 12);
        const fireNestEggCents = monthlyBurnRate * 12 * 25;
        const netCashCents = totalRevenueCents - totalExpenseCents;
        const savingsRate = totalRevenueCents > 0 ? Number.parseFloat((netCashCents / totalRevenueCents * 100).toFixed(2)) : 0;

        shiftingMetrics = {
          industryType: "General / Personal Portfolio",
          metrics: {
            monthlyBurnCents: monthlyBurnRate,
            fireTargetNestEggCents: fireNestEggCents,
            savingsRatePercentage: savingsRate,
            runwayMonthsRemaining: monthlyBurnRate > 0 ? Number.parseFloat((totalAssetsCents / monthlyBurnRate).toFixed(1)) : null
          }
        };
      }

      res.status(200).json({
        status: "success",
        workspaceId,
        businessType,
        coreMetrics: {
          grossRevenueCents: totalRevenueCents,
          operatingExpenseCents: totalExpenseCents,
          // AUP-29: revenue minus expenses is net income, not a cash-flow figure; the old name is kept for
          // existing integrations and says the same number
          netIncomeCents: totalRevenueCents - totalExpenseCents,
          netOperatingCashFlowCents: totalRevenueCents - totalExpenseCents,
          totalLiquidAssetsCents: totalAssetsCents,
          totalLiabilitiesCents: totalLiabilitiesCents,
          equityValueCents: totalAssetsCents - totalLiabilitiesCents
        },
        shiftingMetrics,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      if (isForbidden(errorMessage(err))) return sendError(res, "Forbidden workspace access", 403);
      sendError(res, errorMessage(err), 500);
    }
  });

  app.get("/api/v1/metrics/summary", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.query.workspaceId as string) || requestUser(req).developerWorkspaceId;
      if (!workspaceId) return sendError(res, "Missing workspaceId query parameters", 400);

      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const db = getDb();
      const [accountsSnap, transactionsSnap] = await Promise.all([
         db.collection("chartAccounts").where("workspaceId", "==", workspaceId).get(),
         db.collection("transactions").where("workspaceId", "==", workspaceId).get()
      ]);

      const accounts = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as ChartAccount);
      const transactions = transactionsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as LedgerTransaction);

      let totalRevenue = 0;
      let totalExpense = 0;
      let totalAssets = 0;
      let totalLiabilities = 0;

      const accountBalances: Record<string, number> = {};

      // AUP-28: the same figures as /api/v1/metrics — posted entries only (no drafts, forecasts or voids),
      // each line in the book currency (lineAmount converts a foreign line at its own rate)
      transactions.forEach(tx => {
         if (!isPostable(tx)) return;
         tx.lines?.forEach((line) => {
             accountBalances[line.accountId] = (accountBalances[line.accountId] || 0) + lineAmount(line, tx);
         });
      });

      accounts.forEach(acc => {
         const bal = accountBalances[acc.id] || 0;
         if (acc.type === 'revenue') totalRevenue -= bal; // Revenue is credit (negative)
         if (acc.type === 'expense') totalExpense += bal; // Expense is debit (positive)
         if (acc.type === 'asset') totalAssets += bal;
         if (acc.type === 'liability') totalLiabilities -= bal;
      });

      res.json({
        status: "success",
        workspaceId,
        metrics: {
           netIncomeCents: totalRevenue - totalExpense,
           grossRevenueCents: totalRevenue,
           totalOpExCents: totalExpense,
           currentAssetsCents: totalAssets,
           totalLiabilitiesCents: totalLiabilities,
           equityCents: totalAssets - totalLiabilities
        },
        transactionVolume: transactions.filter(isPostable).length,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      if (isForbidden(errorMessage(err))) return sendError(res, "Forbidden workspace access", 403);
      sendError(res, errorMessage(err), 500);
    }
  });

  app.post("/api/v1/audit/deep", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.body.workspaceId as string) || requestUser(req).developerWorkspaceId;
      if (!workspaceId) return sendError(res, "Missing workspaceId parameters in request", 400);
      await authorizeWorkspace(req as AuthenticatedRequest, workspaceId);
      await executeCommand(req, res, {
        definition: deepAuditCommand,
        workspaceId,
        input: { payload: req.body },
        legacyRoute: true,
        legacyOperationId: 'ignore',
        formatResponse(outcome) {
          if (!outcome.ok) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
          const { jobId } = outcome.data as { jobId: string };
          return { status: 202, body: {
            status: 'processing', message: 'Strategic simulation launched asynchronously. Please poll job endpoint for results.',
            job_id: jobId, check_status_url: `/api/v1/audit/jobs/${jobId}`,
          } };
        },
      });
    } catch (err) {
      sendError(res, errorMessage(err), 500);
    }
  });

  app.get("/api/v1/audit/jobs/:job_id", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const jobId = (req.params as Record<string, string>).job_id;
      const workspaceId = (req.query.workspaceId as string) || requestUser(req).developerWorkspaceId;

      if (!workspaceId) {
         return sendError(res, "Missing workspaceId query parameters during poll checks.", 400);
      }

      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const db = getDb();
      const jobDoc = await db.collection("deepAuditJobs").doc(jobId).get();
      if (!jobDoc.exists) {
         return sendError(res, "Job signature not found", 404);
      }

      const jobData = jobDoc.data();
      if (!jobData) {
         return sendError(res, "Job data is empty", 404);
      }
      if (jobData.workspaceId !== workspaceId) {
         return sendError(res, "Job does not belong to specified workspace context.", 403);
      }

      res.status(200).json({
         status: "success",
         job_id: jobId,
         jobStatus: jobData.status,
         progress: jobData.progress,
         createdAt: jobData.createdAt,
         completedAt: jobData.completedAt || null,
         error: jobData.error || null,
         results: jobData.results || null
      });

    } catch (err) {
      sendError(res, errorMessage(err), 500);
    }
  });
}
