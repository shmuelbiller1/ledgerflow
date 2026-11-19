import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import { supabaseUrl } from "../auth/supabaseAuth";
import { isAiStudioProxy } from "./origins";
import { requestContext } from "./requestContext";
import {
  APP_INLINE_SCRIPT_HASHES, CSP_REPORT_PATH, configuredSupabaseConnectSources, connectSources,
  cspRollout, helmetDirectives, tightenedCspDirectives, tightenedCspHeaderValue,
} from "./contentSecurityPolicy";

/** CORS, proxy trust, compression, security headers and request logging (F-01, moved from server.ts). */
export function applySecurityMiddleware(app: express.Express, isAllowedOrigin: (origin: string) => boolean): void {
  const aiStudioProxy = isAiStudioProxy();
  const rollout = cspRollout();
  const tightened = {
    supabaseSources: configuredSupabaseConnectSources(process.env, supabaseUrl()),
    inlineScriptHashes: APP_INLINE_SCRIPT_HASHES,
    frameAncestors: aiStudioProxy ? ["*"] : ["'self'"],
  };
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true
  }));

  // Efficiency & Security Middleware
  app.set("trust proxy", 1); 
  app.use(compression());
  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
      // S-23 stage three: once the report-only summary is empty, CSP_TIGHTEN=enforce makes the
      // tightened policy the one the browser obeys (no 'unsafe-inline' script, form-action 'self').
      // It keeps reporting, so a directive that turns out to block something still says so.
      directives: rollout === 'enforce'
        ? helmetDirectives(tightenedCspDirectives({ ...tightened, reportUri: CSP_REPORT_PATH })) : {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.plaid.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        // The configured Supabase project(s): data/auth (https) and live updates (wss) — AUD-12
        connectSrc: connectSources(configuredSupabaseConnectSources(process.env, supabaseUrl())),
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        frameSrc: ["'self'", "https://*.stripe.com", "https://cdn.plaid.com"],
        frameAncestors: aiStudioProxy ? ["*"] : ["'self'"]
      }
    } : false,
    crossOriginEmbedderPolicy: false,
    frameguard: aiStudioProxy ? false : { action: 'sameorigin' },
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permissionsPolicy: {
      features: {
        camera: ["'none'"],
        microphone: ["'none'"],
        geolocation: ["'none'"],
        usb: ["'none'"],
        payment: ["'self'"],
      },
    },
  }));

  // Permissions-Policy is not covered by vercel.json for the standalone Node server (API) — emit it here too
  app.use((_req, res, next) => {
    if (!res.headersSent && !res.getHeader('Permissions-Policy')) {
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=(), payment=(self)');
    }
    next();
  });

  // S-23 stage two: the tightened policy alongside the enforced one, so the browser reports what it
  // would have blocked (cspReportRoutes.ts) without a single page breaking while it is still allowed.
  if (rollout === 'report-only') {
    const reportOnly = tightenedCspHeaderValue({ ...tightened, reportUri: CSP_REPORT_PATH });
    app.use((_req, res, next) => {
      res.setHeader('Content-Security-Policy-Report-Only', reportOnly);
      next();
    });
  }
  // D-21: request id + one JSON access line per /api request (replaces the morgan text line).
  app.use(requestContext());
}

/** Explicit bulk import and backup-restore routes allowed up to 50 MB JSON; file-ingestion AI routes cap at 15 MB; all other routes cap at 1 MB (M-8). */
export const LARGE_JSON_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/api\/v1\/workspaces\/[^/]+\/restore\/?$/,
  /^\/api\/v1\/workspaces\/[^/]+\/import-records\/?$/,
  /^\/api\/v1\/workspaces\/[^/]+\/pay-runs\/imports(?:\/|$)/,
  /^\/api\/v1\/commands\/payroll\.import(?:\/preview)?\/?$/,
  /^\/api\/v1\/open-items(?:\/|$)/,
  /^\/api\/v1\/transactions\/(?:bulk|batch|batch-create)\/?$/,
];

export const INGEST_JSON_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/api\/(?:v1\/)?ai\/(?:process|receipt|parse|vision|ocr)(?:\/|$)/,
  /^\/api\/(?:v1\/)?workspaces\/[^/]+\/documents(?:\/|$)/,
];

export function isLargeJsonRoute(method: string, pathOnly: string): boolean {
  if (method !== "POST" && method !== "PUT") return false;
  return LARGE_JSON_ROUTE_PATTERNS.some((pattern) => pattern.test(pathOnly));
}

export function isIngestJsonRoute(method: string, pathOnly: string): boolean {
  if (method !== "POST" && method !== "PUT") return false;
  return INGEST_JSON_ROUTE_PATTERNS.some((pattern) => pattern.test(pathOnly));
}

function containsNullByte(root: unknown): boolean {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      if (current.includes("\0")) return true;
    } else if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i += 1) stack.push(current[i]);
    } else if (current !== null && typeof current === "object") {
      for (const [k, v] of Object.entries(current)) {
        if (k.includes("\0")) return true;
        stack.push(v);
      }
    }
  }
  return false;
}

export function applyJsonBodyParser(app: express.Express): void {
  const defaultJson = express.json({ limit: "1mb" });
  const ingestJson = express.json({ limit: "15mb" });
  const bulkJson = express.json({ limit: "50mb" });
  app.use((req, res, next) => {
    const pathOnly = (req.originalUrl || req.url || "").split("?")[0];
    const parser = isLargeJsonRoute(req.method, pathOnly)
      ? bulkJson
      : isIngestJsonRoute(req.method, pathOnly)
        ? ingestJson
        : defaultJson;
    parser(req, res, (err) => {
      if (err) {
        const status = typeof (err as { status?: unknown }).status === "number"
          ? (err as { status: number }).status
          : typeof (err as { statusCode?: unknown }).statusCode === "number"
            ? (err as { statusCode: number }).statusCode
            : 400;
        const message = status === 413
          ? "Request body exceeds the maximum allowed payload size."
          : "Malformed JSON request body.";
        return res.status(status).json({ status: "error", error: message, message });
      }
      req.body ??= {};
      if (containsNullByte(req.body)) {
        const message = "Request body must not contain NUL bytes.";
        return res.status(400).json({ status: "error", error: message, message });
      }
      next();
    });
  });
}
