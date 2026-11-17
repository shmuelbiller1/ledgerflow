/**
 * `employee.create` / `employee.update` — the roster as commands.
 *
 * Five browser writes became two commands: the add on the payroll screen, and the four cells (deductions, hourly pay,
 * holiday hours, direct deposit). These tests hold them to what those writes could not promise — an audit line, a
 * role, a workspace check, and a refusal that a pay run's own figures cannot be back-edited through the roster.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { employeeCreateCommand, employeeCreateInput, employeeUpdateCommand, employeeUpdateInput } from '../server/commands/employees';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const runCreate = (input: unknown, db: MemoryDb, user = owner) =>
  executeCommand(fakeRequest(user, { workspaceId, input }), captureResponse().response,
    { definition: employeeCreateCommand, workspaceId, input }, runnerDependencies(db));
const runUpdate = (input: unknown, db: MemoryDb, user = owner) =>
  executeCommand(fakeRequest(user, { workspaceId, input }), captureResponse().response,
    { definition: employeeUpdateCommand, workspaceId, input }, runnerDependencies(db));

const person = {
  id: 'emp_ana', name: 'Ana Silva', salaryCents: 6200000, payFrequency: 'monthly',
  filingStatus: 'Single', workerType: 'employee',
} as const;

test('a person is added with the workspace from the request, and adding the same id twice does not double the roster', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const first = await runCreate(employeeCreateInput.parse(person), db);
  assert.equal(first.ok, true);
  assert.equal((first as unknown as { data: { created: boolean } }).data.created, true);
  const row = db.read('employees/emp_ana')!;
  assert.equal(row.workspaceId, workspaceId);
  assert.equal(row.status, 'Active');
  assert.equal(row.uid, owner.uid);

  const again = await runCreate(employeeCreateInput.parse(person), db);
  assert.equal(again.ok, true);
  assert.equal((again as unknown as { data: { created: boolean } }).data.created, false, 'a retry is answered, not repeated');
  assert.equal(db.entries('employees').length, 1);
});

test('a roster id that belongs to another workspace is refused rather than taken over', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('employees/emp_ana', { id: 'emp_ana', workspaceId: 'someone-else', name: 'Someone' });
  const outcome = await runCreate(employeeCreateInput.parse(person), db);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as unknown as { code?: string }).code, 'CONFLICT');
  assert.equal(db.read('employees/emp_ana')!.workspaceId, 'someone-else');
});

test('a cell changes only its own fields, and the row says when', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('employees/emp_ana', { ...person, workspaceId, name: 'Ana Silva', createdAt: '2026-01-01T00:00:00.000Z' });
  const outcome = await runUpdate(employeeUpdateInput.parse({ id: 'emp_ana', hourlyRateCents: 2500, payType: 'hourly', timeUid: 'time_ana' }), db);
  assert.equal(outcome.ok, true);
  const row = db.read('employees/emp_ana')!;
  assert.equal(row.hourlyRateCents, 2500);
  assert.equal(row.payType, 'hourly');
  assert.equal(row.timeUid, 'time_ana');
  assert.equal(row.salaryCents, 6200000, 'the salary is not touched by a pay-type change');
  assert.equal(row.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(typeof row.updatedAt, 'string');
});

test('a pay run\'s own figures cannot be written back through the roster', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('employees/emp_ana', { ...person, workspaceId, name: 'Ana Silva' });
  for (const bad of [{ netCents: 100 }, { grossCents: 100 }, { quantityAtHand: 3 }, { surprise: true }]) {
    assert.equal(employeeUpdateInput.safeParse({ id: 'emp_ana', ...bad }).success, false, JSON.stringify(bad));
  }
  assert.equal(employeeUpdateInput.safeParse({ id: 'emp_ana', salaryCents: -1 }).success, false, 'a negative salary is refused');
  assert.equal(employeeUpdateInput.safeParse({ id: 'emp_ana', deductions: [{ id: 'd1', name: 'Levy', kind: 'garnishment', percent: 140 }] }).success, false, 'a percentage above 100 is refused');
});

test('deductions and holiday hours are written as the roster keeps them', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('employees/emp_ana', { ...person, workspaceId });
  const outcome = await runUpdate(employeeUpdateInput.parse({
    id: 'emp_ana',
    deductions: [{ id: 'd1', name: 'Levy', kind: 'garnishment', amountCents: 25000, maxPercent: 25 }],
    ptoHoursPerYear: 120,
    ptoOpeningHours: 8,
    ptoTaken: [{ id: 't1', date: '2026-03-04', hours: 6, note: 'Dentist' }],
  }), db);
  assert.equal(outcome.ok, true);
  const row = db.read('employees/emp_ana')!;
  assert.deepEqual(row.deductions, [{ id: 'd1', name: 'Levy', kind: 'garnishment', amountCents: 25000, maxPercent: 25 }]);
  assert.equal(row.ptoHoursPerYear, 120);
  assert.deepEqual(row.ptoTaken, [{ id: 't1', date: '2026-03-04', hours: 6, note: 'Dentist' }]);
});

test('a person in another workspace, or a viewer, is refused', async () => {
  const db = new MemoryDb();
  seedWorkspace(db, workspaceId, { uid: 'someone-else', roles: { [owner.uid]: 'viewer' } });
  db.seed('employees/emp_ana', { ...person, workspaceId });
  const viewer = await runUpdate(employeeUpdateInput.parse({ id: 'emp_ana', salaryCents: 1 }), db);
  assert.equal(viewer.ok, false);
  assert.equal((viewer as unknown as { code?: string }).code, 'ROLE_REQUIRED');
  assert.equal(db.read('employees/emp_ana')!.salaryCents, 6200000);

  const other = new MemoryDb();
  seedWorkspace(other);
  other.seed('employees/emp_ana', { ...person, workspaceId: 'someone-else' });
  const missing = await runUpdate(employeeUpdateInput.parse({ id: 'emp_ana', salaryCents: 1 }), other);
  assert.equal(missing.ok, false);
  assert.equal((missing as unknown as { code?: string }).code, 'NOT_FOUND');
});

test('the commands say what they are not: a pay run does the paying', async () => {
  assert.match(employeeCreateCommand.describe.sentence, /do not use it to pay them/);
  assert.match(employeeUpdateCommand.describe.sentence, /pay run already paid/);
  assert.equal(employeeCreateCommand.risk, 'normal');
  assert.equal(employeeUpdateCommand.inverse?.({ id: 'emp_ana' } as never, { id: 'emp_ana', created: false, fields: [] }), null);
});
