import { errorMessage, requestUser } from "../auth/requestUser";
import { formatTzDate, sendError, authorizeWorkspace, authenticate } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import { apiAuthenticate } from "../auth/apiAuthenticate";
import express from "express";
import type { AutoRule, Transaction as LedgerTransaction } from "../../types";

/** An account the labeler can pick, and one row of the body's transactions (any shape the caller sends). */
type LabelAccount = { id: string; name: string; type?: string };
type LabelInput = { id?: unknown; description?: unknown; memo?: unknown; payee?: unknown; date?: unknown; amountCents?: unknown; amount?: unknown };
import { WorkspaceIdSchema } from "../../schemas";
import { TruthEngine } from "../../modules/integrity/TruthEngine";
import { assertWorkspaceAccess, getDb } from "../db/firestore";

/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerLabelingRoutes(app: express.Express, _ctx: ServerContext): void {
  app.post("/api/v1/forensics/anomaly-scan", authenticate, async (req: express.Request, res: express.Response) => {
    const authReq = req as AuthenticatedRequest;
    const { workspaceId } = req.body;
    if (!workspaceId) return sendError(res, "workspaceId is required", 400);
    try {
      await authorizeWorkspace(authReq, workspaceId);
      const db = getDb();
      const snapshot = await db.collection("transactions")
        .where("workspaceId", "==", workspaceId)
        .limit(200)
        .get();
      const txs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as LedgerTransaction);
      
      const amounts = txs.map(t => Math.abs(t.totalAmountCents || 0)).filter(a => a > 0);
      let anomalies: Array<{ id: string; description: string; amountCents: number; reason: string }> = [];
      if (amounts.length >= 5) {
        const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
        const stdDev = Math.sqrt(amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length);
        anomalies = txs.filter(t => {
          const amt = Math.abs(t.totalAmountCents || 0);
          return stdDev > 0 && Math.abs(amt - mean) > 2.5 * stdDev;
        }).map(t => ({
          id: t.id,
          description: t.description || 'Transaction',
          amountCents: t.totalAmountCents,
          reason: 'Statistically anomalous amount (Z-Score > 2.5)'
        }));
      }
      res.json({ status: "success", anomalies });
    } catch (error) {
      sendError(res, "Failed to run anomaly scan", 500, errorMessage(error));
    }
  });

  app.get("/api/activity-feed", authenticate, async (req: express.Request, res: express.Response) => {
    const authReq = req as AuthenticatedRequest;
    const result = WorkspaceIdSchema.safeParse(req.query);
    if (!result.success) return sendError(res, "Invalid parameters", 400, result.error.issues);
    
    const { workspaceId } = result.data;

    try {
      await authorizeWorkspace(authReq, workspaceId);
      const db = getDb();
      const snap = await db.collection("auditLogs")
        .where("workspaceId", "==", workspaceId)
        .limit(20)
        .get();

      const logs = snap.docs.map((doc) => doc.data());
      res.json(logs);
    } catch (error) {
      if (errorMessage(error) === "FORBIDDEN") return sendError(res, "Forbidden", 403);
      if (errorMessage(error) === "NOT_FOUND" || errorMessage(error).includes("NOT_FOUND")) return sendError(res, "Workspace not found", 404);
      sendError(res, "Failed to fetch activity feed", 500, errorMessage(error));
    }
  });

  // --- High Performance Rule Labeling Engine API (Excel Integration Ready) ---

  app.post("/api/v1/label-transactions", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.body.workspaceId as string) || requestUser(req).developerWorkspaceId;
      let finalWorkspaceId = workspaceId;
      const db = getDb();

      if (!finalWorkspaceId) {
        const wsSnap = await db.collection("workspaces").where("uid", "==", requestUser(req).uid).limit(1).get();
        if (!wsSnap.empty) finalWorkspaceId = wsSnap.docs[0].id;
      }

      if (!finalWorkspaceId) {
        finalWorkspaceId = "sandbox_labeling";
      } else {
        // Only members may use a workspace's accounts and rules
        await assertWorkspaceAccess(db, finalWorkspaceId, (req as AuthenticatedRequest).user).catch(() => { throw Object.assign(new Error("Not a member of this workspace"), { status: 403 }); });
      }

      const { transactions } = req.body;
      if (!transactions || !Array.isArray(transactions)) {
        return sendError(res, "Missing or invalid 'transactions' payload. Must be an array of objects.", 400);
      }

      let accounts: LabelAccount[] = [];
      let rules: AutoRule[] = [];

      try {
        if (finalWorkspaceId && finalWorkspaceId !== "sandbox_labeling") {
          const [accountsSnap, rulesSnap] = await Promise.all([
            db.collection("chartAccounts").where("workspaceId", "==", finalWorkspaceId).get(),
            db.collection("autoRules").where("workspaceId", "==", finalWorkspaceId).get()
          ]);
          accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as LabelAccount);
          rules = rulesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as AutoRule);
        }
      } catch (err) {
        console.warn("[Labeler API] Direct DB configuration fetch bypassed safely: ", (err as Error).message || err);
      }

      if (accounts.length === 0) {
        accounts = [
          { id: "revenue", name: "Operating Revenue / Sales", type: "revenue" },
          { id: "software", name: "Software Hosting / SaaS", type: "expense" },
          { id: "marketing", name: "Marketing & Advertising", type: "expense" },
          { id: "travel", name: "Travel & Lodging", type: "expense" },
          { id: "payroll", name: "Payroll & Team Wages", type: "expense" },
          { id: "tax", name: "Tax Expenses", type: "expense" },
          { id: "office", name: "Office Supplies", type: "expense" },
          { id: "uncategorized", name: "Uncategorized/Suspense", type: "expense" }
        ];
      }

      const labeledTransactions = (transactions as LabelInput[]).map((tx, idx: number) => {
        const rawDesc = String(tx.description || tx.memo || tx.payee || "").trim();
        const rawDate = String(tx.date || formatTzDate(new Date()));
        const amountCents = typeof tx.amountCents === "number" ? tx.amountCents : TruthEngine.parseAmountToCents(typeof tx.amount === 'number' ? tx.amount : String(tx.amount || "0"));
        const payeeVal = String(tx.payee || "").trim();

        let matchedAccountName = "Uncategorized/Suspense";
        let matchedCategoryId = "uncategorized";
        let confidenceScore = 0.40;
        let ruleIdMatched = null;

        const lowerDesc = rawDesc.toLowerCase();

        // 1. Resolve with Custom Rules Sequence
        if (rules.length > 0) {
          for (const rule of rules) {
            const pattern = (rule.condition?.descriptionContains || "").toLowerCase().trim();
            const vendor = (rule.condition?.vendor || "").toLowerCase().trim();

            if (pattern && lowerDesc.includes(pattern)) {
              const acc = accounts.find(a => a.id === rule.action?.targetNodeId);
              if (acc) {
                matchedAccountName = acc.name;
                matchedCategoryId = acc.id;
                confidenceScore = 0.95;
                ruleIdMatched = rule.id;
                break;
              }
            }

            if (vendor && payeeVal.toLowerCase().includes(vendor)) {
              const acc = accounts.find(a => a.id === rule.action?.targetNodeId);
              if (acc) {
                matchedAccountName = acc.name;
                matchedCategoryId = acc.id;
                confidenceScore = 0.95;
                ruleIdMatched = rule.id;
                break;
              }
            }
          }
        }

        // 2. Fallback to System Heuristics Lexicon
        if (confidenceScore < 0.8) {
          if (/(aws|amazon web|google cloud|gcp|heroku|vercel|digitalocean|cloudflare|github|slack|zoom|openai|gsuite|microsoft)/i.test(lowerDesc)) {
            const acc = accounts.find(a => a.type === "expense" && /soft|SaaS|host|compute|tech/gi.test(a.name || '')) || accounts.find(a => a.id === "software");
            if (acc) {
              matchedAccountName = acc.name;
              matchedCategoryId = acc.id;
              confidenceScore = 0.85;
            }
          }
          else if (/(ads|facebook|instagram|meta|google ads|adwords|campaign|marketing|promo|twitter|linkedin)/i.test(lowerDesc)) {
            const acc = accounts.find(a => a.type === "expense" && /market|advert|growth/gi.test(a.name || '')) || accounts.find(a => a.id === "marketing");
            if (acc) {
              matchedAccountName = acc.name;
              matchedCategoryId = acc.id;
              confidenceScore = 0.85;
            }
          }
          else if (/(uber|lyft|taxi|delta|united|airline|flight|hotel|airbnb|expedia|travel|cab)/i.test(lowerDesc)) {
            const acc = accounts.find(a => a.type === "expense" && /travel|lodge|commute/gi.test(a.name || '')) || accounts.find(a => a.id === "travel");
            if (acc) {
              matchedAccountName = acc.name;
              matchedCategoryId = acc.id;
              confidenceScore = 0.85;
            }
          }
          else if (/(salary|wage|payroll|team|staff|remuneration|gusto|paychex|rippling)/i.test(lowerDesc)) {
            const acc = accounts.find(a => a.type === "expense" && /payr|wage|salary|compens/gi.test(a.name || '')) || accounts.find(a => a.id === "payroll");
            if (acc) {
              matchedAccountName = acc.name;
              matchedCategoryId = acc.id;
              confidenceScore = 0.85;
            }
          }
          else if (/(irs|tax|levy|vat|gst|revenue agency|comptroller)/i.test(lowerDesc)) {
            const acc = accounts.find(a => a.type === "expense" && /tax/gi.test(a.name || '')) || accounts.find(a => a.id === "tax");
            if (acc) {
              matchedAccountName = acc.name;
              matchedCategoryId = acc.id;
              confidenceScore = 0.90;
            }
          }
          else if (/(staples|amazon|walmart|target|office depot|paper|printer|hardware|bestbuy)/i.test(lowerDesc)) {
            const acc = accounts.find(a => a.type === "expense" && /office|supply|merchant/gi.test(a.name || '')) || accounts.find(a => a.id === "office");
            if (acc) {
              matchedAccountName = acc.name;
              matchedCategoryId = acc.id;
              confidenceScore = 0.75;
            }
          }
          else if (/(stripe|invoice|deposit|payment from|sales|customer|client|wire in)/i.test(lowerDesc)) {
            const acc = accounts.find(a => a.type === "revenue") || accounts.find(a => a.id === "revenue");
            if (acc) {
              matchedAccountName = acc.name;
              matchedCategoryId = acc.id;
              confidenceScore = 0.80;
            }
          }
        }

        // 3. Jaccard-style String Word Similarity Tokenizer Match
        if (confidenceScore < 0.6) {
          let bestMatch = null as LabelAccount | null; // set inside forEach (no narrowing to null)
          let highestSim = 0;
          accounts.forEach(acc => {
            const accNameWords = (acc.name || '').toLowerCase().split(/\s+/);
            const descWords = lowerDesc.split(/\s+/);
            let common = 0;
            accNameWords.forEach((w: string) => {
              if (w.length > 3 && descWords.includes(w)) common++;
            });
            if (common > highestSim) {
              highestSim = common;
              bestMatch = acc;
            }
          });

          if (bestMatch && highestSim > 0) {
            matchedAccountName = bestMatch.name;
            matchedCategoryId = bestMatch.id;
            confidenceScore = 0.60 + Math.min(0.20, highestSim * 0.05);
          }
        }

        const isExpense = amountCents < 0 || (amountCents > 0 && !/(revenue|income|sales)/i.test(matchedAccountName));

        return {
          id: typeof tx.id === "string" && tx.id ? tx.id : `lbl-${idx}-${Date.now()}`,
          date: rawDate,
          description: rawDesc,
          payee: payeeVal || "N/A",
          amountCents,
          detectedAccountName: matchedAccountName,
          detectedAccountId: matchedCategoryId,
          isExpense,
          confidenceScore: Number.parseFloat(confidenceScore.toFixed(2)),
          complianceStatus: confidenceScore >= 0.80 ? "VERIFIED" : "REVIEW_REQUIRED",
          matchedRuleId: ruleIdMatched
        };
      });

      res.json({
        status: "success",
        workspaceId: finalWorkspaceId,
        labeledTransactionsCount: labeledTransactions.length,
        labeledTransactions
      });
    } catch (error) {
      if ((error as { status?: number }).status === 403) return sendError(res, errorMessage(error), 403);
      sendError(res, "Labeling Engine Operation Failure", 500, errorMessage(error));
    }
  });

}
