/**
 * The two document-flavoured journals: capitalising a lease (ASC 842) and recognising revenue
 * (ASC 606). Both were already one shared route in `http/journalDocumentRoute.ts`, and the steps are
 * now one shared service (`services/journalDocumentService.ts`) so the registered command and the
 * address that has always answered it run the same code.
 *
 * Each command names only what its entry is: the account pair, the amount, the description on the
 * journal and the audit line. The service keeps the order that matters — the body is validated, the
 * caller is a member who may post, the posting date falls in an open period, the canonical validator
 * passes the entry, and the commit re-checks membership, role and lock before the entry, the audit
 * log and the idempotency record go in together.
 *
 * A lease or a revenue recognition posts a balanced journal entry and nothing else; neither is
 * something the person can put back with an undo, because the entry it posts is the books.
 */
import { z } from 'zod';
import { prepareJournalDocument, postJournalDocumentInTransaction, type JournalDocumentSpec, type PreparedJournalDocument } from '../services/journalDocumentService';
import type { AnyCommandDefinition, CommandDefinition } from './types';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format');

// The address accepted `workspaceId`; the runner supplies the command's workspace, so the schema keeps
// the field (the legacy body sent it) but a command caller does not have to repeat it.
const workspaceField = { workspaceId: z.string().min(1, 'workspaceId is required').optional() };

export const leaseCapitalizeInput = z.object({
  ...workspaceField,
  leaseName: z.string().optional(),
  pvAmountCents: z.number().int().positive('pvAmountCents must be a positive integer'),
  rouAssetAccountId: z.string().min(1, 'rouAssetAccountId is required'),
  leaseLiabilityAccountId: z.string().min(1, 'leaseLiabilityAccountId is required'),
  date: isoDate.optional(),
}).strict();

type LeaseInput = z.output<typeof leaseCapitalizeInput>;

