import { z } from 'zod';
import { BillSchema, CreditNoteSchema, InvoiceSchema, VendorCreditSchema } from '../../schemas';
import { isIsoDate } from '../../lib/warehouseRecordUtils';
import { agreedPostingDay, todayIn } from '../services/postingContextLoader';
import {
  commitPreparedDocumentPost,
  prepareDocumentPost,
  type DocumentPostInput,
  type PostedDocumentType,
  type PreparedDocumentPost,
} from '../services/documentPostService';
import type { Transaction } from '../db/firestore';
import type { CommandContext, CommandDefinition, CommandPreview } from './types';
import type { Transaction as LedgerTransaction } from '../../types';

const optionalDocumentId = z.string().min(1).max(200).refine(id => !id.includes('/'), 'Document id cannot contain a slash').optional();
const requiredDocumentId = z.string().min(1).max(200).refine(id => !id.includes('/'), 'Document id cannot contain a slash');
const workspaceIdInput = z.string().min(1).max(200).optional();
const postingDayInput = z.string().refine(isIsoDate, 'postingDay must be a real date (YYYY-MM-DD)').optional();
const creditLimitOverrideInput = z.object({ reason: z.string().trim().min(1).max(500) }).strict().optional();
const createDate = z.string().refine(isIsoDate, 'date must be a real date (YYYY-MM-DD)').optional();
const requiredCreateDate = z.string().refine(isIsoDate, 'date must be a real date (YYYY-MM-DD)');

const InvoiceCreateDocumentSchema = InvoiceSchema.extend({
  id: optionalDocumentId,
  workspaceId: workspaceIdInput,
  date: createDate,
});
const BillCreateDocumentSchema = BillSchema.extend({
  id: optionalDocumentId,
  workspaceId: workspaceIdInput,
  date: createDate,
});
const CreditNoteCreateDocumentSchema = CreditNoteSchema.extend({
  id: optionalDocumentId,
  workspaceId: workspaceIdInput,
  date: requiredCreateDate,
});
const VendorCreditCreateDocumentSchema = VendorCreditSchema.extend({
  id: optionalDocumentId,
  workspaceId: workspaceIdInput,
  date: requiredCreateDate,
});

export const invoiceCreateInput = z.object({
  invoice: InvoiceCreateDocumentSchema,
  postingDay: postingDayInput,
  creditLimitOverride: creditLimitOverrideInput,
}).strict();

export const billCreateInput = z.object({
  bill: BillCreateDocumentSchema,
  postingDay: postingDayInput,
}).strict();

export const creditNoteCreateInput = z.object({
  creditNote: CreditNoteCreateDocumentSchema,
  postingDay: postingDayInput,
}).strict();

export const vendorCreditCreateInput = z.object({
  vendorCredit: VendorCreditCreateDocumentSchema,
  postingDay: postingDayInput,
}).strict();

const invoiceUpdateData = InvoiceSchema.omit({ id: true, uid: true, workspaceId: true }).partial();
const billUpdateData = BillSchema.omit({ id: true, uid: true, workspaceId: true }).partial();
const creditNoteUpdateData = CreditNoteSchema.omit({ id: true, uid: true, workspaceId: true }).partial();
const vendorCreditUpdateData = VendorCreditSchema.omit({ id: true, uid: true, workspaceId: true }).partial();

export const invoiceUpdateInput = z.object({
  id: requiredDocumentId,
  data: invoiceUpdateData,
  postingDay: postingDayInput,
  creditLimitOverride: creditLimitOverrideInput,
}).strict();

export const billUpdateInput = z.object({ id: requiredDocumentId, data: billUpdateData, postingDay: postingDayInput }).strict();
export const creditNoteUpdateInput = z.object({ id: requiredDocumentId, data: creditNoteUpdateData, postingDay: postingDayInput }).strict();
export const vendorCreditUpdateInput = z.object({ id: requiredDocumentId, data: vendorCreditUpdateData, postingDay: postingDayInput }).strict();

