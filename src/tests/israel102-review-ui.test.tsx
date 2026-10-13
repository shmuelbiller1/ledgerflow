import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PayRun } from '../types';
import { exactIlsCents, IsraelForm102Review } from '../components/hr/IsraelForm102Review';

const run: PayRun = {
  id: 'posted-1', uid: 'owner-1', workspaceId: 'ws-1',
  date: '2026-10-12', employeeCount: 2, totalAmountCents: 120000,
  status: 'processed', createdAt: '2026-10-12T12:00:00Z',
};
afterEach(() => cleanup());

test('E-18 exact ILS parser preserves minor units and rejects unsafe input', () => {
  assert.equal(exactIlsCents('1200.05'), 120005);
  assert.equal(exactIlsCents('0'), 0);
  assert.equal(exactIlsCents('2.5'), 250);
  for (const invalid of ['', '1.234', '-1', '1e5', '1,000', '9007199254740992', '  ', 'abc']) {
    assert.equal(exactIlsCents(invalid), undefined);
  }
});

test('E-18 panel never invents missing amounts, and separates income tax from National Insurance', () => {
  render(<IsraelForm102Review payRuns={[run]} homeCurrency="ILS" />);
  fireEvent.click(screen.getByRole('button', { name: 'Review monthly totals' }));
  fireEvent.change(screen.getByLabelText('Israeli payroll month'), { target: { value: '2026-10' } });
  assert.ok(screen.getByText(/not verified Israeli Form 102 components/));
  assert.ok(screen.queryByLabelText('Israeli monthly payroll review totals') === null, 'blank fields do not become zeros');
  fireEvent.change(screen.getByLabelText('Income tax withheld (separate tax reporting) for pay run 2026-10-12'), { target: { value: '500.05' } });
  fireEvent.change(screen.getByLabelText('National Insurance — employee for pay run 2026-10-12'), { target: { value: '100.10' } });
  fireEvent.change(screen.getByLabelText('National Insurance — employer for pay run 2026-10-12'), { target: { value: '200.00' } });
  fireEvent.change(screen.getByLabelText('Health insurance — employee for pay run 2026-10-12'), { target: { value: '50.50' } });
  assert.ok(screen.queryByLabelText('Israeli monthly payroll review totals') === null, 'source still unconfirmed');
  fireEvent.click(screen.getByRole('checkbox'));
  const totals = screen.getByLabelText('Israeli monthly payroll review totals');
  assert.ok(totals.textContent?.includes('350.60'), 'NII total sums 100.10 + 200.00 + 50.50');
  assert.ok(totals.textContent?.includes('500.05'), 'income tax remains a separate line');
  assert.ok(totals.textContent?.includes('Employee occurrences'));
});

test('E-18 non-ILS workspace and undone pay runs cannot fabricate an Israeli report', () => {
  render(<IsraelForm102Review payRuns={[{ ...run, status: 'undone' }]} homeCurrency="USD" />);
  fireEvent.click(screen.getByRole('button', { name: 'Review monthly totals' }));
  fireEvent.change(screen.getByLabelText('Israeli payroll month'), { target: { value: '2026-10' } });
  assert.match(screen.getByRole('alert').textContent || '', /not denominated in ILS/);
  assert.ok(screen.queryByLabelText('Israeli monthly payroll review totals') === null);
});
