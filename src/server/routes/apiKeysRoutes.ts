import { handleApiError, authorizeWorkspace, authenticate } from "../http/serverKit";
import { roleInWorkspace } from "../middleware/requireLedgerWriter";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import { requireWorkspaceRole } from "./workspaceRoutes";
import express from "express";
import crypto from "crypto";
import { SecurityService } from "../../services/securityService";
import { getDb, FieldValue } from "../db/firestore";
import { apiKeyLimit } from "../middleware/rateLimiters";
import { openApiDocument } from "../openapi";

/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerApiKeysRoutes(app: express.Express, _ctx: ServerContext): void {
  // Z-01: the API described for tools (OpenAPI 3.1), built from the schemas the server checks with
  app.get("/api/v1/openapi.json", (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(openApiDocument());
  });

  // --- API Key Management endpoints ---
  app.post("/api/v1/keys/provision", authenticate, requireWorkspaceRole(['owner']), async (req: express.Request, res: express.Response) => {
    try {
      const { name, scopes, expiration, workspaceId, rateLimitPerMinute } = req.body;
      if (!workspaceId) {
        return res.status(400).json({ status: "error", message: "Missing workspaceId in body" });
      }

      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      const userId = authReq.user.uid;
      
      const randomSecret = crypto.randomBytes(32).toString('hex');
      const randomKeyIdSuffix = crypto.randomBytes(8).toString('hex');
      const keyId = `lf_id_${workspaceId}_${randomKeyIdSuffix}`;
      const computedHash = crypto.createHash('sha256').update(randomSecret).digest('hex');

      let expiresAtValue: string | null = null;
      if (expiration && expiration !== 'never') {
        const d = new Date();
        if (expiration === '1h') d.setHours(d.getHours() + 1);
        else if (expiration === '24h') d.setHours(d.getHours() + 24);
        else if (expiration === '30d') d.setDate(d.getDate() + 30);
        else if (expiration === '90d') d.setDate(d.getDate() + 90);
        expiresAtValue = d.toISOString();
      }

      const defaultScopes = [
        'read:transactions',
        'write:transactions',
        'read:projects',
        'write:projects',
        'read:ledger',
        'write:ledger',
        'read:workspaces',
        'brain:analyze'
      ];

      const keyPayload = {
        id: keyId,
        workspaceId,
        uid: userId,
        name: name || 'Production Integration Key',
        keyHash: computedHash,
        scopes: Array.isArray(scopes) && scopes.length > 0 ? scopes : defaultScopes,
        expiresAt: expiresAtValue || 'never',
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        totalRequests: 0,
        // Z-02: requests a minute this key may make (10 to 10,000; 120 unless chosen)
        rateLimitPerMinute: apiKeyLimit(rateLimitPerMinute)
      };

      const db = getDb();
      await db.collection("apiKeys").doc(keyId).set(keyPayload);

      // Return full token signature once
      const fullKeySecret = `${keyId}.${randomSecret}`;
      res.status(201).json({
        status: "success",
        apiKey: fullKeySecret,
        key: {
          id: keyId,
          name: keyPayload.name,
          scopes: keyPayload.scopes,
          expiresAt: keyPayload.expiresAt,
          createdAt: keyPayload.createdAt,
          rateLimitPerMinute: keyPayload.rateLimitPerMinute
        }
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.delete("/api/v1/keys/revoke/:keyId", authenticate, async (req: express.Request, res: express.Response) => {
    try {
      const { keyId } = req.params as Record<string, string>;
      if (!keyId) {
        return res.status(400).json({ status: "error", message: "Missing keyId in path" });
      }

      const authReq = req as AuthenticatedRequest;
      const db = getDb();
      const keyDoc = await db.collection("apiKeys").doc(keyId).get();

      if (!keyDoc.exists) {
        return res.status(404).json({ status: "error", message: "API key not found." });
      }

      const keyData = keyDoc.data();
      const workspaceId = keyData?.workspaceId;
      if (workspaceId) {
        const wsData = await authorizeWorkspace(authReq, workspaceId);
        // only an owner makes a workspace key, so only an owner (or a platform admin) revokes one (AUD-09 step 3)
        if (!authReq.user.admin && roleInWorkspace(wsData, authReq.user.uid) !== 'owner') {
          return res.status(403).json({ status: "error", message: "Only an owner revokes this workspace's API keys." });
        }
      } else if (keyData?.uid !== authReq.user.uid && !authReq.user.admin) {
        return res.status(403).json({ status: "error", message: "Forbidden key revocation" });
      }

      await db.collection("apiKeys").doc(keyId).delete();
      res.json({ status: "success", message: "API key revoked successfully." });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // --- User Custom Gemini AI Key Management ---
  app.post("/api/v1/user/ai-key", authenticate, async (req: express.Request, res: express.Response) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { apiKey } = req.body;
      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return res.status(400).json({ status: "error", message: "A non-empty apiKey string is required." });
      }

      const cleanKey = apiKey.trim();
      const encryptedKey = SecurityService.encryptSensitiveField(cleanKey);
      const suffix = cleanKey.length >= 4 ? cleanKey.slice(-4) : cleanKey;

      const db = getDb();
      await db.collection("users").doc(authReq.user.uid).set({
        geminiApiKeyEncrypted: encryptedKey,
        hasCustomApiKey: true,
        apiKeySuffix: suffix,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      res.json({
        status: "success",
        message: "Gemini API key encrypted and saved securely.",
        hasCustomApiKey: true,
        apiKeySuffix: suffix
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.delete("/api/v1/user/ai-key", authenticate, async (req: express.Request, res: express.Response) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const db = getDb();
      await db.collection("users").doc(authReq.user.uid).update({
        geminiApiKeyEncrypted: FieldValue.delete(),
        geminiApiKey: FieldValue.delete(),
        hasCustomApiKey: false,
        apiKeySuffix: FieldValue.delete(),
        updatedAt: new Date().toISOString()
      });

      res.json({
        status: "success",
        message: "Custom Gemini API key removed.",
        hasCustomApiKey: false
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.get("/api/v1/user/ai-key-status", authenticate, async (req: express.Request, res: express.Response) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const db = getDb();
      const userDoc = await db.collection("users").doc(authReq.user.uid).get();
      const data = userDoc.data();
      const hasCustomApiKey = Boolean(data?.geminiApiKeyEncrypted || data?.geminiApiKey);
      const apiKeySuffix = data?.apiKeySuffix || (data?.geminiApiKey ? data.geminiApiKey.slice(-4) : null);

      res.json({
        status: "success",
        hasCustomApiKey,
        apiKeySuffix
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });
}
