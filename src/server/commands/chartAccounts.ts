import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import { accountParentProblem, type AccountGroupMember } from '../../lib/accountGroups';
import { ChartAccountSchema } from '../../schemas';
import { assertDeveloperUsageQuota } from '../services/developerUsageQuota';
import type { CommandContext, CommandDefinition } from './types';

/**
 * One account's own fields, changed as a command instead of four `updateDoc` calls.
 *
 * `ChartOfAccountsView` renamed an account, gave it a code, a description, a category or a group, archived it and
 * brought it back; `WorkpapersPanel` wrote the month's workpaper onto the account. Each was a browser write with
 * `updatedAt` typed by the tab, no audit line, and no check beyond the screen's own — and the screen's own checks are
 * exactly the two that matter, so they moved here with the write:
 *
 * - **a system account keeps its code.** The database refuses the change for a client write; a command writes as the
 *   server, so the refusal has to be repeated here or the rule would simply not apply to the new path.
 * - **a group cannot be impossible.** Same type, no loop, at most three levels: `accountParentProblem` is the same
 *   function the picker used to filter its options, called here on the chart the server reads, so a stale tab cannot
 *   put an account inside its own child.
 *
 * Archiving is one field (`archived`) rather than two, because the two halves have to agree: an archived account is
 * inactive, and an account brought back is active. Writing them separately is how a chart ends up with an account that
 * is archived and still offered in pickers.
 *
 * What it is **not**: a posting, or a balance. `openingBalanceCents` and `balanceCents` are not in the allowlist, and
 * neither is `isSystem` — an account's balance comes from the entries that name it, and an account cannot promote
 * itself to a system account to escape this command's own rule.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');
const text = (max: number) => z.string().trim().max(max);

export const chartAccountUpdateInput = z.object({
  id: idSchema,
  name: text(200).min(1).optional(),
  code: text(40).optional(),
  description: text(2000).optional(),
  category: text(120).optional(),
  /** the group this account sits inside; `null` takes it back to the top level */
  parentId: z.string().trim().max(200).nullable().optional(),
  /** archive (hidden from pickers, history kept) or bring back; the two halves of the flag move together */
  archived: z.boolean().optional(),
  /** one month's workpaper: `{ '2026-01': { … } }`, merged per month rather than replaced */
  workpapers: z.record(z.string().regex(/^\d{4}-\d{2}$/, 'A workpaper month is YYYY-MM'), z.record(z.string(), z.unknown())).optional(),
}).strict();

/** Accounts are the shape of the books: an owner or an accountant, the same pair the database calls admin. */
const ROLES = ['owner', 'accountant'] as const;
type UpdateInput = z.output<typeof chartAccountUpdateInput>;
type AccountRow = Record<string, unknown> & { id?: string; name?: string; type?: string; isSystem?: boolean };
export type AccountSaved = { id: string; fields: string[] };

/** The chart as the grouping rule reads it: id, name, type and where each account currently sits. */
async function chartOf(ctx: CommandContext, tx?: { get: (ref: never) => Promise<unknown> }): Promise<AccountGroupMember[]> {
  const query = ctx.db.collection('chartAccounts').where('workspaceId', '==', ctx.workspaceId);
  // read through the caller's transaction when there is one, so the group check sees the chart the write will land on
  const rows = (tx
    ? await (tx.get as unknown as (ref: unknown) => Promise<unknown>)(query)
    : await query.get()) as { docs: Array<{ id: string; data: () => unknown }> };
  return rows.docs.map(doc => {
    const row = doc.data() as AccountRow;
    return {
      id: doc.id,
      name: String(row.name || ''),
      type: String(row.type || ''),
      ...(typeof row.parentId === 'string' && row.parentId ? { parentId: row.parentId } : {}),
    } as AccountGroupMember;
  });
}

