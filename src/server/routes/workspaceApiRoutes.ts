import { executeCommand, withLegacyInputIdempotencyHash } from '../utils/commandExecutor';
import { workspaceApiCreateCommand, workspaceMemberAddCommand, workspaceMemberRemoveCommand, workspaceRestoreBackupCommand } from '../commands/workspaceApi';
import type { CommandExecutionOutcome } from '../commands/types';
import { errorMessage } from "../auth/requestUser";
import { formatTzDate, sendError, handleApiError, authorizeWorkspace } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import { apiAuthenticate } from "../auth/apiAuthenticate";
import { requireWorkspaceRole } from "./workspaceRoutes";
import express from "express";
import { WorkspaceSchema } from "../../schemas";
import { getDb } from "../db/firestore";
import type { DocumentData } from "../db/firestore";
import { exportWorkspaceBackup } from "../services/workspaceRestoreService";
import { BRAND } from '../../config/brand';
import { computeLedgerCloseAnchor, verifyAuditHashChain, type HashChainableAuditEntry } from '../../lib/auditHashChain';
import { z } from 'zod';

const AuditVerifyQuerySchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** The legacy API sends errors as status/message, not the command router's envelope. */
function apiCommandError(outcome: Exclude<CommandExecutionOutcome, { ok: true }>): { status: number; body: unknown } {
  if (outcome.code === 'SEAT_CAPACITY_EXCEEDED' && outcome.details) return { status: outcome.status, body: outcome.details };
  return { status: outcome.status, body: { status: 'error', message: outcome.message } };
}

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
    const user = (req as AuthenticatedRequest).user;
    if (user.developerWorkspaceId) return sendError(res, 'Forbidden: Workspace-scoped API keys cannot create workspaces', 403);
    const validation = WorkspaceSchema.safeParse({ ...req.body, id: undefined, uid: user.uid, admins: undefined, isClosed: false, lockDate: undefined, createdAt: new Date().toISOString() });
    if (!validation.success) return sendError(res, 'Validation Error: ' + validation.error.issues.map(e => `${e.path.join('.')}: ${errorMessage(e)}`).join(', '), 400);
    await executeCommand(req, res, {
      definition: workspaceApiCreateCommand, workspaceId: '', input: { fields: req.body || {} },
      formatResponse(outcome) {
        if (outcome.ok) return { status: 201, body: { status: 'success', message: 'Workspace created successfully.', workspace: (outcome.data as { workspace: unknown }).workspace } };
        return apiCommandError(outcome);
      },
    });
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

  // Keep the legacy access, plan and answer gates; the registered commands own the writes.
  app.post("/api/v1/workspaces/:workspaceId/restore", apiAuthenticate, requireWorkspaceRole(['owner']), async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = String(req.params.workspaceId);
      await authorizeWorkspace(req as AuthenticatedRequest, workspaceId);
      await executeCommand(req, res, {
        definition: workspaceRestoreBackupCommand, workspaceId, input: { backup: req.body }, legacyRoute: true,
        formatResponse(outcome) {
          if (outcome.ok) return { status: 200, body: { success: true, message: 'General ledger workspace successfully restored from backup.', ...(outcome.data as Record<string, unknown>) } };
          return apiCommandError(outcome);
        },
      });
    } catch (err) { handleApiError(res, err); }
  });

  app.post("/api/v1/workspaces/:workspaceId/members", apiAuthenticate, requireWorkspaceRole(['owner']), async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = String(req.params.workspaceId);
      await authorizeWorkspace(req as AuthenticatedRequest, workspaceId);
      const { memberUid, email } = req.body;
      if (!memberUid && !email) return sendError(res, 'Either memberUid or email must be provided', 400);
      await executeCommand(req, res, {
        definition: workspaceMemberAddCommand, workspaceId, input: { ...(memberUid ? { memberUid } : {}), ...(email ? { email } : {}) },
        formatResponse(outcome) {
          if (!outcome.ok) return apiCommandError(outcome);
          const result = outcome.data as { memberUid: string; members: string[] };
          return { status: 200, body: { status: 'success', message: `Member ${result.memberUid} added to workspace.`, workspaceId, members: result.members } };
        },
      });
    } catch (err) { handleApiError(res, err); }
  });

  app.delete("/api/v1/workspaces/:workspaceId/members/:memberUid", apiAuthenticate, requireWorkspaceRole(['owner']), async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = String(req.params.workspaceId);
      const memberUid = String(req.params.memberUid);
      await authorizeWorkspace(req as AuthenticatedRequest, workspaceId);
      await executeCommand(req, res, {
        definition: withLegacyInputIdempotencyHash(workspaceMemberRemoveCommand), workspaceId, input: { memberUid },
        formatResponse(outcome) {
          if (!outcome.ok) return apiCommandError(outcome);
          const result = outcome.data as { members: string[] };
          return { status: 200, body: { status: 'success', message: `Member ${memberUid} removed from workspace.`, workspaceId, members: result.members } };
        },
      });
    } catch (err) { handleApiError(res, err); }
  });

  /** Strategy 5: Verify cryptographic SHA-256 hash-chain integrity + ledger close anchor for a workspace. */
  app.get(
    "/api/v1/workspaces/:workspaceId/audit-chain/verify",
    apiAuthenticate,
    requireWorkspaceRole(["owner", "accountant"]),
    async (req: express.Request, res: express.Response) => {
      try {
        const { workspaceId } = req.params as Record<string, string>;
        const parsedQuery = AuditVerifyQuerySchema.safeParse(req.query || {});
        if (!parsedQuery.success) {
          return sendError(res, "Invalid query parameters", 400);
        }
        const authReq = req as AuthenticatedRequest;
        await authorizeWorkspace(authReq, workspaceId);

        const db = getDb();
        const [auditSnap, txSnap] = await Promise.all([
          db.collection("auditLogs").where("workspaceId", "==", workspaceId).get(),
          db.collection("transactions").where("workspaceId", "==", workspaceId).get(),
        ]);

        const logs = auditSnap.docs.map(d => ({ ...(d.data() as HashChainableAuditEntry), id: d.id }));
        const verification = verifyAuditHashChain(logs);
        const txs = txSnap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id })) as never[];
        const ledgerAnchor = computeLedgerCloseAnchor(txs, parsedQuery.data.asOfDate);

        res.json({
          status: "success",
          workspaceId,
          auditChain: verification,
          ledgerAnchor,
        });
      } catch (err) {
        handleApiError(res, err);
      }
    },
  );
}
