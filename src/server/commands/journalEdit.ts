import { z } from 'zod';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { isUpdatedAtMismatch } from '../../lib/recordVersion';
import { assertPostingOpen, lockMessage, postingLock } from '../../lib/periodLock';
import { refusedLabels, refusedLabelsMessage } from '../../lib/requiredLabels';
import type { DimensionDefinition, Transaction as Entry } from '../../types';
import { HttpError } from '../auth/requestUser';
import { FieldValue, isWorkspaceMemberData } from '../db/firestore';
import { revaluationEntryLock } from '../services/stockRevaluationService';
import { auditSnapshot, documentEntryRefusal, isPostedEntry, postedDeletionRefusal, postedStatusRefusal } from '../services/ledgerEditGuards';
import { deletionSentence, deletionSnapshot } from '../services/deletionRecord';
import type { CommandDefinition } from './types';

const id = z.string().min(1).max(200);
const editInput = z.object({
  id,
  transaction: z.record(z.string(), z.unknown()).optional(),
  partialUpdate: z.record(z.string(), z.unknown()).optional(),
  expectedUpdatedAt: z.unknown().optional(),
  ifMatch: z.boolean().optional(),
}).strict();
type EditInput = z.output<typeof editInput>;
type EditPrepared = { transaction?: Record<string, unknown>; validated?: Entry };
type EditResult = { transactionId: string; transaction?: Record<string, unknown>; before: Record<string, unknown> | null; after: Record<string, unknown> | null; partial: boolean };

function fail(message: string, status = 400): never { throw new HttpError(message, status); }
function checkVersion(input: EditInput, current: Record<string, unknown>, id: string): void {
  const expected = input.expectedUpdatedAt || input.partialUpdate?.expectedUpdatedAt || input.transaction?.expectedUpdatedAt;
  if (isUpdatedAtMismatch(expected, current.updatedAt)) {
    throw Object.assign(new HttpError('version_conflict', input.ifMatch ? 412 : 409), { currentTransaction: { ...current, id } });
  }
}

