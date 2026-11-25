import { z } from 'zod';
import { ratesProblem, timeProblem, TIME_KIND, type TimeEntry, type TimeInput, type TimeRates, type TimeStatus } from '../../lib/timeEntries';
import {
  changeTimeInTransaction,
  logTimeInTransaction,
  markInvoicedInTransaction,
  moveTimeInTransaction,
  removeTimeInTransaction,
  setRatesInTransaction,
  TimeError,
  type TimeEntryWriteResult,
  type TimeMoveWriteResult,
} from '../services/timeService';
import { notify } from '../services/notificationService';
import type { CommandDefinition } from './types';

const entryInputSchema = z.object({
  date: z.unknown().optional(),
  minutes: z.unknown().optional(),
  description: z.unknown().optional(),
  customerId: z.unknown().optional(),
  projectId: z.unknown().optional(),
  billable: z.unknown().optional(),
  rateCents: z.unknown().optional(),
  person: z.unknown().optional(),
}).passthrough();

export const timeLogInput = z.object({ entry: entryInputSchema }).strict();
export const timeUpdateInput = z.object({ entryId: z.string().min(1).max(200), entry: entryInputSchema }).strict();
export const timeRemoveInput = z.object({ entryId: z.string().min(1).max(200) }).strict();
export const timeMoveInput = z.object({ entryIds: z.unknown().optional(), to: z.unknown().optional(), note: z.unknown().optional() }).strict();
export const timeInvoiceInput = z.object({ entryIds: z.unknown().optional(), invoiceId: z.unknown().optional() }).strict();
export const timeRatesInput = z.object({ rates: z.unknown().optional() }).strict();

type TimeLogInput = z.output<typeof timeLogInput>;
type TimeUpdateInput = z.output<typeof timeUpdateInput>;
type TimeRemoveInput = z.output<typeof timeRemoveInput>;
type TimeMoveInput = z.output<typeof timeMoveInput>;
type TimeInvoiceInput = z.output<typeof timeInvoiceInput>;
type TimeRatesInput = z.output<typeof timeRatesInput>;
type TimeRemoveResult = { entry: TimeEntry };
type TimeRatesResult = Awaited<ReturnType<typeof setRatesInTransaction>>;
type TimeInvoiceResult = Awaited<ReturnType<typeof markInvoicedInTransaction>>;

const APPROVERS = ['owner', 'accountant'];
const canEdit = (entry: Omit<TimeEntry, 'id'>, actor: string, approver: boolean) =>
  entry.status !== 'invoiced' && !entry.paidRunId && (approver || (entry.person === actor && entry.status === 'open'));
const canMove = (from: TimeStatus, to: TimeStatus, own: boolean, approver: boolean) =>
  (to === 'submitted' && own && from === 'open')
  || (to === 'open' && own && from === 'submitted')
  || (to === 'approved' && approver && from === 'submitted')
  || (to === 'open' && approver && (from === 'submitted' || from === 'approved'));

