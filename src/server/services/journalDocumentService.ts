/**
 * The steps that post one journal entry for a document-flavoured write (ASC 842 lease
 * capitalisation, ASC 606 revenue recognition), lifted out of the legacy route helper so that a
 * registered command and the address that has always answered it run the same code in the same
 * order.
 *
 * The steps, in order, and why the order matters:
 *   1. the body is validated before any read (a malformed body is a 400, AUD-09);
 *   2. the caller is a member of the workspace and may post entries;
 *   3. the posting date is today in the workspace's timezone unless one was sent, and the period
 *      that date falls in must be open;
 *   4. the journal is validated by the canonical validator (#102-R);
 *   5. the commit re-reads the workspace inside the transaction and checks membership, the posting
 *      role and the lock again — the first read only answers quickly, it does not authorise the write;
 *   6. the entry, the audit log and the idempotency record go in together (runOptionalIdempotent).
 *
 * Nothing here decides what the entry is; the caller names the account pair, the amount and the
 * audit line, so the same machinery serves a lease, a revenue recognition and anything like them.
 */
import type { z, ZodType } from 'zod';
import { assertPeriodOpen, FieldValue, isWorkspaceMemberData, validateWorkspaceMember } from '../db/firestore';
import type { Firestore, Transaction } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { getDateInTimezoneISO } from '../../lib/calendarDate';
import { lockMessage, postingLock } from '../../lib/periodLock';
import { mayPostEntries } from '../http/ledgerWriter';
import { ledgerCreate } from './ledgerDoor';
import { writeServerAuditLog } from './auditLogService';
import { runOptionalIdempotent } from '../utils/idempotency';

/** The refusal a caller who is a member but may not post entries is answered with. */
export const POST_REFUSAL = 'Only owners, accountants and bookkeepers post entries'; // AUD-09

/** One line of the journal the route posts: an account and its signed amount. */
export interface JournalLine {
  accountId: string;
  amountCents: number;
  description: string;
}

export interface JournalDocumentSpec<Schema extends ZodType> {
  /** the idempotency scope, e.g. `LEASE_CAPITALIZE` */
  operationType: string;
  /** the legacy key prefix the old route used: `${workspaceId}_${legacyPrefix}_${operationId}` */
  legacyPrefix: string;
  /** answered on success beside the transaction id */
  message: string;
  /** the description written on the journal transaction */
  description(input: z.infer<Schema>): string;
  totalAmountCents(input: z.infer<Schema>): number;
  lines(input: z.infer<Schema>): JournalLine[];
  /** the idempotency id derived from the input when the caller sent no `operationId` */
  operationId?(input: z.infer<Schema>): string | undefined;
  /** the audit entry: its action, and the details recorded with it */
  audit: {
    action: string;
    details(input: z.infer<Schema>, txDate: string): { description: string; [key: string]: unknown };
  };
}

export interface JournalDocumentCaller {
  uid: string;
  email?: string;
  admin?: boolean;
}

export interface JournalDocumentResult {
  status: 'ok';
  message: string;
  transactionId: string;
}

/** What the prepare step decided: the entry to write and the date it posts on. */
export interface PreparedJournalDocument {
  transaction: Record<string, unknown>;
  txDate: string;
  result: JournalDocumentResult;
}

/**
 * The read-only half: who may post, on what date, and what the validated entry is. Nothing is written;
 * the caller then writes inside its own transaction.
 */
