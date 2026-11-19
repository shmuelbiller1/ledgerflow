import { commandStageId } from '../db/pg/commandStage';
import crypto from 'crypto';
import { itemsExceedTotal } from '../../lib/documentItemsCheck';
import { isWorkspaceMemberData, type Firestore, type Transaction as FirestoreTransaction } from '../db/firestore';
import type { RequestUser } from '../auth/requestUser';
import { postInvoiceLedger } from '../../services/ledgerPost/invoicePosting';
import { postBillLedger } from '../../services/ledgerPost/billPosting';
import { postCreditNoteLedger, postVendorCreditLedger } from '../../services/ledgerPost/creditPosting';
import { deletePostings } from '../../services/ledgerPost/deletePostings';
import { isPostable } from '../../lib/txFilters';
import type { EntityMutation, LedgerPostContext } from '../../services/ledgerPost/postingCore';
import type { Bill, CreditNote, Invoice, Transaction, VendorCredit } from '../../types';
import { agreedPostingDay, DOCUMENT_ENTRY_KEY, loadPostingContext, todayIn } from './postingContextLoader';
import { assertPostingOpen, workspaceRole } from '../../lib/periodLock';
import { claimOf, decisionProblem } from '../../lib/expenseClaims';
import { BulkRefusal, commitLedgerBulk, readLegacyBulkReplay, type BeforeWrite, type LedgerBulkPreflight } from './ledgerBulkCommit';
import { requestPayloadHash } from '../utils/idempotency';
import { enforceCreditLimit } from './creditLimitGuard';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { budgetWarningsFor, type BudgetWarning } from './budgetGuard';

/**
 * L-94 step 2 (docs/design/L-94-server-postings.md): an invoice or bill is saved and its entries are built **here**,
 * from the document and what the database holds (the chart, the workspace's mappings and closing date, the document's
 * earlier entries to reverse, the stock it sells), by the same builders the browser used (postingCore, no browser
 * code). The save then goes through the very same commit as POST /transactions/bulk (ledgerBulkCommit.ts): role and
 * closing date at commit, the idempotency key, one live posting per document (INT-2 — a save built from entries that
 * changed meanwhile is refused with 409, never posted twice), the order limit, stock moves, the schema and approval,
 * all in ONE transaction. Commands may pass their owning transaction to this service; legacy routes still open it
 * through commitLedgerBulk. L94-STEP2B: credit notes and vendor credits too, and deleting any of the four.
 */
export type PostedDocumentType = 'invoices' | 'bills' | 'creditNotes' | 'vendorCredits';

const NAMES: Record<PostedDocumentType, string> = { invoices: 'invoice', bills: 'bill', creditNotes: 'credit note', vendorCredits: 'vendor credit' };

export interface DocumentPostInput {
  collection: PostedDocumentType;
  docId: string;
  workspaceId: string;
  action: 'create' | 'update' | 'delete';
  /** create: the whole document; update: the changed fields; delete: nothing */
  data: Record<string, unknown>;
  idempotencyKey?: string;
  /** the day the browser counted as today; used within one day of the server's (agreedPostingDay), never hashed */
  postingDay?: string;
  /** EG-5: issue an invoice over the customer's credit limit anyway (owner or accountant, with a reason) */
  creditLimitOverride?: { reason: string };
}

export interface DocumentPostResult {
  committed: boolean;
  body: Record<string, unknown>;
  /** the entries as written (empty for a replay or a document that posts nothing) */
  transactions: Transaction[];
  cogsPendingReason?: string;
}

export interface DocumentPostExecutionOptions {
  /** Reuse the command runner's transaction; never nest a transaction around command execution. */
  transaction?: FirestoreTransaction;
  /** Run only after the owning transaction commits (approval notifications, email, etc.). */
  afterCommit?(callback: () => Promise<Record<string, unknown> | void> | Record<string, unknown> | void): void;
}

export interface PreparedDocumentPost {
  readonly workspaceId: string;
  readonly document: Record<string, unknown>;
  readonly idempotencyKey?: string;
  readonly hashOf: unknown;
  readonly transactions: Transaction[];
  readonly entityMutation: EntityMutation;
  readonly beforeWrite?: BeforeWrite;
  readonly preflight: LedgerBulkPreflight;
  readonly cogsPendingReason?: string;
}

