import { deferEffects } from '../services/sandboxEffects';
import { z } from 'zod';
import type { Transaction } from '../db/firestore';
import { getDateInTimezoneISO } from '../../lib/calendarDate';
import { formatMoney } from '../../lib/moneyFormat';
import { isIsoDate } from '../../lib/warehouseRecordUtils';
import { findPaymentType } from '../../lib/paymentTypes';
import { afterPaymentRecorded, paymentEffectIntents } from '../services/afterPayment';
import {
  applyUnappliedPayment, createPaymentInTransaction, paymentRequestHash, type CreatePaymentPayload,
} from '../services/paymentService';
import { voidPayment } from '../services/paymentVoidService';
import { applyCredit, autoApplyCredits, refundCredit } from '../services/creditService';
import { createDeposit } from '../services/depositService';
import { writeServerAuditLog } from '../services/auditLogService';
import type { CommandContext, CommandDefinition } from './types';

const paymentAllocationSchema = z.object({
  documentId: z.string().min(1),
  documentType: z.enum(['invoice', 'bill']),
  amountCents: z.number().int().positive(),
}).strict();

export const paymentReceiveInput = z.object({
  workspaceId: z.string().min(1).optional(),
  amountCents: z.number().int().positive(),
  paymentDate: z.string().refine(isIsoDate, 'paymentDate must be a real date (YYYY-MM-DD)').optional(),
  cashAccountId: z.string().min(1),
  paymentMethod: z.string().optional(),
  paymentTypeId: z.string().min(1).max(40).optional(),
  referenceNumber: z.string().optional(),
  memo: z.string().optional(),
  customerId: z.string().optional(),
  vendorId: z.string().optional(),
  entityName: z.string().optional(),
  offsetAccountId: z.string().optional(),
  allocations: z.array(paymentAllocationSchema).default([]),
  sendRemittance: z.boolean().optional(),
  paymentExchangeRate: z.number().positive().max(1e6).optional(),
  paymentRateSource: z.enum(['typed', 'last-used', 'live', 'books-on-date']).optional(),
  estimateId: z.string().min(1).max(200).optional(),
  withheldCents: z.number().int().nonnegative().optional(),
  withholdingRatePercent: z.number().min(0).max(100).optional(),
  withholdingCertificate: z.string().max(40).optional(),
}).strict();

type PaymentInput = z.output<typeof paymentReceiveInput>;
type PaymentResult = Awaited<ReturnType<typeof createPaymentInTransaction>>;
type PreparedPayment = {
  paymentInput: CreatePaymentPayload;
  missingPaymentType: boolean;
};

function requestFingerprint(ctx: Omit<CommandContext, 'prepared' | 'afterCommit'>, input: PaymentInput): Record<string, unknown> {
  const { workspaceId: _bodyWorkspaceId, sendRemittance: _sendRemittance, paymentTypeId, ...rest } = input;
  return { ...rest, paymentTypeId, paymentDate: rest.paymentDate || null, workspaceId: ctx.workspaceId, uid: ctx.actor };
}

async function preparePayment(ctx: Omit<CommandContext, 'prepared' | 'afterCommit'>, input: PaymentInput): Promise<PreparedPayment> {
  if (input.workspaceId && input.workspaceId !== ctx.workspaceId) throw Object.assign(new Error('Input workspaceId must match the command workspace'), { status: 400 });
  const { workspaceId: _bodyWorkspaceId, sendRemittance: _sendRemittance, paymentTypeId, ...rest } = input;
  const paymentType = paymentTypeId ? findPaymentType(ctx.workspace.paymentTypes, paymentTypeId) : undefined;
  if (paymentTypeId && !paymentType && !ctx.operationId) {
    throw Object.assign(new Error('That payment type is no longer in Settings. Choose another and try again.'), { status: 400 });
  }
  const paymentDate = rest.paymentDate || ctx.effectiveDate || getDateInTimezoneISO(new Date(), typeof ctx.workspace.timezone === 'string' ? ctx.workspace.timezone : undefined);
  const paymentInput: CreatePaymentPayload = {
    ...rest,
    paymentDate,
    workspaceId: ctx.workspaceId,
    uid: ctx.actor,
    ...(paymentType ? { paymentMethod: paymentType.method, paymentType: { id: paymentType.id, name: paymentType.name } } : {}),
  };
  return { paymentInput, missingPaymentType: Boolean(paymentTypeId && !paymentType) };
}

