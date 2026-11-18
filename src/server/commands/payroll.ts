/**
 * Pay runs (U-02, U-10, U-11): posting a run for a pay date, sending it for an owner's approval,
 * approving or sending back a run that waits, turning approval on or off, and undoing a run while its
 * date is open (or withdrawing it while it waits).
 *
 * `payRunService` owns each rule, its transaction, its audit line and its words, so these commands are
 * the registered door in front of it — the same shape as the asset and document-adjustment commands.
 * They declare no `dated`: a closed period is the service's own 409 (`Period Locked: …`), where the
 * runner's dated check would answer 400 first. The separate provider CSV import (PAY-1) posts through
 * the runner's transaction and audit writer, and checks every date in the file before posting.
 */
import { z } from 'zod';
import { approvePayRun, postPayRun, rejectPayRun, setPayrollApproval, undoPayRun } from '../services/payRunService';
import { preparePayrollImport, preparePayrollJournals, type PayrollImportResult, type PreparedPayrollImport } from '../services/payrollImportService';
import { FieldValue } from '../db/firestore';
import { ledgerWrite } from '../services/ledgerDoor';
import { formatMoney } from '../../lib/moneyFormat';
import { PAYROLL_COLUMN_SETS, type PayrollTotals } from '../../lib/payrollProviderImport';
import type { AnyCommandDefinition, CommandAuditSummary, CommandContext, CommandDefinition } from './types';

/**
 * U-02: owners and accountants run payroll. The approval setting is an owner's. Approving and sending
 * back are listed for accountants too because P-05's two-person rule lets an accountant decide a run
 * they did not prepare — and the runner's role list is checked *before* the service reads that setting,
 * so a list of owners only would refuse exactly the case the rule exists for. The service stays the
 * authority: it answers "Only an owner approves or sends back a pay run" when the rule is off, and
 * "not by whoever prepared it" when the approver is the preparer (pay-run-posting.test.ts covers both).
 */
const RUNNERS = ['owner', 'accountant'] as const;
const OWNERS = ['owner'] as const;
const DECIDERS = ['owner', 'accountant'] as const;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const accountId = z.string().min(1).max(200);
const workspaceField = z.string().min(1).max(200).optional();
const payRunId = z.string().min(1).max(200);

// --------------------------------------------------------------------------- post

export const payRunPostInput = z.object({
  workspaceId: workspaceField,
  date: z.string().max(10),
  bankAccountId: accountId,
  wagesAccountId: accountId,
  taxExpenseAccountId: accountId,
  liabilitiesAccountId: accountId,
  /* a second run on the same date (a bonus run, say) */
  again: z.boolean().optional(),
  /* U-07: whom this run pays — one pay schedule, or everyone */
  // the same set as `Employee['payFrequency']`, plus 'all' (everyone); a case-sensitive enum, so a
  // misspelled schedule is refused here rather than silently paying nobody
  schedule: z.enum(['all', 'Weekly', 'Bi-Weekly', 'Monthly']).optional(),
}).strict();

type PayRunPostInput = z.output<typeof payRunPostInput>;

