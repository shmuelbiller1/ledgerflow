import crypto from 'node:crypto';
import type { DocumentData, DocumentReference, Firestore } from '../db/firestore';
import { getDb } from '../db/firestore';
import { computeAuditEntryHash, GENESIS_AUDIT_HASH } from '../../lib/auditHashChain';

type AuditWriter = {
  set(ref: DocumentReference, data: DocumentData): unknown;
  nextAuditChainHead?(workspaceId: string, genesisHash: string): Promise<AuditChainHead>;
};

export interface AuditLogEntryInput {
  workspaceId: string;
  uid: string;
  email?: string;
  action: string;
  entityType: string;
  entityId: string;
  details: {
    description: string;
    [key: string]: unknown;
  };
  severity?: string;
  timestamp?: string;
  prevHash?: string;
}

export interface AuditChainHead {
  seq: number;
  prevHash: string;
}

export const AUDIT_CHAIN_GENESIS = 'GENESIS';

const chainHeadsByWorkspace = new Map<string, AuditChainHead>();

export function computeAuditChainHash(record: {
  id: string;
  workspaceId: string;
  uid: string;
  action: string;
  entityType: string;
  entityId: string;
  timestamp: string;
  prevHash: string;
}): string {
  const canonical = JSON.stringify([
    record.prevHash,
    record.id,
    record.workspaceId,
    record.uid,
    record.action,
    record.entityType,
    record.entityId,
    record.timestamp,
  ]);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function verifyAuditHashChain(
  entries: Array<{
    id: string;
    workspaceId: string;
    uid: string;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
    timestamp: string;
    seq?: number;
    prevHash?: string;
    chainHash?: string;
    entryHash?: string;
  }>,
): { valid: boolean; brokenAtId?: string } {
  let expectedPrevChain: string | null = null;
  let expectedPrevEntry: string | null = null;
  for (const entry of entries) {
    if (!entry.chainHash && !entry.entryHash) continue;
    const prevHash = entry.prevHash || AUDIT_CHAIN_GENESIS;
    if (expectedPrevChain !== null || expectedPrevEntry !== null) {
      const matchesChain = expectedPrevChain !== null && prevHash === expectedPrevChain;
      const matchesEntry = expectedPrevEntry !== null && prevHash === expectedPrevEntry;
      if (!matchesChain && !matchesEntry) {
        return { valid: false, brokenAtId: entry.id };
      }
    }
    if (entry.chainHash) {
      const recomputed = computeAuditChainHash({ ...entry, prevHash });
      if (recomputed !== entry.chainHash) {
        return { valid: false, brokenAtId: entry.id };
      }
    }
    if (entry.entryHash && typeof entry.seq === 'number') {
      const recomputedEntry = computeAuditEntryHash(entry, entry.seq, prevHash);
      if (recomputedEntry !== entry.entryHash) {
        return { valid: false, brokenAtId: entry.id };
      }
    }
    expectedPrevChain = entry.chainHash ?? null;
    expectedPrevEntry = entry.entryHash ?? null;
  }
  return { valid: true };
}

export function buildAuditLogRecord(
  input: AuditLogEntryInput,
  id: string,
  chainOrPrevHash?: AuditChainHead | string,
) {
  const head: AuditChainHead = typeof chainOrPrevHash === 'object' && chainOrPrevHash !== null
    ? chainOrPrevHash
    : { seq: 1, prevHash: typeof chainOrPrevHash === 'string' ? chainOrPrevHash : (input.prevHash || GENESIS_AUDIT_HASH) };
  const timestamp = input.timestamp || new Date().toISOString();
  const email = input.email || '';
  const base = {
    id,
    uid: input.uid,
    userId: input.uid,
    actorUid: input.uid,
    email,
    userEmail: email,
    actorEmail: email,
    workspaceId: input.workspaceId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    details: input.details,
    severity: input.severity || 'info',
    timestamp,
  };
  const chainHash = computeAuditChainHash({
    id,
    workspaceId: input.workspaceId,
    uid: input.uid,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    timestamp,
    prevHash: head.prevHash,
  });
  const entryHash = computeAuditEntryHash(base, head.seq, head.prevHash);
  return {
    ...base,
    seq: head.seq,
    prevHash: head.prevHash,
    chainHash,
    entryHash,
    chainAlgo: 'sha256' as const,
  };
}

async function resolveNextChainHead(
  db: Firestore,
  workspaceId: string,
  hasOpenTx: boolean,
): Promise<AuditChainHead> {
  const cached = chainHeadsByWorkspace.get(workspaceId);
  if (cached) {
    return { seq: cached.seq + 1, prevHash: cached.prevHash };
  }
  // Never acquire a second pool connection while a transaction `tx` already holds one (EG-4).
  if (hasOpenTx) {
    return { seq: 1, prevHash: GENESIS_AUDIT_HASH };
  }
  try {
    const pool = (db as unknown as { pool?: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ seq?: string; hash?: string }> }> } }).pool;
    if (pool && typeof pool.query === 'function') {
      const res = await pool.query(
        `select data->>'seq' as seq, data->>'entryHash' as hash
           from public."auditLogs"
          where workspace_id = $1
            and (data->>'seq') ~ '^[0-9]+$'
            and jsonb_typeof(data->'entryHash') = 'string'
          order by (data->>'seq')::int desc
          limit 1`,
        [workspaceId],
      );
      const top = res.rows[0];
      if (top?.seq && top?.hash) {
        return { seq: Number(top.seq) + 1, prevHash: top.hash };
      }
      return { seq: 1, prevHash: GENESIS_AUDIT_HASH };
    }
    return { seq: 1, prevHash: GENESIS_AUDIT_HASH };
  } catch {
    return { seq: 1, prevHash: GENESIS_AUDIT_HASH };
  }
}

