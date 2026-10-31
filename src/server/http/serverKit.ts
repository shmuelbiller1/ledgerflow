/**
 * Shared server helpers (moved out of server.ts, F-01): sign-in checks, workspace access, error
 * replies, the audit writer, the admin billing config and report data loading. Route files import
 * them from here.
 */
import express from "express";
import path from "path";
import os from "os";
import multer from "multer";
import type { ChartAccount, Transaction as LedgerTransaction } from "../../types";
import { errorMessage } from "../auth/requestUser";
import { LEDGER_WRITER_ROLES, roleInWorkspace } from "../middleware/requireLedgerWriter";
import { getShardedCounterValue } from "../services/shardedCounterService";
import { writeServerAuditLog } from "../services/auditLogService";
import { SecurityService } from "../../services/securityService";
import { assertWorkspaceAccess, getDb } from "../db/firestore";
import type { DocumentData, Transaction } from "../db/firestore";
import { verifyIdToken } from "../auth/supabaseAuth";
import type { DecodedIdToken } from "../auth/supabaseAuth";
import { logSafe, logSafeDetail } from '../utils/logSafe';

export function formatTzDate(d: Date = new Date(), timezone = 'UTC'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(d);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (y && m && day) return `${y}-${m}-${day}`;
  } catch {
    // fallback
  }
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- Types ---
export interface AuthUser extends DecodedIdToken {
  email_verified: boolean;
}

export interface AuthenticatedRequest extends express.Request {
  user: AuthUser;
}

// Temporary upload folder (the only writable place on Vercel); files are deleted after parsing.
export const UPLOAD_DIR = path.join(os.tmpdir(), "ledgerflow-uploads");
export const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
    files: 1
  }
});

// --- Global Admin Pricing & Billing Overrides System ---
export const globalAdminConfig = {
  creditCostMultiplier: 1.0,
  quotaCentsMultiplier: 1.0,
  bypassBilling: false,
  customKeyCreditCharge: 10,
  customKeyCentsCharge: 0,
  maxRegistrationLimit: 100,
  freeWorkspaceTxCap: 100,
};

export async function syncGlobalAdminConfig() {
  try {
    const db = getDb();
    const doc = await db.collection("admins").doc("globalConfig").get();
    if (doc.exists) {
      const data = doc.data() || {};
      Object.assign(globalAdminConfig, {
        creditCostMultiplier: data.creditCostMultiplier !== undefined ? Number(data.creditCostMultiplier) : 1.0,
        quotaCentsMultiplier: data.quotaCentsMultiplier !== undefined ? Number(data.quotaCentsMultiplier) : 1.0,
        bypassBilling: data.bypassBilling === true,
        customKeyCreditCharge: data.customKeyCreditCharge !== undefined ? Number(data.customKeyCreditCharge) : 10,
        customKeyCentsCharge: data.customKeyCentsCharge !== undefined ? Number(data.customKeyCentsCharge) : 0,
        maxRegistrationLimit: data.maxRegistrationLimit !== undefined ? Number(data.maxRegistrationLimit) : 100,
        freeWorkspaceTxCap: data.freeWorkspaceTxCap !== undefined ? Number(data.freeWorkspaceTxCap) : 100,
      });
      console.debug("🌀 [Global Billing Config Sync] Loaded from database:", globalAdminConfig);
    }
  } catch {
    console.debug("🌀 [Global Billing Config Sync] Bypassed (Using default settings)");
  }
}

/** Workspace overrides of the admin billing settings (all optional). */
export interface WorkspaceBillingOverrides {
  creditCostMultiplier?: number | string;
  quotaCentsMultiplier?: number | string;
  customKeyCreditCharge?: number | string;
  customKeyCentsCharge?: number | string;
  bypassBilling?: boolean;
}

