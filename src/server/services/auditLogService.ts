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

export function buildAuditLogRecord(
  input: AuditLogEntryInput,
  id: string,
  chain: AuditChainHead = { seq: 1, prevHash: GENESIS_AUDIT_HASH },
) {
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
  const entryHash = computeAuditEntryHash(base, chain.seq, chain.prevHash);
  return {
    ...base,
    seq: chain.seq,
    prevHash: chain.prevHash,
    entryHash,
    chainAlgo: 'sha256' as const,
  };
}

async function resolveNextChainHead(db: Firestore, workspaceId: string): Promise<AuditChainHead> {
  try {
    const col = db.collection('auditLogs');
    if (!col || typeof col.where !== 'function') {
      return { seq: 1, prevHash: GENESIS_AUDIT_HASH };
    }
    const snap = await col.where('workspaceId', '==', workspaceId).get();
    let maxSeq = 0;
    let headHash = GENESIS_AUDIT_HASH;
    for (const doc of snap.docs || []) {
      const d = doc.data() || {};
      if (typeof d.seq === 'number' && typeof d.entryHash === 'string' && d.seq > maxSeq) {
        maxSeq = d.seq;
        headHash = d.entryHash;
      }
    }
    return { seq: maxSeq + 1, prevHash: headHash };
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
  const chainHead = await resolveNextChainHead(db, input.workspaceId);
  const record = buildAuditLogRecord(input, auditRef.id, chainHead);

  if (options?.tx) {
    options.tx.set(auditRef, record);
  } else {
    await auditRef.set(record);
  }

  return auditRef.id;
}
