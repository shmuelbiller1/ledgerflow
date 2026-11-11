import express from "express";
import { errorMessage, requestUser } from "../auth/requestUser";
import { apiAuthenticate } from "../auth/apiAuthenticate";
import { authorizeWorkspace, sendError } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";

import { BRAND_NAME } from '../../config/brand';
/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerApiStatusRoutes(app: express.Express, _ctx: ServerContext): void {
  // Endpoints v1
  app.get("/api/v1/status", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.query.workspaceId as string) || requestUser(req).developerWorkspaceId;
      if (!workspaceId) return sendError(res, "Missing workspaceId parameters in query", 400);

      const authReq = req as AuthenticatedRequest;
      const wsData = await authorizeWorkspace(authReq, workspaceId);

      const wsName = wsData?.name || "Production Workspace";
      const wsCurrency = wsData?.currency || "USD";
      const wsLockDate: string | null = wsData?.lockDate || null;
      const wsBusinessType = wsData?.businessType || "enterprise";

      res.json({
        status: "active",
        service: `${BRAND_NAME} Deep API Engine`,
        workspaceId,
        metadata: {
          name: wsName,
          currency: wsCurrency,
          lockDate: wsLockDate,
          businessType: wsBusinessType
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      sendError(res, errorMessage(err), 500);
    }
  });
}
