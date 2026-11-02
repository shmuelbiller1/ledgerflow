import type pg from 'pg';
import { FirestoreError } from './values';

export interface FirestoreSettings {
  /** Postgres connection string. Default: DATABASE_URL, then POSTGRES_URL, then SUPABASE_DB_URL. */
  connectionString?: string;
  /** An existing pool (tests). */
  pool?: pg.Pool;
  /** Maximum connections in the pool. Default: PG_POOL_MAX, 5 on serverless, or 10 on standalone. */
  max?: number;
}

/** Checks whether a parsed database URL points to a loopback or Unix-socket host. */
function isLocalHost(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return ['localhost', '127.0.0.1', '::1', ''].includes(host) || (url.searchParams.get('host') || '').startsWith('/');
}

/** Startup warning when a remote database is reached without certificate verification. */
export const DATABASE_CA_WARNING = '[Database] DATABASE_CA_CERT is not set: the connection to the remote database is '
  + 'encrypted but the server certificate is NOT verified. Set DATABASE_CA_CERT to the database CA certificate '
  + '(Supabase dashboard > Database > SSL) to verify it.';

/** Default pool size on serverless runtimes (proven safe floor >= 5 for nested tx reads + 12-way fan-out). */
export const SERVERLESS_DEFAULT_POOL_MAX = 5;
/** Default pool size on long-lived standalone Node servers. */
export const STANDALONE_DEFAULT_POOL_MAX = 10;

let caWarningLogged = false;
const warnOnceAtStartup = (message: string): void => {
  if (caWarningLogged) return;
  caWarningLogged = true;
  console.warn(message);
};

/** Resolves the effective pg.Pool max connections from explicit settings, PG_POOL_MAX, or runtime defaults. */
function resolvePoolMax(settingsMax: number | undefined, env: NodeJS.ProcessEnv, isServerless: boolean): number {
  if (typeof settingsMax === 'number' && Number.isFinite(settingsMax) && settingsMax > 0) {
    return Math.floor(settingsMax);
  }
  const parsedEnvMax = Number(env.PG_POOL_MAX ?? '');
  if (Number.isFinite(parsedEnvMax) && parsedEnvMax > 0) {
    return Math.floor(parsedEnvMax);
  }
  return isServerless ? SERVERLESS_DEFAULT_POOL_MAX : STANDALONE_DEFAULT_POOL_MAX;
}

/** Builds a pg.PoolConfig from explicit settings and environment variables with TLS and serverless sizing. */
export function poolConfigFromEnv(
  settings: FirestoreSettings = {},
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = warnOnceAtStartup,
): pg.PoolConfig {
  const raw = settings.connectionString
    || env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_DB_URL;
  if (!raw) {
    throw new FirestoreError(14, 'No database configured. Set DATABASE_URL (or POSTGRES_URL) to the Supabase Postgres connection string.');
  }
  const url = new URL(raw);
  const local = isLocalHost(url);
  // TLS is configured below; libpq-style URL flags would override it inside pg.
  for (const param of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'supa', 'pgbouncer']) {
    url.searchParams.delete(param);
  }
  const ca = env.DATABASE_CA_CERT?.replace(/\\n/g, '\n').trim();
  let ssl: pg.PoolConfig['ssl'];
  if (!local) {
    // Supabase signs its database certificates with its own root CA. With DATABASE_CA_CERT
    // (the CA from the Supabase dashboard) the certificate is verified; without it the
    // connection is still encrypted but the server is not authenticated, so say so (AUD-20).
    if (ca) {
      ssl = { ca, rejectUnauthorized: true };
    } else {
      ssl = { rejectUnauthorized: false };
      warn(DATABASE_CA_WARNING);
    }
  }
  const isServerless = Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME);
  return {
    connectionString: url.toString(),
    ssl,
    max: resolvePoolMax(settings.max, env, isServerless),
    idleTimeoutMillis: isServerless ? 5_000 : 10_000,
    connectionTimeoutMillis: 15_000,
    ...(isServerless ? { allowExitOnIdle: true } : {}),
  };
}
