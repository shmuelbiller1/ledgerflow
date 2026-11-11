import type { Transaction } from '../types';
import { isPostable, lineAmount } from './txFilters';

/**
 * Strategy 5 — Cryptographic SHA-256 Hash-Chained Audit Trail & Ledger Close Anchor.
 *
 * Pure, synchronous FIPS 180-4 SHA-256 implementation so both browser bundles and Node server
 * services compute identical digests without `node:crypto` bundler shims or async SubtleCrypto.
 */

export const GENESIS_AUDIT_HASH = '0'.repeat(64);

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** Exact FIPS 180-4 SHA-256 hex digest over UTF-8 text. */
export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const totalLen = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const hiBits = Math.floor(bitLen / 0x100000000);
  const loBits = bitLen >>> 0;
  view.setUint32(totalLen - 8, hiBits, false);
  view.setUint32(totalLen - 4, loBits, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map(v => v.toString(16).padStart(8, '0'))
    .join('');
}

/** Deterministic canonical JSON serializer (sorts object keys recursively). */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter(k => record[k] !== undefined)
      .sort((a, b) => a.localeCompare(b, 'en'));
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

export interface HashChainableAuditEntry {
  id: string;
  workspaceId?: string;
  uid?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  timestamp?: string | number | { toDate(): Date };
  seq?: number;
  prevHash?: string;
  entryHash?: string;
  chainAlgo?: 'sha256';
}

function normalizeTimestamp(ts: HashChainableAuditEntry['timestamp']): string {
  if (!ts) return '';
  if (typeof ts === 'string') return ts;
  if (typeof ts === 'number') return new Date(ts).toISOString();
  if (typeof ts === 'object' && typeof ts.toDate === 'function') return ts.toDate().toISOString();
  return String(ts);
}

/** Canonical string hashed to produce an audit record's `entryHash`. */
export function canonicalAuditPayload(
  entry: HashChainableAuditEntry,
  seq: number,
  prevHash: string,
): string {
  return canonicalJson({
    v: 1,
    seq,
    prevHash,
    id: String(entry.id || ''),
    workspaceId: String(entry.workspaceId || ''),
    timestamp: normalizeTimestamp(entry.timestamp),
    uid: String(entry.uid || ''),
    action: String(entry.action || ''),
    entityType: String(entry.entityType || ''),
    entityId: String(entry.entityId || ''),
    details: entry.details ?? {},
  });
}

export function computeAuditEntryHash(
  entry: HashChainableAuditEntry,
  seq: number,
  prevHash: string,
): string {
  return sha256Hex(canonicalAuditPayload(entry, seq, prevHash));
}

export interface ChainedAuditEntry extends HashChainableAuditEntry {
  seq: number;
  prevHash: string;
  entryHash: string;
  chainAlgo: 'sha256';
}

/** Chains an ordered array of audit entries starting from `startSeq` and `initialPrevHash`. */
export function chainAuditEntries<T extends HashChainableAuditEntry>(
  entries: readonly T[],
  startSeq = 1,
  initialPrevHash = GENESIS_AUDIT_HASH,
): Array<T & ChainedAuditEntry> {
  let prevHash = initialPrevHash;
  let seq = startSeq;
  return entries.map(entry => {
    const entryHash = computeAuditEntryHash(entry, seq, prevHash);
    const chained = {
      ...entry,
      seq,
      prevHash,
      entryHash,
      chainAlgo: 'sha256' as const,
    };
    prevHash = entryHash;
    seq += 1;
    return chained;
  });
}

export interface AuditChainVerification {
  valid: boolean;
  checkedCount: number;
  chainedCount: number;
  legacyUnchainedCount: number;
  headHash: string;
  brokenAtSeq: number | null;
  brokenEntryId: string | null;
  reason: string | null;
}

/**
 * Verifies the cryptographic integrity of a workspace's audit trail.
 * - Legacy pre-chain entries (without `entryHash` / `seq`) are counted in `legacyUnchainedCount`
 *   so existing workspaces verify cleanly when hash-chaining is enabled.
 * - Once chaining starts, any mutated field, deleted sequence number, swapped `prevHash`, or
 *   stripped `entryHash` is caught immediately with the exact `brokenAtSeq` and `brokenEntryId`.
 */
