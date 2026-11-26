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
import { errorMessage, requestUser } from "../auth/requestUser";
import { LEDGER_WRITER_ROLES, roleInWorkspace } from "../middleware/requireLedgerWriter";
import { assertDeveloperUsageQuota } from "../services/developerUsageQuota";
import { writeServerAuditLog } from "../services/auditLogService";
import { SecurityService } from "../../services/securityService";
import { assertWorkspaceAccess, getDb } from "../db/firestore";
import type { DocumentData, Transaction } from "../db/firestore";
import { verifyIdToken } from "../auth/supabaseAuth";
import type { DecodedIdToken } from "../auth/supabaseAuth";
import { logSafe, logSafeDetail } from '../utils/logSafe';

// one copy of the workspace-time-zone date lives in utils/formatTzDate.ts; re-exported for the route files
export { formatTzDate } from '../utils/formatTzDate';

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
    fileSize: 8_000_000, // 8 MB limit; keep uploads at Sonar's recommended maximum
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
/** #914: a guard's refusal ("FORBIDDEN…", "PAYMENT_REQUIRED…") is a 403/402, never a server fault. */
const FORBIDDEN_MESSAGE = /^(?:FORBIDDEN|PERMISSION_DENIED)\b|^Unauthorized: (?:You are not a member of this workspace|API key is scoped strictly to workspace)/;
export function isForbidden(message: string | undefined): boolean {
  return typeof message === 'string' && FORBIDDEN_MESSAGE.test(message);
}

export function refusalStatus(message: string | undefined): 402 | 403 | undefined {
  if (isForbidden(message)) return 403;
  if (typeof message === 'string' && /^PAYMENT_REQUIRED\b/.test(message)) return 402;
  return undefined;
}

export function sendError(res: express.Response, message: string, status: number = 500, details?: unknown) {
  // routes often pass a generic headline and the thrown message as `details`: classify either
  const refused = status >= 500 ? refusalStatus(message) ?? refusalStatus(typeof details === 'string' ? details : undefined) : undefined;
  if (refused) {
    // the guard's own wording stays in the log; the caller gets the status and a plain reason
    console.warn("[API Refusal] %s: %s (Path: %s)", refused, logSafe(message), logSafe(res.req?.originalUrl || "unknown"), logSafeDetail(details));
    res.status(refused).json({ status: "error", message: refused === 403 ? "Forbidden" : "Payment required: the workspace's compute credits are used up." });
    return;
  }
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
  // "not a member" is a refusal, not a server fault (AUD-09 step 3: a non-member revoking an API key got 500)
  if (message.includes("FORBIDDEN") || message.includes("PERMISSION_DENIED") || /not a member/i.test(message) || code === 7) {
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
  // AUP-27: a spending or credit limit is the caller's to fix (429 / 402, as the named commands answer), not a 500
  if (code === 'QUOTA_EXCEEDED' || message.startsWith('QUOTA_EXCEEDED')) return sendError(res, message, 429);
  if (code === 'PAYMENT_REQUIRED' || message.startsWith('PAYMENT_REQUIRED')) return sendError(res, message, 402);

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

      if (isCreditSensitive) await assertDeveloperUsageQuota(db, workspaceId, data);
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
 * The AI and diagnostics reads all start the same way: the workspace in `?workspaceId` (or the one
 * the API key belongs to), authorized, with its chart of accounts and its entries. One helper keeps
 * those reads from loading the ledger three different ways.
 */
export type QueriedWorkspaceLedger =
  | { error: string }
  | { workspaceId: string; db: ReturnType<typeof getDb>; accounts: ChartAccount[]; transactions: LedgerTransaction[] };

export async function loadQueriedWorkspaceLedger(
  req: express.Request,
  missingWorkspaceMessage = 'Missing workspaceId query parameter',
): Promise<QueriedWorkspaceLedger> {
  const workspaceId = (req.query.workspaceId as string) || requestUser(req).developerWorkspaceId;
  if (!workspaceId) return { error: missingWorkspaceMessage };

  await authorizeWorkspace(req as AuthenticatedRequest, workspaceId);

  const db = getDb();
  const [accountsSnap, transactionsSnap] = await Promise.all([
    db.collection('chartAccounts').where('workspaceId', '==', workspaceId).get(),
    db.collection('transactions').where('workspaceId', '==', workspaceId).get(),
  ]);
  return {
    workspaceId,
    db,
    accounts: accountsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as ChartAccount),
    transactions: transactionsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as LedgerTransaction),
  };
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
 * Same row as `writeAuditLog`, but a failure throws: for privilege changes, where an unlogged change must roll back (#826).
 */
export async function writeAuditLogStrict(
  userId: string, email: string, action: string, details: string, workspaceId: string,
  before: unknown, after: unknown, transaction: Transaction,
) {
  await writeServerAuditLog({
    workspaceId, uid: userId, email, action, entityType: 'system', entityId: workspaceId,
    details: { description: details, before: before || null, after: after || null },
  }, { db: getDb(), tx: transaction });
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
