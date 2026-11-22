import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, handleApiError, requireAdmin, type AuthenticatedRequest } from '../http/serverKit';
import { writeServerAuditLog } from '../services/auditLogService';
import { CSP_REPORT_PATH, cspRollout } from '../http/contentSecurityPolicy';
import { cspViolationSummary, parseCspReport, recordCspViolation, resetCspViolations } from '../http/cspViolations';

/**
 * S-23: where the browser posts what the tightened Content-Security-Policy would have blocked.
 *
 * - `POST /api/csp-report` — the browser's own report. No sign-in (a browser cannot authenticate a
 *   report) and no CSRF token (it is sent by the user agent, not by the app), so it is registered
 *   before those layers in server.ts and given its own limit, its own 16 kB body limit and its own
 *   content types. It only increments counters held in memory (cspViolations.ts).
 * - `GET /api/csp-report/summary` — platform admins read the groups back and decide whether the
 *   policy is safe to enforce (`CSP_TIGHTEN=enforce`).
 * - `DELETE /api/csp-report/summary` — start counting again after a fix.
 */

/** A browser reports once per blocked resource; a page with many is still one visitor. */
const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  // The report says nothing to the sender, so a blocked one is dropped rather than answered.
  handler: (_req, res) => { res.status(204).end(); },
});

/** The summary is a cheap read, but an authorization check is still work done per request. */
const summaryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Try again later.' },
});

/** Browsers use application/csp-report; the Reporting API uses application/reports+json. */
const reportBody = express.json({
  type: ['application/csp-report', 'application/reports+json', 'application/json'],
  limit: '16kb',
  // A malformed body is a 204 below, not a 500 from the parser.
  strict: false,
});

/**
 * A body that will not parse, or is over the limit, still answers 204: the browser has nowhere to
 * put an error, and a 400 would only tell a prober which bodies the parser accepts.
 */
const acceptUnreadableBody: express.ErrorRequestHandler = (_error, _req, res, _next) => {
  if (!res.headersSent) res.status(204).end();
};

/** One posted body can hold a single report or a Reporting API batch. */
function reportsIn(body: unknown): unknown[] {
  return Array.isArray(body) ? body.slice(0, 20) : [body];
}

export function registerCspReportRoutes(app: express.Express): void {
  app.post(CSP_REPORT_PATH, reportLimiter, reportBody, acceptUnreadableBody, (req: express.Request, res: express.Response) => {
    // 204 whatever happens: a report is one-way, and telling a prober which bodies parse is free help.
    res.status(204).end();
    if (cspRollout() === 'off') return;
    for (const entry of reportsIn(req.body)) {
      const violation = parseCspReport(entry);
      if (violation) recordCspViolation(violation);
    }
  });

  app.get(`${CSP_REPORT_PATH}/summary`, summaryLimiter, authenticate, requireAdmin, (_req, res) => {
    res.json({ rollout: cspRollout(), ...cspViolationSummary() });
  });

  app.delete(`${CSP_REPORT_PATH}/summary`, summaryLimiter, authenticate, requireAdmin, async (req, res) => {
    // #943: clearing the evidence is an admin action, recorded first; if it cannot be recorded, nothing is cleared
    const user = (req as AuthenticatedRequest).user;
    try {
      await writeServerAuditLog({ workspaceId: 'system', uid: user.uid, email: user.email ?? '', action: 'ADMIN_CSP_REPORTS_CLEARED',
        entityType: 'system', entityId: 'system', details: { description: 'Cleared the CSP violation summary', before: cspViolationSummary(), after: null } });
    } catch (err) {
      return handleApiError(res, err);
    }
    resetCspViolations();
    res.json({ status: 'ok', ...cspViolationSummary() });
  });
}
