import { registerWorkspaceApiRoutes } from "./src/server/routes/workspaceApiRoutes.ts";
import { registerDeveloperApiRoutes } from "./src/server/routes/developerApiRoutes.ts";
import { registerApiKeysRoutes } from "./src/server/routes/apiKeysRoutes.ts";
import { registerMetricsAuditRoutes } from "./src/server/routes/metricsAuditRoutes.ts";
import { registerBrainRoutes } from "./src/server/routes/brainRoutes.ts";
import { registerAdminRoutes } from "./src/server/routes/adminRoutes.ts";
import { registerLogsUploadRoutes } from "./src/server/routes/logsUploadRoutes.ts";
import { registerLabelingRoutes } from "./src/server/routes/labelingRoutes.ts";
import { registerAuthRoutes } from "./src/server/routes/authRoutes.ts";
import { registerCspReportRoutes } from "./src/server/routes/cspReportRoutes.ts";
import { registerStripeWebhookRoutes } from "./src/server/routes/stripeWebhookRoutes.ts";
import { registerLedgerMatchRoutes } from "./src/server/routes/ledgerMatchRoutes.ts";
import { registerTelemetryRoutes } from "./src/server/routes/telemetryRoutes.ts";
import { registerRegistrationStatusRoutes } from "./src/server/routes/registrationStatusRoutes.ts";
import { registerApiStatusRoutes } from "./src/server/routes/apiStatusRoutes.ts";
import { syncGlobalAdminConfig, authenticate } from "./src/server/http/serverKit.ts";
import type { ApiLog, ServerContext } from "./src/server/http/serverKit.ts";
import { apiAuthenticate } from "./src/server/auth/apiAuthenticate.ts";
import { fxRouter } from "./src/server/routes/fxRoutes";
import { aiRouter } from "./src/server/routes/aiRoutes";
import { reportRouter, balanceRouter } from "./src/server/routes/reportRoutes";
import { accountRouter } from "./src/server/routes/accountRoutes";
import { workspaceRouter } from "./src/server/routes/workspaceRoutes";
import { invitePublicRouter } from "./src/server/routes/invitePublicRoutes";
import { emailWebhookRouter } from "./src/server/routes/emailRoutes";
import { publicInvoiceRouter } from "./src/server/routes/publicInvoiceRoutes";
import { transactionRouter } from "./src/server/routes/transactionRoutes";
import { revenueRouter } from "./src/server/routes/revenueRoutes";
import { consolidationRouter } from "./src/server/routes/consolidationRoutes";
import { leaseRouter } from "./src/server/routes/leaseRoutes";
import { inventoryRouter } from "./src/server/routes/inventoryRoutes";
import { supportRouter } from "./src/server/routes/supportRoutes";
import { paymentRouter } from "./src/server/routes/paymentRoutes";
import { documentRouter } from "./src/server/routes/documentRoutes";
import { mathRouter } from "./src/server/routes/mathRoutes";
import { plaidRouter } from "./src/server/routes/plaidRoutes";
import { billingRouter } from "./src/server/routes/billingRoutes";
import { getStripe } from "./src/server/services/stripeService";
export { getStripe };
import express from "express";
import { currencyRouter, taxDataRouter } from "./src/server/routes/externalDataRoutes.ts";
import { cronRouter, CRON_MOUNT } from "./src/server/routes/cronRoutes.ts";
import { statusRouter } from "./src/server/routes/statusRoutes.ts";
import { csrfProtection } from "./src/server/middleware/csrf.ts";
import { loadServerEnv } from "./src/server/config/env.ts";
import { createOriginCheck, resolvePort } from "./src/server/http/origins.ts";
import { applySecurityMiddleware } from "./src/server/http/securityMiddleware.ts";
import { apiRequestLogger } from "./src/server/http/apiRequestLog.ts";
import { publicInvoiceLimiter, pdfGenerationLimiter, brainRateLimiter, createAppRateLimiters } from "./src/server/middleware/rateLimiters.ts";

declare const __SERVERLESS_BUILD__: boolean | undefined;

loadServerEnv();

/**
 * The API: middleware, then every route in a fixed order (order matters: the first match answers).
 * Route code lives in src/server/routes/ (registerXRoutes files add routes to the app directly;
 * xRouter files are mounted under a path below).
 */
