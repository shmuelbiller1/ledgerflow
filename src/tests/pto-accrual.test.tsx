/**
 * Paid time off (U-04): hours earned spread over the posted pay runs that paid the employee, plus the
 * hours brought in, less time taken; worth the balance at salary ÷ 2,080 an hour. Hand-checked.
 * The Payroll directory shows it, and "Time off" saves the allowance and the time taken.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { allowanceProblem, ptoBalance, timeOffProblem } from '../lib/ptoAccrual';
import PayrollView from '../components/hr/PayrollView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { Employee, PayRun } from '../types';

const ann = {
  id: 'ann', uid: 'u', workspaceId: 'component-workspace', name: 'Ann', role: 'Staff', salaryCents: 6_240_000, payFrequency: 'Monthly', status: 'Active',
  filingStatus: 'Single', state: 'TX', createdAt: '2026-01-01', ptoHoursPerYear: 96, ptoOpeningHours: 10,
  ptoTaken: [{ date: '2026-02-03', hours: 8 }, { date: '2026-03-10', hours: 4.5, note: 'Dentist' }],
} as Employee;
const run = (date: string, status: PayRun['status'], ids: string[]) => ({ date, status, employees: ids.map(employeeId => ({ employeeId })) });
const runs = [
  run('2026-01-31', 'processed', ['ann']), run('2026-02-28', 'processed', ['ann', 'bo']), run('2026-03-31', 'processed', ['ann']),
  run('2026-04-30', 'undone', ['ann']), run('2026-04-30', 'processed', ['bo']), run('2026-05-31', 'awaiting_approval', ['ann']),
];

describe('PTO balance', () => {
  test('8 hours per monthly run × 3 posted runs + 10 brought in − 12.5 taken = 21.5 hours, worth 21.5 × $30.00', () => {
    assert.deepEqual(ptoBalance(ann, runs), { earnedHours: 24, takenHours: 12.5, balanceHours: 21.5, valueCents: 64_500, runs: 3 });
  });

  test('as of a day: only the runs and time off up to it', () => {
    assert.deepEqual(ptoBalance(ann, runs, '2026-02-28'), { earnedHours: 16, takenHours: 8, balanceHours: 18, valueCents: 54_000, runs: 2 });
  });

  test('weekly pay spreads the year over 52 runs (40 h a year: 3 runs earn 2.31 h); contractors earn none', () => {
    const weekly = { ...ann, payFrequency: 'Weekly', ptoHoursPerYear: 40, ptoOpeningHours: 0, ptoTaken: [] } as Employee;
    assert.equal(ptoBalance(weekly, runs.slice(0, 3)).earnedHours, 2.31);
    assert.deepEqual(ptoBalance({ ...ann, workerType: 'contractor' }, runs), { earnedHours: 0, takenHours: 0, balanceHours: 0, valueCents: 0, runs: 0 });
  });

  test('refused: a day that does not exist, no hours, more than is available, three decimals; allowance 0–400 hours', () => {
    assert.match(String(timeOffProblem({ date: '2026-02-30', hours: 4 }, 20)), /day/);
    assert.match(String(timeOffProblem({ date: '2026-02-03', hours: 0 }, 20)), /hours/);
    assert.equal(timeOffProblem({ date: '2026-02-03', hours: 22 }, 21.5), 'Only 21.5 hours of time off are available');
    assert.match(String(timeOffProblem({ date: '2026-02-03', hours: 1.234 }, 20)), /two decimals/);
    assert.equal(timeOffProblem({ date: '2024-02-29', hours: 7.5 }, 21.5), null);
    assert.match(String(allowanceProblem(-1)), /zero or more/);
    assert.match(String(allowanceProblem(401)), /at most 400/);
    assert.equal(allowanceProblem(80.5), null);
  });
});

describe('Time off on the Payroll screen', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  const open = (role: 'owner' | 'viewer') => {
    setComponentWorkspace(role);
    useLedgerStore.setState({ employees: [ann], payRuns: runs as PayRun[], accounts: [] } as never);
    markComponentCollectionsLoaded('employees', 'payRuns');
    render(<PayrollView />);
    if (role === 'owner') fireEvent.click(screen.getByRole('button', { name: /Employee Directory/ }));
  };

  test('the directory shows the balance; recording time off saves it on the employee', async () => {
    const calls = stubFetchWithBodies(200, null);
    open('owner');
    assert.ok(screen.getByText('21.5 h'));
    assert.ok(screen.getByText('worth $645.00'));
    fireEvent.click(screen.getByRole('button', { name: 'Time off of Ann' }));
    assert.match(screen.getByRole('status').textContent || '', /21\.5 hours available \(worth \$645\.00\): 10 brought in \+ 24 earned by 3 pay runs − 12\.5 taken/);
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-04-06' } });
    fireEvent.change(screen.getByLabelText('Hours taken'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    assert.equal(screen.getByRole('alert').textContent, 'Only 21.5 hours of time off are available');
    assert.equal(calls.filter(c => c.url.includes('/rpc/')).length, 0, 'nothing saved');
    fireEvent.change(screen.getByLabelText('Hours taken'), { target: { value: '7.5' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })); });
    await waitFor(() => assert.equal(calls.filter(c => c.url.includes('/commands/employee.update')).length, 1));
    const body = calls.find(c => c.url.includes('/commands/employee.update'))!.body as { workspaceId: string; input: { id: string; ptoTaken: unknown[] } };
    assert.equal(body.workspaceId, 'component-workspace', 'the write names the workspace, not the row');
    assert.deepEqual(body.input.ptoTaken, [{ date: '2026-02-03', hours: 8 }, { date: '2026-03-10', hours: 4.5, note: 'Dentist' }, { date: '2026-04-06', hours: 7.5 }]);
    await waitFor(() => assert.ok(screen.getByText(/14 hours available/)));
  });

  test('a viewer cannot see a colleague’s payroll details even if stale data is in the store', () => {
    open('viewer');
    assert.ok(screen.getByText(/Payroll records are restricted/));
    assert.equal(screen.queryByText('21.5 h'), null);
    assert.equal(screen.queryByRole('button', { name: 'Time off of Ann' }), null);
  });
});
