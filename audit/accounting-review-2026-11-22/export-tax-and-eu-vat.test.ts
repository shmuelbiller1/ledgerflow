// Verification of resolveLineTax + taxChoiceFor + computeTaxReturn on UK/CA/EU exports and intra-EU sales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLineTax, taxChoiceFor } from '../../src/lib/tax/resolveLineTax';
import { ukVatRateTable } from '../../src/lib/tax/ukVat';
import { euVatRateTable } from '../../src/lib/tax/euVat';
import { computeTaxReturn, effectiveRate, type TaxCode } from '../../src/lib/taxCodes';

test('resolveLineTax + taxChoiceFor classifies UK/EU exports as exempt (Box 9) instead of zero-rated (Box 8) and treats intra-EU sales as 0% exports', () => {
  const salesCodes: TaxCode[] = [
    { id: 'uk-std', name: 'UK Standard 20%', treatment: 'standard', components: [{ name: 'UK VAT', rate: 20 }] },
    { id: 'uk-zero', name: 'UK Zero-Rated 0%', treatment: 'zero_rated', components: [] },
    { id: 'uk-exempt', name: 'UK Exempt', treatment: 'exempt', components: [] },
  ];

  // 1. UK VAT-registered seller exporting goods to US customer:
  const ukExport = resolveLineTax({
    seller: {
      name: 'London Widgets Ltd',
      place: { country: 'GB' },
      registrations: [{ id: 'gb-vat', kind: 'vat', place: { country: 'GB' }, number: 'GB123456789', validFrom: '2020-01-01' }],
    },
    buyer: { country: 'US', state: 'NY' },
    date: '2026-06-15',
    tables: { GB: ukVatRateTable() },
  });

  // Expected for UK export (VATA 1994 s.30(6)): treatment === 'zero_rated' -> taxChoiceFor picks 'uk-zero' -> Box 8 = £1,000, Box 9 = £0.
  // Actual: treatment is undefined (only 'IL' sets 'zero_rated'), so taxChoiceFor(0, ...) picks 'uk-exempt' -> Box 8 = £0, Box 9 = £1,000!
  assert.equal(ukExport.reason, 'export');
  assert.equal(ukExport.treatment, undefined);
  const chosen = taxChoiceFor(ukExport.rate, salesCodes, c => effectiveRate(c), ukExport.treatment);
  assert.equal(chosen.taxCodeId, 'uk-exempt');

  const pickedCode = salesCodes.find(c => c.id === chosen.taxCodeId)!;
  const ret = computeTaxReturn({
    startDate: '2026-06-01', endDate: '2026-06-30',
    sales: [{ id: 'inv-uk-exp', date: '2026-06-15', status: 'sent', netCents: 100_000, taxCents: 0, taxTreatment: pickedCode.treatment }],
    purchases: [],
  });
  const box = (k: string) => ret.boxes.find(b => b.key === k)?.cents;
  assert.equal(box('8'), 0);       // Zero-rated sales: £0 instead of £1,000!
  assert.equal(box('9'), 100_000); // Exempt sales: £1,000 instead of £0!

  // 2. German VAT-registered seller selling to a consumer in France (no EU VAT ID):
  const intraEu = resolveLineTax({
    seller: {
      name: 'Berlin Tools GmbH',
      place: { country: 'DE' },
      registrations: [{ id: 'de-vat', kind: 'vat', place: { country: 'DE' }, number: 'DE123456789', validFrom: '2020-01-01' }],
    },
    buyer: { country: 'FR', city: 'Paris' },
    date: '2026-06-15',
    tables: { DE: euVatRateTable() },
  });
  // Unconditionally marked 'export' at 0% despite FR being an intra-EU destination with no buyer VAT ID check:
  assert.equal(intraEu.reason, 'export');
  assert.equal(intraEu.rate, 0);

  console.log(JSON.stringify({
    ukExportTreatment: ukExport.treatment ?? null,
    ukExportPickedCode: chosen.taxCodeId,
    ukReturnBox8ZeroRatedCents: box('8'),
    ukReturnBox9ExemptCents: box('9'),
    deToFrReason: intraEu.reason,
    deToFrRate: intraEu.rate,
  }));
});