export const invoiceDeleteInput = z.object({ id: requiredDocumentId, postingDay: postingDayInput }).strict();
export const billDeleteInput = z.object({ id: requiredDocumentId, postingDay: postingDayInput }).strict();
export const creditNoteDeleteInput = z.object({ id: requiredDocumentId, postingDay: postingDayInput }).strict();
export const vendorCreditDeleteInput = z.object({ id: requiredDocumentId, postingDay: postingDayInput }).strict();

type DocumentAction = DocumentPostInput['action'];

type PreparedDocumentCommand = {
  collection: PostedDocumentType;
  action: DocumentAction;
  documentId: string;
  document: Record<string, unknown>;
  plan: PreparedDocumentPost;
};

type DocumentCommandResult = {
  collection: PostedDocumentType;
  action: DocumentAction;
  documentId: string;
  documentNumber: string;
  body: Record<string, unknown>;
  transactions: LedgerTransaction[];
  cogsPendingReason?: string;
};

type PrepareContext = Omit<CommandContext, 'prepared' | 'afterCommit'>;
type ReadContext = Omit<CommandContext, 'prepared' | 'afterCommit'>;

const NAME: Record<PostedDocumentType, string> = {
  invoices: 'invoice',
  bills: 'bill',
  creditNotes: 'credit note',
  vendorCredits: 'vendor credit',
};
const AUDIT_NAME: Record<PostedDocumentType, string> = {
  invoices: 'INVOICE',
  bills: 'BILL',
  creditNotes: 'CREDIT_NOTE',
  vendorCredits: 'VENDOR_CREDIT',
};
const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;

function assertWorkspaceId(value: string | undefined, workspaceId: string): void {
  if (value && value !== workspaceId) {
    throw Object.assign(new Error('Input workspaceId must match the command workspace'), { status: 400, code: 'WORKSPACE_MISMATCH' });
  }
}

function postingDate(document: Record<string, unknown>, postingDay: string | undefined, workspace: Record<string, unknown>): string {
  if (typeof document.date === 'string' && document.date) return document.date;
  const zone = typeof workspace.timezone === 'string' ? workspace.timezone : undefined;
  return agreedPostingDay(todayIn(zone), postingDay);
}

