import { inlineEditName } from './helpers/inlineEditName';
import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EmployeeInlineDetails } from '../components/hr/EmployeeInlineDetails';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { Employee } from '../types';
const employee: Employee = { id: 'emp', uid: 'test-user', workspaceId: 'component-workspace', name: 'שרה', role: 'Developer', email: 'old@example.test', salaryCents: 8000000, payFrequency: 'Monthly', status: 'Active', createdAt: '2026-01-01' };
beforeEach(() => { setComponentWorkspace(); useLedgerStore.setState({ employees: [employee] }); });
afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });
test('employee email is confirmed through the database without changing payroll values', async () => {
  const writes: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // the inline email cell goes through the shared record adapter, which is still a row patch of its own
    if (String(input).includes('/rpc/lf_update')) writes.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(String(input).includes('/rpc/') ? null : { id: employee.id, data: employee }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  render(<EmployeeInlineDetails employee={employee} />);
  fireEvent.click(screen.getByRole('button', { name: inlineEditName('Edit Email of שרה') }));
  fireEvent.change(screen.getByLabelText('Email of שרה'), { target: { value: 'new@example.test' } });
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('Email of שרה'), { key: 'Enter' }); });
  assert.equal(writes.length, 1); assert.equal(writes[0].p_table, 'employees');
  const fields = (writes[0] as { p_set: Record<string, unknown> }).p_set; assert.equal(fields.email, 'new@example.test'); assert.equal('salaryCents' in fields, false);
  assert.equal(useLedgerStore.getState().employees[0].salaryCents, 8000000);
});
test('employees expose name/email/role suggestions but viewers see text', () => {
  render(<EmployeeInlineDetails employee={employee} />);
  for (const field of ['Name', 'Email', 'Role']) assert.ok(screen.getByRole('button', { name: inlineEditName(`Edit ${field} of שרה`) }));
  fireEvent.click(screen.getByRole('button', { name: inlineEditName('Edit Role of שרה') })); assert.ok(screen.getByLabelText('Role of שרה').getAttribute('list'));
  cleanup(); setComponentWorkspace('viewer'); render(<EmployeeInlineDetails employee={employee} />); assert.equal(screen.queryByRole('button', { name: /^Edit/ }), null);
});
