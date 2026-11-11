/**
 * Supabase Auth on the server (replaces firebase-admin's auth()).
 *
 * - verifyIdToken(): checks the access token the browser sends as "Authorization: Bearer ..."
 *   (a Supabase JWT) and returns it in the shape the routes already use (uid, email,
 *   email_verified, admin, role, firebase.sign_in_provider).
 * - authAdmin: the account operations the server makes (look a user up, set the platform-admin
 *   flag, sign a user out everywhere, delete an account). They run as SQL on the auth schema
 *   through the server's database connection, so no extra key is needed.
 *
 * The platform-admin flag lives in app_metadata (only the server can change it), exactly like
 * Firebase custom claims: { admin: true, role: 'admin' }.
 */
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';
import supabaseConfig from '../../../supabase-config.json';
import { getDb } from '../db/firestore';
import { trimEndChar } from '../../lib/textShape';

// Same as firebase-admin's DecodedIdToken: routes read extra claims directly.
type ClaimAny = any;

export interface DecodedIdToken {
  uid: string;
  sub: string;
  email?: string;
  email_verified: boolean;
  admin?: boolean;
  role?: string;
  aud: string;
  iss: string;
  iat: number;
  exp: number;
  auth_time: number;
  firebase: { sign_in_provider: string; identities: Record<string, unknown> };
  [claim: string]: ClaimAny;
}

export class AuthError extends Error {
  constructor(readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AuthError';
  }
}

export function supabaseUrl(): string {
  // Do not trust access tokens from the live project when a local dev copy is unconfigured.
  const fallback = process.env.NODE_ENV === 'development'
    ? 'https://ledgerflow-unconfigured.invalid'
    : supabaseConfig.url;
  return trimEndChar(process.env.SUPABASE_URL || fallback, '/');
}

let remoteKeys: { url: string; keys: JWTVerifyGetKey } | null = null;

function signingKeys(issuer: string): JWTVerifyGetKey {
  const url = `${issuer}/.well-known/jwks.json`;
  if (!remoteKeys || remoteKeys.url !== url) {
    remoteKeys = { url, keys: createRemoteJWKSet(new URL(url)) };
  }
  return remoteKeys.keys;
}

// Once confirmed, an email stays confirmed: remember it for the life of the process.
const confirmedUsers = new Set<string>();