export function calculateWorkspaceCharges(wsData: WorkspaceBillingOverrides | null | undefined, baseCredits: number, baseCents: number, isCustomKeyUsed: boolean) {
  const creditMult = wsData?.creditCostMultiplier !== undefined 
    ? Number(wsData.creditCostMultiplier) 
    : globalAdminConfig.creditCostMultiplier;
    
  const centsMult = wsData?.quotaCentsMultiplier !== undefined 
    ? Number(wsData.quotaCentsMultiplier) 
    : globalAdminConfig.quotaCentsMultiplier;

  let credits = baseCredits;
  let cents = baseCents;

  if (isCustomKeyUsed) {
    const wsCustomCredit = wsData?.customKeyCreditCharge !== undefined ? Number(wsData.customKeyCreditCharge) : null;
    credits = wsCustomCredit !== null ? wsCustomCredit : globalAdminConfig.customKeyCreditCharge;

    const wsCustomCents = wsData?.customKeyCentsCharge !== undefined ? Number(wsData.customKeyCentsCharge) : null;
    cents = wsCustomCents !== null ? wsCustomCents : globalAdminConfig.customKeyCentsCharge;
  }

  credits = Math.round(credits * creditMult);
  cents = Number((cents * centsMult).toFixed(6)); // Preserve micro-penny accuracy for accurate usage representation

  const bypass = wsData?.bypassBilling === true || globalAdminConfig.bypassBilling === true;
  if (bypass) {
    credits = 0;
    cents = 0;
  }

  return { credits, cents };
}

/**
 * Standard API error response
 */
export function sendError(res: express.Response, message: string, status: number = 500, details?: unknown) {
  console.error("[API Error] %s: %s (Path: %s)", status, logSafe(message), logSafe(res.req?.originalUrl || "unknown"), logSafeDetail(details));
  res.status(status).json({
    status: "error",
    message,
    ...(details ? { details } : {})
  });
}

/**
 * Centralized API error handler
 */
export function handleApiError(res: express.Response, err: unknown) {
  const message = errorMessage(err) || String(err) || "";
  const code = (err as { code?: unknown } | null)?.code ?? "";
  
  console.error("[Handling API Error]", err);
  console.error("[API Error Details] message:", message, "code:", code);

  if (message.includes("UNAUTHENTICATED") || code === 16) {
    return sendError(res, "Unauthenticated: " + message, 401);
  }
  if (message.includes("FORBIDDEN") || message.includes("PERMISSION_DENIED") || code === 7) {
    return sendError(res, "Forbidden access: " + message, 403);
  }
  if (message.includes("NOT_FOUND") || code === 5) {
    return sendError(res, "Resource not found: " + message, 404);
  }
  if (message.includes("INVALID_ARGUMENT") || message.includes("FAILED_PRECONDITION") || code === 3 || code === 9) {
    return sendError(res, "Unprocessable Entity: " + message, 422);
  }
  if (message.includes("ALREADY_EXISTS") || code === 6) {
    return sendError(res, "Conflict: " + message, 409);
  }

  sendError(res, message || "Internal Server Error", 500);
}

/**
 * Authorization & Context Helper
 */
