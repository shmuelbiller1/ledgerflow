import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { CommandContext, CommandDefinition } from './types';

/**
 * A budget line: the amount a person plans to spend on one account in one cycle.
 *
 * `BudgetManager` wrote the row itself — `addDoc` for a new objective, `updateDoc` for a changed one, `deleteDoc` for
 * a removed one — and typed `createdAt`/`updatedAt` from the tab it happened in. That was the last write in planning,
 * and the three of them have one shape, so they are one command family:
 *
 * - `budget.save` writes a new objective (no `id`) or changes an existing one (`id`), and refuses an id that is not in
 *   the selected workspace instead of creating a second row with that id;
 * - `budget.delete` removes the row, and refuses one that belongs to another workspace.
 *
 * What it is **not**: a posting. A budget is a plan; nothing here writes a transaction, changes an account's balance
 * or moves a figure in any report. The comparison a report makes between plan and actual is computed from the budget
 * rows and the postings, and this command only ever touches the first — the sentence the screen already told people.
 *
 * A viewer may read the objectives and not change them, which is the rule the button was hidden by; the refusal is
 * the server's now, so hiding the button is a courtesy rather than the guard.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');

const PERIODS = ['monthly', 'quarterly', 'yearly'] as const;
const TARGET_TYPES = ['account', 'label'] as const;
/** Roles that may change a plan: everyone who keeps the books, and not a viewer. */
const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;

export const budgetSaveInput = z.object({
  /** present when an existing objective is changed; absent when a new one is written */
  id: idSchema.optional(),
  targetId: z.string().trim().min(1).max(200),
  targetType: z.enum(TARGET_TYPES).default('account'),
  /** whole cents, never a float: a plan is compared with posted amounts, which are cents */
  amountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  period: z.enum(PERIODS),
  /** the day the cycle starts, `YYYY-MM-DD`; the screen fills today when the person leaves it empty */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A start date is YYYY-MM-DD'),
  /** the label the plan is kept against (EU-E5); `null` takes an existing one away */
  label: z.object({ dimensionId: z.string().trim().min(1).max(120), value: z.string().trim().min(1).max(200) }).strict().nullable().optional(),
}).strict();

export const budgetDeleteInput = z.object({ id: idSchema }).strict();

type SaveInput = z.output<typeof budgetSaveInput>;
type DeleteInput = z.output<typeof budgetDeleteInput>;
type BudgetRow = Record<string, unknown> & { id?: string; metadata?: Record<string, unknown> };

export type BudgetSaveResult = { id: string; targetId: string; amountCents: number; period: string; created: boolean };

/** The metadata a saved plan carries: whatever an existing row had, with the label set, changed or taken away. */
function metadataWithLabel(existing: Record<string, unknown> | undefined, label: SaveInput['label']): Record<string, unknown> {
  const { label: _previous, ...rest } = existing || {};
  if (label === undefined) return existing || rest;
  return label === null ? rest : { ...rest, label: { dimensionId: label.dimensionId, value: label.value } };
}

export const budgetSaveCommand: CommandDefinition<typeof budgetSaveInput, BudgetSaveResult> = {
  name: 'budget.save',
  input: budgetSaveInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: SaveInput) {
    const now = new Date().toISOString();
    const row = {
      targetId: input.targetId,
      targetType: input.targetType,
      amountCents: input.amountCents,
      period: input.period,
      startDate: input.startDate,
      metadata: metadataWithLabel(undefined, input.label),
      updatedAt: now,
    };
    if (!input.id) {
      const ref = ctx.db.collection('budgets').doc();
      const id = (ref as unknown as { id: string }).id;
      tx.set(ref, { ...row, id, workspaceId: ctx.workspaceId, uid: ctx.actor, createdAt: now });
      return { id, targetId: input.targetId, amountCents: input.amountCents, period: input.period, created: true };
    }
    const ref = ctx.db.collection('budgets').doc(input.id);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as BudgetRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This objective is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    tx.update(ref, { ...row, metadata: metadataWithLabel(existing.metadata, input.label) });
    return { id: input.id, targetId: input.targetId, amountCents: input.amountCents, period: input.period, created: false };
  },
  async preview(ctx: CommandContext, input: SaveInput) {
    if (input.id) {
      const snapshot = await ctx.db.collection('budgets').doc(input.id).get();
      const existing = snapshot.data() as BudgetRow | undefined;
      if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
        throw new HttpError('This objective is not in the selected workspace.', 404);
      }
    }
    return {
      title: input.id ? 'Save this objective' : 'Add this objective',
      lines: [`${input.targetType} ${input.targetId}`, `${input.period}, from ${input.startDate}`],
    };
  },
  audit(_input: SaveInput, result: BudgetSaveResult) {
    return {
      action: result.created ? 'BUDGET_CREATED' : 'BUDGET_UPDATED',
      entityType: 'budgets',
      entityId: result.id,
      description: `${result.created ? 'Added' : 'Changed'} the ${result.period} objective on ${result.targetId}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Add or change a budget line — a plan for one account over one cycle; do not use it to record spending, which is a posting.',
    example: { targetId: 'acct_rent', targetType: 'account', amountCents: 250000, period: 'monthly', startDate: '2026-11-01' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The amount is not whole cents, the cycle is not monthly, quarterly or yearly, or the start date is not a day.', next: 'Send the amount in cents and the date as YYYY-MM-DD.' },
      { code: 'NOT_FOUND', when: 'The objective being changed is not in the selected workspace.', next: 'Reload the plan and choose an objective in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to change the plan.' },
    ],
    next: [{ command: 'budget.delete', label: 'Remove an objective' }],
  },
};

export const budgetDeleteCommand: CommandDefinition<typeof budgetDeleteInput, { id: string; targetId?: string }> = {
  name: 'budget.delete',
  input: budgetDeleteInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: DeleteInput) {
    const ref = ctx.db.collection('budgets').doc(input.id);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as BudgetRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This objective is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    tx.delete(ref);
    return { id: input.id, targetId: typeof existing.targetId === 'string' ? existing.targetId : undefined };
  },
  async preview(ctx: CommandContext, input: DeleteInput) {
    const snapshot = await ctx.db.collection('budgets').doc(input.id).get();
    const existing = snapshot.data() as BudgetRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This objective is not in the selected workspace.', 404);
    }
    return {
      title: `Remove the objective on ${String(existing?.targetId || input.id)}`,
      lines: ['The plan is removed; posted amounts, accounts and reports keep their own figures'],
    };
  },
  audit(_input: DeleteInput, result: { id: string; targetId?: string }) {
    return {
      action: 'BUDGET_DELETED',
      entityType: 'budgets',
      entityId: result.id,
      description: `Removed the objective on ${result.targetId || result.id}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Remove one budget line; do not use it to remove a posting or an account, which have their own commands.',
    example: { id: 'budget_rent_2026_11' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The objective is not in the selected workspace.', next: 'Reload the plan and choose an objective in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to change the plan.' },
    ],
    next: [{ command: 'budget.save', label: 'Add the plan again' }],
  },
};
