import { z } from 'zod';
import { TransactionLineSchema, TransactionSchema } from '../../schemas';
import type { DimensionDefinition, Transaction } from '../../types';
import { getAbsoluteTotal } from '../../lib/txFilters';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { ledgerCreate } from '../services/ledgerDoor';
import { FieldValue } from '../db/firestore';
import { BudgetBlocked, budgetWarningsFor, enforceBudgetControl, type BudgetWarning } from '../services/budgetGuard';
import { refusedLabels, refusedLabelsMessage } from '../../lib/requiredLabels';
import { HttpError } from '../auth/requestUser';
import { documentPostedByServer } from '../routes/transactions/bulkRoutes';
import type { CommandContext, CommandDefinition } from './types';

const JournalEntryInputSchema = TransactionSchema.extend({
  uid: z.string().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Currency must be a valid ISO 4217 3-letter code').optional(),
  lines: z.array(TransactionLineSchema).min(2, 'At least 2 lines required').max(100),
});

export const journalCreateInput = z.object({ transaction: JournalEntryInputSchema }).strict();

type JournalInput = z.output<typeof journalCreateInput>;
type JournalPrepared = { transaction: Transaction; planned: BudgetWarning[] };
type JournalResult = { transaction: Transaction; budgetWarnings: BudgetWarning[] };

async function prepareJournal(ctx: Omit<CommandContext, 'prepared' | 'afterCommit'>, input: JournalInput): Promise<JournalPrepared> {
  const db = ctx.db;
  const raw = input.transaction;
  if (!raw.workspaceId) throw new HttpError('Invalid payload', 400);
  if (raw.workspaceId !== ctx.workspaceId) throw new HttpError('Input workspaceId must match the command workspace', 400);
  const draft = { ...raw, uid: ctx.actor } as Record<string, unknown>;
  if (!draft.totalAmountCents) draft.totalAmountCents = getAbsoluteTotal(draft as unknown as Transaction);
  const parsed = TransactionSchema.safeParse(draft);
  if (!parsed.success) throw Object.assign(new HttpError('Schema validation failed', 400), { details: parsed.error.issues });
  const docKey = documentPostedByServer({ transactions: [parsed.data] });
  if (docKey) throw new HttpError(`${docKey} are saved and posted by the server; use the document command instead of journal.create.`, 400);
  const transactionToSave = { ...parsed.data, id: parsed.data.id || db.collection('transactions').doc().id } as Transaction;
  const validated = await TransactionValidator.validateAndPrepare(transactionToSave, {
    workspaceId: transactionToSave.workspaceId,
    user: { uid: ctx.actor, admin: ctx.user.admin },
    wsData: ctx.workspace,
  });
  const dimensions = Array.isArray(ctx.workspace.dimensions) ? ctx.workspace.dimensions as DimensionDefinition[] : undefined;
  const missing = refusedLabels(validated, dimensions);
  if (missing.length > 0) throw new HttpError(refusedLabelsMessage(missing), 400);
  const planned = await budgetWarningsFor(db, validated.workspaceId, ctx.workspace, [validated]);
  return { transaction: validated, planned };
}

function accountNameFor(line: Transaction['lines'][number], accounts: Array<Record<string, unknown>>): string | undefined {
  return line.accountName || String(accounts.find(account => account.id === line.accountId)?.name || '') || undefined;
}

export const journalCreateCommand: CommandDefinition<typeof journalCreateInput, JournalResult, JournalPrepared> = {
  name: 'journal.create',
  input: journalCreateInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  dated: 'transaction.date',
  capacity: 'transactions',
  operationType: 'TRANSACTION_CREATE',
  prepare: prepareJournal,
  async handler(ctx, tx) {
    const prepared = ctx.prepared as JournalPrepared;
    const wsNow = (await tx.get(ctx.db.collection('workspaces').doc(ctx.workspaceId))).data();
    try {
      const budgetWarnings = enforceBudgetControl(wsNow, prepared.planned);
      const ref = ctx.db.collection('transactions').doc(prepared.transaction.id);
      if ((await tx.get(ref)).exists) throw new HttpError('Duplicate request processing: Transaction ID already exists', 409);
      ledgerCreate(tx, ref, {
        ...prepared.transaction,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { transaction: prepared.transaction, budgetWarnings };
    } catch (error) {
      if (error instanceof BudgetBlocked) throw Object.assign(new HttpError(error.message, 409), { code: 'OVER_BUDGET' });
      throw error;
    }
  },
  async preview(ctx, input) {
    const prepared = await prepareJournal(ctx, input);
    const tx = prepared.transaction;
    const accounts = (await ctx.db.collection('chartAccounts').where('workspaceId', '==', ctx.workspaceId).get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return {
      title: `Create journal entry ${tx.description || tx.id}`,
      lines: [String(tx.date), tx.description || 'Journal entry', `Total ${tx.totalAmountCents ?? 0} cents`],
      accounts: tx.lines.map(line => ({ accountId: line.accountId, accountName: accountNameFor(line, accounts), amountCents: line.amountCents, ...(line.description ? { description: line.description } : {}) })),
    };
  },
  audit(_input, result) {
    const tx = result.transaction;
    return {
      action: 'TRANSACTION_CREATED',
      entityType: 'transaction',
      entityId: tx.id,
      description: `Created journal entry "${tx.description || tx.id}"`,
      details: { totalAmountCents: tx.totalAmountCents, date: tx.date },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Create a balanced journal entry when recording a bookkeeping adjustment, and do not use it to issue invoices, receive payments, or bypass a source document.',
    example: { transaction: { workspaceId: 'ws_123', date: '2026-06-30', description: 'Record depreciation', lines: [{ accountId: 'acc_expense', amountCents: 10000 }, { accountId: 'acc_asset', amountCents: -10000 }] } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The entry is missing required fields, has invalid cents, or does not balance.', next: 'Correct the entry and make sure its lines add to zero.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
      { code: 'PERIOD_LOCKED', when: 'The entry date is in a closed period.', next: 'Choose an open date or ask an owner to reopen the period.' },
      { code: 'PLAN_CAPACITY_EXCEEDED', when: 'The workspace has reached its configured transaction quota.', next: 'Ask the workspace owner to review the plan limit.' },
      { code: 'OVER_BUDGET', when: 'The workspace budget control blocks the entry.', next: 'Review the budget warning or ask an owner to approve the change.' },
    ],
  },
};