function recordAt(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = input[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Missing ${key} document`);
  return value as Record<string, unknown>;
}

function preparePost(
  ctx: PrepareContext,
  collection: PostedDocumentType,
  documentId: string,
  action: DocumentAction,
  data: Record<string, unknown>,
  postingDay?: string,
  creditLimitOverride?: { reason: string },
): Promise<PreparedDocumentCommand> {
  assertWorkspaceId(typeof data.workspaceId === 'string' ? data.workspaceId : undefined, ctx.workspaceId);
  const post: DocumentPostInput = {
    collection,
    docId: documentId,
    workspaceId: ctx.workspaceId,
    action,
    data,
    ...(postingDay ? { postingDay } : {}),
    ...(creditLimitOverride ? { creditLimitOverride } : {}),
  };
  return prepareDocumentPost(ctx.db, ctx.user, post).then(plan => ({
    collection,
    action,
    documentId,
    document: plan.document,
    plan,
  }));
}

function prepareCreate(
  ctx: PrepareContext,
  collection: PostedDocumentType,
  data: Record<string, unknown>,
  postingDay?: string,
  creditLimitOverride?: { reason: string },
): Promise<PreparedDocumentCommand> {
  assertWorkspaceId(typeof data.workspaceId === 'string' ? data.workspaceId : undefined, ctx.workspaceId);
  const id = typeof data.id === 'string' && data.id ? data.id : ctx.db.collection(collection).doc().id;
  const document = { ...data, id, workspaceId: ctx.workspaceId };
  return preparePost(ctx, collection, id, 'create', document, postingDay, creditLimitOverride);
}

function prepareUpdate(
  ctx: PrepareContext,
  collection: PostedDocumentType,
  id: string,
  data: Record<string, unknown>,
  postingDay?: string,
  creditLimitOverride?: { reason: string },
): Promise<PreparedDocumentCommand> {
  return preparePost(ctx, collection, id, 'update', data, postingDay, creditLimitOverride);
}

function prepareDelete(ctx: PrepareContext, collection: PostedDocumentType, id: string, postingDay?: string): Promise<PreparedDocumentCommand> {
  return preparePost(ctx, collection, id, 'delete', {}, postingDay);
}

function previewLines(prepared: PreparedDocumentCommand): string[] {
  const entry = prepared.plan.transactions[0];
  return [
    String(prepared.document.date || entry?.date || ''),
    `${String(prepared.document.status || 'document')} — ${String(prepared.document.amountCents ?? 0)} cents`,
    `${prepared.plan.transactions.length} ledger posting${prepared.plan.transactions.length === 1 ? '' : 's'} prepared`,
    `${NAME[prepared.collection]} ${String(prepared.document.number || prepared.documentId)}`,
  ];
}

async function previewPrepared(ctx: ReadContext, prepared: PreparedDocumentCommand): Promise<CommandPreview> {
  const byId = new Map<string, string>();
  const accounts = (await ctx.db.collection('chartAccounts').where('workspaceId', '==', ctx.workspaceId).get()).docs;
  for (const doc of accounts) {
    const account = doc.data();
    if (typeof account?.name === 'string') byId.set(doc.id, account.name);
  }
  const verb = prepared.action[0].toUpperCase() + prepared.action.slice(1);
  return {
    title: `${verb} ${NAME[prepared.collection]} ${String(prepared.document.number || prepared.documentId)}`,
    lines: previewLines(prepared),
    accounts: prepared.plan.transactions.flatMap(transaction => transaction.lines || []).map(line => ({
      accountId: line.accountId,
      ...(byId.has(line.accountId) ? { accountName: byId.get(line.accountId) } : {}),
      amountCents: line.amountCents,
      ...(line.description ? { description: line.description } : {}),
    })),
  };
}

async function commitPrepared(ctx: CommandContext, transaction: Transaction): Promise<DocumentCommandResult> {
  const prepared = ctx.prepared as PreparedDocumentCommand;
  const result = await commitPreparedDocumentPost(ctx.db, ctx.user, prepared.plan, { transaction, afterCommit: ctx.afterCommit });
  return {
    collection: prepared.collection,
    action: prepared.action,
    documentId: prepared.documentId,
    documentNumber: String(prepared.document.number || prepared.documentId),
    body: result.body,
    transactions: result.transactions,
    ...(result.cogsPendingReason ? { cogsPendingReason: result.cogsPendingReason } : {}),
  };
}

function auditFor(result: DocumentCommandResult) {
  const verb = result.action.toUpperCase();
  return {
    action: `${AUDIT_NAME[result.collection]}_${verb === 'CREATE' ? 'CREATED' : verb === 'UPDATE' ? 'UPDATED' : 'DELETED'}`,
    entityType: result.collection,
    entityId: result.documentId,
    description: `${verb[0]}${verb.slice(1).toLowerCase()} ${NAME[result.collection]} ${result.documentNumber}`,
    details: {
      ...(typeof result.body.count === 'number' ? { postingCount: result.body.count } : {}),
      transactionIds: result.transactions.map(transaction => transaction.id),
      ...(result.cogsPendingReason ? { cogsPendingReason: result.cogsPendingReason } : {}),
    },
  };
}

function commandDescription(collection: PostedDocumentType, action: DocumentAction) {
  const name = NAME[collection];
  const sentence = action === 'create'
    ? `Create a ${name} and let the server build its ledger entries from the saved document; do not use this command to record a payment or edit an existing ${name}.`
    : action === 'update'
      ? `Update an existing ${name} and let the server rebuild or preserve its ledger entries; do not use this command to apply or refund a credit.`
      : `Delete a ${name} and let the server reverse its live ledger entries; do not use this command to void or write off a document.`;
  const field = collection === 'invoices' ? 'invoice'
    : collection === 'bills' ? 'bill'
      : collection === 'creditNotes' ? 'creditNote' : 'vendorCredit';
  const example = action === 'create'
    ? { [field]: collection === 'invoices'
      ? { customerId: 'customer_123', customerName: 'Acme', number: 'INV-1001', date: '2026-11-15', dueDate: '2026-12-15', status: 'sent', amountCents: 11000, taxAmountCents: 1000, currency: 'USD', items: [{ description: 'Consulting', quantity: 1, rateCents: 10000, amountCents: 10000 }] }
      : collection === 'bills'
        ? { vendorId: 'vendor_123', vendorName: 'Paper Co', number: 'BILL-1001', date: '2026-11-15', dueDate: '2026-12-15', status: 'pending', amountCents: 11800, taxAmountCents: 1800, currency: 'USD', splits: [{ description: 'Paper', amountCents: 10000, accountId: 'account_supplies' }] }
        : collection === 'creditNotes'
          ? { customerId: 'customer_123', customerName: 'Acme', number: 'CN-1001', invoiceId: 'invoice_123', date: '2026-11-15', status: 'open', amountCents: 11000, remainingCents: 11000, currency: 'USD' }
          : { vendorId: 'vendor_123', vendorName: 'Paper Co', number: 'VC-1001', billId: 'bill_123', date: '2026-11-15', status: 'open', amountCents: 11800, remainingCents: 11800, currency: 'USD' } }
    : { id: 'document_123', ...(action === 'update' ? { data: { status: 'draft' } } : {}) };
  return {
    sentence,
    example,
    refusals: [
      { code: 'INVALID_INPUT', when: 'The document is missing required fields or contains an invalid amount, date, or line.', next: 'Correct the document details and retry with a new operation key.' },
      { code: 'PERIOD_LOCKED', when: 'The document date or a posting it would reverse is closed for this person.', next: 'Choose an open date or ask an authorized owner to reopen the period.' },
      { code: 'CONFLICT', when: 'Another save changed or posted this document before the command committed.', next: 'Reload the document and review the current ledger before retrying.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
    ],
  };
}

function createCommand<Schema extends z.ZodTypeAny>(config: {
  name: `${string}.${string}`;
  collection: PostedDocumentType;
  field: string;
  input: Schema;
}): CommandDefinition<Schema, DocumentCommandResult, PreparedDocumentCommand> {
  const { collection, field, input } = config;
  return {
    name: config.name,
    input,
    roles: ROLES,
    dated: `${field}.date`,
    resolveDate(ctx, raw) {
      const inputRecord = raw as Record<string, unknown>;
      return postingDate(recordAt(inputRecord, field), typeof inputRecord.postingDay === 'string' ? inputRecord.postingDay : undefined, ctx.workspace);
    },
    prepare(ctx, raw) {
      const inputRecord = raw as Record<string, unknown>;
      const document = recordAt(inputRecord, field);
      return prepareCreate(
        ctx,
        collection,
        document,
        typeof inputRecord.postingDay === 'string' ? inputRecord.postingDay : undefined,
        inputRecord.creditLimitOverride as { reason: string } | undefined,
      );
    },
    handler(ctx, tx) {
      return commitPrepared(ctx, tx);
    },
    async preview(ctx, raw) {
      const inputRecord = raw as Record<string, unknown>;
      const prepared = await prepareCreate(
        ctx,
        collection,
        recordAt(inputRecord, field),
        typeof inputRecord.postingDay === 'string' ? inputRecord.postingDay : undefined,
        inputRecord.creditLimitOverride as { reason: string } | undefined,
      );
      return previewPrepared(ctx, prepared);
    },
    audit: (_input, result) => auditFor(result),
    inverse: () => null,
    risk: 'normal',
    describe: commandDescription(collection, 'create'),
  };
}

function updateCommand<Schema extends z.ZodTypeAny>(config: {
  name: `${string}.${string}`;
  collection: PostedDocumentType;
  input: Schema;
}): CommandDefinition<Schema, DocumentCommandResult, PreparedDocumentCommand> {
  const { collection, input } = config;
  return {
    name: config.name,
    input,
    roles: ROLES,
    prepare(ctx, raw) {
      const inputRecord = raw as Record<string, unknown>;
      const data = (inputRecord.data || {}) as Record<string, unknown>;
      return prepareUpdate(
        ctx,
        collection,
        String(inputRecord.id),
        data,
        typeof inputRecord.postingDay === 'string' ? inputRecord.postingDay : undefined,
        inputRecord.creditLimitOverride as { reason: string } | undefined,
      );
    },
    handler(ctx, tx) { return commitPrepared(ctx, tx); },
    async preview(ctx, raw) {
      const inputRecord = raw as Record<string, unknown>;
      const prepared = await prepareUpdate(
        ctx,
        collection,
        String(inputRecord.id),
        (inputRecord.data || {}) as Record<string, unknown>,
        typeof inputRecord.postingDay === 'string' ? inputRecord.postingDay : undefined,
        inputRecord.creditLimitOverride as { reason: string } | undefined,
      );
      return previewPrepared(ctx, prepared);
    },
    audit: (_input, result) => auditFor(result),
    inverse: () => null,
    risk: 'normal',
    describe: commandDescription(collection, 'update'),
  };
}

function deleteCommand<Schema extends z.ZodTypeAny>(config: {
  name: `${string}.${string}`;
  collection: PostedDocumentType;
  input: Schema;
}): CommandDefinition<Schema, DocumentCommandResult, PreparedDocumentCommand> {
  const { collection, input } = config;
  return {
    name: config.name,
    input,
    roles: ROLES,
    prepare(ctx, raw) {
      const inputRecord = raw as Record<string, unknown>;
      return prepareDelete(ctx, collection, String(inputRecord.id), typeof inputRecord.postingDay === 'string' ? inputRecord.postingDay : undefined);
    },
    handler(ctx, tx) { return commitPrepared(ctx, tx); },
    async preview(ctx, raw) {
      const inputRecord = raw as Record<string, unknown>;
      const prepared = await prepareDelete(ctx, collection, String(inputRecord.id), typeof inputRecord.postingDay === 'string' ? inputRecord.postingDay : undefined);
      return previewPrepared(ctx, prepared);
    },
    audit: (_input, result) => auditFor(result),
    inverse: () => null,
    risk: 'normal',
    describe: commandDescription(collection, 'delete'),
  };
}

export const invoiceCreateCommand = createCommand({ name: 'invoice.create', collection: 'invoices', field: 'invoice', input: invoiceCreateInput });
export const billCreateCommand = createCommand({ name: 'bill.create', collection: 'bills', field: 'bill', input: billCreateInput });
export const creditNoteCreateCommand = createCommand({ name: 'creditnote.create', collection: 'creditNotes', field: 'creditNote', input: creditNoteCreateInput });
export const vendorCreditCreateCommand = createCommand({ name: 'vendorcredit.create', collection: 'vendorCredits', field: 'vendorCredit', input: vendorCreditCreateInput });

export const invoiceUpdateCommand = updateCommand({ name: 'invoice.update', collection: 'invoices', input: invoiceUpdateInput });
export const billUpdateCommand = updateCommand({ name: 'bill.update', collection: 'bills', input: billUpdateInput });
export const creditNoteUpdateCommand = updateCommand({ name: 'creditnote.update', collection: 'creditNotes', input: creditNoteUpdateInput });
export const vendorCreditUpdateCommand = updateCommand({ name: 'vendorcredit.update', collection: 'vendorCredits', input: vendorCreditUpdateInput });

export const invoiceDeleteCommand = deleteCommand({ name: 'invoice.delete', collection: 'invoices', input: invoiceDeleteInput });
export const billDeleteCommand = deleteCommand({ name: 'bill.delete', collection: 'bills', input: billDeleteInput });
export const creditNoteDeleteCommand = deleteCommand({ name: 'creditnote.delete', collection: 'creditNotes', input: creditNoteDeleteInput });
export const vendorCreditDeleteCommand = deleteCommand({ name: 'vendorcredit.delete', collection: 'vendorCredits', input: vendorCreditDeleteInput });