export const chartAccountUpdateCommand: CommandDefinition<typeof chartAccountUpdateInput, AccountSaved> = {
  name: 'chartaccount.update',
  input: chartAccountUpdateInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: UpdateInput) {
    const { id, ...fields } = input;
    const ref = ctx.db.collection('chartAccounts').doc(id);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as AccountRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This account is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }

    const patch: Record<string, unknown> = {};
    const changed: string[] = [];

    if (fields.name !== undefined) { patch.name = fields.name; changed.push('name'); }
    if (fields.description !== undefined) { patch.description = fields.description; changed.push('description'); }
    if (fields.category !== undefined) { patch.category = fields.category; changed.push('category'); }

    if (fields.code !== undefined && fields.code !== existing.code) {
      if (existing.isSystem === true) {
        throw Object.assign(new HttpError(
          `"${String(existing.name || id)}" is a system account, so its code is part of how the books are read and cannot be changed.`,
          409,
        ), { code: 'CONFLICT' });
      }
      patch.code = fields.code;
      changed.push('code');
    }

    if (fields.parentId !== undefined) {
      const problem = accountParentProblem(await chartOf(ctx, tx as never), {
        id,
        name: fields.name || String(existing.name || ''),
        type: String(existing.type || ''),
      }, fields.parentId);
      if (problem) throw Object.assign(new HttpError(problem, 409), { code: 'CONFLICT' });
      patch.parentId = fields.parentId;
      changed.push('parentId');
    }

    if (fields.archived !== undefined) {
      patch.isArchived = fields.archived;
      patch.isActive = !fields.archived;
      changed.push('archived');
    }

    if (fields.workpapers !== undefined) {
      // merged per month: the month this screen saved is replaced, the months it never loaded are kept
      const existingWorkpapers = (existing.workpapers || {}) as Record<string, unknown>;
      patch.workpapers = { ...existingWorkpapers, ...fields.workpapers };
      changed.push('workpapers');
    }

    if (changed.length === 0) return { id, fields: [] };
    tx.update(ref, { ...patch, updatedAt: new Date().toISOString() });
    return { id, fields: changed };
  },
  async preview(ctx: CommandContext, input: UpdateInput) {
    const snapshot = await ctx.db.collection('chartAccounts').doc(input.id).get();
    const existing = snapshot.data() as AccountRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This account is not in the selected workspace.', 404);
    }
    return {
      title: `Change ${String(existing?.name || input.id)}`,
      lines: Object.keys(input).filter(key => key !== 'id').map(key => `Sets ${key}`),
    };
  },
  audit(_input: UpdateInput, result: AccountSaved) {
    return {
      action: 'CHART_ACCOUNT_UPDATED',
      entityType: 'chartAccounts',
      entityId: result.id,
      description: result.fields.length ? `Changed ${result.fields.join(', ')} on account ${result.id}` : `Saved account ${result.id} with no change`,
      details: { fields: result.fields },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Change one account\'s name, code, description, category, group, archived state or workpapers; do not use it to change a balance, which comes from the entries that name the account.',
    example: { id: 'acct_rent', name: 'Rent', parentId: 'grp_expenses' },
    refusals: [
      { code: 'CONFLICT', when: 'The code of a system account is being changed, or the group would be the wrong type, a loop, or more than three levels deep.', next: 'Leave a system account\'s code alone, and put the account in a group of its own type.' },
      { code: 'INVALID_INPUT', when: 'The payload names a field the account does not keep (a balance or `isSystem` is one), or a workpaper month is not YYYY-MM.', next: 'Send only the account\'s own fields.' },
      { code: 'NOT_FOUND', when: 'The account is not in the selected workspace.', next: 'Reload the chart and choose an account in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or an accountant.', next: 'Ask a workspace owner or accountant to change the chart.' },
    ],
    next: [{ command: 'workspace.dimensionnode', label: 'Change what the labels say' }],
  },
};

