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
    // the inline email cell goes through `record.fields`: the allowlist, the role and `updatedAt` are the server's
    if (String(input).includes('/commands/record.fields')) writes.push(JSON.parse(String(init?.body)));
    const answered = String(input).includes('/commands/')
      ? { ok: true, data: { collection: 'employees', id: employee.id, fields: ['email'], updatedAt: '2026-01-02T00:00:00Z' } }
      : String(input).includes('/rpc/') ? null : { id: employee.id, data: employee };
    return new Response(JSON.stringify(answered), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  render(<EmployeeInlineDetails employee={employee} />);
  fireEvent.click(screen.getByRole('button', { name: inlineEditName('Edit Email of שרה') }));
  fireEvent.change(screen.getByLabelText('Email of שרה'), { target: { value: 'new@example.test' } });
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('Email of שרה'), { key: 'Enter' }); });
  assert.equal(writes.length, 1);
  const sent = writes[0] as { workspaceId: string; input: { collection: string; id: string; fields: Record<string, unknown>; expected: Record<string, unknown> } };
  assert.deepEqual([sent.input.collection, sent.input.id], ['employees', employee.id]);
  assert.equal(sent.input.fields.email, 'new@example.test');
  assert.equal('salaryCents' in sent.input.fields, false, 'only the edited field is sent — pay is not a field this editor owns');
  assert.equal(sent.input.expected.email, 'old@example.test', 'the value the cell read rides with the write');
  assert.equal(useLedgerStore.getState().employees[0].salaryCents, 8000000);
});
test('employees expose name/email/role suggestions but viewers see text', () => {
  render(<EmployeeInlineDetails employee={employee} />);
  for (const field of ['Name', 'Email', 'Role']) assert.ok(screen.getByRole('button', { name: inlineEditName(`Edit ${field} of שרה`) }));
  fireEvent.click(screen.getByRole('button', { name: inlineEditName('Edit Role of שרה') })); assert.ok(screen.getByLabelText('Role of שרה').getAttribute('list'));
  cleanup(); setComponentWorkspace('viewer'); render(<EmployeeInlineDetails employee={employee} />); assert.equal(screen.queryByRole('button', { name: /^Edit/ }), null);
});
