/**
 * Bank reconciliation (CA-01, CA-04, Y-09, Y-10, EG-9): the writes `transactions/reconcileRoutes.ts`
 * ran by hand. Each one keeps its legacy URL as a thin wrapper with the same request and answer
 * (`{ status: 'ok', ... }` or `{ error }`), while the checks live in `prepare` (read-only, after the
 * runner's workspace, role and period gates) and the write lives in a service function that takes
 * the runner's transaction. So the entry, the line's mark and the audit line commit together or not
 * at all, and a retried request never posts twice.
 *
 * No posting or tax arithmetic moves here: an entry the batch creates or edits still goes through
 * `TransactionValidator.validateAndPrepare`, exactly as it did inside the route.
 */
import { z } from 'zod';
import type { CommandDefinition } from './types';
import {
  prepareReconcile,
  reconcileInTransaction,
  RECONCILE_MAX_OPERATIONS,
  type ReconcilePrepared,
} from '../services/reconciliationWriteService';
import {
  clearEntriesAudit,
  clearEntriesInTransaction,
  CLEAR_MAX_ENTRIES,
  completeReconciliationAudit,
  completeReconciliationInTransaction,
  prepareClearEntries,
  prepareCompleteReconciliation,
  prepareUpdateBankLine,
  updateBankLineAudit,
  updateBankLineInTransaction,
  type ClearEntriesPrepared,
  type CompleteReconciliationPrepared,
  type UpdateBankLinePrepared,
} from '../services/reconciliationWriteService';
import {
  afterPaymentRecorded,
  payFromBankLineInTransaction,
  preparePayFromBankLine,
  prepareSplitBankLine,
  splitBankLineInTransaction,
  type PayFromBankLinePrepared,
  type SplitBankLinePrepared,
} from '../services/bankLineService';
import { BankRuleError, prepareRerunBankRules, rerunBankRules } from '../services/bankRuleService';

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date (YYYY-MM-DD)');

const LEDGER_WRITERS = ['owner', 'accountant', 'bookkeeper'] as const;

// --------------------------------------------------------------------------- POST /reconcile

