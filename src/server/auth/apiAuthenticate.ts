import express from "express";
import crypto from "crypto";
import { getDb, FieldValue } from "../db/firestore";
import { getShardedCounterValue } from "../services/shardedCounterService";
import { verifyIdToken } from "./supabaseAuth";
import { globalAdminConfig, refreshGlobalAdminConfigIfStale } from "../http/serverKit";
import { apiKeyLimit, apiKeyRateLimiter } from "../middleware/rateLimiters";
import type { AuthenticatedRequest, AuthUser } from "../http/serverKit";

import { BRAND_NAME } from '../../config/brand';

/** Which existing API-key scope gates a request; command write scopes are deliberately domain-specific. */
/** #823: the API-key scope each command area writes under; an area not listed here is not open to keys. */
const COMMAND_AREA_SCOPE: Readonly<Record<string, string>> = {
  // the books: entries, documents, payments, stock, assets, reconciliation
  journal: 'write:transactions', journaltemplate: 'write:transactions', payment: 'write:transactions',
  invoice: 'write:transactions', bill: 'write:transactions', creditnote: 'write:transactions',
  vendorcredit: 'write:transactions', estimate: 'write:transactions', document: 'write:transactions',
  inventory: 'write:transactions', inventoryitem: 'write:transactions', rma: 'write:transactions',
  asset: 'write:transactions', loan: 'write:transactions', lease: 'write:transactions',
  revenue: 'write:transactions', reconciliations: 'write:transactions', transaction: 'write:transactions',
  // #820: every period command changes the books' state (close, lock a year, rebuild snapshots, restate FX)
  period: 'write:workspaces',
  // the chart and the plan
  chartaccount: 'write:ledger', budget: 'write:ledger',
  // contacts and their own records
  customer: 'write:customers', warranty: 'write:customers', vendor: 'write:vendors',
  autorule: 'write:rules', project: 'write:projects',
  // workspace and team features keep the scope of their legacy /workspaces routes
  alerts: 'write:workspaces', tasks: 'write:workspaces', watches: 'write:workspaces', entrylink: 'write:workspaces',
  time: 'write:workspaces', stages: 'write:workspaces', workspace: 'write:workspaces', numbering: 'write:workspaces',
};

/**
 * #941 (S-11): routes that act on a person's own account — sign-in history, revoking their sessions,
 * deleting their account, recovery codes, two-step settings — are for that person signed in, never for a
 * workspace API key, whatever scopes the key carries. The `account.*` commands are the same doors.
 */
export function isPersonOnlyPath(path: string): boolean {
  const clean = path.toLowerCase().split('?')[0].replace(/\/$/, '');
  if (/^\/api\/v1\/(auth|account)(\/|$)/.test(clean)) return true;
  const match = /\/commands\/([^/]+)/.exec(clean);
  if (!match) return false;
  let name = match[1];
  try { name = decodeURIComponent(name); } catch { /* an invalid name is refused by the command router */ }
  return name.split('.')[0] === 'account';
}

