import express from "express";
import { z } from "zod";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { getDb, validateWorkspaceMember, type DocumentData } from "../db/firestore.ts";
import { SecurityService } from "../../services/securityService.ts";
import { getDateInTimezoneISO } from "../../lib/calendarDate.ts";
import { appendSyncLog, readSyncLog } from "../../lib/bankFeedStatus.ts";
import { requireWorkspaceRole } from "./workspaceRoutes.ts";
import { notify } from "../services/notificationService.ts";
import { writeServerAuditLog } from "../services/auditLogService.ts";
import { PLAID_SYNC_CONFLICT, claimPlaidSyncLease, releasePlaidSyncLease, updateBankIfLeaseHeld, plaidAccountFor, plaidRowsAsBankLines, storePlaidSync } from "../services/plaidIngest.ts";

/**
 * Bank feeds through Plaid. A connection (collection `banks`) belongs to one workspace: only its
 * owner/accountant/bookkeeper can connect or reconnect it, and a sync returns only that
 * workspace's banks. When a bank asks the user to log in again, the connection is marked
 * `login_required` and the sync carries on with the others; the screen offers "Reconnect"
 * (Plaid update mode). Owners and accountants can disconnect a bank (Z-30).
 */
export const plaidRouter = express.Router();

/** The Plaid calls this router makes (tests swap in a fake). */
export type PlaidClientLike = Pick<PlaidApi, 'linkTokenCreate' | 'itemPublicTokenExchange' | 'transactionsGet'> & Partial<Pick<PlaidApi, 'itemRemove' | 'transactionsSync' | 'webhookVerificationKeyGet' | 'itemWebhookUpdate'>>;

let plaidClient: PlaidClientLike = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
}));

export function setPlaidClientForTests(client: PlaidClientLike) {
  plaidClient = client;
}

/** The current Plaid client (the webhook route reuses it). */
export function getPlaidClient(): PlaidClientLike {
  return plaidClient;
}

type AuthedRequest = express.Request & { user: { uid: string; admin?: boolean; developerWorkspaceId?: string } };

function plaidErrorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
}

function sendError(res: express.Response, message: string, status = 500) {
  res.status(status).json({ status: "error", message });
}

const ledgerWriters = requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']);

const linkTokenSchema = z.object({ workspaceId: z.string().min(1), bankId: z.string().min(1).optional() });

/** A Link token: a new connection, or with bankId the update-mode token to reconnect it. */
plaidRouter.post("/create_link_token", ledgerWriters, async (req, res) => {
  try {
    const { workspaceId, bankId } = linkTokenSchema.parse(req.body);
    const user = (req as AuthedRequest).user;
    let accessToken: string | undefined;
    if (bankId) {
      const bank = (await getDb().collection("banks").doc(bankId).get()).data();
      if (!bank || bank.workspaceId !== workspaceId) return sendError(res, "Bank connection not found", 404);
      accessToken = SecurityService.decryptSensitiveField(bank.access_token);
    }
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: user.uid },
      client_name: "LedgerFlow",
      country_codes: ["US"] as never[],
      language: "en",
      ...(accessToken ? { access_token: accessToken } : { products: ["transactions"] as never[] }),
      // AU-1: where Plaid tells us new transactions are ready (set PLAID_WEBHOOK_URL to /api/webhook/plaid)
      ...(process.env.PLAID_WEBHOOK_URL ? { webhook: process.env.PLAID_WEBHOOK_URL } : {}),
    });
    res.json(response.data);
  } catch (error) {
    if (error instanceof z.ZodError) return sendError(res, "workspaceId is required", 400);
    console.error("[Plaid] create_link_token:", plaidErrorCode(error) || error);
    sendError(res, "Could not start the bank connection");
  }
});

const exchangeSchema = z.object({
  workspaceId: z.string().min(1),
  public_token: z.string().min(1),
  accountId: z.string().min(1).optional(),
  institutionName: z.string().max(200).optional(),
});

