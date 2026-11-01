import type express from "express";
import crypto from "crypto";
import { logContext, logger, type LogContext } from "../utils/logger";
import { requestWorkspaceId } from "./apiRequestLog";

const INCOMING_ID = /^[A-Za-z0-9_.-]{8,128}$/;

/**
 * The route pattern (`/api/v1/workspaces/:workspaceId/...`) once Express has matched one. Before that, or for a
 * path no route matches, a fixed label: the raw path could carry an email or other personal text.
 */
function routeOf(req: express.Request): string {
  const pattern = req.route?.path;
  return typeof pattern === 'string' ? `${req.baseUrl || ''}${pattern}` : UNMATCHED_ROUTE;
}

export const UNMATCHED_ROUTE = '(unmatched)';

/**
 * D-21 / BN-01: gives every request an id (a caller's own `x-request-id` when it is a plain token,
 * otherwise a new one), returns it in the `x-request-id` header, and runs the rest of the request
 * inside that log context so every `logger` line written meanwhile carries it (with the matched
 * route pattern and workspace, read when the line is written). Each /api request, finished or cut off,
 * ends with one JSON access line: method, route, workspace, status and time taken — no query
 * values, bodies or personal data.
 */
export function requestContext(): express.RequestHandler {
  return (req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && INCOMING_ID.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('x-request-id', requestId);
    // route and workspace are read when a line is written, so a handler's own log lines get the matched
    // route pattern and the signed-in workspace too, not only the access line at the end
    const context = { requestId, method: req.method } as LogContext;
    Object.defineProperty(context, 'route', { enumerable: true, get: () => routeOf(req) });
    Object.defineProperty(context, 'workspaceId', { enumerable: true, get: () => requestWorkspaceId(req) });
    const start = process.hrtime.bigint();
    let logged = false;
    const accessLine = () => {
      if (logged) return;
      logged = true;
      if (!(req.originalUrl || req.url || '').startsWith('/api')) return;
      const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
      // a client that went away before the response was complete still gets its line (as morgan did)
      const fields = res.writableFinished ? { status: res.statusCode, ms } : { status: res.statusCode, ms, aborted: true };
      logger.info('request', fields, context);
    };
    res.on('finish', accessLine);
    res.on('close', accessLine);
    logContext.run(context, next);
  };
}
