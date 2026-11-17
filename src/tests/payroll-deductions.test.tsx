/**
 * Deductions (U-05) and garnishments (U-06): pre-tax ones lower taxable pay exactly like the one
 * pre-tax amount kept before; after-tax ones and garnishments leave the taxes alone and come out of
 * net pay; a garnishment never takes more than its share of disposable earnings (gross less taxes);
 * nothing takes pay below zero; the pay run still balances and the payslip lists each by name.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { computePeriodPayroll } from '../lib/payroll-engine';
import { deductionProblem, type EmployeeDeduction } from '../lib/payrollDeductions';
import { payRunLines, payRunTotals } from '../lib/payRunPosting';
import { layoutPayslip } from '../server/services/payslipPdf';
import PayrollView from '../components/hr/PayrollView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { Employee } from '../types';

const ann = (extra: Partial<Employee> = {}) => ({
  id: 'ann', uid: 'u', workspaceId: 'component-workspace', name: 'Ann', role: 'Staff', salaryCents: 6_000_000, payFrequency: 'Monthly', status: 'Active',
  filingStatus: 'Single', state: 'TX', createdAt: '2026-01-01', ...extra,
} as Employee);
const ded = (d: Partial<EmployeeDeduction>): EmployeeDeduction => ({ id: d.name || 'd', name: 'd', kind: 'post_tax', ...d } as EmployeeDeduction);
const base = computePeriodPayroll(ann());

describe('Deductions in the pay period', () => {
  test('a named pre-tax deduction works exactly like the pre-tax amount kept before', () => {
    const named = computePeriodPayroll(ann({ deductions: [ded({ name: '401(k)', kind: 'pre_tax', amountCents: 20_000 })] }));
    const old = computePeriodPayroll(ann({ preTaxDeductionsCents: 20_000 }));
    for (const key of ['taxableGrossCents', 'employeeFederalTaxCents', 'employeeFicaSocialSecurityCents', 'totalWithholdingCents', 'netPayCents', 'preTaxDeductionsCents'] as const) assert.equal(named[key], old[key], key);
    assert.ok(named.employeeFederalTaxCents < base.employeeFederalTaxCents, 'less income tax');
    assert.deepEqual(named.deductionLines, [{ id: '401(k)', name: '401(k)', kind: 'pre_tax', cents: 20_000, requestedCents: 20_000 }]);
  });

  test('after-tax: 10% of gross ($500.00 of $5,000.00) comes off net pay; the taxes do not change', () => {
    const p = computePeriodPayroll(ann({ deductions: [ded({ name: 'Roth', kind: 'post_tax', percent: 10 })] }));
    assert.equal(p.grossPayCents, 500_000);
    assert.equal(p.totalWithholdingCents, base.totalWithholdingCents);
    assert.equal(p.postTaxDeductionsCents, 50_000);
    assert.equal(p.netPayCents, base.netPayCents - 50_000);
  });

  test('a garnishment of 50% is held to the default 25% of disposable earnings (gross less taxes), rounded down', () => {
    const p = computePeriodPayroll(ann({ deductions: [ded({ name: 'Levy', kind: 'garnishment', percent: 50 })] }));
    const disposable = 500_000 - base.totalWithholdingCents;
    assert.equal(p.garnishmentsCents, Math.floor(disposable * 0.25));
    assert.equal(p.deductionLines[0].requestedCents, Math.round(disposable * 0.5));
    assert.equal(p.netPayCents, base.netPayCents - Math.floor(disposable * 0.25));
    const support = computePeriodPayroll(ann({ deductions: [ded({ name: 'Child support', kind: 'garnishment', amountCents: 150_000, maxPercent: 60 })] }));
    assert.equal(support.garnishmentsCents, 150_000, 'within its 60% limit, the order is taken in full');
  });

  test('garnishments come before after-tax deductions, and nothing takes pay below zero', () => {
    const p = computePeriodPayroll(ann({ deductions: [
      ded({ name: 'Union dues', kind: 'post_tax', amountCents: 10_000_000 }),
      ded({ name: 'Child support', kind: 'garnishment', amountCents: 100_000, maxPercent: 50 }),
    ] }));
    assert.equal(p.garnishmentsCents, 100_000);
    assert.equal(p.postTaxDeductionsCents, base.netPayCents - 100_000, 'dues cut to what was left');
    assert.equal(p.netPayCents, 0);
    assert.deepEqual(p.deductionLines.map(l => l.name), ['Child support', 'Union dues']);
    const tooBig = computePeriodPayroll(ann({ deductions: [ded({ name: 'Health', kind: 'pre_tax', percent: 100 }), ded({ name: 'HSA', kind: 'pre_tax', amountCents: 5_000 })] }));
    assert.deepEqual(tooBig.deductionLines.map(l => l.cents), [500_000, 0], 'the second pre-tax deduction has nothing left to take');
    assert.equal(tooBig.taxableGrossCents, 0);
  });

  test('the pay run still balances; every deduction goes to payroll liabilities; the payslip lists each by name', () => {
    const employee = ann({ preTaxDeductionsCents: 0, deductions: [
      ded({ name: '401(k)', kind: 'pre_tax', percent: 5 }), ded({ name: 'Child support', kind: 'garnishment', amountCents: 40_000 }), ded({ name: 'Roth', kind: 'post_tax', amountCents: 10_000 }),
    ] });
    const totals = payRunTotals([employee], 2026);
    const line = totals.employees[0];
    assert.equal(line.deductionsCents, 25_000 + 40_000 + 10_000);
    assert.equal(line.grossCents, line.netCents + line.withheldCents + line.deductionsCents);
    const lines = payRunLines(totals, { bank: { id: 'bank', name: 'Bank' }, wages: { id: 'w', name: 'Wages' }, taxExpense: { id: 't', name: 'Tax' }, liabilities: { id: 'l', name: 'Liabilities' } });
    assert.equal(lines.reduce((s, l) => s + l.amountCents, 0), 0);
    assert.equal(lines.find(l => l.accountId === 'l')!.amountCents, -(line.withheldCents + line.employerTaxCents + 75_000));
    const slip = layoutPayslip({ date: '2026-10-31' }, line, [], { name: 'Co', currency: 'USD' });
    const labels = slip.rows.map(r => r.label);
    assert.ok(labels.indexOf('401(k)') < labels.indexOf('Federal income tax'));
    assert.ok(labels.indexOf('Child support (garnishment)') > labels.indexOf('Medicare'));
    assert.deepEqual(labels.slice(-3), ['Child support (garnishment)', 'Roth', 'Net pay']);
  });

  test('refused: no name, both or neither of amount and percent, a limit over 65%, a limit on a non-garnishment', () => {
    assert.match(String(deductionProblem({ kind: 'pre_tax', amountCents: 100 })), /Name/);
    assert.match(String(deductionProblem({ name: 'x', kind: 'pre_tax', amountCents: 100, percent: 5 })), /either/);
    assert.match(String(deductionProblem({ name: 'x', kind: 'pre_tax' })), /either/);
    assert.match(String(deductionProblem({ name: 'x', kind: 'garnishment', percent: 10, maxPercent: 70 })), /at most 65%/);
    assert.match(String(deductionProblem({ name: 'x', kind: 'post_tax', percent: 10, maxPercent: 25 })), /Only a garnishment/);
    assert.equal(deductionProblem({ name: 'Child support', kind: 'garnishment', amountCents: 25_000, maxPercent: 60 }), null);
  });
});

describe('Deductions on the Payroll screen', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('add a garnishment over its limit: it is saved on the employee, and the dialog says it is held to the limit', async () => {
    const calls = stubFetchWithBodies(200, null);
    setComponentWorkspace('owner');
    useLedgerStore.setState({ employees: [ann()], payRuns: [], accounts: [] } as never);
    markComponentCollectionsLoaded('employees', 'payRuns');
    render(<PayrollView />);
    fireEvent.click(screen.getByRole('button', { name: /Employee Directory/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Deductions of Ann' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Levy' } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'garnishment' } });
    fireEvent.change(screen.getByLabelText('How much'), { target: { value: 'percent' } });
    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '50' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    await waitFor(() => assert.equal(calls.filter(c => c.url.includes('/commands/employee.update')).length, 1));
    const body = calls.find(c => c.url.includes('/commands/employee.update'))!.body as { workspaceId: string; input: { deductions: EmployeeDeduction[] } };
    assert.equal(body.workspaceId, 'component-workspace');
    assert.deepEqual(body.input.deductions.map(d => [d.name, d.kind, d.percent, d.maxPercent]), [['Levy', 'garnishment', 50, 25]]);
    await waitFor(() => assert.match(screen.getByRole('list', { name: 'Deductions of Ann' }).textContent || '', /This period takes .* of .*: the limit or the pay left allows no more/));
  });

  test('a bad entry is refused before anything is saved', () => {
    const calls = stubFetchWithBodies(200, null);
    setComponentWorkspace('owner');
    useLedgerStore.setState({ employees: [ann()], payRuns: [], accounts: [] } as never);
    markComponentCollectionsLoaded('employees', 'payRuns');
    render(<PayrollView />);
    fireEvent.click(screen.getByRole('button', { name: /Employee Directory/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Deductions of Ann' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    assert.equal(screen.getByRole('alert').textContent, 'Name the deduction');
    assert.equal(calls.filter(c => c.url.includes('/rpc/')).length, 0);
  });
});
