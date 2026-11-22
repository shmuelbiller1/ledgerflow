/** Shared setup for suites that start the real app against LF_TEST_DATABASE_URL and call it over HTTP. */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';

const SERVER_ENV = ['DATABASE_URL', 'SUPABASE_JWT_SECRET', 'SUPABASE_URL', 'SESSION_SECRET', 'SYSTEM_SALT', 'INVITE_SECRET'] as const;

/** Points the app at the test database and fills any missing secret with a per-suite value; returns what to restore. */
export function useLiveApiEnv(label: string, extra: Record<string, string> = {}): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const key of [...SERVER_ENV, ...Object.keys(extra)]) prev[key] = process.env[key];
  process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
  process.env.SUPABASE_JWT_SECRET ||= `test-${label}-jwt-secret-at-least-32-chars-long!!`;
  process.env.SUPABASE_URL ||= `https://${label}.supabase.test`;
  process.env.SESSION_SECRET ||= `test-${label}-session-secret-000000000000001`;
  process.env.SYSTEM_SALT ||= `test-${label}-system-salt-000000000000000001`;
  process.env.INVITE_SECRET ||= `test-${label}-invite-secret-0000000000000001`;
  Object.assign(process.env, extra);
  return prev;
}

export function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

export interface TestJwtClaims {
  uid: string;
  email: string;
  aal?: 'aal1' | 'aal2';
  /** seconds added to now for auth_time; omitted means no auth_time claim */
  authTimeOffsetSec?: number;
  appMetadata?: Record<string, unknown>;
  userMetadata?: Record<string, unknown>;
  /** Supabase's `session_id` claim: which auth.sessions row this token belongs to */
  sessionId?: string;
}

/** A Supabase-shaped access token signed with the suite's SUPABASE_JWT_SECRET. */
export function signTestJwt(claims: TestJwtClaims): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
  const payload: Record<string, unknown> = { email: claims.email, email_verified: true, aal: claims.aal || 'aal1', role: 'authenticated' };
  if (claims.authTimeOffsetSec !== undefined) {
    const at = Math.floor(Date.now() / 1000) + claims.authTimeOffsetSec;
    // Supabase's real shape: the sign-in method and its time, kept across refreshes
    payload.auth_time = at;
    payload.amr = [{ method: 'password', timestamp: at }];
  }
  if (claims.appMetadata) payload.app_metadata = claims.appMetadata;
  if (claims.userMetadata) payload.user_metadata = claims.userMetadata;
  if (claims.sessionId) payload.session_id = claims.sessionId;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.uid)
    .setAudience('authenticated')
    .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

export async function listenOnRandomPort(app: { listen: (port: number, host: string, cb: () => void) => Server }): Promise<{ server: Server; base: string }> {
  const server = await new Promise<Server>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

export async function closeServer(server: Server | undefined): Promise<void> {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
}

export interface ApiCall { token?: string; body?: unknown; headers?: Record<string, string>; alwaysJson?: boolean }

/** One request to the running app; the reply body is parsed as JSON when it is JSON. */
export async function callApi(base: string, method: string, routePath: string, call: ApiCall = {}): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { 'X-LedgerFlow-Request': '1' };
  if (call.token) headers.Authorization = `Bearer ${call.token}`;
  if (call.body !== undefined || call.alwaysJson) headers['Content-Type'] = 'application/json';
  Object.assign(headers, call.headers);
  const res = await fetch(`${base}${routePath}`, { method, headers, body: call.body !== undefined ? JSON.stringify(call.body) : undefined });
  const text = await res.text();
  let json: unknown = text;
  try { json = JSON.parse(text); } catch { /* not JSON: keep the text */ }
  return { status: res.status, json };
}