function mutationOf(collection: PostedDocumentType, docId: string, action: DocumentPostInput['action'], data?: Record<string, unknown>): EntityMutation {
  return { collection, docId, action, ...(data ? { data } : {}) };
}

function assertWorkspaceScope(user: RequestUser, workspaceId: string): void {
  if (user.developerWorkspaceId && user.developerWorkspaceId !== workspaceId) {
    throw new BulkRefusal(403, { error: `Forbidden: API key is scoped strictly to workspace ${user.developerWorkspaceId}` });
  }
}

const SERVER_MANAGED_DOCUMENT_FIELDS = [
  'settledByRecordsCents',
  'writtenOffCents',
  'writeOffTransactionId',
  'writeOffReversalTransactionId',
  'writeOffReason',
  'writtenOffAt',
  'refundedCents',
  'refundTransactionIds',
  'revenueSchedule',
  'prepaidSchedule',
  'appliedTo',
] as const;

const UNPOSTED_DOCUMENT_STATUSES = new Set(['draft', 'void', 'cancelled', 'rejected']);

function stripServerManagedFields(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const cleaned: Record<string, unknown> = { ...data };
  for (const key of SERVER_MANAGED_DOCUMENT_FIELDS) {
    if (key in cleaned) delete cleaned[key];
  }
  return cleaned;
}

function asNonNegativeNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

/**
 * #857: a submitted expense claim changes only by its decision. An update must be exactly the approve or
 * reject the claim screens send, by someone decisionProblem allows (owner or accountant, never the
 * submitting accountant); any other edit, and a delete by anyone but the submitter or an owner/accountant,
 * is refused. Run on the read snapshot and again on the in-transaction one.
 */
function assertClaimDecision(
  collection: PostedDocumentType,
  action: DocumentPostInput['action'],
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
  workspace: unknown,
  uid: string,
): void {
  if (collection !== 'bills' || !existing) return;
  const claim = claimOf(existing as never);
  if (!claim || claim.state !== 'submitted') return;
  const role = workspaceRole(workspace as never, uid);
  if (action === 'delete') {
    if (claim.submittedBy === uid || role === 'owner' || role === 'accountant') return;
    throw new BulkRefusal(403, { error: 'Only the person who submitted this expense claim, or an owner or accountant, can delete it.' });
  }
  const next = claimOf({ metadata: incoming.metadata } as never);
  const decided = next && (next.state === 'approved' || next.state === 'rejected') ? next.state : undefined;
  const allowedKeys = new Set(['status', 'metadata', 'updatedAt']);
  if (!next || !decided || incoming.status !== decided || Object.keys(incoming).some(k => !allowedKeys.has(k))) {
    throw new BulkRefusal(409, { error: 'This expense claim is waiting for approval. Approve or reject it; it cannot be edited until then.' });
  }
  const problem = decisionProblem(claim, role, uid);
  if (problem) throw new BulkRefusal(403, { error: problem });
  // the record of the decision is the server's: the stored metadata and claim, with only the outcome, who
  // decided (the caller), when, and the reason; nothing else the caller sent replaces them (Gitar on #908)
  const reason = typeof next.reason === 'string' ? next.reason.trim().slice(0, 500) : '';
  const prior = (existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}) as Record<string, unknown>;
  const stored: Record<string, unknown> = { ...(claim as unknown as Record<string, unknown>) };
  delete stored.decidedBy; delete stored.decidedAt; delete stored.reason;
  incoming.metadata = { ...prior, expenseClaim: { ...stored, state: decided, decidedBy: uid, decidedAt: new Date().toISOString(), ...(reason ? { reason } : {}) } };
}