const reconcileOperation = z.object({
  id: z.string().min(1),
  type: z.enum(['updateBankLine', 'updateTransaction', 'createTransaction']),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const reconcileInput = z.object({
  /** The legacy body's workspace: the runner refuses one that is not the workspace it runs in. */
  workspaceId: z.string().min(1).max(200).optional(),
  operations: z.array(reconcileOperation).min(1).max(RECONCILE_MAX_OPERATIONS),
}).strict();

export const reconcileCommand: CommandDefinition<typeof reconcileInput, { status: 'ok' }, ReconcilePrepared> = {
  name: 'reconciliations.reconcile',
  input: reconcileInput,
  roles: [...LEDGER_WRITERS],
  allowPlatformAdmin: true,
  async prepare(ctx, input) {
    return prepareReconcile(ctx.db, {
      workspaceId: ctx.workspaceId,
      operations: input.operations,
      uid: ctx.actor,
    });
  },
  async handler(ctx, tx, input) {
    await reconcileInTransaction(
      ctx.db,
      tx,
      { workspaceId: ctx.workspaceId, operations: input.operations },
      ctx.prepared as ReconcilePrepared,
      { uid: ctx.actor, email: ctx.email, admin: ctx.user.admin },
    );
    return { status: 'ok' as const };
  },
  async preview(ctx, input) {
    const prepared = await prepareReconcile(ctx.db, { workspaceId: ctx.workspaceId, operations: input.operations, uid: ctx.actor });
    const counts = input.operations.reduce<Record<string, number>>((acc, op) => ({ ...acc, [op.type]: (acc[op.type] || 0) + 1 }), {});
    return {
      title: `Reconcile ${input.operations.length} change(s)`,
      lines: [
        ...Object.entries(counts).map(([type, count]) => `${count} x ${type}`),
        `${prepared.bankLineIds.length} bank line(s) and ${prepared.txIds.length} entry(ies)`,
        'Every change in the batch is written together, or none is',
      ],
    };
  },
  audit(input, _result) {
    return {
      action: 'reconcile',
      entityType: 'reconciliation',
      entityId: input.operations[0]?.id || 'batch',
      // the legacy audit line's exact wording, which the existing tests and reports read
      description: `executed reconciliation batch (${input.operations.length} operations)`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Match, unmatch or correct bank lines and entries as one reconciliation batch; do not use it to post a new bill or invoice — that is documents.post.',
    example: { operations: [{ id: 'bankline_123', type: 'updateBankLine', data: { status: 'matched', matchedTransactionId: 'tx_123' } }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'An operation has no id, an unknown type, or the batch is empty or over 250.', next: 'Send between 1 and 250 operations, each with an id and a known type.' },
      { code: 'NOT_FOUND', when: 'The workspace is not found.', next: 'Check the workspace id.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner, accountant or bookkeeper of the workspace.', next: 'Ask an owner, accountant or bookkeeper.' },
      { code: 'PERIOD_LOCKED', when: 'A line or entry in the batch is dated in a closed period.', next: 'Use dates in an open period.' },
    ],
  },
};

// --------------------------------------------------------------------------- POST /reconciliation/clear

export const clearEntriesCommandInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  transactionIds: z.array(z.string().min(1)).min(1).max(CLEAR_MAX_ENTRIES),
  clearanceDate: DAY.optional(),
  cleared: z.boolean().optional(),
}).strict();

export const clearEntriesCommand: CommandDefinition<typeof clearEntriesCommandInput, { clearedCount: number; undo: boolean }, ClearEntriesPrepared> = {
  name: 'reconciliations.clear',
  input: clearEntriesCommandInput,
  roles: [...LEDGER_WRITERS],
  allowPlatformAdmin: true,
  async prepare(ctx, input) {
    return prepareClearEntries(ctx.db, {
      workspaceId: ctx.workspaceId,
      transactionIds: input.transactionIds,
      clearanceDate: input.clearanceDate,
      cleared: input.cleared,
      uid: ctx.actor,
      admin: ctx.user.admin,
    });
  },
  async handler(ctx, tx, input) {
    return clearEntriesInTransaction(
      ctx.db,
      tx,
      { workspaceId: ctx.workspaceId, transactionIds: input.transactionIds, clearanceDate: input.clearanceDate, cleared: input.cleared },
      ctx.prepared as ClearEntriesPrepared,
      { uid: ctx.actor, admin: ctx.user.admin },
    );
  },
  async preview(ctx, input) {
    const prepared = await prepareClearEntries(ctx.db, { workspaceId: ctx.workspaceId, transactionIds: input.transactionIds, clearanceDate: input.clearanceDate, cleared: input.cleared, uid: ctx.actor, admin: ctx.user.admin });
    return {
      title: prepared.undo ? `Mark ${input.transactionIds.length} entry(ies) as not cleared` : `Clear ${input.transactionIds.length} entry(ies)`,
      lines: [
        prepared.undo ? 'The cleared mark is removed' : 'The entries are marked as seen on the bank statement',
        ...(input.clearanceDate ? [`The bank cleared them on ${input.clearanceDate}`] : []),
      ],
    };
  },
  audit(input, result) {
    return clearEntriesAudit(
      { workspaceId: '', transactionIds: input.transactionIds, clearanceDate: input.clearanceDate },
      result,
    );
  },
  inverse(input) {
    return { command: 'reconciliations.clear', input: { transactionIds: input.transactionIds, cleared: false } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Mark bank entries as cleared against the statement, or take the mark back again; do not use it to change an amount — correct the entry instead.',
    example: { transactionIds: ['tx_123', 'tx_124'], clearanceDate: '2026-11-01' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The list is empty, over 500, or the clearance date is not a date.', next: 'Send 1 to 500 entry ids and a date (YYYY-MM-DD).' },
      { code: 'NOT_FOUND', when: 'One of the entries is not there.', next: 'Refresh the list of uncleared entries.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask an owner, accountant or bookkeeper.' },
      { code: 'CONFLICT', when: 'The clearance date is before an entry\'s own date.', next: 'Use the entry\'s date or a later one.' },
    ],
  },
};

// --------------------------------------------------------------------------- PATCH /bank-lines/:id

export const updateBankLineCommandInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  id: z.string().min(1).max(200),
  data: z.record(z.string(), z.unknown()),
}).strict();