export const timeLogCommand: CommandDefinition<typeof timeLogInput, TimeEntry> = {
  name: 'time.log',
  input: timeLogInput,
  roles: ['owner', 'accountant', 'bookkeeper', 'viewer'],
  async handler(ctx, tx, input: TimeLogInput) {
    return logTimeInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, entry: input.entry as TimeInput & { person?: unknown },
    });
  },
  async preview(ctx, input) {
    const entry = input.entry as TimeInput & { person?: unknown };
    const problem = timeProblem(entry);
    if (problem) throw new TimeError(400, problem);
    const person = typeof entry.person === 'string' && entry.person ? entry.person : ctx.actor;
    if (person !== ctx.actor && !APPROVERS.includes(ctx.role)) throw new TimeError(403, 'Only owners and accountants log time for someone else');
    const people = [...new Set([...(Array.isArray(ctx.workspace.members) ? ctx.workspace.members.map(String) : []), String(ctx.workspace.uid)])];
    if (!people.includes(person)) throw new TimeError(400, 'That person is not in this workspace');
    return {
      title: `Log ${entry.minutes} minutes of time`,
      lines: [`${String(entry.date)} · ${String(entry.description).trim()}`, `Person: ${person}`, entry.billable === true ? 'Billable time' : 'Not billable'],
    };
  },
  audit(_input, entry) {
    return {
      action: 'TIME_LOGGED',
      entityType: 'documents',
      entityId: entry.id,
      description: `Logged ${entry.minutes} minutes on ${entry.date}: ${entry.description}`,
    };
  },
  inverse(_input, entry) { return { command: 'time.remove', input: { entryId: entry.id } }; },
  risk: 'normal',
  describe: {
    sentence: 'Log your work time or, as an owner or accountant, time for another workspace member; do not use this to post an invoice.',
    example: { entry: { date: '2026-11-15', minutes: 90, description: 'Prepare the monthly close', billable: false } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The date, duration, description, customer, or rate is invalid.', next: 'Use a real YYYY-MM-DD date, 1 to 1440 whole minutes, a short description, and valid optional fields.' },
      { code: 'ROLE_REQUIRED', when: 'The caller tries to log for another person without an approver role.', next: 'Log time for yourself or ask an owner or accountant.' },
      { code: 'NOT_FOUND', when: 'The selected person or workspace does not exist.', next: 'Reload workspace members and select a current member.' },
    ],
  },
};

export const timeUpdateCommand: CommandDefinition<typeof timeUpdateInput, TimeEntryWriteResult> = {
  name: 'time.update',
  input: timeUpdateInput,
  roles: ['owner', 'accountant', 'bookkeeper', 'viewer'],
  async handler(ctx, tx, input: TimeUpdateInput) {
    return changeTimeInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, entryId: input.entryId, entry: input.entry as TimeInput,
    });
  },
  async preview(ctx, input) {
    const snapshot = await ctx.db.collection('documents').doc(input.entryId).get();
    const entry = snapshot.data() as Omit<TimeEntry, 'id'> | undefined;
    if (!entry || entry.kind !== TIME_KIND || entry.workspaceId !== ctx.workspaceId) throw new TimeError(404, 'That time entry is not in this workspace');
    if (!canEdit(entry, ctx.actor, APPROVERS.includes(ctx.role))) {
      throw new TimeError(entry.status === 'invoiced' ? 409 : 403,
        entry.status === 'invoiced' ? 'This time is on an invoice already' : 'Submitted time is changed by an owner or accountant, or sent back first');
    }
    const merged = { ...entry, ...(input.entry as TimeInput) };
    const problem = timeProblem(merged);
    if (problem) throw new TimeError(400, problem);
    return { title: `Update time entry for ${entry.date}`, lines: [String(merged.description || entry.description), `${String(merged.minutes)} minutes`] };
  },
  audit(_input, result) {
    return {
      action: 'TIME_UPDATED',
      entityType: 'documents',
      entityId: result.entry.id,
      description: `Updated time entry ${result.entry.date}: ${result.entry.description}`,
    };
  },
  inverse(input, result) {
    const previous = result.previous;
    if (!previous) return null;
    if (previous.rateCents === undefined && result.entry.rateCents !== undefined) return null;
    return {
      command: 'time.update',
      input: {
        entryId: input.entryId,
        entry: {
          date: previous.date,
          minutes: previous.minutes,
          description: previous.description,
          billable: previous.billable,
          customerId: previous.customerId || '',
          projectId: previous.projectId || '',
          ...(previous.rateCents !== undefined ? { rateCents: previous.rateCents } : {}),
        },
      },
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Edit an open entry you own or any entry as an owner or accountant; do not use it to change an entry already invoiced or paid.',
    example: { entryId: 'time_123', entry: { minutes: 120, description: 'Prepare the monthly close' } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'One or more supplied time fields are invalid.', next: 'Correct the date, minutes, description, customer, or hourly rate.' },
      { code: 'NOT_FOUND', when: 'The time entry is not in the selected workspace.', next: 'Reload the time list and select an existing entry.' },
      { code: 'ROLE_REQUIRED', when: 'The caller does not own an open entry and is not an owner or accountant.', next: 'Ask an owner or accountant to update submitted time.' },
      { code: 'CONFLICT', when: 'The entry has already been invoiced.', next: 'Edit the draft invoice or create a separate adjustment instead.' },
    ],
  },
};

