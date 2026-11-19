import crypto from 'node:crypto';
import { BRAND_NAME } from '../../config/brand';
import { calculateAmountDue } from '../../lib/documentMath';
import { isPostable, lineAmount } from '../../lib/txFilters';
import type { ChartAccount, InventoryItem, Invoice, Transaction as LedgerTransaction } from '../../types';
import { errorMessage } from '../auth/requestUser';
import { requireLiveDb, type Firestore } from '../db/firestore';
import { formatTzDate } from '../http/serverKit';
import { toBaseCents } from '../reports/partyReports';
import { incrementShardedCounter } from './shardedCounterService';

/** Run only after its job row has committed; the computation and its billing protocol are unchanged. */
export async function processDeepAuditInBackground(db: Firestore, jobId: string, workspaceId: string, uid: string) {
  requireLiveDb(db, 'Deep audit worker');
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
    const baseCurrency = String(wsData.currency || 'USD');

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
       const totalAmount = toBaseCents(calculateAmountDue(inv), inv.exchangeRate, inv.currency, baseCurrency);
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
Report generated chronologically for workspace **${wsData.name || `${BRAND_NAME} Register`}** on **${formatTzDate(new Date(), wsData?.settings?.timezone || wsData?.timezone)}** via ${BRAND_NAME} Deep API.

#### 1. VELOCITY RECEIVABLES ANALYSIS (DSO & WACC DRAG)
* Outstanding accounts receivable function effectively as 0% interest lines of credit to clients.
* Calculated **Velocity Bleed** drag sum against an **8.0% institutional Weighted Average Cost of Capital (WACC)**: **-$${(totalArBleedCents / 100).toFixed(2)}**.
* **Aging Accounts Log**:
${arBleedLogs.slice(0, 5).map(l => `  - **${l.customerName}** (Inv #${l.invoiceId.substring(0,6)}): Aging **${l.daysOutstanding} days**, Implied Capital Loss Drag: **-$${(l.impliedCostOfCapitalCents / 100).toFixed(2)}**`).join("\n") || "  - No immediate velocity bleed detected. High speed receivables."}

#### 2. REVENUE GRAPHS & CLIENT OVERCONCENTRATION RISK
* **Max Client Revenue contribution ratio**: **${(concentrationRatio * 100).toFixed(2)}%** (${customerIncomes[0]?.name || 'N/A'}).
* Concentration Risk threshold is **40.0%**.\u0020
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