export const updateBankLineCommand: CommandDefinition<typeof updateBankLineCommandInput, { id: string; data: Record<string, unknown> }, UpdateBankLinePrepared> = {
  name: 'reconciliations.bankline',
  input: updateBankLineCommandInput,
  roles: [...LEDGER_WRITERS],
  allowPlatformAdmin: true,
  async prepare(ctx, input) {
    return prepareUpdateBankLine(ctx.db, { workspaceId: ctx.workspaceId, id: input.id, uid: ctx.actor, admin: ctx.user.admin });
  },
  async handler(ctx, tx, input) {
    return updateBankLineInTransaction(ctx.db, tx, { workspaceId: ctx.workspaceId, id: input.id, data: input.data });
  },
  async preview(ctx, input) {
    await prepareUpdateBankLine(ctx.db, { workspaceId: ctx.workspaceId, id: input.id, uid: ctx.actor, admin: ctx.user.admin });
    return {
      title: `Update bank line ${input.id}`,
      lines: [`Fields: ${Object.keys(input.data).join(', ') || 'none'}`, 'Only the fields of a bank line change; no entry is posted'],
    };
  },
  audit(input, result) {
    return updateBankLineAudit({ id: input.id, data: input.data }, result);
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Change a bank line the feed brought in — its note, its suggestion or its matched entry; do not use it to edit a posted entry — that is reconciliations.reconcile.',
    example: { id: 'bankline_123', data: { status: 'matched', matchedTransactionId: 'tx_123' } },
    refusals: [
      { code: 'FORBIDDEN', when: 'The caller is not an owner, accountant or bookkeeper of the workspace.', next: 'Ask an owner, accountant or bookkeeper.' },
      { code: 'NOT_FOUND', when: 'The bank line, or the entry it is matched to, is not in this workspace.', next: 'Sync the feed again or check the ids.' },
      { code: 'CONFLICT', when: 'The bank line is dated in a closed period.', next: 'Reopen the period or leave the line as it is.' },
      { code: 'INVALID_INPUT', when: 'A field is not one a bank line allows, or a value has the wrong shape.', next: 'Send only the fields listed in the schema.' },
    ],
  },
};

// --------------------------------------------------------------------------- POST /reconciliation/complete

export const completeReconciliationCommandInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  accountId: z.string().min(1),
  statementDate: DAY,
  statementBalanceCents: z.number().int(),
  reconciledTransactionIds: z.array(z.string().min(1)).max(5000).default([]),
}).strict();

export const completeReconciliationCommand: CommandDefinition<
  typeof completeReconciliationCommandInput,
  { reconciliationId: string; completedAt: string; reconciledCount: number },
  CompleteReconciliationPrepared
> = {
  name: 'reconciliations.complete',
  input: completeReconciliationCommandInput,
  roles: [...LEDGER_WRITERS],
  allowPlatformAdmin: true,
  resolveDate() { return undefined; },
  async prepare(ctx, input) {
    return prepareCompleteReconciliation(ctx.db, {
      workspaceId: ctx.workspaceId,
      accountId: input.accountId,
      statementDate: input.statementDate,
      statementBalanceCents: input.statementBalanceCents,
      reconciledTransactionIds: input.reconciledTransactionIds,
      uid: ctx.actor,
      admin: ctx.user.admin,
    });
  },
  async handler(ctx, tx, input) {
    return completeReconciliationInTransaction(
      ctx.db,
      tx,
      {
        workspaceId: ctx.workspaceId,
        accountId: input.accountId,
        statementDate: input.statementDate,
        statementBalanceCents: input.statementBalanceCents,
        reconciledTransactionIds: input.reconciledTransactionIds,
      },
      ctx.prepared as CompleteReconciliationPrepared,
      { uid: ctx.actor },
    );
  },
  async preview(ctx, input) {
    await prepareCompleteReconciliation(ctx.db, { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor, admin: ctx.user.admin });
    return {
      title: `Complete the reconciliation of ${input.accountId} as of ${input.statementDate}`,
      lines: [
        `${input.reconciledTransactionIds.length} entry(ies) marked reconciled and cleared`,
        'A reconciliation record is kept as of the statement date',
      ],
    };
  },
  audit(input, result) {
    return completeReconciliationAudit(
      { workspaceId: '', accountId: input.accountId, statementDate: input.statementDate, statementBalanceCents: input.statementBalanceCents, reconciledTransactionIds: input.reconciledTransactionIds },
      result,
    );
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Finish a bank reconciliation: keep the statement record and mark every entry it covered as reconciled and cleared; do not use it before the statement actually agrees.',
    example: { accountId: 'acc_bank', statementDate: '2026-10-31', statementBalanceCents: 125000, reconciledTransactionIds: ['tx_123'] },
    refusals: [
      { code: 'NOT_FOUND', when: 'The account or one of the entries is not in this workspace.', next: 'Use the account and entries of this workspace.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner, accountant or bookkeeper, or an entry is not this workspace\'s.', next: 'Ask an owner, accountant or bookkeeper.' },
      { code: 'INVALID_INPUT', when: 'An entry is a draft or void, or the statement date is not a date.', next: 'Pick posted entries and a real statement date.' },
      { code: 'PERIOD_LOCKED', when: 'The statement date falls in a closed period.', next: 'Use a statement date in an open period.' },
    ],
  },
};

