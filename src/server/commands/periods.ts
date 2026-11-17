import { z } from 'zod';
import { calculateNetIncome, transactionDate } from '../../lib/txFilters';
import { currencyDigits, minorToMajor } from '../../lib/currencyMinorUnits';
import { lockMessage, monthCloseState, monthEnd, postingLock, type PeriodLockSettings } from '../../lib/periodLock';
import { closeStepsProblem } from '../../lib/closeSteps';
import { formatTzDate } from '../../lib/calendarDate';
import { periodBalancesReady, readSnapshotInputs, rebuildSnapshots, rebuildSnapshotsInTransaction, snapshotRebuildPlan, snapshotFromEntries, writeSnapshot } from '../services/balanceService';
import { periodClosingsReady, readClosings, writeClosing } from '../services/periodClosingService';
import { revaluateForeignBalances, undoRevaluation } from '../services/fxRevaluationService';
import type { Transaction } from '../../types';
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

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const fiscalYearCloseDate = z.string().regex(ISO_DATE).refine((date) => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}, 'Closing date must be a real calendar date');

/** The day after the same date one year earlier: the first day of the year ending on `closingDate`. */
export function fiscalYearStart(closingDate: string): string {
  const [y, md] = [Number(closingDate.slice(0, 4)), closingDate.slice(5)];
  const yearBefore = Date.parse(`${y - 1}-${md}T00:00:00Z`);
  const base = Number.isNaN(yearBefore) || new Date(yearBefore).toISOString().slice(5, 10) !== md ? Date.parse(`${y - 1}-02-28T00:00:00Z`) : yearBefore;
  return new Date(base + 86400000).toISOString().slice(0, 10);
}

function assertYearCloseable(closingDate: string, workspace: Record<string, unknown>): void {
  const lockDate = typeof workspace.lockDate === 'string' ? workspace.lockDate : '';
  if (lockDate && lockDate >= closingDate) throw new PeriodCloseError(400, `Cannot close year: Period is already locked through ${lockDate}.`);
  const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
  if (closingDate > today) {
    throw new PeriodCloseError(400, `Cannot close future accounting period. Closing date (${closingDate}) is ahead of current date (${today}).`);
  }
}

/**
 * Drafts the new lock would trap. A lock refuses every write on or before its date, not only inside the year being
 * closed, so this counts every draft after the current lock (or from the start, with no lock) up to the closing
 * date: a draft left over from an earlier, never-closed year would be stuck just the same.
 */
function trappedDrafts(entries: unknown[], workspace: Record<string, unknown>, closingDate: string): number {
  const lockDate = typeof workspace.lockDate === 'string' ? workspace.lockDate.slice(0, 10) : '';
  return (entries as Transaction[]).filter(e => {
    if (e.status !== 'draft') return false;
    const d = transactionDate(e);
    return d !== '' && d <= closingDate && (!lockDate || d > lockDate);
  }).length;
}

export const periodYearCloseInput = z.object({ closingDate: fiscalYearCloseDate, lockPeriod: z.boolean().optional() }).strict();
type PeriodYearCloseInput = z.output<typeof periodYearCloseInput>;
type PeriodYearCloseResult = {
  workspaceId: string;
  yearStart: string;
  closingDate: string;
  lockPeriod: boolean;
  year: ReturnType<typeof calculateNetIncome>;
  closingVersion: number | null;
  currency: string;
};

