import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { usSalesTaxReturn } from '../lib/tax/usSalesTaxReturn';
import { usQuarterJourney, usQuarterPermits } from '../lib/usQuarterJourney';
import { buildSampleBusinessYear } from '../lib/sampleBusinessYear';
import { placeState, registrationKey, type TaxProfiles } from '../lib/tax/profile';

describe('F-01 & F-01b: TaxPlace state/region normalization and sampleBusinessYear seam', () => {
  const regKey = 'sales_tax:US-TX:32099887766';
  const invoice = {
    id: 'inv-1',
    number: 'INV-1',
    customerId: 'c1',
    customerName: 'Beacon Market 1',
    date: '2026-08-05',
    dueDate: '2026-09-05',
    status: 'sent',
    currency: 'USD',
    taxVersion: 2,
    taxTreatment: 'standard',
    subtotalCents: 10000,
    taxAmountCents: 625,
    amountCents: 10625,
    items: [{ id: 'l1', accountId: 'acc-sales-goods', description: 'Goods', quantity: 1, rateCents: 10000, amountCents: 10000 }],
  };

  test('F-01: placeState and usSalesTaxReturn count sales whether customer or seller place uses state or region', () => {
    assert.equal(placeState({ country: 'US', state: 'tx' }), 'TX');
    assert.equal(placeState({ country: 'US', region: 'tx' }), 'TX');

    const legacyRegionProfiles: TaxProfiles = {
      books: {
        name: 'Harbor & Olive Supply Co.',
        place: { country: 'US', region: 'TX' },
        registrations: [{ kind: 'sales_tax', number: '32099887766', place: { country: 'US', region: 'TX' }, filing: 'quarterly' }],
      },
    };
    assert.equal(registrationKey(legacyRegionProfiles.books!.registrations![0]), regKey);

    const ret = usSalesTaxReturn({
      registration: regKey,
      profiles: legacyRegionProfiles,
      order: ['world'],
      customers: [{ id: 'c1', metadata: { taxPlace: { country: 'US', region: 'TX' } } }],
      invoices: [invoice] as never,
      startDate: '2026-07-01',
      endDate: '2026-09-30',
    });
    assert.equal(ret.documentCount, 1);
    assert.equal(ret.taxableSalesCents, 10000);
    assert.equal(ret.taxCollectedCents, 625);

    const q = usQuarterJourney({
      quarter: '2026-Q3',
      today: '2026-11-10',
      currency: 'USD',
      profiles: legacyRegionProfiles,
      order: ['world'],
      customers: [{ id: 'c1', metadata: { taxPlace: { country: 'US', region: 'TX' } } }],
      invoices: [invoice] as never,
    });
    const txRow = q.steps.find(s => s.id === 'state-returns')!.returns.find(r => r.state === 'TX');
    assert.ok(txRow);
    assert.equal(txRow.documentCount, 1);
    assert.equal(txRow.taxCollectedCents, 625);
  });

  test('F-01b: buildSampleBusinessYear feeds usSalesTaxReturn and usQuarterJourney with non-zero TX sales and tax', () => {
    const sample = buildSampleBusinessYear({ year: 2026 });
    const permits = usQuarterPermits(sample.workspace.taxProfiles, '2026-09-30');
    assert.equal(permits.length, 1);
    assert.equal(permits[0].state, 'TX');

    const ret = usSalesTaxReturn({
      registration: permits[0].registration,
      profiles: sample.workspace.taxProfiles,
      order: ['world'],
      customers: sample.customers,
      invoices: sample.invoices as never,
      creditNotes: sample.creditNotes as never,
      startDate: '2026-07-01',
      endDate: '2026-09-30',
    });
    assert.ok(ret.documentCount > 0, 'sample business Q3 should include Texas sales');
    assert.ok(ret.taxableSalesCents > 0, 'sample business Q3 should have non-zero Texas taxable sales');
    assert.ok(ret.taxCollectedCents > 0, 'sample business Q3 should have non-zero Texas sales tax collected');
  });
});

describe('F-08: US quarter filed-return registration & kind matching', () => {
  const twoStateProfiles: TaxProfiles = {
    books: {
      name: 'Two-State Co.',
      place: { country: 'US', state: 'TX' },
      registrations: [
        { kind: 'sales_tax', number: 'TX-1', place: { country: 'US', state: 'TX' }, filing: 'quarterly' },
        { kind: 'sales_tax', number: 'CA-1', place: { country: 'US', state: 'CA' }, filing: 'quarterly' },
      ],
    },
  };

  test('filing one state permit marks only that state filed; unscoped or VAT filings never falsely mark multi-state permits', () => {
    const txOnly = usQuarterJourney({
      quarter: '2026-Q3',
      today: '2026-11-10',
      currency: 'USD',
      profiles: twoStateProfiles,
      order: ['world'],
      filedPeriods: [{ startDate: '2026-07-01', endDate: '2026-09-30', registration: 'sales_tax:US-TX:TX-1', kind: 'sales_tax' }],
    }).steps.find(s => s.id === 'state-returns')!.returns;

    assert.deepEqual(txOnly.map(r => [r.state, r.filed]), [['CA', false], ['TX', true]]);

    const unscopedMulti = usQuarterJourney({
      quarter: '2026-Q3',
      today: '2026-11-10',
      currency: 'USD',
      profiles: twoStateProfiles,
      order: ['world'],
      filedPeriods: [{ startDate: '2026-07-01', endDate: '2026-09-30' }],
    }).steps.find(s => s.id === 'state-returns')!.returns;
    assert.deepEqual(unscopedMulti.map(r => [r.state, r.filed, r.recordedForDates]), [['CA', false, true], ['TX', false, true]]);

    const vatRecord = usQuarterJourney({
      quarter: '2026-Q3',
      today: '2026-11-10',
      currency: 'USD',
      profiles: twoStateProfiles,
      order: ['world'],
      filedPeriods: [{ startDate: '2026-07-01', endDate: '2026-09-30', registration: 'vat:IL:514000000', kind: 'vat' }],
    }).steps.find(s => s.id === 'state-returns')!.returns;
    assert.deepEqual(vatRecord.map(r => r.filed), [false, false]);

    const viewSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/reporting/UsQuarterJourneyReportView.tsx'), 'utf8');
    assert.ok(viewSrc.includes('r.registration'), 'UsQuarterJourneyReportView must preserve registration on filedPeriods');
    const svcSrc = fs.readFileSync(path.join(process.cwd(), 'src/server/services/taxReturnService.ts'), 'utf8');
    assert.ok(svcSrc.includes('usSalesTaxReturn'), 'taxReturnService must compute sales_tax filings via usSalesTaxReturn');
  });
});
