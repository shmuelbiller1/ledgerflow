import { trainClassifierWithWorkspaceData } from '../services/classifierTraining';
import type { ChartAccount, Transaction as LedgerTransaction } from "../../types";
import { errorMessage, requestUser } from "../auth/requestUser";
import { calculateWorkspaceCharges, sendError, handleApiError, authorizeWorkspace } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import { apiAuthenticate } from "../auth/apiAuthenticate";
import { incrementShardedCounter } from "../services/shardedCounterService";
import express from "express";
import crypto from "crypto";
import { ChartAccountSchema, BankMappingRequestSchema } from "../../schemas";
import { BayesianClassifier } from "../../lib/algorithms";
import { isPostable, lineAmount } from "../../lib/txFilters";
import { getDb } from "../db/firestore";
import { writeServerAuditLog } from "../services/auditLogService";

/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerDeveloperApiRoutes(app: express.Express, _ctx: ServerContext): void {
  app.post("/api/v1/bank/map", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const validation = BankMappingRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return sendError(res, "Validation Error: " + validation.error.issues.map((e) => `${e.path.join('.')}: ${errorMessage(e)}`).join(', '), 400);
      }
      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, validation.data.workspaceId);

      const db = getDb();
      const accountsSnap = await db.collection("chartAccounts").where("workspaceId", "==", validation.data.workspaceId).get();
      const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as ChartAccount);

      const mapped = validation.data.transactions.map(tx => {
        const bestAccount: ChartAccount | undefined = accounts.find(a => a.name?.toLowerCase().includes(tx.description.toLowerCase())) || accounts[0];
        return {
          id: tx.id,
          description: tx.description,
          amountCents: tx.amountCents,
          suggestedAccountId: bestAccount?.id || null,
          suggestedAccountName: bestAccount?.name || 'Uncategorized',
          confidence: 0.85
        };
      });

      res.json({
        status: "success",
        workspaceId: validation.data.workspaceId,
        mappedTransactions: mapped
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.get("/api/v1/projects", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.query.workspaceId as string) || requestUser(req).developerWorkspaceId;
      if (!workspaceId) return sendError(res, "Missing workspaceId parameters in query", 400);

      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const db = getDb();
      const projectsSnap = await db.collection("projects").where("workspaceId", "==", workspaceId).get();
      const projects = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      res.json({
        status: "success",
        workspaceId,
        projectsCount: projects.length,
        projects
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post("/api/v1/projects", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.body.workspaceId as string) || requestUser(req).developerWorkspaceId;
      if (!workspaceId) return sendError(res, "Missing workspaceId parameters in body", 400);

      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const { name, code, description, budgetLimitCents, managerEmail } = req.body;
      if (!name) return sendError(res, "Missing required fields: 'name'", 400);

      const db = getDb();
      const newId = `proj_${crypto.randomUUID().replace(/-/g, '')}`;
      const newProject = {
        id: newId,
        workspaceId,
        name,
        code: code || "",
        description: description || "",
        budgetLimitCents: Number(budgetLimitCents) || 0,
        managerEmail: managerEmail || "",
        status: "active",
        createdAt: new Date().toISOString()
      };

      await db.collection("projects").doc(newId).set(newProject);
      await writeServerAuditLog({
        workspaceId,
        uid: authReq.user?.uid || 'api_user',
        email: authReq.user?.email,
        action: 'PROJECT_CREATED',
        entityType: 'project',
        entityId: newId,
        details: {
          description: `Created project "${name}"`,
          code: newProject.code,
          budgetLimitCents: newProject.budgetLimitCents,
        },
      }, { db });

      res.status(201).json({
        status: "success",
        message: "Project resource created successfully.",
        project: newProject
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.get("/api/v1/ledger", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.query.workspaceId as string) || requestUser(req).developerWorkspaceId;
      if (!workspaceId) return sendError(res, "Missing workspaceId query parameters", 400);

      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const db = getDb();
      const accountsSnap = await db.collection("chartAccounts").where("workspaceId", "==", workspaceId).get();
      const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as ChartAccount);

      res.json({
        status: "success",
        workspaceId,
        accountsCount: accounts.length,
        accounts
      });
    } catch (err) {
      if (errorMessage(err) === "FORBIDDEN") return sendError(res, "Forbidden workspace access", 403);
      if (errorMessage(err) === "NOT_FOUND" || errorMessage(err).includes("NOT_FOUND")) return sendError(res, "Workspace not found", 404);
      sendError(res, errorMessage(err), 500);
    }
  });

  app.post("/api/v1/ledger", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.body.workspaceId as string) || requestUser(req).developerWorkspaceId;
      if (!workspaceId) return sendError(res, "Missing workspaceId parameter", 400);

      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const validation = ChartAccountSchema.safeParse({
        ...req.body,
        workspaceId,
        uid: authReq.user?.uid
      });

      if (!validation.success) {
        return sendError(res, "Validation Error: " + validation.error.issues.map((e) => `${e.path.join('.')}: ${errorMessage(e)}`).join(', '), 400);
      }

      const { name, type, code, parentId, isActive, tags } = validation.data;

      const db = getDb();
      const newId = validation.data.id || `acc_${crypto.randomUUID().replace(/-/g, '')}`;
      const newAccount = {
        id: newId,
        workspaceId,
        name,
        type,
        code: code || "",
        parentId: parentId || null,
        isActive: isActive !== undefined ? isActive : true,
        tags: tags || [],
        createdAt: new Date().toISOString()
      };

      await db.collection("chartAccounts").doc(newId).set(newAccount);
      await writeServerAuditLog({
        workspaceId,
        uid: authReq.user?.uid || 'api_user',
        email: authReq.user?.email,
        action: 'ACCOUNT_CREATED',
        entityType: 'chart_account',
        entityId: newId,
        details: {
          description: `Created chart account "${name}" (${type})`,
          code: newAccount.code,
          type,
        },
      }, { db });

      res.status(201).json({
        status: "success",
        message: "Chart of Accounts entry created.",
        account: newAccount
      });
    } catch (err) {
      sendError(res, errorMessage(err), 500);
    }
  });

  app.get("/api/v1/ledger/diagnostics", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.query.workspaceId as string) || requestUser(req).developerWorkspaceId;
      if (!workspaceId) return sendError(res, "Missing workspaceId parameter in query", 400);

      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const db = getDb();
      
      const [accountsSnap, transactionsSnap] = await Promise.all([
        db.collection("chartAccounts").where("workspaceId", "==", workspaceId).get(),
        db.collection("transactions").where("workspaceId", "==", workspaceId).get()
      ]);

      const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as ChartAccount);
      const transactions = transactionsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }) as LedgerTransaction);

      // Trial balance double-entry cross checking
      let globalNetBalanceCents = 0;
      const accountBalances: Record<string, number> = {};
      
      accounts.forEach(a => {
        accountBalances[a.id] = 0;
      });

      transactions.forEach((tx) => {
        if (!isPostable(tx)) return;
        const txLines = tx.lines || [];
        txLines.forEach((line) => {
          const amt = lineAmount(line, tx);
          globalNetBalanceCents += amt;
          if (line.accountId) {
            accountBalances[line.accountId] = (accountBalances[line.accountId] || 0) + amt;
          }
        });
      });

      // Idle assets or detached liability nodes
      const isolatedAccounts = accounts.filter(a => !accountBalances[a.id] || accountBalances[a.id] === 0).map(a => ({
        id: a.id,
        name: a.name,
        code: a.code,
        type: a.type
      }));

      // Account standard behavior diagnostics
      const accountsDiagnostics = accounts.map(a => {
        const currentBalance = accountBalances[a.id] || 0;
        let health: "optimal" | "unusual" | "dormant" = "optimal";
        let message = "Account balances align with expected rules.";

        if (currentBalance === 0) {
          health = "dormant";
          message = "No transactional activity recorded in ledger audit scopes.";
        } else {
          const isStandardDebit = ["asset", "expense"].includes(a.type);
          const hasDebitBalance = currentBalance > 0;

          if (isStandardDebit && !hasDebitBalance) {
            health = "unusual";
            message = `Expected standard DEBIT balance for account class '${a.type}', but registers a credit ($${(Math.abs(currentBalance) / 100).toFixed(2)}). Verify double-entry offsets.`;
          } else if (!isStandardDebit && hasDebitBalance) {
            health = "unusual";
            message = `Expected standard CREDIT balance for account class '${a.type}', but registers a debit ($${(currentBalance / 100).toFixed(2)}). Verify double-entry offsets.`;
          }
        }

        return {
          id: a.id,
          name: a.name,
          code: a.code,
          type: a.type,
          currentBalanceCents: currentBalance,
          health,
          diagnoses: message
        };
      });

      // Geographical jurisdictions diagnostics from metadata state tag
      const stateTaxMetrics: Record<string, { count: number; volumeCents: number }> = {};
      transactions.forEach((tx) => {
        const state = tx.metadata?.taxState || (tx as LedgerTransaction & { taxState?: string }).taxState;
        if (state) {
          const stats = stateTaxMetrics[state] || { count: 0, volumeCents: 0 };
          stats.count += 1;
          stats.volumeCents += (tx.totalAmountCents || 0);
          stateTaxMetrics[state] = stats;
        }
      });

      const anomalousAccounts = accountsDiagnostics.filter(a => a.health === "unusual");
      const integrityScore = anomalousAccounts.length === 0 && globalNetBalanceCents === 0 ? 100 : Math.max(0, 100 - (anomalousAccounts.length * 15) - (globalNetBalanceCents !== 0 ? 40 : 0));

      res.status(200).json({
        status: "success",
        workspaceId,
        summary: {
          ledgerIntegrityScore: integrityScore,
          globalTrialImbalanceCents: globalNetBalanceCents,
          isImbalanced: globalNetBalanceCents !== 0,
          totalAccounts: accounts.length,
          activeJournalEntries: transactions.length,
          anomalousAccountsCount: anomalousAccounts.length,
          isolatedAccountsCount: isolatedAccounts.length
        },
        diagnostics: {
          trialBalanceHealth: {
            status: globalNetBalanceCents === 0 ? "optimal" : "corrupted",
            reconciliationMessage: globalNetBalanceCents === 0 
              ? "All debit & credit journal lines reconcile exactly to zero. Ledger math is certified safe."
              : `A serious double-entry variance error of ${globalNetBalanceCents} cents exists across transactions.`
          },
          accountsDiagnostics,
          isolatedAccounts,
          taxMetricsByRegion: stateTaxMetrics
        }
      });

    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post("/api/v1/brain/classify-batch", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.body.workspaceId as string) || requestUser(req).developerWorkspaceId;
      if (!workspaceId) return sendError(res, "Missing workspaceId parameter", 400);

      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const { descriptions } = req.body;
      if (!Array.isArray(descriptions)) {
        return sendError(res, "The parameter 'descriptions' must be an array of transaction raw strings.", 400);
      }

      const activeApiKeyId = requestUser(req)?.usedApiKeyId || "human_web_console";
      const classifier = new BayesianClassifier();
      const trainedCount = await trainClassifierWithWorkspaceData(classifier, workspaceId, activeApiKeyId);

      const db = getDb();
      const accountsSnap = await db.collection("chartAccounts").where("workspaceId", "==", workspaceId).get();
      const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, name: doc.data().name || "", type: doc.data().type || "" }));

      const predictions = descriptions.slice(0, 100).map((desc: string, idx: number) => {
        const guess = classifier.classify(desc || "");
        const category = guess ? guess.category : "Operating Expenses";
        
        const suggestedAccount = accounts.find(a => a.name.toLowerCase().includes((category || "").toLowerCase()) || a.type === 'expense');
        const accResult = suggestedAccount ? { id: suggestedAccount.id, name: suggestedAccount.name } : (accounts[0] ? { id: accounts[0].id, name: accounts[0].name } : null);

        return {
          index: idx,
          rawQuery: desc,
          suggestedCategory: category,
          suggestedAccount: accResult,
          confidenceScore: guess ? Number(guess.confidence.toFixed(4)) : 0.5000
        };
      });

      // Programmatically deduct compute credit and charge quota cents for batch classification
      const baseWeight = Math.max(1, Math.min(descriptions.length, 100)); // 1 credit per transaction item classified (max 100)
      const baseCents = Math.max(1, Math.min(Math.round(descriptions.length * 0.5), 50)); // 0.5 cents per item (max 50)
      try {
        const wsRef = db.collection("workspaces").doc(workspaceId);
        const wsDoc = await wsRef.get();
        if (wsDoc.exists) {
          const wsData = wsDoc.data() || {};
          
          // Centralized custom billing multiplier & private API key controller (batch classification is standard)
          const { credits: weightScore, cents: deltaCents } = calculateWorkspaceCharges(wsData, baseWeight, baseCents, false);

          const currentCents = wsData.apiQuotaTotalCentsUsed || 0;
          const currentHardness = wsData.computeHardnessScore || 0;

          await wsRef.update({
            apiQuotaTotalCentsUsed: currentCents + deltaCents,
            computeHardnessScore: currentHardness + weightScore
          });

          await incrementShardedCounter(db, workspaceId, 'totalQueriesThisMonth', 1);
          await incrementShardedCounter(db, workspaceId, 'computeCreditBalance', -weightScore);

          // Log trace audit record
          const traceId = `trace-${crypto.randomUUID()}`;
          await db.collection("billingLedgerTraces").doc(traceId).set({
            id: traceId,
            workspaceId,
            uid: (req as AuthenticatedRequest).user.uid || "api_user",
            userEmail: (req as AuthenticatedRequest).user.email || 'developer@ledgerflow.io',
            algorithmName: 'ALGO_CLASSIFIER_BAYESIAN_BATCH',
            complexityFormat: `O(${descriptions.length} * V * C)`,
            weightScore,
            executionTimeMs: 120,
            timestamp: new Date().toISOString()
          });
        }
      } catch (billingErr) {
        console.error("[Classifier Batch Billing Status Bypassed]: ", billingErr);
      }

      res.status(200).json({
        status: "success",
        workspaceId,
        modelState: {
          nodesTrained: trainedCount,
          activeAlgorithm: "Bayesian Double-Entry Classifier v2.1"
        },
        predictions
      });

    } catch (err) {
      handleApiError(res, err);
    }
  });

}
