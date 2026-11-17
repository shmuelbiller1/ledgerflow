/**
 * Writing off a bad debt (K-19) and spreading a bill's expense or an invoice's income over months
 * (K-17, K-16) — and the undos. Each service already owned its rule, its transaction, its audit line
 * and its period-lock answer (409, the service's own wording), so these commands are the registered
 * door in front of it: the runner checks the workspace and the caller's role, and the service checks
 * the rest and writes. They deliberately declare no `dated`: the service's lock answer is a 409 with
 * its own words, and the runner's dated check answers 400 before the service is reached.
 */
import { z } from 'zod';
import { reverseWriteOff, writeOffInvoice } from '../services/badDebtService';
import { spreadBillExpense, spreadInvoiceRevenue, undoBillSpread, undoInvoiceSpread } from '../services/prepaidService';
import type { AnyCommandDefinition, CommandDefinition } from './types';

const WRITERS = ['owner', 'accountant', 'bookkeeper'] as const;
const ADMINS = ['owner', 'accountant'] as const;
const id = z.string().min(1).max(200);

// --------------------------------------------------------------------------- bad debt

export const invoiceWriteOffInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  invoiceId: id,
  badDebtAccountId: z.string().min(1).max(200).optional(),
  date: z.string().optional(),
  reason: z.string().max(300).optional(),
}).strict();

type WriteOffInput = z.output<typeof invoiceWriteOffInput>;

export const invoiceWriteOffCommand: CommandDefinition<typeof invoiceWriteOffInput, Record<string, unknown>> = {
  name: 'invoice.writeoff',
  input: invoiceWriteOffInput,
  roles: [...ADMINS],
  async handler(ctx, _tx, input: WriteOffInput) {
    const { workspaceId: _bodyWorkspaceId, ...rest } = input;
    return writeOffInvoice(ctx.db, { ...rest, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: 'Write off the bad debt',
      lines: [
        `Invoice ${input.invoiceId}${input.date ? ` on ${input.date}` : ' today'}`,
        'The amount still due leaves Accounts Receivable for the bad debt expense',
      ],
    };
  },
  audit() { return null; },
  inverse(input) { return { command: 'invoice.writeoffreverse', input: { invoiceId: input.invoiceId } }; },
  risk: 'normal',
  describe: {
    sentence: 'Write off what an invoice still owes as a bad debt, one entry out of Accounts Receivable; do not use it to change the invoice or to record a payment that arrived.',
    example: { invoiceId: 'invoice_123', date: '2026-06-30', reason: 'Customer in liquidation' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The invoice or the bad debt account is not a real one, or the date is not a day.', next: 'Send the invoice, a real date and an expense account for the bad debt.' },
      { code: 'CONFLICT', when: 'The invoice is a draft, void, cancelled or already paid, or nothing is left to write off.', next: 'Write off only an open invoice that still owes money.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner or an accountant.', next: 'Ask an owner or an accountant.' },
      { code: 'PERIOD_LOCKED', when: 'The write-off date is in a closed period.', next: 'Choose an open date.' },
    ],
  },
};

export const invoiceWriteOffReverseInput = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  invoiceId: id,
  date: z.string().optional(),
  reason: z.string().max(300).optional(),
}).strict();