export const journalEditCommand: CommandDefinition<typeof editInput, EditResult, EditPrepared> = {
  name: 'journal.edit', input: editInput, roles: ['owner', 'accountant', 'bookkeeper'], allowPlatformAdmin: true,
  async prepare(ctx, input) {
    if (input.partialUpdate) return {};
    const raw = input.transaction;
    if (!raw || !raw.workspaceId) fail('Invalid payload: missing workspaceId');
    if (raw.workspaceId !== ctx.workspaceId) fail('Workspace mismatch', 403);
    const transaction = { ...raw, id: raw.id || input.id, uid: ctx.actor };
    const existing = (await ctx.db.collection('transactions').doc(input.id).get()).data() as Entry | undefined;
    const docProblem = documentEntryRefusal(existing, Boolean(ctx.user.admin));
    if (docProblem) fail(docProblem, 409);
    const validated = await TransactionValidator.validateAndPrepare(transaction as Partial<Entry>, { db: ctx.db, workspaceId: ctx.workspaceId, user: { uid: ctx.actor, admin: ctx.user.admin }, wsData: ctx.workspace }, existing);
    const missing = refusedLabels(validated, ctx.workspace.dimensions as DimensionDefinition[] | undefined);
    if (missing.length) throw Object.assign(new HttpError(refusedLabelsMessage(missing), 400), { missingLabels: missing });
    return { transaction, validated };
  },
  async handler(ctx, tx, input) {
    const ref = ctx.db.collection('transactions').doc(input.id);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('Not found', 404);
    const current = snap.data() || {};
    checkVersion(input, current, snap.id);
    if (current.workspaceId !== ctx.workspaceId) fail('Workspace mismatch', 403);
    const ws = (await tx.get(ctx.db.collection('workspaces').doc(ctx.workspaceId))).data();
    if (!isWorkspaceMemberData(ws, ctx.user, ctx.workspaceId)) fail('Not a member', 403);
    const before = auditSnapshot(current as Partial<Entry>);
    if (input.partialUpdate) {
      const partial = input.partialUpdate;
      if (current.date) assertPostingOpen(current.date, ws, ctx.actor);
      if ((current.status === 'certified' || current.status === 'void') && !ctx.user.admin) fail(`Forbidden: Transaction status is locked (${current.status}).`, 403);
      const lockedField = Object.keys(partial).some(k => ['status', 'type', 'reversalEventId', 'isDeleted', 'deletedAt'].includes(k) || k === 'metadata' || k.startsWith('metadata.'));
      const revaluation = lockedField ? revaluationEntryLock(current) : null;
      if (revaluation) fail(revaluation);
      const documentProblem = documentEntryRefusal(current, Boolean(ctx.user.admin), Object.keys(partial));
      if (documentProblem) fail(documentProblem, 409);
      const unpost = postedStatusRefusal(current as Partial<Entry>, partial.status, Boolean(ctx.user.admin)) || postedDeletionRefusal(current as Partial<Entry>, partial as Partial<Entry>, Boolean(ctx.user.admin));
      if (unpost) fail(unpost, 409);
      if (!ctx.user.admin && isPostedEntry(current as Partial<Entry>) && ['exchangeRate', 'currency', 'baseAmountCents', 'homeAmountCents'].some(key => key in partial && partial[key] !== current[key])) {
        fail("A posted entry's currency and exchange rate are not changed in place. Post a reversing entry and a corrected one instead.", 409);
      }
      if (['lines', 'amountCents', 'totalAmountCents', 'workspaceId', 'date', 'uid'].some(key => partial[key] !== undefined)) fail('Restricted fields cannot be modified via partialUpdate. Use a full transaction update instead.');
      const allowed = ['draft', 'pending', 'certified', 'void', 'reconciled', 'completed', 'failed', 'flagged', 'reviewed', 'overdue', 'approved'];
      if (partial.status && !allowed.includes(String(partial.status))) fail(`Invalid status '${partial.status}'.`);
      const safe = { ...partial }; delete safe.workspaceId; delete safe.uid; delete safe.id; delete safe.expectedUpdatedAt;
      const after = auditSnapshot({ ...current, ...safe } as Partial<Entry>);
      tx.update(ref, { ...safe, updatedAt: FieldValue.serverTimestamp() });
      return { transactionId: input.id, before, after, partial: true };
    }
    const prepared = ctx.prepared as EditPrepared;
    // Preparation was outside the transaction. Revalidate using this transaction's account and
    // workspace snapshots so concurrent chart, currency or required-label changes cannot slip in.
    const validated = await TransactionValidator.validateAndPrepare({ ...prepared.transaction } as Partial<Entry>, { db: ctx.db, workspaceId: ctx.workspaceId, user: { uid: ctx.actor, admin: ctx.user.admin }, wsData: ws }, current as Entry, tx);
    const missing = refusedLabels(validated, ws?.dimensions as DimensionDefinition[] | undefined);
    if (missing.length) throw Object.assign(new HttpError(refusedLabelsMessage(missing), 400), { missingLabels: missing });
    const documentProblem = documentEntryRefusal(current, Boolean(ctx.user.admin));
    if (documentProblem) fail(documentProblem, 409);
    const revaluation = revaluationEntryLock(current);
    if (revaluation) fail(revaluation);
    if ((current.status === 'certified' || current.status === 'void' || current.isCleared === true) && !ctx.user.admin) fail('Cannot modify certified, cleared, or voided transactions');
    const unpost = postedStatusRefusal(current as Partial<Entry>, validated.status, Boolean(ctx.user.admin)) || postedDeletionRefusal(current as Partial<Entry>, prepared.transaction as Partial<Entry>, Boolean(ctx.user.admin));
    if (unpost) fail(unpost, 409);
    for (const date of [current.date, validated.date]) {
      const lock = date ? postingLock(date, ws, ctx.actor) : null;
      if (lock) fail(lockMessage(date, lock));
    }
    const save = { ...validated } as Entry & { expectedUpdatedAt?: unknown }; delete save.expectedUpdatedAt;
    const after = auditSnapshot(save);
    tx.update(ref, { ...save, updatedAt: FieldValue.serverTimestamp() });
    return { transactionId: input.id, transaction: prepared.transaction, before, after, partial: false };
  },
  async preview(ctx, input) {
    const doc = await ctx.db.collection('transactions').doc(input.id).get();
    if (!doc.exists || doc.data()?.workspaceId !== ctx.workspaceId) fail('Not found', 404);
    return { title: `Edit transaction ${input.id}`, lines: [input.partialUpdate ? 'Change selected non-restricted fields' : 'Replace the entry with the validated details', 'Protected entries and closed periods are checked at commit'] };
  },
  audit(input, result) { const partial = result.partial; return { action: partial ? 'TRANSACTION_UPDATED_PARTIAL' : 'TRANSACTION_UPDATED', entityType: 'transaction', entityId: input.id, description: `${partial ? 'Partial' : 'Full'} update on transaction ref [${input.id}].`, details: { before: result.before, after: result.after } }; },
  inverse() { return null; }, risk: 'normal',
  describe: { sentence: 'Edit a journal entry or its review fields; do not use it to change a source-document entry or bypass closed periods.', example: { id: 'tx_123', partialUpdate: { notes: 'Reviewed' } }, refusals: [
    { code: 'CONFLICT', when: 'The entry changed or belongs to a source document.', next: 'Reload it or change the document instead.' },
    { code: 'PERIOD_LOCKED', when: 'An affected date is closed.', next: 'Ask an owner to reopen the period.' },
  ] },
};

