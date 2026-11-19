import { createHmac, timingSafeEqual } from 'node:crypto';
import type express from 'express';
import type { RequestUser } from './requestUser';

/**
 * The assistant's credential (CMD-1 part 3, SBX-1 "What the assistant can call").
 *
 * A token is issued by a signed-in person for one sandbox: it names that person, the workspace, the
 * sandbox, the role the person had when it was issued, and expires within the hour. It is a separate
 * scheme (`lfa_…`), so neither `apiAuthenticate` nor `authenticate` can mistake it for a sign-in or
 * an API key: every other route answers 401 to it by construction, and
 * `src/tests/sandbox-assistant-token.test.ts` calls every write route to prove it. Only
 * `assistantAuthenticate` (mounted on the sandbox routes) accepts it, and the review service refuses
 * acceptance, undo and whole-sandbox rejection from an assistant principal, so nothing it can call
 * commits to the real books.
 */
export const ASSISTANT_TOKEN_PREFIX = 'lfa_';
export const ASSISTANT_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface AssistantClaims {
  /** the sandbox the token may act in */
  sandboxId: string;
  /** the person it acts for (their membership is re-checked live on every call) */
  personId: string;
  workspaceId: string;
  /** that person's role when the token was issued; it grants nothing beyond the live role */
  role: string;
  /** the person's sign-in assurance level when issued (`aal2` after a two-step sign-in) */
  aal?: string;
  email?: string;
  /** unix milliseconds */
  exp: number;
}

function secret(): Buffer {
  const value = process.env.ASSISTANT_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!value || value.length < 16) throw new Error('SESSION_SECRET (or ASSISTANT_TOKEN_SECRET) is required to sign assistant tokens');
  return createHmac('sha256', value).update('ledgerflow:assistant-token:v1').digest();
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function issueAssistantToken(claims: Omit<AssistantClaims, 'exp'>, now = Date.now()): { token: string; expiresAt: string } {
  const exp = now + ASSISTANT_TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ ...claims, exp }), 'utf8').toString('base64url');
  return { token: `${ASSISTANT_TOKEN_PREFIX}${payload}.${sign(payload)}`, expiresAt: new Date(exp).toISOString() };
}

export function isAssistantToken(token: string | undefined): boolean {
  return typeof token === 'string' && token.startsWith(ASSISTANT_TOKEN_PREFIX);
}

/** The claims of a valid, unexpired token, or null. Never throws on malformed input. */
export function verifyAssistantToken(token: string, now = Date.now()): AssistantClaims | null {
  if (!isAssistantToken(token)) return null;
  const [payload, signature, ...rest] = token.slice(ASSISTANT_TOKEN_PREFIX.length).split('.');
  if (!payload || !signature || rest.length) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: unknown;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!claims || typeof claims !== 'object') return null;
  const c = claims as Record<string, unknown>;
  if (typeof c.sandboxId !== 'string' || typeof c.personId !== 'string' || typeof c.workspaceId !== 'string'
    || typeof c.role !== 'string' || typeof c.exp !== 'number' || c.exp <= now || c.exp - now > ASSISTANT_TOKEN_TTL_MS) return null;
  return {
    sandboxId: c.sandboxId, personId: c.personId, workspaceId: c.workspaceId, role: c.role, exp: c.exp,
    ...(typeof c.aal === 'string' ? { aal: c.aal } : {}),
    ...(typeof c.email === 'string' ? { email: c.email } : {}),
  };
}

/** The request identity an assistant token produces: the person, marked as acting through a sandbox. */
export function assistantRequestUser(claims: AssistantClaims): RequestUser {
  return { uid: claims.personId, email: claims.email, aal: claims.aal, admin: false, assistantSandboxId: claims.sandboxId } as RequestUser;
}

export function bearerToken(req: express.Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim();
}

/** Accepts only an assistant token. Mount it on the sandbox routes and nowhere else. */
export const assistantAuthenticate: express.RequestHandler = (req, res, next) => {
  const token = bearerToken(req);
  if (!isAssistantToken(token)) {
    res.status(401).json({ status: 'error', code: 'ASSISTANT_TOKEN_REQUIRED', message: 'This address takes an assistant token' });
    return;
  }
  const claims = verifyAssistantToken(token!);
  if (!claims) {
    res.status(401).json({ status: 'error', code: 'ASSISTANT_TOKEN_INVALID', message: 'The assistant token is invalid or has expired' });
    return;
  }
  Object.assign(req, { user: assistantRequestUser(claims), assistant: claims });
  next();
};

export function assistantClaims(req: express.Request): AssistantClaims | undefined {
  return (req as express.Request & { assistant?: AssistantClaims }).assistant;
}