async function buildApp(): Promise<{ app: express.Express; port: number }> {
  const app = express();
  const isAllowedOrigin = createOriginCheck();
  const PORT = resolvePort();
  const { limiter, matchLimiter, apiLimiter } = createAppRateLimiters();
  const apiLogs: ApiLog[] = [];
  // what the route files registered below need from here
  const routeContext: ServerContext = { apiLogs, apiLimiter, matchLimiter, limiter };

  applySecurityMiddleware(app, isAllowedOrigin);

  // Stripe Webhook needs raw body
  registerStripeWebhookRoutes(app, routeContext);

  // S-23: the browser's own Content-Security-Policy reports — before the API limit, CSRF and the
  // 50 mb JSON parser, because the user agent sends them with no token and its own content type.
  registerCspReportRoutes(app);

  // Stripe receives its raw body first; other API traffic is checked before JSON parsing.
  app.use("/api/", limiter);
  app.use("/api/v1/brain", brainRateLimiter);
  app.use("/api/v1/documents", pdfGenerationLimiter);
  // Only email callbacks bypass CSRF; their router verifies the provider credential.
  app.use(csrfProtection({ isAllowedOrigin, ignoredPaths: [/^\/api\/v1\/email-events\/?$/] }));
  app.use(express.json({ limit: "50mb" })); // Bulk JSON/restore support; narrow per-route limits are tracked separately.
  app.use((req, _res, next) => { req.body ??= {}; next(); }); // Express 5 leaves req.body undefined without a body

  // Secure Server-Side Transaction Matching Engine API
  registerLedgerMatchRoutes(app, routeContext);

  // Telemetry and Error Tracking API
  registerTelemetryRoutes(app, routeContext);

  app.use("/api", statusRouter);

  registerRegistrationStatusRoutes(app, routeContext);

  // --- Developer Hub: request log for the API platform ---
  app.use("/api/v1/", apiLimiter, apiRequestLogger(apiLogs));

  // Endpoints v1
  registerApiStatusRoutes(app, routeContext);

  // --- INTEGRITY ENGINE MATH API ---
  app.use("/api/v1/math", apiAuthenticate, mathRouter);

  registerWorkspaceApiRoutes(app, routeContext);

  registerDeveloperApiRoutes(app, routeContext);
  registerApiKeysRoutes(app, routeContext);

  registerMetricsAuditRoutes(app, routeContext);

  registerBrainRoutes(app, routeContext);

  registerAdminRoutes(app, routeContext);

  // --- Corporate Billing and Compute Metering Endpoints ---
  app.use("/api/v1/billing", apiAuthenticate, billingRouter);

  registerLogsUploadRoutes(app, routeContext);

  // Currency rates and tax-rate lookups (apilayer.com, cached)
  app.use("/api/v1/currency", authenticate, currencyRouter);
  app.use("/api/v1/tax", authenticate, taxDataRouter);

  // --- Plaid Integration ---
  app.use("/api/v1/plaid", authenticate, plaidRouter);

  app.use("/api/reports", authenticate, reportRouter);
  app.use("/api/v1/balances", apiAuthenticate, balanceRouter); // L-123 step 3; /api/v1/reports is mounted once, with apiAuthenticate (signed-in users and API keys), below

  registerLabelingRoutes(app, routeContext);
  registerAuthRoutes(app, routeContext);

  // Mount kernel routes
  app.use("/api/v1/reports", apiAuthenticate, reportRouter);
  app.use("/api/v1/workspaces", apiAuthenticate, workspaceRouter);
  app.use("/api/v1/account", apiAuthenticate, accountRouter);
  app.use("/api/v1/transactions", apiAuthenticate, transactionRouter);
  app.use("/api/v1/revenue", apiAuthenticate, revenueRouter);
  app.use("/api/v1/consolidation", apiAuthenticate, consolidationRouter);
  app.use("/api/v1/lease", apiAuthenticate, leaseRouter);
  app.use("/api/v1/inventory", apiAuthenticate, inventoryRouter).use("/api/v1/repost", apiAuthenticate, (await import("./src/server/routes/repostRoutes")).repostRouter);
  app.use("/api/v1/fx", apiAuthenticate, fxRouter);
  app.use("/api/v1/support", authenticate, supportRouter);
  app.use("/api/v1/payments", apiAuthenticate, paymentRouter);
  app.use("/api/v1/documents", apiAuthenticate, documentRouter).use("/api/v1/open-items", apiAuthenticate, (await import("./src/server/routes/openItemImportRoutes")).openItemImportRouter); // EG-14
  app.use("/api/v1/invoices/public", publicInvoiceLimiter, publicInvoiceRouter);
  app.use("/api/v1/email-events", emailWebhookRouter); // provider bounce/complaint reports (secret token)
  app.use("/api/ai", aiRouter);
  app.use("/api/v1/ai", aiRouter);
  app.use("/api/v1/invites", invitePublicRouter);

  // Scheduled jobs (Vercel Cron calls them with CRON_SECRET; a standalone server runs the same list on its own timer)
  app.use(CRON_MOUNT, cronRouter);

  // API 404 handler for unmatched /api/* routes
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.originalUrl}` });
  });

  await syncGlobalAdminConfig();
  return { app, port: PORT };
}

/** The Express app with every API route; the Vercel function (api/index.mjs) serves it. */
export async function createApp(): Promise<express.Express> {
  return (await buildApp()).app;
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [Server] Unhandled Promise Rejection caught at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('💥 [Server] Uncaught Exception caught:', error);
  process.exit(1);
});

// On Vercel, api/index.mjs imports build/api.cjs (createApp) instead of starting a listener/scheduler.
if (typeof __SERVERLESS_BUILD__ === "undefined" && process.env.NODE_ENV !== "test" && !process.env.VERCEL) {
  console.debug("🌀 [Server] Booting LedgerFlow Backend...");
  Promise.all([buildApp(), import("./src/server/http/serveApp.ts")]).then(([{ app, port }, { serveApp }]) => serveApp(app, port)).catch(err => {
    console.error("💥 [Server] Critical Startup Failure:", err);
    process.exit(1);
  });
}