const deleteInput = z.object({ id }).strict();
type DeleteResult = { deletedId: string; deleted: Record<string, unknown> };
export const journalDeleteCommand: CommandDefinition<typeof deleteInput, DeleteResult> = {
  name: 'journal.delete', input: deleteInput, roles: ['owner', 'accountant', 'bookkeeper'], allowPlatformAdmin: true,
  async handler(ctx, tx, input) {
    const ref = ctx.db.collection('transactions').doc(input.id);
    const doc = await tx.get(ref);
    if (!doc.exists) fail('Transaction not found', 404);
    const data = doc.data() || {};
    if (!data.workspaceId) fail('Corrupt transaction: missing workspaceId');
    if (data.workspaceId !== ctx.workspaceId) fail('Workspace mismatch: transaction belongs to a different workspace', 403);
    const ws = (await tx.get(ctx.db.collection('workspaces').doc(ctx.workspaceId))).data();
    if (!isWorkspaceMemberData(ws, ctx.user, ctx.workspaceId)) fail('Not a member', 403);
    // The legacy route's requireOpenPeriod middleware refuses every non-draft deletion, including admins.
    if (data.status && data.status !== 'draft') fail(`Forbidden: Only draft documents can be deleted. Current status: ${data.status}. Posted documents must be voided, never deleted.`, 403);
    const lock = data.date ? postingLock(data.date, ws, ctx.actor) : null;
    if (lock) fail(lockMessage(data.date, lock));
    const revaluation = revaluationEntryLock(data); if (revaluation) fail(revaluation, 409);
    if ((data.status === 'certified' || data.status === 'void' || data.isCleared === true || data.reconciled === true || data.isReconciled === true) && !ctx.user.admin) fail(`Forbidden: Transaction status is audited, cleared, reconciled, or locked (${data.status}). Destructive actions are restricted to administrators.`, 403);
    const meta = (data.metadata || {}) as Record<string, unknown>;
    if (meta.invoiceId || meta.billId || meta.paymentId || meta.creditNoteId || meta.vendorCreditId) fail('Cannot delete a ledger entry posted by a source document; void or reverse the document instead.', 409);
    if (isPostedEntry(data as Partial<Entry>) && !ctx.user.admin) fail('Posted ledger entries cannot be hard-deleted; post a reversing entry via POST /api/v1/transactions/:id/reverse.', 409);
    tx.delete(ref);
    return { deletedId: input.id, deleted: data };
  },
  async preview(ctx, input) { const doc = await ctx.db.collection('transactions').doc(input.id).get(); if (!doc.exists || doc.data()?.workspaceId !== ctx.workspaceId) fail('Transaction not found', 404); return { title: `Delete draft transaction ${input.id}`, lines: ['Only an unprotected draft in an open period can be removed'] }; },
  audit(_input, result) { return { action: 'TRANSACTION_DELETED', entityType: 'transaction', entityId: result.deletedId, description: deletionSentence('transactions', result.deletedId, result.deleted), details: { deleted: deletionSnapshot(result.deleted) } }; },
  inverse() { return null; }, risk: 'normal',
  describe: { sentence: 'Delete an unprotected draft journal entry; do not use it to remove a posted entry, which must be reversed.', example: { id: 'tx_draft' }, refusals: [
    { code: 'FORBIDDEN', when: 'The entry is posted or otherwise locked.', next: 'Reverse the entry rather than deleting it.' },
    { code: 'PERIOD_LOCKED', when: 'The entry is dated in a closed period.', next: 'Ask an owner to reopen it.' },
  ] },
};
