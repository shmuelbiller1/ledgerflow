/**
 * Agent #6 probe (2026-11-10) — F-08: "Recorded as filed" and the filed record are two universes.
 *
 * Two halves, both read from the pin (dc40739708a013ad080ffb306fe461554a2391fc):
 *  1. the SCREEN marks a state's return filed when ANY return covers the same dates — the
 *     registration is dropped before the comparison (UsQuarterJourneyReportView.tsx:64-80) and
 *     `usQuarterJourney` compares dates only (src/lib/usQuarterJourney.ts:281-283);
 *  2. the SERVER can only ever file a VAT registration (`vatRegistrationsIn` filters kind==='vat',
 *     taxReturnService.ts:43-48), and its boxes come from `buildTaxReturn` — an invoice/VAT
 *     computation the quarter screen never reads.
 *
 * Run: NODE_ENV=test npx tsx --test audit/agent6-2026-11-10/probes/f8-tax-return-two-universes.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { usQuarterJourney } from '../../../src/lib/usQuarterJourney.ts';
import type { TaxProfiles } from '../../../src/lib/tax/profile.ts';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

// a book with TWO state permits (TX and CA) and no sales at all in the quarter
const profiles = {
  books: {
    name: 'Two-State Co.', place: { country: 'US', state: 'TX' },
    registrations: [
      { kind: 'sales_tax', number: 'TX-1', place: { country: 'US', state: 'TX' }, filing: 'quarterly' },
      { kind: 'sales_tax', number: 'CA-1', place: { country: 'US', state: 'CA' }, filing: 'quarterly' },
    ],
  },
} as unknown as TaxProfiles;

const journey = (filedPeriods: Array<{ startDate: string; endDate: string }>) =>
  usQuarterJourney({ quarter: '2026-Q3', today: '2026-11-10', currency: 'USD', profiles, order: ['world'],
    invoices: [], creditNotes: [], customers: [], filedPeriods } as never);

test('F-08: one filed return for the quarter marks BOTH states as filed', () => {
  const returns = journey([{ startDate: '2026-07-01', endDate: '2026-09-30' }])
    .steps.find(s => s.id === 'state-returns')!.returns;
  assert.deepEqual(returns.map(r => r.state), ['CA', 'TX']);
  // OBSERVED: filing Texas also "records" California — the registration is not part of the match
  assert.deepEqual(returns.map(r => r.filed), [true, true]);
});

test('F-08: without any filing neither state reads filed (the control)', () => {
  const returns = journey([]).steps.find(s => s.id === 'state-returns')!.returns;
  assert.deepEqual(returns.map(r => r.filed), [false, false]);
});

test('F-08: the screen drops the registration before it compares, so a VAT return would count too', () => {
  const view = read('src/components/reporting/UsQuarterJourneyReportView.tsx');
  assert.match(view, /\.filter\(r => typeof r\.startDate === 'string' && typeof r\.endDate === 'string'\)/);
  assert.match(view, /\.map\(r => \(\{ startDate: r\.startDate!, endDate: r\.endDate! \}\)\)/);
  assert.equal(/registration/.test(view.slice(view.indexOf('tax-returns'), view.indexOf('const partial'))), false);
});

test('F-08: the server can never file a US sales-tax permit — the helper only accepts kind "vat"', () => {
  const svc = read('src/server/services/taxReturnService.ts');
  assert.match(svc, /\.filter\(r => r\.kind === 'vat'/);
  assert.match(svc, /is not one of this workspace's VAT registrations/);
  // and its figures are the VAT box computation, not the state-return computation
  assert.match(svc, /buildTaxReturn\(\{ invoices, bills, creditNotes, vendorCredits, startDate, endDate \}\)/);
  assert.equal(/usSalesTaxReturn/.test(svc), false);
});