/** Stores a new connection (encrypted access token) for the workspace. */
plaidRouter.post("/exchange_public_token", ledgerWriters, async (req, res) => {
  try {
    const { workspaceId, public_token, accountId, institutionName } = exchangeSchema.parse(req.body);
    const user = (req as AuthedRequest).user;
    const response = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = response.data;
    const ref = getDb().collection("banks").doc();
    await ref.set({
      workspaceId,
      uid: user.uid,
      access_token: SecurityService.encryptSensitiveField(access_token),
      item_id,
      accountId: accountId || null,
      institutionName: institutionName || '',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    // AU-1 (Codex on #458): Plaid sends SYNC_UPDATES_AVAILABLE only after the item's first /transactions/sync,
    // so start it now; a failure here leaves the connection saved and the next Sync picks it up
    if (process.env.PLAID_WEBHOOK_URL) {
      try {
        const ws = (await getDb().collection("workspaces").doc(workspaceId).get()).data();
        await syncOneBank(getDb(), await ref.get(), {
          workspaceId, uid: user.uid,
          workspaceCurrency: String(ws?.currency || 'USD'),
          workspaceTimezone: typeof ws?.timezone === 'string' ? ws.timezone : undefined,
        });
      } catch (err) {
        console.error("[Plaid] first sync after connect:", plaidErrorCode(err) || err);
      }
    }
    res.json({ success: true, bankId: ref.id });
  } catch (error) {
    if (error instanceof z.ZodError) return sendError(res, "workspaceId and public_token are required", 400);
    console.error("[Plaid] exchange_public_token:", plaidErrorCode(error) || error);
    sendError(res, "Could not save the bank connection");
  }
});

/** After the user logged in again (update mode): the connection works again. */
plaidRouter.post("/reconnected", ledgerWriters, async (req, res) => {
  try {
    const { workspaceId, bankId } = linkTokenSchema.required({ bankId: true }).parse(req.body);
    const ref = getDb().collection("banks").doc(bankId);
    const bank = (await ref.get()).data();
    if (!bank || bank.workspaceId !== workspaceId) return sendError(res, "Bank connection not found", 404);
    await ref.update({ status: 'active', updatedAt: new Date().toISOString() });
    // AU-1 (Codex on #458): Link update mode ignores `webhook`, so register it on the item directly
    if (process.env.PLAID_WEBHOOK_URL && plaidClient.itemWebhookUpdate && bank.access_token) {
      try {
        await plaidClient.itemWebhookUpdate({ access_token: SecurityService.decryptSensitiveField(bank.access_token), webhook: process.env.PLAID_WEBHOOK_URL });
      } catch (err) {
        console.error("[Plaid] item webhook update:", plaidErrorCode(err) || err);
      }
    }
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return sendError(res, "workspaceId and bankId are required", 400);
    sendError(res, "Could not update the bank connection");
  }
});

/**
 * Z-30: disconnect a bank (owners and accountants). The bank is told to stop (Plaid removes the
 * connection, so nothing more is downloaded or billed), then the stored connection and its token are
 * deleted. The bank lines already imported stay, matched or not, with everything posted from them.
 * If the bank can't be told, nothing is deleted and the answer says to try again; a connection the
 * bank no longer knows is simply removed here.
 */
plaidRouter.post("/disconnect", requireWorkspaceRole(['owner', 'accountant']), async (req, res) => {
  try {
    const { workspaceId, bankId } = linkTokenSchema.required({ bankId: true }).parse(req.body);
    const db = getDb();
    const ref = db.collection("banks").doc(bankId);
    const bank = (await ref.get()).data();
    if (!bank || bank.workspaceId !== workspaceId) return sendError(res, "Bank connection not found", 404);
    try {
      if (!plaidClient.itemRemove) throw new Error('The bank service is not available');
      await plaidClient.itemRemove({ access_token: SecurityService.decryptSensitiveField(bank.access_token) });
    } catch (err) {
      // already gone at the bank: nothing to stop there
      if (!['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN'].includes(String(plaidErrorCode(err)))) {
        console.error("[Plaid] disconnect:", plaidErrorCode(err) || err);
        return sendError(res, "The bank could not be told to stop, so nothing was removed: try again in a moment", 502);
      }
    }
    await ref.delete();
    const name = bank.institutionName || 'A bank';
    await writeServerAuditLog({
      workspaceId, uid: (req as AuthedRequest).user.uid, action: 'BANK_DISCONNECTED', entityType: 'banks', entityId: bankId,
      details: { description: `${name} disconnected; its imported bank lines are kept` },
    }, { db });
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return sendError(res, "workspaceId and bankId are required", 400);
    sendError(res, "Could not disconnect the bank");
  }
});

/** The workspace's connections (never the tokens). */
plaidRouter.get("/banks", async (req, res) => {
  try {
    const workspaceId = String(req.query.workspaceId || '');
    if (!workspaceId) return sendError(res, "workspaceId is required", 400);
    const db = getDb();
    await validateWorkspaceMember(db, workspaceId, (req as AuthedRequest).user);
    const snap = await db.collection("banks").where("workspaceId", "==", workspaceId).get();
    res.json({ banks: snap.docs.map(d => ({ id: d.id, institutionName: d.data().institutionName || '', accountId: d.data().accountId || null, status: d.data().status || 'active', createdAt: d.data().createdAt, lastSyncedAt: d.data().lastSyncedAt || null, syncLog: readSyncLog(d.data().syncLog) })) });
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : "Could not list bank connections", 403);
  }
});

type SyncCall = NonNullable<PlaidClientLike['transactionsSync']>;

/**
 * AU-1: every page of /transactions/sync after `cursor`. If the bank's data changes while paging
 * (TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION), the pages are thrown away and read again from the
 * same starting cursor, as Plaid asks; nothing is kept from a half-read run.
 */
export async function syncAllPages(call: SyncCall, accessToken: string, cursor: string | undefined) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const added: unknown[] = [], modified: unknown[] = [], removed: string[] = [];
    let next = cursor;
    try {
      for (let pages = 0; pages < 200; pages++) {
        const { data } = await call({ access_token: accessToken, ...(next ? { cursor: next } : {}), count: 500 });
        added.push(...data.added);
        modified.push(...data.modified);
        removed.push(...data.removed.map(r => r.transaction_id).filter((id): id is string => typeof id === 'string'));
        next = data.next_cursor;
        if (!data.has_more) return { added, modified, removed, cursor: next };
      }
      throw new Error('Too many pages from the bank feed');
    } catch (err) {
      if (plaidErrorCode(err) === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') continue;
      throw err;
    }
  }
  throw new Error('The bank kept changing while it was read; try again');
}

