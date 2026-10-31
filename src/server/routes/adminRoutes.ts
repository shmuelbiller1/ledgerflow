import type { Transaction as LedgerTransaction } from "../../types";
import { errorMessage } from "../auth/requestUser";
import { globalAdminConfig, sendError, handleApiError, authenticate, requireAdmin, writeAuditLog, getReportContext } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import express from "express";
import type { DocumentData } from "../db/firestore";
import { AdminUserUpdateSchema, AdminWorkspaceUpdateSchema, AdminGlobalConfigSchema } from "../../schemas";
import { TruthEngine } from "../../modules/integrity/TruthEngine";
import { getDb } from "../db/firestore";
import type { Transaction } from "../db/firestore";
import { verifyIdToken, authAdmin } from "../auth/supabaseAuth";
import type { DecodedIdToken } from "../auth/supabaseAuth";
import { processAllRecurring } from "../services/recurringService";
import { processErrorDigest } from "../services/errorDigestService";
import { 
  executeIdempotent, 
  extractCanonicalOperationId, 
  deriveScopedOperationKey,
  requestPayloadHash,
} from "../utils/idempotency";
import { isSystemJobAuthorized } from "../auth/systemJobAuth";
import { registerGiveAccessRoutes } from "./giveAccessRoutes";

/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerAdminRoutes(app: express.Express, ctx: ServerContext): void {
  const { apiLogs } = ctx;
  registerGiveAccessRoutes(app); // ACC-1
  app.get("/api/v1/admin/telemetry", authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      const db = getDb();
      
      const workspacesSnap = await db.collection("workspaces").limit(100).get();
      const wsIds = workspacesSnap.docs.map(d => d.id).slice(0, 30);
      let transactionsSnap: { docs: Array<{ id: string; data: () => DocumentData }> } = { docs: [] };
      if (wsIds.length > 0) {
          transactionsSnap = await db.collection("transactions").where("workspaceId", "in", wsIds).get();
      }

      // Fetch all shards for these workspaces
      const shardsSnap = wsIds.length > 0 
        ? await db.collection("workspaceShards").where("workspaceId", "in", wsIds).get()
        : { docs: [] };

      const shardSums: Record<string, { totalQueriesThisMonth: number; computeCreditBalance: number }> = {};
      wsIds.forEach(id => {
        shardSums[id] = { totalQueriesThisMonth: 0, computeCreditBalance: 0 };
      });
      shardsSnap.docs.forEach((doc) => {
        const sData = doc.data() || {};
        const wsId = sData.workspaceId;
        const metric = sData.metric;
        const val = sData.value || 0;
        if (wsId && shardSums[wsId]) {
          if (metric === 'totalQueriesThisMonth') {
            shardSums[wsId].totalQueriesThisMonth += val;
          } else if (metric === 'computeCreditBalance') {
            shardSums[wsId].computeCreditBalance += val;
          }
        }
      });
      
      const transactions = transactionsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }) as LedgerTransaction);
      
      const tenants: Record<string, { 
        id: string, 
        name: string,
        plan: string,
        concurrentUserLimit: number,
        activeUserCount: number,
        seatCount: number,
        maxSeats: number,
        computeCreditBalance: number,
        apiQuotaTotalCentsUsed: number,
        apiQuotaMonthlyLimitCents: number,
        creditCostMultiplier: number,
        quotaCentsMultiplier: number,
        bypassBilling: boolean,
        customKeyCreditCharge: number,
        customKeyCentsCharge: number,
        txCount: number, 
        requestCount: number, 
        errorCount: number 
      }> = {};
      
      workspacesSnap.docs.forEach(doc => {
         const data = doc.data() || {};
         const baseCredit = data.computeCreditBalance !== undefined ? data.computeCreditBalance : 100000;
         tenants[doc.id] = { 
            id: doc.id, 
            name: data.name || "Default Workspace",
            plan: data.plan || "sandbox",
            concurrentUserLimit: data.concurrentUserLimit || 50,
            activeUserCount: data.activeUserCount || 1,
            seatCount: data.seatCount || 1,
            maxSeats: data.maxSeats || 3,
            computeCreditBalance: baseCredit + (shardSums[doc.id]?.computeCreditBalance || 0),
            apiQuotaTotalCentsUsed: data.apiQuotaTotalCentsUsed || 0,
            apiQuotaMonthlyLimitCents: data.apiQuotaMonthlyLimitCents || 0,
            creditCostMultiplier: data.creditCostMultiplier !== undefined ? Number(data.creditCostMultiplier) : 1.0,
            quotaCentsMultiplier: data.quotaCentsMultiplier !== undefined ? Number(data.quotaCentsMultiplier) : 1.0,
            bypassBilling: data.bypassBilling !== undefined ? data.bypassBilling === true : false,
            customKeyCreditCharge: data.customKeyCreditCharge !== undefined ? Number(data.customKeyCreditCharge) : 10,
            customKeyCentsCharge: data.customKeyCentsCharge !== undefined ? Number(data.customKeyCentsCharge) : 0,
            txCount: 0, 
            requestCount: 0, 
            errorCount: 0 
         };
      });
      
      transactions.forEach(tx => {
         if (tenants[tx.workspaceId]) {
            tenants[tx.workspaceId].txCount++;
         }
      });
      
      apiLogs.forEach(log => {
         // rough attribution by path or apiKey
         const assignedWs = Object.keys(tenants).find(ws => log.path.includes(ws) || log.apiKeyUsed.includes(ws.substring(0, 5)));
         if (assignedWs) {
             tenants[assignedWs].requestCount++;
             if (log.statusCode >= 500) tenants[assignedWs].errorCount++;
         }
      });

      res.json({
        status: "success",
        tenants: Object.values(tenants),
        liveLogs: apiLogs
      });
    } catch (err) {
      console.error("[Admin Telemetry] Failed to fetch telemetry data:", err);
      sendError(res, "Failed to retrieve telemetry data", 500);
    }
  });

  app.put("/api/v1/admin/workspaces/:workspaceId", authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      const { workspaceId } = req.params as Record<string, string>;
      const validated = AdminWorkspaceUpdateSchema.parse(req.body);
      const authReq = req as AuthenticatedRequest;
      const db = getDb();
      const rawOpId = extractCanonicalOperationId(req);
      const scopedKey = rawOpId 
        ? deriveScopedOperationKey(workspaceId, 'ADMIN_WORKSPACE_UPDATED', rawOpId)
        : undefined;

      const performMutation = async (t: Transaction) => {
        const wsRef = db.collection("workspaces").doc(workspaceId);
        const wsSnap = await t.get(wsRef);
        if (!wsSnap.exists) throw new Error("Workspace not found");
        
        const before = wsSnap.data()!;
        const updateData = {
          ...validated,
          updatedAt: new Date().toISOString()
        };
        
        t.update(wsRef, updateData);
        
        const auditResult = { ...before, ...updateData };

        await writeAuditLog(
          authReq.user.uid, 
          authReq.user.email!, 
          "ADMIN_WORKSPACE_UPDATED", 
          `Updated workspace ${workspaceId}`, 
          workspaceId,
          before,
          auditResult,
          t
        );

        return auditResult;
      };

      let result;
      if (scopedKey) {
        result = await executeIdempotent(scopedKey, {
          actor: authReq.user.uid,
          workspaceId,
          operationType: 'ADMIN_WORKSPACE_UPDATED',
          payloadHash: requestPayloadHash({ workspaceId, validated })
        }, performMutation);
      } else {
        result = await db.runTransaction(performMutation);
      }

      res.json({ status: "success", data: result });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // --- Global Default Pricing and Billing Overrides ---
  app.get("/api/v1/admin/users", authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      const db = getDb();
      const usersSnap = await db.collection("users").limit(100).get();
      const users = usersSnap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
      
      res.json({
        status: "success",
        users
      });
    } catch (err) {
      sendError(res, errorMessage(err), 500);
    }
  });

  app.put(["/api/v1/admin/users/:userId", "/api/v1/admin/users/:userId/role"], authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      const { userId } = req.params as Record<string, string>;
      const { role } = req.body;
      const ALLOWED_ROLES = ['client', 'admin'];
      if (role !== undefined && !ALLOWED_ROLES.includes(role)) {
        return sendError(res, 'Invalid role', 400);
      }

      const validated = AdminUserUpdateSchema.parse(req.body);
      const authReq = req as AuthenticatedRequest;
      const db = getDb();
      const rawOpId = extractCanonicalOperationId(req);
      const scopedKey = rawOpId 
        ? deriveScopedOperationKey('system', 'ADMIN_USER_UPDATED', `${userId}:${rawOpId}`)
        : undefined;

      const performMutation = async (t: Transaction) => {
        const userRef = db.collection("users").doc(userId);
        const userSnap = await t.get(userRef);
        if (!userSnap.exists) {
          // If user document doesn't exist yet, create or initialize it
          const updateData = {
            ...validated,
            role: validated.role || 'client',
            updatedAt: new Date().toISOString()
          };
          t.set(userRef, updateData, { merge: true });
          return { auditResult: { userId, ...updateData }, before: {}, roleChanged: true, newRole: validated.role };
        }
        
        const before = userSnap.data()!;
        const updateData = {
          ...validated,
          updatedAt: new Date().toISOString()
        };
        
        t.update(userRef, updateData);

        const auditResult = { userId, ...before, ...updateData };

        try {
          await writeAuditLog(
            authReq.user.uid, 
            authReq.user.email!, 
            "ADMIN_USER_UPDATED", 
            `Updated user ${userId}`, 
            'system',
            before,
            { ...before, ...updateData },
            t
          );
        } catch (auditErr) {
          console.warn("[Admin User Update] Audit write bypassed:", auditErr);
        }

        return { auditResult, before, roleChanged: validated.role && validated.role !== before.role, newRole: validated.role };
      };

      let mutationOutput;
      if (scopedKey) {
        mutationOutput = await executeIdempotent(scopedKey, {
          actor: authReq.user.uid,
          workspaceId: 'system',
          operationType: 'ADMIN_USER_UPDATED',
          payloadHash: requestPayloadHash({ userId, validated })
        }, performMutation);
      } else {
        mutationOutput = await db.runTransaction(performMutation);
      }

      // Update custom claims
      try {
        if (validated.role) {
          await authAdmin.setCustomUserClaims(userId, {
            admin: validated.role === 'admin'
          });
        }
      } catch (claimsErr) {
        console.warn("[Admin User Update] Custom claims update note:", claimsErr);
      }

      res.json({ status: "success", data: mutationOutput?.auditResult || { userId, role: validated.role } });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.get("/api/v1/admin/audit-logs", authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      const db = getDb();
      const { userId, workspaceId, action, startDate, endDate, limit = 50 } = req.query;
      
      let query = db.collection("auditLogs").orderBy("timestamp", "desc");
      
      if (userId) query = query.where("userId", "==", userId);
      if (workspaceId) query = query.where("workspaceId", "==", workspaceId);
      if (action) query = query.where("action", "==", action);
      if (startDate) query = query.where("timestamp", ">=", startDate);
      if (endDate) query = query.where("timestamp", "<=", endDate);
      
      const snap = await query.limit(Number(limit)).get();
      const logs = snap.docs.map(doc => doc.data());
      
      res.json({ status: "success", logs });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.get("/api/v1/admin/error-logs", authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      const db = getDb();
      const { workspaceId, severity, limit = 50 } = req.query;
      
      let query = db.collection("errorLogs").orderBy("createdAt", "desc");
      if (workspaceId) query = query.where("workspaceId", "==", workspaceId);
      if (severity) query = query.where("severity", "==", severity);
      
      const snap = await query.limit(Number(limit)).get();
      const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json({ status: "success", logs });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Scheduled Recurring Processing Endpoint (Authenticated via Admin or System Secret)
  app.post("/api/v1/system/recurring/process", async (req: express.Request, res: express.Response) => {
    try {
      const cronSecret = process.env.CRON_SECRET;
      const providedSecret = req.headers["x-cron-secret"] as string;
      const authHeader = req.headers.authorization;

      let decodedToken: DecodedIdToken | null = null;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.split("Bearer ")[1];
        try {
          decodedToken = await verifyIdToken(token);
        } catch {
          decodedToken = null;
        }
      }

      if (!isSystemJobAuthorized(decodedToken, providedSecret, cronSecret)) {
        return res.status(403).json({ 
          status: "error", 
          message: "Forbidden: Requires admin authorization or valid cron secret." 
        });
      }

      const result = await processAllRecurring();
      res.json({ status: "success", data: result });
    } catch (err) {
      console.error("[System Cron] Recurring processing failed:", err);
      res.status(500).json({ status: "error", message: errorMessage(err) });
    }
  });

  // System Telemetry Error Digest Endpoint (Scheduled cron or admin manual trigger)
  app.post("/api/v1/system/telemetry/errors/digest", async (req: express.Request, res: express.Response) => {
    try {
      const cronSecret = process.env.CRON_SECRET;
      const providedSecret = req.headers["x-cron-secret"] as string;
      const authHeader = req.headers.authorization;

      let decodedToken: DecodedIdToken | null = null;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.split("Bearer ")[1];
        try {
          decodedToken = await verifyIdToken(token);
        } catch {
          decodedToken = null;
        }
      }

      if (!isSystemJobAuthorized(decodedToken, providedSecret, cronSecret)) {
        return res.status(403).json({ 
          status: "error", 
          message: "Forbidden: Requires admin authorization or valid cron secret." 
        });
      }

      const hoursBack = req.body?.hoursBack ? Number(req.body.hoursBack) : 24;
      const recipientEmail = req.body?.recipientEmail ? String(req.body.recipientEmail) : undefined;
      const forceSendZero = Boolean(req.body?.forceSendZero);

      const result = await processErrorDigest({ hoursBack, recipientEmail, forceSendZero });
      res.json({ status: "success", data: result });
    } catch (err) {
      console.error("[System Cron] Error digest job failed:", err);
      res.status(500).json({ status: "error", message: errorMessage(err) });
    }
  });

  app.get("/api/v1/admin/global-config", authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      res.json({
        status: "success",
        globalAdminConfig
      });
    } catch (err) {
      res.status(500).json({ status: "error", message: errorMessage(err) });
    }
  });

  app.put("/api/v1/admin/global-config", authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      const validated = AdminGlobalConfigSchema.parse(req.body);
      const authReq = req as AuthenticatedRequest;
      const db = getDb();
      const rawOpId = extractCanonicalOperationId(req);
      const scopedKey = rawOpId 
        ? deriveScopedOperationKey('system', 'ADMIN_GLOBAL_CONFIG_UPDATED', rawOpId)
        : undefined;

      const performMutation = async (t: Transaction) => {
        const configRef = db.collection("admins").doc("globalConfig");
        const configSnap = await t.get(configRef);
        
        const before = configSnap.exists ? configSnap.data() : globalAdminConfig;
        const newConfig = {
          ...validated,
          updatedAt: new Date().toISOString()
        };
        
        t.set(configRef, newConfig, { merge: true });
        
        await writeAuditLog(
          authReq.user.uid, 
          authReq.user.email!, 
          "ADMIN_GLOBAL_CONFIG_UPDATED", 
          `Updated global admin config`, 
          'system',
          before,
          newConfig,
          t
        );

        return newConfig;
      };

      let result;
      if (scopedKey) {
        result = await executeIdempotent(scopedKey, {
          actor: authReq.user.uid,
          workspaceId: 'system',
          operationType: 'ADMIN_GLOBAL_CONFIG_UPDATED',
          payloadHash: requestPayloadHash({ validated })
        }, performMutation);
      } else {
        result = await db.runTransaction(performMutation);
      }

      Object.assign(globalAdminConfig, result);
      res.json({ status: "success", data: result });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post("/api/v1/admin/integrity/orphan-scan", authenticate, async (req: express.Request, res: express.Response) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const workspaceId = (req.body.workspaceId as string) || (authReq.query?.workspaceId as string) || authReq.user?.developerWorkspaceId;
      if (!workspaceId) {
        return res.status(400).json({ status: "error", message: "Missing workspaceId" });
      }
      const { accounts, transactions } = await getReportContext(authReq, workspaceId);
      const scanResult = TruthEngine.scanOrphanedAccountReferences(accounts, transactions);
      res.json({
        status: "success",
        workspaceId,
        scannedAt: new Date().toISOString(),
        ...scanResult
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });
}
