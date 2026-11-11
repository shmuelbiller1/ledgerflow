import { createHash } from 'crypto';
import { getDb } from '../db/firestore';
import type { Transaction as FirestoreTransaction } from '../db/firestore';
import { byCodeUnit } from '../../lib/codeUnitOrder';

export interface IdempotencyRecord {
  id: string;
  actor: string;
  workspaceId: string;
  operationType: string;
  createdAt: string;
  updatedAt?: string;
  status: 'pending' | 'success' | 'failed';
  payloadHash?: string;
  result?: unknown;
  error?: string;
  expiresAt: string;
}

/** JSON with keys sorted at every level, so the same request always gives the same text. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort(byCodeUnit).filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** AUD-07: a fingerprint of what was asked (the operation id itself left out). */
export function requestPayloadHash(body: unknown): string {
  const rest = body && typeof body === 'object' && !Array.isArray(body)
    ? Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([k]) => k !== 'operationId'))
    : body;
  return createHash('sha256').update(stableJson(rest)).digest('hex');
}

/** AUD-07: the same key reused by someone else or for a different request is refused (409), never replayed. */
export function assertSameRequest(stored: { actor?: unknown; payloadHash?: unknown } | undefined, actor: string, payloadHash?: string): void {
  if (!stored) return;
  if (typeof stored.actor === 'string' && stored.actor && stored.actor !== actor) {
    throw Object.assign(new Error('This operation id was already used by another user'), { status: 409 });
  }
  if (payloadHash && typeof stored.payloadHash === 'string' && stored.payloadHash !== payloadHash) {
    throw Object.assign(new Error('This operation id was already used for a different request'), { status: 409 });
  }
}

/**
 * Derives the canonical scoped operation key: workspace:operationType:operationId
 */
export function deriveScopedOperationKey(workspaceId: string, operationType: string, operationId: string): string {
  const sanitizedWs = workspaceId || 'system';
  return `${sanitizedWs}:${operationType}:${operationId}`;
}

/**
 * Extracts a canonical operation ID from request headers or body.
 * Sources in priority order:
 * 1. 'x-operation-id' header
 * 2. 'idempotency-key' header
 * 3. req.body.operationId
 * 4. req.query.operationId
 */
export function extractCanonicalOperationId(req: { headers?: Record<string, unknown>; body?: Record<string, unknown>; query?: Record<string, unknown> } | null | undefined): string | undefined {
  if (!req) return undefined;
  const headerOpId = req.headers?.['x-operation-id'] || req.headers?.['idempotency-key'];
  if (typeof headerOpId === 'string' && headerOpId.trim()) return headerOpId.trim();
  if (req.body && typeof req.body.operationId === 'string' && req.body.operationId.trim()) return req.body.operationId.trim();
  if (req.query && typeof req.query.operationId === 'string' && req.query.operationId.trim()) return req.query.operationId.trim();
  return undefined;
}

/**
 * Ensures an operation is executed exactly once using ONE atomic Firestore transaction.
 *
 * Canonical Architecture:
 * Command -> Idempotency record -> ONE Firestore transaction:
 *   ├─ read idempotency key
 *   ├─ read/validate relevant documents (via transactionHandler)
 *   ├─ write ledger mutation / audit writes (via transactionHandler)
 *   └─ write idempotency success record
 *
 * @param scopedOperationId The canonical scoped key (e.g., "workspace1:TRANSACTION_CREATE:op123")
 * @param metadata Contextual info about the operation
 * @param transactionHandler Callback receiving the active Firestore transaction
 */
export async function executeIdempotent<T>(
  scopedOperationId: string,
  metadata: {
    actor: string;
    workspaceId: string;
    operationType: string;
    payloadHash?: string;
  },
  transactionHandler: (t: FirestoreTransaction) => Promise<T>
): Promise<T> {
  const db = getDb();
  const keyRef = db.collection('idempotencyKeys').doc(scopedOperationId);

  return await db.runTransaction(async (t) => {
    // 1. Read idempotency record (must happen before any writes)
    const doc = await t.get(keyRef);

    if (doc.exists) {
      const data = doc.data() as IdempotencyRecord;
      if (data.status === 'success') {
        assertSameRequest(data, metadata.actor, metadata.payloadHash);
        return data.result as T;
      }
      if (data.status === 'pending') {
        const createdAt = new Date(data.createdAt).getTime();
        const now = Date.now();
        // Allow retry if stuck in pending for > 5 minutes
        if (now - createdAt < 5 * 60 * 1000) {
          throw Object.assign(new Error(`Operation ${scopedOperationId} is currently in progress.`), { status: 409 });
        }
      }
    }

    // 2. Execute transactionHandler within the same transaction context
    const result = await transactionHandler(t);

    // 3. Write idempotency success record inside the same transaction
    const record: IdempotencyRecord = {
      id: scopedOperationId,
      actor: metadata.actor,
      workspaceId: metadata.workspaceId,
      operationType: metadata.operationType,
      ...(metadata.payloadHash ? { payloadHash: metadata.payloadHash } : {}),
      createdAt: doc.exists ? (doc.data()?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'success',
      result: result !== undefined ? result : null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };

    t.set(keyRef, record, { merge: true });

    return result;
  });
}
