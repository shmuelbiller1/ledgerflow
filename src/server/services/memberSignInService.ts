/**
 * #945 / S-21: authoritative sign-in facts for workspace members, read from the auth provider's
 * own tables (not from the 500-row audit window the access review used to scan).
 */
import type { Firestore } from '../db/firestore';

export interface MemberSignInFacts {
  lastSignInAt: string | null;
  mfaEnrolled: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function memberSignInFacts(db: Firestore, uids: string[]): Promise<Record<string, MemberSignInFacts>> {
  const ids = Array.from(new Set(uids.filter(uid => typeof uid === 'string' && UUID.test(uid))));
  const out: Record<string, MemberSignInFacts> = {};
  if (!ids.length) return out;
  const result = await db.pool.query<{ id: string; last_sign_in_at: Date | string | null; mfa_enrolled: boolean }>(
    `select u.id::text as id, u.last_sign_in_at,
            exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as mfa_enrolled
       from auth.users u
      where u.id = any($1::uuid[]) and u.deleted_at is null`,
    [ids]);
  for (const row of result.rows) {
    const at = row.last_sign_in_at;
    out[row.id] = {
      lastSignInAt: at ? new Date(at).toISOString() : null,
      mfaEnrolled: row.mfa_enrolled === true,
    };
  }
  return out;
}