export type BankSyncResult =
  | { kind: 'ok'; institutionName: string; stored: number; added: unknown[]; modified: unknown[]; removed: string[] }
  | { kind: 'busy' | 'login_required'; institutionName: string }
  | { kind: 'failed'; institutionName: string; error: string };

/**
 * One connection's sync (AU-1): reads Plaid from the saved cursor and stores the rows with the cursor
 * (AF-001), holding the bank's lease throughout. Used by POST /sync and by the Plaid webhook.
 */
export async function syncOneBank(
  db: ReturnType<typeof getDb>,
  doc: { id: string; ref: { id: string; update: (data: Record<string, unknown>) => Promise<unknown> }; data: () => DocumentData | undefined },
  ctx: { workspaceId: string; uid: string; workspaceCurrency: string; workspaceTimezone?: string },
): Promise<BankSyncResult> {
  const bank = doc.data() || {};
  const institutionName = String(bank.institutionName || '');
  const leaseId = await claimPlaidSyncLease(db, doc.ref);
  if (!leaseId) return { kind: 'busy', institutionName };
  try {
    const accessToken = SecurityService.decryptSensitiveField(bank.access_token);
    let lineCount: number;
    let nextCursor: string | undefined;
    let added: unknown[];
    let pageModified: unknown[] = [];
    let pageRemoved: string[] = [];
    if (plaidClient.transactionsSync) {
      // AU-1: /transactions/sync from the connection's saved cursor — only what changed since the
      // last sync; the cursor is saved only after every page arrived and its rows are stored (AF-001)
      const page = await syncAllPages(plaidClient.transactionsSync.bind(plaidClient), accessToken, typeof bank.syncCursor === 'string' ? bank.syncCursor : undefined);
      added = page.added;
      pageModified = page.modified;
      pageRemoved = page.removed;
      lineCount = page.added.length + page.modified.length;
      nextCursor = page.cursor;
    } else {
      const today = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(today.getDate() - 30);
      const response = await plaidClient.transactionsGet({
        access_token: accessToken,
        start_date: getDateInTimezoneISO(thirtyDaysAgo, ctx.workspaceTimezone),
        end_date: getDateInTimezoneISO(today, ctx.workspaceTimezone),
      });
      added = response.data.transactions;
      lineCount = response.data.transactions.length;
    }
    // the last time this connection answered (BC-11: the dashboard's bank feed health); a failed or
    // expired sync leaves it where it was. Z-29: each attempt goes in the connection's sync log
    const syncedAt = new Date().toISOString();
    // AF-001: the new rows become bank lines in the same transaction that moves the cursor, so a
    // failure leaves the cursor where it was and the next sync brings the same rows again
    // (CodeRabbit on #439) corrections and deletions travel with the cursor too, and each row keeps
    // its Plaid account, so a second account of the same bank login is never booked to this one
    const connection = { id: doc.id, accountId: bank.accountId, plaidAccountId: bank.plaidAccountId, workspaceCurrency: ctx.workspaceCurrency };
    const plaidAccountId = plaidAccountFor(connection, [...added, ...pageModified]);
    const saved = await storePlaidSync(db, {
      workspaceId: ctx.workspaceId, uid: ctx.uid, bankRef: doc.ref,
      lines: plaidRowsAsBankLines(added, connection, ctx.workspaceId, plaidAccountId),
      modified: plaidRowsAsBankLines(pageModified, connection, ctx.workspaceId, plaidAccountId),
      removed: pageRemoved,
      expectedCursor: typeof bank.syncCursor === 'string' ? bank.syncCursor : undefined,
      leaseId,
      bankUpdate: {
        syncLease: null,
        status: 'active', lastSyncedAt: syncedAt, updatedAt: syncedAt,
        ...(nextCursor !== undefined ? { syncCursor: nextCursor } : {}),
        ...(plaidAccountId && !bank.plaidAccountId ? { plaidAccountId } : {}),
        syncLog: appendSyncLog(bank.syncLog, { at: syncedAt, result: 'ok', lines: lineCount }),
      },
    });
    return { kind: 'ok', institutionName, stored: saved.stored, added, modified: pageModified, removed: pageRemoved };
  } catch (err) {
    // another sync of this bank won: its cursor and log stay; this one is not an error of the bank
    if (err instanceof Error && err.message === PLAID_SYNC_CONFLICT) return { kind: 'busy', institutionName };
    const code = plaidErrorCode(err);
    const now = new Date().toISOString();
    if (code !== 'ITEM_LOGIN_REQUIRED') {
      console.error("[Plaid] sync of one bank:", code || err);
      const error = code || 'UNKNOWN_ERROR';
      // a sync that lost its lease leaves the bank to the sync that took over (CodeRabbit on #455)
      if (!await updateBankIfLeaseHeld(db, doc.ref, leaseId, { status: 'error', updatedAt: now, syncLog: appendSyncLog(bank.syncLog, { at: now, result: 'error', error }) })) {
        return { kind: 'busy', institutionName };
      }
      return { kind: 'failed', institutionName, error };
    }
    if (!await updateBankIfLeaseHeld(db, doc.ref, leaseId, { status: 'login_required', updatedAt: now, syncLog: appendSyncLog(bank.syncLog, { at: now, result: 'login_required' }) })) {
      return { kind: 'busy', institutionName };
    }
    if (bank.status !== 'login_required') {
      const name = institutionName || 'A bank';
      await notify(db, {
        workspaceId: ctx.workspaceId, kind: 'bank.disconnected',
        title: `${name} needs to be reconnected`,
        message: `The bank login expired, so new bank lines can't be downloaded. Open Banking and choose Reconnect.`,
        eventKey: `bank.disconnected:${doc.id}:${now}`, recordId: doc.id, actorUid: ctx.uid || undefined,
      });
    }
    return { kind: 'login_required', institutionName };
  } finally {
    await releasePlaidSyncLease(db, doc.ref, leaseId).catch(() => undefined);
  }
}