function assertDocumentMutationAllowed(
  collection: PostedDocumentType,
  action: DocumentPostInput['action'],
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): void {
  const isCredit = collection === 'creditNotes' || collection === 'vendorCredits';
  if (action === 'delete') {
    if (!existing) return;
    if (!isCredit) {
      if (asNonNegativeNumber(existing.settledByRecordsCents) > 0) {
        throw new BulkRefusal(409, { error: `Cannot delete ${NAMES[collection]} with recorded payments or credit applications. Void or unapply settlements first.` });
      }
      if (asNonNegativeNumber(existing.writtenOffCents) > 0 || Boolean(existing.writeOffTransactionId)) {
        throw new BulkRefusal(409, { error: `Cannot delete ${NAMES[collection]} that has a bad-debt write-off. Reverse the write-off first.` });
      }
      if (existing.revenueSchedule || existing.prepaidSchedule) {
        throw new BulkRefusal(409, { error: `Cannot delete ${NAMES[collection]} with an active revenue or prepaid recognition schedule.` });
      }
    } else {
      const appliedCount = Array.isArray(existing.appliedTo) ? existing.appliedTo.length : 0;
      const refundTxCount = Array.isArray(existing.refundTransactionIds) ? existing.refundTransactionIds.length : 0;
      // #775: applying a credit only lowers remainingCents, so a remaining balance below the total is an application too
      const amount = asNonNegativeNumber(existing.amountCents);
      const partlyApplied = typeof existing.remainingCents === 'number' && existing.remainingCents < amount;
      if (partlyApplied || appliedCount > 0 || asNonNegativeNumber(existing.refundedCents) > 0 || refundTxCount > 0) {
        throw new BulkRefusal(409, { error: `Cannot delete ${NAMES[collection]} that has already been applied or refunded.` });
      }
    }
    return;
  }

  if (isCredit) {
    const incomingAmount = typeof incoming.amountCents === 'number' ? incoming.amountCents : undefined;
    const incomingRemaining = typeof incoming.remainingCents === 'number' ? incoming.remainingCents : undefined;
    if (action === 'create') {
      if (incomingAmount !== undefined && incomingRemaining !== undefined && incomingRemaining > incomingAmount) {
        throw new BulkRefusal(400, { error: 'Credit remaining amount cannot exceed the credit total.' });
      }
      return;
    }
    if (existing) {
      const appliedCount = Array.isArray(existing.appliedTo) ? existing.appliedTo.length : 0;
      const refundTxCount = Array.isArray(existing.refundTransactionIds) ? existing.refundTransactionIds.length : 0;
      const oldAmount = asNonNegativeNumber(existing.amountCents);
      const oldRemaining = typeof existing.remainingCents === 'number' ? existing.remainingCents : oldAmount;
      const hasSettlement = appliedCount > 0 || asNonNegativeNumber(existing.refundedCents) > 0 || refundTxCount > 0;
      if (typeof incoming.status === 'string' && UNPOSTED_DOCUMENT_STATUSES.has(incoming.status) && (hasSettlement || oldRemaining < oldAmount)) {
        throw new BulkRefusal(409, { error: `An applied or refunded ${NAMES[collection]} cannot go back to ${incoming.status}.` });
      }
      if (hasSettlement) {
        if (incomingAmount !== undefined && incomingAmount !== existing.amountCents) {
          throw new BulkRefusal(409, { error: `Cannot change the total of a ${NAMES[collection]} that has already been applied or refunded.` });
        }
        if (incomingRemaining !== undefined && incomingRemaining !== existing.remainingCents) {
          throw new BulkRefusal(409, { error: `Cannot overwrite remaining balance on a ${NAMES[collection]} that has already been applied or refunded.` });
        }
        if ((incoming.currency !== undefined && incoming.currency !== existing.currency) ||
            (incoming.exchangeRate !== undefined && incoming.exchangeRate !== existing.exchangeRate)) {
          throw new BulkRefusal(409, { error: `Cannot change currency or exchange rate on a ${NAMES[collection]} that has already been applied or refunded.` });
        }
      } else if (incomingAmount !== undefined || incomingRemaining !== undefined) {
        // #775: once part of a credit is applied its total is fixed, as for a settled one; while nothing is
        // applied, a total-only edit moves the remaining balance with it (Gitar on #929). The remaining
        // balance may still come down (the credit being applied), never above what is unapplied.
        const applied = oldAmount - oldRemaining;
        const newAmount = incomingAmount !== undefined ? incomingAmount : oldAmount;
        if (applied > 0 && newAmount !== oldAmount) {
          throw new BulkRefusal(409, { error: `Cannot change the total of this ${NAMES[collection]}: ${applied} of it is already applied.` });
        }
        if (incomingRemaining === undefined) {
          if (newAmount !== oldAmount) incoming.remainingCents = newAmount - applied;
        } else if (incomingRemaining < 0 || incomingRemaining > newAmount - applied) {
          throw new BulkRefusal(409, { error: 'Credit remaining balance cannot be increased above its unapplied amount.' });
        }
      }
    }
    return;
  }

  // Invoices and bills: protect settled / written-off documents on update
  if (action === 'update' && existing) {
    const settled = asNonNegativeNumber(existing.settledByRecordsCents);
    const writtenOff = asNonNegativeNumber(existing.writtenOffCents);
    if (settled > 0 || writtenOff > 0) {
      if (typeof incoming.status === 'string' && UNPOSTED_DOCUMENT_STATUSES.has(incoming.status)) {
        throw new BulkRefusal(409, { error: `Cannot change a settled or written-off ${NAMES[collection]} to ${incoming.status}.` });
      }
      if (typeof incoming.amountPaidCents === 'number' && incoming.amountPaidCents < settled) {
        throw new BulkRefusal(409, { error: `amountPaidCents (${incoming.amountPaidCents}) cannot be reduced below recorded settlements (${settled}).` });
      }
      // A write-off is already counted in settledByRecordsCents (badDebtService), so it is not added again.
      if (typeof incoming.amountCents === 'number' && incoming.amountCents < settled) {
        throw new BulkRefusal(409, { error: `Document total cannot be reduced below recorded settlements and write-offs (${settled}).` });
      }
    }
  }
}

