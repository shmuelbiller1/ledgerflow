import type { ChartAccount, InventoryItem, Invoice, Transaction as LedgerTransaction } from "../../types";
import { errorMessage, requestUser } from "../auth/requestUser";
import { formatTzDate, sendError, authorizeWorkspace } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import { apiAuthenticate } from "../auth/apiAuthenticate";
import { incrementShardedCounter } from "../services/shardedCounterService";
import express from "express";
import crypto from "crypto";
import { isPostable, lineAmount } from "../../lib/txFilters";
import { calculateAmountDue } from "../../lib/documentMath";
import { toBaseCents } from "../reports/partyReports";
import { getDb } from "../db/firestore";

/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerMetricsAuditRoutes(app: express.Express, _ctx: ServerContext): void {
  app.get("/api/v1/metrics", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.query.workspaceId as string) || requestUser(req).developerWorkspaceId;
      if (!workspaceId) return sendError(res, "Missing workspaceId query parameter", 400);

      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const db = getDb();
      const [accountsSnap, transactionsSnap] = await Promise.all([
         db.collection("chartAccounts").where("workspaceId", "==", workspaceId).get(),
         db.collection("transactions").where("workspaceId", "==", workspaceId).get()
      ]);

      const accounts = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as ChartAccount);
      const transactions = transactionsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as LedgerTransaction);

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
               sumRev -= l.amountCents;
             }
          });
          return acc + sumRev;
        }, 0);

        const calculatedMRR = Math.round(recent3MonthsRevenues / 3);
        const arr = calculatedMRR * 12;
        const churnRateProxy = 0.05; // 5% base churn rate proxy
        const ltv = churnRateProxy > 0 ? Math.round(calculatedMRR / churnRateProxy) : 0;

        shiftingMetrics = {
          industryType: "SaaS & Subscription",
          metrics: {
            arrCents: arr,
            mrrCents: calculatedMRR,
            ltvCents: ltv,
            churnPercentage: churnRateProxy * 100,
            grossMarginPercentage: totalRevenueCents > 0 ? Number.parseFloat(((totalRevenueCents - totalExpenseCents) / totalRevenueCents * 100).toFixed(2)) : 100
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
        const baseCapitalInvested = totalAssetsCents || 100000000; // $1,000,000 baseline
        const capRate = Number.parseFloat(((noiCents / baseCapitalInvested) * 100).toFixed(2));

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
        const cogsCents = transactions.reduce((acc, t) => {
          if (!isPostable(t)) return acc;
          let sumCogs = 0;
          t.lines?.forEach((l) => {
             const accObj = accounts.find(a => a.id === l.accountId);
             if (accObj?.type === 'expense' && (accObj.name.toLowerCase().includes('cogs') || accObj.name.toLowerCase().includes('cost of goods') || accObj.name.toLowerCase().includes('inventory'))) {
                sumCogs += lineAmount(l, t);
             }
          });
          return acc + sumCogs;
        }, 0) || Math.round(totalExpenseCents * 0.40);

        const grossProfitCents = totalRevenueCents - cogsCents;
        const grossMargin = totalRevenueCents > 0 ? Number.parseFloat((grossProfitCents / totalRevenueCents * 100).toFixed(2)) : 0;
        
        const inventoryAccountVal = accounts.filter(a => a.name.toLowerCase().includes('inventory'))
          .reduce((sum, a) => sum + (accountBalances[a.id] || 0), 0) || 5000000;
        const inventoryTurnover = Number.parseFloat((cogsCents / inventoryAccountVal).toFixed(2));

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
        const monthlyBurnRate = Math.round(totalExpenseCents / 12) || 400000;
        const fireNestEggCents = monthlyBurnRate * 12 * 25;
        const netCashCents = totalRevenueCents - totalExpenseCents;
        const savingsRate = totalRevenueCents > 0 ? Number.parseFloat((netCashCents / totalRevenueCents * 100).toFixed(2)) : 0;

        shiftingMetrics = {
          industryType: "General / Personal Portfolio",
          metrics: {
            monthlyBurnCents: monthlyBurnRate,
            fireTargetNestEggCents: fireNestEggCents,
            savingsRatePercentage: savingsRate,
            runwayMonthsRemaining: monthlyBurnRate > 0 ? Number.parseFloat((totalAssetsCents / monthlyBurnRate).toFixed(1)) : 99
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
          netOperatingCashFlowCents: totalRevenueCents - totalExpenseCents,
          totalLiquidAssetsCents: totalAssetsCents,
          totalLiabilitiesCents: totalLiabilitiesCents,
          equityValueCents: totalAssetsCents - totalLiabilitiesCents
        },
        shiftingMetrics,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      if (errorMessage(err) === "FORBIDDEN") return sendError(res, "Forbidden workspace access", 403);
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

      transactions.forEach(tx => {
         if (tx.status === 'void') return;
         tx.lines?.forEach((line) => {
             accountBalances[line.accountId] = (accountBalances[line.accountId] || 0) + line.amountCents;
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
        transactionVolume: transactions.length,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      if (errorMessage(err) === "FORBIDDEN") return sendError(res, "Forbidden workspace access", 403);
      sendError(res, errorMessage(err), 500);
    }
  });

  app.post("/api/v1/audit/deep", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.body.workspaceId as string) || requestUser(req).developerWorkspaceId;
      if (!workspaceId) return sendError(res, "Missing workspaceId parameters in request", 400);

      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const db = getDb();
      const jobId = `job_${crypto.randomUUID().replace(/-/g, '')}`;

      const initialJob = {
        id: jobId,
        workspaceId,
        uid: authReq.user.uid,
        status: "processing",
        progress: 10,
        createdAt: new Date().toISOString(),
        payload: req.body
      };

      await db.collection("deepAuditJobs").doc(jobId).set(initialJob);

      // Async execution process to prevent connection timeout (202 Accepted)
      processDeepAuditInBackground(jobId, workspaceId, authReq.user.uid).catch((err) => {
         console.error(`[Background deepAudit Exception] for Job ${jobId}: `, err);
      });

      res.status(202).json({
        status: "processing",
        message: "Strategic simulation launched asynchronously. Please poll job endpoint for results.",
        job_id: jobId,
        check_status_url: `/api/v1/audit/jobs/${jobId}`
      });

    } catch (err) {
      sendError(res, errorMessage(err), 500);
    }
  });

  async function processDeepAuditInBackground(jobId: string, workspaceId: string, uid: string) {
    const db = getDb();
    await new Promise((resolve) => setTimeout(resolve, 1500)); // simulation compute wait

    try {
      const [accountsSnap, transactionsSnap, invoicesSnap, inventorySnap] = await Promise.all([
        db.collection("chartAccounts").where("workspaceId", "==", workspaceId).get(),
        db.collection("transactions").where("workspaceId", "==", workspaceId).get(),
        db.collection("invoices").where("workspaceId", "==", workspaceId).get(),
        db.collection("inventory").where("workspaceId", "==", workspaceId).get()
      ]);

      const accounts = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as ChartAccount);
      const transactions = transactionsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as LedgerTransaction);
      const invoices = invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Invoice);
      const inventory = inventorySnap.docs.map(d => ({ id: d.id, ...d.data() }) as InventoryItem);

      const wsDoc = await db.collection("workspaces").doc(workspaceId).get();
      const wsData = wsDoc.data() || {};

      const nowMs = Date.now();
      let totalRevenue = 0;
      let totalExpense = 0;

      const balances: Record<string, number> = {};
      transactions.forEach(t => {
        if (!isPostable(t)) return;
        t.lines?.forEach((l) => {
          balances[l.accountId] = (balances[l.accountId] || 0) + lineAmount(l, t);
        });
      });

      accounts.forEach(a => {
        const bal = balances[a.id] || 0;
        if (a.type === 'revenue') totalRevenue -= bal;
        if (a.type === 'expense') totalExpense += bal;
      });

      // 1. Receivables Velocity & DSO WACC Bleed
      const arBleedLogs = invoices.filter(inv => inv.status !== 'paid').map(inv => {
         const invDateStr = inv.dueDate || inv.date || new Date().toISOString();
         const txDateMs = new Date(invDateStr).getTime();
         const daysOutstanding = Math.max(0, Math.floor((nowMs - txDateMs) / (1000 * 60 * 60 * 24)));
         // still owed, in the base currency
         const totalAmount = toBaseCents(calculateAmountDue(inv), inv.exchangeRate);
         const impliedCostOfCapitalCents = Math.round(totalAmount * (0.08 / 365) * daysOutstanding);
         return {
           invoiceId: inv.id,
           customerName: inv.customerName || 'Unknown Customer',
           daysOutstanding,
           totalCents: totalAmount,
           impliedCostOfCapitalCents
         };
      }).filter(v => v.daysOutstanding > 5);

      const totalArBleedCents = arBleedLogs.reduce((sum, item) => sum + item.impliedCostOfCapitalCents, 0);

      // 2. Customer Overconcentration (trigger multiplier haircut)
      const clientRevenues: Record<string, number> = {};
      transactions.forEach(t => {
        if (!isPostable(t)) return;
        let revVal = 0;
        t.lines?.forEach((l) => {
           const a = accounts.find(x => x.id === l.accountId);
           if (a?.type === 'revenue') revVal -= lineAmount(l, t);
        });
        if (revVal > 0) {
           const payeeName = t.payee?.trim() || "Independent Channel";
           clientRevenues[payeeName] = (clientRevenues[payeeName] || 0) + revVal;
        }
      });

      const customerIncomes = Object.entries(clientRevenues).map(([name, amountCents]) => ({ name, amountCents }));
      customerIncomes.sort((a,b) => b.amountCents - a.amountCents);

      const maxClientIncome = customerIncomes[0]?.amountCents || 0;
      const totalIncomeCents = totalRevenue || 1;
      const concentrationRatio = Number.parseFloat((maxClientIncome / totalIncomeCents).toFixed(4));
      
      const isHighConcentrationRisk = concentrationRatio > 0.40;
      const concentrationMultiplierHaircut = isHighConcentrationRisk ? 0.85 : 1.00;

      // 3. Inventory margin review
      // costCents/priceCents: field names of items saved by older versions
      const inventoryMismatches = inventory.map((item: InventoryItem & { costCents?: number; priceCents?: number }) => {
         const directCost = item.unitCostCents || item.costCents || 0;
         const salePrice = item.unitPriceCents || item.priceCents || 1;
         const margin = (salePrice - directCost) / salePrice;
         const recommendation = margin < 0.25 
           ? `Urgent: Adjust retail pricing models upwards by ${Math.round((0.35 - margin) * 100)}% to match industry median WACC bounds.`
           : margin > 0.65 
             ? `Opportunistic: Bulk transaction volume wholesale pathway is viable to capture consumer surplus.`
             : "Optimal: Price point matches target margin horizons.";

         return {
           itemId: item.id,
           sku: item.sku || 'N/A',
           name: item.name,
           calculatedMarginPercentage: Number.parseFloat((margin * 100).toFixed(2)),
           recommendation
         };
      });

      const baseMultiple = 4.5;
      const EBITDA = totalRevenue - totalExpense;
      const impliedValuationBase = Math.max(0, EBITDA) * baseMultiple;
      const actualAjustedValuation = Math.round(impliedValuationBase * concentrationMultiplierHaircut - totalArBleedCents);

      // Markdown Strategic narrative
      const markdownReport = `### EXECUTIVE STRATEGIC DECISION AUDIT SUMMARY
Report generated chronologically for workspace **${wsData.name || 'LedgerFlow Register'}** on **${formatTzDate(new Date(), wsData?.settings?.timezone || wsData?.timezone)}** via LedgerFlow Deep API.

#### 1. VELOCITY RECEIVABLES ANALYSIS (DSO & WACC DRAG)
* Outstanding accounts receivable function effectively as 0% interest lines of credit to clients.
* Calculated **Velocity Bleed** drag sum against an **8.0% institutional Weighted Average Cost of Capital (WACC)**: **-$${(totalArBleedCents / 100).toFixed(2)}**.
* **Aging Accounts Log**:
${arBleedLogs.slice(0, 5).map(l => `  - **${l.customerName}** (Inv #${l.invoiceId.substring(0,6)}): Aging **${l.daysOutstanding} days**, Implied Capital Loss Drag: **-$${(l.impliedCostOfCapitalCents / 100).toFixed(2)}**`).join("\n") || "  - No immediate velocity bleed detected. High speed receivables."}

#### 2. REVENUE GRAPHS & CLIENT OVERCONCENTRATION RISK
* **Max Client Revenue contribution ratio**: **${(concentrationRatio * 100).toFixed(2)}%** (${customerIncomes[0]?.name || 'N/A'}).
* Concentration Risk threshold is **40.0%**. 
* **Audit findings**: ${isHighConcentrationRisk ? "🛑 **HIGH CONCENTRATION RISK DETECTED**. A single customer group holds too much leverage. Applying a 15% multiple valuation haircut." : "✅ **HEALTHY CUSTOMER DENSITY PROFILE**. Customer concentration is balanced."}

#### 3. PHYSICAL MARGINS & BULK INVENTORY ARBITRAGE
* Assessed **${inventoryMismatches.length}** catalog SKUs.
* Inventory margins summary:
${inventoryMismatches.slice(0, 4).map(m => `  - **${m.name}** (${m.sku}): Margin: **${m.calculatedMarginPercentage}%** - *${m.recommendation}*`).join("\n") || "  - Catalog empty. Skipped physical arbitrage scan."}

#### 4. VALUATION ALGORITHMIC MATRIX
* **Base Valuation expectations**: $${(impliedValuationBase / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
* **Adjusted Corporate Valuation (including DSO bleed & overconcentration haircut)**: **$${(actualAjustedValuation / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}**`;

      const finalAuditReport = {
        velocityArBleed: {
          totalCapitalCostDragCents: totalArBleedCents,
          logsCount: arBleedLogs.length,
          logs: arBleedLogs
        },
        concentrationRisk: {
            maxClientContributionRatio: concentrationRatio,
            isConcentratedThresholdTriggered: isHighConcentrationRisk,
            haircutMultiplierHit: concentrationMultiplierHaircut,
            ranking: customerIncomes
        },
        inventoryArbitrage: {
            itemsCount: inventoryMismatches.length,
            mismatches: inventoryMismatches
        },
        valuationMatrix: {
          ebitdaCents: EBITDA,
          baseMultiple,
          impliedValuationBaseCents: impliedValuationBase,
          actualAdjustedValuationCents: actualAjustedValuation,
          valuationDeltaCents: actualAjustedValuation - impliedValuationBase
        },
        markdownNarrative: markdownReport
      };

      await db.collection("deepAuditJobs").doc(jobId).set({
         id: jobId,
         status: "completed",
         progress: 100,
         workspaceId,
         uid,
         completedAt: new Date().toISOString(),
         results: finalAuditReport
      });

      // Record telemetry trace and bill standard credit units
      const traceId = crypto.randomUUID();
      const billingRef = db.collection("billingLedgerTraces").doc(`trace-${traceId}`);
      await billingRef.set({
        id: `trace-${traceId}`,
        workspaceId,
        uid,
        userEmail: "api-client@ledgerflow.io",
        algorithmName: "STRATEGIC_DEEP_AUDIT_JOB",
        complexityFormat: "O(V * E)",
        weightScore: 1200,
        executionTimeMs: 1500,
        timestamp: new Date().toISOString()
      });

      const wsRef = db.collection("workspaces").doc(workspaceId);
      const wsDocCurrent = await wsRef.get();
      if (wsDocCurrent.exists) {
         await incrementShardedCounter(db, workspaceId, 'computeCreditBalance', -1200);
      }

    } catch (e) {
       console.error("[Deep Audit Worker Crash]: ", e);
       await db.collection("deepAuditJobs").doc(jobId).set({
          id: jobId,
          status: "failed",
          progress: 100,
          workspaceId,
          uid,
          completedAt: new Date().toISOString(),
          error: errorMessage(e) || String(e)
       });
    }
  }

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