/**
 * A new account in the chart.
 *
 * `Ledger`'s "add account" form wrote the row with `addDoc`: it typed `createdAt` and `asOfDate`, sent whatever
 * `type` the select box held, and — because nothing on the server looked — a code that was already in the chart
 * could be added a second time, which makes every report that groups by code read two accounts as one.
 *
 * Two things it promises that the browser write could not:
 *
 * - **the code is unique inside the workspace.** The check runs against the chart the server reads, so two tabs
 *   adding the same code cannot both succeed; the second is a `CONFLICT` naming the account that already has it.
 * - **the row starts where an account starts.** `balanceCents` and `openingBalanceCents` are written as zero by the
 *   command, not sent by the form: an account's balance comes from the entries that name it, and an opening figure
 *   is a transaction (the screen records it as one, in the same flow).
 */
export const chartAccountCreateInput = z.object({
  code: text(40).min(1),
  name: text(200).min(1),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  category: text(120).optional(),
  description: text(2000).optional(),
  parentId: z.string().trim().max(200).nullable().optional(),
  /** the date the account is opened, as the row keeps it; the server stamps `createdAt` */
  asOfDate: z.string().trim().max(40).optional(),
}).strict();

type CreateInput = z.output<typeof chartAccountCreateInput>;
export type AccountCreated = { id: string; code: string; name: string; created: boolean };

export const chartAccountCreateCommand: CommandDefinition<typeof chartAccountCreateInput, AccountCreated> = {
  name: 'chartaccount.create',
  input: chartAccountCreateInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: CreateInput) {
    // read through the transaction, not before it: two tabs adding the same code at once both see an empty chart
    // otherwise, and both write — which is precisely the duplicate this check exists to prevent
    const existing = await tx.get(ctx.db.collection('chartAccounts')
      .where('workspaceId', '==', ctx.workspaceId)
      .where('code', '==', input.code)
      .limit(1));
    if (!existing.empty) {
      const clash = existing.docs[0].data() as AccountRow;
      throw Object.assign(new HttpError(
        `Code ${input.code} is already used by "${String(clash.name || existing.docs[0].id)}" in this chart.`,
        409,
      ), { code: 'CONFLICT' });
    }
    if (input.parentId) {
      const chart = await chartOf(ctx, tx);
      const problem = accountParentProblem(chart, { id: '', name: input.name, type: input.type }, input.parentId);
      if (problem) throw Object.assign(new HttpError(problem, 409), { code: 'CONFLICT' });
    }
    const now = new Date().toISOString();
    const ref = ctx.db.collection('chartAccounts').doc();
    const id = (ref as unknown as { id: string }).id;
    tx.set(ref, {
      id,
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      code: input.code,
      name: input.name,
      type: input.type,
      category: input.category || input.type,
      description: input.description || '',
      parentId: input.parentId || null,
      openingBalanceCents: 0,
      balanceCents: 0,
      asOfDate: input.asOfDate || now,
      createdAt: now,
      updatedAt: now,
    });
    return { id, code: input.code, name: input.name, created: true };
  },
  async preview(ctx: CommandContext, input: CreateInput) {
    const existing = await ctx.db.collection('chartAccounts')
      .where('workspaceId', '==', ctx.workspaceId)
      .where('code', '==', input.code)
      .limit(1)
      .get();
    if (!existing.empty) throw new HttpError(`Code ${input.code} is already used in this chart.`, 409);
    return {
      title: `Add the account ${input.code} ${input.name}`,
      lines: [input.type, `opens at zero on ${input.asOfDate || 'today'}`],
    };
  },
  audit(_input: CreateInput, result: AccountCreated) {
    return {
      action: 'ACCOUNT_CREATED',
      entityType: 'chartAccounts',
      entityId: result.id,
      description: `Added the account ${result.code} ${result.name}`,
      details: { code: result.code, name: result.name },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Add one account to the chart; do not use it to open an account with a balance — an opening figure is a transaction, and the account itself starts at zero.',
    example: { code: '1010', name: 'Checking', type: 'asset', category: 'Assets' },
    refusals: [
      { code: 'CONFLICT', when: 'The code is already used in this chart, or the group would be the wrong type, a loop or more than three levels deep.', next: 'Choose a free code, or put the account in a group of its own type.' },
      { code: 'INVALID_INPUT', when: 'There is no code, no name, or the type is not one of the five the books use.', next: 'Send a code, a name and asset, liability, equity, revenue or expense.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or an accountant.', next: 'Ask a workspace owner or accountant to add the account.' },
    ],
    next: [{ command: 'chartaccount.update', label: 'Rename it or give it a description' }],
  },
};

