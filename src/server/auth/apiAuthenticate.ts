import express from "express";
import crypto from "crypto";
import { getDb, FieldValue } from "../db/firestore";
import { getShardedCounterValue } from "../services/shardedCounterService";
import { verifyIdToken } from "./supabaseAuth";
import { globalAdminConfig } from "../http/serverKit";
import { apiKeyLimit, apiKeyRateLimiter } from "../middleware/rateLimiters";
import type { AuthenticatedRequest, AuthUser } from "../http/serverKit";

// Deep API Key Authentication Middleware
export const apiAuthenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization || (req.headers['x-api-key'] as string);
  if (!authHeader) {
    return res.status(401).json({ status: "error", message: "Unauthorized: Missing api token or X-API-Key." });
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.split("Bearer ")[1] : authHeader;

  if (token.startsWith("lf_")) {
    try {
      const parts = token.split(".");
      if (parts.length !== 2) {
        return res.status(401).json({ status: "error", message: "Malformed credentials schema. Format must be {KeyID}.{SecretKey}." });
      }
      const [keyId, secretKey] = parts;
      
      // Correctly extract the workspace ID from lf_id_{workspaceId}_{randomHex}
      if (!keyId.startsWith("lf_id_")) {
        return res.status(401).json({ status: "error", message: "Invalid key prefix structure." });
      }
      const stripped = keyId.substring("lf_id_".length);
      const lastUnderscore = stripped.lastIndexOf("_");
      if (lastUnderscore === -1) {
        return res.status(401).json({ status: "error", message: "Malformed credentials signature identifier." });
      }
      const workspaceIdPattern = stripped.substring(0, lastUnderscore);
      
      // Fetch API key doc via standard Admin SDK bypass to ignore Firebase Rules block securely on backend
      const db = getDb();
      const keySnapshot = await db.collection("apiKeys").doc(keyId).get();
      if (!keySnapshot.exists) {
         return res.status(401).json({ status: "error", message: "API key signature is invalid or revoked." });
      }

      const docData = keySnapshot.data();

      // Check if the workspace manually matches
      const storedWorkspaceId = docData?.workspaceId;
      if (storedWorkspaceId !== workspaceIdPattern) {
         return res.status(401).json({ status: "error", message: "API key workspace mismatch." });
      }

      const storedHash = docData?.keyHash;
      if (!storedHash) {
         return res.status(401).json({ status: "error", message: "API key corrupt." });
      }

      const computedHash = crypto.createHash('sha256').update(secretKey).digest('hex');

      const storedBuf = Buffer.from(storedHash, 'hex');
      const computedBuf = Buffer.from(computedHash, 'hex');
      if (storedBuf.length !== computedBuf.length || !crypto.timingSafeEqual(storedBuf, computedBuf)) {
         return res.status(401).json({ status: "error", message: "API key signature is invalid." });
      }

      // Granular Expiration Check
      const expiresAt = docData?.expiresAt;
      if (expiresAt && expiresAt !== "never") {
         const expiryDate = new Date(expiresAt);
         if (isNaN(expiryDate.getTime()) || expiryDate.getTime() < Date.now()) {
            return res.status(401).json({ status: "error", message: "API key has expired." });
         }
      }

      // Action Scope Matching & Authorization Guard
      const allowedScopes = Array.isArray(docData?.scopes) ? docData.scopes : [];

      const getRequiredScope = (method: string, path: string): string => {
        const cleanPath = path.toLowerCase().split("?")[0].replace(/\/$/, "");
        
        if (cleanPath.includes("/brain/")) {
          return "brain:analyze";
        }
        
        // the explanation is posted only because its account list can be too long for a link; it reads
        if (cleanPath.endsWith("/reports/explain")) {
          return "read:transactions";
        }

        const isWrite = ["POST", "PUT", "DELETE", "PATCH"].includes(method);
        
        if (cleanPath.includes("/transactions")) {
          return isWrite ? "write:transactions" : "read:transactions";
        }
        if (cleanPath.includes("/projects")) {
          return isWrite ? "write:projects" : "read:projects";
        }
        if (cleanPath.includes("/ledger")) {
          return isWrite ? "write:ledger" : "read:ledger";
        }
        if (cleanPath.includes("/workspaces")) {
          return "read:workspaces";
        }
        if (cleanPath.includes("/metrics")) {
          return "read:transactions";
        }
        if (cleanPath.includes("/logs")) {
          return "read:workspaces";
        }
        if (cleanPath.includes("/status")) {
          return "read:workspaces";
        }
        
        return isWrite ? "write:transactions" : "read:transactions";
      };

      const reqScope = getRequiredScope(req.method, req.originalUrl || req.url);
      if (!allowedScopes.includes(reqScope)) {
        return res.status(403).json({
          status: "error",
          message: `Forbidden: This action requires '${reqScope}' scope permission. Currently allowed scopes on this token are: [${allowedScopes.join(', ')}]`
        });
      }

      // True Enterprise Quota Verification (Pre-Flight)
      try {
        const wsRef = db.collection("workspaces").doc(workspaceIdPattern);
        const wsData = (await wsRef.get()).data() || {};
        const bypass = wsData.bypassBilling === true || globalAdminConfig.bypassBilling === true;
        const baseline = wsData.computeCreditBalance !== undefined ? wsData.computeCreditBalance : 100000;
        const currentCredit = await getShardedCounterValue(db, workspaceIdPattern, 'computeCreditBalance', baseline);
        
        if (!bypass && currentCredit <= 0) {
          return res.status(402).json({
            status: "error",
            message: "Payment Required: Workspace compute credit balance depleted. Please recharge your API balance or enable bypass billing."
          });
        }
      } catch (quotaErr) {
        console.error("[Deep Auth] Quota check failed - Denying access (Fail Closed)", quotaErr);
        return res.status(500).json({
          status: "error",
          message: "Internal Authentication Error: Quota verification service is currently unavailable. Please retry in a few moments."
        });
      }

      // Set request user details for request pipeline context
      (req as AuthenticatedRequest).user = {
        uid: docData?.uid || "unknown_developer_uid",
        email: "developer@ledgerflow.io",
        email_verified: true,
        displayName: "Developer Key Client",
        developerWorkspaceId: workspaceIdPattern,
        apiKeyName: docData?.name || "Production Integration Key",
        firebase: { sign_in_provider: "custom" },
        usedApiKeyId: keyId,
        apiKeyRateLimit: apiKeyLimit(docData?.rateLimitPerMinute)
      } as any;

      // Background metrics update (does not block original request response)
      try {
        db.collection("apiKeys").doc(keyId).update({
          lastUsedAt: new Date().toISOString(),
          totalRequests: FieldValue.increment(1)
        }).catch((err: unknown) => console.error("[Deep Auth] Failed incrementing API key metrics: ", err));
      } catch {
        // stats silently fail with safety
      }

      // Z-02: each key has its own limit a minute
      return apiKeyRateLimiter(req, res, next);
    } catch (err) {
      console.error("[Deep Auth] Token verification failure:", err);
      return res.status(500).json({ status: "error", message: "Authentication / Verification failure within LedgerFlow core." });
    }
  }

  if (authHeader.startsWith("Bearer ")) {
    const idToken = authHeader.split("Bearer ")[1];
    try {
      // L-85: someone who lost the authenticator signs in with the password and uses a recovery code
      const firstStepOnly = req.method === 'POST' && req.originalUrl.split('?')[0] === '/api/v1/account/recovery-codes/use';
      // Y-30: someone who must still set up two-step login can ask why
      const setupCheck = req.method === 'GET' && req.originalUrl.split('?')[0] === '/api/v1/account/two-step';
      const decodedToken = await verifyIdToken(idToken, { firstStepOnly, setupCheck }) as AuthUser;
      const isAnonymous = decodedToken.firebase?.sign_in_provider === 'anonymous';
      if (!decodedToken.email_verified && !isAnonymous) {
        return res.status(403).json({ status: "error", message: "Access Denied: Please verify your email protocol." });
      }
      if ((decodedToken as any).admin === true || (decodedToken as any).role === 'admin') {
        (decodedToken as any).admin = true;
      }
      (req as AuthenticatedRequest).user = decodedToken;
      return next();
    } catch (error) {
      if (error instanceof Error && (error as { code?: string }).code === 'auth/two-step-setup-required') {
        return res.status(403).json({ status: "error", code: "two_step_setup_required", message: error.message });
      }
      return res.status(401).json({ status: "error", message: "Unauthorized: Invalid bearer token" });
    }
  }

  return res.status(401).json({ status: "error", message: "Unauthorized: Protocol scheme unsupported." });
};