export function requiredApiKeyScope(method: string, path: string): string {
  const cleanPath = path.toLowerCase().split('?')[0].replace(/\/$/, '');
  const isWrite = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase());

  if (cleanPath.includes('/brain/')) return 'brain:analyze';
  // The explanation is posted only because its account list can be too long for a link; it reads.
  if (cleanPath.endsWith('/reports/explain')) return 'read:transactions';

  if (/(^|\/)commands(?:\/|$)/.test(cleanPath)) {
    if (!isWrite) return 'read:transactions';
    const match = /\/commands\/([^/]+)/.exec(cleanPath);
    let name = match?.[1] || '';
    try { name = decodeURIComponent(name); } catch { /* an invalid name will be refused by the command router */ }
    if (name === 'audit.deep' || name === 'consolidation.verify' || name === 'billing.recordcompute') return 'write:transactions';
    if (name === 'estimate.signlink' || name === 'document.remove') return 'write:workspaces';
    const area = name.split('.')[0];
    // #823: every command area is named here. One that is not listed — a new area, or settings, payroll
    // governance, portal links, audit entries and the record/contact commands that reach any collection —
    // needs `write:workspaces`, which no API key is issued with, instead of falling through to
    // `write:transactions` (the fallback that let a transactions-only key rewrite customers and settings).
    // own keys only: `constructor.x` or `__proto__.x` must not find an inherited property instead of failing closed
    return Object.hasOwn(COMMAND_AREA_SCOPE, area) ? COMMAND_AREA_SCOPE[area] : 'write:workspaces';
  }
  if (cleanPath.includes('/transactions')) return isWrite ? 'write:transactions' : 'read:transactions';
  if (cleanPath.includes('/projects')) return isWrite ? 'write:projects' : 'read:projects';
  if (cleanPath.includes('/ledger')) return isWrite ? 'write:ledger' : 'read:ledger';
  if (cleanPath.includes('/workspaces')) {
    // Workspace settings are changed by people in the app, not by API keys.
    return isWrite ? 'write:workspaces' : 'read:workspaces';
  }
  if (cleanPath.includes('/metrics')) return 'read:transactions';
  if (cleanPath.includes('/logs')) return 'read:workspaces';
  if (cleanPath.includes('/status')) return 'read:workspaces';
  return isWrite ? 'write:transactions' : 'read:transactions';
}

/**
 * L-85: someone who lost the authenticator signs in with the password and uses a recovery code, so
 * that one call must accept a password-only session. Both ways to make it are excused — the legacy
 * URL, and the command that replaced its body (`account.userecoverycode`); no other command is.
 */
export function acceptsPasswordOnlySession(method: string, originalUrl: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  const cleanPath = originalUrl.split('?')[0].replace(/\/$/, '');
  return cleanPath === '/api/v1/account/recovery-codes/use' || cleanPath === '/api/v1/commands/account.userecoverycode';
}

// Deep API Key Authentication Middleware
export const apiAuthenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization || (req.headers['x-api-key'] as string);
  if (!authHeader) {
    return res.status(401).json({ status: "error", message: "Unauthorized: Missing api token or X-API-Key." });
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.split("Bearer ")[1] : authHeader;

  await refreshGlobalAdminConfigIfStale(); // AUP-05: the bypass flag and multipliers below come from this instance's copy

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
         if (Number.isNaN(expiryDate.getTime()) || expiryDate.getTime() < Date.now()) {
            return res.status(401).json({ status: "error", message: "API key has expired." });
         }
      }

      // #941: a person's own account is never managed with a workspace key
      if (isPersonOnlyPath(req.originalUrl || req.url)) {
        return res.status(403).json({ status: "error", message: "Forbidden: account and sign-in actions need the person signed in, not an API key." });
      }

      // Action Scope Matching & Authorization Guard
      const allowedScopes = Array.isArray(docData?.scopes) ? docData.scopes : [];

      const reqScope = requiredApiKeyScope(req.method, req.originalUrl || req.url);
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
        firebase: { sign_in_provider: "custom", identities: {} },
        usedApiKeyId: keyId,
        apiKeyRateLimit: apiKeyLimit(docData?.rateLimitPerMinute)
      } as unknown as AuthUser;

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
      return res.status(500).json({ status: "error", message: `Authentication / Verification failure within ${BRAND_NAME} core.` });
    }
  }

  if (authHeader.startsWith("Bearer ")) {
    const idToken = authHeader.split("Bearer ")[1];
    try {
      // L-85: the recovery-code call is the one that accepts a password-only session (see above).
      const firstStepOnly = acceptsPasswordOnlySession(req.method, req.originalUrl || req.url);
      // Y-30: someone who must still set up two-step login can ask why
      const setupCheck = req.method === 'GET' && req.originalUrl.split('?')[0] === '/api/v1/account/two-step';
      const decodedToken = await verifyIdToken(idToken, { firstStepOnly, setupCheck }) as AuthUser;
      const isAnonymous = decodedToken.firebase?.sign_in_provider === 'anonymous';
      if (!decodedToken.email_verified && !isAnonymous) {
        return res.status(403).json({ status: "error", message: "Access Denied: Please verify your email protocol." });
      }
      if (decodedToken.admin === true || decodedToken.role === 'admin') {
        decodedToken.admin = true;
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
