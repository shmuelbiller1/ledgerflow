/**
 * Changing many journal entries at once (`POST /api/v1/transactions/batch`, #112 and #113).
 *
 * A batch may change only the fields a batch is for — notes, labels, flags, dimensions, the review and
 * cleared state, and moving amounts between existing accounts. Totals, dates, currency and identity go
 * through the entry editor, which checks everything. Every entry is read and checked inside ONE
 * transaction before anything is written, so a refused entry or a version conflict leaves every entry
 * of the batch unchanged; the audit line commits with the writes.
 *
 * This was written inline in `routes/transactions/bulkRoutes.ts`. It moved here so the registered
 * command (`journal.batchupdate`) can run it with the runner's checks in front of it: a service may
 * not import from `routes/`, and a route-file transaction cannot be handed to another transaction.
 */
import type { Firestore } from '../db/firestore';
import { FieldValue, isWorkspaceMemberData } from '../db/firestore';
import type { Transaction } from '../../types';
import { assertPostingOpen } from '../../lib/periodLock';
import { settleHomeCurrency } from '../../lib/txFilters';
import { isUpdatedAtMismatch } from '../../lib/recordVersion';
import { LEDGER_WRITER_ROLES, roleInWorkspace } from '../middleware/requireLedgerWriter';
import { checkLedgerEntry } from './ledgerDoor';
import { revaluationEntryLock } from './stockRevaluationService';
import { writeServerAuditLog } from './auditLogService';
import { auditSnapshot, isPostedEntry, postedStatusRefusal } from './ledgerEditGuards';

/** The entry's home-currency debits, read the way the reports read them (a line's own base amount or rate first). */
function homeDebits(tx: Transaction): number {
  return (tx.lines || []).reduce((sum, line) => {
    const l = line as unknown as Record<string, unknown>;
    const home = Number.isInteger(l.baseAmountCents) ? Number(l.baseAmountCents)
      : Math.round(Number(l.amountCents) * Number(l.exchangeRate ?? tx.exchangeRate ?? 1));
    return home > 0 ? sum + home : sum;
  }, 0);
}

/** The most entries one batch may change. */
export const RULE_MAX = 2000;

/**
 * The statuses an entry may be moved to in a batch. Not `certified` (#843): that is a signing act with its
 * own route. `draft`, `failed` and `void` stay for entries that are not posted yet; a posted entry is
 * refused them by `postedStatusRefusal` below, because un-posting in place drops it from every report.
 */
export const BATCH_STATUSES = [
  'draft', 'pending', 'void', 'reconciled', 'completed', 'failed', 'flagged', 'reviewed', 'overdue', 'approved',
];

/**
 * #112: only these fields can change in a batch. `expectedUpdatedAt` is the version check, not a field.
 * `date` and `totalAmountCents` are deliberately absent: a batch may move amounts between the existing
 * accounts of an entry (which the ledger check below verifies), never change what the entry totals.
 */
export const BATCH_FIELDS = new Set([
  'lines', 'description', 'status', 'tags', 'metadata', 'classId', 'locationId', 'projectId', 'dimensions',
  'dimensions.category', 'dimensions.project', 'category', 'isLocked', 'isFlagged', 'isReviewed', 'isCleared',
  'reconciled', 'isReconciled', 'reconciledAt', 'isTransfer', 'transferDetails', 'verification', 'notes', 'memo',
  'updatedAt',
]);

export interface BatchUpdate {
  id: string;
  data?: Record<string, unknown>;
  expectedUpdatedAt?: string;
}

export interface BatchActor {
  workspaceId: string;
  uid: string;
  email?: string;
  /** a platform admin may change an entry that is certified, void or reconciled */
  admin?: boolean;
}

/**
 * What the legacy handler refused before opening a transaction, in the same order and the same words.
 * A `null` answer is also the proof that every entry has an id, so the caller can hand the list on as
 * `BatchUpdate[]` without checking it again.
 */
export function batchProblem(updates: ReadonlyArray<Partial<BatchUpdate> & { id?: unknown }>): string | null {
  if (updates.length === 0) return 'Missing workspaceId or updates';
  if (updates.length > RULE_MAX) return `At most ${RULE_MAX} entries per batch`;
  const ids = updates.map(update => String(update?.id ?? ''));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) return 'Each entry once, with its id';
  for (const update of updates) {
    const refused = Object.keys(update.data || {}).filter(key => key !== 'expectedUpdatedAt' && !BATCH_FIELDS.has(key));
    if (refused.length) return `These fields cannot be changed in a batch: ${refused.join(', ')} (entry ${update.id})`;
  }
  return null;
}

