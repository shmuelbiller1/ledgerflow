import { z } from 'zod';
import type { Transaction } from '../db/firestore';
import { getDateInTimezoneISO } from '../../lib/calendarDate';
import { formatMoney } from '../../lib/moneyFormat';
import { isIsoDate } from '../../lib/warehouseRecordUtils';
import { findPaymentType } from '../../lib/paymentTypes';
import { afterPaymentRecorded } from '../services/afterPayment';
import { createPaymentInTransaction, paymentRequestHash, type CreatePaymentPayload } from '../services/paymentService';
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
    ctx.afterCommit(async () => {
      const remittance = await afterPaymentRecorded(ctx.db, { ...result.payment, id: result.paymentId }, ctx.actor, { remittance: Boolean(_input.sendRemittance) });
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
