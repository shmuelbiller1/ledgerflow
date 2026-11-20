/** Synthetic, read-only #928 reproduction. Hand-calculated expectations, not a fix test. */
import assert from 'node:assert/strict';
import { israelVatReturn, type IlVatDocument } from '../../src/lib/tax/ilVatReturn';
import type { TaxProfiles } from '../../src/lib/tax/profile';

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
