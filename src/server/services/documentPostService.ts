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
import { assertPostingOpen } from '../../lib/periodLock';
import { BulkRefusal, commitLedgerBulk, type BeforeWrite, type LedgerBulkPreflight } from './ledgerBulkCommit';
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

  // as /transactions/bulk: the save merges into what is saved (an update of a document not saved yet makes it); a
  // second live posting of the same document is refused at commit (INT-2)
  const document: Record<string, unknown> = { ...(existing || {}), ...(action === 'delete' ? {} : input.data), id: docId, workspaceId };
  const wsRecord = workspace || {};
  const context: LedgerPostContext = await loadPostingContext(db, { workspaceId, uid: user.uid, collection, docId, document, workspace: wsRecord, lockChecked: true });
  context.today = agreedPostingDay(context.today || todayIn(wsRecord.timezone as string | undefined), input.postingDay);
  const key = DOCUMENT_ENTRY_KEY[collection];
  const dates = action === 'delete'
    ? (context.transactions || []).filter(tx => tx.metadata?.[key] === docId && isPostable(tx) && !tx.metadata?.isReversal).map(tx => String(tx.date))
    : [String(document.date || context.today)];
  try {
    for (const date of dates) assertPostingOpen(date, workspace as never, user.uid);
  } catch (err) {
    throw new BulkRefusal(409, { error: err instanceof Error ? err.message : String(err) });
  }
  // audit F8: a sent invoice or bill whose total is less than its items allow is refused, not posted at that total
  // (draft, rejected, void and cancelled only reverse, as the posting services treat them; a bill's lines are its splits)
  if (action !== 'delete' && (collection === 'invoices' || collection === 'bills') && !['draft', 'rejected', 'void', 'cancelled'].includes(String(document.status))) {
    const contradiction = itemsExceedTotal(collection === 'bills' ? { ...document, items: document.splits } : document);
    if (contradiction) throw new BulkRefusal(400, { error: contradiction });
  }

  const mutation = mutationOf(collection, docId, action, action === 'delete' ? undefined : input.data);
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
  const transactions = captured[0].txs.map(tx => ({ ...tx, id: tx.id || crypto.randomUUID() })) as unknown as Transaction[];
  const validatedTransactions: Transaction[] = [];
  for (const transaction of transactions) {
    transaction.uid = user.uid;
    transaction.workspaceId = workspaceId;
    validatedTransactions.push(await TransactionValidator.validateAndPrepare(transaction, {
      workspaceId,
      user: { uid: user.uid, admin: user.admin },
      wsData: wsRecord,
    }));
  }
  // EG-4: budget reads happen before the command runner opens its database transaction.
  const plannedBudgetWarnings: BudgetWarning[] = await budgetWarningsFor(db, workspaceId, wsRecord, validatedTransactions);
  const preflight: LedgerBulkPreflight = { workspace: wsRecord, transactions: validatedTransactions, budgetWarnings: plannedBudgetWarnings };
  // EG-5: an invoice saved as issued stays within the customer's credit limit, checked inside the commit's transaction
  const beforeWrite: BeforeWrite | undefined = collection === 'invoices'
    ? (t, state) => enforceCreditLimit(db, t, { user, workspaceId, workspace: state.workspace, docId, action, data: input.data, existing: state.existingEntity, override: input.creditLimitOverride })
    : undefined;

  const hashOf = { collection, docId, workspaceId, action, data: input.data };
  const hashed = input.creditLimitOverride ? { ...hashOf, creditLimitOverride: input.creditLimitOverride } : hashOf;
  return {
    workspaceId,
    document,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    hashOf: hashed,
    transactions: validatedTransactions,
    entityMutation: (captured[0].entityMutation || mutation) as EntityMutation,
    ...(beforeWrite ? { beforeWrite } : {}),
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
    body: result.body,
    transactions: result.committed && !result.body.replayed ? result.transactions : [],
    ...(prepared.cogsPendingReason ? { cogsPendingReason: prepared.cogsPendingReason } : {}),
  };
}

/**
 * Existing document route wrapper. It retains the legacy idempotency record shape, while command
 * handlers may prepare and commit through the same underlying service using the runner's transaction.
 */
export async function postDocument(
  db: Firestore,
  user: RequestUser,
  input: DocumentPostInput,
  options: DocumentPostExecutionOptions = {},
): Promise<DocumentPostResult> {
  const { collection, docId, workspaceId } = input;
  assertWorkspaceScope(user, workspaceId);
  const workspace = (await db.collection('workspaces').doc(workspaceId).get()).data();
  if (!isWorkspaceMemberData(workspace, user, workspaceId)) throw new BulkRefusal(403, { error: 'Not a member' });

  // Preserve the old endpoint's replay behavior and response while the route remains a compatibility wrapper.
  if (input.idempotencyKey && (await db.collection('idempotencyKeys').doc(`${workspaceId}_${input.idempotencyKey}`).get()).exists) {
    const { body } = await commitLedgerBulk(db, user, {
      workspaceId,
      entityMutation: mutationOf(collection, docId, input.action, input.data),
    }, {
      idempotencyKey: input.idempotencyKey,
      hashOf: input.creditLimitOverride
        ? { collection, docId, workspaceId, action: input.action, data: input.data, creditLimitOverride: input.creditLimitOverride }
        : { collection, docId, workspaceId, action: input.action, data: input.data },
      ...(options.transaction ? { transaction: options.transaction } : {}),
      ...(options.afterCommit ? { afterCommit: options.afterCommit } : {}),
    });
    return { body, transactions: [] };
  }

  const prepared = await prepareDocumentPost(db, user, input);
  return commitPreparedDocumentPost(db, user, prepared, options);
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