export const payRunPostCommand: CommandDefinition<typeof payRunPostInput, Record<string, unknown>> = {
  name: 'payroll.run',
  input: payRunPostInput,
  roles: [...RUNNERS],
  async handler(ctx, _tx, input: PayRunPostInput) {
    const { workspaceId: _bodyWorkspaceId, ...rest } = input;
    if (!DAY.test(input.date)) throw Object.assign(new Error('Choose the pay date and the four accounts'), { status: 400 });
    return postPayRun(ctx.db, { ...rest, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: input.schedule && input.schedule !== 'all' ? `Run payroll for ${input.schedule}` : 'Run payroll',
      lines: [
        `Paid on ${input.date}`,
        'One entry takes wages, the tax and the amounts withheld, and pays the net out of the bank',
        'With approval on, the run waits for an owner instead of posting',
      ],
      accounts: [
        { accountId: input.bankAccountId, amountCents: 0, description: 'Net pay out of the bank' },
        { accountId: input.wagesAccountId, amountCents: 0, description: 'Wages expense' },
      ],
    };
  },
  audit() { return null; },
  inverse(_input, result) {
    const id = (result as { payRunId?: string })?.payRunId;
    return id ? { command: 'payroll.undo', input: { payRunId: id } } : null;
  },
  risk: 'normal',
  describe: {
    sentence: 'Post a pay run for a pay date: one entry for the wages, the employer tax and what was withheld, with the net paid out of the bank; do not use it to record a single payment to one person — that is payment.receive.',
    example: { date: '2026-06-30', bankAccountId: 'acc_bank', wagesAccountId: 'acc_wages', taxExpenseAccountId: 'acc_tax', liabilitiesAccountId: 'acc_payroll_liab' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The pay date is not a real day, or an account is missing.', next: 'Send a real pay date and the four accounts.' },
      { code: 'CONFLICT', when: 'The same day, schedule and amounts were already paid, or the run is in a closed period.', next: 'Choose another day, or send `again: true` for a second run.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner or an accountant.', next: 'Ask an owner or an accountant to run payroll.' },
    ],
  },
};

// --------------------------------------------------------------------------- undo

export const payRunUndoInput = z.object({ workspaceId: workspaceField, payRunId }).strict();

export const payRunUndoCommand: CommandDefinition<typeof payRunUndoInput, Record<string, unknown>> = {
  name: 'payroll.undo',
  input: payRunUndoInput,
  roles: [...RUNNERS],
  async handler(ctx, _tx, input) {
    return undoPayRun(ctx.db, { payRunId: input.payRunId, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }) as Promise<Record<string, unknown>>;
  },
  async preview() {
    return { title: 'Undo the pay run', lines: ['Its entry is voided while the date is open, or a run still waiting is withdrawn'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Undo a posted pay run while its date is open, or withdraw one still waiting for approval; do not use it to edit a payslip by hand.',
    example: { payRunId: 'payrun_123' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The run is not in this workspace.', next: 'Check the run in this workspace.' },
      { code: 'CONFLICT', when: 'The pay date is in a closed period, or the run was already undone.', next: 'Reopen the period first, or undo a run that stands.' },
    ],
  },
};

// --------------------------------------------------------------------------- approval setting

export const payRunApprovalInput = z.object({ workspaceId: workspaceField, required: z.boolean() }).strict();

export const payRunApprovalCommand: CommandDefinition<typeof payRunApprovalInput, Record<string, unknown>> = {
  name: 'payroll.approval',
  input: payRunApprovalInput,
  roles: [...OWNERS],
  async handler(ctx, _tx, input) {
    return setPayrollApproval(ctx.db, { required: input.required, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: input.required ? 'Require an owner’s approval for payroll' : 'Let payroll post without approval',
      lines: [input.required ? 'A run will wait for an owner before it posts' : 'An owner or an accountant can post a run directly'],
    };
  },
  audit() { return null; },
  inverse(input) { return { command: 'payroll.approval', input: { required: !input.required } }; },
  risk: 'normal',
  describe: {
    sentence: 'Turn the owner’s approval of payroll on or off; do not use it to approve a particular run — that is payroll.approve.',
    example: { required: true },
    refusals: [
      { code: 'FORBIDDEN', when: 'The caller is not an owner.', next: 'Ask a workspace owner to change it.' },
      { code: 'NOT_FOUND', when: 'The workspace does not exist.', next: 'Check the workspace.' },
    ],
  },
};

// --------------------------------------------------------------------------- approve / reject

export const payRunApproveInput = z.object({ workspaceId: workspaceField, payRunId, again: z.boolean().optional() }).strict();

export const payRunApproveCommand: CommandDefinition<typeof payRunApproveInput, Record<string, unknown>> = {
  name: 'payroll.approve',
  input: payRunApproveInput,
  roles: [...DECIDERS],
  async handler(ctx, _tx, input) {
    return approvePayRun(ctx.db, {
      payRunId: input.payRunId, again: input.again, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email,
    }) as Promise<Record<string, unknown>>;
  },
  async preview() {
    return { title: 'Approve the pay run', lines: ['It posts now, with the entry and the payslips the run prepared'] };
  },
  audit() { return null; },
  inverse(input) { return { command: 'payroll.undo', input: { payRunId: input.payRunId } }; },
  risk: 'normal',
  describe: {
    sentence: 'Approve a pay run that is waiting, which posts it; do not use it on a run that already posted — that is payroll.undo.',
    example: { payRunId: 'payrun_123' },
    refusals: [
      { code: 'CONFLICT', when: 'The run is not waiting, is incomplete, or the same day and amounts were already paid.', next: 'Approve a complete run that still waits; reply with `again: true` for a deliberate second run.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner.', next: 'Ask a workspace owner to approve it.' },
    ],
  },
};

export const payRunRejectInput = z.object({ workspaceId: workspaceField, payRunId, note: z.string().max(500).optional() }).strict();

export const payRunRejectCommand: CommandDefinition<typeof payRunRejectInput, Record<string, unknown>> = {
  name: 'payroll.reject',
  input: payRunRejectInput,
  roles: [...DECIDERS],
  async handler(ctx, _tx, input) {
    return rejectPayRun(ctx.db, {
      payRunId: input.payRunId, note: input.note, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email,
    }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return { title: 'Send the pay run back', lines: [`On ${input.payRunId}`, input.note ? `With a note: ${input.note}` : 'With no note', 'Nothing posts, and the time it held is free again'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Send a waiting pay run back to whoever prepared it, with a note; do not use it to undo a run that already posted — that is payroll.undo.',
    example: { payRunId: 'payrun_123', note: 'Wrong pay period' },
    refusals: [
      { code: 'CONFLICT', when: 'The run is not waiting.', next: 'Send back only a run that still waits.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner.', next: 'Ask a workspace owner to review it.' },
    ],
  },
};

// --------------------------------------------------------------------------- import

const optionalImportAccount = accountId.optional();
export const payrollImportInput = z.object({
  provider: z.enum(['adp', 'gusto', 'paychex']),
  csv: z.string().min(1).max(5_000_000).describe('The original provider export as CSV text, including the header row.'),
  fileName: z.string().max(300).optional(),
  accounts: z.object({
    wages: optionalImportAccount, employerTaxExpense: optionalImportAccount, employerBenefitExpense: optionalImportAccount,
    withholdings: optionalImportAccount, deductions: optionalImportAccount, employerTaxLiability: optionalImportAccount,
    employerBenefitLiability: optionalImportAccount, clearing: optionalImportAccount,
  }).strict(),
  labelDimensionId: z.string().min(1).max(100).describe('Workspace dimension used to split expenses by the label column in the file.').optional(),
}).strict();

type PayrollFile = z.output<typeof payrollImportInput>;

function payrollFileFor(ctx: Pick<CommandContext, 'workspaceId' | 'actor'>, input: PayrollFile) {
  return { ...input, workspaceId: ctx.workspaceId, uid: ctx.actor };
}

function payrollFigures(totals: PayrollTotals, currency: string) {
  const people = `${totals.people} ${totals.people === 1 ? 'person' : 'people'}`;
  return `${people}, gross ${formatMoney(totals.grossCents, currency)}, net ${formatMoney(totals.netCents, currency)}`;
}

export const payrollImportCommand: CommandDefinition<typeof payrollImportInput, PayrollImportResult, PreparedPayrollImport, CommandAuditSummary[]> = {
  name: 'payroll.import',
  input: payrollImportInput,
  roles: RUNNERS,
  peopleOnly: true,
  // Pay dates are inside the CSV, not one input field. Recheck each one in the transaction and
  // keep the import's 409 and row-specific message if any of those periods has closed.
  prepare(ctx, input) {
    return preparePayrollImport(ctx.db, payrollFileFor(ctx, input));
  },
  async handler(ctx, tx, input) {
    const { currency, journals } = await preparePayrollJournals(
      ctx.db, payrollFileFor(ctx, input), ctx.prepared as PreparedPayrollImport, ctx.workspace, tx,
    );
    const entries: PayrollImportResult['entries'] = [];
    for (const { payDate, ref, tx: entry } of journals) {
      await ledgerWrite(tx, ref, { ...entry, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      entries.push({ transactionId: ref.id, payDate: payDate.payDate, totals: payDate.totals });
    }
    return { currency, entries };
  },
  async preview(ctx, input) {
    const file = payrollFileFor(ctx, input);
    const plan = await preparePayrollImport(ctx.db, file);
    const { currency, journals } = await preparePayrollJournals(ctx.db, file, plan, ctx.workspace);
    return {
      title: `Import ${PAYROLL_COLUMN_SETS[input.provider].name}`,
      lines: journals.map(({ payDate }) => `${payDate.payDate}: ${payrollFigures(payDate.totals, currency)}`),
      accounts: journals.flatMap(({ tx }) => tx.lines.map(({ accountId, accountName, amountCents, description, dimensions }) => {
        const label = input.labelDimensionId && dimensions?.[input.labelDimensionId];
        return { accountId, accountName, amountCents, description: label ? `${description} (${label})` : description };
      })),
    };
  },
  audit(input, result) {
    return result.entries.map(({ transactionId, payDate, totals }) => ({
      action: 'PAYROLL_IMPORTED', entityType: 'transactions', entityId: transactionId,
      description: `Imported the ${PAYROLL_COLUMN_SETS[input.provider].name} payroll of ${payDate}: ${payrollFigures(totals, result.currency)}`,
      details: { transactionId },
    }));
  },
  inverse(_input, result) {
    // A single entry can be reversed with the normal journal command. Several dates have no single
    // inverse: open each entry and reverse it using the appropriate date in an open period.
    if (result.entries.length !== 1) return null;
    const { transactionId, payDate } = result.entries[0];
    return { command: 'journal.reverse', input: { id: transactionId, reversalDate: payDate, reason: 'Undo payroll import' } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Record an outside payroll provider’s completed run as one journal per pay date from its CSV; use it for payroll accounting, not to run payroll or send pay.',
    example: {
      provider: 'gusto',
      csv: 'Pay Date,Employee,Gross Earnings,Net Pay\n2026-06-15,Example Employee,100.00,100.00',
      fileName: 'payroll-june.csv',
      accounts: { wages: 'acc_wages', clearing: 'acc_payroll_clearing' },
    },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The provider, file or account mapping is missing or malformed.', next: 'Choose ADP, Gusto or Paychex, a supported CSV export and the payroll accounts.' },
      { code: 'PAYROLL_FILE_INVALID', when: 'A file column, amount, label or account cannot be used.', next: 'Read the file problems, correct the export or mapping, and preview again.' },
      { code: 'INVALID_OPERATION_ID', when: 'The operation ID does not have the required format.', next: 'Use up to 128 letters, digits, underscores, hyphens, periods or colons.' },
      { code: 'PERIOD_LOCKED', when: 'At least one pay date is in a closed period.', next: 'Ask an authorised person to review the closed period before importing; do not change the pay date in the file.' },
      { code: 'CONFLICT', when: 'The same payroll was already recorded, or the operation ID belongs to another request.', next: 'Check the posted entries or retry the original request as sent; to correct a posting, reverse the affected entry first.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant of these books.', next: 'Ask a workspace owner or accountant to import the file.' },
      { code: 'PERSON_ONLY', when: 'The caller used an API key.', next: 'Sign in as an owner or accountant to import the file.' },
    ],
  },
};

export const PAYROLL_COMMANDS: AnyCommandDefinition[] = [
  payRunPostCommand, payRunUndoCommand, payRunApprovalCommand, payRunApproveCommand, payRunRejectCommand, payrollImportCommand,
];
