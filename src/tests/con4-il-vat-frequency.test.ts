/**
 * CON-4: the Israeli VAT reporting frequency recorded on a registration (monthly / bimonthly) decides the
 * period of the VAT report and of the PCN874 draft. Bimonthly periods are January–February, March–April,
 * … November–December; the planning due date is the 15th of the month after the period.
 *
 * Hand-worked figures, agorot. One dealer (VAT 514000000), January–February 2026, 18%:
 *
 *   invoice 2001  2026-01-12  net   400,000  VAT  72,000   total   472,000
 *   invoice 2002  2026-02-09  net   600,000  VAT 108,000   total   708,000
 *   bill    8001  2026-02-20  net   250,000  VAT  45,000   total   295,000  other input
 *   invoice 2003  2026-03-02  net   900,000  VAT 162,000   (the next period: never counted here)
 *
 *   monthly, January:   taxable 400,000; output 72,000; input 0;           to pay 72,000
 *   monthly, February:  taxable 600,000; output 108,000; input 45,000;     to pay 63,000
 *   bimonthly, Jan–Feb: taxable 1,000,000; output 180,000; input 45,000;   to pay 135,000 (= 72,000 + 63,000)
 *   PCN874 Jan–Feb (whole shekels): taxable 10,000; VAT 1,800; input 450
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ilVatReportPeriod } from '../lib/tax/ilVatFilingFrequency';
import { buildPcn874FixtureDraft } from '../lib/tax/pcn874Draft';
import { ilMonthJourneyCsvRows, ilPcn874Preview, ilPcn874Rows, ilReturnForDealer, israelMonthJourney } from '../lib/israelMonthJourney';
import type { TaxProfiles } from '../lib/tax/profile';

const profilesWith = (filing: 'monthly' | 'bimonthly' | undefined): TaxProfiles => ({
  books: { name: 'Tel Aviv Ltd', registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' }, ...(filing ? { filing } : {}) }] },
});
const customers = [{ id: 'c1', name: 'Buyer Ltd', metadata: { vatNumber: '512345678' } }];
const vendors = [{ id: 'v1', name: 'Supplier Ltd', metadata: { vatNumber: '513333333' } }];
const invoices = [
  { id: 'i1', number: '2001', date: '2026-01-12', status: 'sent', taxVersion: 2, amountCents: 472000, taxAmountCents: 72000, customerId: 'c1' },
  { id: 'i2', number: '2002', date: '2026-02-09', status: 'sent', taxVersion: 2, amountCents: 708000, taxAmountCents: 108000, customerId: 'c1' },
  { id: 'i3', number: '2003', date: '2026-03-02', status: 'sent', taxVersion: 2, amountCents: 1062000, taxAmountCents: 162000, customerId: 'c1' },
] as never;
const bills = [
  { id: 'b1', number: '8001', date: '2026-02-20', status: 'pending', taxVersion: 2, amountCents: 295000, taxAmountCents: 45000, vendorId: 'v1' },
] as never;
const journey = (month: string, filing: 'monthly' | 'bimonthly' | undefined, filedPeriods: Array<{ startDate: string; endDate: string }> = []) => israelMonthJourney({
  month, today: '2026-03-20', currency: 'ILS', profiles: profilesWith(filing), order: ['world'],
  invoices, bills, customers, vendors, filedPeriods,
});
const vatReturn = (j: ReturnType<typeof journey>) => j.steps.find(s => s.id === 'vat-report')!.returns[0];
const figures = (r: ReturnType<typeof vatReturn>) => [r.startDate, r.endDate, r.taxableSalesCents, r.outputVatCents, r.otherInputVatCents, r.toPayCents, r.dueDate];

test('CON-4: the report period of a month under each frequency', () => {
  assert.deepEqual(ilVatReportPeriod('2026-02', 'bimonthly'), { frequency: 'bimonthly', startMonth: '2026-01', endMonth: '2026-02', startDate: '2026-01-01', endDate: '2026-02-28', dueDate: '2026-03-15' });
  assert.deepEqual(ilVatReportPeriod('2026-01', 'bimonthly'), ilVatReportPeriod('2026-02', 'bimonthly'), 'both months of a pair are one report');
  assert.deepEqual(ilVatReportPeriod('2024-02', 'bimonthly')?.endDate, '2024-02-29', 'a leap February');
  assert.deepEqual(ilVatReportPeriod('2026-12', 'bimonthly'), { frequency: 'bimonthly', startMonth: '2026-11', endMonth: '2026-12', startDate: '2026-11-01', endDate: '2026-12-31', dueDate: '2027-01-15' });
  assert.deepEqual(ilVatReportPeriod('2026-09', 'monthly'), { frequency: 'monthly', startMonth: '2026-09', endMonth: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30', dueDate: '2026-10-15' });
  assert.equal(ilVatReportPeriod('2026-13', 'monthly'), undefined);
  assert.equal(ilVatReportPeriod('2026-2', 'bimonthly'), undefined);
});

test('CON-4 worked figures: a monthly file reports January and February apart', () => {
  assert.deepEqual(figures(vatReturn(journey('2026-01', 'monthly'))), ['2026-01-01', '2026-01-31', 400000, 72000, 0, 72000, '2026-02-15']);
  assert.deepEqual(figures(vatReturn(journey('2026-02', 'monthly'))), ['2026-02-01', '2026-02-28', 600000, 108000, 45000, 63000, '2026-03-15']);
});

test('CON-4 worked figures: a bimonthly file reports January–February together, from either month', () => {
  const expected = ['2026-01-01', '2026-02-28', 1000000, 180000, 45000, 135000, '2026-03-15'];
  assert.deepEqual(figures(vatReturn(journey('2026-01', 'bimonthly'))), expected);
  assert.deepEqual(figures(vatReturn(journey('2026-02', 'bimonthly'))), expected);
  // 135,000 = 72,000 + 63,000: the two monthly reports add up to the bimonthly one
  assert.equal(vatReturn(journey('2026-01', 'monthly')).toPayCents + vatReturn(journey('2026-02', 'monthly')).toPayCents, 135000);
  const j = journey('2026-02', 'bimonthly');
  assert.deepEqual([vatReturn(j).startMonth, vatReturn(j).endMonth], ['2026-01', '2026-02']);
  assert.deepEqual(j.pcn874Period, { startMonth: '2026-01', endMonth: '2026-02' });
  assert.match(j.steps.find(s => s.id === 'vat-report')!.detail, /bimonthly report 2026-01 to 2026-02\): taxable sales ILS 10,000\.00, output VAT ILS 1,800\.00/);
});

test('CON-4: a return is filed when the server holds one for the registration\'s own period', () => {
  assert.equal(vatReturn(journey('2026-02', 'bimonthly', [{ startDate: '2026-02-01', endDate: '2026-02-28' }])).filed, false, 'February alone is not the bimonthly report');
  assert.equal(vatReturn(journey('2026-02', 'bimonthly', [{ startDate: '2026-01-01', endDate: '2026-02-28' }])).filed, true);
});

test('CON-4: a registration without a frequency keeps the month and states no due date', () => {
  const r = vatReturn(journey('2026-02', undefined));
  assert.deepEqual(figures(r), ['2026-02-01', '2026-02-28', 600000, 108000, 45000, 63000, undefined]);
  assert.match(journey('2026-02', undefined).steps.find(s => s.id === 'vat-report')!.detail, /no monthly or bimonthly frequency/);
});

test('CON-4 worked figures: the PCN874 draft for January–February holds both months and nothing from March', () => {
  const j = journey('2026-02', 'bimonthly');
  const preview = ilPcn874Preview({
    month: j.pcn874Period.startMonth, endMonth: j.pcn874Period.endMonth, generatedOn: '2026-03-10', currency: 'ILS', dealerId: '514000000',
    invoices, bills, customers, vendors, returns: j.steps.find(s => s.id === 'vat-report')!.returns,
  });
  assert.deepEqual([preview.startMonth, preview.endMonth], ['2026-01', '2026-02']);
  assert.deepEqual(preview.rows.map(r => r.referenceNumber), ['2001', '2002', '8001']);
  assert.deepEqual(preview.totals, { taxableSalesNis: 10000, outputVatNis: 1800, zeroRatedSalesNis: 0, inputOtherNis: 450, inputEquipmentNis: 0 });
  assert.ok(preview.comparison.every(row => row.differenceNis === 0), 'the draft matches the bimonthly report');
  assert.ok(preview.draft, preview.problem);
  assert.equal(preview.draft!.header.slice(10, 16), '202601', 'the header carries the period\'s first month');
  assert.equal(preview.draft!.transactions.length, 3);
});

test('CON-4: the draft refuses a period that is not one or two months of one year, and a date outside it', () => {
  const doc = { entryType: 'S' as const, category: 'taxable-sale' as const, counterpartyId: '000000000', invoiceDate: '2026-02-09', referenceGroup: '', referenceNumber: '2002', vatNis: 1080, baseNis: 6000, sign: '+' as const };
  assert.equal(buildPcn874FixtureDraft({ dealerId: '514000000', month: '2026-01', endMonth: '2026-02', generatedOn: '2026-03-10', documents: [doc] }).transactions.length, 1);
  assert.throws(() => buildPcn874FixtureDraft({ dealerId: '514000000', month: '2026-01', generatedOn: '2026-03-10', documents: [doc] }), /outside report month/);
  assert.throws(() => buildPcn874FixtureDraft({ dealerId: '514000000', month: '2026-01', endMonth: '2026-03', generatedOn: '2026-03-10', documents: [] }), /one month or two months/);
  assert.throws(() => buildPcn874FixtureDraft({ dealerId: '514000000', month: '2026-12', endMonth: '2027-01', generatedOn: '2027-02-10', documents: [] }), /one month or two months/);
});

// ---- review fixes (#235) ----

test('CON-4 review: January of a bimonthly pair is not due — closing January does not wait for the Jan–Feb return', () => {
  const january = journey('2026-01', 'bimonthly');
  const r = vatReturn(january);
  assert.deepEqual([r.pending, r.filed], [true, false]);
  assert.equal(january.steps.find(s => s.id === 'vat-report')!.status, 'not-applicable');
  assert.match(january.steps.find(s => s.id === 'vat-report')!.detail, /prepared after 2026-02 ends \(planning due date 2026-03-15\); nothing is owed to close 2026-01/);
  assert.deepEqual(january.steps.find(s => s.id === 'close')!.figures.find(f => f.label === 'Returns not recorded as filed'), { label: 'Returns not recorded as filed', count: 0 });
  // February ends the period: now the report is due and closing February waits for it
  const february = journey('2026-02', 'bimonthly');
  assert.deepEqual([vatReturn(february).pending, february.steps.find(s => s.id === 'vat-report')!.status], [false, 'attention']);
});

test('CON-4 review: a bimonthly registration that starts inside the pair shows the month alone and says why', () => {
  const profiles: TaxProfiles = { books: { name: 'Tel Aviv Ltd', registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' }, filing: 'bimonthly', validFrom: '2026-02-01' }] } };
  const february = israelMonthJourney({ month: '2026-02', today: '2026-03-20', currency: 'ILS', profiles, order: ['world'], invoices, bills, customers, vendors });
  // February only: taxable 600,000; output 108,000; input 45,000; to pay 63,000 — never labelled Jan–Feb
  assert.deepEqual(figures(vatReturn(february)), ['2026-02-01', '2026-02-28', 600000, 108000, 45000, 63000, '2026-03-15']);
  assert.deepEqual([vatReturn(february).startMonth, vatReturn(february).endMonth], ['2026-02', '2026-02']);
  assert.ok(february.problems.some(p => /not recorded as bimonthly for the whole 2026-01 to 2026-02 period/.test(p)), february.problems.join(' | '));
});

test('CON-4 review: with two dealers, the draft holds only the typed dealer\'s documents, matched as digits', () => {
  const profiles: TaxProfiles = {
    books: { name: 'Tel Aviv Ltd', registrations: [{ kind: 'vat', number: '514-000-000', place: { country: 'IL' }, filing: 'monthly' }] },
    labels: { 'world:south': { name: 'South Ltd', registrations: [{ kind: 'vat', number: '514000002', place: { country: 'IL' }, filing: 'bimonthly' }] } },
  };
  const south = [{ id: 's1', number: '3001', date: '2026-01-20', status: 'sent', taxVersion: 2, amountCents: 118000, taxAmountCents: 18000, customerId: 'c1', dimensions: { world: 'south' } }];
  const all = [...(invoices as unknown as typeof south), ...south] as never;
  const j = israelMonthJourney({ month: '2026-02', today: '2026-03-20', currency: 'ILS', profiles, order: ['world'], invoices: all, bills, customers, vendors });
  const returns = j.steps.find(s => s.id === 'vat-report')!.returns;
  const southReturn = ilReturnForDealer(returns, '514000002')!;
  const telAviv = ilReturnForDealer(returns, '514000000')!;
  assert.equal(telAviv.registration, 'vat:IL:514-000-000', 'found although it was saved with dashes');
  assert.equal(ilReturnForDealer(returns, ''), undefined);
  // South, Jan–Feb: only invoice 3001 — net 100,000, VAT 18,000
  assert.deepEqual([southReturn.startMonth, southReturn.endMonth, southReturn.taxableSalesCents, southReturn.outputVatCents], ['2026-01', '2026-02', 100000, 18000]);
  const rows = ilPcn874Rows({ month: '2026-01', endMonth: '2026-02', registration: southReturn.registration, profiles, order: ['world'], invoices: all, bills, customers, vendors, currency: 'ILS' });
  assert.deepEqual(rows.rows.map(r => r.referenceNumber), ['3001'], 'the other dealer\'s 2001, 2002 and 8001 are not in South\'s draft');
});

test('CON-4 review: the CSV states each return\'s own period', () => {
  const fromJanuary = ilMonthJourneyCsvRows(journey('2026-01', 'bimonthly')).find(row => row[5] === 'vat:IL:514000000')!;
  const fromFebruary = ilMonthJourneyCsvRows(journey('2026-02', 'bimonthly')).find(row => row[5] === 'vat:IL:514000000')!;
  assert.deepEqual(fromJanuary.slice(-2), ['2026-01', '2026-02']);
  assert.deepEqual(fromJanuary.slice(5, 16), fromFebruary.slice(5, 16), 'the same two-month figures from either month');
  assert.equal(fromJanuary[11], '1350.00');
});
