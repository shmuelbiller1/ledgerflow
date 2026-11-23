import { z } from 'zod';
import type { DocumentData, Firestore } from '../db/firestore';
import { FieldValue, isWorkspaceMemberData } from '../db/firestore';
import { ledgerCreate, ledgerMark, ledgerRewrite } from './ledgerDoor';
import { revaluationEntryLock } from './stockRevaluationService';
import { LEDGER_WRITER_ROLES, roleInWorkspace } from '../middleware/requireLedgerWriter';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { BankLineUpdateSchema } from '../../schemas';
import { assertPostingOpen } from '../../lib/periodLock';
import { lineAmount, settleHomeCurrency } from '../../lib/txFilters';
import type { ChartAccount, Transaction } from '../../types';
import { resolveAccountRole } from '../../lib/accountUtils';

/**
 * #891 (A10-H1-01): a bank line is cleared only against a cash movement. The entry must have a leg in
 * the line's own bank account (or, when the line names no account, in some cash account), and that
 * leg must go the same way as the line: a withdrawal is not cleared by a deposit, and a bill accrual
 * that only moves A/P and expense never moved money at the bank. Returns the refusal, or null.
 */
export function cashMovementRefusal(
  line: { accountId?: unknown; amountCents?: unknown },
  entryLines: unknown,
  accountsById: ReadonlyMap<string, DocumentData>,
  entry: { exchangeRate?: unknown; currency?: unknown } = {},
): string | null {
  const amount = Number(line.amountCents);
  const lines = Array.isArray(entryLines) ? entryLines as Array<{ accountId?: unknown; amountCents?: unknown }> : [];
  // Codex on #972: home-currency amounts (a line's settled baseAmountCents, else its rate), as the
  // reports and the auto-matcher read them, so an FX entry's direction is the money that really moved
  const home = (l: { amountCents?: unknown }) => lineAmount(l as Parameters<typeof lineAmount>[0], entry as Parameters<typeof lineAmount>[1]);
  const ownAccount = typeof line.accountId === 'string' && line.accountId ? line.accountId : null;
  const isCash = (id: string) => resolveAccountRole(accountsById.get(id) as ChartAccount | undefined) === 'cash';
  // a line in a named account uses that account's leg; a line with no account qualifies through any one
  // cash account (Codex on #972: a transfer between two banks nets to zero overall but moves money in each)
  const legs = new Map<string, number>();
  for (const l of lines) {
    const id = typeof l?.accountId === 'string' ? l.accountId : '';
    if (!id || (ownAccount ? id !== ownAccount : !isCash(id))) continue;
    legs.set(id, (legs.get(id) || 0) + (home(l) || 0));
  }
  const moved = [...legs.values()].filter(leg => leg !== 0);
  if (moved.length === 0) {
    return ownAccount
      ? 'This entry moved no money in the bank line\'s account, so it cannot clear it. Record the payment first.'
      : 'This entry moved no money in a bank or cash account, so it cannot clear a bank line. Record the payment first.';
  }
  if (Number.isFinite(amount) && amount !== 0 && !moved.some(leg => Math.sign(leg) === Math.sign(amount))) {
    return amount < 0
      ? 'This entry put money into the account; it cannot clear a withdrawal.'
      : 'This entry took money out of the account; it cannot clear a deposit.';
  }
  return null;
}

/**
 * POST /transactions/reconcile in one place (CA-01/CA-04): a batch of bank-line and transaction
 * changes that a reconciliation screen sends together — match or unmatch a line, correct an entry,
 * create the entry a line was cleared against — committed in one database transaction with one
 * audit line, or not at all.
 *
 * The work is split the way the command runner needs it: `prepareReconcile` does the reads and the
 * refusals a person can see before anything opens (400 for a malformed batch, 404 for a workspace
 * that is not there, 403 for a role that may not write the books), and `reconcileInTransaction`
 * does the reads and writes that must share the runner's transaction. Neither posts: an entry the
 * batch creates or edits is validated by the same `TransactionValidator` the rest of the ledger
 * uses, so the amounts and lines are unchanged by this move.
 */

export class ReconcileError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ReconcileError';
  }
}

/** One operation in the batch, as the reconciliation screen sends it. */
export interface ReconcileOperation {
  id: string;
  type: string;
  data?: Record<string, unknown>;
}

export interface ReconcileInput {
  workspaceId: string;
  operations: ReconcileOperation[];
}

export const RECONCILE_MAX_OPERATIONS = 250;

type FirebaseTx = Parameters<Parameters<Firestore['runTransaction']>[0]>[0];