export async function authorizeWorkspace(req: AuthenticatedRequest, workspaceId: string) {
  const db = getDb();
  
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new Error("NOT_FOUND: Invalid workspace identifier provided.");
  }

  try {
    const { data } = await assertWorkspaceAccess(db, workspaceId, req.user);
    
    // Administrative Policy Enforcement & Access Matrix Checks
  const url = req.originalUrl || req.url || "";
    const isBillingOrMetadataRoute = url.includes("/billing/status") || url.includes("/billing/record-compute");
    const isSystemAdmin = req.user?.admin === true;

    if (!isSystemAdmin && !isBillingOrMetadataRoute) {
      // 1. Account Freeze enforcement (concurrentUserLimit = 0 denotes administratively frozen account)
      if (data?.concurrentUserLimit === 0) {
        throw new Error("FORBIDDEN: This workspace is administratively suspended/frozen by Systems Administration. Please contact support@ledgerflow.app.");
      }

      const method = req.method || "GET";
      const isMutation = ["POST", "PUT", "DELETE", "PATCH"].includes(method);
      if (isMutation && !LEDGER_WRITER_ROLES.includes(roleInWorkspace(data, req.user.uid))) {
        throw new Error("FORBIDDEN: your role in this workspace is read-only.");
      }
      const isCreditSensitive = isMutation || url.includes("/brain/");

      // ACC-1 (Codex on #460): free access given by LedgerFlow lifts the credit and spending gates too
      if (isCreditSensitive && data?.bypassBilling !== true) {
        // 2. Compute credit balance checking
        const baseline = data?.computeCreditBalance !== undefined ? Number(data.computeCreditBalance) : 100000;
        const creditBalance = await getShardedCounterValue(db, workspaceId, 'computeCreditBalance', baseline);
        if (creditBalance <= 0) {
          throw new Error("PAYMENT_REQUIRED: This workspace has exhausted its compute credit balance (0 left). Please upgrade your plan or top up in settings.");
        }

        // 3. API Quota dollar limit enforcement
        const quotaLimitCents = data?.apiQuotaMonthlyLimitCents !== undefined ? Number(data.apiQuotaMonthlyLimitCents) : 0;
        const quotaUsedCents = data?.apiQuotaTotalCentsUsed !== undefined ? Number(data.apiQuotaTotalCentsUsed) : 0;
        if (quotaLimitCents > 0 && quotaUsedCents >= quotaLimitCents) {
          throw new Error("QUOTA_EXCEEDED: Workspace monthly spending quota limit exceeded. Please configure custom plan limits with your administrator.");
        }
      }
    }
    
    return data;
  } catch (err) {
    if (errorMessage(err) && (errorMessage(err).includes("FORBIDDEN") || errorMessage(err).includes("PAYMENT_REQUIRED") || errorMessage(err).includes("QUOTA_EXCEEDED"))) {
      throw err;
    }
    throw err;
  }
}

/**
 * Authentication Middleware
 */
export const authenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    // Return 401 silently for logs to avoid cluttering with pre-auth probes
    return res.status(401).json({ status: "error", message: "Unauthorized: No token provided" });
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    const decodedToken = await verifyIdToken(idToken) as AuthUser;
    
    if (decodedToken.admin === true || decodedToken.role === 'admin') {
      decodedToken.admin = true;
    } else {
      // Check if user has admin role in Firestore users collection
      try {
        const userDoc = await getDb().collection("users").doc(decodedToken.uid).get();
        if (userDoc.exists && userDoc.data()?.role === 'admin') {
          decodedToken.admin = true;
          decodedToken.role = 'admin';
        }
      } catch {
        // Fallback silently if DB read restricted
      }
    }

    const isAnonymous = decodedToken.firebase?.sign_in_provider === 'anonymous';
    if (!decodedToken.email_verified && !isAnonymous && !decodedToken.admin) {
      return sendError(res, "Access Denied: Please verify your email protocol.", 403);
    }

    (req as AuthenticatedRequest).user = decodedToken;
    next();
  } catch (error) {
    sendError(res, "Unauthorized: Invalid token", 401, error);
  }
};

/**
 * Optional Authentication Middleware for Telemetry
 * If valid Bearer token exists, attaches user; otherwise gracefully proceeds as unauthenticated
 */
export const optionalAuthenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await verifyIdToken(idToken) as AuthUser;
    (req as AuthenticatedRequest).user = decodedToken;
  } catch {
    // Non-blocking: unauthenticated telemetry fallback
  }
  next();
};

export const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = (req as AuthenticatedRequest).user;
  const isAdmin = Boolean(
    user && (
      user.admin === true || 
      user.role === 'admin'
    )
  );
  if (!isAdmin) {
    return res.status(403).json({ status: "error", message: "Forbidden: Admin privileges required." });
  }
  next();
};

