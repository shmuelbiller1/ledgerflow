import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import { accountParentProblem, type AccountGroupMember } from '../../lib/accountGroups';
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
async function chartOf(ctx: CommandContext): Promise<AccountGroupMember[]> {
  const rows = await ctx.db.collection('chartAccounts').where('workspaceId', '==', ctx.workspaceId).get();
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
      const problem = accountParentProblem(await chartOf(ctx), {
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