interface DryRunWrite {
  method: 'set' | 'create' | 'update' | 'delete';
  path: string;
  data?: unknown;
}

/**
 * A deliberately non-persistent transaction for payment previews. Reads go to Firestore, while all
 * writes are captured in memory. This lets the production payment builder validate and shape the
 * exact ledger lines without calling any Firestore write method.
 */
function readonlyTransaction(): { transaction: Transaction; writes: DryRunWrite[] } {
  const writes: DryRunWrite[] = [];
  const read = async (ref: unknown): Promise<unknown> => (ref as { get(): Promise<unknown> }).get();
  const pathOf = (ref: unknown): string => String((ref as { path?: unknown } | null)?.path || '');
  const transaction = {
    get: read,
    getAll: async (...refs: unknown[]) => Promise.all(refs.map(read)),
    set(ref: unknown, data: unknown) { writes.push({ method: 'set', path: pathOf(ref), data }); return this; },
    create(ref: unknown, data: unknown) { writes.push({ method: 'create', path: pathOf(ref), data }); return this; },
    update(ref: unknown, data: unknown) { writes.push({ method: 'update', path: pathOf(ref), data }); return this; },
    delete(ref: unknown) { writes.push({ method: 'delete', path: pathOf(ref) }); return this; },
  } as unknown as Transaction;
  return { transaction, writes };
}

async function previewPayment(ctx: Omit<CommandContext, 'prepared' | 'afterCommit'>, input: PaymentInput) {
  const prepared = await preparePayment(ctx, input);
  if (prepared.missingPaymentType) throw Object.assign(new Error('That payment type is no longer in Settings. Choose another and try again.'), { status: 400 });
  const dryRun = readonlyTransaction();
  const result = await createPaymentInTransaction(ctx.db, dryRun.transaction, prepared.paymentInput, { platformAdmin: ctx.user.admin === true, writeAudit: false });
  const stagedPaths = new Set(dryRun.writes.map(write => write.path));
  if (!stagedPaths.has(`payments/${result.paymentId}`) || !stagedPaths.has(`transactions/${result.transactionId}`)) {
    throw new Error('Payment preview could not build a complete dry-run posting');
  }
  const lines = (result.ledgerTransaction.lines || []) as Array<Record<string, unknown>>;
  const ids = [...new Set(lines.map(line => String(line.accountId || '')).filter(Boolean))];
  const names = new Map<string, string>();
  await Promise.all(ids.map(async id => {
    const snap = await ctx.db.collection('chartAccounts').doc(id).get();
    const account = snap.data();
    if (account?.workspaceId === ctx.workspaceId && typeof account.name === 'string') names.set(id, account.name);
  }));
  const amountCents = Number(result.payment.amountCents);
  if (!Number.isSafeInteger(amountCents)) throw new Error('Payment preview returned an invalid amount');
  return {
    title: `${input.vendorId ? 'Pay' : 'Receive'} ${amountCents} cents${input.entityName ? ` ${input.vendorId ? 'to' : 'from'} ${input.entityName}` : ''}`,
    lines: [String(prepared.paymentInput.paymentDate), String(input.paymentMethod || (input.vendorId ? 'Vendor payment' : 'Customer receipt')), `${amountCents} cents`],
    accounts: lines.map(line => ({
      accountId: String(line.accountId || ''),
      ...(names.get(String(line.accountId || '')) ? { accountName: names.get(String(line.accountId || '')) } : {}),
      amountCents: Number(line.amountCents || 0),
      ...(typeof line.description === 'string' ? { description: line.description } : {}),
    })),
  };
}