/**
 * `assertPostingOpen` throws a plain Error; the reconciliation routes answered a closed period with
 * a 400 (`/reconcile`, `/clear`) or a 409 (`/complete`). Raise the batch's own error so the runner
 * keeps the legacy status instead of turning it into a 500.
 */
function assertOpen(date: string, workspace: DocumentData, uid: string): void {
  try {
    assertPostingOpen(date, workspace as never, uid);
  } catch (error) {
    throw new ReconcileError(400, error instanceof Error ? error.message : String(error));
  }
}

/** The accounts and transactions a batch names, gathered once so the transaction reads them upfront. */
export interface ReconcilePrepared {
  workspace: DocumentData;
  role: string;
  bankLineIds: string[];
  txIds: string[];
  accountIds: string[];
}

/**
 * The reads and refusals that happen before the transaction opens. A batch is refused whole: an
 * operation without an id, an unknown operation type, or one that names more than 250 changes.
 */
export async function prepareReconcile(
  db: Firestore,
  input: { workspaceId: string; operations: ReconcileOperation[]; uid: string },
): Promise<ReconcilePrepared> {
  const { workspaceId, operations, uid } = input;
  if (!workspaceId || !Array.isArray(operations) || operations.length === 0) {
    throw new ReconcileError(400, 'Missing workspaceId or operations');
  }
  if (operations.length > RECONCILE_MAX_OPERATIONS) {
    throw new ReconcileError(400, `Operations batch exceeds ${RECONCILE_MAX_OPERATIONS} operations limit`);
  }
  const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
  if (!wsDoc.exists) throw new ReconcileError(404, 'Workspace not found');
  const workspace = wsDoc.data() || {};
  const role = roleInWorkspace(workspace, uid);
  if (!LEDGER_WRITER_ROLES.includes(role)) {
    throw new ReconcileError(403, 'Forbidden: requires owner, accountant, or bookkeeper role');
  }

  const bankLineIds = new Set<string>();
  const txIds = new Set<string>();
  const accountIds = new Set<string>();
  for (const op of operations) {
    if (!op.id || typeof op.id !== 'string') throw new ReconcileError(400, 'Invalid operation ID');
    if (op.type === 'updateBankLine') {
      // #891 (Codex on #972): each update is checked against the stored line, so two updates to one line
      // in a batch could set a target and then the status without the pair ever being checked
      if (bankLineIds.has(op.id)) throw new ReconcileError(400, `Bank line ${op.id} is changed more than once in this request; send one change per line`);
      bankLineIds.add(op.id);
    } else if (op.type === 'updateTransaction' || op.type === 'createTransaction') {
      txIds.add(op.id);
      const lines = op.data?.lines;
      if (Array.isArray(lines)) {
        for (const line of lines as Array<{ accountId?: string }>) {
          if (line?.accountId) accountIds.add(line.accountId);
        }
      }
    } else {
      throw new ReconcileError(400, `Unsupported operation type: ${op.type}`);
    }
  }
  return {
    workspace,
    role,
    bankLineIds: [...bankLineIds],
    txIds: [...txIds],
    accountIds: [...accountIds],
  };
}

/**
 * `TransactionValidator` throws plain Errors with no status, which the runner would answer with a
 * generic 500. The legacy route answered a batch it could not validate with a 400 (or a 403 when the
 * message said Forbidden), and showed the person the real reason; keep that.
 */
