/**
 * A-134: Corporate card statement import to expense claims (CSV), plus async GSA file race guard.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseCorporateCardCsv } from '../lib/corporateCardImport';
import ExpenseClaims, { type NewClaim } from '../components/purchases/ExpenseClaims';
import { makeChartAccount } from './fixtures';
import type { Bill, Vendor } from '../types';

const accounts = [
  makeChartAccount({ id: 'travel', name: 'Travel', type: 'expense', category: 'Operating Expenses' }),
  makeChartAccount({ id: 'software', name: 'Software', type: 'expense', category: 'Operating Expenses' }),
];
const vendors = [{ id: 'dana', name: 'Dana Levi', type: 'employee' }] as unknown as Vendor[];

describe('A-134 corporate card CSV import + async file guard', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => cleanup());

  test('parses positive charges, skips negative statement payments/refunds, and flags duplicates', () => {
    const existingClaim: Bill = {
      id: 'b-claim-1',
      uid: 'u1',
      workspaceId: 'ws1',
      vendorId: 'dana',
      vendorName: 'Dana Levi',
      number: 'CLAIM-101',
      date: '2026-10-12',
      issueDate: '2026-10-12',
      dueDate: '2026-10-12',
      amountCents: 4550,
      status: 'pending',
      currency: 'USD',
      metadata: { expenseClaim: { state: 'approved' } },
      splits: [{ accountId: 'travel', amountCents: 4550, description: 'Uber Trip' }],
    };

    const csv = [
      'Transaction Date,Description,Amount,Currency,Cardholder,Reference',
      '2026-10-12,Uber Trip,45.50,USD,Dana Levi,4821',
      '2026-10-14,"GitHub, Inc.",120.00,USD,Dana Levi,4821',
      '2026-10-15,Card Auto-Payment,-500.00,USD,Dana Levi,PMT',
    ].join('\n');

    const res = parseCorporateCardCsv(csv, { claimCurrency: 'USD', existingBills: [existingClaim] });
    assert.equal(res.charges.length, 2);
    assert.equal(res.skippedCreditsCount, 1);
    assert.equal(res.duplicateCount, 1);
    assert.equal(res.charges[0].amountCents, 4550);
    assert.equal(res.charges[0].duplicateOf, 'CLAIM-101');
    assert.equal(res.charges[1].amountCents, 12000);
    assert.equal(res.charges[1].amountText, '120.00');
    assert.equal(res.statementDate, '2026-10-14');
  });

  test('refuses foreign-currency rows rather than guessing an exchange rate, and refuses malformed rows all-or-nothing', () => {
    const eurCsv = [
      'Date,Merchant,Amount,Currency',
      '2026-10-10,Lufthansa,310.00,EUR',
    ].join('\n');
    assert.throws(() => parseCorporateCardCsv(eurCsv, { claimCurrency: 'USD' }), /card currency EUR differs from claim currency USD/);

    const badDateCsv = [
      'Date,Merchant,Amount',
      'not-a-date,Taxi,25.00',
    ].join('\n');
    assert.throws(() => parseCorporateCardCsv(badDateCsv, { claimCurrency: 'USD' }), /Row 2: invalid date/);
  });

  test('imports card charges directly into editable ExpenseClaims lines and submits exact cents', async () => {
    let submitted: NewClaim | null = null;
    render(
      <ExpenseClaims
        bills={[]}
        vendors={vendors}
        accounts={accounts}
        userRole="owner"
        uid="u1"
        currency="USD"
        onSubmit={claim => { submitted = claim; }}
        onDecide={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText('New expense claim'));

    const csv = [
      'Date,Merchant,Amount,Currency,Cardholder',
      '2026-10-18,Delta Air Lines,340.25,USD,Dana Levi',
      '2026-10-19,Hilton Midtown,219.75,USD,Dana Levi',
    ].join('\n');

    fireEvent.change(screen.getByLabelText('Corporate card statement CSV'), {
      target: { files: [new File([csv], 'amex-oct-2026.csv', { type: 'text/csv' })] },
    });

    await waitFor(() => {
      assert.match(screen.getByRole('status').textContent || '', /Imported 2 charges from amex-oct-2026\.csv/);
    });
    assert.equal((screen.getByLabelText('Amount, line 1') as HTMLInputElement).value, '340.25');
    assert.equal((screen.getByLabelText('Amount, line 2') as HTMLInputElement).value, '219.75');

    fireEvent.click(screen.getByText('Submit for approval'));
    await waitFor(() => assert.ok(submitted !== null));
    assert.equal(submitted!.payeeName, 'Dana Levi');
    assert.equal(submitted!.lines.reduce((s, l) => s + l.amountCents, 0), 56000);
  });

  test('ignores stale async GSA file resolution when a newer file finishes first', async () => {
    render(
      <ExpenseClaims
        bills={[]}
        vendors={vendors}
        accounts={accounts}
        userRole="owner"
        uid="u1"
        currency="USD"
        onSubmit={() => undefined}
        onDecide={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText('New expense claim'));
    fireEvent.change(screen.getByLabelText('Kind, line 1'), { target: { value: 'perDiem' } });

    let resolveSlow!: (v: string) => void;
    const slowFile = {
      name: 'slow-old.csv',
      text: () => new Promise<string>(res => { resolveSlow = res; }),
    } as unknown as File;

    const fastCsv = [
      'State,Destination,County / Location Defined,Season Begin,Season End,FY26 Lodging Rate,FY26 MIE',
      'NY,New York City,New York,,,342,92',
      'MA,Boston,Suffolk,,,310,86',
    ].join('\n');
    const fastFile = new File([fastCsv], 'fast-new.csv', { type: 'text/csv' });

    const input = screen.getByLabelText('GSA per diem rates CSV');
    fireEvent.change(input, { target: { files: [slowFile] } });
    fireEvent.change(input, { target: { files: [fastFile] } });

    await waitFor(() => {
      assert.match(screen.getByText(/localities read from fast-new\.csv/).textContent || '', /2 FY2026 localities/);
    });

    // Now resolve the older slower file with invalid CSV — it MUST be ignored!
    resolveSlow('broken,csv\n1,2');
    await new Promise(r => setTimeout(r, 20));
    assert.ok(screen.getByText(/2 FY2026 localities read from fast-new\.csv/));
  });
});
