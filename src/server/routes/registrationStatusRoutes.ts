import express from "express";
import { globalAdminConfig, refreshGlobalAdminConfigIfStale } from "../http/serverKit";
import type { ServerContext } from "../http/serverKit";
import { getDb } from "../db/firestore";
import { verifyIdToken } from "../auth/supabaseAuth";

/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerRegistrationStatusRoutes(app: express.Express, _ctx: ServerContext): void {
  app.get("/api/v1/public/registration-status", async (req, res) => {
    try {
      const db = getDb();
      let isAuthenticated = false;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const idToken = authHeader.split('Bearer ')[1];
        try {
          await verifyIdToken(idToken);
          isAuthenticated = true;
        } catch {
          // Token invalid or expired
        }
      }

      await refreshGlobalAdminConfigIfStale(); // AUP-05: the limit an admin set, not the one this instance booted with
      let totalUsers: number | undefined = undefined;
      const limit = globalAdminConfig.maxRegistrationLimit !== undefined ? globalAdminConfig.maxRegistrationLimit : 100;
      let registrationAllowed = true;

      try {
        const usersSnap = await db.collection("users").count().get();
        const userCount = usersSnap.data().count;
        if (isAuthenticated) {
          totalUsers = userCount;
        }
        registrationAllowed = userCount < limit;
      } catch {
        // DB fallback
      }

      const payload: Record<string, unknown> = {
        status: "success",
        maxRegistrationLimit: limit,
        registrationAllowed,
        freeWorkspaceTxCap: globalAdminConfig.freeWorkspaceTxCap !== undefined ? globalAdminConfig.freeWorkspaceTxCap : 100
      };

      if (isAuthenticated && totalUsers !== undefined) {
        payload.totalUsers = totalUsers;
      }

      res.json(payload);
    } catch {
      res.json({
        status: "success",
        maxRegistrationLimit: globalAdminConfig.maxRegistrationLimit || 100,
        registrationAllowed: true,
        freeWorkspaceTxCap: globalAdminConfig.freeWorkspaceTxCap || 100
      });
    }
  });
}
