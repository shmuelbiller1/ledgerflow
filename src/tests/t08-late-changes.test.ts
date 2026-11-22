/**
 * T-08 (partial): late changes to a filed return, shown on the two journey screens.
 *
 * A filed return keeps a copy of its figures (`boxes`), and the same period recomputed from today's
 * documents can differ: a document saved after filing, a credit note, a corrected line. The journey
 * screens (US quarter, Israel month) show those differences box by box, next to "Recorded as filed".
 *
 * Worked figures, by hand (cents):
 *
 * US quarter, Texas permit 3200, 2026-Q3 (1 Jul – 30 Sep 2026):
 *   i1 10 Aug Austin customer   1,000.00 net + 82.50 tax (state 62.50, Austin 20.00)  taxable
 *   the return filed on 15 Oct with box 1 Sales tax collected 8,250 (as i1 alone: tax 82.50)
 *   then i2 15 Sep Austin customer 200.00 net + 16.50 tax is saved after the filing:
 *     box 1 filed 8,250, now 9,900 (+1,650)   ·   box 3 filed 8,250, now 9,900
 *     box 5 filed 8,250, now 9,900           ·   box 6 filed 1,000.00, now 1,700.00 (+70,000)
 *     box 9 filed 0, now 50,000 (+50,000) — i3's exempt sale (only boxes that moved are listed)
 *
 * Israel month, Tel Aviv 514000000, 2026-09:
 *   i1 10 Sep business buyer   1,000.00 net + 180.00 VAT (18%)
 *   the return filed on 5 Oct: box 1 Tax on sales 18,000, box 5 Net tax to pay 18,000
 *   then a credit note c1 25 Sep 100.00 net + 18.00 VAT is saved after the filing:
 *     box 1 filed 18,000, now 16,200 (−1,800)   ·   box 3 filed 18,000, now 16,200
 *     box 5 filed 18,000, now 16,200           ·   box 6 filed 1,000.00, now 900.00 (−10,000)
 *
 * Boundaries: only an exact copy for that registration and period is compared; a copy without figures,
 * another registration's copy, a partial (truncated or failed) run, or no copy at all → no comparison,
 * which is not a claim that nothing changed. Read-only: nothing files, posts or changes a figure.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { filedRegistrationChanges } from '../lib/tax/filedReturns';
import { usSalesTaxReturnBoxes } from '../lib/tax/usSalesTaxReturn';
import { usQuarterJourney, usQuarterJourneyCsvRows, US_QUARTER_JOURNEY_CSV_HEADERS } from '../lib/usQuarterJourney';
import { israelMonthJourney } from '../lib/israelMonthJourney';
import type { TaxProfiles } from '../lib/tax/profile';
import type { TaxReturnBox } from '../lib/taxCodes';

const box = (key: string, cents: number, label = key): TaxReturnBox => ({ key, label, cents });

describe('the filed-copy lookup (T-08)', () => {
  const filed = [
    { startDate: '2026-09-01', endDate: '2026-09-30', registration: 'vat:IL:514000000', boxes: [box('1', 18_000, 'Tax on sales'), box('5', 18_000, 'Net')] },
    { startDate: '2026-09-01', endDate: '2026-09-30', registration: 'vat:IL:514000002', boxes: [box('1', 5_000, 'Tax on sales')] },
    { startDate: '2026-09-01', endDate: '2026-09-30', registration: 'vat:IL:514000003' },
    { startDate: '2026-08-01', endDate: '2026-08-31', registration: 'vat:IL:514000000', boxes: [box('1', 9_000, 'Tax on sales')] },
  ];
  test('an exact registration and period with figures is the only copy that is compared', () => {
    const now = [box('1', 16_200, 'Tax on sales'), box('5', 16_200, 'Net')];
    assert.deepEqual(
      filedRegistrationChanges(filed, '2026-09-01', '2026-09-30', 'vat:IL:514000000', now),
      [{ key: '1', label: 'Tax on sales', filedCents: 18_000, nowCents: 16_200 }, { key: '5', label: 'Net', filedCents: 18_000, nowCents: 16_200 }],
    );
  });
  test('another period, a copy without figures, or nothing filed is not compared', () => {
    const now = [box('1', 16_200, 'Tax on sales')];
    assert.equal(filedRegistrationChanges(filed, '2026-10-01', '2026-10-31', 'vat:IL:514000000', now), null, 'a period with no copy for it');
    assert.equal(filedRegistrationChanges(filed, '2026-09-01', '2026-09-30', 'vat:IL:514000003', now), null, 'a copy without figures');
    assert.equal(filedRegistrationChanges(filed, '2026-09-01', '2026-09-30', 'vat:IL:514000000', []), null, 'no figures recomputed');
    assert.equal(filedRegistrationChanges([], '2026-09-01', '2026-09-30', 'vat:IL:514000000', now), null, 'nothing filed');
  });
  test('a copy for another registration does not count for this one', () => {
    const now = [box('1', 16_200, 'Tax on sales')];
    // 514000002 has a copy with figures, but it is not 514000009's: only the exact registration is compared
    assert.equal(filedRegistrationChanges(filed, '2026-09-01', '2026-09-30', 'vat:IL:514000009', now), null, 'no copy of its own');
  });
  test('the same boxes recomputed give an empty list, not a missing comparison', () => {
    const now = [box('1', 18_000, 'Tax on sales'), box('5', 18_000, 'Net')];
    assert.deepEqual(filedRegistrationChanges(filed, '2026-09-01', '2026-09-30', 'vat:IL:514000000', now), []);
  });
});

describe('US quarter journey: changes since the return was filed (T-08)', () => {
  const profiles: TaxProfiles = {
    labels: { 'world:tx': { place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', number: '3200', place: { country: 'US', state: 'TX' } }] } },
  } as TaxProfiles;
  const customers = [{ id: 'austin', metadata: { taxPlace: { country: 'US', state: 'TX', city: 'Austin' } } }];
  const invoice = (id: string, date: string, netCents: number, taxCents: number): Record<string, unknown> => ({
    id, date, status: 'sent', taxVersion: 2, amountCents: netCents + taxCents, taxAmountCents: taxCents, customerId: 'austin',
    dimensions: { world: 'tx' }, taxTreatment: 'standard',
    taxBreakdown: [{ name: 'Texas state sales tax', rate: 0, taxCents }],
  });
  // i1 10 Aug 1,000.00 net + 82.50 tax — the quarter as filed on 15 Oct
  const i1 = invoice('i1', '2026-08-10', 100_000, 8_250) as never;
  // i2 15 Sep 200.00 net + 16.50 tax, and i3 15 Sep 500.00 exempt — saved after the filing
  const i2 = invoice('i2', '2026-09-15', 20_000, 1_650) as never;
  const i3 = { ...invoice('i3', '2026-09-15', 50_000, 0), taxTreatment: 'exempt' } as never;
  // the copy `tax.file` kept on 15 Oct, from i1 alone: tax 8,250; gross 1,000.00; no exempt
  const filedCopy = {
    startDate: '2026-07-01', endDate: '2026-09-30', registration: 'sales_tax:US-TX:3200', kind: 'sales_tax' as const,
    boxes: usSalesTaxReturnBoxes({ grossSalesCents: 100_000, exemptSalesCents: 0, taxCollectedCents: 8_250 }),
  };
  const run = (extra: Record<string, unknown> = {}) => usQuarterJourney({
    quarter: '2026-Q3', today: '2026-10-20', currency: 'USD', profiles, order: ['world'],
    customers, invoices: [i1, i2, i3], filedPeriods: [filedCopy], ...extra,
  });

  test('the filed copy\'s boxes are compared with the same boxes recomputed now', () => {
    const [returned] = run().steps.find(s => s.id === 'state-returns')!.returns;
    // by hand: i1 + i2 = 9,900 tax; gross 1,000.00 + 200.00 + 500.00 = 1,700.00; i3 exempt 500.00
    assert.deepEqual(returned.changes, [
      { key: '1', label: 'Sales tax collected', filedCents: 8_250, nowCents: 9_900 },
      { key: '3', label: 'Total tax due', filedCents: 8_250, nowCents: 9_900 },
      { key: '5', label: 'Net tax payable', filedCents: 8_250, nowCents: 9_900 },
      { key: '6', label: 'Gross sales', filedCents: 100_000, nowCents: 170_000 },
      { key: '9', label: 'Exempt sales', filedCents: 0, nowCents: 50_000 },
    ]);
    assert.equal(returned.filed, true, 'the return is still shown as filed');
  });

  test('nothing changed since filing gives an empty list, not a missing comparison', () => {
    const [returned] = run({ invoices: [i1], filedPeriods: [filedCopy] }).steps.find(s => s.id === 'state-returns')!.returns;
    assert.deepEqual(returned.changes, []);
  });

  test('no filed copy, another permit\'s copy, or a partial run claims nothing', () => {
    const noCopy = run({ filedPeriods: [] }).steps.find(s => s.id === 'state-returns')!.returns[0];
    assert.equal(noCopy.changes, undefined, 'no copy filed');
    const otherPermit = run({ filedPeriods: [{ ...filedCopy, registration: 'sales_tax:US-CA:9999' }] }).steps.find(s => s.id === 'state-returns')!.returns[0];
    assert.equal(otherPermit.changes, undefined, 'another permit\'s copy is not this one\'s');
    const partial = run({ partial: true }).steps.find(s => s.id === 'state-returns')!.returns[0];
    assert.equal(partial.changes, undefined, 'a partial run does not compare');
  });

  test('the export keeps the comparison as its own column', () => {
    const journey = run();
    const headers = US_QUARTER_JOURNEY_CSV_HEADERS;
    assert.equal(headers.at(-1), 'Since filed');
    const rows = usQuarterJourneyCsvRows(journey);
    const returnRow = rows.find(r => r[5] === 'TX 3200')!;
    assert.equal(returnRow.length, headers.length);
    // box 1: filed 82.50, now 99.00 (+16.50); box 6: filed 1,000.00, now 1,700.00 (+700.00); box 9: filed 0.00, now 500.00 (+500.00)
    assert.match(returnRow.at(-1)!, /box 1: filed 82\.50, now 99\.00 \(\+16\.50\)/);
    assert.match(returnRow.at(-1)!, /box 6: filed 1000\.00, now 1700\.00 \(\+700\.00\)/);
    assert.match(returnRow.at(-1)!, /box 9: filed 0\.00, now 500\.00 \(\+500\.00\)/);
  });
});

describe('Israel month journey: changes since the return was filed (T-08)', () => {
  const profiles: TaxProfiles = {
    books: { name: 'Tel Aviv Ltd', registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' }, filing: 'monthly' }] },
  } as TaxProfiles;
  const customers = [{ id: 'c1', name: 'Buyer Ltd' }];
  const invoice = (id: string, netCents: number, vatCents: number): never => ({
    id, number: id.toUpperCase(), date: '2026-09-10', status: 'sent', taxVersion: 2,
    amountCents: netCents + vatCents, taxAmountCents: vatCents, customerId: 'c1',
  }) as never;
  const i1 = invoice('i1', 100_000, 18_000); // 1,000.00 net + 18% VAT
  const credit = { id: 'cn1', number: 'CN1', date: '2026-09-25', status: 'issued', taxVersion: 2, amountCents: 11_800, taxAmountCents: 1_800, customerId: 'c1' } as never;
  // the copy `tax.file` kept on 5 Oct, from i1 alone
  const filedCopy = {
    startDate: '2026-09-01', endDate: '2026-09-30', registration: 'vat:IL:514000000',
    boxes: [
      box('1', 18_000, 'Tax on sales'), box('2', 0), box('3', 18_000, 'Total tax due'),
      box('4', 0), box('5', 18_000, 'Net tax to pay (negative: to reclaim)'), box('6', 100_000, 'Sales excluding tax'),
      box('7', 0), box('8', 0), box('9', 0),
    ],
  };
  const run = (extra: Record<string, unknown> = {}) => israelMonthJourney({
    month: '2026-09', today: '2026-10-20', currency: 'ILS', profiles, order: ['world'],
    customers, invoices: [i1], ...extra,
  });

  test('the filed copy\'s boxes are compared with the same boxes recomputed now', () => {
    const [returned] = run({ creditNotes: [credit], filedPeriods: [filedCopy] })
      .steps.find(s => s.id === 'vat-report')!.returns;
    // by hand: the credit note takes 1,800 off box 1/3/5 and 10,000 off box 6
    assert.deepEqual(returned.changes, [
      { key: '1', label: 'Tax on sales', filedCents: 18_000, nowCents: 16_200 },
      { key: '3', label: 'Total tax due', filedCents: 18_000, nowCents: 16_200 },
      { key: '5', label: 'Net tax to pay (negative: to reclaim)', filedCents: 18_000, nowCents: 16_200 },
      { key: '6', label: 'Sales excluding tax', filedCents: 100_000, nowCents: 90_000 },
    ]);
    assert.equal(returned.filed, true);
  });

  test('nothing changed since filing gives an empty list', () => {
    const [returned] = run({ invoices: [i1], filedPeriods: [filedCopy] }).steps.find(s => s.id === 'vat-report')!.returns;
    assert.deepEqual(returned.changes, []);
  });

  test('no filed copy, another registration\'s copy, or a partial run claims nothing', () => {
    const noCopy = run({ creditNotes: [credit], filedPeriods: [] }).steps.find(s => s.id === 'vat-report')!.returns[0];
    assert.equal(noCopy.changes, undefined);
    const otherReg = run({ creditNotes: [credit], filedPeriods: [{ ...filedCopy, registration: 'vat:IL:514000002' }] }).steps.find(s => s.id === 'vat-report')!.returns[0];
    assert.equal(otherReg.changes, undefined);
    const partial = run({ creditNotes: [credit], filedPeriods: [filedCopy], partial: true }).steps.find(s => s.id === 'vat-report')!.returns[0];
    assert.equal(partial.changes, undefined);
  });
});
