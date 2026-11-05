import { isDeepStrictEqual } from 'node:util';
import { ApprovalRefused, serverApproval } from './invoiceApprovalGuard';
import { approvalEvent, notifyApproval, type ApprovalEvent } from './approvalNotifications';
import type { InvoiceApprovalRecord } from '../../lib/invoiceApproval';
import { FieldValue, type Firestore } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { InvoiceSchema, BillSchema, OrderSchema, ProjectSchema, BankLineImportSchema, CreditNoteSchema, VendorCreditSchema } from '../../schemas';
import type { Transaction } from '../../types';
import { LedgerPostingError, prepareStockMoves } from './cogsStockService';
import { z } from 'zod';
import { assertPostingOpen } from '../../lib/periodLock';
import { isPostable } from '../../lib/txFilters';
import { errorMessage, type RequestUser } from '../auth/requestUser';
import { assertSameRequest, requestPayloadHash } from '../utils/idempotency';
import { LEDGER_WRITER_ROLES, roleInWorkspace } from '../middleware/requireLedgerWriter';
import { writeServerAuditLog, type AuditLogEntryInput } from './auditLogService';
import { deletionSentence, deletionSnapshot } from './deletionRecord';
import { refusedLabels, refusedLabelsMessage } from '../../lib/requiredLabels';
import { DELIVERY_COGS_TYPE, DELIVERY_RETURN_TYPE } from '../../lib/deliveries';
import { BudgetBlocked, budgetWarningsFor, enforceBudgetControl, type BudgetWarning } from './budgetGuard';
import { existingImportIdentities, prepareBankRuleSuggestions } from './bankRuleService';

/**
 * The commit of POST /transactions/bulk, moved here unchanged (L94-STEP2) so that POST /documents/:type/:id/post, which
 * builds an invoice's or bill's entries on the server, saves them through exactly the same checks: membership and
 * role at commit, the closed period, the idempotency key, one live posting per document (INT-2), the order limit,
 * stock moves, the document's schema and approval, all in ONE database transaction.
 * A refusal is a BulkRefusal (status and the JSON body the route answers with) or a LedgerPostingError.
 */
export class BulkRefusal extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(String(body.error || 'Refused'));
    this.name = 'BulkRefusal';
  }
}

export interface BulkRequest {
  transactions?: Transaction[];
  workspaceId?: string;
  entityMutation?: { collection: string; docId: string; action: 'create' | 'update' | 'delete'; data?: Record<string, unknown> };
  bankLines?: unknown;
}

export interface BulkResult {
  /** the JSON answer */
  body: Record<string, unknown>;
  /** the entries as checked and written (empty when nothing was committed) */
  transactions: Transaction[];
  /** false when the request was answered before the database transaction (nothing to post, or an idempotent replay) */
  committed: boolean;
}

/** EG-5: a check made inside the commit's transaction (reads only); may add invoice metadata, answer fields and an audit entry written with the save */
export type BeforeWrite = (t: Parameters<Parameters<Firestore['runTransaction']>[0]>[0], state: { existingEntity?: Record<string, unknown>; workspace?: Record<string, unknown> }) =>
  Promise<{ metadata?: Record<string, unknown>; body?: Record<string, unknown>; audit?: AuditLogEntryInput }>;