export const timeRemoveCommand: CommandDefinition<typeof timeRemoveInput, TimeRemoveResult> = {
  name: 'time.remove',
  input: timeRemoveInput,
  roles: ['owner', 'accountant', 'bookkeeper', 'viewer'],
  async handler(ctx, tx, input: TimeRemoveInput) {
    const entry = await removeTimeInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, entryId: input.entryId,
    });
    return { entry: { ...entry, id: input.entryId } };
  },
  async preview(ctx, input) {
    const entry = (await ctx.db.collection('documents').doc(input.entryId).get()).data() as Omit<TimeEntry, 'id'> | undefined;
    if (!entry || entry.kind !== TIME_KIND || entry.workspaceId !== ctx.workspaceId) throw new TimeError(404, 'That time entry is not in this workspace');
    if (!canEdit(entry, ctx.actor, APPROVERS.includes(ctx.role))) throw new TimeError(403, 'This time can no longer be removed');
    return { title: `Remove time entry for ${entry.date}`, lines: [`${entry.minutes} minutes · ${entry.description}`] };
  },
  audit(_input, result) {
    return { action: 'TIME_REMOVED', entityType: 'documents', entityId: result.entry.id, description: `Removed time entry ${result.entry.date}: ${result.entry.description}` };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Remove an open entry you own or an entry an owner or accountant may edit; do not use this to remove invoiced or payroll-paid time.',
    example: { entryId: 'time_123' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The time entry is not in the selected workspace.', next: 'Reload the time list and select an existing entry.' },
      { code: 'ROLE_REQUIRED', when: 'The caller cannot edit this entry or it is locked.', next: 'Ask an owner or accountant to review submitted time; invoiced or paid entries cannot be removed here.' },
    ],
  },
};