export const paymentReceiveCommand: CommandDefinition<typeof paymentReceiveInput, PaymentResult, PreparedPayment> = {
  name: 'payment.receive',
  input: paymentReceiveInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  // the legacy route skipped its role check for a platform admin (audit F4/F5 pin that)
  allowPlatformAdmin: true,
  dated: 'paymentDate',
  resolveDate(ctx, input) {
    return input.paymentDate || getDateInTimezoneISO(new Date(), typeof ctx.workspace.timezone === 'string' ? ctx.workspace.timezone : undefined);
  },
  operationType: 'PAYMENT_CREATE',
  legacyKey: (workspaceId, operationId) => `${workspaceId}:PAYMENT_CREATE:${operationId}`,
  prepare: preparePayment,
  idempotencyHash(ctx, input) {
    const { workspaceId: _bodyWorkspaceId, sendRemittance: _sendRemittance, paymentTypeId, ...rest } = input;
    const fingerprint = paymentTypeId
      ? requestFingerprint(ctx, input)
      : { ...rest, paymentDate: rest.paymentDate || ctx.effectiveDate || null, workspaceId: ctx.workspaceId, uid: ctx.actor };
    return paymentRequestHash(fingerprint);
  },
  async handler(ctx, tx, _input) {
    const prepared = ctx.prepared as PreparedPayment;
    if (prepared.missingPaymentType) {
      throw Object.assign(new Error('That payment type is no longer in Settings. Choose another and try again.'), { status: 400 });
    }
    let result: PaymentResult;
    try {
      result = await createPaymentInTransaction(ctx.db, tx, prepared.paymentInput, { platformAdmin: ctx.user.admin === true, writeAudit: false });
    } catch (error) {
      if ((error as { status?: number }).status) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const status = /FORBIDDEN|Forbidden|Unauthorized|Security Violation/i.test(message) ? 403
        : /NOT_FOUND|not found/i.test(message) ? 404 : 400;
      throw Object.assign(new Error(message), { status });
    }
    const payment = { ...result.payment, id: result.paymentId };
    const options = { remittance: Boolean(_input.sendRemittance) };
    deferEffects(ctx.db, paymentEffectIntents(ctx.workspace, payment, options), ctx.afterCommit, async () => {
      const remittance = await afterPaymentRecorded(ctx.db, payment, ctx.actor, options);
      return _input.sendRemittance ? { remittance } : undefined;
    });
    return result;
  },
  preview: previewPayment,
  audit(_input, result) {
    const paymentNumber = String(result.payment.number || result.paymentId);
    const amountCents = Number(result.payment.amountCents);
    const currency = typeof result.payment.currency === 'string' ? result.payment.currency : undefined;
    const contactName = String(result.payment.entityName || 'contact');
    return {
      action: 'PAYMENT_RECORDED',
      entityType: 'payment',
      entityId: result.paymentId,
      description: `Payment ${paymentNumber} of ${formatMoney(amountCents, currency)} recorded for ${contactName}.`,
      details: { paymentNumber, amountCents, paymentMethod: result.payment.paymentMethod },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Record money received from a customer or paid to a vendor and apply it to open documents, and do not use it to create an invoice or bill.',
    example: { amountCents: 12500, paymentDate: '2026-06-30', cashAccountId: 'acc_bank', customerId: 'cust_123', allocations: [{ documentId: 'inv_123', documentType: 'invoice', amountCents: 12500 }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The payment amount, date, cash account, payment type, or allocation is invalid.', next: 'Correct the payment details and choose an existing cash account and open document.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
      { code: 'PERIOD_LOCKED', when: 'The payment date is in a closed period.', next: 'Choose an open date or ask an owner to reopen the period.' },
      { code: 'CONFLICT', when: 'The operation id was already used for different payment details.', next: 'Use a new operation id for the changed request.' },
    ],
  },
};

// --------------------------------------------------------------------------- credits, deposits, apply, void
//
// The five writes `paymentRoutes.ts` made around a payment: a credit note applied to an invoice or
// refunded, every open credit applied at once, a bank deposit, a payment's unapplied part applied
// later, and a payment voided. Each service already owns the rule and the transaction, and each writes
// its own audit line inside that transaction, so `audit` answers null here: the runner's extra summary
// would be a second line for one write. The commands add the registered door (the runner checks the
// workspace, the caller's role and the period before the service runs) and the roles the routes'
// `requireWorkspaceRole` middleware checked, in the same order: refused before the body is read.

const LEDGER_WRITERS = ['owner', 'accountant', 'bookkeeper'] as const;

/** The date the legacy route used when the body left it out: today in the workspace's timezone. */
function todayInWorkspace(ctx: { workspace: Record<string, unknown> }): string {
  return getDateInTimezoneISO(new Date(), typeof ctx.workspace.timezone === 'string' ? ctx.workspace.timezone : undefined);
}

const creditApplyInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  kind: z.enum(['customer', 'vendor']),
  creditId: z.string().min(1),
  documentId: z.string().min(1),
  amountCents: z.number().int().positive(),
  date: z.string().refine(isIsoDate, 'date must be a real date (YYYY-MM-DD)').optional(),
}).strict();