async function isEmailConfirmed(uid: string): Promise<boolean> {
  if (confirmedUsers.has(uid)) return true;
  const result = await getDb().pool.query<{ confirmed: boolean }>(
    'select email_confirmed_at is not null as confirmed from auth.users where id = $1::uuid',
    [uid],
  );
  const confirmed = result.rows[0]?.confirmed === true;
  if (confirmed) confirmedUsers.add(uid);
  return confirmed;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Users with a verified authenticator app must finish the code step (a session at aal2).
// The database enforces the same rule (supabase/migrations/*_two_step_login.sql).
const authenticatorCache = new Map<string, { has: boolean; until: number }>();

async function hasVerifiedAuthenticator(uid: string): Promise<boolean> {
  const hit = authenticatorCache.get(uid);
  if (hit && hit.until > Date.now()) return hit.has;
  const result = await getDb().pool.query<{ has: boolean }>(
    `select exists (select 1 from auth.mfa_factors
                     where user_id = $1::uuid and factor_type::text = 'totp' and status::text = 'verified') as has`,
    [uid]);
  const has = result.rows[0]?.has === true;
  if (authenticatorCache.size > 10_000) authenticatorCache.clear();
  authenticatorCache.set(uid, { has, until: Date.now() + 60_000 });
  return has;
}

const twoStepCache = new Map<string, { workspaces: Array<{ id: string; name: string }>; until: number }>();

/**
 * Y-30: the workspaces this person belongs to that require two-step login (cached for a minute).
 * Belonging is what the database rules use: the owner, a role, an admin, or the members list.
 */
export async function workspacesRequiringTwoStep(uid: string): Promise<Array<{ id: string; name: string }>> {
  const hit = twoStepCache.get(uid);
  if (hit && hit.until > Date.now()) return hit.workspaces;
  const { rows } = await getDb().pool.query<{ id: string; name: string }>(
    `select id, coalesce(data->>'name', '') as name from public.workspaces
      where (data->>'requireTwoStep') = 'true'
        and (data->>'uid' = $1 or jsonb_typeof(data->'roles'->$1) = 'string' or (data->'admins'->$1) = 'true'::jsonb
             or coalesce(data->'members', '[]'::jsonb) ? $1)
      order by 2`, [uid]);
  if (twoStepCache.size > 10_000) twoStepCache.clear();
  twoStepCache.set(uid, { workspaces: rows, until: Date.now() + 60_000 });
  return rows;
}

/** After a workspace turns the requirement on or off: do not wait for the cache to expire. */
export function forgetTwoStepRequirements(): void {
  twoStepCache.clear();
}

/** After an authenticator is removed (a recovery code, L-85): do not wait for the cache to expire. */
export function forgetAuthenticator(uid: string): void {
  authenticatorCache.delete(uid);
}

/**
 * Checks a Supabase access token (signature, issuer, audience, expiry) and decodes it.
 * `firstStepOnly`: accept a password-only session of someone with an authenticator; only for using a
 * recovery code (POST /api/v1/account/recovery-codes/use).
 * `setupCheck`: accept a password-only session of someone who still has to set up two-step login for
 * a workspace that requires it (Y-30); only for asking whether they must (GET /api/v1/account/two-step).
 */
export async function verifyIdToken(token: string, opts: { firstStepOnly?: boolean; setupCheck?: boolean } = {}): Promise<DecodedIdToken> {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    throw new AuthError('auth/argument-error', 'Missing or malformed token');
  }
  const issuer = `${supabaseUrl()}/auth/v1`;
  let payload: JWTPayload;
  try {
    const { alg } = decodeProtectedHeader(token);
    if (alg === 'HS256') {
      // Projects on the legacy shared secret (also what the Vercel integration provides).
      const secret = process.env.SUPABASE_JWT_SECRET;
      if (!secret) throw new AuthError('auth/invalid-id-token', 'HS256 token but SUPABASE_JWT_SECRET is not set');
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        issuer, audience: 'authenticated', algorithms: ['HS256'],
      }));
    } else {
      ({ payload } = await jwtVerify(token, signingKeys(issuer), {
        issuer, audience: 'authenticated', algorithms: ['ES256', 'RS256', 'EdDSA'],
      }));
    }
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('auth/invalid-id-token', `Invalid token: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  // Anon/service keys are JWTs too; only signed-in user tokens are accepted.
  if (payload.role !== 'authenticated' || typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
    throw new AuthError('auth/invalid-id-token', 'Not a signed-in user token');
  }

  const appMeta = (payload.app_metadata || {}) as Record<string, unknown>;
  const isAnonymous = payload.is_anonymous === true;
  if (!opts.firstStepOnly && payload.aal !== 'aal2' && !isAnonymous) {
    if (await hasVerifiedAuthenticator(payload.sub)) {
      throw new AuthError('auth/multi-factor-auth-required', 'Two-step verification is required for this account');
    }
    if (!opts.setupCheck && (await workspacesRequiringTwoStep(payload.sub)).length > 0) {
      throw new AuthError('auth/two-step-setup-required', 'A workspace you belong to requires two-step login: set up an authenticator app to continue');
    }
  }
  const email = typeof payload.email === 'string' && payload.email ? payload.email : undefined;
  const provider = isAnonymous ? 'anonymous'
    : appMeta.provider === 'email' || !appMeta.provider ? 'password' : `${String(appMeta.provider)}.com`;
  const isAdmin = appMeta.admin === true || appMeta.role === 'admin';
  const emailVerified = !isAnonymous && Boolean(email) && await isEmailConfirmed(payload.sub);

  return {
    ...payload,
    uid: payload.sub,
    sub: payload.sub,
    email,
    email_verified: emailVerified,
    admin: isAdmin || undefined,
    role: typeof appMeta.role === 'string' ? appMeta.role : undefined,
    aud: 'authenticated',
    iss: issuer,
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
    auth_time: payload.iat ?? 0,
    firebase: { sign_in_provider: provider, identities: {} },
  };
}

// ---------------------------------------------------------------------------
// Account operations
// ---------------------------------------------------------------------------

export interface UserRecord {
  uid: string;
  email?: string;
  emailVerified: boolean;
  disabled: boolean;
  displayName?: string;
  customClaims: Record<string, unknown>;
  metadata: { creationTime?: string; lastSignInTime?: string };
}

interface AuthUserRow {
  id: string;
  email: string | null;
  email_confirmed_at: Date | null;
  banned_until: Date | null;
  raw_app_meta_data: Record<string, unknown> | null;
  raw_user_meta_data: Record<string, unknown> | null;
  created_at: Date | null;
  last_sign_in_at: Date | null;
}

const USER_COLUMNS = 'id::text as id, email, email_confirmed_at, banned_until, raw_app_meta_data, raw_user_meta_data, created_at, last_sign_in_at';

// app_metadata keys that act as custom claims; setCustomUserClaims replaces these.
const CLAIM_KEYS = ['admin', 'role'];
const RESERVED_KEYS = ['provider', 'providers'];

function toUserRecord(row: AuthUserRow): UserRecord {
  const appMeta = row.raw_app_meta_data || {};
  const userMeta = row.raw_user_meta_data || {};
  const customClaims: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(appMeta)) {
    if (!RESERVED_KEYS.includes(k)) customClaims[k] = v;
  }
  const name = userMeta.full_name || userMeta.name;
  return {
    uid: row.id,
    email: row.email || undefined,
    emailVerified: row.email_confirmed_at !== null,
    disabled: row.banned_until !== null && row.banned_until.getTime() > Date.now(),
    displayName: typeof name === 'string' ? name : undefined,
    customClaims,
    metadata: {
      creationTime: row.created_at?.toISOString(),
      lastSignInTime: row.last_sign_in_at?.toISOString(),
    },
  };
}

function notFound(what: string): AuthError {
  return new AuthError('auth/user-not-found', `There is no user record corresponding to ${what}`);
}

async function getUser(uid: string): Promise<UserRecord> {
  if (!UUID.test(uid)) throw notFound(`uid ${uid}`);
  const result = await getDb().pool.query<AuthUserRow>(
    `select ${USER_COLUMNS} from auth.users where id = $1::uuid and deleted_at is null`, [uid]);
  if (!result.rows[0]) throw notFound(`uid ${uid}`);
  return toUserRecord(result.rows[0]);
}

async function getUserByEmail(email: string): Promise<UserRecord> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw notFound('an empty email');
  const result = await getDb().pool.query<AuthUserRow>(
    `select ${USER_COLUMNS} from auth.users where lower(email) = $1 and deleted_at is null order by created_at limit 1`,
    [normalized]);
  if (!result.rows[0]) throw notFound(`email ${normalized}`);
  return toUserRecord(result.rows[0]);
}

/** Like Firebase: replaces the user's custom claims (admin / role). Takes effect at the next token refresh. */
async function setCustomUserClaims(uid: string, claims: Record<string, unknown> | null): Promise<void> {
  const next = claims || {};
  if (Object.keys(next).some(k => RESERVED_KEYS.includes(k))) {
    throw new AuthError('auth/invalid-claims', `Claims may not set ${RESERVED_KEYS.join(' or ')}`);
  }
  if (!UUID.test(uid)) throw notFound(`uid ${uid}`);
  const cleared = Array.from(new Set([...CLAIM_KEYS, ...Object.keys(next)]));
  const result = await getDb().pool.query(
    `update auth.users
        set raw_app_meta_data = (coalesce(raw_app_meta_data, '{}'::jsonb) - $2::text[]) || $3::jsonb,
            updated_at = now()
      where id = $1::uuid`,
    [uid, cleared, JSON.stringify(next)]);
  if (result.rowCount === 0) throw notFound(`uid ${uid}`);
}

/** Signs the user out on every device (their refresh tokens stop working). */
async function revokeRefreshTokens(uid: string): Promise<void> {
  if (!UUID.test(uid)) throw notFound(`uid ${uid}`);
  await getDb().pool.query('delete from auth.sessions where user_id = $1::uuid', [uid]);
}

async function deleteUser(uid: string): Promise<void> {
  if (!UUID.test(uid)) throw notFound(`uid ${uid}`);
  const result = await getDb().pool.query('delete from auth.users where id = $1::uuid', [uid]);
  if (result.rowCount === 0) throw notFound(`uid ${uid}`);
}

export const authAdmin = {
  verifyIdToken,
  getUser,
  getUserByEmail,
  setCustomUserClaims,
  revokeRefreshTokens,
  deleteUser,
};
