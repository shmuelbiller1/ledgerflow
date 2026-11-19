import { z } from 'zod';
import { BankLineImportSchema, TransactionSchema } from '../../schemas';
import type { Transaction } from '../../types';
import { BulkRefusal, prepareLedgerBulkCommit, type BulkResult, type PreparedLedgerBulkCommit } from '../services/ledgerBulkCommit';
import { documentPostedByServer } from '../services/serverPostedDocuments';
import { CommandRefusal } from '../utils/commandExecutor';
import { requestPayloadHash } from '../utils/idempotency';
import type { CommandContext, CommandDefinition } from './types';

const legacyInputSchema = z.object({
  workspaceId: z.string().optional(),
  // TransactionValidator supplies the canonical uid/workspace, derives totals and validates the
  // full ledger schema. Retain the original submitted rows, including those server-owned fields.
  transactions: z.array(z.record(z.string(), z.unknown())).optional(),
  bankLines: BankLineImportSchema.extend({
    importIdentity: BankLineImportSchema.shape.importIdentity.describe('Source fingerprint used to skip previously imported statement lines'),
  }).array().max(5000).nullish(),
  entityMutation: z.object({
    collection: z.string(),
    docId: z.string(),
    action: z.enum(['create', 'delete', 'update']),
    data: z.record(z.string(), z.unknown()).optional(),
  }).nullish(),
  postingDay: z.string().optional().describe('Legacy browser day; does not affect the operation fingerprint'),
});
// Named callers get a typed journal schema. Keep the existing adapter's input coercion and
// normalization: the legacy route has always validated its raw rows in TransactionValidator.
const inputSchema = legacyInputSchema.extend({
  transactions: TransactionSchema.omit({ uid: true, totalAmountCents: true }).extend({
    workspaceId: TransactionSchema.shape.workspaceId.optional(),
    lines: TransactionSchema.shape.lines.min(2),
  }).array().optional(),
});
type Input = z.output<typeof legacyInputSchema>;
type Result = BulkResult & { bankLineCount: number };
type Context = Pick<CommandContext, 'db' | 'user' | 'workspaceId'>;

function prepareBulk(ctx: Context, input: Input, legacy?: { idempotencyKey?: string; hashOf: unknown }) {
  const doc = documentPostedByServer({ ...input, entityMutation: input.entityMutation ?? undefined });
  if (doc) throw new BulkRefusal(400, { error: `${doc} are saved and posted by the server: POST /api/v1/documents/:type/:id/post with the document` });
  return prepareLedgerBulkCommit(ctx.db, ctx.user, {
    workspaceId: ctx.workspaceId,
    bankLines: input.bankLines,
    transactions: input.transactions as Transaction[] | undefined,
    entityMutation: input.entityMutation ?? undefined,
  }, legacy);
}

export const ledgerBulkCommand: CommandDefinition<typeof inputSchema, Result, PreparedLedgerBulkCommit> = {
  name: 'journal.bulk',
  input: inputSchema,
  roles: ['owner', 'accountant', 'bookkeeper'],
  allowPlatformAdmin: true,
  async authorizeInput(ctx, input) {
    if (input.transactions?.some(entry => entry.workspaceId !== undefined && entry.workspaceId !== ctx.workspaceId)) {
      throw new CommandRefusal('Entry workspaceId must match the command workspace', 400, 'WORKSPACE_MISMATCH');
    }
  },
  idempotencyHash(_ctx, input) {
    const { postingDay: _day, ...hashed } = input;
    return requestPayloadHash(hashed);
  },
  prepare: prepareBulk,
  async handler(ctx, tx) {
    const plan = ctx.prepared as PreparedLedgerBulkCommit;
    const result = await plan.execute({ transaction: tx, afterCommit: ctx.afterCommit });
    return { ...result, bankLineCount: result.committed ? plan.bankLineCount : 0 };
  },
  async preview(ctx, input) {
    const plan = await prepareBulk(ctx, input);
    return {
      title: 'Post a batch of entries and statement lines',
      lines: [`${plan.transactions.length} ledger entries and ${plan.bankLineCount} new bank lines after duplicate checks.`,
        ...(input.entityMutation ? [`${input.entityMutation.action} ${input.entityMutation.collection}/${input.entityMutation.docId}`] : [])],
      accounts: plan.transactions.flatMap(entry => entry.lines.map(line => ({ accountId: line.accountId, amountCents: line.amountCents, description: line.description }))),
    };
  },
  audit(input, result) {
    if (!result.committed) return null;
    return {
      action: 'LEDGER_BULK_POSTED', entityType: input.entityMutation?.collection || 'transactions', entityId: input.entityMutation?.docId || result.transactions[0]?.id || '',
      description: `Saved ${result.transactions.length} ledger entries and ${result.bankLineCount} bank lines`,
      details: { postingCount: result.transactions.length, bankLineCount: result.bankLineCount, entityAction: input.entityMutation?.action },
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Post journal entries and import statement lines together; never send invoice, bill or credit postings here because the document commands build them on the server.',
    example: { transactions: [{ date: '2026-10-15', type: 'journal', lines: [{ accountId: 'rent', amountCents: 500 }, { accountId: 'bank', amountCents: -500 }] }] },
    refusals: [
      { code: 'PERIOD_LOCKED', when: 'An entry is dated in a closed period.', next: 'Use an open date or ask an owner to review the close.' },
      { code: 'INVALID_INPUT', when: 'The batch or a statement line is malformed.', next: 'Check the batch input and try again.' },
      { code: 'WORKSPACE_MISMATCH', when: 'An entry names a different workspace from the command envelope.', next: 'Send only entries for the workspace being posted to.' },
      { code: 'CONFLICT', when: 'An entry already exists, a period closed, a budget blocks the posting, or the operation key belongs to a different request.', next: 'Reload the books, review the conflict and retry only the entries that still need posting.' },
    ],
  },
};

/** Bind the old, shared ledger retry protocol only at the original HTTP boundary. */
export function ledgerBulkWithLegacyKey(idempotencyKey: string | undefined, legacy: { hashOf: unknown }): CommandDefinition<typeof legacyInputSchema, Result, PreparedLedgerBulkCommit> {
  return {
    ...ledgerBulkCommand,
    input: legacyInputSchema,
    // The legacy ledger middleware checks every workspace mentioned by the request; preflight
    // then stamps every row with the inferred workspace, as that API has always done.
    authorizeInput: undefined,
    prepare: (ctx, input) => prepareBulk(ctx, input, { ...legacy, idempotencyKey }),
  };
}