const workspaceAuditQueues = new Map<string, Promise<unknown>>();

function serializeWorkspaceAudit<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  const prev = workspaceAuditQueues.get(workspaceId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  workspaceAuditQueues.set(
    workspaceId,
    next.finally(() => {
      if (workspaceAuditQueues.get(workspaceId) === next) {
        workspaceAuditQueues.delete(workspaceId);
      }
    }),
  );
  return next;
}

export async function writeServerAuditLog(
  input: AuditLogEntryInput,
  options?: { db?: Firestore; tx?: AuditWriter },
): Promise<string> {
  const db = (options?.db || getDb()) as Firestore;
  if (typeof db?.collection !== 'function') return '';
  const col = db.collection('auditLogs');
  if (!col || typeof col.doc !== 'function') return '';
  const auditRef = col.doc();

  if (options?.tx) {
    const tx = options.tx;
    if (typeof tx.nextAuditChainHead === 'function') {
      const chainHead = await tx.nextAuditChainHead(input.workspaceId, GENESIS_AUDIT_HASH);
      const record = buildAuditLogRecord(input, auditRef.id, chainHead);
      tx.set(auditRef, record);
      return auditRef.id;
    }
    return serializeWorkspaceAudit(input.workspaceId, async () => {
      // Do not cache speculative seq/prevHash across an uncommitted caller transaction:
      // if the outer runTransaction rolls back, a cached head would break all later entries.
      chainHeadsByWorkspace.delete(input.workspaceId);
      const chainHead = await resolveNextChainHead(db, input.workspaceId, true);
      const record = buildAuditLogRecord(input, auditRef.id, chainHead);
      tx.set(auditRef, record);
      return auditRef.id;
    });
  }

  return serializeWorkspaceAudit(input.workspaceId, async () => {
    const maybeRunTx = (db as unknown as { runTransaction?: <R>(fn: (tx: AuditWriter) => Promise<R>) => Promise<R> }).runTransaction;
    if (typeof maybeRunTx === 'function') {
      await db.runTransaction(async tx => {
        const writer = tx as unknown as AuditWriter;
        const chainHead = typeof writer.nextAuditChainHead === 'function'
          ? await writer.nextAuditChainHead(input.workspaceId, GENESIS_AUDIT_HASH)
          : await resolveNextChainHead(db, input.workspaceId, true);
        const record = buildAuditLogRecord(input, auditRef.id, chainHead);
        writer.set(auditRef, record);
      });
      chainHeadsByWorkspace.delete(input.workspaceId);
      return auditRef.id;
    }

    const chainHead = await resolveNextChainHead(db, input.workspaceId, false);
    const record = buildAuditLogRecord(input, auditRef.id, chainHead);
    if (typeof auditRef.set === 'function') {
      await auditRef.set(record);
    }
    chainHeadsByWorkspace.set(input.workspaceId, { seq: chainHead.seq, prevHash: record.entryHash });
    return auditRef.id;
  });
}
