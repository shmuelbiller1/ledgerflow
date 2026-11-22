import { errorMessage, requestUser } from "../auth/requestUser";
import { z } from "zod";
import type { ServerContext } from "../http/serverKit";
import { apiAuthenticate } from "../auth/apiAuthenticate";
import express from "express";
import { getDb } from "../db/firestore";
import { AccountDeletionBlocked, deleteAccount } from "../services/accountDeletionService";
import { authAdmin } from "../auth/supabaseAuth";
import { recordAuthEvent } from "../services/authAuditService";
import { writeServerAuditLog } from "../services/auditLogService";
import { authRateLimiter } from "../middleware/rateLimiters";
import { listAuthSessions, revokeAuthSession } from "../services/authSessionService";
import type { RequestUser } from "../auth/requestUser";

/** S-28: sessions belong to a person; API keys and assistant tokens have none to manage. */
function isPersonSignIn(user: RequestUser): boolean {
  return !user.usedApiKeyId && !user.developerWorkspaceId && !user.assistantSandboxId;
}

/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerAuthRoutes(app: express.Express, _ctx: ServerContext): void {
  // Session revocation: every device, or (S-28) one device when the body names `sessionId`
  const RevokeSessionsBody = z.object({ sessionId: z.string().uuid().optional() }).strict();
  app.post("/api/v1/auth/revoke-sessions", authRateLimiter, apiAuthenticate, async (req, res) => {
    try {
      const user = requestUser(req);
      const db = getDb();
      const parsed = RevokeSessionsBody.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'sessionId must be a session id from GET /api/v1/auth/sessions.' });
      const { sessionId } = parsed.data;
      if (sessionId) {
        if (!isPersonSignIn(user)) return res.status(403).json({ error: 'Sessions can only be signed out by the person, not by an API key.' });
        if (!(await revokeAuthSession(db, user.uid, sessionId))) return res.status(404).json({ error: 'No such session.' });
        const ownedBooks = await db.collection("workspaces").where("uid", "==", user.uid).limit(10).get();
        await Promise.all(ownedBooks.docs.map(ws => writeServerAuditLog({
          workspaceId: ws.id, uid: user.uid, email: user.email, action: "SESSION_REVOKED", entityType: "auth",
          entityId: sessionId, details: { description: "Signed out one device", sessionId },
        }, { db })));
        return res.json({ success: true, sessionId, current: user.session_id === sessionId, message: 'That device is signed out.' });
      }
      await authAdmin.revokeRefreshTokens(user.uid);
      const owned = await db.collection("workspaces").where("uid", "==", user.uid).limit(10).get();
      await Promise.all(
        owned.docs.map((ws) =>
          writeServerAuditLog(
            {
              workspaceId: ws.id,
              uid: user.uid,
              email: user.email,
              action: "SESSIONS_REVOKED",
              entityType: "auth",
              entityId: user.uid,
              details: { description: "Revoked all active sessions and refresh tokens" },
            },
            { db }
          )
        )
      );
      res.json({ success: true, message: 'All active sessions revoked successfully. You will be signed out shortly.' });
    } catch (error) {
      console.error('Failed to revoke sessions:', error);
      res.status(500).json({ error: errorMessage(error) || 'Failed to revoke sessions' });
    }
  });

  // S-28: the signed-in person's own sessions (devices), newest activity first; `current` marks this one
  app.get("/api/v1/auth/sessions", apiAuthenticate, async (req, res) => {
    try {
      const user = requestUser(req);
      if (!isPersonSignIn(user)) return res.status(403).json({ error: 'Sessions can only be listed by the person, not by an API key.' });
      const sessions = await listAuthSessions(getDb(), user.uid, typeof user.session_id === 'string' ? user.session_id : undefined);
      res.json({ status: 'success', sessions });
    } catch (error) {
      console.error('Failed to list sessions:', error);
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  // Delete user account (accountDeletionService.ts: shared books are never left without an owner)
  app.delete("/api/v1/auth/delete-account", authRateLimiter, apiAuthenticate, async (req, res) => {
    try {
      const user = requestUser(req);
      const result = await deleteAccount(getDb(), { uid: user.uid, email: user.email }, uid => authAdmin.deleteUser(uid));
      res.json({ success: true, message: 'Account deleted.', ...result });
    } catch (error) {
      if (error instanceof AccountDeletionBlocked) {
        return res.status(409).json({ error: errorMessage(error), workspaces: error.workspaces });
      }
      console.error('Failed to delete account:', error);
      res.status(500).json({ error: errorMessage(error) || 'Failed to delete account' });
    }
  });

  // Auth Audit Event Recording: only for the signed-in person (it used to take any uid from the
  // body without a sign-in, so anyone could add sign-ins to another person's security log)
  const AuthAuditBody = z.object({
    event: z.enum(['login', 'logout', 'token_refresh']),
    workspaceId: z.string().min(1).max(128).optional(),
    metadata: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])).optional()
      .refine(m => !m || Object.keys(m).length <= 20, 'Too many metadata fields'),
  }).strict();
  app.post("/api/v1/auth/audit", apiAuthenticate, async (req, res) => {
    try {
      const user = requestUser(req);
      const parsed = AuthAuditBody.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
      }
      // req.ip honours `trust proxy` (one hop); the first X-Forwarded-For entry is whatever the
      // caller typed, so it could fake the address in the security log and dodge the new-network alert.
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userAgent = String(req.headers['user-agent'] || 'unknown').slice(0, 300);
      const id = await recordAuthEvent({ uid: user.uid, event: parsed.data.event, workspaceId: parsed.data.workspaceId, ip, userAgent, email: user.email, metadata: parsed.data.metadata });
      res.json({ success: true, id });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  // Self-read endpoint for the signed-in user's own authentication security log (F-09c)
  app.get("/api/v1/auth/login-audits", apiAuthenticate, async (req, res) => {
    try {
      const user = requestUser(req);
      const rawLimit = Number(req.query.limit || 25);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.floor(rawLimit))) : 25;
      const snap = await getDb()
        .collection("loginAudits")
        .where("uid", "==", user.uid)
        .orderBy("timestamp", "desc")
        .limit(limit)
        .get();
      const loginAudits = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      res.json({ status: "success", loginAudits });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });
}