export const timeMoveCommand: CommandDefinition<typeof timeMoveInput, TimeMoveWriteResult> = {
  name: 'time.move',
  input: timeMoveInput,
  roles: ['owner', 'accountant', 'bookkeeper', 'viewer'],
  async handler(ctx, tx, input: TimeMoveInput) {
    const result = await moveTimeInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, entryIds: input.entryIds, to: input.to, note: input.note,
    });
    if (result.to !== 'submitted' && result.notifyPeople.length > 0) {
      ctx.afterCommit(async () => {
        await notify(ctx.db, {
          workspaceId: ctx.workspaceId,
          kind: 'time.decided',
          title: result.to === 'approved' ? 'Your time was approved' : 'Your time was sent back',
          message: `${result.entries.length} ${result.entries.length === 1 ? 'entry' : 'entries'}${result.note ? `: ${result.note}` : ''}`,
          eventKey: `time:${result.to}:${result.requestedIds.join(',').slice(0, 200)}:${Date.now()}`,
          actorUid: ctx.actor,
          onlyUids: result.notifyPeople,
        });
      });
    }
    return result;
  },
  async preview(ctx, input) {
    if (!['submitted', 'open', 'approved'].includes(String(input.to))) throw new TimeError(400, 'Submit, approve or send back');
    if (!Array.isArray(input.entryIds) || input.entryIds.length === 0 || input.entryIds.length > 500) throw new TimeError(400, 'Choose the time entries');
    const approver = APPROVERS.includes(ctx.role);
    const ids = [...new Set(input.entryIds.map(String))];
    const entries: Array<Omit<TimeEntry, 'id'>> = [];
    for (const id of ids) {
      const entry = (await ctx.db.collection('documents').doc(id).get()).data() as Omit<TimeEntry, 'id'> | undefined;
      if (!entry || entry.kind !== TIME_KIND || entry.workspaceId !== ctx.workspaceId) throw new TimeError(404, 'That time entry is not in this workspace');
      const own = entry.person === ctx.actor;
      const to = input.to as TimeStatus;
      if (!canMove(entry.status, to, own, approver)) {
        throw new TimeError(approver || own ? 409 : 403,
          `A ${entry.date} entry is ${entry.status}: it cannot be made ${to === 'open' ? 'open again' : to}`);
      }
      if (entry.paidRunId) throw new TimeError(409, `The ${entry.date} entry was paid in a pay run: undo that run first`);
      entries.push(entry);
    }
    return {
      title: `${input.to === 'approved' ? 'Approve' : input.to === 'submitted' ? 'Submit' : 'Send back'} ${entries.length} time ${entries.length === 1 ? 'entry' : 'entries'}`,
      lines: entries.map(entry => `${entry.date} · ${entry.description} · ${entry.minutes} minutes`),
    };
  },
  audit(_input, result) {
    const verb = result.to === 'approved' ? 'approved' : result.to === 'submitted' ? 'submitted' : 'opened again';
    return {
      action: result.to === 'approved' ? 'TIME_APPROVED' : result.to === 'submitted' ? 'TIME_SUBMITTED' : 'TIME_SENT_BACK',
      entityType: 'documents',
      entityId: result.requestedIds[0] || result.entries[0]?.id || '',
      description: `${result.entries.length} time ${result.entries.length === 1 ? 'entry' : 'entries'} ${verb}`,
      details: { entries: result.requestedCount },
    };
  },
  inverse(_input, result) {
    // Only submission has a universally valid, exact inverse; approvals cannot be downgraded
    // through this workflow, and send-backs may mix prior states or be initiated for others.
    return result.to === 'submitted' && result.entries.length > 0
      ? { command: 'time.move', input: { entryIds: result.entries.map(entry => entry.id), to: 'open' } }
      : null;
  },
  risk: 'normal',
  describe: {
    sentence: 'Submit your open time, withdraw your submitted time, or approve or send back time as an owner or accountant; do not use it to invoice time.',
    example: { entryIds: ['time_123', 'time_124'], to: 'approved' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The target state or list of entries is invalid.', next: 'Choose submitted, open, or approved and between 1 and 500 entry ids.' },
      { code: 'NOT_FOUND', when: 'An entry is not in the selected workspace.', next: 'Reload the time list and retry with entries from this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller cannot move one of the selected entries.', next: 'Submit or withdraw your own time, or ask an owner or accountant to approve it.' },
      { code: 'CONFLICT', when: 'An entry is not in the requested state or was paid in a pay run.', next: 'Resolve the conflicting entry or undo the pay run before retrying.' },
    ],
  },
};

