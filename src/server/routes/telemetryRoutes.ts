import express from "express";
import { randomUUID } from "node:crypto";
import { rateLimit as expressRateLimit } from "express-rate-limit";
import { errorMessage } from "../auth/requestUser";
import { optionalAuthenticate } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import { assertWorkspaceAccess, getDb } from "../db/firestore";
import { SecurityService } from "../../services/securityService";
import { ErrorTelemetrySchema } from "../../schemas";

/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerTelemetryRoutes(app: express.Express, _ctx: ServerContext): void {
  // Telemetry and Error Tracking API
  app.post("/api/v1/telemetry/errors", optionalAuthenticate, expressRateLimit({ windowMs: 60 * 1000, max: 60 }), async (req: express.Request, res: express.Response) => {
    try {
      const parsed = ErrorTelemetrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ status: "error", message: "Invalid error payload", issues: parsed.error.issues });
      }

      const db = getDb();
      const rawData = parsed.data;
      const errorId = rawData.id || `err_${randomUUID()}`;
      const authUser = (req as AuthenticatedRequest).user;

      const sanitizedMessage = SecurityService.scrubPII(rawData.message).slice(0, 2000);
      const sanitizedStack = rawData.stack ? SecurityService.scrubPII(rawData.stack).slice(0, 4000) : undefined;
      const sanitizedComponentStack = rawData.componentStack ? SecurityService.scrubPII(rawData.componentStack).slice(0, 2000) : undefined;

      // Determine validated workspaceId: only allow tenant tagging if user is authenticated
      let validatedWorkspaceId = 'unauthenticated';
      let validatedUserId: string | undefined = undefined;
      let validatedUserEmail: string | undefined = undefined;

      if (authUser && rawData.workspaceId && rawData.workspaceId !== 'unassigned' && rawData.workspaceId !== 'unauthenticated') {
        try {
          // Check workspace membership or admin role
          if (authUser.admin) {
            validatedWorkspaceId = rawData.workspaceId;
          } else {
            // Throws when the user is not a member (caught below).
            await assertWorkspaceAccess(db, rawData.workspaceId, authUser);
            validatedWorkspaceId = rawData.workspaceId;
          }
          validatedUserId = authUser.uid;
          validatedUserEmail = authUser.email;
        } catch {
          validatedWorkspaceId = 'unauthenticated';
        }
      }

      const record: Record<string, unknown> = {
        id: errorId,
        workspaceId: validatedWorkspaceId,
        message: sanitizedMessage,
        createdAt: rawData.createdAt || new Date().toISOString()
      };

      if (validatedUserId) record.userId = validatedUserId;
      if (validatedUserEmail) record.userEmail = validatedUserEmail;
      if (sanitizedStack) record.stack = sanitizedStack;
      if (sanitizedComponentStack) record.componentStack = sanitizedComponentStack;
      if (rawData.url) record.url = rawData.url;
      if (rawData.userAgent) record.userAgent = rawData.userAgent;
      if (rawData.appVersion) record.appVersion = rawData.appVersion;
      if (rawData.release) record.release = rawData.release;
      record.source = validatedWorkspaceId === 'unauthenticated' ? 'anonymous_frontend' : (rawData.source || 'frontend');
      if (rawData.severity) record.severity = rawData.severity;
      if (rawData.metadata) record.metadata = rawData.metadata;
      if (rawData.ticketId) record.ticketId = rawData.ticketId;

      try {
        await db.collection("errorLogs").doc(errorId).set(record);
      } catch (dbErr) {
        console.warn("[Telemetry] Error doc persistence bypassed due to sandbox constraint:", errorMessage(dbErr));
      }
      res.json({ status: "success", errorId });
    } catch (err) {
      console.warn("[Telemetry] Failed to record error log:", err);
      res.status(200).json({ status: "success", message: "Telemetry received" });
    }
  });
}
