import { z } from 'zod';
import { MODULES, modulesProblem, type Modules } from '../../lib/modules';
import { RetentionSettingsSchema, retentionFor } from '../../lib/retention';
import { moduleAuditSummary, ModuleSettingError, setModulesInTransaction } from '../services/moduleService';
import {
  completeSetupInTransaction,
  openingBalanceAuditSummary,
  previewOpeningBalances,
  recordOpeningBalancesInTransaction,
  type OpeningBalancesInput,
} from '../services/openingBalanceService';
import {
  retentionAuditSummary,
  updateRetentionInTransaction,
} from '../services/retentionService';
import type { CommandDefinition } from './types';

export const workspaceModulesInput = z.object({
  modules: z.record(z.string(), z.boolean()),
}).strict();
type WorkspaceModulesInput = z.output<typeof workspaceModulesInput>;

type ModuleCommandResult = Awaited<ReturnType<typeof setModulesInTransaction>>;

export const workspaceModulesCommand: CommandDefinition<typeof workspaceModulesInput, ModuleCommandResult> = {
  name: 'workspace.modules',
  input: workspaceModulesInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx, input: WorkspaceModulesInput) {
    return setModulesInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, modules: input.modules as Modules,
    });
  },
  async preview(ctx, input) {
    const problem = modulesProblem(input.modules);
    if (problem) throw new ModuleSettingError(400, problem);
    const before = (ctx.workspace.modules || {}) as Modules;
    const changes = Object.entries(input.modules)
      .filter(([id, on]) => (before[id] !== false) !== on)
      .map(([id, on]) => `${MODULES.find(module => module.id === id)?.name || id} ${on ? 'on' : 'off'}`);
    return {
      title: 'Change workspace modules',
      lines: changes.length ? changes : ['No module settings will change'],
    };
  },
  audit(_input, result) {
    return moduleAuditSummary(result);
  },
  inverse(_input, result) {
    return { command: 'workspace.modules', input: { modules: result.previousModules } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Turn workspace screens on or off without deleting their records; do not use this to change or remove data in a module.',
    example: { modules: { payroll: false, inventory: true } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The module map is malformed or names an unsupported module.', next: 'Send true or false for a module listed in Settings → Modules.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask a workspace owner or accountant to change module settings.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const workspaceOpeningBalancesInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  balances: z.array(z.object({
    accountId: z.string().min(1).max(127),
    amountCents: z.number().int(),
  }).strict()).max(300),
}).strict();
type WorkspaceOpeningBalancesInput = z.output<typeof workspaceOpeningBalancesInput>;
type OpeningBalanceCommandResult = Awaited<ReturnType<typeof recordOpeningBalancesInTransaction>>;

export const workspaceOpeningBalancesCommand: CommandDefinition<typeof workspaceOpeningBalancesInput, OpeningBalanceCommandResult> = {
  name: 'workspace.openingbalances',
  input: workspaceOpeningBalancesInput,
  roles: ['owner', 'accountant'],
  dated: 'date',
  async handler(ctx, tx, input: WorkspaceOpeningBalancesInput) {
    const openingInput: OpeningBalancesInput = {
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      email: ctx.email,
      ...input,
    };
    return recordOpeningBalancesInTransaction(ctx.db, tx, openingInput);
  },
  async preview(ctx, input) {
    const entry = await previewOpeningBalances(ctx.db, {
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      email: ctx.email,
      ...input,
    });
    return {
      title: `Record opening balances on ${input.date}`,
      lines: [
        `${entry.lines.length} account line${entry.lines.length === 1 ? '' : 's'}`,
        `${entry.debitsCents} cents debited; ${entry.creditsCents} cents credited`,
        `${entry.equityCents} cents to Opening Balance Equity`,
      ],
      accounts: entry.lines.map(line => ({
        accountId: line.accountId,
        accountName: line.accountName,
        amountCents: line.amountCents,
        description: line.description,
      })),
    };
  },
  audit(input, result) {
    const summary = openingBalanceAuditSummary(input, result);
    return {
      action: summary.action,
      entityType: summary.entityType,
      entityId: summary.entityId,
      description: summary.description,
      details: summary.details,
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Post the workspace’s starting balance-sheet amounts as one balanced opening entry on the selected date; receivables and payables come from their unpaid documents instead.',
    example: { date: '2026-01-01', balances: [{ accountId: 'account_cash', amountCents: 125000 }, { accountId: 'account_loan', amountCents: 30000 }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A balance is not a whole-cent amount, an account is duplicated, or an account cannot hold an opening balance.', next: 'Use one eligible balance-sheet account per line and whole cents; load receivables and payables from unpaid invoices and bills.' },
      { code: 'PERIOD_LOCKED', when: 'The start date is in a locked period.', next: 'Choose a date after the workspace period lock.' },
      { code: 'CONFLICT', when: 'Opening balances have already been recorded.', next: 'Reverse the existing opening entry in the ledger before recording a replacement.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask a workspace owner or accountant to set up the books.' },
      { code: 'INVALID_INPUT', when: 'The workspace has no active Opening Balance Equity account, or an amount or account cannot be used for an opening balance.', next: 'Add an active Opening Balance Equity account and choose eligible balance-sheet accounts.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The named workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const workspaceSetupCompleteInput = z.object({}).strict();
type WorkspaceSetupCompleteResult = Awaited<ReturnType<typeof completeSetupInTransaction>>;

export const workspaceSetupCompleteCommand: CommandDefinition<typeof workspaceSetupCompleteInput, WorkspaceSetupCompleteResult> = {
  name: 'workspace.setupcomplete',
  input: workspaceSetupCompleteInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx) {
    return completeSetupInTransaction(ctx.db, tx, { workspaceId: ctx.workspaceId, uid: ctx.actor });
  },
  async preview(ctx) {
    return {
      title: ctx.workspace.setupCompletedAt ? 'Workspace setup is already complete' : 'Finish workspace setup',
      lines: [ctx.workspace.setupCompletedAt ? 'No change will be made' : 'Mark this workspace as ready to use'],
    };
  },
  audit(_input, result) {
    if (!result.changed) return null;
    return {
      action: 'WORKSPACE_SETUP_COMPLETED',
      entityType: 'workspace',
      entityId: result.workspaceId,
      description: 'Workspace setup completed without opening balances',
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Finish first-run setup when the workspace is starting from zero; do not use this if you need to record opening balances.',
    example: {},
    refusals: [
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask a workspace owner or accountant to finish setup.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

export const workspaceRetentionInput = RetentionSettingsSchema;
type WorkspaceRetentionInput = z.output<typeof workspaceRetentionInput>;
type RetentionCommandResult = Awaited<ReturnType<typeof updateRetentionInTransaction>>;

export const workspaceRetentionCommand: CommandDefinition<typeof workspaceRetentionInput, RetentionCommandResult> = {
  name: 'workspace.retention',
  input: workspaceRetentionInput,
  roles: ['owner'],
  async handler(ctx, tx, input: WorkspaceRetentionInput) {
    return updateRetentionInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, settings: input,
    });
  },
  async preview(ctx, input) {
    const current = retentionFor(ctx.workspace);
    const changes = (Object.keys(input) as Array<keyof WorkspaceRetentionInput>)
      .filter(key => input[key] !== current[key])
      .map(key => `${key}: ${current[key]} → ${input[key]}`);
    return {
      title: 'Update workspace retention and legal hold',
      lines: changes.length ? changes : ['No retention settings will change'],
    };
  },
  audit(_input, result) {
    const summary = retentionAuditSummary(result);
    return {
      action: summary.action,
      entityType: summary.entityType,
      entityId: summary.entityId,
      description: summary.description,
      details: summary.details,
    };
  },
  inverse(_input, result) {
    return { command: 'workspace.retention', input: result.before };
  },
  risk: 'normal',
  describe: {
    sentence: 'Set workspace log-retention periods, deletion recovery window, and legal hold; do not use this to change accounting-record retention or delete business records.',
    example: { deletionGraceDays: 60, emailLogDays: 90, errorLogDays: 30, legalHold: false },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A retention period is outside its allowed range or an unsupported field is supplied.', next: 'Use whole-day values within the documented limits and set emailLogDays to 0 to keep the email log indefinitely.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not the workspace owner.', next: 'Ask the workspace owner to change retention settings.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};

