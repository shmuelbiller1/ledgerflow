/**
 * #928: the Israeli VAT return (form 836) converts a foreign-currency document with its own minor units.
 * Hand-worked: ILS books; ¥10,000 at 0.0067 = ₪67.00 (6,700 agorot); KWD 12.345 at 12.0 = ₪148.14
 * (14,814 agorot); $1,000.00 at 3.7 = ₪3,700.00 (370,000 agorot).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { israelVatReturn, type IlVatDocument } from '../lib/tax/ilVatReturn';
import type { TaxProfiles } from '../lib/tax/profile';

const profiles = {
  books: { name: 'IL books', place: { country: 'IL' }, registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' }, filing: 'bimonthly' }] },
} as unknown as TaxProfiles;
const registration = 'vat:IL:514000000';
const sale = (currency: string, cents: number, rate: number): IlVatDocument => ({
  id: `inv-${currency}`, date: '2026-09-10', status: 'paid', currency, exchangeRate: rate, taxVersion: 2,
  amountCents: cents, taxAmountCents: 0, taxTreatment: 'standard',
} as IlVatDocument);
const run = (doc: IlVatDocument) => israelVatReturn({
  registration, profiles, order: ['entity'], invoices: [doc], bills: [], startDate: '2026-09-01', endDate: '2026-10-31', baseCurrency: 'ILS',
});

test('yen, dinar and dollar sales come out in agorot at the right scale', () => {
  assert.equal(run(sale('JPY', 10_000, 0.0067)).taxableSalesCents, 6_700);
  assert.equal(run(sale('KWD', 12_345, 12)).taxableSalesCents, 14_814);
  assert.equal(run(sale('USD', 100_000, 3.7)).taxableSalesCents, 370_000);
});

test('the accountant pack and the month journey pass the books currency too', async () => {
  const fs = await import('node:fs');
  assert.match(fs.readFileSync('src/lib/accountantExportPack.ts', 'utf8'), /baseCurrency: input\.currency/);
  assert.match(fs.readFileSync('src/lib/israelMonthJourney.ts', 'utf8'), /baseCurrency: input\.currency/);
  assert.match(fs.readFileSync('src/components/reporting/IsraelVatReportView.tsx', 'utf8'), /baseCurrency: currency/);
});
