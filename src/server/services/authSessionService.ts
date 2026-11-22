/**
 * #945 / S-28: a person's own sign-in sessions (one per device or browser) from the auth
 * provider's `auth.sessions`, and signing out just one of them. Deleting the session row also
 * ends its refresh tokens, so that device cannot get a new access token (the one it holds lasts
 * until it expires, at most an hour).
 */
import type { Firestore } from '../db/firestore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Columns Supabase has beyond id/user_id/created_at; older or test schemas may lack some. */
const OPTIONAL = ['updated_at', 'refreshed_at', 'user_agent', 'ip', 'aal', 'not_after'] as const;

export interface AuthSessionView {
  id: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  userAgent: string | null;
  ip: string | null;
  aal: string | null;
  current: boolean;
}

let optionalColumns: Promise<Set<string>> | null = null;
function presentColumns(db: Firestore): Promise<Set<string>> {
  optionalColumns ??= db.pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema = 'auth' and table_name = 'sessions'`)
    .then(r => new Set(r.rows.map(row => row.column_name)))
    .catch(err => { optionalColumns = null; throw err; });
  return optionalColumns;
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export async function listAuthSessions(db: Firestore, uid: string, currentSessionId?: string): Promise<AuthSessionView[]> {
  if (!UUID.test(uid)) return [];
  const have = await presentColumns(db);
  const extra = OPTIONAL.filter(c => have.has(c));
  const notExpired = have.has('not_after') ? 'and (s.not_after is null or s.not_after > now())' : '';
  const result = await db.pool.query<Record<string, unknown>>(
    `select s.id::text as id, s.created_at${extra.map(c => `, s.${c}${c === 'ip' ? '::text' : ''} as ${c}`).join('')}
       from auth.sessions s
      where s.user_id = $1::uuid ${notExpired}
      order by ${have.has('refreshed_at') ? 'coalesce(s.refreshed_at, s.updated_at, s.created_at)' : have.has('updated_at') ? 'coalesce(s.updated_at, s.created_at)' : 's.created_at'} desc
      limit 100`,
    [uid]);
  return result.rows.map(row => ({
    id: String(row.id),
    createdAt: iso(row.created_at),
    lastActiveAt: iso(row.refreshed_at ?? row.updated_at ?? row.created_at),
    userAgent: typeof row.user_agent === 'string' ? row.user_agent.slice(0, 300) : null,
    ip: row.ip ? String(row.ip).replace(/\/\d+$/, '') : null,
    aal: typeof row.aal === 'string' ? row.aal : null,
    current: Boolean(currentSessionId) && String(row.id) === currentSessionId,
  }));
}

/** Signs out one of the person's own sessions. False when it is not theirs or already gone. */
export async function revokeAuthSession(db: Firestore, uid: string, sessionId: string): Promise<boolean> {
  if (!UUID.test(uid) || !UUID.test(sessionId)) return false;
  const result = await db.pool.query(
    'delete from auth.sessions where id = $1::uuid and user_id = $2::uuid', [sessionId, uid]);
  return (result.rowCount ?? 0) > 0;
}
