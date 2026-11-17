/**
 * Writes that act on many journal entries at once, on `/api/v1/transactions`.
 *
 * These two rules move money or change an entry's accounts, and each already had its own reviewed
 * transaction in place: `recategorizeService` (D-3/K-39) refuses the whole batch if one entry cannot
 * move, and `/batch` reads and checks every entry before writing any. Both keep that transaction; the
 * command is the registered door — one name, one schema, the roles, a read-only preview, and the
 * runner's workspace and role checks in one order.
 *
 * Neither declares `dated`: the entry's own date decides the period lock, inside the transaction that
 * reads it, and a batch may touch entries in several months.
 */
import { z } from 'zod';
import { MAX_RECATEGORIZE, recategorize } from '../services/recategorizeService';
import { RULE_MAX, batchProblem, batchWrites } from '../services/ledgerBatchUpdate';
import type { AnyCommandDefinition, CommandDefinition } from './types';

const WRITERS = ['owner', 'accountant', 'bookkeeper'] as const;
const id = z.string().min(1).max(200);

// --------------------------------------------------------------------------- recategorize

export const transactionsRecategorizeInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  changes: z.array(z.object({
    id,
    bankAccountId: id,
    toAccountId: id,
    /** the version the person saw; a newer entry is refused rather than silently overlaid */
    expectedUpdatedAt: z.string().optional(),
  }).strict()).min(1).max(MAX_RECATEGORIZE),
}).strict();

export const transactionsRecategorizeCommand: CommandDefinition<typeof transactionsRecategorizeInput, Record<string, unknown>> = {
  name: 'journal.recategorize',
  input: transactionsRecategorizeInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input) {
    return recategorize(ctx.db, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, changes: input.changes,
    }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    const accounts = [...new Set(input.changes.map(change => change.toAccountId))];
    return {
      title: `Move ${input.changes.length} ${input.changes.length === 1 ? 'entry' : 'entries'} to another account`,
      lines: [
        `To ${accounts.length === 1 ? accounts[0] : `${accounts.length} accounts`}`,
        'The bank side stays where it is; all of them move or none',
      ],
      accounts: input.changes.map(change => ({ accountId: change.toAccountId, amountCents: 0, description: `Entry ${change.id}` })),
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Move the non-bank side of cleared bank entries to another account, all of them or none; do not use it to change an amount or a date — that is a journal edit.',
    example: { changes: [{ id: 'tx_123', bankAccountId: 'acc_bank', toAccountId: 'acc_office' }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'No change is named, one is listed twice, or more than the limit is sent at once.', next: `Send up to ${MAX_RECATEGORIZE} distinct entries.` },
      { code: 'CONFLICT', when: 'An entry moved on since it was read, or one is in a closed period.', next: 'Reload the entry and try again in an open period.' },
      { code: 'FORBIDDEN', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};

// --------------------------------------------------------------------------- batch

const cents = z.number().int();
const batchFields = z.object({
  lines: z.array(z.object({
    accountId: id,
    accountName: z.string().max(200).optional(),
    amountCents: cents,
    description: z.string().max(500).optional(),
    dimensions: z.record(z.string().max(64), z.string().max(120)).optional(),
  }).strict()).optional(),
  description: z.string().max(500).optional(),
  status: z.string().max(40).optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
  metadata: z.record(z.string().max(64), z.unknown()).optional(),
  classId: z.string().max(200).nullable().optional(),
  locationId: z.string().max(200).nullable().optional(),
  projectId: z.string().max(200).nullable().optional(),
  dimensions: z.record(z.string().max(64), z.string().max(120)).optional(),
  category: z.string().max(200).optional(),
  isLocked: z.boolean().optional(),
  isFlagged: z.boolean().optional(),
  isReviewed: z.boolean().optional(),
  isCleared: z.boolean().optional(),
  reconciled: z.boolean().optional(),
  isReconciled: z.boolean().optional(),
  reconciledAt: z.string().max(40).nullable().optional(),
  isTransfer: z.boolean().optional(),
  transferDetails: z.record(z.string().max(64), z.unknown()).optional(),
  verification: z.record(z.string().max(64), z.unknown()).optional(),
  notes: z.string().max(4000).optional(),
  memo: z.string().max(4000).optional(),
  updatedAt: z.string().max(40).optional(),
  expectedUpdatedAt: z.string().max(40).optional(),
}).strict();

export const transactionsBatchInput = z.object({
  workspaceId: z.string().min(1).max(200),
  updates: z.array(z.object({ id, data: batchFields }).strict()).min(1).max(RULE_MAX),
}).strict();

export const transactionsBatchCommand: CommandDefinition<typeof transactionsBatchInput, { updated: number }> = {
  name: 'journal.batchupdate',
  input: transactionsBatchInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input) {
    const problem = batchProblem(input.updates);
    if (problem) throw Object.assign(new Error(problem), { status: 400 });
    // read and checked one by one, then written in one transaction by the service
    return batchWrites(ctx.db, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, admin: Boolean(ctx.user.admin),
    }, input.updates);
  },
  async preview(_ctx, input) {
    return {
      title: `Change ${input.updates.length} ${input.updates.length === 1 ? 'entry' : 'entries'}`,
      lines: [
        'Only notes, labels, flags, dimensions and the review state change in a batch',
        'Totals, dates and currency go through the entry editor, and a version conflict leaves every entry unchanged',
      ],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Change the notes, labels, flags, dimensions or review state of many entries at once; do not use it to change an amount, a date or an account — that is one entry at a time in the editor.',
    example: { workspaceId: 'ws_1', updates: [{ id: 'tx_123', data: { isReviewed: true } }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The list is empty, too long, an entry is listed twice, or a field is not one a batch may change.', next: 'Send distinct entries and only the fields a batch accepts.' },
      { code: 'CONFLICT', when: 'An entry changed since it was read, or is in a closed period.', next: 'Reload and try again.' },
      { code: 'FORBIDDEN', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};

export const TRANSACTION_COMMANDS: AnyCommandDefinition[] = [
  transactionsRecategorizeCommand, transactionsBatchCommand,
];
