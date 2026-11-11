import crypto from 'node:crypto';
import type { DocumentData, DocumentReference, Firestore } from '../db/firestore';
import { getDb } from '../db/firestore';

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
  prevHash?: string;
}

export const AUDIT_CHAIN_GENESIS = 'GENESIS';

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
    timestamp: string;
    prevHash?: string;
    chainHash?: string;
  }>,
): { valid: boolean; brokenAtId?: string } {
  let expectedPrev = AUDIT_CHAIN_GENESIS;
  for (const entry of entries) {
    if (!entry.chainHash) continue;
    const prevHash = entry.prevHash || AUDIT_CHAIN_GENESIS;
    if (expectedPrev !== AUDIT_CHAIN_GENESIS && prevHash !== expectedPrev) {
      return { valid: false, brokenAtId: entry.id };
    }
    const recomputed = computeAuditChainHash({ ...entry, prevHash });
    if (recomputed !== entry.chainHash) {
      return { valid: false, brokenAtId: entry.id };
    }
    expectedPrev = entry.chainHash;
  }
  return { valid: true };
}

export function buildAuditLogRecord(input: AuditLogEntryInput, id: string, prevHash = input.prevHash || AUDIT_CHAIN_GENESIS) {
  const timestamp = input.timestamp || new Date().toISOString();
  const email = input.email || '';
  const chainHash = computeAuditChainHash({
    id,
    workspaceId: input.workspaceId,
    uid: input.uid,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    timestamp,
    prevHash,
  });
  return {
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
    prevHash,
    chainHash,
  };
}

async function resolveLatestChainHash(col: ReturnType<Firestore['collection']>, workspaceId: string): Promise<string> {
  try {
    if (!workspaceId || typeof col.where !== 'function') return AUDIT_CHAIN_GENESIS;
    const q = col.where('workspaceId', '==', workspaceId);
    const ordered = typeof q.orderBy === 'function' ? q.orderBy('timestamp', 'desc') : q;
    const limited = typeof ordered.limit === 'function' ? ordered.limit(1) : ordered;
    if (typeof limited.get !== 'function') return AUDIT_CHAIN_GENESIS;
    const snap = await limited.get();
    const prev = snap?.docs?.[0]?.data?.()?.chainHash;
    return typeof prev === 'string' && prev.length > 0 ? prev : AUDIT_CHAIN_GENESIS;
  } catch {
    return AUDIT_CHAIN_GENESIS;
  }
}

export async function writeServerAuditLog(
  input: AuditLogEntryInput,
  options?: { db?: Firestore; tx?: AuditWriter }
): Promise<string> {
  const db = (options?.db || getDb()) as Firestore;
  if (typeof db?.collection !== 'function') return '';
  const col = db.collection('auditLogs');
  if (!col || typeof col.doc !== 'function') return '';
  const auditRef = col.doc();
  const prevHash = input.prevHash || (options?.tx ? AUDIT_CHAIN_GENESIS : await resolveLatestChainHash(col, input.workspaceId));
  const record = buildAuditLogRecord(input, auditRef.id, prevHash);

  if (options?.tx && typeof options.tx.set === 'function') {
    options.tx.set(auditRef, record);
  } else if (typeof auditRef.set === 'function') {
    await auditRef.set(record);
  }

  return auditRef.id;
}