export function verifyAuditHashChain(entries: readonly HashChainableAuditEntry[]): AuditChainVerification {
  if (entries.length === 0) {
    return {
      valid: true,
      checkedCount: 0,
      chainedCount: 0,
      legacyUnchainedCount: 0,
      headHash: GENESIS_AUDIT_HASH,
      brokenAtSeq: null,
      brokenEntryId: null,
      reason: null,
    };
  }

  // Sort chained entries by seq ascending; unchained entries precede chained ones by timestamp
  const legacy: HashChainableAuditEntry[] = [];
  const chained: HashChainableAuditEntry[] = [];
  let seenChained = false;

  const chronological = [...entries].sort((a, b) => {
    const aHasSeq = typeof a.seq === 'number';
    const bHasSeq = typeof b.seq === 'number';
    if (aHasSeq && bHasSeq) return (a.seq as number) - (b.seq as number);
    if (aHasSeq !== bHasSeq) return aHasSeq ? 1 : -1;
    return normalizeTimestamp(a.timestamp).localeCompare(normalizeTimestamp(b.timestamp));
  });

  for (const entry of chronological) {
    const isChained = typeof entry.seq === 'number' || Boolean(entry.entryHash) || Boolean(entry.prevHash);
    if (!isChained) {
      if (seenChained) {
        return {
          valid: false,
          checkedCount: chronological.length,
          chainedCount: chained.length,
          legacyUnchainedCount: legacy.length,
          headHash: chained.length > 0 ? String(chained[chained.length - 1].entryHash || '') : GENESIS_AUDIT_HASH,
          brokenAtSeq: null,
          brokenEntryId: entry.id || null,
          reason: `Unchained audit entry "${entry.id}" appeared after hash-chaining started`,
        };
      }
      legacy.push(entry);
    } else {
      seenChained = true;
      chained.push(entry);
    }
  }

  if (chained.length === 0) {
    return {
      valid: true,
      checkedCount: entries.length,
      chainedCount: 0,
      legacyUnchainedCount: legacy.length,
      headHash: GENESIS_AUDIT_HASH,
      brokenAtSeq: null,
      brokenEntryId: null,
      reason: null,
    };
  }

  let expectedSeq = chained[0].seq ?? 1;
  // Anchor starts at GENESIS_AUDIT_HASH for seq 1, or at the window's starting prevHash for paginated slices
  let expectedPrevHash = expectedSeq === 1 ? GENESIS_AUDIT_HASH : String(chained[0].prevHash || '');

  for (const entry of chained) {
    if (typeof entry.seq !== 'number' || !entry.prevHash || !entry.entryHash) {
      return {
        valid: false,
        checkedCount: entries.length,
        chainedCount: chained.length,
        legacyUnchainedCount: legacy.length,
        headHash: expectedPrevHash,
        brokenAtSeq: typeof entry.seq === 'number' ? entry.seq : expectedSeq,
        brokenEntryId: entry.id || null,
        reason: `Audit entry "${entry.id}" is missing required hash-chain fields`,
      };
    }

    if (entry.seq !== expectedSeq) {
      return {
        valid: false,
        checkedCount: entries.length,
        chainedCount: chained.length,
        legacyUnchainedCount: legacy.length,
        headHash: expectedPrevHash,
        brokenAtSeq: entry.seq,
        brokenEntryId: entry.id || null,
        reason: `Sequence gap detected: expected seq ${expectedSeq}, found seq ${entry.seq} (entry deleted or reordered)`,
      };
    }

    if (entry.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        checkedCount: entries.length,
        chainedCount: chained.length,
        legacyUnchainedCount: legacy.length,
        headHash: expectedPrevHash,
        brokenAtSeq: entry.seq,
        brokenEntryId: entry.id || null,
        reason: `prevHash mismatch at seq ${entry.seq}: expected ${expectedPrevHash.slice(0, 12)}…, found ${entry.prevHash.slice(0, 12)}…`,
      };
    }

    const recomputed = computeAuditEntryHash(entry, entry.seq, entry.prevHash);
    if (recomputed !== entry.entryHash) {
      return {
        valid: false,
        checkedCount: entries.length,
        chainedCount: chained.length,
        legacyUnchainedCount: legacy.length,
        headHash: expectedPrevHash,
        brokenAtSeq: entry.seq,
        brokenEntryId: entry.id || null,
        reason: `Tampered payload at seq ${entry.seq} (entry "${entry.id}"): entryHash mismatch`,
      };
    }

    expectedPrevHash = entry.entryHash;
    expectedSeq += 1;
  }

  return {
    valid: true,
    checkedCount: entries.length,
    chainedCount: chained.length,
    legacyUnchainedCount: legacy.length,
    headHash: expectedPrevHash,
    brokenAtSeq: null,
    brokenEntryId: null,
    reason: null,
  };
}

/**
 * Computes a deterministic SHA-256 close anchor over all posted ledger transactions
 * (optionally on or before `asOfDate`), replacing the old XOR placeholder.
 */
export function computeLedgerCloseAnchor(
  transactions: readonly Transaction[],
  asOfDate?: string,
): { sha256: string; shortAnchor: string; postedEntryCount: number; totalDebitsCents: number; totalCreditsCents: number } {
  const postable = transactions
    .filter(tx => isPostable(tx) && (!asOfDate || String(tx.date || '').slice(0, 10) <= asOfDate))
    .slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.id).localeCompare(String(b.id)));

  let totalDebitsCents = 0;
  let totalCreditsCents = 0;

  const canonicalEntries = postable.map(tx => {
    const lines = (tx.lines || [])
      .map(l => {
        const amt = lineAmount(l, tx);
        if (amt > 0) totalDebitsCents += amt;
        else totalCreditsCents += Math.abs(amt);
        return {
          accountId: String(l.accountId || ''),
          amountCents: Math.trunc(amt),
        };
      })
      .sort((x, y) => x.accountId.localeCompare(y.accountId) || x.amountCents - y.amountCents);
    return {
      id: String(tx.id || ''),
      date: String(tx.date || '').slice(0, 10),
      totalAmountCents: Math.trunc(tx.totalAmountCents || 0),
      lines,
    };
  });

  const digest = sha256Hex(canonicalJson({ v: 1, asOfDate: asOfDate || null, entries: canonicalEntries }));
  return {
    sha256: digest,
    shortAnchor: `sha256:${digest.slice(0, 16)}`,
    postedEntryCount: postable.length,
    totalDebitsCents,
    totalCreditsCents,
  };
}
