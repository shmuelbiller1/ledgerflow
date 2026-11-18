import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { CommandContext, CommandDefinition } from './types';

/**
 * A person on the payroll roster, written as commands instead of five browser writes.
 *
 * The roster was changed from four cells and one dialog: `DeductionsCell`, `HourlyPayCell`, `TimeOffCell`,
 * `DirectDepositDialog` and `PayrollView` each opened the row with `updateDoc`/`setDoc` and typed `updatedAt`
 * themselves. What that could not promise is what matters for pay: nothing recorded who set a garnishment or a bank
 * account, a role that may look at the roster could write it, and an id from another workspace was an update anyone
 * could send (`setDoc` creates the row if it is missing).
 *
 * `employee.update` takes one allowlisted group of fields — the roster's own columns — and refuses everything else,
 * including the pay figures a pay run computes (`netCents`, `grossCents`), so a rate can be corrected but a run's
 * result cannot be back-edited through this door. `employee.create` writes the roster row with the workspace from the
 * request, not from the payload.
 *
 * What it is **not**: a pay run. Nothing here posts a wage, moves a liability or changes a posted figure — the run
 * reads the roster and posts through its own commands. Deliberately metadata only, exactly as the cells were.
 */
const idSchema = z.string().trim().min(1).max(120).refine(id => !id.includes('/'), 'Id cannot contain a slash');

/** Whole cents, never a float: every figure on this row is compared with a pay run's. */
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = (max: number) => z.string().trim().max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is YYYY-MM-DD');

/** A deduction as the payroll engine reads it: a kind, and either an amount or a percentage of gross. */
const deductionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: text(120).min(1),
  kind: z.enum(['pre_tax', 'post_tax', 'garnishment']),
  amountCents: cents.optional(),
  percent: z.number().min(0).max(100).optional(),
  maxPercent: z.number().min(0).max(100).optional(),
}).strict();

export const employeeCreateInput = z.object({
  /** the roster id the screen already minted, so a retry after a dropped answer does not add the person twice */
  id: idSchema,
  name: text(160).min(1),
  email: z.string().trim().email().max(200).optional(),
  role: text(120).optional(),
  salaryCents: cents,
  payFrequency: z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly']),
  filingStatus: text(40),
  workerType: z.enum(['employee', 'contractor']),
  state: text(40).optional(),
  status: z.enum(['Active', 'Terminated', 'On leave']).default('Active'),
  createdAt: z.string().trim().max(40).optional(),
}).strict();

export const employeeUpdateInput = z.object({
  id: idSchema,
  /** the fields the roster's own cells write; anything else is refused, including a pay run's results */
  name: text(160).min(1).optional(),
  email: z.string().trim().email().max(200).optional(),
  role: text(120).optional(),
  salaryCents: cents.optional(),
  payFrequency: z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly']).optional(),
  filingStatus: text(40).optional(),
  workerType: z.enum(['employee', 'contractor']).optional(),
  state: text(40).optional(),
  status: z.enum(['Active', 'Terminated', 'On leave']).optional(),
  payType: z.enum(['salary', 'hourly']).optional(),
  hourlyRateCents: cents.optional(),
  /** the time-tracking identity this person's hours come from; one person's time pays one employee */
  timeUid: text(120).optional(),
  deductions: z.array(deductionSchema).max(40).optional(),
  bankRouting: text(20).optional(),
  bankAccount: text(40).optional(),
  bankAccountType: z.enum(['checking', 'savings']).optional(),
  ptoHoursPerYear: z.number().min(0).max(10000).optional(),
  ptoOpeningHours: z.number().min(-10000).max(10000).optional(),
  ptoTaken: z.array(z.object({
    id: z.string().trim().min(1).max(120).optional(),
    date: day,
    hours: z.number().min(-1000).max(1000),
    note: text(200).optional(),
  }).strict()).max(400).optional(),
}).strict();

const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;
type CreateInput = z.output<typeof employeeCreateInput>;
type UpdateInput = z.output<typeof employeeUpdateInput>;
type EmployeeRow = Record<string, unknown> & { id?: string };
export type EmployeeSaved = { id: string; created: boolean; fields: string[] };

