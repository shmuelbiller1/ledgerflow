/**
 * A-75 + A-76: the expense claim form's dated rate suggestion. Hand-checked: a UK mileage line
 * takes £0.55/mi from 6 Apr 2026 (the rate in force today), a per-mile row never fills a
 * per-kilometre line, a typed rate is never overwritten, and the US per-diem line takes $68.00
 * (GSA standard CONUS M&IE). The claim still records the rate the person types. Nothing posts.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ExpenseClaims from '../components/purchases/ExpenseClaims';
import { makeChartAccount } from './fixtures';
import type { Vendor } from '../types';

const accounts = [
  makeChartAccount({ id: 'travel', name: 'Travel', type: 'expense', category: 'Operating Expenses' }),
  makeChartAccount({ id: 'meals', name: 'Meals', type: 'expense', category: 'Operating Expenses' }),
];
const vendors = [{ id: 'dana', name: 'Dana', type: 'employee' }] as unknown as Vendor[];

describe('The claim form suggests the dated rate', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => cleanup());

  const openDialog = (claimCurrency: string) => {
    render(<ExpenseClaims bills={[]} vendors={vendors} accounts={accounts} userRole="owner" uid="u1" currency={claimCurrency}
      onSubmit={() => undefined} onDecide={() => undefined} />);
    fireEvent.click(screen.getByText('New expense claim'));
  };

  test('a UK mileage line takes the table rate for today; a per-mile row never fills a per-km line; a typed rate wins', () => {
    openDialog('GBP');
    fireEvent.change(screen.getByLabelText('Kind, line 1'), { target: { value: 'mileage' } });
    assert.equal((screen.getByLabelText('Rate per km, line 1') as HTMLInputElement).value, '', 'the rate is theirs to type until a country is chosen');

    fireEvent.change(screen.getByLabelText('Country, line 1'), { target: { value: 'GB' } });
    assert.match(screen.getByRole('note').textContent || '', /does not fill this kilometre line/);
    assert.equal((screen.getByLabelText('Rate per km, line 1') as HTMLInputElement).value, '', 'a per-mile row never fills a per-km line');

    fireEvent.change(screen.getByLabelText('Unit, line 1'), { target: { value: 'mi' } });
    const rate = screen.getByLabelText('Rate per mile, line 1') as HTMLInputElement;
    assert.equal(rate.value, '0.55', 'the table rate in force today (55p from 6 Apr 2026) fills the empty field');
    assert.match(screen.getByRole('note').textContent || '', /HM Revenue & Customs/);
    assert.match(screen.getByRole('note').textContent || '', /what you type is what the claim records/);

    fireEvent.change(rate, { target: { value: '0.99' } });
    fireEvent.change(screen.getByLabelText('Country, line 1'), { target: { value: 'US' } });
    fireEvent.change(screen.getByLabelText('Country, line 1'), { target: { value: 'GB' } });
    assert.equal(rate.value, '0.99', 'a typed rate is never overwritten');
  });

  test('a US per-diem line takes the GSA daily allowance; a country with no row says to type the rate', () => {
    openDialog('USD');
    fireEvent.change(screen.getByLabelText('Kind, line 1'), { target: { value: 'perDiem' } });
    fireEvent.change(screen.getByLabelText('Country, line 1'), { target: { value: 'US' } });
    const daily = screen.getByLabelText('Daily rate, line 1') as HTMLInputElement;
    assert.equal(daily.value, '68.00', 'GSA standard CONUS M&IE fills the empty field');
    assert.match(screen.getByRole('note').textContent || '', /U.S. General Services Administration/);

    fireEvent.change(screen.getByLabelText('Country, line 1'), { target: { value: 'GB' } });
    assert.equal(daily.value, '68.00', 'the typed-or-filled rate stays');
    fireEvent.change(daily, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Country, line 1'), { target: { value: 'US' } });
    fireEvent.change(daily, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Paid on'), { target: { value: '2024-01-01' } });
    assert.match(screen.getByRole('note').textContent || '', /No table row for United States on 2024-01-01/);
  });

  test('A-107: an imported GSA locality file suggests the picked locality rate over the standard one', async () => {
    openDialog('USD');
    fireEvent.change(screen.getByLabelText('Paid on'), { target: { value: '2026-03-15' } });
    fireEvent.change(screen.getByLabelText('Kind, line 1'), { target: { value: 'perDiem' } });
    fireEvent.change(screen.getByLabelText('Country, line 1'), { target: { value: 'US' } });
    const daily = screen.getByLabelText('Daily rate, line 1') as HTMLInputElement;
    assert.equal(daily.value, '68.00', 'before the import the standard rate is suggested');

    const fy26 = [
      'State,Destination,County / Location Defined,Season Begin,Season End,FY26 Lodging Rate,FY26 MIE',
      'NY,New York City,"Bronx, Kings, New York, Queens, Richmond",,,342,92',
    ].join('\n');
    fireEvent.change(screen.getByLabelText('GSA per diem rates CSV'), {
      target: { files: [new File([fy26], 'FY2026_PerDiemMasterRatesFile.csv', { type: 'text/csv' })] },
    });
    assert.match((await screen.findByText(/1 FY2026 localities read/)).textContent || '', /used for this claim only/);
    assert.equal(daily.value, '68.00', 'the import alone never rewrites a filled rate');

    fireEvent.change(daily, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('GSA locality, line 1'), { target: { value: 'New York City, NY' } });
    assert.equal(daily.value, '92.00', 'the picked locality rate fills the empty field');
    assert.match(screen.getByRole('note').textContent || '', /New York City, NY locality/);
    assert.match(screen.getByRole('note').textContent || '', /U.S. General Services Administration/);

    fireEvent.change(screen.getByLabelText('GSA locality, line 1'), { target: { value: 'Nowhere, NY' } });
    assert.match(screen.getByRole('note').textContent || '', /is not a locality in the imported FY2026 file/);
    assert.equal(daily.value, '92.00', 'an unpicked locality never rewrites the field');
  });
});
