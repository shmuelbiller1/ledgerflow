/** Synthetic, read-only #928 reproduction. Hand-calculated expectations, not a fix test. */
import assert from 'node:assert/strict';
import { israelVatReturn, type IlVatDocument } from '../../src/lib/tax/ilVatReturn';
import type { TaxProfiles } from '../../src/lib/tax/profile';
import { buildAccountantPack, packCsvFiles } from '../../src/lib/accountantExportPack';

const profiles = { books: { name: 'Synthetic IL books', place: { country: 'IL' }, registrations: [
  { kind: 'vat', number: '514000000', place: { country: 'IL' }, filing: 'bimonthly' },
] } } as unknown as TaxProfiles;
const document = (id: string, net: number, tax: number, fixedAsset = false): IlVatDocument => ({
  id, date: '2026-09-10', status: 'paid', currency: 'JPY', exchangeRate: 0.02,
  taxVersion: 2, amountCents: net + tax, taxAmountCents: tax, taxTreatment: 'standard', fixedAsset,
});
const result = israelVatReturn({ registration: 'vat:IL:514000000', profiles, order: ['entity'],
  invoices: [document('sale', 10000, 1800)], bills: [document('asset', 5000, 900, true)],
  startDate: '2026-09-01', endDate: '2026-10-31' });
// ¥10,000 net + ¥1,800 tax and ¥5,000 net + ¥900 tax at ₪0.02/¥:
// expected: ₪200 net, ₪36 output, ₪18 input, ₪18 due, all ×100 for agorot.
const expected = { taxableSalesCents: 20000, outputVatCents: 3600, fixedAssetInputVatCents: 1800, toPayCents: 1800 };
const observed = { taxableSalesCents: result.taxableSalesCents, outputVatCents: result.outputVatCents,
  fixedAssetInputVatCents: result.fixedAssetInputVatCents, toPayCents: result.toPayCents };
console.log(JSON.stringify({ expected, observed, documentCount: result.documentCount }, null, 2));
assert.equal(result.documentCount, 2);
assert.deepEqual(observed, { taxableSalesCents: 200, outputVatCents: 36, fixedAssetInputVatCents: 18, toPayCents: 18 });

// Independent pack path, same synthetic documents. ILS has two decimals, so CSV values are
// hand-calculated as 36.00 output, 18.00 reclaimable, 18.00 payable and 200.00 net sales.
const pack = buildAccountantPack({
  workspaceName: 'Synthetic IL books', currency: 'ILS', startDate: '2026-09-01', endDate: '2026-09-30',
  asOfDate: '2026-09-30', generatedAt: '2026-10-01T00:00:00.000Z', accounts: [], transactions: [],
  customers: [], vendors: [], invoices: [document('sale', 10000, 1800)] as never[],
  bills: [document('asset', 5000, 900, true)] as never[],
});
const taxSection = pack.sections.find(section => section.key === 'tax-by-period');
assert.ok(taxSection);
const monthly = taxSection.rows[0];
console.log(JSON.stringify({ packExpectedOutput: '36.00', packActualOutput: monthly[4],
  packExpectedInput: '18.00', packActualInput: monthly[7], packExpectedDue: '18.00', packActualDue: monthly[8],
  packExpectedSales: '200.00', packActualSales: monthly[9], totalDueCents: pack.totals.taxDueCents }, null, 2));
assert.deepEqual(monthly.slice(4, 11), ['0.36', '0.00', '0.36', '0.18', '0.18', '2.00', '1.00']);
assert.equal(pack.totals.taxDueCents, 18);
const csv = packCsvFiles(pack).find(file => file.path.endsWith('/tax-liability-by-period.csv'));
assert.ok(csv);
assert.match(csv.content, /"2026-09","2026-09-01","2026-09-30","2","0\.36","0\.00","0\.36","0\.18","0\.18","2\.00","1\.00"/);
console.log('Tax CSV produced:', csv.path);