/** The row exists and belongs to the workspace the request named; a roster id from another one is not found. */
async function requireEmployee(ctx: CommandContext, tx: { get(ref: unknown): Promise<{ exists: boolean; data(): EmployeeRow | undefined }> }, id: string) {
  const ref = ctx.db.collection('employees').doc(id);
  const snapshot = await tx.get(ref) as { exists: boolean; data(): EmployeeRow | undefined };
  const row = snapshot.data();
  if (!snapshot.exists || row?.workspaceId !== ctx.workspaceId) {
    throw Object.assign(new HttpError('This person is not on the roster of the selected workspace.', 404), { code: 'NOT_FOUND' });
  }
  return { ref, row: row as EmployeeRow };
}

export const employeeCreateCommand: CommandDefinition<typeof employeeCreateInput, EmployeeSaved> = {
  name: 'employee.create',
  input: employeeCreateInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: CreateInput) {
    const ref = ctx.db.collection('employees').doc(input.id);
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      const row = snapshot.data() as EmployeeRow | undefined;
      if (row?.workspaceId !== ctx.workspaceId) {
        throw Object.assign(new HttpError('That roster id is already used in another workspace.', 409), { code: 'CONFLICT' });
      }
      // a retry of the same add: the row is already there, and adding it twice would double the roster
      return { id: input.id, created: false, fields: [] };
    }
    const { id, createdAt, ...fields } = input;
    tx.set(ref, {
      ...fields,
      id,
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { id, created: true, fields: Object.keys(fields) };
  },
  async preview(_ctx: CommandContext, input: CreateInput) {
    return { title: `Add ${input.name} to the roster`, lines: [input.role || 'Team member', `${input.payFrequency}, ${input.workerType}`] };
  },
  audit(_input: CreateInput, result: EmployeeSaved) {
    return {
      action: 'EMPLOYEE_ADDED',
      entityType: 'employees',
      entityId: result.id,
      description: result.created ? `Added ${result.id} to the payroll roster` : `Roster entry ${result.id} was already there`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Add one person to the payroll roster with their salary and filing details; do not use it to pay them, which a pay run does.',
    example: { id: 'emp_1', name: 'Dana Ruiz', salaryCents: 7200000, payFrequency: 'monthly', filingStatus: 'Single', workerType: 'employee' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The salary is not whole cents, the pay frequency is not one this payroll supports, or the email is not an address.', next: 'Send the salary in cents and one of weekly/biweekly/semimonthly/monthly.' },
      { code: 'CONFLICT', when: 'The roster id is already used in another workspace.', next: 'Let the screen mint a fresh id for this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to add the person.' },
    ],
    next: [{ command: 'employee.update', label: 'Change their details' }],
  },
};

export const employeeUpdateCommand: CommandDefinition<typeof employeeUpdateInput, EmployeeSaved> = {
  name: 'employee.update',
  input: employeeUpdateInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: UpdateInput) {
    const { ref } = await requireEmployee(ctx, tx as never, input.id);
    const { id: _id, ...fields } = input;
    const names = Object.keys(fields);
    if (names.length === 0) return { id: input.id, created: false, fields: [] };
    tx.update(ref, { ...fields, updatedAt: new Date().toISOString() });
    return { id: input.id, created: false, fields: names };
  },
  async preview(ctx: CommandContext, input: UpdateInput) {
    const snapshot = await ctx.db.collection('employees').doc(input.id).get();
    const row = snapshot.data() as EmployeeRow | undefined;
    if (!snapshot.exists || row?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This person is not on the roster of the selected workspace.', 404);
    }
    return {
      title: `Change ${String(row?.name || input.id)}`,
      lines: Object.keys(input).filter(key => key !== 'id').map(key => `Sets ${key}`),
    };
  },
  audit(_input: UpdateInput, result: EmployeeSaved) {
    return {
      action: 'EMPLOYEE_UPDATED',
      entityType: 'employees',
      entityId: result.id,
      description: result.fields.length ? `Changed ${result.fields.join(', ')} on ${result.id}` : `Saved ${result.id} with no change`,
      details: { fields: result.fields },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Change a roster entry — rate, pay type, deductions, holiday hours, direct deposit, title or status; do not use it to change what a pay run already paid.',
    example: { id: 'emp_1', hourlyRateCents: 2500, payType: 'hourly', timeUid: 'time_ana' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A figure is not whole cents, a percentage is outside 0–100, or the payload names a field the roster does not keep (a pay run\'s net or gross is one).', next: 'Send only roster fields, with amounts in cents.' },
      { code: 'NOT_FOUND', when: 'The person is not on this workspace\'s roster.', next: 'Reload the roster and choose a person in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to change the roster.' },
    ],
    next: [{ command: 'employee.create', label: 'Add a person' }],
  },
};