/**
 * An empty account taken off the chart.
 *
 * `workspaceActions` deleted the row and then wrote its own audit line from the tab — the account gone, and the record
 * of who removed it stamped by the browser. The refusal that matters it did not have: an account is only deletable
 * while **nothing names it**. A transaction line, a bank-feed rule, a budget, a starting balance — any of them would
 * be left pointing at an account that no longer exists, and the reports would silently total one account short.
 *
 * So the check runs on the server, over the collections that hold an account reference, inside the transaction that
 * deletes: either the account had no entries a moment ago and is gone, or it has one and is archived instead. Archiving
 * exists for exactly that case, and the command says so in its refusal.
 */
export const chartAccountDeleteInput = z.object({ id: idSchema }).strict();
type DeleteInput = z.output<typeof chartAccountDeleteInput>;
export type AccountRemoved = { id: string; name: string };

/** The collections whose rows point at an account, and the field each one uses. */
const ACCOUNT_REFERENCES: ReadonlyArray<{ collection: string; fields: readonly string[] }> = [
  { collection: 'transactions', fields: ['accountId', 'categoryId', 'fromAccountId', 'toAccountId'] },
  { collection: 'journalEntries', fields: ['accountId'] },
  { collection: 'budgets', fields: ['accountId'] },
  { collection: 'billLines', fields: ['accountId'] },
  { collection: 'invoiceLines', fields: ['accountId'] },
  { collection: 'bankRules', fields: ['accountId'] },
];

