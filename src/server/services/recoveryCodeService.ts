import crypto from 'crypto';
import type { Firestore, Transaction } from '../db/firestore';
import { logger } from '../utils/logger';
import { forgetAuthenticator } from '../auth/supabaseAuth';

/**
 * Recovery codes for two-step login (L-85). Someone with an authenticator app makes ten one-time
 * codes (shown once; only keyed hashes are kept, in `recoveryCodes`, server-only). If they lose the
 * phone, they sign in with the password and enter one code: it is used up, their authenticator is
 * removed, and they can sign in and set up two-step login again. Five wrong
 * codes in an hour lock the step for that hour.
 */
export class RecoveryError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export const CODE_COUNT = 10;
const MAX_FAILURES = 5;
const HOUR_MS = 60 * 60 * 1000;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i: easy to copy by hand

interface Stored { uid: string; codes: Array<{ hash: string; usedAt?: string }>; createdAt: string; failures?: string[] }

const normalise = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

function keyedHash(uid: string, code: string): string {
  const salt = process.env.SYSTEM_SALT;
  if (!salt) throw new RecoveryError(503, 'Recovery codes are not set up on the server yet');
  return crypto.createHmac('sha256', salt).update(`${uid}\u0000${normalise(code)}`).digest('hex');
}

function newCode(): string {
  const targetLen = 10;
  const n = ALPHABET.length;
  const limit = Math.floor(256 / n) * n; // largest multiple of n below 256
  let chars = '';

  while (chars.length < targetLen) {
    const bytes = crypto.randomBytes(targetLen - chars.length);
    for (const b of bytes) {
      if (b >= limit) continue; // reject to avoid modulo bias
      chars += ALPHABET[b % n];
      if (chars.length === targetLen) break;
    }
  }

  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** The ids of the person's confirmed authenticators (reads Supabase's auth tables, read-only). */
export async function verifiedFactors(db: Firestore, uid: string): Promise<string[]> {
  const { rows } = await db.pool.query<{ id: string }>(
    `select id::text from auth.mfa_factors where user_id = $1::uuid and factor_type::text = 'totp' and status::text = 'verified'`, [uid]);
  return rows.map(r => r.id);
}

/**
 * Removes one of the person's authenticators, the way the server already removes sign-in data
 * (supabaseAuth.ts deleteUser): straight from Supabase's auth tables. Its pending challenges go with
 * it. Replaced in tests that need a failure.
 */
let removeFactor = async (db: Firestore, uid: string, factorId: string): Promise<void> => {
  await db.pool.query('delete from auth.mfa_factors where id = $1::uuid and user_id = $2::uuid', [factorId, uid]);
};
export function setFactorRemoverForTests(fn: typeof removeFactor) { removeFactor = fn; }

export async function recoveryStatus(db: Firestore, uid: string): Promise<{ left: number; total: number; createdAt: string | null }> {
  const stored = (await db.collection('recoveryCodes').doc(uid).get()).data() as Stored | undefined;
  if (!stored) return { left: 0, total: 0, createdAt: null };
  return { left: stored.codes.filter(c => !c.usedAt).length, total: stored.codes.length, createdAt: stored.createdAt };
}

/** Ten new codes and the keyed-hash record that replaces any earlier one (no database write here). */
export function buildRecoveryCodes(uid: string): { codes: string[]; stored: Stored } {
  const codes = Array.from({ length: CODE_COUNT }, newCode);
  const stored: Stored = { uid, codes: codes.map(c => ({ hash: keyedHash(uid, c) })), createdAt: new Date().toISOString() };
  return { codes, stored };
}

/** Ten new codes, replacing any earlier ones. Only for someone who has two-step login on. */
export async function makeRecoveryCodes(db: Firestore, uid: string): Promise<string[]> {
  if ((await verifiedFactors(db, uid)).length === 0) throw new RecoveryError(409, 'Turn on two-step login first; recovery codes are for when the authenticator is lost');
  const { codes, stored } = buildRecoveryCodes(uid);
  await db.collection('recoveryCodes').doc(uid).set(stored);
  return codes;
}

/** The unused code this text matches, if any (a wrong code matches nothing). */
function matchingIndex(stored: Stored | undefined, hash: string): number {
  if (!stored) return -1;
  return stored.codes.findIndex(c => !c.usedAt && crypto.timingSafeEqual(Buffer.from(c.hash), Buffer.from(hash)));
}

function recentFailures(stored: Stored | undefined, now: Date): string[] {
  return (stored?.failures || []).filter(at => now.getTime() - Date.parse(at) < HOUR_MS);
}