/**
 * Read and run the existing posting builders without committing. Both the command preview and the
 * eventual commit use this preparation path, so previews show the exact server-built ledger lines.
 * Writes are still performed only by commitPreparedDocumentPost inside the caller's transaction.
 */
export async function prepareDocumentPost(db: Firestore, user: RequestUser, input: DocumentPostInput): Promise<PreparedDocumentPost> {
  const { collection, docId, workspaceId, action } = input;
  assertWorkspaceScope(user, workspaceId);
  const workspace = (await db.collection('workspaces').doc(workspaceId).get()).data();
  if (!isWorkspaceMemberData(workspace, user, workspaceId)) throw new BulkRefusal(403, { error: 'Not a member' });

  const existing = (await db.collection(collection).doc(docId).get()).data();
  if (existing && existing.workspaceId !== workspaceId) {
    throw new BulkRefusal(403, { error: `Forbidden: Entity ${docId} does not belong to authorized workspace.` });
  }

  // A8-005 / A8-008: strip server-managed settlement/schedule fields from client payloads and block
  // destructive edits or deletions of settled, written-off, refunded, or scheduled documents.
  const sanitizedData = action === 'delete' ? {} : stripServerManagedFields(input.data);
  assertDocumentMutationAllowed(collection, action, existing, sanitizedData);
  assertClaimDecision(collection, action, existing, sanitizedData, workspace, user.uid);

  // as /transactions/bulk: the save merges into what is saved (an update of a document not saved yet makes it); a
  // second live posting of the same document is refused at commit (INT-2)
  const document: Record<string, unknown> = { ...(existing || {}), ...(action === 'delete' ? {} : sanitizedData), id: docId, workspaceId };
  const wsRecord = workspace || {};
  const context: LedgerPostContext = await loadPostingContext(db, { workspaceId, uid: user.uid, collection, docId, document, workspace: wsRecord, lockChecked: true });
  context.today = agreedPostingDay(context.today || todayIn(wsRecord.timezone as string | undefined), input.postingDay);
  const key = DOCUMENT_ENTRY_KEY[collection];
  const reversedIds = new Set(
    (context.transactions || [])
      .filter(tx => tx.metadata?.isReversal && typeof tx.metadata?.reversesTxId === 'string')
      .map(tx => String(tx.metadata?.reversesTxId)),
  );
  const liveExistingDates = (context.transactions || [])
    .filter(tx => tx.metadata?.[key] === docId && isPostable(tx) && !tx.metadata?.isReversal && !reversedIds.has(tx.id))
    .map(tx => String(tx.date));
  // A8-007: check period lock on BOTH existing live posted dates (so locked documents cannot be re-dated
  // into an open period or mutated) AND the target document date. Drafts with no posted entries may still move.
  const dateSet = new Set<string>();
  if (action !== 'create') {
    for (const d of liveExistingDates) if (d) dateSet.add(d);
    if (existing && !UNPOSTED_DOCUMENT_STATUSES.has(String(existing.status || '')) && typeof existing.date === 'string' && existing.date) {
      dateSet.add(existing.date);
    }
  }
  if (action !== 'delete') {
    const targetDate = String(document.date || context.today);
    if (targetDate) dateSet.add(targetDate);
  }
  const datesToCheck = Array.from(dateSet);
  try {
    for (const date of datesToCheck) assertPostingOpen(date, workspace as never, user.uid);
  } catch (err) {
    throw new BulkRefusal(409, { error: err instanceof Error ? err.message : String(err) });
  }
  // audit F8: a sent invoice or bill whose total is less than its items allow is refused, not posted at that total
  // (draft, rejected, void and cancelled only reverse, as the posting services treat them; a bill's lines are its splits)
  if (action !== 'delete' && (collection === 'invoices' || collection === 'bills') && !['draft', 'rejected', 'void', 'cancelled'].includes(String(document.status))) {
    const contradiction = itemsExceedTotal(collection === 'bills' ? { ...document, items: document.splits } : document);
    if (contradiction) throw new BulkRefusal(400, { error: contradiction });
  }

  const mutation = mutationOf(collection, docId, action, action === 'delete' ? undefined : sanitizedData);
  let cogsPendingReason: string | undefined;
  try {
    if (action === 'delete') await deletePostings(docId, key as 'invoiceId', workspaceId, mutation, context);
    else if (collection === 'invoices') cogsPendingReason = (await postInvoiceLedger(docId, document as Partial<Invoice>, workspaceId, user.uid, mutation, context)).cogsPendingReason;
    else if (collection === 'bills') await postBillLedger(docId, document as Partial<Bill>, workspaceId, user.uid, mutation, context);
    else if (collection === 'creditNotes') await postCreditNoteLedger(docId, document as Partial<CreditNote>, workspaceId, user.uid, mutation, context);
    else await postVendorCreditLedger(docId, document as Partial<VendorCredit>, workspaceId, user.uid, mutation, context);
  } catch (err) {
    throw new BulkRefusal(400, { error: err instanceof Error ? err.message : String(err) });
  }

  const captured = context.capture || [];
  if (captured.length !== 1) throw new BulkRefusal(500, { error: `The ${NAMES[collection]} could not be posted (built ${captured.length} saves)` });
  const transactions = captured[0].txs.map(tx => ({ ...tx, id: commandStageId(db, 'transactions', () => tx.id || crypto.randomUUID()) })) as unknown as Transaction[];
  const validatedTransactions: Transaction[] = [];
  for (const transaction of transactions) {
    transaction.uid = user.uid;
    transaction.workspaceId = workspaceId;
    validatedTransactions.push(await TransactionValidator.validateAndPrepare(transaction, {
      db,
      workspaceId,
      user: { uid: user.uid, admin: user.admin },
      wsData: wsRecord,
    }));
  }
  // EG-4: budget reads happen before the command runner opens its database transaction.
  const plannedBudgetWarnings: BudgetWarning[] = await budgetWarningsFor(db, workspaceId, wsRecord, validatedTransactions);
  const preflight: LedgerBulkPreflight = { workspace: wsRecord, transactions: validatedTransactions, budgetWarnings: plannedBudgetWarnings };
  // EG-5 + A8-005/A8-007/A8-008: re-verify settlement guards, lock dates, and credit limit against fresh
  // in-transaction workspace and entity snapshots so concurrent payments/closes cannot race.
  const beforeWrite: BeforeWrite = async (t, state) => {
    assertDocumentMutationAllowed(collection, action, state.existingEntity, sanitizedData);
    assertClaimDecision(collection, action, state.existingEntity, sanitizedData, state.workspace, user.uid);
    try {
      for (const date of datesToCheck) assertPostingOpen(date, state.workspace as never, user.uid);
      if (action !== 'create' && state.existingEntity && !UNPOSTED_DOCUMENT_STATUSES.has(String(state.existingEntity.status || '')) && typeof state.existingEntity.date === 'string' && state.existingEntity.date) {
        assertPostingOpen(state.existingEntity.date, state.workspace as never, user.uid);
      }
    } catch (err) {
      throw new BulkRefusal(409, { error: err instanceof Error ? err.message : String(err) });
    }
    if (collection === 'invoices') {
      return enforceCreditLimit(db, t, { user, workspaceId, workspace: state.workspace, docId, action, data: sanitizedData, existing: state.existingEntity, override: input.creditLimitOverride });
    }
    return {};
  };

  const hashed = documentRequestFingerprint(input);
  return {
    workspaceId,
    document,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    hashOf: hashed,
    transactions: validatedTransactions,
    entityMutation: (captured[0].entityMutation || mutation) as EntityMutation,
    beforeWrite,
    preflight,
    ...(cogsPendingReason ? { cogsPendingReason } : {}),
  };
}