export async function prepareJournalDocument<Schema extends ZodType>(
  db: Firestore,
  spec: JournalDocumentSpec<Schema>,
  input: z.infer<Schema>,
  caller: JournalDocumentCaller,
): Promise<PreparedJournalDocument> {
  const workspaceId = String((input as { workspaceId: string }).workspaceId);

  // 1. Authorize workspace membership & API-key workspace scope (#82)
  const { data: wsData } = await validateWorkspaceMember(db, workspaceId, caller);
  if (!mayPostEntries(wsData, caller)) throw Object.assign(new Error(POST_REFUSAL), { status: 403 });

  const wsTimezone = typeof wsData?.timezone === 'string' ? wsData.timezone : undefined;
  const sentDate = (input as { date?: string }).date;
  const txDate = sentDate && /^\d{4}-\d{2}-\d{2}$/.test(sentDate) ? sentDate : getDateInTimezoneISO(new Date(), wsTimezone);

  // 2. Validate period lock
  await assertPeriodOpen(db, workspaceId, txDate, caller.uid);

  const wsCurrency = typeof wsData?.currency === 'string' && wsData.currency ? wsData.currency : 'USD';
  const totalAmountCents = spec.totalAmountCents(input);
  const tx = {
    id: db.collection('transactions').doc().id,
    workspaceId,
    uid: caller.uid,
    date: txDate,
    description: spec.description(input),
    totalAmountCents,
    currency: wsCurrency,
    type: 'journal' as const,
    status: 'approved' as const,
    isCleared: true,
    createdAt: new Date().toISOString(),
    lines: spec.lines(input).map((line, i) => ({ id: `line-${i + 1}`, ...line })),
  };

  // 3. Validate through canonical validator (#102-R)
  const validatedTx = await TransactionValidator.validateAndPrepare(tx, {
    workspaceId,
    user: { uid: caller.uid, admin: caller.admin },
    wsData,
  });

  const result: JournalDocumentResult = { status: 'ok', message: spec.message, transactionId: validatedTx.id };
  return { transaction: validatedTx as unknown as Record<string, unknown>, txDate, result };
}

/**
 * The write half, run inside the caller's transaction: re-check membership, the posting role and the
 * lock (the prepare read only answered quickly; it did not authorise the write), then write the entry
 * and its audit line together. The caller — the command runner, or the legacy address — owns the
 * idempotency record, so the same code serves both without opening a second transaction.
 */
export async function postJournalDocumentInTransaction<Schema extends ZodType>(
  db: Firestore,
  spec: JournalDocumentSpec<Schema>,
  input: z.infer<Schema>,
  caller: JournalDocumentCaller,
  prepared: PreparedJournalDocument,
  t: Transaction,
): Promise<JournalDocumentResult> {
  const workspaceId = String((input as { workspaceId: string }).workspaceId);
  const wsNow = (await t.get(db.collection('workspaces').doc(workspaceId))).data();
  if (!isWorkspaceMemberData(wsNow, caller, workspaceId) || !mayPostEntries(wsNow, caller)) {
    throw Object.assign(new Error(POST_REFUSAL), { status: 403 });
  }
  const lock = postingLock(prepared.txDate, wsNow as never, caller.uid);
  if (lock) throw Object.assign(new Error(lockMessage(prepared.txDate, lock)), { status: 409 });
  const txRef = db.collection('transactions').doc(prepared.result.transactionId);
  ledgerCreate(t as never, txRef, { ...prepared.transaction, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await writeServerAuditLog({
    workspaceId,
    uid: caller.uid,
    email: caller.email,
    action: spec.audit.action,
    entityType: 'transaction',
    entityId: prepared.result.transactionId,
    details: spec.audit.details(input, prepared.txDate),
  }, { db, tx: t });
  return prepared.result;
}

/**
 * The legacy address's path: prepare, then one idempotent transaction, exactly as the address always
 * did. `lease.capitalize` and `revenue.recognize` do NOT use this — they let the command runner own the
 * transaction and the idempotency record, so a lease journal and its audit line commit with the runner's
 * membership, role and lock re-check rather than before it.
 */
export async function postJournalDocument<Schema extends ZodType>(
  db: Firestore,
  spec: JournalDocumentSpec<Schema>,
  input: z.infer<Schema>,
  caller: JournalDocumentCaller,
  explicitOperationId?: string,
): Promise<JournalDocumentResult> {
  const prepared = await prepareJournalDocument(db, spec, input, caller);
  const rawOpId = explicitOperationId || spec.operationId?.(input);
  return runOptionalIdempotent(
    {
      workspaceId: String((input as { workspaceId: string }).workspaceId),
      operationType: spec.operationType,
      rawOperationId: rawOpId,
      legacyPrefix: spec.legacyPrefix,
      actor: explicitOperationId ? caller.uid : '',
      payload: input,
    },
    (t: Transaction) => postJournalDocumentInTransaction(db, spec, input, caller, prepared, t),
  ) as Promise<JournalDocumentResult>;
}
