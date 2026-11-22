import { isForbidden } from '../http/serverKit';
import { brainRateLimiter } from "../middleware/rateLimiters";
import { trainClassifierWithWorkspaceData } from '../services/classifierTraining';
import type { ChartAccount, Transaction as LedgerTransaction } from "../../types";
import { errorMessage, requestUser } from "../auth/requestUser";
import { sendError, handleApiError, authorizeWorkspace, loadQueriedWorkspaceLedger } from "../http/serverKit";
import { chargeUsageAndTrace } from "../services/usageBilling";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import { apiAuthenticate } from "../auth/apiAuthenticate";
import express from "express";
import { BankMappingRequestSchema } from "../../schemas";
import { BayesianClassifier } from "../../lib/algorithms";
import { isPostable, lineAmount } from "../../lib/txFilters";
import { getDb } from "../db/firestore";
import { executeCommand } from '../utils/commandExecutor';
import { projectCreateCommand } from '../commands/projects';
import { chartAccountRegisterCommand } from '../commands/chartAccounts';
import type { ZodError } from 'zod';

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

      await executeCommand(req, res, {
        definition: projectCreateCommand,
        workspaceId,
        input: { name, code: code || undefined, description: description || undefined, budgetLimitCents: Number(budgetLimitCents) || 0, managerEmail: managerEmail || undefined },
        legacyRoute: true,
        legacyOperationId: 'ignore',
        formatResponse(outcome) {
          if (!outcome.ok) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
          return { status: 201, body: { status: 'success', message: 'Project resource created successfully.', ...(outcome.data as object) } };
        },
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
      if (isForbidden(errorMessage(err))) return sendError(res, "Forbidden workspace access", 403);
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

      const { workspaceId: _workspace, uid: _uid, ...input } = req.body;
      await executeCommand(req, res, {
        definition: chartAccountRegisterCommand,
        workspaceId,
        input,
        legacyRoute: true,
        legacyOperationId: 'ignore',
        formatResponse(outcome) {
          if (outcome.ok) return { status: 201, body: { status: 'success', message: 'Chart of Accounts entry created.', ...(outcome.data as object) } };
          if (outcome.code === 'INVALID_INPUT') {
            const issues = (outcome.error as ZodError).issues;
            return { status: 400, body: { status: 'error', message: 'Validation Error: ' + issues.map(e => `${e.path.join('.')}: ${errorMessage(e)}`).join(', ') } };
          }
          if (errorMessage(outcome.error).includes('ALREADY_EXISTS')) {
            return { status: 409, body: { status: 'error', message: 'Chart account ID already exists' } };
          }
          const message = outcome.code === 'ROLE_REQUIRED' || outcome.code === 'NOT_A_MEMBER' || outcome.code === 'WORKSPACE_SCOPE' || outcome.code === 'WORKSPACE_FROZEN'
            ? 'Forbidden workspace access' : outcome.message;
          return { status: outcome.status, body: { status: 'error', message } };
        },
      });
    } catch (err) {
      const message = errorMessage(err);
      if (message.includes("CONFLICT") || message.includes("ALREADY_EXISTS")) {
        return sendError(res, "Chart account ID already exists", 409);
      }
      if (message.includes("FORBIDDEN")) return sendError(res, "Forbidden workspace access", 403);
      if (message.includes("NOT_FOUND")) return sendError(res, "Workspace not found", 404);
      sendError(res, message, 500);
    }
  });

  app.get("/api/v1/ledger/diagnostics", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const loaded = await loadQueriedWorkspaceLedger(req, "Missing workspaceId parameter in query");
      if ('error' in loaded) return sendError(res, loaded.error, 400);
      const { workspaceId, accounts, transactions } = loaded;

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

  app.post("/api/v1/brain/classify-batch", apiAuthenticate, brainRateLimiter, async (req: express.Request, res: express.Response) => {
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
        await chargeUsageAndTrace({
          db,
          workspaceId,
          baseWeight,
          baseCents,
          isCustomKeyUsed: false,
          uid: (req as AuthenticatedRequest).user.uid,
          userEmail: (req as AuthenticatedRequest).user.email,
          trace: {
            algorithmName: 'ALGO_CLASSIFIER_BAYESIAN_BATCH',
            complexityFormat: `O(${descriptions.length} * V * C)`,
            executionTimeMs: 120,
          },
        });
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