export async function commitPreparedDocumentPost(
  db: Firestore,
  user: RequestUser,
  prepared: PreparedDocumentPost,
  options: DocumentPostExecutionOptions = {},
): Promise<DocumentPostResult> {
  const result = await commitLedgerBulk(db, user, {
    workspaceId: prepared.workspaceId,
    transactions: prepared.transactions,
    entityMutation: prepared.entityMutation,
  }, {
    ...(prepared.idempotencyKey ? { idempotencyKey: prepared.idempotencyKey } : {}),
    hashOf: prepared.hashOf,
    ...(prepared.beforeWrite ? { beforeWrite: prepared.beforeWrite } : {}),
    preflight: prepared.preflight,
    ...(options.transaction ? { transaction: options.transaction } : {}),
    ...(options.afterCommit ? { afterCommit: options.afterCommit } : {}),
  });
  return {
    committed: result.committed,
    body: result.body,
    transactions: result.transactions,
    ...(prepared.cogsPendingReason ? { cogsPendingReason: prepared.cogsPendingReason } : {}),
  };
}

function documentRequestFingerprint(input: DocumentPostInput) {
  const { collection, docId, workspaceId, action } = input;
  const hashOf = { collection, docId, workspaceId, action, data: input.data };
  return input.creditLimitOverride ? { ...hashOf, creditLimitOverride: input.creditLimitOverride } : hashOf;
}

