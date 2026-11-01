import type express from "express";
import crypto from "crypto";
import { logContext, logger, type LogContext } from "../utils/logger";
import { safeRequestTarget } from "./safeRequestTarget";
import { requestWorkspaceId } from "./apiRequestLog";

const INCOMING_ID = /^[A-Za-z0-9_.-]{8,128}$/;

/** The route pattern (`/api/v1/workspaces/:workspaceId/...`) once Express has matched one, else the safe path. */
function routeOf(req: express.Request): string {
  const pattern = req.route?.path;
  return typeof pattern === 'string' ? `${req.baseUrl || ''}${pattern}` : safeRequestTarget(req.originalUrl || req.url || '/');
}

/**
 * D-21 / BN-01: gives every request an id (a caller's own `x-request-id` when it is a plain token,
 * otherwise a new one), returns it in the `x-request-id` header, and runs the rest of the request
 * inside that log context so every `logger` line written meanwhile carries it. Each /api request
 * ends with one JSON access line: method, route, workspace, status and time taken — no query
 * values, bodies or personal data.
 */
export function requestContext(): express.RequestHandler {
  return (req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && INCOMING_ID.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('x-request-id', requestId);
    const context: LogContext = { requestId, method: req.method, route: safeRequestTarget(req.originalUrl || req.url || '/') };
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (!(req.originalUrl || req.url || '').startsWith('/api')) return;
      context.route = routeOf(req);
      context.workspaceId = requestWorkspaceId(req);
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('request', { status: res.statusCode, ms: Math.round(ms * 10) / 10 }, context);
    });
    logContext.run(context, next);
  };
}
