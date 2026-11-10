import { errorMessage } from "../auth/requestUser";
import { formatTzDate, sendError, handleApiError, authorizeWorkspace } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import { apiAuthenticate } from "../auth/apiAuthenticate";
import { countWorkspaceOwners, requireWorkspaceRole } from "./workspaceRoutes";
import { writeServerAuditLog } from "../services/auditLogService";
import { requirePlanCapacity } from "../middleware/planCapacity";
import express from "express";
import crypto from "crypto";
import { WorkspaceSchema } from "../../schemas";
import { getDb } from "../db/firestore";
import type { DocumentData } from "../db/firestore";
import { exportWorkspaceBackup, restoreWorkspaceBackup, RestoreError } from "../services/workspaceRestoreService";
import { authAdmin } from "../auth/supabaseAuth";
import { NEW_WORKSPACE_MODULES } from '../../lib/modules';
import { BRAND } from '../../config/brand';

/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerWorkspaceApiRoutes(app: express.Express, _ctx: ServerContext): void {
  app.get("/api/v1/workspaces", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const uid = (req as AuthenticatedRequest).user.uid;
      const db = getDb();
      let ownedWorkspaces: Array<Record<string, unknown>> = [];
      
      try {
        const ownedWSQuery = await db.collection("workspaces").where("uid", "==", uid).get();
        ownedWorkspaces = ownedWSQuery.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name || "Unnamed Workspace",
          currency: doc.data().currency || "USD",
          businessType: doc.data().businessType || "general",
          lockDate: doc.data().lockDate || null,
          createdAt: doc.data().createdAt || null,
          role: "owner"
        }));
      } catch (dbErr) {
        console.warn("[Firebase Admin] /api/v1/workspaces database check failed:", errorMessage(dbErr));
        ownedWorkspaces = [];
      }

      res.status(200).json({
        status: "success",
        workspacesCount: ownedWorkspaces.length,
        workspaces: ownedWorkspaces
      });
    } catch (err) {
      sendError(res, errorMessage(err), 500);
    }
  });

  app.post("/api/v1/workspaces", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const uid = (req as AuthenticatedRequest).user.uid;
      const validation = WorkspaceSchema.safeParse({
        ...req.body,
        uid
      });
      if (!validation.success) {
        return sendError(res, "Validation Error: " + validation.error.issues.map((e) => `${e.path.join('.')}: ${errorMessage(e)}`).join(', '), 400);
      }
      const db = getDb();
      const newId = validation.data.id || `ws_${crypto.randomUUID().replace(/-/g, '')}`;
      const newWorkspace = {
        // BB-07: a new workspace starts with the everyday screens; the rest is turned on when wanted
        modules: NEW_WORKSPACE_MODULES,
        ...validation.data,
        id: newId,
        uid,
        createdAt: validation.data.createdAt || new Date().toISOString()
      };
      await db.collection("workspaces").doc(newId).set(newWorkspace);
      res.status(201).json({
        status: "success",
        message: "Workspace created successfully.",
        workspace: newWorkspace
      });
    } catch (err) {
      sendError(res, errorMessage(err), 500);
    }
  });

  // --- Workspace Member Management Endpoints ---
  app.get("/api/v1/workspaces/:workspaceId/members", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const { workspaceId } = req.params as Record<string, string>;
      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const db = getDb();
      const wsDoc = await db.collection("workspaces").doc(workspaceId).get();
      if (!wsDoc.exists) {
        return sendError(res, "Workspace not found", 404);
      }
      const data = wsDoc.data() || {};
      const members: string[] = Array.isArray(data.members) ? data.members : [];
      const ownerUid = data.uid;

      res.json({
        status: "success",
        workspaceId,
        ownerUid,
        members,
        total: members.length + 1
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // --- Workspace Full Complete Export Endpoint (Server-Side Streaming & Authoritative Checksum) ---
  const handleWorkspaceExport = async (req: express.Request, res: express.Response) => {
    try {
      const { workspaceId } = req.params as Record<string, string>;
      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const db = getDb();
      const wsDoc = await db.collection("workspaces").doc(workspaceId).get();
      const wsData = wsDoc.exists ? wsDoc.data() : { id: workspaceId };

      // Helper to stream all documents of a collection scoped to this workspace
      const streamCollection = async (collectionName: string): Promise<Array<DocumentData & { id: string }>> => {
        try {
          const query = db.collection(collectionName).where("workspaceId", "==", workspaceId);
          const items: Array<DocumentData & { id: string }> = [];
          return await new Promise<Array<DocumentData & { id: string }>>((resolve, reject) => {
            const stream = query.stream();
            stream.on("data", (doc: { id: string; data: () => DocumentData }) => {
              items.push({ id: doc.id, ...doc.data() });
            });
            stream.on("end", () => resolve(items));
            stream.on("error", async (err: unknown) => {
              try {
                const snap = await query.get();
                resolve(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
              } catch {
                reject(err);
              }
            });
          });
        } catch {
          return [];
        }
      };

      const format = (req.query.format as string)?.toLowerCase();
      const [transactions, accounts] = format === "csv"
        ? await Promise.all([streamCollection("transactions"), streamCollection("chartAccounts")])
        : [[], []];

      const todayIso = formatTzDate(new Date(), wsData?.settings?.timezone || wsData?.timezone);

      if (format === "csv") {
        let csvContent = "Date,Amount,Description,Category,Type,Status,Reference\n";
        const accountsMap = new Map(accounts.map((a) => [a.id, a.name || a.code || a.id]));
        transactions.forEach((t) => {
          const categoryName = t.lines && t.lines.length > 0 ? (accountsMap.get(t.lines[0].accountId) || t.lines[0].accountName || 'Uncategorized') : 'Uncategorized';
          const amountStr = ((t.totalAmountCents || 0) / 100).toFixed(2);
          const row = [
            t.date || '',
            amountStr,
            `"${(t.description || '').replace(/"/g, '""')}"`,
            `"${String(categoryName).replace(/"/g, '""')}"`,
            t.type || 'actual',
            t.status || 'posted',
            `"${(t.reference || '').replace(/"/g, '""')}"`
          ];
          csvContent += row.join(",") + "\n";
        });
        res.setHeader("Content-Disposition", `attachment; filename="${BRAND.fileSlug}-transactions-${workspaceId}-${todayIso}.csv"`);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        return res.send(csvContent);
      }

      // JSON backup: every collection the restore brings back (workspaceRestoreService.ts, L-07)
      const payload = await exportWorkspaceBackup(db, workspaceId, authReq.user?.uid || 'user');

      res.setHeader("Content-Disposition", `attachment; filename="${BRAND.fileSlug}-backup-${workspaceId}-${todayIso}.json"`);
      res.setHeader("Content-Type", "application/json");
      return res.send(JSON.stringify(payload, null, 2));
    } catch (err) {
      handleApiError(res, err);
    }
  };

  app.get("/api/v1/workspaces/:workspaceId/export", apiAuthenticate, handleWorkspaceExport);
  app.get("/api/workspaces/:workspaceId/export", apiAuthenticate, handleWorkspaceExport);

  // Owner only: a restore replaces every record in the workspace (all or nothing).
  app.post("/api/v1/workspaces/:workspaceId/restore", apiAuthenticate, requireWorkspaceRole(['owner']), async (req: express.Request, res: express.Response) => {
    try {
      const { workspaceId } = req.params as Record<string, string>;
      await authorizeWorkspace(req as AuthenticatedRequest, workspaceId);
      const result = await restoreWorkspaceBackup(getDb(), workspaceId, req.body);
      return res.json({ success: true, message: "General ledger workspace successfully restored from backup.", ...result });
    } catch (err) {
      if (err instanceof RestoreError) return sendError(res, errorMessage(err), err.status);
      handleApiError(res, err);
    }
  });

  app.post("/api/v1/workspaces/:workspaceId/members", apiAuthenticate, requireWorkspaceRole(['owner']), requirePlanCapacity('seats'), async (req: express.Request, res: express.Response) => {
    try {
      const { workspaceId } = req.params as Record<string, string>;
      const { memberUid, email } = req.body;
      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      if (!memberUid && !email) {
        return sendError(res, "Either memberUid or email must be provided", 400);
      }

      const db = getDb();
      let targetUid = memberUid;

      if (!targetUid && email) {
        try {
          const userByEmail = await authAdmin.getUserByEmail(email);
          targetUid = userByEmail.uid;
        } catch {
          // If auth user not found by email, use hashed/sanitized placeholder ID
          targetUid = `uid_${crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex').slice(0, 16)}`;
        }
      }

      const wsRef = db.collection("workspaces").doc(workspaceId);
      const wsDoc = await wsRef.get();
      if (!wsDoc.exists) {
        return sendError(res, "Workspace not found", 404);
      }

      const data = wsDoc.data() || {};
      const existingMembers: string[] = Array.isArray(data.members) ? data.members : [];

      if (!existingMembers.includes(targetUid)) {
        existingMembers.push(targetUid);
        await wsRef.update({
          members: existingMembers,
          updatedAt: new Date().toISOString()
        });
      }

      res.json({
        status: "success",
        message: `Member ${targetUid} added to workspace.`,
        workspaceId,
        members: existingMembers
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.delete("/api/v1/workspaces/:workspaceId/members/:memberUid", apiAuthenticate, requireWorkspaceRole(['owner']), async (req: express.Request, res: express.Response) => {
    try {
      const { workspaceId, memberUid } = req.params as Record<string, string>;
      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const db = getDb();
      const wsRef = db.collection("workspaces").doc(workspaceId);
      const wsDoc = await wsRef.get();
      if (!wsDoc.exists) {
        return sendError(res, "Workspace not found", 404);
      }

      const data = wsDoc.data() || {};
      const { count, ownerUids } = countWorkspaceOwners(data);

      // Refuse to remove last owner
      if (ownerUids.includes(memberUid) && count <= 1) {
        return sendError(res, "Cannot demote or remove the last owner of the workspace.", 400);
      }

      const existingMembers: string[] = Array.isArray(data.members) ? data.members : [];
      const updatedMembers = existingMembers.filter(m => m !== memberUid);
      const updatedRoles = { ...(data.roles || {}) };
      delete updatedRoles[memberUid];

      await wsRef.update({
        members: updatedMembers,
        roles: updatedRoles,
        updatedAt: new Date().toISOString()
      });

      // Write audit log
      await writeServerAuditLog({
        workspaceId,
        uid: authReq.user.uid,
        email: authReq.user.email || '',
        action: 'MEMBER_REMOVED',
        entityType: 'workspace',
        entityId: workspaceId,
        details: {
          removedUid: memberUid,
          description: `Member ${memberUid} removed from workspace`
        }
      }, { db });

      res.json({
        status: "success",
        message: `Member ${memberUid} removed from workspace.`,
        workspaceId,
        members: updatedMembers
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });
}