export type PreparedDocumentRequest = { replay: DocumentPostResult } | { plan: PreparedDocumentPost };

/** A legacy retry must be recognized before building, even if the document has since been edited or removed. */
export async function prepareDocumentRequest(db: Firestore, user: RequestUser, input: DocumentPostInput): Promise<PreparedDocumentRequest> {
  const { workspaceId, idempotencyKey } = input;
  assertWorkspaceScope(user, workspaceId);
  const workspace = (await db.collection('workspaces').doc(workspaceId).get()).data();
  if (!isWorkspaceMemberData(workspace, user, workspaceId)) throw new BulkRefusal(403, { error: 'Not a member' });
  if (idempotencyKey) {
    const replay = await readLegacyBulkReplay(db, user, `${workspaceId}_${idempotencyKey}`, requestPayloadHash(documentRequestFingerprint(input)), 0);
    if (replay) return { replay };
  }
  return { plan: await prepareDocumentPost(db, user, input) };
}

export async function postDocument(db: Firestore, user: RequestUser, input: DocumentPostInput): Promise<DocumentPostResult> {
  const prepared = await prepareDocumentRequest(db, user, input);
  return 'replay' in prepared ? prepared.replay : commitPreparedDocumentPost(db, user, prepared.plan);
}

export async function previewDocumentPost(db: Firestore, user: RequestUser, input: DocumentPostInput) {
  const prepared = await prepareDocumentPost(db, user, input);
  const [entry] = prepared.transactions;
  const accounts: Array<{ id: string; name?: unknown }> = (await db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId).get()).docs
    .map(doc => {
      const account = doc.data() as Record<string, unknown> | undefined;
      return { ...account, id: doc.id };
    });
  const nameFor = (accountId: string): string | undefined => {
    const account = accounts.find(candidate => candidate.id === accountId);
    return typeof account?.name === 'string' ? account.name : undefined;
  };
  const title = `${input.action === 'delete' ? 'Delete' : 'Create'} ${NAMES[input.collection]} ${String(input.data.number || input.docId)}`;
  return {
    title,
    lines: [
      String(input.data.date || entry?.date || ''),
      `${String(input.data.status || 'document')} — ${String(input.data.amountCents ?? 0)} cents`,
      `${prepared.transactions.length} ledger posting${prepared.transactions.length === 1 ? '' : 's'} prepared`,
    ],
    accounts: prepared.transactions.flatMap(transaction => transaction.lines || []).map(line => ({
      accountId: line.accountId,
      ...(nameFor(line.accountId) ? { accountName: nameFor(line.accountId) } : {}),
      amountCents: line.amountCents,
      ...(line.description ? { description: line.description } : {}),
    })),
  };
}
