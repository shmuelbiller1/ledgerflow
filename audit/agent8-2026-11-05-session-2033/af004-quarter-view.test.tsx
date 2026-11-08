/**
 * Synthetic component / CSV acceptance reproductions. These known-failing tests live outside
 * npm test's normal glob and are meant to be run explicitly until the tax owner resolves them.
 * jsdom does not prove a real browser, persistence, authentication, or a live deployment.
 */
import '../../src/tests/helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { UsQuarterJourneyPanel } from '../../src/components/reporting/UsQuarterJourneyReportView';
import type { TaxProfiles } from '../../src/lib/tax/profile';
import { usQuarterJourney, usQuarterJourneyCsvRows } from '../../src/lib/usQuarterJourney';

afterEach(() => cleanup());

const profiles: TaxProfiles = {
  books: {
    place: { country: 'US', state: 'TX' },
    registrations: [{ kind: 'sales_tax', number: '3200', place: { country: 'US', state: 'TX' } }],
  },
};
const invoice = {
  id: 'sale-1', customerId: 'customer-1', date: '2026-08-10', status: 'sent',
  amountCents: 10825, taxAmountCents: 825, taxVersion: 2, taxTreatment: 'standard' as const,
  taxBreakdown: [{ name: 'Texas', rate: 6.25, taxCents: 625 }, { name: 'Austin', rate: 2, taxCents: 200 }],
  metadata: { taxPlace: { country: 'US', state: 'TX' } },
};
const journeyFor = (state: string) => usQuarterJourney({
  quarter: '2026-Q3', today: '2026-11-05', profiles, order: ['world'], invoices: [invoice],
  customers: [{ id: 'customer-1', metadata: { taxPlace: { country: 'US', state } } }],
});
const displayed = (state: string) => {
  render(<UsQuarterJourneyPanel journey={journeyFor(state)} currency="USD" quarterText="2026-Q3" onQuarterChange={() => {}} />);
  return within(screen.getByRole('row', { name: /TX 3200/ })).getAllByRole('cell').map(cell => cell.textContent);
};

test('control: the report displays the hand-worked sale while the customer remains in Texas', () => {
  const cells = displayed('TX');
  assert.deepEqual([cells[0], cells[1], cells[4]], ['1', '$100.00', '$8.25']);
});

test('contract: the report still displays the saved Texas sale after the customer moves', () => {
  const cells = displayed('OK');
  assert.deepEqual([cells[0], cells[1], cells[4]], ['1', '$100.00', '$8.25']);
});

test('contract: the CSV still exports the saved Texas sale after the customer moves', () => {
  const row = usQuarterJourneyCsvRows(journeyFor('OK')).find(r => r[5] === 'TX 3200');
  assert.ok(row, 'Texas permit row must exist');
  assert.deepEqual([row[6], row[8], row[9]], ['100.00', '100.00', '8.25']);
});