const syncSchema = z.object({ workspaceId: z.string().min(1), accountId: z.string().min(1).optional() });

/** Last 30 days of transactions from this workspace's connections (optionally one bank account). */
// AF-001: a sync stores bank lines, so it is a write to the books (owner, accountant, bookkeeper)
plaidRouter.post("/sync", ledgerWriters, async (req, res) => {
  let body: z.infer<typeof syncSchema>;
  try {
    body = syncSchema.parse(req.body);
  } catch {
    return sendError(res, "workspaceId is required", 400);
  }
  try {
    const db = getDb();
    await validateWorkspaceMember(db, body.workspaceId, (req as AuthedRequest).user);
    let query = db.collection("banks").where("workspaceId", "==", body.workspaceId);
    if (body.accountId) query = query.where("accountId", "==", body.accountId);
    const banksSnap = await query.get();
    // the books' currency and timezone from trusted workspace record
    const wsData = (await db.collection("workspaces").doc(body.workspaceId).get()).data();
    const workspaceCurrency = String(wsData?.currency || 'USD');
    const workspaceTimezone = typeof wsData?.timezone === 'string' ? wsData.timezone : undefined;

    const transactions: unknown[] = [];
    const modified: unknown[] = [];
    const removed: string[] = [];
    const needsReconnect: { bankId: string; institutionName: string }[] = [];
    // Z-28: a bank that fails another way is said and kept in its log; the others still sync
    const failed: { bankId: string; institutionName: string; error: string }[] = [];
    let answered = 0;
    // bank lines actually added (Plaid's raw rows include card holds and rows already stored)
    let storedLines = 0;
    // a bank another sync is reading right now, or that it moved on meanwhile: try again in a moment (CodeRabbit on #455)
    const busy: { bankId: string; institutionName: string }[] = [];
    for (const doc of banksSnap.docs) {
      const r = await syncOneBank(db, doc, { workspaceId: body.workspaceId, uid: (req as AuthedRequest).user?.uid || '', workspaceCurrency, workspaceTimezone });
      const who = { bankId: doc.id, institutionName: r.institutionName };
      if (r.kind === 'ok') {
        // only rows that are now stored are reported, so a failed store is never a "synchronized" (Codex on #439)
        answered += 1;
        storedLines += r.stored;
        transactions.push(...r.added);
        modified.push(...r.modified);
        removed.push(...r.removed);
      } else if (r.kind === 'busy') busy.push(who);
      else if (r.kind === 'failed') failed.push({ ...who, error: r.error });
      else needsReconnect.push(who);
    }
    // every connection failed: the sync failed (as before), with each one's reason kept in its log
    if (failed.length > 0 && answered === 0 && needsReconnect.length === 0 && busy.length === 0) return sendError(res, "Could not sync the bank feed", 502);
    res.json({ success: transactions.length > 0 && busy.length === 0, transactions, modified, removed, storedLines, needsReconnect, failed, busy, synced: answered, banks: banksSnap.size });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not a member|Unauthorized|not found/i.test(message)) return sendError(res, message, 403);
    console.error("[Plaid] sync:", plaidErrorCode(error) || error);
    sendError(res, "Could not sync the bank feed");
  }
});