// --------------------------------------------------------------------------- POST /bank-lines/:id/pay

export const bankLinePayInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  id: z.string().min(1).max(200),
  bankAccountId: z.string().min(1).optional(),
  allocations: z.array(z.object({
    documentId: z.string().min(1),
    amountCents: z.number().int().positive(),
  })).min(1).max(100),
}).strict();

export const bankLinePayCommand: CommandDefinition<typeof bankLinePayInput, { paymentId: string; transactionId: string; unappliedCents: number }, PayFromBankLinePrepared> = {
  name: 'reconciliations.banklinepay',
  input: bankLinePayInput,
  roles: [...LEDGER_WRITERS],
  async prepare(ctx, input) {
    return preparePayFromBankLine({
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      bankLineId: input.id,
      bankAccountId: input.bankAccountId,
      allocations: input.allocations,
    });
  },
  async handler(ctx, tx, input) {
    const { record, result } = await payFromBankLineInTransaction(
      ctx.db,
      tx,
      {
        workspaceId: ctx.workspaceId,
        uid: ctx.actor,
        bankLineId: input.id,
        bankAccountId: input.bankAccountId,
        allocations: input.allocations,
      },
      ctx.prepared as PayFromBankLinePrepared,
    );
    // the receipt and the notice go out after the books commit, never inside a retryable callback
    ctx.afterCommit(async () => { await afterPaymentRecorded(ctx.db, record, ctx.actor); });
    return result;
  },
  async preview(ctx, input) {
    preparePayFromBankLine({
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      bankLineId: input.id,
      bankAccountId: input.bankAccountId,
      allocations: input.allocations,
    });
    const total = input.allocations.reduce((sum, a) => sum + a.amountCents, 0);
    return {
      title: `Pay ${input.allocations.length} document(s) with bank line ${input.id}`,
      lines: [
        `${input.allocations.map(a => a.documentId).join(', ')}`,
        `Allocated ${total} cents`,
        'A payment entry is posted and the bank line is marked matched',
      ],
    };
  },
  audit(input, result) {
    return {
      action: 'BANK_LINE_PAID',
      entityType: 'bank_line',
      entityId: input.id,
      description: `Paid ${input.allocations.length} document(s) with bank line ${input.id}`,
      details: { paymentId: result.paymentId, transactionId: result.transactionId, unappliedCents: result.unappliedCents },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Pay one or more invoices or bills with a deposit a bank line brought in; do not use it to spread a line over accounts — that is reconciliations.banklinesplit.',
    example: { id: 'bankline_123', allocations: [{ documentId: 'invoice_123', amountCents: 5000 }] },
    refusals: [
      { code: 'NOT_FOUND', when: 'The bank line is not in this workspace.', next: 'Sync the feed again or check the line id.' },
      { code: 'CONFLICT', when: 'The line is already matched, or it is in another currency.', next: 'Pick a pending line in the books\' currency.' },
      { code: 'INVALID_INPUT', when: 'The documents are not all for the same customer or vendor, or they add up to more than the line.', next: 'Allocate at most the line\'s amount to one party.' },
    ],
  },
};

// --------------------------------------------------------------------------- POST /bank-lines/:id/split

export const bankLineSplitInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  id: z.string().min(1).max(200),
  bankAccountId: z.string().min(1).optional(),
  splits: z.array(z.object({
    accountId: z.string().min(1),
    amountCents: z.number().int().positive(),
    description: z.string().max(500).optional(),
  })).min(1).max(50),
}).strict();

