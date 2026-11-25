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
import { memberSignInFacts } from "../services/memberSignInService";
import { roleInWorkspace } from "../middleware/requireLedgerWriter";
import { BRAND } from '../../config/brand';
import { computeLedgerCloseAnchor, verifyAuditHashChain, type HashChainableAuditEntry } from '../../lib/auditHashChain';
import { z } from 'zod';
import { sanitizeCsvCell } from '../../lib/csv';
import { currencyDigits, minorToMajor } from '../../lib/currencyMinorUnits';

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
      // AUP-10: a failed lookup is an error (the outer catch answers 500), never an empty success
      const ownedWSQuery = await db.collection("workspaces").where("uid", "==", uid).get();
      const ownedWorkspaces: Array<Record<string, unknown>> = ownedWSQuery.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name || "Unnamed Workspace",
          currency: doc.data().currency || "USD",
          businessType: doc.data().businessType || "general",
          lockDate: doc.data().lockDate || null,
          createdAt: doc.data().createdAt || null,
          role: "owner"
        }));

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
      // S-21: owners and accountants (who run the access review) also get each person's last
      // sign-in and whether they use two-step sign-in, straight from the auth provider.
      const role = roleInWorkspace(data, authReq.user.uid);
      const signIn = role === 'owner' || role === 'accountant'
        ? await memberSignInFacts(db, [String(ownerUid || ''), ...members])
        : undefined;

      res.json({
        status: "success",
        workspaceId,
        ownerUid,
        members,
        total: members.length + 1,
        ...(signIn ? { signIn } : {}),
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
        // AF6-20261120-01 (Agent #6): the same rules as the shared writer the screens use.
        // (1) A description, category or reference that begins with =, +, -, @ — also behind the
        // whitespace a spreadsheet skips — is text, never a formula the reader's Excel runs
        // (CWE-1236). This builder quoted the cell and doubled its quotes, which protects the CSV
        // structure but not the spreadsheet.
        // (2) An amount is written with the decimals of the currency it is stored in: `/ 100` then
        // `toFixed(2)` wrote ¥100,000 (stored as 100000 minor units) as "1000.00" and KWD 12.345 as
        // "12.35". The row's own currency wins; the workspace's currency is the fallback.
        const bookCurrency = String(wsData?.currency || wsData?.settings?.currency || "USD").trim().toUpperCase();
        const accountsMap = new Map(accounts.map((a) => [a.id, a.name || a.code || a.id]));
        const rows: Array<Array<string | number>> = [["Date", "Amount", "Description", "Category", "Type", "Status", "Reference"]];
        transactions.forEach((t) => {
          const categoryName = t.lines && t.lines.length > 0 ? (accountsMap.get(t.lines[0].accountId) || t.lines[0].accountName || 'Uncategorized') : 'Uncategorized';
          const rowCurrency = /^[A-Z]{3}$/.test(String(t.currency || "").toUpperCase()) ? String(t.currency).toUpperCase() : bookCurrency;
          rows.push([
            String(t.date || ''),
            minorToMajor(Number(t.totalAmountCents || 0), rowCurrency).toFixed(currencyDigits(rowCurrency)),
            String(t.description || ''),
            String(categoryName),
            String(t.type || 'actual'),
            String(t.status || 'posted'),
            String(t.reference || ''),
          ]);
        });
        const csvContent = rows.map((row) => row.map((cell) => sanitizeCsvCell(cell)).join(",")).join("\r\n") + "\r\n";
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
      // #941: replacing the books is a high-risk command; this older address holds it to the same
      // two-step rule as /api/v1/commands/workspace.restorebackup (a person with aal2, never an API key)
      const restorer = (req as AuthenticatedRequest).user as { aal?: string; developerWorkspaceId?: string } | undefined;
      if (restorer?.developerWorkspaceId || restorer?.aal !== 'aal2') {
        res.status(403).json({ status: 'error', code: 'TWO_STEP_REQUIRED', message: 'High-risk commands require a person signed in with two-step verification; API keys cannot confirm this step.' });
        return;
      }
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
