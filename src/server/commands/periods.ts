import { z } from 'zod';
import { lockMessage, monthCloseState, monthEnd, postingLock, type PeriodLockSettings } from '../../lib/periodLock';
import { closeStepsProblem } from '../../lib/closeSteps';
import { formatTzDate } from '../../lib/calendarDate';
import { rebuildSnapshots } from '../services/balanceService';
import { DepreciationError, runDepreciation } from '../services/depreciationService';
import {
  closePeriod,
  partialUnlock,
  PeriodCloseError,
  relock,
  reopenPeriod,
  saveCloseSteps,
  signOff,
} from '../services/periodCloseService';
import type { CommandDefinition } from './types';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthInput = z.string().regex(MONTH, 'Month must be YYYY-MM');

function checkedMonthEnd(month: string): string {
  if (!MONTH.test(month)) throw new PeriodCloseError(400, 'Month must be YYYY-MM');
  return monthEnd(month);
}

const actor = (ctx: { workspaceId: string; actor: string; email?: string }) => ({
  workspaceId: ctx.workspaceId,
  uid: ctx.actor,
  email: ctx.email,
});

/** Body-only schemas are shared with the legacy routes so their request contract cannot drift. */
export const periodCloseBodySchema = z.object({ mode: z.enum(['soft', 'hard']) }).strict();
export const periodCloseInput = periodCloseBodySchema.extend({ month: monthInput }).strict();
type PeriodCloseInput = z.output<typeof periodCloseInput>;
type PeriodCloseResult = Awaited<ReturnType<typeof closePeriod>>;