export const periodYearCloseCommand: CommandDefinition<typeof periodYearCloseInput, PeriodYearCloseResult> = {
  name: 'period.yearclose',
  input: periodYearCloseInput,
  roles: ['owner'],
  allowPlatformAdmin: true,
  async handler(ctx, tx, input: PeriodYearCloseInput) {
    assertYearCloseable(input.closingDate, ctx.workspace);
    const yearStart = fiscalYearStart(input.closingDate);
    const { accounts, entries } = await readSnapshotInputs(ctx.db, tx, ctx.workspaceId, input.closingDate);
    const transactions = entries as Transaction[];
    const year = calculateNetIncome(transactions, accounts, yearStart, input.closingDate);
    const lockPeriod = Boolean(input.lockPeriod);
    let closingVersion: number | null = null;

    if (lockPeriod) {
      // A lock refuses every later write on or before the closing date, drafts included: a draft left in
      // the year could then neither be posted nor removed. The month close lists drafts and refuses
      // (closeStepsProblem); the year close locks a whole year, so it refuses on the same terms.
      const trapped = trappedDrafts(transactions, ctx.workspace, input.closingDate);
      if (trapped > 0) {
        throw new PeriodCloseError(409, `Cannot lock the year: ${trapped} draft ${trapped === 1 ? 'entry is' : 'entries are'} dated inside it and would never be postable. Post or delete ${trapped === 1 ? 'it' : 'them'} first.`);
      }
      const [withSnapshot, withClosing] = await Promise.all([
        periodBalancesReady(ctx.db, tx),
        periodClosingsReady(ctx.db, tx),
      ]);
      const stored = withClosing ? await readClosings(ctx.db, tx, ctx.workspaceId) : [];
      const now = new Date().toISOString();
      tx.update(ctx.db.collection('workspaces').doc(ctx.workspaceId), { lockDate: input.closingDate, updatedAt: now });
      const snapshot = snapshotFromEntries(ctx.workspaceId, input.closingDate, accounts, transactions, ctx.actor);
      if (withSnapshot) writeSnapshot(ctx.db, tx, snapshot);
      if (withClosing) {
        closingVersion = writeClosing(ctx.db, tx, stored, {
          workspaceId: ctx.workspaceId, yearStart, yearEnd: input.closingDate, accounts, entries: transactions,
          snapshot, uid: ctx.actor, email: ctx.email, at: now,
        }).version;
      }
    }

    const currency = typeof ctx.workspace.currency === 'string' && ctx.workspace.currency ? ctx.workspace.currency : 'USD';
    return { workspaceId: ctx.workspaceId, yearStart, closingDate: input.closingDate, lockPeriod, year, closingVersion, currency };
  },
  async preview(ctx, input) {
    assertYearCloseable(input.closingDate, ctx.workspace);
    const yearStart = fiscalYearStart(input.closingDate);
    const { accounts, entries } = await ctx.db.runTransaction(tx => readSnapshotInputs(ctx.db, tx, ctx.workspaceId, input.closingDate));
    const year = calculateNetIncome(entries as Transaction[], accounts, yearStart, input.closingDate);
    const currency = typeof ctx.workspace.currency === 'string' && ctx.workspace.currency ? ctx.workspace.currency : 'USD';
    const fmt = (cents: number) => minorToMajor(cents, currency).toFixed(currencyDigits(currency));
    const trapped = input.lockPeriod ? trappedDrafts(entries, ctx.workspace, input.closingDate) : 0;
    return {
      title: `Close fiscal year ${yearStart} through ${input.closingDate}`,
      lines: [
        `Net ${year.netIncome >= 0 ? 'profit' : 'loss'}: ${fmt(Math.abs(year.netIncome))} (income ${fmt(year.income)}, costs ${fmt(year.cogs + year.expense)}).`,
        `The year ${input.lockPeriod ? 'will be locked' : 'will remain open'} after the close.`,
        ...(trapped > 0
          ? [`${trapped} draft ${trapped === 1 ? 'entry is' : 'entries are'} dated on or before the closing date and not yet locked: the lock would leave ${trapped === 1 ? 'it' : 'them'} permanently unpostable, so the close will be refused until ${trapped === 1 ? 'it is' : 'they are'} posted or deleted.`]
          : []),
        'No closing journal entry is posted; the balance sheet already carries past profit in retained earnings.',
      ],
    };
  },
  audit(input, result) {
    const { year, currency } = result;
    const fmt = (cents: number) => minorToMajor(cents, currency).toFixed(currencyDigits(currency));
    return {
      action: 'FISCAL_YEAR_CLOSE', entityType: 'workspace', entityId: result.workspaceId,
      description: `Year ${result.yearStart} – ${result.closingDate} closed: net ${year.netIncome >= 0 ? 'profit' : 'loss'} of ${fmt(Math.abs(year.netIncome))} (income ${fmt(year.income)}, costs ${fmt(year.cogs + year.expense)}), carried in retained earnings on the balance sheet${result.lockPeriod ? '; the year is locked' : ''}.`,
      details: {
        closingDate: input.closingDate, yearStart: result.yearStart, netIncomeCents: year.netIncome,
        incomeCents: year.income, costsCents: year.cogs + year.expense, lockPeriod: result.lockPeriod,
      },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Record the profit or loss for a completed fiscal year and optionally lock through its closing date; no closing journal entry is posted.',
    example: { closingDate: '2026-06-30', lockPeriod: true },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The closing date is malformed, invalid, or in the future.', next: 'Provide a real ended date in YYYY-MM-DD format.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not the workspace owner or a platform administrator.', next: 'Ask the owner or a platform administrator to close the fiscal year.' },
      { code: 'CONFLICT', when: 'The period is already locked through or beyond the requested closing date.', next: 'Choose a date after the current lock or reopen the later period first.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const periodBalancesRebuildInput = z.object({}).strict();
type PeriodBalancesRebuildResult = Awaited<ReturnType<typeof rebuildSnapshotsInTransaction>> & { workspaceId: string };

export const periodBalancesRebuildCommand: CommandDefinition<typeof periodBalancesRebuildInput, PeriodBalancesRebuildResult> = {
  name: 'period.balancesrebuild',
  input: periodBalancesRebuildInput,
  roles: ['owner'],
  allowPlatformAdmin: true,
  async handler(ctx, tx) {
    return { workspaceId: ctx.workspaceId, ...(await rebuildSnapshotsInTransaction(ctx.db, tx, ctx.workspaceId, ctx.actor)) };
  },
  async preview(ctx) {
    const dates = await snapshotRebuildPlan(ctx.db, ctx.workspaceId);
    return {
      title: 'Rebuild period balance snapshots',
      lines: dates.length
        ? [`Rebuild the snapshots for ${dates.join(', ')}.`]
        : ['No closed-year or stale balance snapshots need rebuilding.'],
    };
  },
  audit(_input, result) {
    if (!result.built.length) return null;
    return {
      action: 'PERIOD_BALANCES_REBUILT', entityType: 'workspace', entityId: result.workspaceId,
      description: `Rebuilt ${result.built.length} balance snapshot${result.built.length === 1 ? '' : 's'}: ${result.built.join(', ')}`,
      details: { dates: result.built, count: result.built.length },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Rebuild stale and missing closed-year balance snapshots from the ledger without changing entries; do not use this to edit accounting records.',
    example: {},
    refusals: [
      { code: 'ROLE_REQUIRED', when: 'The caller is not the workspace owner or a platform administrator.', next: 'Ask the owner or a platform administrator to rebuild the snapshots.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const periodFxRevaluationInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rates: z.record(z.string(), z.number().positive()).optional(),
}).strict();
type PeriodFxRevaluationInput = z.output<typeof periodFxRevaluationInput>;
type PeriodFxRevaluationResult = Awaited<ReturnType<typeof revaluateForeignBalances>>;

export const periodFxRevaluationCommand: CommandDefinition<typeof periodFxRevaluationInput, PeriodFxRevaluationResult> = {
  name: 'period.fxrevaluation',
  input: periodFxRevaluationInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx, input: PeriodFxRevaluationInput) {
    return revaluateForeignBalances(ctx.db, {
      workspaceId: ctx.workspaceId,
      user: { uid: ctx.actor, email: ctx.email, admin: ctx.user.admin },
      ...input,
      dryRun: false,
    }, tx);
  },
  async preview(ctx, input) {
    const plan = await revaluateForeignBalances(ctx.db, {
      workspaceId: ctx.workspaceId,
      user: { uid: ctx.actor, email: ctx.email, admin: ctx.user.admin },
      ...input,
      dryRun: true,
    });
    return {
      title: `Preview currency revaluation at ${plan.date}`,
      lines: [plan.summary, ...plan.skipped.map(item => `${item.number}: ${item.reason}`), ...plan.unpriced.map(currency => `Enter a ${currency} rate before posting.`)],
      accounts: plan.lines.map(line => ({ accountId: line.accountId, accountName: line.accountName, amountCents: line.amountCents, description: line.description })),
    };
  },
  audit() { return null; },
  inverse(_input, result) {
    return result.posted ? { command: 'period.fxrevaluationundo', input: { date: result.date } } : null;
  },
  risk: 'normal',
  describe: {
    sentence: 'Post a month-end foreign-currency revaluation of open invoices and bills with its next-day reversal; use the preview before posting and do not revalue home-currency documents.',
    example: { date: '2026-03-31', rates: { EUR: 1.15 } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The date or a provided exchange rate is invalid, or a historical month-end is missing rates.', next: 'Use an ended month-end and provide a positive rate for every open foreign currency.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask an owner or accountant to run the currency revaluation.' },
      { code: 'PERIOD_LOCKED', when: 'The revaluation date or its reversal date is closed.', next: 'Choose an open month or ask the owner to reopen it.' },
      { code: 'CONFLICT', when: 'A revaluation already exists for that date.', next: 'Undo the existing revaluation before running it again.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const periodFxRevaluationUndoInput = z.object({ date: z.string().optional() }).strict();
type PeriodFxRevaluationUndoInput = z.output<typeof periodFxRevaluationUndoInput>;
type PeriodFxRevaluationUndoResult = Awaited<ReturnType<typeof undoRevaluation>>;

export const periodFxRevaluationUndoCommand: CommandDefinition<typeof periodFxRevaluationUndoInput, PeriodFxRevaluationUndoResult> = {
  name: 'period.fxrevaluationundo',
  input: periodFxRevaluationUndoInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx, input: PeriodFxRevaluationUndoInput) {
    return undoRevaluation(ctx.db, {
      workspaceId: ctx.workspaceId,
      user: { uid: ctx.actor, email: ctx.email, admin: ctx.user.admin },
      date: input.date || '',
    }, tx);
  },
  async preview(_ctx, input) {
    const date = input.date || 'the selected date';
    return {
      title: `Undo currency revaluation from ${date}`,
      lines: [
        `Post an exact reversal of the revaluation dated ${date} today.`,
        'Void its scheduled next-day reversal so it cannot reverse the ledger twice.',
        'The undo is refused if the original entry or scheduled reversal has changed or is already reversed.',
      ],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Undo one currency revaluation by posting its mirror and voiding the paired next-day reversal; do not use this to reverse unrelated journals.',
    example: { date: '2026-03-31' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The original date is malformed or omitted.', next: 'Provide the original revaluation date in YYYY-MM-DD format.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask an owner or accountant to undo the revaluation.' },
      { code: 'CONFLICT', when: 'The original entry or scheduled reversal is missing, changed, or already reversed.', next: 'Check the existing ledger entries before making another correction.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

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
