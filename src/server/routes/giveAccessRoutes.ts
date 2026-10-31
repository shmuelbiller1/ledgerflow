import express from "express";
import { z } from "zod";
import { authenticate, requireAdmin, writeAuditLog, handleApiError, sendError } from "../http/serverKit";
import type { AuthenticatedRequest } from "../http/serverKit";
import { getDb } from "../db/firestore";
import type { Firestore } from "../db/firestore";
import { authAdmin } from "../auth/supabaseAuth";

/**
 * ACC-1 (owner, 13 Oct): "Give access". A platform admin types a person's email and picks a level; every
 * workspace that person owns gets it, each with an audit line. Optionally the person is made a platform admin.
 *   full   → free access with no limits (bypassBilling), on the Enterprise plan
 *   pro / growth → that plan, paid as usual (bypassBilling off)
 *   tester → free access with no limits, marked as a tester
 *   none   → back to the Free plan, free access taken away
 */
export const GiveAccessSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  level: z.enum(["full", "pro", "growth", "tester", "none"]),
  makeAdmin: z.boolean().optional(),
});
export type AccessLevel = z.infer<typeof GiveAccessSchema>["level"];

export function workspaceFieldsFor(level: AccessLevel): Record<string, unknown> {
  switch (level) {
    case "full": return { bypassBilling: true, plan: "enterprise", accessLevel: "full" };
    case "tester": return { bypassBilling: true, accessLevel: "tester" };
    case "pro": return { bypassBilling: false, plan: "pro", accessLevel: "pro" };
    case "growth": return { bypassBilling: false, plan: "growth", accessLevel: "growth" };
    case "none": return { bypassBilling: false, plan: "free", accessLevel: null };
  }
}

export async function giveAccess(
  db: Firestore,
  actor: { uid: string; email: string },
  target: { uid: string; email: string },
  input: { level: AccessLevel; makeAdmin?: boolean },
): Promise<{ workspaces: { id: string; name: string }[]; madeAdmin: boolean }> {
  // owners are the creator (uid) and anyone given the owner role (Codex on #460); ordinary members are left alone
  const [created, joined] = await Promise.all([
    db.collection("workspaces").where("uid", "==", target.uid).get(),
    db.collection("workspaces").where("members", "array-contains", target.uid).get(),
  ]);
  const ownedDocs = new Map(created.docs.map(d => [d.id, d]));
  for (const d of joined.docs) {
    const roles = d.data().roles as Record<string, unknown> | undefined;
    if (roles?.[target.uid] === "owner") ownedDocs.set(d.id, d);
  }
  const owned = { docs: [...ownedDocs.values()] };
  const fields = workspaceFieldsFor(input.level);
  const now = new Date().toISOString();
  const changed: { id: string; name: string }[] = [];
  for (const doc of owned.docs) {
    await db.runTransaction(async t => {
      const snap = await t.get(doc.ref);
      if (!snap.exists) return;
      const before = snap.data()!;
      const update = { ...fields, accessGivenBy: actor.email, accessGivenAt: now, updatedAt: now };
      t.update(doc.ref, update);
      await writeAuditLog(actor.uid, actor.email, "ADMIN_ACCESS_GIVEN",
        `Gave ${input.level} access to ${target.email}`, doc.id, before, { ...before, ...update }, t);
    });
    changed.push({ id: doc.id, name: String(doc.data().name || doc.id) });
  }
  let madeAdmin = false;
  if (input.makeAdmin) {
    await db.runTransaction(async t => {
      const ref = db.collection("users").doc(target.uid);
      const before = (await t.get(ref)).data() || {};
      t.set(ref, { role: "admin", updatedAt: now }, { merge: true });
      await writeAuditLog(actor.uid, actor.email, "ADMIN_USER_UPDATED",
        `Made ${target.email} a platform admin`, "system", before, { ...before, role: "admin" }, t);
    });
    madeAdmin = true;
  }
  return { workspaces: changed, madeAdmin };
}

export function registerGiveAccessRoutes(app: express.Express): void {
  app.post("/api/v1/admin/give-access", authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      const input = GiveAccessSchema.parse(req.body);
      const authReq = req as AuthenticatedRequest;
      let target: { uid: string; email: string };
      try {
        const user = await authAdmin.getUserByEmail(input.email);
        target = { uid: user.uid, email: input.email };
      } catch {
        return sendError(res, "No LedgerFlow account uses this email", 404);
      }
      // the admin claim is what requireAdmin reads, so it is set first; a failure is reported, not hidden (Codex on #460)
      let adminError: string | undefined;
      if (input.makeAdmin) {
        try { await authAdmin.setCustomUserClaims(target.uid, { admin: true }); }
        catch (err) { console.warn("[Give access] admin claim:", err); adminError = "Access was given, but the admin rights could not be set. Try again."; }
      }
      const result = await giveAccess(getDb(), { uid: authReq.user.uid, email: authReq.user.email || "" }, target, { ...input, makeAdmin: input.makeAdmin && !adminError });
      res.json({ status: "success", ...result, ...(adminError ? { adminError } : {}) });
    } catch (err) {
      handleApiError(res, err);
    }
  });
}
