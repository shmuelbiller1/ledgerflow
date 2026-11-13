/**
 * #652 / #662: the server's own answer to "may this ledger entry be changed or removed at all?".
 *
 * The browser already refuses to edit, void or reverse an entry that belongs to a document or a system
 * run (`src/lib/transactionEdits.ts` `isDocumentEntry`, used by the transaction row and the ledger
 * list), but the generic entry routes enforced none of it: a bookkeeper could PUT an invoice's or a
 * payment's entry (status → void/failed, lines rewritten) or reverse it, and the document kept saying
 * `paid` while the books said something else. A posted entry could also be un-posted in place by setting
 * its status to `failed`/`draft`, which `isPostable` drops from every report — "Undo" then answered 200
 * while the entry stayed out of the books.
 *
 * The rule is the client's rule, applied on the server: a document's entry is changed through that
 * document (void or credit the invoice, bill or payment), and a posted entry is un-posted only by a
 * reversing entry, which the books keep. A platform admin keeps the existing override, exactly as the
 * status/cleared locks already do.
 */
import type { Transaction } from '../../types';

/** Statuses a posted entry must not be moved to in place: `isPostable` drops both from the books. */
const UNPOSTS = new Set(['failed', 'draft']);

/** True when the entry is posted in the sense the reports use: completed, cleared or reconciled. */
export function isPostedEntry(tx: Partial<Transaction> | null | undefined): boolean {
  if (!tx) return false;
  return tx.status === 'completed' || tx.isCleared === true || tx.reconciled === true;
}

/**
 * The fields a document's entry must not have changed behind the document's back: its status, its
 * figures, the date, the metadata that carries the document link, and the locks.
 */
const FINANCIAL_FIELDS = new Set([
  'status', 'type', 'date', 'lines', 'amountCents', 'totalAmountCents', 'exchangeRate', 'currency',
  'baseAmountCents', 'metadata', 'reversalEventId', 'isCleared', 'reconciled', 'isReconciled',
  'isDeleted', 'deletedAt', 'uid', 'workspaceId',
]);

/** True when a partial update touches a financial field of the entry (a `metadata.x` path counts). */
export function touchesFinancialField(keys: string[]): boolean {
  return keys.some(key => FINANCIAL_FIELDS.has(key) || key.startsWith('metadata.'));
}

/**
 * The metadata keys that name the document an entry was posted for. The client's broader
 * `isDocumentEntry` also counts any metadata `type` and `isReversal`, which is right for hiding list
 * actions but too wide for the server: entries posted by a system run (cost of goods sold, a payroll
 * import, a landed cost, depreciation, a close) carry a `type` too, and the product reverses exactly
 * those in place — restoring stock, allowing a corrected payroll file — through this same route.
 */
const DOCUMENT_LINK_KEYS = ['invoiceId', 'billId', 'paymentId', 'creditNoteId', 'vendorCreditId', 'estimateId', 'expenseId', 'depositId', 'purchaseOrderId'];

/** The `metadata.type` values the invoice, bill, payment and credit postings write for the document itself. */
const DOCUMENT_POSTING_TYPES = new Set([
  'invoice-accrual', 'invoice-payment', 'invoice-deposit',
  'bill-accrual', 'bill-payment',
  'payment-posting', 'payment-application',
  'credit-note-issuance', 'vendor-credit-issuance',
]);

/**
 * True when the entry is a document's own ledger posting — the one #652/#662 reported. A system run's
 * entry that merely names a document (cost of goods sold for an invoice, a landed cost charged to a
 * bill) is not its posting: it is reversible in place, and undoing it there is how the run is undone.
 */
export function isDocumentPosting(tx: Pick<Transaction, 'metadata'> | null | undefined): boolean {
  const meta = (tx?.metadata || {}) as Record<string, unknown>;
  const linked = DOCUMENT_LINK_KEYS.some(key => meta[key] !== undefined && meta[key] !== null && meta[key] !== '');
  if (!linked) return false;
  const type = typeof meta.type === 'string' ? meta.type : '';
  // An older posting carries the link but no type; anything else must be one of the posting types.
  return type === '' || DOCUMENT_POSTING_TYPES.has(type);
}

/**
 * The refusal for an entry that is a document's own posting, or null when it may be changed here.
 *
 * `changedKeys`, when given, is a partial update: flagging a document's entry for review, or adding a
 * note to it, is not a change to the books and stays allowed; a status, a figure, a date or the
 * metadata is refused. A whole-record rewrite (no `changedKeys`) is always refused.
 */
export function documentEntryRefusal(
  tx: Pick<Transaction, 'metadata'> | null | undefined,
  admin = false,
  changedKeys?: string[],
): string | null {
  if (!tx || admin || !isDocumentPosting(tx)) return null;
  if (changedKeys && !touchesFinancialField(changedKeys)) return null;
  return 'This entry is the posting of an invoice, bill, payment or credit. Change it through that document — void or credit it — instead of editing or reversing the ledger entry.';
}

/** The refusal for un-posting a posted entry in place (status → failed/draft), or null when allowed. */
export function postedStatusRefusal(
  tx: Partial<Transaction> | null | undefined,
  nextStatus: unknown,
  admin = false,
): string | null {
  if (!tx || admin || typeof nextStatus !== 'string' || !UNPOSTS.has(nextStatus)) return null;
  if (!isPostedEntry(tx)) return null;
  if (tx.status === nextStatus) return null;
  return 'A posted entry is not un-posted in place. Post a reversing entry instead: the books keep both the original and the correction.';
}

/** What an audit row records before and after an edit: the figures an auditor asks about first. */
export function auditSnapshot(tx: Partial<Transaction> | null | undefined): Record<string, unknown> | null {
  if (!tx) return null;
  return {
    status: tx.status ?? null,
    date: tx.date ?? null,
    totalAmountCents: tx.totalAmountCents ?? null,
    description: tx.description ?? null,
    lineCount: Array.isArray(tx.lines) ? tx.lines.length : 0,
    currency: tx.currency ?? null,
    exchangeRate: tx.exchangeRate ?? null,
  };
}