export const periodCloseCommand: CommandDefinition<typeof periodCloseInput, PeriodCloseResult> = {
  name: 'period.close',
  input: periodCloseInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx, input: PeriodCloseInput) {
    return closePeriod(ctx.db, { ...actor(ctx), ...input }, tx);
  },
  async preview(ctx, input) {
    const end = checkedMonthEnd(input.month);
    const workspace = ctx.workspace as PeriodLockSettings & { timezone?: unknown };
    const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    if (end > today) throw new PeriodCloseError(400, `${input.month} hasn't ended yet (today is ${today})`);
    return {
      title: `${input.mode === 'hard' ? 'Hard-close' : 'Soft-close'} ${input.month}`,
      lines: [
        `The close covers the ledger through ${end}.`,
        `Current period state: ${monthCloseState(input.month, workspace)}.`,
        `Current hard lock: ${workspace.lockDate || 'none'}; soft lock: ${workspace.softLockDate || 'none'}.`,
        'The close is refused if drafts would be trapped in the locked period.',
      ],
    };
  },
  // periodCloseService writes its established audit entry in the same transaction.
  audit() { return null; },
  inverse(input) {
    return input.mode === 'soft'
      ? { command: 'period.reopen', input: { month: input.month, reason: `Undo soft close ${input.month}` } }
      : null;
  },
  risk: 'normal',
  describe: {
    sentence: 'Soft- or hard-close an ended accounting month after checking that no drafts would be trapped; do not use this to post or reverse a ledger entry.',
    example: { month: '2026-03', mode: 'soft' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The month is malformed or has not ended.', next: 'Choose an ended month in YYYY-MM format.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask an owner or accountant to close the period.' },
      { code: 'CONFLICT', when: 'The month is already closed or contains drafts that would be trapped.', next: 'Choose an open month and post, re-date, or remove the listed drafts first.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const periodReopenBodySchema = z.object({ reason: z.string().min(5).max(500) }).strict();
export const periodReopenInput = periodReopenBodySchema.extend({ month: monthInput }).strict();
type PeriodReopenInput = z.output<typeof periodReopenInput>;
type PeriodReopenResult = Awaited<ReturnType<typeof reopenPeriod>>;

export const periodReopenCommand: CommandDefinition<typeof periodReopenInput, PeriodReopenResult> = {
  name: 'period.reopen',
  input: periodReopenInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx, input: PeriodReopenInput) {
    return reopenPeriod(ctx.db, { ...actor(ctx), ...input }, tx);
  },
  async preview(ctx, input) {
    checkedMonthEnd(input.month);
    const state = monthCloseState(input.month, ctx.workspace as PeriodLockSettings);
    return {
      title: `Reopen ${input.month}`,
      lines: [`Current period state: ${state}.`, `Reason: ${input.reason.trim()}`],
    };
  },
  audit() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Reopen a closed accounting month with a recorded reason; do not use this to change or reverse any ledger entries.',
    example: { month: '2026-03', reason: 'Correct a missed supplier bill' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The month or reason is malformed.', next: 'Use YYYY-MM and give a reason of at least five characters.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant, or an accountant tries to reopen a hard close.', next: 'Ask the workspace owner to reopen a hard-closed period.' },
      { code: 'CONFLICT', when: 'The month is already open.', next: 'Choose a closed month.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const periodUnlockBodySchema = z.object({ fromDate: z.string(), toDate: z.string(), reason: z.string().min(5).max(500) }).strict();
export const periodUnlockInput = periodUnlockBodySchema;
type PeriodUnlockInput = z.output<typeof periodUnlockInput>;
type PeriodUnlockResult = Awaited<ReturnType<typeof partialUnlock>>;

export const periodUnlockCommand: CommandDefinition<typeof periodUnlockInput, PeriodUnlockResult> = {
  name: 'period.unlock',
  input: periodUnlockInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx, input: PeriodUnlockInput) {
    return partialUnlock(ctx.db, { ...actor(ctx), ...input }, tx);
  },
  async preview(_ctx, input) {
    return {
      title: `Unlock ${input.fromDate} through ${input.toDate}`,
      lines: [`Reason: ${input.reason.trim()}`, 'The unlocked dates remain open until they are explicitly re-locked.'],
    };
  },
  audit() { return null; },
  inverse() { return { command: 'period.relock', input: {} }; },
  risk: 'normal',
  describe: {
    sentence: 'Temporarily unlock up to three months inside a closed period with a reason; do not use this to reopen the entire period.',
    example: { fromDate: '2026-01-10', toDate: '2026-01-20', reason: 'Correct a dated bank entry' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The date range is invalid, longer than three months, outside a closed period, or the reason is too short.', next: 'Use real YYYY-MM-DD dates in ascending order, choose dates that are closed, stay within three months, and explain why.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant, or an accountant tries to unlock hard-closed dates.', next: 'Ask the workspace owner to unlock hard-closed dates.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const periodRelockInput = z.object({}).strict();
type PeriodRelockResult = Awaited<ReturnType<typeof relock>>;

export const periodRelockCommand: CommandDefinition<typeof periodRelockInput, PeriodRelockResult> = {
  name: 'period.relock',
  input: periodRelockInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx) {
    const result = await relock(ctx.db, actor(ctx), tx);
    ctx.afterCommit(async () => {
      await rebuildSnapshots(ctx.db, ctx.workspaceId, ctx.actor).catch(err => {
        console.warn('[balances] rebuilding after the relock failed:', err instanceof Error ? err.message : err);
      });
    });
    return result;
  },
  async preview(ctx) {
    const exception = (ctx.workspace as PeriodLockSettings).lockException;
    return {
      title: 'Re-lock the temporarily unlocked dates',
      lines: exception
        ? [`Close ${exception.fromDate} through ${exception.toDate} again.`, `Original reason: ${exception.reason || 'not recorded'}.`]
        : ['No dates are currently unlocked.'],
    };
  },
  audit() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Close a temporarily unlocked date range again and rebuild affected balance snapshots; do not use this to change the workspace close date.',
    example: {},
    refusals: [
      { code: 'CONFLICT', when: 'No dates are currently unlocked.', next: 'Use this only after a partial period unlock.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask an owner or accountant to re-lock the dates.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const periodSignOffBodySchema = z.object({
  itemId: z.string().min(1).max(40),
  note: z.string().max(500).optional(),
  remove: z.boolean().optional(),
}).strict();
export const periodSignOffInput = periodSignOffBodySchema.extend({ month: monthInput }).strict();
type PeriodSignOffInput = z.output<typeof periodSignOffInput>;
type PeriodSignOffResult = Awaited<ReturnType<typeof signOff>>;

export const periodSignOffCommand: CommandDefinition<typeof periodSignOffInput, PeriodSignOffResult> = {
  name: 'period.signoff',
  input: periodSignOffInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, tx, input: PeriodSignOffInput) {
    return signOff(ctx.db, { ...actor(ctx), ...input }, tx);
  },
  async preview(ctx, input) {
    checkedMonthEnd(input.month);
    return {
      title: `${input.remove ? 'Remove sign-off' : 'Sign off'} ${input.itemId} for ${input.month}`,
      lines: [
        input.remove ? 'Remove the existing review mark.' : 'Record that this checklist item was reviewed.',
        ...(input.note?.trim() ? [`Note: ${input.note.trim()}`] : []),
        `Current period state: ${monthCloseState(input.month, ctx.workspace as PeriodLockSettings)}.`,
      ],
    };
  },
  audit() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Record or remove a month-end checklist sign-off; do not use this to close a period or certify an unreviewed item.',
    example: { month: '2026-03', itemId: 'reconcile', note: 'Bank lines match' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The month or checklist item is malformed or unknown.', next: 'Choose YYYY-MM and a built-in checklist item or a current workspace step.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace writer to record the review.' },
      { code: 'CONFLICT', when: 'The period is hard-closed and sign-offs are final.', next: 'Do not alter the closed-period record; ask the owner to reopen it if correction is necessary.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const periodCloseStepsBodySchema = z.object({
  steps: z.array(z.object({
    id: z.string().max(40).optional(),
    title: z.string().max(200),
    frequency: z.string().max(20),
  }).strict()).max(100),
}).strict();
export const periodCloseStepsInput = periodCloseStepsBodySchema;
type PeriodCloseStepsInput = z.output<typeof periodCloseStepsInput>;
type PeriodCloseStepsResult = Awaited<ReturnType<typeof saveCloseSteps>>;

export const periodCloseStepsCommand: CommandDefinition<typeof periodCloseStepsInput, PeriodCloseStepsResult> = {
  name: 'period.closesteps',
  input: periodCloseStepsInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx, input: PeriodCloseStepsInput) {
    return saveCloseSteps(ctx.db, { ...actor(ctx), ...input }, tx);
  },
  async preview(ctx, input) {
    const problem = closeStepsProblem(input.steps);
    if (problem) throw new PeriodCloseError(400, problem);
    const before = Array.isArray(ctx.workspace.closeSteps)
      ? ctx.workspace.closeSteps as Array<{ id: string; title: string; frequency: string }>
      : [];
    const beforeById = new Map(before.map(step => [step.id, step]));
    const afterIds = new Set(input.steps.flatMap(step => step.id ? [step.id] : []));
    const removed = before.filter(step => !afterIds.has(step.id)).map(step => `Remove “${step.title}”`);
    const added = input.steps.filter(step => !step.id || !beforeById.has(step.id)).map(step => `Add “${step.title.trim()}”`);
    const edited = input.steps.flatMap(step => {
      const previous = step.id ? beforeById.get(step.id) : undefined;
      if (!previous) return [];
      const title = step.title.trim();
      const changes: string[] = [];
      if (previous.title !== title) changes.push(`Rename “${previous.title}” to “${title}”`);
      if (previous.frequency !== step.frequency) changes.push(`Change frequency of “${title}” from ${previous.frequency} to ${step.frequency}`);
      return changes;
    });
    const lines = [...added, ...edited, ...removed];
    return {
      title: 'Save workspace month-end checklist steps',
      lines: lines.length ? lines : [`Keep ${input.steps.length} existing step${input.steps.length === 1 ? '' : 's'}.`],
    };
  },
  audit() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Replace the workspace’s custom month-end checklist steps; do not use this to change built-in checks or their sign-offs.',
    example: { steps: [{ title: 'Review customer balances', frequency: 'monthly' }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A step is malformed, duplicated, or uses an unsupported frequency.', next: 'Provide unique step names of 2 to 120 characters and monthly, quarterly, or yearly frequency.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask an owner or accountant to edit the month-end checklist.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const periodDepreciationInput = z.object({ month: monthInput }).strict();
type PeriodDepreciationInput = z.output<typeof periodDepreciationInput>;
type PeriodDepreciationResult = Awaited<ReturnType<typeof runDepreciation>>;

export const periodDepreciationCommand: CommandDefinition<typeof periodDepreciationInput, PeriodDepreciationResult> = {
  name: 'period.depreciation',
  input: periodDepreciationInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, tx, input: PeriodDepreciationInput) {
    return runDepreciation(ctx.db, { ...actor(ctx), ...input }, tx);
  },
  async preview(ctx, input) {
    const date = checkedMonthEnd(input.month);
    const workspace = ctx.workspace as PeriodLockSettings & { timezone?: unknown };
    const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    if (date > today) throw new DepreciationError(400, `${input.month} hasn't ended yet`);
    const lock = postingLock(date, workspace, ctx.actor);
    if (lock) throw new DepreciationError(409, lockMessage(date, lock));
    return {
      title: `Run depreciation for ${input.month}`,
      lines: [
        `The proposed journal-entry date is ${date}.`,
        'The run catches active fixed assets up through this month and posts only amounts not yet depreciated.',
        'The journal entry, asset balances, and audit record are committed together; repeating a completed run posts nothing new.',
      ],
    };
  },
  audit() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Post month-end depreciation for active fixed assets through a specified ended month; do not use this to dispose of an asset or change its depreciation method.',
    example: { month: '2026-03' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The month is malformed or has not ended.', next: 'Choose an ended month in YYYY-MM format.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace writer to run depreciation.' },
      { code: 'PERIOD_LOCKED', when: 'The month-end posting date is closed for the caller.', next: 'Choose an open month or ask an owner to reopen the period.' },
      { code: 'INVALID_INPUT', when: 'An eligible asset has no usable depreciation accounts.', next: 'Choose an expense account and an accumulated-depreciation asset account for each affected asset.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};