const LEASE_SPEC: JournalDocumentSpec<typeof leaseCapitalizeInput> = {
  operationType: 'LEASE_CAPITALIZE',
  legacyPrefix: 'lease',
  message: 'ASC 842 Lease capitalized successfully.',
  description: ({ leaseName }) => `ASC 842 Initial Recognition: ${leaseName || 'Operating Lease'}`,
  totalAmountCents: ({ pvAmountCents }) => pvAmountCents,
  lines: ({ pvAmountCents, rouAssetAccountId, leaseLiabilityAccountId }) => [
    { accountId: rouAssetAccountId, amountCents: pvAmountCents, description: 'Capitalize PV of lease payments' },
    { accountId: leaseLiabilityAccountId, amountCents: -pvAmountCents, description: 'Recognize lease liability' },
  ],
  operationId: ({ leaseName }) => (leaseName ? `lease_${leaseName.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : undefined),
  audit: {
    action: 'LEASE_CAPITALIZED',
    details: ({ leaseName, pvAmountCents, rouAssetAccountId, leaseLiabilityAccountId }, txDate) => ({
      description: `Capitalized lease ${leaseName || 'Operating Lease'} (${pvAmountCents} cents) on ${txDate}`,
      leaseName: leaseName || 'Operating Lease',
      pvAmountCents,
      rouAssetAccountId,
      leaseLiabilityAccountId,
      date: txDate,
    }),
  },
};

/** The same spec the lease address named, exported so a test can hold the route and the command together. */
export const leaseCapitalizeSpec = LEASE_SPEC;

export const leaseCapitalizeCommand: CommandDefinition<typeof leaseCapitalizeInput, { status: string; message: string; transactionId: string }> = {
  name: 'lease.capitalize',
  input: leaseCapitalizeInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  dated: 'date',
  resolveDate(_ctx, input) { return input.date; },
  capacity: 'transactions',
  operationType: 'LEASE_CAPITALIZE',
  // the address's own idempotency record: a retry that started on either path finds the other's
  legacyKey: (workspaceId, operationId) => `${workspaceId}_lease_${operationId}`,
  prepare(ctx, input) {
    return prepareJournalDocument(ctx.db, LEASE_SPEC, withWorkspace(ctx.workspaceId, input), callerOf(ctx));
  },
  async handler(ctx, tx, input) {
    // The runner's transaction and idempotency record: the entry and its audit line commit with the
    // runner's membership, role and lock re-check, not before it.
    return postJournalDocumentInTransaction(ctx.db, LEASE_SPEC, withWorkspace(ctx.workspaceId, input), callerOf(ctx), ctx.prepared as PreparedJournalDocument, tx);
  },
  async preview(_ctx, input) {
    const spec = LEASE_SPEC.lines(input);
    return {
      title: `Capitalize the lease ${input.leaseName || 'Operating Lease'}`,
      lines: [
        input.date ? `On ${input.date}` : 'On today',
        `Total ${input.pvAmountCents} cents`,
        ...spec.map(line => `${line.description}: ${line.amountCents} cents`),
      ],
      accounts: spec.map(line => ({ accountId: line.accountId, amountCents: line.amountCents, description: line.description })),
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Capitalise a lease under ASC 842, putting the present value of its payments on the balance sheet as an asset against a liability; do not use it to record the monthly lease payment — that is a bill or a journal entry.',
    example: { pvAmountCents: 1200000, rouAssetAccountId: 'acc_rou', leaseLiabilityAccountId: 'acc_lease', leaseName: 'Office 12B', date: '2026-01-01' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The amount is not a positive whole number of cents, or an account or the date is missing.', next: 'Send the present value in whole cents, both accounts and a YYYY-MM-DD date.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
      { code: 'PERIOD_LOCKED', when: 'The posting date falls in a closed period.', next: 'Choose an open date or ask an owner to reopen the period.' },
    ],
  },
};

export const revenueRecognizeInput = z.object({
  ...workspaceField,
  contractId: z.string().optional(),
  periodId: z.string().optional(),
  amountCents: z.number().int().positive('amountCents must be a positive integer'),
  deferredAccountId: z.string().min(1, 'deferredAccountId is required'),
  revenueAccountId: z.string().min(1, 'revenueAccountId is required'),
  date: isoDate.optional(),
}).strict();

const REVENUE_SPEC: JournalDocumentSpec<typeof revenueRecognizeInput> = {
  operationType: 'REVENUE_RECOGNIZE',
  legacyPrefix: 'rev',
  message: 'Revenue recognized successfully (ASC 606 compliance).',
  description: ({ contractId, periodId }) => `ASC 606 Revenue Recognition for Contract ${contractId || 'Unknown'} (Period ${periodId || 'N/A'})`,
  totalAmountCents: ({ amountCents }) => amountCents,
  lines: ({ amountCents, deferredAccountId, revenueAccountId }) => [
    { accountId: deferredAccountId, amountCents, description: 'Recognized revenue - reducing liability' },
    { accountId: revenueAccountId, amountCents: -amountCents, description: 'Recognized revenue - increasing income' },
  ],
  operationId: ({ contractId, periodId }) => (contractId && periodId ? `${contractId}_${periodId}` : undefined),
  audit: {
    action: 'REVENUE_RECOGNIZED',
    details: ({ contractId, periodId, amountCents, deferredAccountId, revenueAccountId }, txDate) => ({
      description: `Recognized revenue for contract ${contractId || 'Unknown'} (${amountCents} cents) on ${txDate}`,
      contractId: contractId || null,
      periodId: periodId || null,
      amountCents,
      deferredAccountId,
      revenueAccountId,
      date: txDate,
    }),
  },
};

export const leaseRevenueRecognizeSpec = REVENUE_SPEC;

export const revenueRecognizeCommand: CommandDefinition<typeof revenueRecognizeInput, { status: string; message: string; transactionId: string }> = {
  name: 'revenue.recognize',
  input: revenueRecognizeInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  dated: 'date',
  resolveDate(_ctx, input) { return input.date; },
  capacity: 'transactions',
  operationType: 'REVENUE_RECOGNIZE',
  legacyKey: (workspaceId, operationId) => `${workspaceId}_rev_${operationId}`,
  prepare(ctx, input) {
    return prepareJournalDocument(ctx.db, REVENUE_SPEC, withWorkspace(ctx.workspaceId, input), callerOf(ctx));
  },
  async handler(ctx, tx, input) {
    return postJournalDocumentInTransaction(ctx.db, REVENUE_SPEC, withWorkspace(ctx.workspaceId, input), callerOf(ctx), ctx.prepared as PreparedJournalDocument, tx);
  },
  async preview(_ctx, input) {
    const spec = REVENUE_SPEC.lines(input);
    return {
      title: `Recognize revenue for contract ${input.contractId || 'Unknown'}`,
      lines: [
        input.date ? `On ${input.date}` : 'On today',
        `Total ${input.amountCents} cents`,
        ...spec.map(line => `${line.description}: ${line.amountCents} cents`),
      ],
      accounts: spec.map(line => ({ accountId: line.accountId, amountCents: line.amountCents, description: line.description })),
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Recognise revenue under ASC 606, moving an amount out of the deferred balance and into income; do not use it to invoice a customer — that is an invoice.',
    example: { amountCents: 250000, deferredAccountId: 'acc_deferred', revenueAccountId: 'acc_revenue', contractId: 'C-14', periodId: '2026-01', date: '2026-01-31' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The amount is not a positive whole number of cents, or an account or the date is missing.', next: 'Send the amount in whole cents, both accounts and a YYYY-MM-DD date.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
      { code: 'PERIOD_LOCKED', when: 'The posting date falls in a closed period.', next: 'Choose an open date or ask an owner to reopen the period.' },
    ],
  },
};

export const VERTICAL_ACCOUNTING_COMMANDS: AnyCommandDefinition[] = [leaseCapitalizeCommand, revenueRecognizeCommand];

/** The three things the service needs to know about who is posting. */
function callerOf(ctx: { actor: string; email?: string; user: { admin?: boolean } }) {
  return { uid: ctx.actor, email: ctx.email, admin: ctx.user.admin };
}

/** The service reads the workspace from the input the way the address sent it; the runner knows it. */
function withWorkspace<T extends { workspaceId?: string }>(workspaceId: string, input: T): T & { workspaceId: string } {
  return { ...input, workspaceId };
}

export type LeaseCapitalizeInput = LeaseInput;
