import type { DocumentData, DocumentReference, Firestore } from '../db/firestore';
import { getDb } from '../db/firestore';
import { computeAuditEntryHash, GENESIS_AUDIT_HASH } from '../../lib/auditHashChain';

type AuditWriter = { set(ref: DocumentReference, data: DocumentData): unknown };

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
}

export interface AuditChainHead {
  seq: number;
  prevHash: string;
}

const chainHeadsByWorkspace = new Map<string, AuditChainHead>();

export function buildAuditLogRecord(
  input: AuditLogEntryInput,
  id: string,
  chain?: AuditChainHead,
) {
  const head = chain ?? { seq: 1, prevHash: GENESIS_AUDIT_HASH };
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
  const entryHash = computeAuditEntryHash(base, head.seq, head.prevHash);
  return {
    ...base,
    seq: head.seq,
    prevHash: head.prevHash,
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

export async function writeServerAuditLog(
  input: AuditLogEntryInput,
  options?: { db?: Firestore; tx?: AuditWriter }
): Promise<string> {
  const db = (options?.db || getDb()) as Firestore;
  const auditRef = db.collection('auditLogs').doc();
  const chainHead = await resolveNextChainHead(db, input.workspaceId, Boolean(options?.tx));
  const record = buildAuditLogRecord(input, auditRef.id, chainHead);
  chainHeadsByWorkspace.set(input.workspaceId, { seq: chainHead.seq, prevHash: record.entryHash });

  if (options?.tx) {
    options.tx.set(auditRef, record);
  } else {
    await auditRef.set(record);
  }

  return auditRef.id;
}
