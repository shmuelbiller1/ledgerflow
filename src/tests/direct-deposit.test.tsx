/**
 * Direct deposit file (U-09): routing numbers are checked by their check digit; the NACHA file has
 * 94-character records in blocks of ten, one credit per person with a bank account (22 checking,
 * 32 savings), and its counts, hash and total agree; people without an account are left out and
 * named; on screen, an account added in the dialog is kept on the employee and the file downloads.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { bankProblem, companyProblem, nachaFile, validRouting } from '../lib/nacha';
import { DirectDepositDialog } from '../components/hr/DirectDepositDialog';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { Employee, PayRun } from '../types';

const company = { routing: '021000021', companyId: '1123456789', companyName: 'Payroll Co', bankName: 'Big Bank' };

describe('The file', () => {
  test('routing numbers, accounts and the company are checked', () => {
    assert.equal(validRouting('021000021'), true);
    assert.equal(validRouting('011000015'), true);
    assert.equal(validRouting('021000022'), false, 'a wrong check digit');
    assert.equal(validRouting('12345678'), false);
    assert.equal(bankProblem({ bankRouting: '011000015', bankAccount: '12345678', bankAccountType: 'savings' }), null);
    assert.match(String(bankProblem({ bankRouting: '011000015', bankAccount: '12', bankAccountType: 'savings' })), /4 to 17/);
    assert.equal(companyProblem(company), null);
    assert.match(String(companyProblem({ ...company, routing: '021000022' })), /routing/);
  });

  test('one credit per person with an account; counts, hash and total agree; blocks of ten', () => {
    const file = nachaFile(company, [
      { employeeId: 'e1', name: 'Ann Lee', netCents: 123456, bank: { bankRouting: '011000015', bankAccount: '12345678', bankAccountType: 'checking' } },
      { employeeId: 'e2', name: 'Bo Ramírez', netCents: 98700, bank: { bankRouting: '021000021', bankAccount: '987654321', bankAccountType: 'savings' } },
      { employeeId: 'e3', name: 'No Bank', netCents: 5000, bank: {} },
    ], '2026-10-15', new Date('2026-10-10T14:05:00Z'));
    const records = file.text.trimEnd().split('\n');
    assert.ok(records.every(r => r.length === 94), 'every record is 94 characters');
    assert.equal(records.length % 10, 0);
    assert.deepEqual([file.entries, file.totalCents, file.missing.map(m => m.name)], [2, 222156, ['No Bank']]);
    assert.equal(records[0].slice(0, 13), '101 021000021');
    assert.equal(records[0].slice(23, 33), '2610101405');
    assert.equal(records[1].slice(50, 63), 'PPDPAYROLL   ');
    assert.equal(records[1].slice(69, 75), '261015', 'the money arrives on the pay date');
    const [ann, bo] = records.filter(r => r[0] === '6');
    assert.equal(ann.slice(1, 12), '22011000015');
    assert.equal(ann.slice(29, 39), '0000123456');
    assert.equal(ann.slice(54, 76), 'ANN LEE               ');
    assert.equal(bo.slice(1, 3), '32', 'savings');
    assert.equal(bo.slice(54, 64), 'BO RAMIREZ', 'accents written plainly');
    const control = records.find(r => r[0] === '8')!;
    assert.equal(control.slice(4, 10), '000002');
    assert.equal(control.slice(10, 20), String(1100001 + 2100002).padStart(10, '0'), 'the hash adds the 8-digit routing numbers');
    assert.equal(control.slice(32, 44), '000000222156');
    const fileControl = records.find(r => r[0] === '9' && r !== '9'.repeat(94))!;
    assert.equal(fileControl.slice(7, 13), '000001', 'one block');
  });
});

describe('On screen', () => {
  afterEach(() => { cleanup(); });

  test('add a person\'s account in the dialog, then download the file', async () => {
    setComponentWorkspace('owner');
    const employees = [
      { id: 'e1', name: 'Ann Lee', bankRouting: '011000015', bankAccount: '12345678', bankAccountType: 'checking' },
      { id: 'e2', name: 'Bo Ramírez' },
    ] as Employee[];
    useLedgerStore.setState({ employees });
    const run = { id: 'r1', date: '2026-10-15', status: 'processed', employees: [{ employeeId: 'e1', name: 'Ann Lee', netCents: 123456 }, { employeeId: 'e2', name: 'Bo Ramírez', netCents: 98700 }] } as unknown as PayRun;
    const writes: Array<{ p_id?: string; p_set?: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('lf_update') && typeof init?.body === 'string') writes.push(JSON.parse(init.body));
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const blobs: Blob[] = [];
    URL.createObjectURL = ((b: Blob) => { blobs.push(b); return 'blob:x'; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    render(<DirectDepositDialog run={run} workspace={{ id: 'w1', name: 'Payroll Co', currency: 'USD' }} onClose={() => {}} />);
    assert.ok(screen.getByText('Deposits (1 of 2 ready)'));
    assert.ok(screen.getByText('checking ••••5678 at 011000015'), 'the account number is not shown in full');
    fireEvent.click(screen.getByRole('button', { name: 'Add the bank account of Bo Ramírez' }));
    fireEvent.change(screen.getByLabelText('Routing number'), { target: { value: '021000021' } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '987654321' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'savings' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save account' })); });
    await waitFor(() => assert.equal(writes.length, 1));
    assert.deepEqual([writes[0].p_id, writes[0].p_set?.bankRouting, writes[0].p_set?.bankAccount, writes[0].p_set?.bankAccountType], ['e2', '021000021', '987654321', 'savings']);
    await waitFor(() => assert.ok(screen.getByText('Deposits (2 of 2 ready)')));
    assert.equal((screen.getByRole('button', { name: 'Download the file' }) as HTMLButtonElement).disabled, true, 'the company first');
    fireEvent.change(screen.getByLabelText('Company ID from your bank'), { target: { value: '1123456789' } });
    fireEvent.change(screen.getByLabelText("Your bank's routing number"), { target: { value: '021000021' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download the file' }));
    const text = await blobs[0].text();
    assert.equal(text.split('\n').filter(r => r[0] === '6').length, 2);
  });
});