export async function commitLedgerBulk(db: Firestore, user: RequestUser, request: BulkRequest, options: { idempotencyKey?: string; hashOf?: unknown; beforeWrite?: BeforeWrite } = {}): Promise<BulkResult> {
  const { workspaceId } = request;
  let transactions = request.transactions;
  // may be absent: every use below checks it first (the request body was untyped before the move)
  const entityMutation = request.entityMutation as NonNullable<BulkRequest['entityMutation']>;
  // Imported bank statement lines (the browser may not write bankLines itself)
  let bankLines = BankLineImportSchema.array().max(5000).parse(request.bankLines ?? []);
        const wsId = workspaceId || transactions?.[0]?.workspaceId;
  if (!wsId) throw new BulkRefusal(400, { error: 'Missing workspaceId' });

  if (user.developerWorkspaceId && user.developerWorkspaceId !== wsId) {
    throw new BulkRefusal(403, { error: `Forbidden: API key is scoped strictly to workspace ${user.developerWorkspaceId}` });
  }

  const wsDoc = await db.collection('workspaces').doc(wsId).get();
  if (!wsDoc.exists || (wsDoc.data()?.uid !== user.uid && !wsDoc.data()?.members?.includes(user.uid) && !user.admin)) {
    throw new BulkRefusal(403, { error: 'Not a member' });
  }

  const wsData = wsDoc.data();

  const idempotencyKey = options.idempotencyKey;
  const scopedIdempotencyKey = idempotencyKey ? `${wsId}_${idempotencyKey}` : null;
  const payloadHash = scopedIdempotencyKey ? requestPayloadHash(options.hashOf ?? request) : undefined;

  // EG-9: one bank line per statement fingerprint. A line already imported (or twice in this request) is
  // skipped, with the entry made for it in this request; the check is made again inside the transaction.
  let skippedDuplicates = 0;
  if (bankLines.some(b => b.importIdentity)) {
    const seen = await existingImportIdentities(db, null, wsId, bankLines);
    const keep: typeof bankLines = [];
    const dropTx = new Set<string>();
    for (const b of bankLines) {
      if (b.importIdentity && seen.has(b.importIdentity)) {
        skippedDuplicates += 1;
        if (b.matchedTransactionId) dropTx.add(b.matchedTransactionId);
        continue;
      }
      if (b.importIdentity) seen.add(b.importIdentity);
      keep.push(b);
    }
    bankLines = keep;
    if (dropTx.size) transactions = (transactions || []).filter(tx => !dropTx.has(tx.id));
    if (skippedDuplicates > 0 && (!transactions || transactions.length === 0) && !entityMutation && bankLines.length === 0) {
      return { body: { status: 'ok', count: 0, skippedDuplicates }, transactions: [], committed: false };
    }
  }

  if ((!Array.isArray(transactions) || transactions.length === 0) && !entityMutation && bankLines.length === 0) {
    return { body: { status: 'ok', count: 0 }, transactions: [], committed: false };
  }

  if (scopedIdempotencyKey) {
    const idempotencyDoc = await db.collection('idempotencyKeys').doc(scopedIdempotencyKey).get();
    if (idempotencyDoc.exists) {
      try { assertSameRequest(idempotencyDoc.data(), user.uid, payloadHash); } catch (err) { throw new BulkRefusal(409, { error: errorMessage(err) }); }
      const cachedResult = idempotencyDoc.data()?.body || { status: 'ok', count: Array.isArray(transactions) ? transactions.length : 0 };
      return { body: cachedResult, transactions: [], committed: false };
    }
  }

  // Allowlist entityMutation collections to close arbitrary Admin-SDK mutation primitive
  const ALLOWED_ENTITY_COLLECTIONS = ['invoices', 'bills', 'orders', 'projects', 'creditNotes', 'vendorCredits'];
  if (entityMutation) {
    if (!ALLOWED_ENTITY_COLLECTIONS.includes(entityMutation.collection)) {
      throw new BulkRefusal(400, { error: `Forbidden: entityMutation collection '${entityMutation.collection}' is not permitted.` });
    }
    if (!entityMutation.docId || typeof entityMutation.docId !== 'string') {
      throw new BulkRefusal(400, { error: 'Invalid entityMutation: docId must be a string.' });
    }
  }

  // Period lock, duplicate ID check, and account verification (TransactionValidator) for transactions
  const seenTxIds = new Set<string>();

  const validatedTransactions: Transaction[] = [];
  for (const tx of (transactions || [])) {
    if (tx.id) {
      if (seenTxIds.has(tx.id)) {
        throw new BulkRefusal(400, { error: `Duplicate transaction ID '${tx.id}' in bulk request payload.` });
      }
      seenTxIds.add(tx.id);
    }
    tx.uid = user.uid;
    tx.workspaceId = wsId;
  
    const validatedTx = await TransactionValidator.validateAndPrepare(tx, {
      workspaceId: wsId,
      user: { uid: user.uid, admin: user.admin },
      wsData
    });
    validatedTransactions.push(validatedTx);
  }

  // BF-08 step 2: a delivery's cost entries are made by the delivery (Deliver on the order), never posted directly
  const delivery = validatedTransactions.find(tx => tx.metadata?.type === DELIVERY_COGS_TYPE || tx.metadata?.type === DELIVERY_RETURN_TYPE);
  if (delivery) throw new BulkRefusal(400, { error: 'Deliver goods from the order (Deliver), not as an entry', transactionId: delivery.id });

  // Z-12: a required label whose rule refuses stops an entry a person typed without it. Entries
  // made with bank lines imported in this request are saved and listed instead: an import never stops.
  const imported = new Set(bankLines.map(b => b.matchedTransactionId).filter(Boolean));
  for (const tx of validatedTransactions) {
    const missing = imported.has(tx.id) ? [] : refusedLabels(tx, wsData?.dimensions);
    if (missing.length > 0) throw new BulkRefusal(400, { error: refusedLabelsMessage(missing), transactionId: tx.id, missingLabels: missing });
  }

  // ONE database transaction: the document change, the ledger entries, stock moved by cost of
  // goods sold entries, and the idempotency record all commit together or not at all.
  let body: Record<string, unknown> = { status: 'ok', count: validatedTransactions.length, ...(skippedDuplicates ? { skippedDuplicates } : {}) };
  // S-09: an approval asked for or decided with this save, told after it commits
  let approvalNotice: { invoiceId: string; invoice: Record<string, unknown>; event: ApprovalEvent } | null = null;
  // EG-4: the budget figures are read before the transaction (through the pool; never while it holds a connection)
  const plannedBudgetWarnings = await budgetWarningsFor(db, wsId, wsData, validatedTransactions);
  await db.runTransaction(async (t) => {
    approvalNotice = null;
    // Reads first
    // AUD-07: a replay is recognised first, before any other read or check, and only for the same
    // user and the same request
    const idempotencyRef = scopedIdempotencyKey ? db.collection('idempotencyKeys').doc(scopedIdempotencyKey) : null;
    if (idempotencyRef) {
      const replay = await t.get(idempotencyRef);
      if (replay.exists) {
        try { assertSameRequest(replay.data(), user.uid, payloadHash); } catch (err) { throw new LedgerPostingError(409, errorMessage(err)); }
        body = replay.data()?.body || body; return;
      }
    }
    // AUD-08: the closing date as it is at commit — a month closed after the checks above but
    // before this save refuses the save instead of posting into the closed month
    const wsNow = (await t.get(db.collection('workspaces').doc(wsId))).data();
    // authority at commit: the role and membership as they are now, read in this transaction, so a
    // role taken away after the first check (middleware) cannot still let this save through
    if (!user.admin) {
      const isMember = wsNow?.uid === user.uid || (Array.isArray(wsNow?.members) && wsNow.members.includes(user.uid));
      if (!wsNow || !isMember || !LEDGER_WRITER_ROLES.includes(roleInWorkspace(wsNow, user.uid))) {
        throw new LedgerPostingError(403, 'You no longer have permission to change these books');
      }
    }
    for (const tx of validatedTransactions) {
      const date = (tx as { date?: string }).date;
      if (date) {
        try { assertPostingOpen(date, wsNow as never, user.uid); } catch (err) { throw new LedgerPostingError(409, errorMessage(err)); }
      }
    }
    const entityRef = entityMutation ? db.collection(entityMutation.collection).doc(entityMutation.docId) : null;
    let existingEntity: Record<string, unknown> | undefined;
    if (entityRef) {
      const existingDoc = await t.get(entityRef);
      existingEntity = existingDoc.exists ? existingDoc.data() : undefined;
      if (existingDoc.exists && existingDoc.data()?.workspaceId !== wsId) {
        throw new LedgerPostingError(403, `Forbidden: Entity ${entityMutation.docId} does not belong to authorized workspace.`);
      }
    }
    // EG-5: the credit limit (documentPostService), with what this transaction reads; fresh on each attempt
    const extra = options.beforeWrite ? await options.beforeWrite(t, { existingEntity, workspace: wsNow }) : {};
    // DEP-1: an invoice made from an estimate/order never takes the order past its total — the
    // invoices already made from it are read here, inside the save, so two people invoicing the
    // same order at once cannot both get through (a deposit is a payment, not an invoice)
    if (entityRef && entityMutation.collection === 'invoices' && (entityMutation.action === 'create' || entityMutation.action === 'update')) {
      const data = (entityMutation.data || {}) as { amountCents?: unknown; status?: unknown; metadata?: { convertedFromEstimateId?: unknown } };
      const estimateId = data.metadata?.convertedFromEstimateId ?? (existingEntity?.metadata as { convertedFromEstimateId?: unknown } | undefined)?.convertedFromEstimateId;
      const status = String(data.status ?? existingEntity?.status ?? '');
      if (typeof estimateId === 'string' && estimateId && status !== 'void' && status !== 'cancelled') {
        const est = await t.get(db.collection('estimates').doc(estimateId));
        if (est.exists && est.data()?.workspaceId === wsId) {
          const totalCents = Math.round(Number(est.data()?.amountCents) || 0);
          const made = await t.get(db.collection('invoices').where('workspaceId', '==', wsId).where('metadata.convertedFromEstimateId', '==', estimateId));
          const others = made.docs.filter(d => d.id !== entityMutation.docId && !['void', 'cancelled'].includes(String(d.data()?.status)))
            .reduce((sum, d) => sum + Math.round(Number(d.data()?.amountCents) || 0), 0);
          const thisCents = Math.round(Number(data.amountCents ?? existingEntity?.amountCents) || 0);
          if (totalCents > 0 && others + thisCents > totalCents) {
            throw new LedgerPostingError(409, `That is more than is left to invoice on this order (${(Math.max(0, totalCents - others) / 100).toFixed(2)} left)`);
          }
        }
      }
    }
    // INT-2 (BUG-03): one live posting per invoice, decided here on the server. The client builds the
    // reversal of the previous posting from what it has loaded; if that was out of date (another tab,
    // a retry after a lost answer) the invoice's live posting is still there and not reversed by this
    // request. Then: the very same posting again → this save already happened, answer as before and
    // write nothing; a different posting → refused, so the invoice is never counted twice.
    // the same for bills (INT-2 for bills): one live 'bill-accrual' per bill; and for the payment posted with
    // the document (INT-2 for payments): one live 'invoice-payment' / 'bill-payment' per document. Only when
    // every such entry of the request is already live and identical is it a replay; a stale save that adds or
    // changes one of them (e.g. marks the invoice paid from an old tab) is refused, never half-applied.
    const ACCRUAL_KINDS = [
      { type: 'invoice-accrual', key: 'invoiceId' }, { type: 'bill-accrual', key: 'billId' },
      { type: 'invoice-payment', key: 'invoiceId' }, { type: 'bill-payment', key: 'billId' },
      // audit F2 (5 Nov): one live issuance per customer or vendor credit too, so two saves built from the same old
      // state cannot both count the credit
      { type: 'credit-note-issuance', key: 'creditNoteId' }, { type: 'vendor-credit-issuance', key: 'vendorCreditId' },
    ] as const;
    const DOCUMENT_WORD: Record<string, string> = { invoiceId: 'invoice', billId: 'bill', creditNoteId: 'credit note', vendorCreditId: 'vendor credit' };
    const accruals = validatedTransactions.flatMap(tx => ACCRUAL_KINDS
      .filter(k => tx.metadata?.type === k.type && typeof (tx.metadata as Record<string, unknown> | undefined)?.[k.key] === 'string')
      .map(k => ({ tx, kind: k })));
    const same = (a: Transaction, b: Transaction) => a.date === b.date && Number(a.totalAmountCents) === Number(b.totalAmountCents)
      && JSON.stringify((a.lines || []).map(l => [l.accountId, l.amountCents])) === JSON.stringify((b.lines || []).map(l => [l.accountId, l.amountCents]));
    const replayedIds: string[] = [];
    let stale = '';
    for (const { tx: incoming, kind } of accruals) {
      const documentId = String((incoming.metadata as Record<string, unknown>)[kind.key]);
      const posted = await t.get(db.collection('transactions').where('workspaceId', '==', wsId).where(`metadata.${kind.key}`, '==', documentId));
      const docs = posted.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) as Array<Transaction & { id: string }>;
      const reversed = new Set([...docs, ...validatedTransactions]
        .filter(x => x.metadata?.isReversal).map(x => String(x.metadata?.reversesTxId || x.metadata?.reversedTransactionId || '')));
      const live = docs.filter(x => x.metadata?.type === kind.type && !x.metadata?.isReversal && isPostable(x) && !reversed.has(x.id));
      if (live.length === 1 && same(live[0], incoming)) replayedIds.push(live[0].id);
      else if (live.length > 0) stale = DOCUMENT_WORD[kind.key];
    }
    const creditSchema = entityMutation?.collection === 'creditNotes' ? CreditNoteSchema
      : entityMutation?.collection === 'vendorCredits' ? VendorCreditSchema : undefined;
    if (creditSchema && entityMutation.action !== 'delete') {
      const sent = { ...(entityMutation.data || {}), workspaceId: wsId };
      const parsed = (entityMutation.action === 'update' ? creditSchema.partial() : creditSchema).parse(sent);
      const fields = entityMutation.action === 'update'
        ? Object.entries(parsed).filter(([key]) => key in sent) : Object.entries(parsed);
      // Identical ledger lines alone do not make a changed document an identical retry.
      if (replayedIds.length > 0 && fields.some(([key, value]) => !isDeepStrictEqual(existingEntity?.[key], value))) {
        stale = 'credit';
      }
      const status = parsed.status ?? existingEntity?.status;
      if (status === 'draft' || status === 'void') {
        const key = entityMutation.collection === 'creditNotes' ? 'creditNoteId' : 'vendorCreditId';
        const posted = await t.get(db.collection('transactions').where('workspaceId', '==', wsId).where(`metadata.${key}`, '==', entityMutation.docId));
        const docs = posted.docs.map(d => ({ id: d.id, ...d.data() }) as Transaction);
        const reversed = new Set([...docs, ...validatedTransactions].filter(isPostable)
          .filter(tx => tx.metadata?.isReversal)
          .map(tx => tx.metadata?.reversesTxId || tx.metadata?.reversedTransactionId));
        if (docs.some(tx => isPostable(tx) && !tx.metadata?.isReversal && !reversed.has(tx.id))) stale = 'credit';
      }
    }
    // some entries already live and the rest new: an old tab adding to a posted document
    if (!stale && replayedIds.length > 0 && replayedIds.length < accruals.length) stale = DOCUMENT_WORD[accruals[0].kind.key];
    // audit F2: a reversal of a posting that is already reversed (two stale voids, or two saves back to draft) would
    // take the document off the books twice; read here, inside the save
    if (!stale) {
      const targets = new Set<string>();
      for (const incoming of validatedTransactions) {
        const target = incoming.metadata?.isReversal ? String(incoming.metadata?.reversesTxId || incoming.metadata?.reversedTransactionId || '') : '';
        if (!target) continue;
        if (targets.has(target)) { stale = 'record'; break; }
        targets.add(target);
        for (const field of ['reversesTxId', 'reversedTransactionId']) {
          const earlier = await t.get(db.collection('transactions').where('workspaceId', '==', wsId).where(`metadata.${field}`, '==', target));
          if (earlier.docs.some(d => isPostable({ id: d.id, ...d.data() } as Transaction))) { stale = 'record'; break; }
        }
        if (stale) break;
      }
    }
    if (stale) throw new LedgerPostingError(409, `This ${stale} was changed or posted elsewhere (another tab or an earlier save). Reload it and save again.`);
    if (replayedIds.length > 0) {
      body = { status: 'ok', count: 0, replayed: true, transactionIds: replayedIds };
      return;
    }
    // EG-4: the budget control as the workspace has it now, after a replay is recognised (a replay adds nothing)
    let budgetWarnings: BudgetWarning[];
    try { budgetWarnings = enforceBudgetControl(wsNow, plannedBudgetWarnings); } catch (err) {
      if (err instanceof BudgetBlocked) throw new BulkRefusal(409, { error: err.message, code: 'OVER_BUDGET', budgetWarnings: err.warnings });
      throw err;
    }
    const refs = validatedTransactions.map(tx => db.collection('transactions').doc(tx.id));
    if (refs.length > 0) {
      const snaps = await t.getAll(...refs);
      const taken = snaps.find((s) => s.exists);
      if (taken) throw new LedgerPostingError(409, `Transaction ${taken.id} already exists`);
    }
    const stock = await prepareStockMoves(db, t, wsId, validatedTransactions);
    const bankLineRefs = bankLines.map(b => db.collection('bankLines').doc(b.id));
    if (bankLineRefs.length > 0) {
      const takenLine = (await t.getAll(...bankLineRefs)).find((snap: { exists: boolean }) => snap.exists);
      if (takenLine) throw new LedgerPostingError(409, `Bank line ${takenLine.id} already exists`);
      const postedIds = new Set(validatedTransactions.map(tx => tx.id));
      const unknown = bankLines.find(b => b.matchedTransactionId && !postedIds.has(b.matchedTransactionId));
      if (unknown) throw new LedgerPostingError(400, `Bank line ${unknown.id} points to a transaction outside this request`);
    }
    if ((await existingImportIdentities(db, t, wsId, bankLines)).size > 0) {
      throw new LedgerPostingError(409, 'Some of these statement lines were imported meanwhile. Import the file again; lines already there are skipped.');
    }
    // EG-9: the bank rules suggest an account, a contact and labels for each new pending line (never posted)
    const ruleSuggestions = await prepareBankRuleSuggestions(db, t, wsId, bankLines);

    // Writes
    if (entityRef && (entityMutation.action === 'create' || entityMutation.action === 'update')) {
      const schemaMap: Record<string, z.ZodObject<z.ZodRawShape>> = { invoices: InvoiceSchema, bills: BillSchema, orders: OrderSchema, projects: ProjectSchema, creditNotes: CreditNoteSchema, vendorCredits: VendorCreditSchema };
      const schema = schemaMap[entityMutation.collection];
      if (!schema) throw new Error(`Forbidden: No schema for entityMutation collection '${entityMutation.collection}'.`);
      // An update sends only the changed fields: check those, and never fill in defaults for the rest
      const sent = { ...(entityMutation.data || {}), workspaceId: wsId };
      const parsed = (entityMutation.action === 'update' ? schema.partial() : schema).parse(sent);
      const validatedData = entityMutation.action === 'update' ? Object.fromEntries(Object.entries(parsed).filter(([k]) => k in sent)) : parsed;
      // who approved an invoice is decided here, not by the request (BE-04, L-191)
      if (entityMutation.collection === 'invoices') {
        try {
          Object.assign(validatedData, serverApproval(existingEntity, validatedData, wsData || {}, user.uid, new Date().toISOString()));
          const event = approvalEvent(existingEntity?.approval as InvoiceApprovalRecord | undefined, validatedData.approval as InvoiceApprovalRecord | undefined);
          if (event && entityRef) approvalNotice = { invoiceId: entityRef.id, invoice: { ...(existingEntity || {}), ...validatedData }, event };
        } catch (err) {
          if (err instanceof ApprovalRefused) throw new LedgerPostingError(403, err.message);
          throw err;
        }
      }
      if (extra.metadata) validatedData.metadata = { ...((existingEntity?.metadata as object) || {}), ...((validatedData.metadata as object) || {}), ...extra.metadata };
      t.set(entityRef, { ...validatedData, uid: user.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    } else if (entityRef && entityMutation.action === 'delete') {
      t.delete(entityRef);
      // what was deleted, kept in the audit trail with the deletion itself (CA-10)
      if (existingEntity) {
        await writeServerAuditLog({
          workspaceId: wsId, uid: user.uid, email: user.email, action: 'DOCUMENT_DELETED',
          entityType: entityMutation.collection, entityId: entityRef.id,
          details: { description: deletionSentence(entityMutation.collection, entityRef.id, existingEntity), deleted: deletionSnapshot(existingEntity) },
        }, { db, tx: t });
      }
    }
    validatedTransactions.forEach((tx, j) => t.create(refs[j], { ...tx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
    stock.apply();
    bankLines.forEach((b, j) => t.create(bankLineRefs[j], { ...b, ...ruleSuggestions.fieldsFor(b), matchedTransactionId: b.matchedTransactionId ?? null, workspaceId: wsId, uid: user.uid, createdAt: new Date().toISOString() }));
    ruleSuggestions.apply();
    if (stock.warnings.length > 0) body = { ...body, warnings: stock.warnings };
    if (extra.body) body = { ...body, ...extra.body };
    if (budgetWarnings.length > 0) body = { ...body, budgetWarnings };
    if (extra.audit) await writeServerAuditLog(extra.audit, { db, tx: t });
    if (idempotencyRef) t.set(idempotencyRef, { createdAt: FieldValue.serverTimestamp(), code: 200, body, workspaceId: wsId, actor: user.uid, payloadHash });
  });

  const notice = approvalNotice as { invoiceId: string; invoice: Record<string, unknown>; event: ApprovalEvent } | null;
  if (notice) await notifyApproval(db, { workspaceId: wsId, ...notice, actorUid: user.uid });
  return { body, transactions: validatedTransactions, committed: true };
}