export async function writeAuditLog(
  userId: string, 
  email: string, 
  action: string, 
  details: string, 
  workspaceId: string = 'system',
  before?: unknown,
  after?: unknown,
  transaction?: Transaction
) {
  try {
    const db = getDb();
    await writeServerAuditLog({
      workspaceId,
      uid: userId,
      email,
      action,
      entityType: 'system',
      entityId: workspaceId,
      details: {
        description: details,
        before: before || null,
        after: after || null
      }
    }, { db, tx: transaction });
  } catch (err) {
    console.warn("[AuditLog] Failed to persist audit log entry to database:", errorMessage(err));
  }
}

/**
 * Shared data fetcher for reports to ensure consistent auth and efficiency
 */
export async function getReportContext(req: AuthenticatedRequest, workspaceId: string) {
  const db = getDb();
  await authorizeWorkspace(req, workspaceId);
  const accountsSnap = await db.collection("chartAccounts").where("workspaceId", "==", workspaceId).get();
  
  // Streaming approach for transactions guarantees linear memory bounds and prevents Node.js OOM crashes on 100,000+ entries
  const transactions: LedgerTransaction[] = [];
  const txStream = db.collection("transactions").where("workspaceId", "==", workspaceId).stream();
  
  // the row's own id: a restored entry's data does not repeat it (DA-07)
  for await (const chunk of txStream as AsyncIterable<{ id: string; data: () => DocumentData }>) {
    transactions.push({ ...chunk.data(), id: chunk.id } as LedgerTransaction);
  }
  
  return {
    accounts: accountsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ChartAccount),
    transactions
  };
}

/**
 * Resolves the active Gemini API key for a user (supporting BYOK encrypted key or server fallback)
 */
export async function resolveUserGeminiApiKey(uid?: string): Promise<{ apiKey: string; isCustom: boolean }> {
  if (!uid) {
    return { apiKey: process.env.GEMINI_API_KEY || "", isCustom: false };
  }
  try {
    const db = getDb();
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists) {
      const data = userDoc.data();
      if (data?.geminiApiKeyEncrypted) {
        try {
          const decrypted = SecurityService.decryptSensitiveField(data.geminiApiKeyEncrypted);
          if (decrypted) return { apiKey: decrypted, isCustom: true };
        } catch (decryptErr) {
          console.warn("[resolveUserGeminiApiKey] Failed to decrypt user key:", decryptErr);
        }
      }
      if (data?.geminiApiKey) {
        return { apiKey: data.geminiApiKey, isCustom: true };
      }
    }
  } catch (err) {
    console.warn("[resolveUserGeminiApiKey] Error fetching user API key:", errorMessage(err));
  }
  return { apiKey: process.env.GEMINI_API_KEY || "", isCustom: false };
}

/** One request to the developer API, kept in memory for GET /api/v1/logs (the last 100). */
export interface ApiLog {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  /** Exact workspace context when known; do not infer from masked keys at read time. */
  workspaceId?: string;
  statusCode: number;
  latencyMs: number;
  apiKeyUsed: string;
  ip: string;
}

/** What route files moved out of server.ts need from buildApp(): its rate limiters and the API log. */
export interface ServerContext {
  apiLogs: ApiLog[];
  apiLimiter: express.RequestHandler;
  matchLimiter: express.RequestHandler;
  limiter: express.RequestHandler;
}

/**
 * The stored path of a file multer just saved, checked to lie inside the upload folder (code-scanning
 * alerts 11–19: the path comes from the request object, so prove it is multer's own temp file).
 */
export function uploadedFilePath(file: { path: string }): string {
  const root = path.resolve(UPLOAD_DIR) + path.sep;
  const resolved = path.resolve(file.path);
  if (!resolved.startsWith(root)) throw new Error("Upload is outside the upload folder");
  return resolved;
}
