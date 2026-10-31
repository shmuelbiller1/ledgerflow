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
 *   tester → free access with no limits (the audit line says "tester")
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
    case "full": return { bypassBilling: true, plan: "enterprise" };
    case "tester": return { bypassBilling: true };
    case "pro": return { bypassBilling: false, plan: "pro" };
    case "growth": return { bypassBilling: false, plan: "growth" };
    case "none": return { bypassBilling: false, plan: "free" };
  }
}

export async function giveAccess(
  db: Firestore,
  actor: { uid: string; email: string },
  target: { uid: string; email: string },
  input: { level: AccessLevel; makeAdmin?: boolean },
): Promise<{ workspaces: { id: string; name: string }[]; madeAdmin: boolean; stillBilled: string[] }> {
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
  const stillBilled: string[] = [];
  // one transaction: every workspace and the admin role change together, or none do (CodeRabbit on #460)
  await db.runTransaction(async t => {
    const userRef = db.collection("users").doc(target.uid);
    const userBefore = input.makeAdmin ? (await t.get(userRef)).data() || {} : {};
    const snaps = await Promise.all(owned.docs.map(doc => t.get(doc.ref)));
    changed.length = 0;
    stillBilled.length = 0;
    for (const [i, snap] of snaps.entries()) {
      if (!snap.exists) continue;
      const doc = owned.docs[i];
      const before = snap.data()!;
      // only fields the database rules already know (lf_guard, Codex on #460); who and when are in the audit line
      const update = { ...fields, updatedAt: now };
      t.update(doc.ref, update);
      await writeAuditLog(actor.uid, actor.email, "ADMIN_ACCESS_GIVEN",
        `Gave ${input.level} access to ${target.email}`, doc.id, before, { ...before, ...update }, t);
      changed.push({ id: doc.id, name: String(before.name || doc.id) });
      // a paid Stripe subscription is not cancelled here: free access is reported as still billed (Codex on #460)
      if (fields.bypassBilling === true && before.stripeSubscriptionId) stillBilled.push(String(before.name || doc.id));
    }
    if (input.makeAdmin) {
      t.set(userRef, { role: "admin", updatedAt: now }, { merge: true });
      await writeAuditLog(actor.uid, actor.email, "ADMIN_USER_UPDATED",
        `Made ${target.email} a platform admin`, "system", userBefore, { ...userBefore, role: "admin" }, t);
    }
  });
  return { workspaces: changed, madeAdmin: !!input.makeAdmin, stillBilled };
}

export function registerGiveAccessRoutes(app: express.Express): void {
  app.post("/api/v1/admin/give-access", authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
      const input = GiveAccessSchema.parse(req.body);
      const authReq = req as AuthenticatedRequest;
      let target: { uid: string; email: string };
      let previousClaims: Record<string, unknown> = {};
      try {
        const user = await authAdmin.getUserByEmail(input.email);
        target = { uid: user.uid, email: input.email };
        previousClaims = user.customClaims || {};
      } catch (err) {
        // only "no such account" is a 404; a lookup that fails for another reason goes to the error handler (CodeRabbit on #460)
        if ((err as { code?: string })?.code === "auth/user-not-found") return sendError(res, "No LedgerFlow account uses this email", 404);
        throw err;
      }
      // the admin claim is what requireAdmin reads, so it is set first; a failure is reported, not hidden (Codex on #460)
      let adminError: string | undefined;
      if (input.makeAdmin) {
        try { await authAdmin.setCustomUserClaims(target.uid, { ...previousClaims, admin: true }); }
        catch (err) { console.warn("[Give access] admin claim:", err); adminError = "Access was given, but the admin rights could not be set. Try again."; }
      }
      let result;
      try {
        result = await giveAccess(getDb(), { uid: authReq.user.uid, email: authReq.user.email || "" }, target, { ...input, makeAdmin: input.makeAdmin && !adminError });
      } catch (err) {
        // the database work failed: take back the admin claim set above, so claim and records agree (CodeRabbit on #460)
        if (input.makeAdmin && !adminError) {
          // put back exactly what they had (an existing admin stays one); try three times, and if it still fails
          // say so plainly: the person may now hold admin rights that must be removed by hand (CodeRabbit on #460)
          let restored = false;
          for (let attempt = 0; attempt < 3 && !restored; attempt++) {
            try { await authAdmin.setCustomUserClaims(target.uid, previousClaims); restored = true; }
            catch (undoErr) { console.error(`[Give access] taking back the admin claim, attempt ${attempt + 1}:`, undoErr); }
          }
          if (!restored) {
            return sendError(res, `Access was not saved, and the admin rights given to ${target.email} could not be taken back. Remove them in the user list now.`, 500);
          }
        }
        throw err;
      }
      res.json({ status: "success", ...result, ...(adminError ? { adminError } : {}) });
    } catch (err) {
      handleApiError(res, err);
    }
  });
}