export const paymentCreditApplyCommand: CommandDefinition<typeof creditApplyInput, Record<string, unknown>> = {
  name: 'payment.creditapply',
  input: creditApplyInput,
  roles: [...LEDGER_WRITERS],
  dated: 'date',
  resolveDate: todayInWorkspace,
  async handler(ctx, _tx, input) {
    const { workspaceId: _bodyWorkspaceId, ...rest } = input;
    return applyCredit(ctx.db, { ...rest, workspaceId: ctx.workspaceId, uid: ctx.actor, operationId: ctx.operationId });
  },
  async preview(ctx, input) {
    return {
      title: `Apply ${formatMoney(input.amountCents)} of a ${input.kind === 'vendor' ? 'vendor credit' : 'credit note'}`,
      lines: [
        `To ${input.documentId} on ${input.date || todayInWorkspace(ctx)}`,
        'Settles the document without posting cash again',
      ],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: "Apply a credit note to a customer's invoice, or a vendor credit to a bill; do not use it to refund the credit as cash — that is payment.creditrefund.",
    example: { kind: 'customer', creditId: 'credit_123', documentId: 'invoice_123', amountCents: 6000 },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The kind, credit, document, amount or date is missing or malformed.', next: 'Send kind, creditId, documentId, amountCents and, if you choose, a real date.' },
      { code: 'CONFLICT', when: 'The credit has no entry in the books, is smaller than the amount, or the document is settled.', next: 'Apply no more than the credit and the document still allow.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask a workspace owner for a writing role.' },
    ],
  },
};

const creditRefundInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  kind: z.enum(['customer', 'vendor']),
  creditId: z.string().min(1),
  amountCents: z.number().int().positive(),
  cashAccountId: z.string().min(1),
  date: z.string().refine(isIsoDate, 'date must be a real date (YYYY-MM-DD)').optional(),
  memo: z.string().max(500).optional(),
}).strict();

export const paymentCreditRefundCommand: CommandDefinition<typeof creditRefundInput, Record<string, unknown>> = {
  name: 'payment.creditrefund',
  input: creditRefundInput,
  roles: [...LEDGER_WRITERS],
  dated: 'date',
  resolveDate: todayInWorkspace,
  async handler(ctx, _tx, input) {
    const { workspaceId: _bodyWorkspaceId, ...rest } = input;
    return refundCredit(ctx.db, { ...rest, workspaceId: ctx.workspaceId, uid: ctx.actor });
  },
  async preview(ctx, input) {
    return {
      title: `Refund ${formatMoney(input.amountCents)} of a credit`,
      lines: [
        `Paid out of ${input.cashAccountId} on ${input.date || todayInWorkspace(ctx)}`,
        'Posts cash out of the bank and lowers the credit',
      ],
      accounts: [{ accountId: input.cashAccountId, amountCents: -input.amountCents, description: 'Credit refunded' }],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: "Refund a credit note or vendor credit as money, out of a bank or cash account; do not use it to settle an invoice — that is payment.creditapply.",
    example: { kind: 'customer', creditId: 'credit_123', amountCents: 4000, cashAccountId: 'acc_bank', date: '2026-06-30' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The credit, amount, cash account or date is missing or malformed.', next: 'Send a real credit, amount, cash account and date.' },
      { code: 'CONFLICT', when: 'The credit has no entry in the books, or is smaller than the refund.', next: 'Refund no more than the credit still allows.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask a workspace owner for a writing role.' },
    ],
  },
};

const creditAutoApplyInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  kind: z.enum(['customer', 'vendor']),
  partyId: z.string().min(1).max(200).optional(),
}).strict();