export const bankLineSplitCommand: CommandDefinition<typeof bankLineSplitInput, { transactionId: string }, SplitBankLinePrepared> = {
  name: 'reconciliations.banklinesplit',
  input: bankLineSplitInput,
  roles: [...LEDGER_WRITERS],
  async prepare(ctx, input) {
    return prepareSplitBankLine({
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      bankLineId: input.id,
      bankAccountId: input.bankAccountId,
      splits: input.splits,
    });
  },
  async handler(ctx, tx, input) {
    return splitBankLineInTransaction(
      ctx.db,
      tx,
      {
        workspaceId: ctx.workspaceId,
        uid: ctx.actor,
        bankLineId: input.id,
        bankAccountId: input.bankAccountId,
        splits: input.splits,
      },
      ctx.prepared as SplitBankLinePrepared,
    );
  },
  async preview(ctx, input) {
    prepareSplitBankLine({
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      bankLineId: input.id,
      bankAccountId: input.bankAccountId,
      splits: input.splits,
    });
    const total = input.splits.reduce((sum, s) => sum + s.amountCents, 0);
    return {
      title: `Split bank line ${input.id} over ${input.splits.length} account(s)`,
      lines: [
        ...input.splits.map(s => `${s.accountId}: ${s.amountCents} cents`),
        `Total ${total} cents`,
        'One entry is posted and the line is marked matched',
      ],
    };
  },
  audit(input, result) {
    return {
      action: 'BANK_LINE_SPLIT',
      entityType: 'bank_line',
      entityId: input.id,
      description: `Split bank line ${input.id} over ${input.splits.length} account(s)`,
      details: { transactionId: result.transactionId, accounts: input.splits.map(s => s.accountId) },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Spread one bank line over several accounts, such as a card payment that is part supplies and part fuel; do not use it to pay an invoice — that is reconciliations.banklinepay.',
    example: { id: 'bankline_123', splits: [{ accountId: 'acc_supplies', amountCents: 3000 }, { accountId: 'acc_fuel', amountCents: 2000 }] },
    refusals: [
      { code: 'NOT_FOUND', when: 'The bank line is not in this workspace.', next: 'Sync the feed again or check the line id.' },
      { code: 'CONFLICT', when: 'The line is already matched, or it is in another currency.', next: 'Pick a pending line in the books\' currency.' },
      { code: 'INVALID_INPUT', when: 'The splits do not add up to the line, or one names the bank account itself.', next: 'Make the splits add up to the line and use another account.' },
    ],
  },
};

// --------------------------------------------------------------------------- POST /bank-lines/apply-rules

export const bankRulesRerunInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  after: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
}).strict();

export const bankRulesRerunCommand: CommandDefinition<typeof bankRulesRerunInput, { checked: number; changed: number; suggested: number; truncated: boolean; nextCursor?: string }, { workspace: Record<string, unknown> }> = {
  name: 'reconciliations.bankrules',
  input: bankRulesRerunInput,
  roles: ['owner', 'accountant'],
  async prepare(ctx) {
    return prepareRerunBankRules(ctx.db, { workspaceId: ctx.workspaceId, uid: ctx.actor });
  },
  async handler(ctx, tx, input) {
    // #796: the chunks run in the runner's transaction, so a retry cannot lose the change count or the audit line
    try {
      const result = await rerunBankRules(ctx.db, {
        workspaceId: ctx.workspaceId,
        uid: ctx.actor,
        ...(input.after !== undefined ? { after: input.after } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      }, tx);
      return result;
    } catch (error) {
      if (error instanceof BankRuleError) throw error;
      throw error;
    }
  },
  async preview(ctx, input) {
    await prepareRerunBankRules(ctx.db, { workspaceId: ctx.workspaceId, uid: ctx.actor });
    return {
      title: 'Run the bank rules again',
      lines: [
        'The pending lines get fresh suggestions',
        'Only lines without a match change',
        ...(input.after ? [`From ${input.after}`] : []),
        ...(input.limit ? [`At most ${input.limit} lines`] : []),
      ],
    };
  },
  audit(_input, result) {
    return result.changed === 0
      ? null
      : {
        action: 'BANK_RULES_RERUN',
        entityType: 'bank_line',
        entityId: '',
        description: `Ran the bank rules again: ${result.changed} of ${result.checked} line(s) changed`,
        details: { checked: result.checked, changed: result.changed, suggested: result.suggested },
      };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Run the workspace\'s bank rules again over the pending lines to refresh their suggestions; it only suggests, so do not use it to match a line.',
    example: { limit: 200 },
    refusals: [
      { code: 'FORBIDDEN', when: 'The caller is not an owner or an accountant.', next: 'Ask an owner or an accountant.' },
      { code: 'NOT_FOUND', when: 'The workspace is not found.', next: 'Check the workspace id.' },
    ],
  },
};

/** Every reconciliation command this batch registers. */
export const RECONCILIATION_COMMANDS = [
  reconcileCommand,
  clearEntriesCommand,
  updateBankLineCommand,
  completeReconciliationCommand,
  bankLinePayCommand,
  bankLineSplitCommand,
  bankRulesRerunCommand,
];