async function validateForBatch(
  ...args: Parameters<typeof TransactionValidator.validateAndPrepare>
): Promise<Awaited<ReturnType<typeof TransactionValidator.validateAndPrepare>>> {
  try {
    return await TransactionValidator.validateAndPrepare(...args);
  } catch (error) {
    if (error instanceof ReconcileError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ReconcileError(message === 'Not a member' || message.includes('Forbidden') ? 403 : 400, message);
  }
}

/**
 * The batch itself, inside the runner's transaction. Every read happens before the first write
 * (Firestore refuses a read after a write in the same transaction), the workspace is read again so a
 * lock or a role that changed meanwhile is seen, and the period lock is checked against the lock the
 * workspace has *now*, not the one `prepare` saw.
 */
export async function reconcileInTransaction(
  db: Firestore,
  t: FirebaseTx,
  input: ReconcileInput,
  prepared: ReconcilePrepared,
  actor: { uid: string; email?: string; admin?: boolean },
): Promise<{ operations: number }> {
  const { workspaceId, operations } = input;

  // Re-read the workspace inside the transaction to close the window on lockDate and member role
  const wsSnapNow = await t.get(db.collection('workspaces').doc(workspaceId));
  if (!wsSnapNow.exists) throw new ReconcileError(404, 'Workspace not found');
  const wsNow = wsSnapNow.data() || {};
  if (!actor.admin && (!isWorkspaceMemberData(wsNow, actor, workspaceId) || !LEDGER_WRITER_ROLES.includes(roleInWorkspace(wsNow, actor.uid)))) {
    throw new ReconcileError(403, 'Forbidden: requires owner, accountant, or bookkeeper role');
  }

  // STEP 1: every read upfront, so no read follows a write
  const bankLineSnaps = new Map<string, DocumentData & { exists?: boolean; id?: string; data(): DocumentData }>();
  for (const id of prepared.bankLineIds) {
    const snap = await t.get(db.collection('bankLines').doc(id));
    bankLineSnaps.set(id, snap as unknown as DocumentData & { exists?: boolean; id?: string; data(): DocumentData });
  }

  const txSnaps = new Map<string, DocumentData & { exists?: boolean; id?: string; data(): DocumentData }>();
  for (const id of prepared.txIds) {
    const snap = await t.get(db.collection('transactions').doc(id));
    txSnaps.set(id, snap as unknown as DocumentData & { exists?: boolean; id?: string; data(): DocumentData });
  }

  // #891: the entries bank lines are matched to, read now (no closed-period check: only the line changes)
  const matchedSnaps = new Map<string, DocumentData & { exists?: boolean; id?: string; data(): DocumentData }>();
  for (const op of operations) {
    if (op.type !== 'updateBankLine') continue;
    const sentMid = op.data && 'matchedTransactionId' in op.data ? op.data.matchedTransactionId : undefined;
    const mid = sentMid !== undefined ? sentMid : bankLineSnaps.get(op.id)?.data?.()?.matchedTransactionId;
    if (typeof mid === 'string' && mid && !txSnaps.has(mid) && !matchedSnaps.has(mid)) {
      const snap = await t.get(db.collection('transactions').doc(mid));
      matchedSnaps.set(mid, snap as unknown as DocumentData & { exists?: boolean; id?: string; data(): DocumentData });
    }
  }

  // Closed periods (src/lib/periodLock.ts): nothing dated in them is changed or created.
  for (const snap of [...bankLineSnaps.values(), ...txSnaps.values()]) {
    const date = snap.exists ? snap.data()?.date : undefined;
    if (typeof date === 'string' && date) assertOpen(date, wsNow, actor.uid);
  }
  for (const op of operations) {
    const date = op.data?.date;
    if ((op.type === 'createTransaction' || op.type === 'updateTransaction') && typeof date === 'string' && date) {
      assertOpen(date, wsNow, actor.uid);
    }
  }

  // accounts named by the entries that already exist are added to the ones the batch named
  const accountIds = new Set(prepared.accountIds);
  for (const snap of [...txSnaps.values(), ...matchedSnaps.values()]) {
    const lines = snap.exists ? snap.data()?.lines : undefined;
    if (Array.isArray(lines)) {
      for (const l of lines as Array<{ accountId?: string }>) {
        if (l?.accountId) accountIds.add(l.accountId);
      }
    }
  }

  const accMap = new Map<string, DocumentData>();
  if (accountIds.size > 0) {
    const accRefs = [...accountIds].map(id => db.collection('chartAccounts').doc(id));
    const accSnaps = await t.getAll(...accRefs);
    for (const snap of accSnaps) {
      if (snap.exists) accMap.set(snap.id, snap.data() || {});
    }
  }

  // STEP 2: validate in memory and prepare every write
  const writes: Array<() => void> = [];
  // BR-05: one entry clears one bank line. A second line matched to the same entry in this batch (or
  // one already matched to it) would clear twice the bank activity against one movement, so it is refused.
  const matchedEntryOwners = new Map<string, string>();

  for (const op of operations) {
    if (op.type === 'updateBankLine') {
      const lineSnap = bankLineSnaps.get(op.id);
      if (!lineSnap || !lineSnap.exists || lineSnap.data()?.workspaceId !== workspaceId) {
        throw new ReconcileError(400, `Bank line ${op.id} does not belong to authorized workspace`);
      }
      const lineRef = db.collection('bankLines').doc(op.id);
      const validatedData = BankLineUpdateSchema.parse(op.data);
      // a bank line in another currency is not matched as home-currency money: its amount needs a
      // conversion first (AF-001 follow-up, CodeRabbit on #439)
      const lineCurrency = String(lineSnap.data()?.currency || '').toUpperCase();
      const homeCurrency = String(prepared.workspace?.currency || wsNow.currency || 'USD').toUpperCase();
      if (validatedData.status === 'matched' && lineCurrency && lineCurrency !== homeCurrency) {
        throw new ReconcileError(400, `Bank line ${op.id} is in ${lineCurrency}, not ${homeCurrency}; it can't be matched until it is converted`);
      }
      // #891: the entry must be a cash movement in this line's account and direction. Its lines are the
      // last ones this batch sends for it, or else the stored ones.
      // Gitar on #972: the line's resulting state decides, so the id and the status sent in separate
      // requests (or a stored id) are checked too
      const storedLine = lineSnap.data() || {};
      const finalStatus = validatedData.status ?? storedLine.status;
      const matchedId = 'matchedTransactionId' in validatedData ? (validatedData as { matchedTransactionId?: unknown }).matchedTransactionId : storedLine.matchedTransactionId;
      if (finalStatus === 'matched' && typeof matchedId === 'string' && matchedId) {
        // Codex on #972: each update merges with the stored entry on its own, so with two changes to the
        // same entry the lines checked might not be the ones saved. One change per matched entry.
        const entryOps = operations.filter(o => (o.type === 'createTransaction' || o.type === 'updateTransaction') && o.id === matchedId);
        if (entryOps.length > 1) {
          throw new ReconcileError(400, `Entry ${matchedId} is changed more than once in this request; send one change for an entry a bank line is matched to`);
        }
        const sent = entryOps.filter(o => Array.isArray(o.data?.lines));
        const stored = txSnaps.get(matchedId) || matchedSnaps.get(matchedId);
        const storedEntry = stored?.exists ? stored.data() || {} : {};
        const entryData = sent.length ? { ...storedEntry, ...(sent[0].data || {}) } : storedEntry;
        const entryLines = entryData.lines;
        if (!sent.length && (!stored || !stored.exists || stored.data()?.workspaceId !== workspaceId)) {
          throw new ReconcileError(404, `Entry ${matchedId} not found in workspace`);
        }
        const refusal = cashMovementRefusal(lineSnap.data() || {}, entryLines, accMap, entryData);
        if (refusal) throw new ReconcileError(400, refusal);
        // BR-05: the entry may clear only this one line — not another line in this batch, and not one
        // that is already matched to it
        const previousOwner = matchedEntryOwners.get(matchedId);
        if (previousOwner && previousOwner !== op.id) {
          throw new ReconcileError(400, `Entry ${matchedId} is already matched to bank line ${previousOwner}; one entry clears one bank line`);
        }
        matchedEntryOwners.set(matchedId, op.id);
      }
      // undoing a match on a line the bank later changed or withdrew: the bank's version is what goes
      // back to To review, since the next sync will not send that change again (CodeRabbit on #439)
      const line = lineSnap.data() || {};
      if (validatedData.status === 'pending' && line.bankChange === 'removed') {
        // its entry must be released in the same request, or it would stay reconciled to nothing,
        // and the last update to that entry decides its status (CodeRabbit on #455)
        const entryOps = operations.filter(o => o.type === 'updateTransaction' && o.id === line.matchedTransactionId) as Array<{ data?: { status?: unknown } }>;
        if (line.matchedTransactionId && entryOps[entryOps.length - 1]?.data?.status !== 'completed') {
          throw new ReconcileError(400, `Bank line ${op.id} was withdrawn by the bank: undo its entry's match in the same request`);
        }
        writes.push(() => t.delete(lineRef));
        continue;
      }
      // the bank's new date must be in an open period too (Codex on #455)
      const correctionDate = (line.bankCorrection as { date?: unknown } | undefined)?.date;
      if (validatedData.status === 'pending' && line.bankChange === 'modified' && typeof correctionDate === 'string' && correctionDate) {
        assertOpen(correctionDate, wsNow, actor.uid);
      }
      const correctionSource = line.bankCorrection;
      const correction = validatedData.status === 'pending' && line.bankChange === 'modified' && correctionSource && typeof correctionSource === 'object'
        ? {
          date: (correctionSource as { date?: unknown }).date,
          description: (correctionSource as { description?: unknown }).description,
          amountCents: (correctionSource as { amountCents?: unknown }).amountCents,
          currency: (correctionSource as { currency?: unknown }).currency,
          suggestion: null,
          bankChange: null,
          bankChangeAt: null,
          bankCorrection: null,
        }
        : {};
      writes.push(() => t.update(lineRef, { ...validatedData, ...correction, updatedAt: FieldValue.serverTimestamp() }));
    } else if (op.type === 'updateTransaction') {
      const txSnap = txSnaps.get(op.id);
      if (!txSnap || !txSnap.exists || txSnap.data()?.workspaceId !== workspaceId) {
        throw new ReconcileError(400, `Transaction ${op.id} does not belong to authorized workspace`);
      }
      const existingTxData = txSnap.data() as unknown as Transaction;
      const revalLock = revaluationEntryLock(existingTxData);
      if (revalLock) throw new ReconcileError(400, revalLock);
      if ((existingTxData.status === 'certified' || existingTxData.status === 'void') && !actor.admin) {
        throw new ReconcileError(403, `Forbidden: Transaction ${op.id} status is locked.`);
      }
      const existingMeta = (existingTxData.metadata || {}) as Record<string, unknown>;
      const existingLines = op.data?.lines;
      if (existingLines !== undefined && (existingMeta.invoiceId || existingMeta.billId || existingMeta.paymentId || existingMeta.creditNoteId || existingMeta.vendorCreditId)) {
        throw new ReconcileError(400, `Transaction ${op.id} belongs to a source document; lines cannot be rewritten during reconciliation.`);
      }

      const safeData: Record<string, unknown> = { ...(op.data || {}) };
      delete safeData.workspaceId;
      delete safeData.uid;

      const merged = { ...existingTxData, ...safeData } as Transaction;
      settleHomeCurrency(merged, String(wsNow.currency || "USD"));

      const validatedTx = await validateForBatch(merged, {
        workspaceId,
        user: { uid: actor.uid, admin: actor.admin },
        wsData: wsNow as never,
        accountsMap: accMap,
      }, existingTxData, t);

      // the corrected entry goes back through the door: it is checked again before it is rewritten
      const txRef = db.collection('transactions').doc(op.id);
      writes.push(() => ledgerRewrite(t, txRef, { ...validatedTx, updatedAt: FieldValue.serverTimestamp() }));
    } else if (op.type === 'createTransaction') {
      const txSnap = txSnaps.get(op.id);
      if (txSnap && txSnap.exists) throw new ReconcileError(400, `Transaction ${op.id} already exists`);

      const payload = {
        ...(op.data || {}),
        id: op.id,
        workspaceId,
        uid: actor.uid,
        createdAt: (op.data?.createdAt as string) || new Date().toISOString(),
      } as unknown as Transaction;
      settleHomeCurrency(payload, String(wsNow.currency || "USD"));
      const validatedTx = await validateForBatch(payload, {
        workspaceId,
        user: { uid: actor.uid, admin: actor.admin },
        wsData: wsNow as never,
        accountsMap: accMap,
      }, undefined, t);

      const txRef = db.collection('transactions').doc(op.id);
      writes.push(() => ledgerCreate(t, txRef, { ...validatedTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
    }
  }

  // STEP 3: execute every write together
  for (const writeOp of writes) writeOp();

  return { operations: operations.length };
}

/** The audit line the batch leaves, and the entry id it names. */
export async function prepareClearEntries(
  db: Firestore,
  input: { workspaceId: string; transactionIds: string[]; clearanceDate?: string; cleared?: boolean; uid: string; admin?: boolean },
): Promise<ClearEntriesPrepared> {
  const { workspaceId, transactionIds, clearanceDate } = input;
  if (!workspaceId || !Array.isArray(transactionIds) || transactionIds.length === 0) {
    throw new ClearEntriesError(400, 'Missing workspaceId or transactionIds');
  }
  if (transactionIds.length > CLEAR_MAX_ENTRIES) {
    throw new ClearEntriesError(400, `Batch size exceeds limit of ${CLEAR_MAX_ENTRIES} items`);
  }
  const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
  // a platform admin is let in without membership, as the legacy route let them in
  if (!wsDoc.exists || !isWorkspaceMemberData(wsDoc.data(), { uid: input.uid, admin: input.admin }, workspaceId)) {
    throw new ClearEntriesError(403, 'Not a member');
  }
  // marking entries cleared is bookkeeping: owners, accountants and bookkeepers (CA-04)
  const role = roleInWorkspace(wsDoc.data(), input.uid);
  if (!input.admin && !LEDGER_WRITER_ROLES.includes(role)) {
    throw new ClearEntriesError(403, 'Only owners, accountants and bookkeepers mark entries cleared');
  }
  // the day the bank cleared it (CA-04): optional, never before the entry's own date; cleared: false undoes it
  if (clearanceDate !== undefined && (typeof clearanceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(clearanceDate))) {
    throw new ClearEntriesError(400, 'The clearance date must be a date (YYYY-MM-DD)');
  }
  return { workspace: wsDoc.data() || {}, undo: input.cleared === false };
}

/**
 * Mark the batch cleared (or clear the mark again) inside the runner's transaction. Every entry is
 * read first, so a batch naming one entry that is not there writes nothing at all.
 */
export async function clearEntriesInTransaction(
  db: Firestore,
  t: FirebaseTx,
  input: ClearEntriesInput,
  prepared: ClearEntriesPrepared,
  actor: { uid: string; admin?: boolean },
): Promise<{ clearedCount: number; undo: boolean }> {
  const { workspaceId, transactionIds, clearanceDate } = input;
  const undo = prepared.undo;
  const refs = transactionIds.map(id => db.collection('transactions').doc(id));
  const snaps = await t.getAll(...refs);

  const updates: Array<() => void> = [];
  for (const snap of snaps) {
    if (!snap.exists) throw new ClearEntriesError(404, `Transaction ${snap.id} not found`);
    const txData = snap.data() as unknown as Transaction;
    try {
      TransactionValidator.validateTransactionState(txData, {
        workspaceId,
        user: { uid: actor.uid, admin: actor.admin },
        wsData: prepared.workspace as never,
      });
    } catch (error) {
      // the legacy clear answered a closed period or a locked entry with a 400, not the runner's 500
      throw new ClearEntriesError(400, error instanceof Error ? error.message : String(error));
    }
    if (!undo && typeof clearanceDate === 'string' && txData.date && clearanceDate < String(txData.date).slice(0, 10)) {
      throw new ClearEntriesError(400, `It can't clear the bank before the entry's own date (${String(txData.date).slice(0, 10)})`);
    }
    // clearing an entry is a mark on it, so it goes through the door like every other ledger mark
    updates.push(() => ledgerMark(t, snap.ref, undo
      ? { isCleared: false, isReconciled: false, clearedAt: FieldValue.delete(), clearanceDate: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }
      : {
        isCleared: true,
        clearedAt: FieldValue.serverTimestamp(),
        ...(typeof clearanceDate === 'string' ? { clearanceDate } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }));
  }
  for (const update of updates) update();
  return { clearedCount: transactionIds.length, undo };
}

export async function prepareUpdateBankLine(
  db: Firestore,
  input: { workspaceId: string; id: string; uid: string; admin?: boolean },
): Promise<UpdateBankLinePrepared> {
  const { workspaceId, id, uid } = input;
  const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
  if (!wsDoc.exists || !isWorkspaceMemberData(wsDoc.data(), { uid, admin: input.admin }, workspaceId)) {
    throw new UpdateBankLineError(403, 'Not a member');
  }
  // #830: matching or ignoring a line takes it out of the reconciliation and the month-end checks, so it
  // is a ledger writer's act, in an open period — the same as every other reconciliation command
  if (!input.admin && !LEDGER_WRITER_ROLES.includes(roleInWorkspace(wsDoc.data(), uid))) {
    throw new UpdateBankLineError(403, 'Only owners, accountants and bookkeepers change bank lines');
  }
  const lineSnap = await db.collection('bankLines').doc(id).get();
  if (!lineSnap.exists || lineSnap.data()?.workspaceId !== workspaceId) {
    throw new UpdateBankLineError(404, `Bank line ${id} not found in workspace`);
  }
  const lineDate = lineSnap.data()?.date;
  if (typeof lineDate === 'string' && lineDate) {
    try {
      assertPostingOpen(lineDate, wsDoc.data() as never, uid);
    } catch (error) {
      throw new UpdateBankLineError(409, error instanceof Error ? error.message : String(error));
    }
  }
  return { workspace: wsDoc.data() || {} };
}

export const updateBankLineInput = z.object({
  /** The legacy body's workspace: the runner refuses one that is not the workspace it runs in. */
  workspaceId: z.string().min(1),
  id: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export async function updateBankLineInTransaction(
  db: Firestore,
  t: FirebaseTx,
  input: { workspaceId: string; id: string; data: Record<string, unknown> },
): Promise<{ id: string; data: Record<string, unknown> }> {
  // Strict allowlist validation (#78) - rejects any unknown or protected properties
  const validatedData = BankLineUpdateSchema.parse(input.data) as Record<string, unknown>;
  // #830: a line is matched only to an entry of its own workspace. #891 (and Gitar on #972): the line's
  // resulting state decides, so an id and a status sent in separate requests are checked too
  const lineSnap = await t.get(db.collection('bankLines').doc(input.id));
  const stored = lineSnap.data() || {};
  const finalStatus = validatedData.status ?? stored.status;
  const sentId = 'matchedTransactionId' in validatedData;
  const finalMatch = sentId ? validatedData.matchedTransactionId : stored.matchedTransactionId;
  if (typeof finalMatch === 'string' && finalMatch && (sentId || finalStatus === 'matched')) {
    const matched = await t.get(db.collection('transactions').doc(finalMatch));
    if (!matched.exists || matched.data()?.workspaceId !== input.workspaceId) {
      throw new UpdateBankLineError(404, `Entry ${finalMatch} not found in workspace`);
    }
    if (finalStatus === 'matched') {
      const entryLines = matched.data()?.lines;
      const ids = [...new Set((Array.isArray(entryLines) ? entryLines as Array<{ accountId?: unknown }> : []).map(l => l?.accountId).filter((id): id is string => typeof id === 'string' && !!id))];
      const accounts = new Map<string, DocumentData>();
      if (ids.length) {
        for (const snap of await t.getAll(...ids.map(id => db.collection('chartAccounts').doc(id)))) {
          if (snap.exists) accounts.set(snap.id, snap.data() || {});
        }
      }
      const refusal = cashMovementRefusal(stored, entryLines, accounts, matched.data() || {});
      if (refusal) throw new UpdateBankLineError(400, refusal);
    }
  }
  t.update(db.collection('bankLines').doc(input.id), { ...validatedData, updatedAt: FieldValue.serverTimestamp() });
  return { id: input.id, data: validatedData };
}

export async function prepareCompleteReconciliation(
  db: Firestore,
  input: CompleteReconciliationInput & { uid: string; admin?: boolean },
): Promise<CompleteReconciliationPrepared> {
  const wsDoc = await db.collection('workspaces').doc(input.workspaceId).get();
  if (!wsDoc.exists || !isWorkspaceMemberData(wsDoc.data(), { uid: input.uid, admin: input.admin }, input.workspaceId)) {
    throw new CompleteReconciliationError(403, 'Not a member');
  }
  if (!input.admin && !LEDGER_WRITER_ROLES.includes(roleInWorkspace(wsDoc.data(), input.uid))) {
    throw new CompleteReconciliationError(403, 'Only owners, accountants and bookkeepers complete reconciliations');
  }
  try {
    assertPostingOpen(input.statementDate, wsDoc.data() as never, input.uid);
  } catch (error) {
    // a closed statement period answered 409 on the legacy route
    throw new CompleteReconciliationError(/period locked/i.test(String((error as Error).message)) ? 409 : 400, (error as Error).message);
  }
  // BR-02: the account must be a cash account, and the statement starts from the last statement's
  // ending balance (or the account's recorded opening balance for a first reconciliation — a recorded
  // zero is a real zero, not an absent one).
  const accountSnap = await db.collection('chartAccounts').doc(input.accountId).get();
  if (!accountSnap.exists || accountSnap.data()?.workspaceId !== input.workspaceId) {
    throw new CompleteReconciliationError(404, `Account ${input.accountId} not found in workspace`);
  }
  const accountData = accountSnap.data() || {};
  if (resolveAccountRole(accountData as ChartAccount) !== 'cash') {
    throw new CompleteReconciliationError(400, `Account ${input.accountId} is not a bank or cash account; only cash accounts are reconciled`);
  }
  const priorDocs = (await db.collection('reconciliations')
    .where('workspaceId', '==', input.workspaceId)
    .where('accountId', '==', input.accountId)
    .where('status', '==', 'completed')
    .get()).docs;
  // the last statement before this one: the most recent statementDate not after the statement date
  let priorRec: { statementDate?: string; statementBalanceCents?: number } | undefined;
  for (const doc of priorDocs) {
    const data = doc.data() as { statementDate?: string; statementBalanceCents?: number } | undefined;
    const date = String(data?.statementDate || '');
    if (!data || date > input.statementDate) continue;
    if (!priorRec || date > String(priorRec.statementDate || '')) priorRec = data;
  }
  const beginningBalanceCents = typeof priorRec?.statementBalanceCents === 'number'
    ? priorRec.statementBalanceCents
    : (typeof accountData.openingBalanceCents === 'number' ? accountData.openingBalanceCents : 0);
  return {
    workspace: wsDoc.data() || {},
    reconciliationId: db.collection('reconciliations').doc().id,
    uniqueTxIds: [...new Set(input.reconciledTransactionIds)],
    completedAt: new Date().toISOString(),
    beginningBalanceCents,
  };
}

export async function completeReconciliationInTransaction(
  db: Firestore,
  t: FirebaseTx,
  input: CompleteReconciliationInput,
  prepared: CompleteReconciliationPrepared,
  actor: { uid: string },
): Promise<{ reconciliationId: string; completedAt: string; reconciledCount: number }> {
  const { workspaceId, accountId, statementDate, statementBalanceCents } = input;
  const { reconciliationId, uniqueTxIds, completedAt, beginningBalanceCents } = prepared;

  const accountSnap = await t.get(db.collection('chartAccounts').doc(accountId));
  if (!accountSnap.exists || accountSnap.data()?.workspaceId !== workspaceId) {
    throw new CompleteReconciliationError(404, `Account ${accountId} not found in workspace`);
  }

  const txRefs = uniqueTxIds.map(txId => db.collection('transactions').doc(txId));
  const txSnaps: Array<{ exists: boolean; ref: unknown; data(): DocumentData | undefined }> = [];
  for (const ref of txRefs) txSnaps.push(await t.get(ref) as never);
  for (let i = 0; i < txSnaps.length; i++) {
    const snap = txSnaps[i];
    if (!snap.exists) throw new CompleteReconciliationError(404, `Transaction ${uniqueTxIds[i]} not found`);
    const txData = snap.data() as Transaction;
    if (txData.workspaceId !== workspaceId) {
      throw new CompleteReconciliationError(403, `Transaction ${uniqueTxIds[i]} does not belong to this workspace`);
    }
    if (txData.status === 'void' || txData.status === 'draft') {
      throw new CompleteReconciliationError(400, `Cannot reconcile ${txData.status} transaction ${uniqueTxIds[i]}`);
    }
  }

  // BR-02: the server recomputes the agreement itself — the selected entries must be cash movements
  // in this account dated on or before the statement date, and the statement balance must be the
  // beginning balance plus exactly the money those entries moved in the account. The UI's zero
  // difference is not trusted.
  const accountData = accountSnap.data() || {};
  const accMap = new Map([[accountId, accountData]]);
  if (resolveAccountRole(accountData as ChartAccount) !== 'cash') {
    throw new CompleteReconciliationError(400, `Account ${accountId} is not a bank or cash account`);
  }
  let selectedCents = 0;
  for (let i = 0; i < txSnaps.length; i++) {
    const snap = txSnaps[i];
    const txData = snap.data() as Transaction;
    const txDate = String(txData.date || '').slice(0, 10);
    if (txDate > statementDate.slice(0, 10)) {
      throw new CompleteReconciliationError(400, `Transaction ${uniqueTxIds[i]} is dated ${txDate}, after the statement date ${statementDate}: it cannot clear this statement`);
    }
    const refusal = cashMovementRefusal({ accountId, amountCents: 0 }, txData.lines, accMap, txData);
    if (refusal) {
      throw new CompleteReconciliationError(400, `Transaction ${uniqueTxIds[i]} cannot clear account ${accountId}: ${refusal}`);
    }
    // the money this entry moved in the account (its leg here, signed)
    const legs = new Map<string, number>();
    for (const l of (txData.lines || []) as Array<{ accountId?: string }>) {
      if (l?.accountId === accountId) legs.set(accountId, (legs.get(accountId) || 0) + (lineAmount(l as never, txData) || 0));
    }
    selectedCents += legs.get(accountId) || 0;
  }
  if (beginningBalanceCents + selectedCents !== statementBalanceCents) {
    throw new CompleteReconciliationError(400, `The statement balance ${statementBalanceCents} does not agree with the beginning balance ${beginningBalanceCents} plus the selected entries ${selectedCents} in account ${accountId}`);
  }

  const recRef = db.collection('reconciliations').doc(reconciliationId);
  t.create(recRef, {
    id: reconciliationId,
    workspaceId,
    uid: actor.uid,
    accountId,
    statementDate,
    statementBalanceCents,
    reconciledTransactionIds: uniqueTxIds,
    status: 'completed',
    completedAt,
    completedBy: actor.uid,
    createdAt: completedAt,
    updatedAt: completedAt,
  });

  for (const snap of txSnaps) {
    ledgerMark(t, snap.ref as never, {
      status: 'reconciled',
      reconciled: true,
      isReconciled: true,
      isCleared: true,
      clearedAt: completedAt,
      reconciledAt: completedAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return { reconciliationId, completedAt, reconciledCount: uniqueTxIds.length };
}


// Re-exported for callers that import from reconciliationWriteService
export { reconcileAudit, clearEntriesAudit, updateBankLineAudit, completeReconciliationAudit, CLEAR_MAX_ENTRIES, ClearEntriesError, UpdateBankLineError, CompleteReconciliationError } from './reconciliationAudit';
export type { ClearEntriesInput, ClearEntriesPrepared, UpdateBankLinePrepared, CompleteReconciliationInput, CompleteReconciliationPrepared } from './reconciliationAudit';

// Import for use within this file
import { ClearEntriesError, UpdateBankLineError, CompleteReconciliationError, CLEAR_MAX_ENTRIES } from './reconciliationAudit';
import type { ClearEntriesInput, ClearEntriesPrepared, UpdateBankLinePrepared, CompleteReconciliationInput, CompleteReconciliationPrepared } from './reconciliationAudit';
