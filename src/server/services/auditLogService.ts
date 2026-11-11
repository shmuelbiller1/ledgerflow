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
}

export function buildAuditLogRecord(input: AuditLogEntryInput, id: string) {
  const timestamp = input.timestamp || new Date().toISOString();
  const email = input.email || '';
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
    timestamp
  };
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
  const record = buildAuditLogRecord(input, auditRef.id);

  if (options?.tx && typeof options.tx.set === 'function') {
    options.tx.set(auditRef, record);
  } else if (typeof auditRef.set === 'function') {
    await auditRef.set(record);
  }

  return auditRef.id;
}
