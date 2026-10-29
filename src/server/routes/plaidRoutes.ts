import express from "express";
import { z } from "zod";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { getDb, validateWorkspaceMember } from "../db/firestore.ts";
import { SecurityService } from "../../services/securityService.ts";
import { getLocalDateISO } from "../../lib/utils.ts";
import { appendSyncLog, readSyncLog } from "../../lib/bankFeedStatus.ts";
import { requireWorkspaceRole } from "./workspaceRoutes.ts";
import { notify } from "../services/notificationService.ts";
import { writeServerAuditLog } from "../services/auditLogService.ts";
import { plaidAccountFor, plaidRowsAsBankLines, storePlaidSync } from "../services/plaidIngest.ts";

/**
 * Bank feeds through Plaid. A connection (collection `banks`) belongs to one workspace: only its
 * owner/accountant/bookkeeper can connect or reconnect it, and a sync returns only that
 * workspace's banks. When a bank asks the user to log in again, the connection is marked
 * `login_required` and the sync carries on with the others; the screen offers "Reconnect"
 * (Plaid update mode). Owners and accountants can disconnect a bank (Z-30).
 */
export const plaidRouter = express.Router();

/** The Plaid calls this router makes (tests swap in a fake). */
export type PlaidClientLike = Pick<PlaidApi, 'linkTokenCreate' | 'itemPublicTokenExchange' | 'transactionsGet'> & Partial<Pick<PlaidApi, 'itemRemove' | 'transactionsSync'>>;

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
    // the books' currency: a row in another currency is stored for review, never as home-currency money
    const workspaceCurrency = String((await db.collection("workspaces").doc(body.workspaceId).get()).data()?.currency || 'USD');

    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const transactions: unknown[] = [];
    const modified: unknown[] = [];
    const removed: string[] = [];
    const needsReconnect: { bankId: string; institutionName: string }[] = [];
    // Z-28: a bank that fails another way is said and kept in its log; the others still sync
    const failed: { bankId: string; institutionName: string; error: string }[] = [];
    let answered = 0;
    // bank lines actually added (Plaid's raw rows include card holds and rows already stored)
    let storedLines = 0;
    for (const doc of banksSnap.docs) {
      const bank = doc.data();
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
          const response = await plaidClient.transactionsGet({
            access_token: accessToken,
            start_date: getLocalDateISO(thirtyDaysAgo),
            end_date: getLocalDateISO(today),
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
        const connection = { id: doc.id, accountId: bank.accountId, plaidAccountId: bank.plaidAccountId, workspaceCurrency };
        const plaidAccountId = plaidAccountFor(connection, [...added, ...pageModified]);
        const saved = await storePlaidSync(db, {
          workspaceId: body.workspaceId, uid: (req as AuthedRequest).user?.uid || '', bankRef: doc.ref,
          lines: plaidRowsAsBankLines(added, connection, body.workspaceId, plaidAccountId),
          modified: plaidRowsAsBankLines(pageModified, connection, body.workspaceId, plaidAccountId),
          removed: pageRemoved,
          expectedCursor: typeof bank.syncCursor === 'string' ? bank.syncCursor : undefined,
          bankUpdate: {
            status: 'active', lastSyncedAt: syncedAt, updatedAt: syncedAt,
            ...(nextCursor !== undefined ? { syncCursor: nextCursor } : {}),
            ...(plaidAccountId && !bank.plaidAccountId ? { plaidAccountId } : {}),
            syncLog: appendSyncLog(bank.syncLog, { at: syncedAt, result: 'ok', lines: lineCount }),
          },
        });
        // only rows that are now stored are reported, so a failed store is never a "synchronized" (Codex on #439)
        answered += 1;
        storedLines += saved.stored;
        transactions.push(...added);
        modified.push(...pageModified);
        removed.push(...pageRemoved);
      } catch (err) {
        const code = plaidErrorCode(err);
        const now = new Date().toISOString();
        if (code !== 'ITEM_LOGIN_REQUIRED') {
          console.error("[Plaid] sync of one bank:", code || err);
          const error = code || 'UNKNOWN_ERROR';
          failed.push({ bankId: doc.id, institutionName: bank.institutionName || '', error });
          await doc.ref.update({ status: 'error', updatedAt: now, syncLog: appendSyncLog(bank.syncLog, { at: now, result: 'error', error }) });
          continue;
        }
        needsReconnect.push({ bankId: doc.id, institutionName: bank.institutionName || '' });
        await doc.ref.update({ status: 'login_required', updatedAt: now, syncLog: appendSyncLog(bank.syncLog, { at: now, result: 'login_required' }) });
        if (bank.status !== 'login_required') {
          const name = bank.institutionName || 'A bank';
          await notify(db, {
            workspaceId: body.workspaceId, kind: 'bank.disconnected',
            title: `${name} needs to be reconnected`,
            message: `The bank login expired, so new bank lines can't be downloaded. Open Banking and choose Reconnect.`,
            eventKey: `bank.disconnected:${doc.id}:${now}`, recordId: doc.id, actorUid: (req as AuthedRequest).user?.uid,
          });
        }
      }
    }
    // every connection failed: the sync failed (as before), with each one's reason kept in its log
    if (failed.length > 0 && answered === 0 && needsReconnect.length === 0) return sendError(res, "Could not sync the bank feed", 502);
    res.json({ success: transactions.length > 0, transactions, modified, removed, storedLines, needsReconnect, failed, banks: banksSnap.size });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not a member|Unauthorized|not found/i.test(message)) return sendError(res, message, 403);
    console.error("[Plaid] sync:", plaidErrorCode(error) || error);
    sendError(res, "Could not sync the bank feed");
  }
});