export const invoiceWriteOffReverseCommand: CommandDefinition<typeof invoiceWriteOffReverseInput, Record<string, unknown>> = {
  name: 'invoice.writeoffreverse',
  input: invoiceWriteOffReverseInput,
  roles: [...ADMINS],
  async handler(ctx, _tx, input) {
    const { workspaceId: _bodyWorkspaceId, ...rest } = input;
    return reverseWriteOff(ctx.db, { ...rest, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: 'Reverse the write-off',
      lines: [`Invoice ${input.invoiceId}${input.date ? ` on ${input.date}` : ' today'}`, 'The written-off amount comes back as due, with its entry reversed'],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Reverse a bad-debt write-off when the money turns out to be collectable after all; do not use it to record the payment — that is payment.receive.',
    example: { invoiceId: 'invoice_123', date: '2026-07-15', reason: 'Customer paid after all' },
    refusals: [
      { code: 'CONFLICT', when: 'The invoice is not written off, or the write-off was already reversed.', next: 'Reverse a write-off that is still in force.' },
      { code: 'INVALID_INPUT', when: 'The date is before the write-off date.', next: 'Choose a date on or after the write-off.' },
    ],
  },
};

// --------------------------------------------------------------------------- prepaid expense (bill)

const spreadBase = {
  workspaceId: z.string().min(1).max(200).optional(),
  amountCents: z.number().int().positive(),
  months: z.number().int().min(2).max(60),
  startMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
};

export const billSpreadInput = z.object({
  ...spreadBase,
  billId: id,
  expenseAccountId: z.string().min(1).max(200),
  prepaidAccountId: z.string().min(1).max(200).optional(),
}).strict();

export const billSpreadCommand: CommandDefinition<typeof billSpreadInput, Record<string, unknown>> = {
  name: 'bill.spread',
  input: billSpreadInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input) {
    const { workspaceId: _bodyWorkspaceId, ...rest } = input;
    return spreadBillExpense(ctx.db, { ...rest, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: 'Spread the bill over months',
      lines: [`${input.amountCents} cents over ${input.months} months from ${input.startMonth || 'its month'}`, 'One entry moves it to Prepaid; a share comes back to the expense at each month end'],
    };
  },
  audit() { return null; },
  inverse(input) { return { command: 'bill.spreadundo', input: { billId: input.billId } }; },
  risk: 'normal',
  describe: {
    sentence: "Spread a posted bill's expense over the months it covers; do not use it on a draft bill or to change what the bill costs.",
    example: { billId: 'bill_123', expenseAccountId: 'acc_insurance', amountCents: 120000, months: 12 },
    refusals: [
      { code: 'CONFLICT', when: 'The bill is not posted, is already spread, or its date is in a closed period.', next: 'Spread a posted bill that is not spread yet, from an open period.' },
      { code: 'INVALID_INPUT', when: 'The amount is more than the bill, the months are outside 2–60, or the account is not an expense account.', next: 'Choose an expense account and no more than the bill over 2 to 60 months.' },
      { code: 'FORBIDDEN', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};

export const billSpreadUndoInput = z.object({ workspaceId: z.string().min(1).max(200).optional(), billId: id }).strict();

export const billSpreadUndoCommand: CommandDefinition<typeof billSpreadUndoInput, Record<string, unknown>> = {
  name: 'bill.spreadundo',
  input: billSpreadUndoInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input) {
    return undoBillSpread(ctx.db, { billId: input.billId, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }) as Promise<Record<string, unknown>>;
  },
  async preview() {
    return { title: 'Undo the spread', lines: ['Every share is voided and the bill is no longer spread'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Undo spreading a bill over months while none of its months is closed; do not use it to void the bill.',
    example: { billId: 'bill_123' },
    refusals: [
      { code: 'CONFLICT', when: 'The bill is not spread, or one of its months is closed.', next: 'Reopen the month first, or spread a bill that is spread.' },
    ],
  },
};

// --------------------------------------------------------------------------- deferred revenue (invoice)

export const invoiceSpreadInput = z.object({
  ...spreadBase,
  invoiceId: id,
  revenueAccountId: z.string().min(1).max(200),
  deferredAccountId: z.string().min(1).max(200).optional(),
}).strict();

export const invoiceSpreadCommand: CommandDefinition<typeof invoiceSpreadInput, Record<string, unknown>> = {
  name: 'invoice.spread',
  input: invoiceSpreadInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input) {
    const { workspaceId: _bodyWorkspaceId, ...rest } = input;
    return spreadInvoiceRevenue(ctx.db, { ...rest, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: 'Spread the income over months',
      lines: [`${input.amountCents} cents over ${input.months} months from ${input.startMonth || 'its month'}`, 'The income waits in Deferred Revenue and is earned a share at each month end'],
    };
  },
  audit() { return null; },
  inverse(input) { return { command: 'invoice.spreadundo', input: { invoiceId: input.invoiceId } }; },
  risk: 'normal',
  describe: {
    sentence: "Spread an issued invoice's income over the months it is earned; do not use it on a draft invoice or to change what the invoice bills.",
    example: { invoiceId: 'invoice_123', revenueAccountId: 'acc_service', amountCents: 120000, months: 12 },
    refusals: [
      { code: 'CONFLICT', when: 'The invoice is not issued, is already spread, or its date is in a closed period.', next: 'Spread an issued invoice that is not spread yet, from an open period.' },
      { code: 'INVALID_INPUT', when: 'The amount is more than the invoice, the months are outside 2–60, or the account is not income.', next: 'Choose an income account and no more than the invoice over 2 to 60 months.' },
      { code: 'FORBIDDEN', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};

export const invoiceSpreadUndoInput = z.object({ workspaceId: z.string().min(1).max(200).optional(), invoiceId: id }).strict();

export const invoiceSpreadUndoCommand: CommandDefinition<typeof invoiceSpreadUndoInput, Record<string, unknown>> = {
  name: 'invoice.spreadundo',
  input: invoiceSpreadUndoInput,
  roles: [...WRITERS],
  async handler(ctx, _tx, input) {
    return undoInvoiceSpread(ctx.db, { invoiceId: input.invoiceId, workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email }) as Promise<Record<string, unknown>>;
  },
  async preview() {
    return { title: 'Undo the spread', lines: ['Every share is voided and the invoice is no longer spread'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Undo spreading an invoice over months while none of its months is closed; do not use it to void the invoice.',
    example: { invoiceId: 'invoice_123' },
    refusals: [
      { code: 'CONFLICT', when: 'The invoice is not spread, or one of its months is closed.', next: 'Reopen the month first, or spread an invoice that is spread.' },
    ],
  },
};

export const DOCUMENT_ADJUSTMENT_COMMANDS: AnyCommandDefinition[] = [
  invoiceWriteOffCommand, invoiceWriteOffReverseCommand,
  billSpreadCommand, billSpreadUndoCommand,
  invoiceSpreadCommand, invoiceSpreadUndoCommand,
];
