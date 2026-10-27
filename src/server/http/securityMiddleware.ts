import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import morgan from "morgan";
import { supabaseUrl } from "../auth/supabaseAuth";
import { isAiStudioProxy } from "./origins";
import { safeRequestTarget } from "./safeRequestTarget";
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
    contentSecurityPolicy: {
      // S-23 stage three: once the report-only summary is empty, CSP_TIGHTEN=enforce makes the
      // tightened policy the one the browser obeys (no 'unsafe-inline' script, form-action 'self').
      // It keeps reporting, so a directive that turns out to block something still says so.
      directives: process.env.NODE_ENV === 'production' && rollout === 'enforce'
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
    },
    crossOriginEmbedderPolicy: false,
    frameguard: aiStudioProxy ? { action: 'allow-from' } : { action: 'sameorigin' },
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  // S-23 stage two: the tightened policy alongside the enforced one, so the browser reports what it
  // would have blocked (cspReportRoutes.ts) without a single page breaking while it is still allowed.
  if (rollout === 'report-only') {
    const reportOnly = tightenedCspHeaderValue({ ...tightened, reportUri: CSP_REPORT_PATH });
    app.use((_req, res, next) => {
      res.setHeader('Content-Security-Policy-Report-Only', reportOnly);
      next();
    });
  }
  // The default :url token includes query parameters, which may contain credentials.
  morgan.token("safe-url", req => safeRequestTarget(req.url || '/'));
  app.use(morgan(":method :safe-url :status :res[content-length] - :response-time ms", {
    skip: (req) => !req.url || !req.url.startsWith("/api")
  }));
}
