import express from "express";
import crypto from "crypto";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { getDb } from "../db/firestore.ts";
import { getPlaidClient, syncOneBank } from "./plaidRoutes.ts";
import { plaidWebhookLimiter } from "../middleware/rateLimiters.ts";

/**
 * AU-1: Plaid's transactions webhook. When Plaid says a connection has new changes
 * (SYNC_UPDATES_AVAILABLE), that connection is synced from its saved cursor exactly as "Sync" does,
 * so bank lines arrive without anyone pressing the button.
 *
 * Every request is verified before anything is read from it: the `Plaid-Verification` header is an
 * ES256 JWT signed with a key that Plaid publishes (/webhook_verification_key/get), at most five minutes
 * old, whose `request_body_sha256` is the hash of the exact body received. A replayed or repeated
 * notice is harmless: the sync reads from the saved cursor under the bank's lease (AF-001).
 * Registered before the JSON body parser, because the body hash is taken over the raw bytes.
 */
const keyCache = new Map<string, JWK>();
const MAX_AGE_SECONDS = 5 * 60;

export class PlaidWebhookRejected extends Error {}

/** Throws PlaidWebhookRejected unless the request is a fresh notice signed by Plaid for this exact body. */
export async function verifyPlaidWebhook(rawBody: Buffer, token: string | undefined, now = Date.now()): Promise<void> {
  if (!token) throw new PlaidWebhookRejected('missing Plaid-Verification header');
  let header: ReturnType<typeof decodeProtectedHeader>;
  try { header = decodeProtectedHeader(token); } catch { throw new PlaidWebhookRejected('unreadable token'); }
  if (header.alg !== 'ES256' || typeof header.kid !== 'string' || !header.kid) throw new PlaidWebhookRejected('unexpected token header');
  let jwk = keyCache.get(header.kid);
  if (!jwk) {
    const client = getPlaidClient();
    if (!client.webhookVerificationKeyGet) throw new PlaidWebhookRejected('verification keys unavailable');
    const res = await client.webhookVerificationKeyGet({ key_id: header.kid });
    const key = res.data.key as unknown as JWK & { expired_at?: number | null };
    if (key.expired_at) throw new PlaidWebhookRejected('expired verification key');
    jwk = key;
    keyCache.set(header.kid, key);
  }
  let payload: Record<string, unknown>;
  try {
    const key = await importJWK(jwk, 'ES256');
    ({ payload } = await jwtVerify(token, key, { algorithms: ['ES256'], maxTokenAge: MAX_AGE_SECONDS, currentDate: new Date(now) }));
  } catch {
    throw new PlaidWebhookRejected('bad signature or too old');
  }
  const claimed = typeof payload.request_body_sha256 === 'string' ? payload.request_body_sha256 : '';
  const actual = crypto.createHash('sha256').update(rawBody).digest('hex');
  if (claimed.length !== actual.length || !crypto.timingSafeEqual(Buffer.from(claimed), Buffer.from(actual))) {
    throw new PlaidWebhookRejected('body does not match the signature');
  }
}

/** Test seam: forget cached verification keys. */
export function clearPlaidWebhookKeysForTests(): void {
  keyCache.clear();
}

export async function handlePlaidWebhook(req: express.Request, res: express.Response): Promise<void> {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  try {
    await verifyPlaidWebhook(raw, req.header('plaid-verification') || undefined);
  } catch (err) {
    if (err instanceof PlaidWebhookRejected) { res.status(401).json({ status: 'error', message: 'Webhook not verified' }); return; }
    console.error('[Plaid webhook] verification:', err);
    res.status(500).json({ status: 'error', message: 'Webhook could not be verified' });
    return;
  }
  let event: { webhook_type?: unknown; webhook_code?: unknown; item_id?: unknown };
  try { event = JSON.parse(raw.toString('utf8')); } catch { res.status(400).json({ status: 'error', message: 'Body is not JSON' }); return; }
  // only "new changes are ready" starts a sync; every other notice is acknowledged and left alone
  if (event.webhook_type !== 'TRANSACTIONS' || event.webhook_code !== 'SYNC_UPDATES_AVAILABLE' || typeof event.item_id !== 'string' || !event.item_id) {
    res.json({ received: true, synced: 0 });
    return;
  }
  const db = getDb();
  const banks = await db.collection('banks').where('item_id', '==', event.item_id).get();
  let synced = 0;
  for (const doc of banks.docs) {
    const bank = doc.data();
    const workspaceId = typeof bank.workspaceId === 'string' ? bank.workspaceId : '';
    if (!workspaceId) continue;
    const ws = (await db.collection('workspaces').doc(workspaceId).get()).data();
    const r = await syncOneBank(db, doc, {
      workspaceId, uid: 'plaid-webhook',
      workspaceCurrency: String(ws?.currency || 'USD'),
      workspaceTimezone: typeof ws?.timezone === 'string' ? ws.timezone : undefined,
    });
    // a connection another sync is reading already gets these changes from that sync
    if (r.kind === 'ok') synced += 1;
  }
  res.json({ received: true, synced });
}

export function registerPlaidWebhookRoutes(app: express.Express): void {
  app.post('/api/webhook/plaid', plaidWebhookLimiter, express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
    handlePlaidWebhook(req, res).catch(err => {
      console.error('[Plaid webhook]', err);
      if (!res.headersSent) res.status(500).json({ status: 'error', message: 'Webhook failed' });
    });
  });
}