/** A version conflict: the entry moved on since the caller read it, so nothing in the batch was saved. */
export class BatchVersionConflict extends Error {
  readonly status = 409;
  constructor(readonly transactionId: string, readonly current: Record<string, unknown>) {
    super(`Transaction ${transactionId} was modified by another user. Nothing in this batch was saved.`);
    this.name = 'BatchVersionConflict';
  }
}

/**
 * Read and check every entry, then write them all — or none. Answers the number of entries written.
 * A version conflict throws `BatchVersionConflict` with the entry as it is now.
 */
export async function batchWrites(db: Firestore, actor: BatchActor, updates: readonly BatchUpdate[]): Promise<{ updated: number }> {
  const { workspaceId, uid } = actor;
  const ids = updates.map(update => String(update.id));
  return db.runTransaction(async t => {
    // AUD-08: the workspace (closing date, role) as it is at commit, not as it was read before
    const workspace = (await t.get(db.collection('workspaces').doc(workspaceId))).data();
    // the route answered 403 only for the membership refusal it made before opening the transaction;
    // a role that changed in between was, and remains, one of the handler's 400s
    if (!actor.admin && (!workspace || !isWorkspaceMemberData(workspace, { uid }, workspaceId) || !LEDGER_WRITER_ROLES.includes(roleInWorkspace(workspace, uid)))) {
      throw Object.assign(new Error('Only owners, accountants and bookkeepers change entries'), { status: 400 });
    }
    const refs = ids.map(id => db.collection('transactions').doc(id));
    const docs = await Promise.all(refs.map(ref => t.get(ref)));
    const accountIds = new Set<string>();
    for (const update of updates) {
      for (const line of (update.data?.lines as Array<{ accountId?: string }> | undefined) || []) {
        if (line?.accountId) accountIds.add(String(line.accountId));
      }
    }
    const accountDocs = await Promise.all([...accountIds].map(id => t.get(db.collection('chartAccounts').doc(id))));
    const ownAccounts = new Set(accountDocs.filter(doc => doc.exists && doc.data()?.workspaceId === workspaceId).map(doc => doc.id));

    const writes: Array<{ ref: (typeof refs)[number]; data: Record<string, unknown> }> = [];
    // #843: what each entry's figures, status and account lines were before and after, for the audit line
    const changes: Array<Record<string, unknown>> = [];
    for (let index = 0; index < docs.length; index += 1) {
      const doc = docs[index];
      const id = ids[index];
      if (!doc.exists) throw Object.assign(new Error(`Transaction ${id} not found`), { status: 400 });
      const entry = doc.data();
      if (entry?.workspaceId !== workspaceId) throw Object.assign(new Error(`Transaction ${id} does not belong to this workspace`), { status: 400 });
      if (entry?.date) assertPostingOpen(entry.date, workspace as never, uid);
      const newDate = (updates[index].data as { date?: unknown } | undefined)?.date;
      if (typeof newDate === 'string' && newDate) assertPostingOpen(newDate, workspace as never, uid);
      const revaluationLock = revaluationEntryLock(entry);
      if (revaluationLock) throw Object.assign(new Error(revaluationLock), { status: 400 });

      const updateData = { ...updates[index].data } as Record<string, unknown>;
      const expectedUpdatedAt = updates[index].expectedUpdatedAt || updateData.expectedUpdatedAt;
      const settledFlag = entry?.isCleared === true || entry?.reconciled === true || entry?.isReconciled === true;
      const unsettles = ['isCleared', 'reconciled', 'isReconciled', 'reconciledAt'].some(key => key in updateData && updateData[key] !== entry?.[key]);
      const touchesAmounts = updateData.lines !== undefined || updateData.status !== undefined || unsettles;
      // a locked or settled entry is one of the handler's 400s, message included — not a 403
      if (!actor.admin && ((entry?.status === 'certified' || entry?.status === 'void') || (settledFlag && touchesAmounts))) {
        throw Object.assign(new Error(`Forbidden: Transaction ${id} status is locked, cleared, or reconciled.`), { status: 400 });
      }
      delete updateData.expectedUpdatedAt;
      if (isUpdatedAtMismatch(expectedUpdatedAt, entry?.updatedAt)) {
        throw new BatchVersionConflict(id, { ...(entry || {}), id: doc.id });
      }
      const metadata = (entry?.metadata || {}) as Record<string, unknown>;
      if ((updateData.lines !== undefined || updateData.status !== undefined)
        && (metadata.invoiceId || metadata.billId || metadata.paymentId || metadata.creditNoteId || metadata.vendorCreditId)) {
        throw Object.assign(new Error(`Entry ${id} belongs to a source document; update or void the document instead.`), { status: 400 });
      }
      if (updateData.lines !== undefined) {
        const lines = updateData.lines as Array<{ accountId?: string; amountCents?: number }>;
        if (!Array.isArray(lines) || lines.length < 2) throw Object.assign(new Error(`Entry ${id} needs at least two lines`), { status: 400 });
        // #843: on a posted entry a batch moves amounts between accounts; it never restates the rate. Each
        // line keeps a rate the entry already has, and the home-currency debits stay what they were.
        if (!actor.admin && isPostedEntry(entry as Partial<Transaction>)) {
          const entryRate = Number(entry?.exchangeRate ?? 1);
          const oldLines = (Array.isArray(entry?.lines) ? entry.lines : []) as Array<Record<string, unknown>>;
          const rates = new Set([entryRate, ...oldLines.map(line => Number(line.exchangeRate ?? entryRate))]);
          if (lines.some(line => !rates.has(Number((line as Record<string, unknown>).exchangeRate ?? entryRate)))) {
            throw Object.assign(new Error(`Entry ${id}: a posted entry's exchange rate is not changed in a batch. Post a reversing entry and a corrected one instead.`), { status: 400 });
          }
        }
        const settled = { ...entry, ...updateData, lines: lines.map(line => ({ ...line })) } as Transaction;
        settleHomeCurrency(settled, (workspace as { currency?: string } | undefined)?.currency);
        updateData.lines = settled.lines;
        checkLedgerEntry(settled as unknown as Record<string, unknown>);
        if (!actor.admin && isPostedEntry(entry as Partial<Transaction>) && Array.isArray(entry?.lines)
          // settling a reallocation at the same rate may move a rounding cent per line, never more
          && Math.abs(homeDebits(entry as Transaction) - homeDebits(settled)) > lines.length) {
          throw Object.assign(new Error(`Entry ${id}: a batch may not change what a posted entry is worth in the home currency; edit or reverse the entry instead`), { status: 400 });
        }
        const unknown = lines.filter(line => !line.accountId || !ownAccounts.has(String(line.accountId)));
        if (unknown.length) throw Object.assign(new Error(`Entry ${id} uses an account that is not in this workspace`), { status: 400 });
        const total = lines.reduce((sum, line) => sum + Math.max(0, Math.round(Number(line.amountCents) || 0)), 0);
        const before = Math.abs(Math.round(Number(entry?.totalAmountCents) || 0));
        if (before && total !== before) {
          throw Object.assign(new Error(`Entry ${id}: a batch may move amounts between accounts but not change the total (${before} → ${total} cents); edit the entry instead`), { status: 400 });
        }
      }
      if (updateData.status && !BATCH_STATUSES.includes(String(updateData.status))) {
        throw Object.assign(new Error(`Invalid status '${updateData.status}' provided for transaction ${id}.`), { status: 400 });
      }
      // #843: the same rule as the entry editor — a posted entry is reversed, never un-posted in place
      const unpost = postedStatusRefusal(entry as Partial<Transaction>, updateData.status, Boolean(actor.admin));
      if (unpost) throw Object.assign(new Error(`Entry ${id}: ${unpost}`), { status: 400 });
      if (updateData.lines !== undefined || updateData.status !== undefined) {
        changes.push({ id, before: auditSnapshot(entry as Partial<Transaction>), after: auditSnapshot({ ...entry, ...updateData } as Partial<Transaction>), ...(updateData.lines !== undefined ? { linesBefore: entry?.lines ?? null, linesAfter: updateData.lines } : {}) });
      }
      writes.push({ ref: doc.ref, data: { ...updateData, updatedAt: FieldValue.serverTimestamp() } });
    }

    for (const write of writes) t.update(write.ref, write.data);
    await writeServerAuditLog({
      workspaceId,
      uid,
      email: actor.email,
      action: 'TRANSACTIONS_BATCH_UPDATED',
      entityType: 'transaction',
      entityId: ids[0] || 'batch',
      details: { description: `Updated ${writes.length} transaction(s) in batch`, count: writes.length, ...(changes.length ? { changes } : {}) },
    }, { db, tx: t });
    return { updated: writes.length };
  });
}