export const chartAccountDeleteCommand: CommandDefinition<typeof chartAccountDeleteInput, AccountRemoved> = {
  name: 'chartaccount.delete',
  input: chartAccountDeleteInput,
  roles: ['owner', 'accountant'],
  async handler(ctx: CommandContext, tx, input: DeleteInput) {
    const ref = ctx.db.collection('chartAccounts').doc(input.id);
    const snapshot = await tx.get(ref);
    const account = snapshot.data() as AccountRow | undefined;
    if (!snapshot.exists || (account as Record<string, unknown>)?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This account is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    if (account?.isSystem) {
      throw Object.assign(new HttpError('A system account cannot be deleted; archive it instead.', 409), { code: 'CONFLICT' });
    }
    for (const { collection, fields } of ACCOUNT_REFERENCES) {
      const rows = await ctx.db.collection(collection).where('workspaceId', '==', ctx.workspaceId).get();
      const named = rows.docs.find(doc => {
        const row = doc.data() as Record<string, unknown>;
        return fields.some(field => row[field] === input.id);
      });
      if (named) {
        throw Object.assign(
          new HttpError(`This account is named by ${collection}, so it cannot be deleted. Archive it instead.`, 409),
          { code: 'CONFLICT' },
        );
      }
    }
    const name = String(account?.name || '');
    tx.delete(ref);
    return { id: input.id, name };
  },
  async preview(ctx: CommandContext, input: DeleteInput) {
    const snapshot = await ctx.db.collection('chartAccounts').doc(input.id).get();
    const account = snapshot.data() as AccountRow | undefined;
    if (!snapshot.exists) throw new HttpError('This account is not in the selected workspace.', 404);
    return {
      title: `Delete the account ${String(account?.code || '')} ${String(account?.name || '')}`,
      lines: ['This cannot be undone — it is only allowed while nothing names the account.'],
    };
  },
  audit(_input: DeleteInput, result: AccountRemoved) {
    return {
      action: 'DELETE_EMPTY_ACCOUNT',
      entityType: 'account',
      entityId: result.id,
      description: `Deleted the empty account ${result.name}`,
      details: { name: result.name },
    };
  },
  inverse() { return null; },
  risk: 'high',
  describe: {
    sentence: 'Delete an account that nothing names; do not use it to retire an account that has history — archiving keeps the history and hides the account from pickers.',
    example: { id: 'acc-1010' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The account is not in the selected workspace.', next: 'Reload the chart and choose an account in this workspace.' },
      { code: 'CONFLICT', when: 'The account is a system account, or a transaction, entry, budget, line or rule names it.', next: 'Archive the account instead — chartaccount.update with archived: true.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or an accountant.', next: 'Ask a workspace owner or accountant to delete the account.' },
    ],
    next: [{ command: 'chartaccount.update', label: 'Archive it instead' }],
  },
};

// The developer POST predates chartaccount.create: it accepts an integration-supplied ID, more
// account types, and optional codes. It registers metadata only, it does not set an opening balance.
const chartAccountRegisterInput = ChartAccountSchema.omit({ workspaceId: true, uid: true }).extend({
  parentId: z.string().describe('ID of the account group').nullable().optional().describe('Null or omitted for a top-level account'),
  balanceCents: ChartAccountSchema.shape.balanceCents.describe('Accepted for legacy callers but does not set the ledger balance'),
  openingBalanceCents: ChartAccountSchema.shape.openingBalanceCents.describe('Accepted for legacy callers; use a journal to post an opening balance'),
});
type RegisteredAccount = {
  id: string; workspaceId: string; name: string; type: string; code: string; parentId: string | null;
  isActive: boolean; tags: string[]; createdAt: string;
};

function accountIdConflict() {
  return Object.assign(new HttpError('Chart account ID already exists', 409), { code: 'CONFLICT' });
}

export const chartAccountRegisterCommand: CommandDefinition<typeof chartAccountRegisterInput, { account: RegisteredAccount }> = {
  name: 'chartaccount.register',
  input: chartAccountRegisterInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  allowPlatformAdmin: true,
  async authorizeInput(ctx) {
    if (!ctx.user.admin) await assertDeveloperUsageQuota(ctx.db, ctx.workspaceId, ctx.workspace);
  },
  async handler(ctx, tx, input) {
    const id = input.id || `acc_${randomUUID().replace(/-/g, '')}`;
    const ref = ctx.db.collection('chartAccounts').doc(id);
    if ((await tx.get(ref)).exists) throw accountIdConflict();
    const account = {
      id, workspaceId: ctx.workspaceId, name: input.name, type: input.type, code: input.code || '',
      parentId: input.parentId || null, isActive: input.isActive ?? true, tags: input.tags || [], createdAt: new Date().toISOString(),
    };
    tx.create(ref, account);
    return { account };
  },
  async preview(ctx, input) {
    if (input.id && (await ctx.db.collection('chartAccounts').doc(input.id).get()).exists) throw accountIdConflict();
    return { title: `Register the account “${input.name}”`, lines: [input.type, 'Adds chart metadata only; no opening balance is set.'] };
  },
  audit(_input, { account }) {
    return {
      action: 'ACCOUNT_CREATED', entityType: 'chart_account', entityId: account.id,
      description: `Created chart account "${account.name}" (${account.type})`, details: { code: account.code, type: account.type },
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Register an account from a developer integration, optionally with a caller-chosen identifier; use chartaccount.create for the chart form’s code and grouping checks, and never use this to set an opening balance.',
    example: { id: 'acc_integration_cash', name: 'Cash', type: 'asset', code: '1000' },
    refusals: [
      { code: 'CONFLICT', when: 'The requested ID is already taken.', next: 'Use a new ID, or read the chart before retrying.' },
      { code: 'INVALID_INPUT', when: 'The name, type or other account fields do not pass validation.', next: 'Check the chart account schema.' },
      { code: 'PAYMENT_REQUIRED', when: 'The developer API credit balance is exhausted.', next: 'Restore the workspace credit balance before registering accounts.' },
      { code: 'QUOTA_EXCEEDED', when: 'The developer API spending limit was reached.', next: 'Ask the workspace administrator to review the limit before importing the chart.' },
    ],
  },
};