export const timeInvoiceCommand: CommandDefinition<typeof timeInvoiceInput, TimeInvoiceResult> = {
  name: 'time.invoice',
  input: timeInvoiceInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, tx, input: TimeInvoiceInput) {
    return markInvoicedInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, entryIds: input.entryIds, invoiceId: input.invoiceId,
    });
  },
  async preview(ctx, input) {
    if (!Array.isArray(input.entryIds) || input.entryIds.length === 0 || input.entryIds.length > 500 || typeof input.invoiceId !== 'string') {
      throw new TimeError(400, 'Choose the time and the invoice');
    }
    const invoice = (await ctx.db.collection('invoices').doc(input.invoiceId).get()).data();
    if (!invoice || invoice.workspaceId !== ctx.workspaceId) throw new TimeError(404, 'That invoice is not in this workspace', 'INVOICE_MISSING');
    const ids = [...new Set(input.entryIds.map(String))];
    const entries: Array<Omit<TimeEntry, 'id'>> = [];
    for (const id of ids) {
      const entry = (await ctx.db.collection('documents').doc(id).get()).data() as Omit<TimeEntry, 'id'> | undefined;
      if (!entry || entry.kind !== TIME_KIND || entry.workspaceId !== ctx.workspaceId) throw new TimeError(404, 'That time entry is not in this workspace');
      if (!(entry.status === 'invoiced' && entry.invoiceId === input.invoiceId)
        && (entry.status !== 'approved' || !entry.billable || entry.invoiceId)) {
        throw new TimeError(409, `The ${entry.date} entry is not approved billable time waiting for an invoice`);
      }
      entries.push(entry);
    }
    return { title: `Mark ${entries.length} approved time ${entries.length === 1 ? 'entry' : 'entries'} invoiced`, lines: [`Invoice ${String(invoice.number || input.invoiceId)}`, ...entries.map(entry => `${entry.date} · ${entry.description}`)] };
  },
  audit(_input, result) {
    if (result.updated === 0) return null;
    return {
      action: 'TIME_INVOICED',
      entityType: 'invoices',
      entityId: result.invoiceId,
      description: `Marked ${result.updated} time ${result.updated === 1 ? 'entry' : 'entries'} invoiced`,
      details: { entries: result.updated, requestedEntries: result.invoiced, entryIds: result.entryIds },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Lock approved billable time to a draft invoice after its lines have been added; do not use this command to create invoice lines or post the invoice.',
    example: { entryIds: ['time_123'], invoiceId: 'invoice_123' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The invoice id or time-entry list is missing or malformed.', next: 'Choose a draft invoice and between 1 and 500 time-entry ids.' },
      { code: 'INVOICE_MISSING', when: 'The invoice is not in the selected workspace (deleted since).', next: 'Make a new draft invoice for this time.' },
      { code: 'INVOICE_VOID', when: 'The invoice was voided.', next: 'Make a new draft invoice for this time.' },
      { code: 'NOT_FOUND', when: 'A time entry is not in the selected workspace.', next: 'Reload the time list and select entries from this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace bookkeeper or above to invoice time.' },
      { code: 'CONFLICT', when: 'An entry is not approved billable time waiting for this invoice.', next: 'Approve the time first or remove its existing invoice assignment.' },
    ],
  },
};

export const timeRatesCommand: CommandDefinition<typeof timeRatesInput, TimeRatesResult> = {
  name: 'time.rates',
  input: timeRatesInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, tx, input: TimeRatesInput) {
    return setRatesInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, rates: input.rates,
    });
  },
  async preview(ctx, input) {
    const problem = ratesProblem(input.rates);
    if (problem) throw new TimeError(400, problem);
    const rates = input.rates as TimeRates;
    const count = Object.values(rates).reduce((sum, map) => sum + Object.keys(map || {}).length, 0);
    return { title: 'Set hourly time rates', lines: [`${count} rate ${count === 1 ? 'entry' : 'entries'}`] };
  },
  audit(_input, result) {
    return { action: 'TIME_RATES_SET', entityType: 'documents', entityId: result.ratesId, description: 'Hourly rates changed' };
  },
  inverse(_input, result) { return { command: 'time.rates', input: { rates: result.previousRates } }; },
  risk: 'normal',
  describe: {
    sentence: 'Set hourly rates by project, customer, or person for future time-value calculations; do not use this to edit the rate stored on an individual entry.',
    example: { rates: { projects: { project_1: 9500 }, customers: { customer_1: 8000 }, people: { user_1: 7000 } } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A rate is missing, negative, fractional, or the maps are too large.', next: 'Use nonnegative whole cents per hour in maps of up to 2,000 entries.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask a workspace owner or accountant to maintain hourly rates.' },
      { code: 'NOT_FOUND', when: 'The selected workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
  },
};