/**
 * Checks one code before spending it: the lockout first, then whether the code is one of the unused
 * ones. A wrong code is counted here, in its own write, because the refusal that follows rolls the
 * runner's transaction back — a count kept inside it would never survive.
 */
export async function prepareUseRecoveryCode(db: Firestore, uid: string, code: string, now = new Date()): Promise<void> {
  const hash = keyedHash(uid, code);
  const ref = db.collection('recoveryCodes').doc(uid);
  await db.runTransaction(async t => {
    const stored = (await t.get(ref)).data() as Stored | undefined;
    const recent = recentFailures(stored, now);
    if (recent.length >= MAX_FAILURES) throw new RecoveryError(429, 'Too many wrong codes. Try again in an hour');
    if (matchingIndex(stored, hash) !== -1) return;
    if (stored) t.update(ref, { failures: [...recent, now.toISOString()] });
  });
  const stored = (await ref.get()).data() as Stored | undefined;
  if (matchingIndex(stored, hash) === -1) throw new RecoveryError(400, 'That recovery code is not right, or was used before');
}

/**
 * Spends the code inside a transaction the caller owns and returns how many are left. It checks the
 * same two things again: the read in `prepareUseRecoveryCode` happened before this transaction, and
 * two requests may race for the last unused code.
 */
export async function spendRecoveryCode(db: Firestore, t: Transaction, uid: string, code: string, now = new Date()): Promise<{ left: number }> {
  const hash = keyedHash(uid, code);
  const ref = db.collection('recoveryCodes').doc(uid);
  const stored = (await t.get(ref)).data() as Stored | undefined;
  if (recentFailures(stored, now).length >= MAX_FAILURES) throw new RecoveryError(429, 'Too many wrong codes. Try again in an hour');
  const index = matchingIndex(stored, hash);
  if (index === -1) throw new RecoveryError(400, 'That recovery code is not right, or was used before');
  const codes = stored!.codes.map((c, i) => (i === index ? { ...c, usedAt: now.toISOString() } : c));
  t.update(ref, { codes, failures: [] });
  return { left: codes.filter(c => !c.usedAt).length };
}

/**
 * Gives a spent code back, for when the authenticator could not be removed: without this the person
 * has burned a way in and still cannot sign in. True when the code is unused again.
 */
export async function restoreRecoveryCode(db: Firestore, uid: string, code: string): Promise<boolean> {
  const hash = keyedHash(uid, code);
  try {
    return await db.runTransaction(async t => {
      const ref = db.collection('recoveryCodes').doc(uid);
      const stored = (await t.get(ref)).data() as Stored | undefined;
      if (!stored) return false;
      const used = stored.codes.some(c => c.usedAt && crypto.timingSafeEqual(Buffer.from(c.hash), Buffer.from(hash)));
      if (!used) return false;
      // the record has no per-code id, so the hash is the match (only the person's own code can hit it)
      const codes = stored.codes.map(c => (c.usedAt && crypto.timingSafeEqual(Buffer.from(c.hash), Buffer.from(hash)) ? { hash: c.hash } : c));
      t.update(ref, { codes });
      return true;
    });
  } catch (error) {
    logger.error('recovery code could not be given back after a failed authenticator removal', { uid, error: String(error) });
    return false;
  }
}

/**
 * Removes the person's authenticators (the point of spending a code): they sign in with the password
 * alone and set two-step login up again. Idempotent, so a retried command may run it again safely.
 */
export async function removeAuthenticators(db: Firestore, uid: string): Promise<void> {
  const factors = await verifiedFactors(db, uid);
  for (const factorId of factors) await removeFactor(db, uid, factorId);
  forgetAuthenticator(uid);
  logger.info('recovery code used; authenticator removed', { uid, factors: factors.length });
}

/**
 * Uses one code: right → it is spent and the authenticator removed (the person signs in with the
 * password alone and can set two-step login up again); wrong → counted, five an hour at most.
 */
export async function useRecoveryCode(db: Firestore, uid: string, code: string, now = new Date()): Promise<{ left: number }> {
  await prepareUseRecoveryCode(db, uid, code, now);
  const { left } = await db.runTransaction(t => spendRecoveryCode(db, t, uid, code, now));
  try {
    await removeAuthenticators(db, uid);
  } catch (err) {
    // the authenticator is still there: give the code back so it can be tried again later
    await db.runTransaction(async t => {
      const ref = db.collection('recoveryCodes').doc(uid);
      const stored = (await t.get(ref)).data() as Stored | undefined;
      const hash = keyedHash(uid, code);
      if (stored) t.update(ref, { codes: stored.codes.map(c => (c.hash === hash ? { hash: c.hash } : c)) });
    });
    throw err;
  }
  return { left };
}