export const paymentCreditsAutoApplyCommand: CommandDefinition<typeof creditAutoApplyInput, Awaited<ReturnType<typeof autoApplyCredits>>> = {
  name: 'payment.creditsautoapply',
  input: creditAutoApplyInput,
  roles: [...LEDGER_WRITERS],
  async handler(ctx, _tx, input) {
    // The service applies each credit in its own transaction; the route wrote one summary line after
    // that (not inside it), and this writes the same line in the same place: after the applications.
    const result = await autoApplyCredits(ctx.db, { workspaceId: ctx.workspaceId, kind: input.kind, partyId: input.partyId, uid: ctx.actor });
    if (result.applications.length) {
      await writeServerAuditLog({
        workspaceId: ctx.workspaceId,
        uid: ctx.actor,
        email: ctx.email || '',
        action: 'CREDITS_AUTO_APPLIED',
        entityType: input.kind === 'vendor' ? 'vendorCredit' : 'creditNote',
        entityId: input.partyId || 'all',
        details: {
          applications: result.applications,
          description: `Applied ${result.totalCents} cents of open credits to ${result.applications.length} ${input.kind === 'vendor' ? 'bill' : 'invoice'} line(s)`,
        },
      }, { db: ctx.db });
    }
    return result;
  },
  async preview(_ctx, input) {
    return {
      title: `Apply every open ${input.kind === 'vendor' ? 'vendor credit' : 'credit note'}${input.partyId ? ' of one contact' : ''}`,
      lines: ['Oldest open document first', 'Each settlement writes its own line'],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Apply every open credit to the open invoices or bills of one contact, or of the whole workspace, oldest first; do not use it to refund a credit.',
    example: { kind: 'customer', partyId: 'cust_123' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The kind is missing or unknown.', next: 'Send kind customer or vendor.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask a workspace owner for a writing role.' },
    ],
  },
};

const depositInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  bankAccountId: z.string().min(1),
  date: z.string().refine(isIsoDate, 'date must be a real date (YYYY-MM-DD)').optional(),
  paymentIds: z.array(z.string().min(1)).min(1).max(500),
  memo: z.string().max(500).optional(),
}).strict();

export const paymentDepositCommand: CommandDefinition<typeof depositInput, Awaited<ReturnType<typeof createDeposit>>> = {
  name: 'payment.deposit',
  input: depositInput,
  roles: [...LEDGER_WRITERS],
  dated: 'date',
  resolveDate: todayInWorkspace,
  async handler(ctx, _tx, input) {
    const { workspaceId: _bodyWorkspaceId, ...rest } = input;
    return createDeposit(ctx.db, { ...rest, workspaceId: ctx.workspaceId, uid: ctx.actor });
  },
  async preview(ctx, input) {
    return {
      title: `Deposit ${input.paymentIds.length} payment(s)`,
      lines: [
        `Into ${input.bankAccountId} on ${input.date || todayInWorkspace(ctx)}`,
        'Moves the money out of Undeposited Funds in one entry',
      ],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Take the payments waiting in Undeposited Funds to a bank account in one entry; do not use it to record a payment from a customer.',
    example: { bankAccountId: 'acc_bank', paymentIds: ['payment_1', 'payment_2'], date: '2026-06-30' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'No payment is named, or the bank account is not a cash account of the books.', next: 'Choose the payments waiting in Undeposited Funds and a real bank account.' },
      { code: 'CONFLICT', when: 'A payment is void, already deposited, or waiting in another Undeposited Funds account.', next: 'Deposit only the payments still waiting in the same account.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask a workspace owner for a writing role.' },
    ],
  },
};

const applyInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  paymentId: z.string().min(1),
  allocations: z.array(paymentAllocationSchema).min(1).max(100),
  date: z.string().refine(isIsoDate, 'date must be a real date (YYYY-MM-DD)').optional(),
}).strict();

export const paymentApplyCommand: CommandDefinition<typeof applyInput, Awaited<ReturnType<typeof applyUnappliedPayment>>> = {
  name: 'payment.apply',
  input: applyInput,
  roles: [...LEDGER_WRITERS],
  dated: 'date',
  resolveDate: todayInWorkspace,
  async handler(ctx, _tx, input) {
    const { workspaceId: _bodyWorkspaceId, date, ...rest } = input;
    return applyUnappliedPayment(ctx.db, {
      ...rest, date: date || ctx.effectiveDate || todayInWorkspace(ctx),
      workspaceId: ctx.workspaceId, uid: ctx.actor, operationId: ctx.operationId,
    });
  },
  async preview(ctx, input) {
    const total = input.allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
    return {
      title: `Apply ${formatMoney(total)} of a payment`,
      lines: [
        `To ${input.allocations.length} open document(s) on ${input.date || todayInWorkspace(ctx)}`,
        'The money was already in the bank; this moves it to A/R or A/P',
      ],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: "Apply the unapplied part of a payment — a deposit or prepayment — to invoices or bills later; do not use it to record a new payment.",
    example: { paymentId: 'payment_123', allocations: [{ documentId: 'invoice_123', documentType: 'invoice', amountCents: 3333 }], date: '2026-06-30' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'No allocation is named, or the date is not a real day.', next: 'Send the invoice or bill and the amount, with a real date.' },
      { code: 'CONFLICT', when: 'The amount is more than is unapplied, the document is closed, or the dates and rates do not line up.', next: 'Apply no more than the payment still holds, at that payment rate and on or after its date.' },
      { code: 'NOT_FOUND', when: 'The payment or a document is not in this workspace.', next: 'Check the payment and document ids.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask a workspace owner for a writing role.' },
    ],
  },
};

const voidInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  paymentId: z.string().min(1),
  date: z.string().refine(isIsoDate, 'date must be a real date (YYYY-MM-DD)').optional(),
  reason: z.string().max(300).optional(),
}).strict();

export const paymentVoidCommand: CommandDefinition<typeof voidInput, Awaited<ReturnType<typeof voidPayment>>> = {
  name: 'payment.void',
  input: voidInput,
  roles: [...LEDGER_WRITERS],
  dated: 'date',
  async handler(ctx, _tx, input) {
    const { workspaceId: _bodyWorkspaceId, ...rest } = input;
    return voidPayment(ctx.db, { ...rest, workspaceId: ctx.workspaceId, uid: ctx.actor });
  },
  async preview(ctx, input) {
    return {
      title: `Void the payment ${input.paymentId}`,
      lines: [
        input.date ? `Reversed on ${input.date}` : "Reversed on the payment's own date",
        'Its documents are due again; a retry posts nothing',
      ],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Void a payment so its entry and its ledger rows are reversed and its documents are due again; do not use it to correct one line — void and record the payment again.',
    example: { paymentId: 'payment_123', date: '2026-07-01', reason: 'Cheque bounced' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The payment is not in this workspace.', next: 'Check the payment id.' },
      { code: 'CONFLICT', when: 'The payment is already void, is inside a bank deposit, or the void date is before the payment or in a closed period.', next: 'Undo the deposit first, and choose an open date on or after the payment.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask a workspace owner for a writing role.' },
    ],
  },
};
