import { handleApiError, authenticate } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import { requireWorkspaceRole } from "./workspaceRoutes";
import express from "express";
import { getDb } from "../db/firestore";
import { openApiDocument } from "../openapi";
import { executeCommand } from "../utils/commandExecutor";
import { apiKeyProvisionCommand, apiKeyRevokeCommand, apiKeyRevokePersonalCommand, userAiKeyRemoveCommand, userAiKeySetCommand } from "../commands/apiKeys";

/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerApiKeysRoutes(app: express.Express, _ctx: ServerContext): void {
  // Z-01: the API described for tools (OpenAPI 3.1), built from the schemas the server checks with
  app.get("/api/v1/openapi.json", (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(openApiDocument());
  });

  // --- API Key Management endpoints ---
  // Z-01/Z-02, AUD-09 step 3: the command owns the schema, the owner check and the audit line; the
  // key's secret is shown once and never recorded. These addresses keep their legacy answers.
  app.post("/api/v1/keys/provision", authenticate, requireWorkspaceRole(['owner']), async (req: express.Request, res: express.Response) => {
    await executeCommand(req, res, {
      definition: apiKeyProvisionCommand,
      workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
      input: req.body,
      formatResponse: (outcome) => {
        if (outcome.ok) {
          const key = (outcome.data as { key: { keyId: string; name: string; scopes: string[]; expiresAt: string; createdAt: string; rateLimitPerMinute: number } }).key;
          const apiKey = (outcome.data as { apiKey?: string } & Record<string, unknown>).apiKey as string;
          return {
            status: 201,
            body: {
              status: 'success',
              apiKey,
              key: { id: key.keyId, name: key.name, scopes: key.scopes, expiresAt: key.expiresAt, createdAt: key.createdAt, rateLimitPerMinute: key.rateLimitPerMinute },
            },
          };
        }
        // a missing workspace is the legacy "Missing workspaceId in body"
        if (outcome.ok === false && /Workspace ID is required/i.test(outcome.message)) {
          return { status: 400, body: { status: 'error', message: 'Missing workspaceId in body' } };
        }
        return { status: outcome.status, body: { status: 'error', message: outcome.message } };
      },
    });
  });

  app.delete("/api/v1/keys/revoke/:keyId", authenticate, async (req: express.Request, res: express.Response) => {
    const keyId = String((req.params as Record<string, string>).keyId || '');
    if (!keyId) return res.status(400).json({ status: "error", message: "Missing keyId in path" });
    // which command runs depends on the key: a workspace key is an owner's write in that workspace, a
    // key made before keys belonged to a workspace is its maker's own. The route reads that, then the
    // command checks the caller against it.
    const keyDoc = await getDb().collection("apiKeys").doc(keyId).get();
    if (!keyDoc.exists) return res.status(404).json({ status: "error", message: "API key not found." });
    const workspaceId = (keyDoc.data() || {}).workspaceId;
    const definition = workspaceId ? apiKeyRevokeCommand : apiKeyRevokePersonalCommand;
    await executeCommand(req, res, {
      definition,
      workspaceId: workspaceId ? String(workspaceId) : '',
      input: workspaceId ? { workspaceId: String(workspaceId), keyId } : { keyId },
      formatResponse: (outcome) => {
        if (outcome.ok) return { status: 200, body: { status: "success", message: "API key revoked successfully." } };
        if (outcome.status === 404) return { status: 404, body: { status: "error", message: "API key not found." } };
        // the role refusal this address always gave (the command's own wording is the generic one)
        if (outcome.code === 'ROLE_REQUIRED') return { status: 403, body: { status: "error", message: "Only an owner revokes this workspace's API keys." } };
        return { status: outcome.status, body: { status: "error", message: outcome.message } };
      },
    });
  });

  // --- User Custom Gemini AI Key Management ---
  app.post("/api/v1/user/ai-key", authenticate, async (req: express.Request, res: express.Response) => {
    await executeCommand(req, res, {
      definition: userAiKeySetCommand,
      workspaceId: '',
      input: req.body,
      formatResponse: (outcome) => {
        if (outcome.ok) {
          const data = outcome.data as { hasCustomApiKey: boolean; apiKeySuffix: string };
          return {
            status: 200,
            body: {
              status: "success",
              message: "Gemini API key encrypted and saved securely.",
              hasCustomApiKey: data.hasCustomApiKey,
              apiKeySuffix: data.apiKeySuffix,
            },
          };
        }
        if (outcome.status === 401) return { status: 401, body: { status: "error", message: "Unauthenticated: " + outcome.message } };
        return { status: 400, body: { status: "error", message: outcome.message } };
      },
    });
  });

  app.delete("/api/v1/user/ai-key", authenticate, async (req: express.Request, res: express.Response) => {
    await executeCommand(req, res, {
      definition: userAiKeyRemoveCommand,
      workspaceId: '',
      input: {},
      formatResponse: (outcome) => (outcome.ok
        ? { status: 200, body: { status: "success", message: "Custom Gemini API key removed.", hasCustomApiKey: false } }
        : { status: outcome.status, body: { status: "error", message: outcome.message } }),
    });
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
