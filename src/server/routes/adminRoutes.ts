import { writeServerAuditLog } from "../services/auditLogService";
import type { Transaction as LedgerTransaction } from "../../types";
import { globalAdminConfig, sendError, handleApiError, authenticate, requireAdmin, writeAuditLogStrict, getReportContext } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import express from "express";
import type { DocumentData } from "../db/firestore";
import { AdminUserUpdateSchema, AdminWorkspaceUpdateSchema, AdminGlobalConfigSchema } from "../../schemas";
import { TruthEngine } from "../../modules/integrity/TruthEngine";
import { getDb } from "../db/firestore";
import type { Transaction } from "../db/firestore";
import { authAdmin } from "../auth/supabaseAuth";
import { processAllRecurring } from "../services/recurringService";
import { processErrorDigest } from "../services/errorDigestService";
import { 
  executeIdempotent, 
  extractCanonicalOperationId, 
  deriveScopedOperationKey,
  requestPayloadHash,
} from "../utils/idempotency";
import { requireSystemJobOrAdmin } from "../auth/systemJobAuth";
import { registerGiveAccessRoutes } from "./giveAccessRoutes";

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A system job trigger called by an admin (not the cron secret) leaves an actor row (#826). */
async function auditManualTrigger(req: express.Request, action: string, details: string): Promise<void> {
  const user = (req as Partial<AuthenticatedRequest>).user;
  // #943: strict, and before the job runs: an admin's run that cannot be recorded does not run
  if (user?.uid) {
    await writeServerAuditLog({ workspaceId: 'system', uid: user.uid, email: user.email ?? '', action, entityType: 'system', entityId: 'system',
      details: { description: details, before: null, after: null } });
  }
}

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

        await writeAuditLogStrict(
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
      console.error("[Admin] List users failed:", err);
      sendError(res, "Could not load users.", 500);
    }
  });

  app.put(["/api/v1/admin/users/:userId", "/api/v1/admin/users/:userId/role"], authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      const { userId } = req.params as Record<string, string>;
      // #943 (Gitar): a person's id is a Supabase user id; any other segment (e.g. `globalConfig`, which
      // shares the admins collection) must never reach the users or admins rows
      if (!USER_ID.test(userId)) return sendError(res, 'Invalid user id', 400);
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

      // #943: the admins list follows the role in the same transaction as the profile and its audit row
      const syncAdmins = (t: Transaction, email: unknown) => {
        if (validated.role === undefined) return;
        const adminRef = db.collection("admins").doc(userId);
        if (validated.role === 'admin') {
          t.set(adminRef, { uid: userId, email: typeof email === 'string' ? email : '', isAdmin: true, updatedAt: new Date().toISOString() }, { merge: true });
        } else {
          t.delete(adminRef);
        }
      };

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
          syncAdmins(t, undefined);
          // the grant is logged in the same transaction: no audit row, no privilege change (#826)
          await writeAuditLogStrict(authReq.user.uid, authReq.user.email!, "ADMIN_USER_UPDATED", `Created user ${userId}`, 'system', {}, updateData, t);
          return { auditResult: { userId, ...updateData }, before: {}, roleChanged: true, newRole: validated.role };
        }
        
        const before = userSnap.data()!;
        const updateData = {
          ...validated,
          updatedAt: new Date().toISOString()
        };
        
        t.update(userRef, updateData);
        syncAdmins(t, before.email);

        const auditResult = { userId, ...before, ...updateData };

        // an audit failure rolls the change back rather than committing an unlogged privilege change (#826)
        await writeAuditLogStrict(authReq.user.uid, authReq.user.email!, "ADMIN_USER_UPDATED", `Updated user ${userId}`, 'system',
          before, { ...before, ...updateData }, t);

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
      if (validated.role) {
        try {
          await authAdmin.setCustomUserClaims(userId, { admin: validated.role === 'admin' });
        } catch (claimsErr) {
          console.error("[Admin User Update] Sign-in role not updated:", claimsErr);
          return sendError(res, 'The role was saved but the sign-in role was not updated; save it again.', 502);
        }
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
      // AUP-19: every row carries its document id (an id stored in the row itself still wins), so an older row
      // written without one is shown instead of making the whole viewer reject the response
      const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
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
  app.post("/api/v1/system/recurring/process", requireSystemJobOrAdmin, async (req: express.Request, res: express.Response) => {
    try {
      await auditManualTrigger(req, "SYSTEM_RECURRING_TRIGGERED", "Ran recurring processing by hand");
      const result = await processAllRecurring();
      res.json({ status: "success", data: result });
    } catch (err) {
      console.error("[System Cron] Recurring processing failed:", err);
      res.status(500).json({ status: "error", message: "Recurring processing failed." });
    }
  });

  // System Telemetry Error Digest Endpoint (Scheduled cron or admin manual trigger)
  app.post("/api/v1/system/telemetry/errors/digest", requireSystemJobOrAdmin, async (req: express.Request, res: express.Response) => {
    try {
      const hoursBack = req.body?.hoursBack ? Number(req.body.hoursBack) : 24;
      const recipientEmail = req.body?.recipientEmail ? String(req.body.recipientEmail) : undefined;
      const forceSendZero = Boolean(req.body?.forceSendZero);
      await auditManualTrigger(req, "SYSTEM_ERROR_DIGEST_TRIGGERED", "Ran the error digest by hand");

      const result = await processErrorDigest({ hoursBack, recipientEmail, forceSendZero });
      res.json({ status: "success", data: result });
    } catch (err) {
      console.error("[System Cron] Error digest job failed:", err);
      res.status(500).json({ status: "error", message: "Error digest failed." });
    }
  });

  app.get("/api/v1/admin/global-config", authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      res.json({
        status: "success",
        globalAdminConfig
      });
    } catch (err) {
      handleApiError(res, err);
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
        
        await writeAuditLogStrict(
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

  app.post("/api/v1/admin/integrity/orphan-scan", authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const workspaceId = (req.body.workspaceId as string) || (authReq.query?.workspaceId as string) || authReq.user?.developerWorkspaceId;
      if (!workspaceId) {
        return res.status(400).json({ status: "error", message: "Missing workspaceId" });
      }
      await writeServerAuditLog({ workspaceId, uid: authReq.user.uid, email: authReq.user.email ?? '', action: "ADMIN_ORPHAN_SCAN", entityType: 'system',
        entityId: workspaceId, details: { description: `Ran an orphan scan on ${workspaceId}`, before: null, after: null } });
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
