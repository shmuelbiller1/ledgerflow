/**
 * Tax codes and the tax return (src/lib/taxCodes.ts): parts, compound parts, tax-inclusive
 * amounts that add up exactly, zero-rated / exempt / reverse charge, and the return boxes in the
 * home currency. Every number below is worked out by hand in the comment next to it.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeTax, computeTaxReturn, customRateCode, documentTotals, effectiveRate, roundTaxCents, taxCodeFromRate } from '../lib/taxCodes';
import { calculateDocumentNet, calculateDocumentTax } from '../lib/documentMath';
import type { TaxCode, TaxReturnDocument } from '../lib/taxCodes';

const vat20: TaxCode = { id: 'vat', name: 'VAT 20%', treatment: 'standard', components: [{ name: 'VAT', rate: 20 }] };
const compound: TaxCode = { id: 'c', name: 'GST + PST', treatment: 'standard', components: [{ name: 'GST', rate: 5 }, { name: 'PST', rate: 10, compound: true }] };
const split: TaxCode = { id: 's', name: 'GST + PST', treatment: 'standard', components: [{ name: 'GST', rate: 5 }, { name: 'PST', rate: 7 }] };

describe('Tax on an amount', () => {
  test('one part: 20% of 100.00 is 20.00', () => {
    const t = computeTax(10000, vat20);
    assert.deepEqual([t.netCents, t.taxCents], [10000, 2000]);
  });

  test('compound: GST 5% = 5.00, PST 10% on 105.00 = 10.50, total 15.50', () => {
    const t = computeTax(10000, compound);
    assert.deepEqual(t.components.map(c => c.taxCents), [500, 1050]);
    assert.equal(t.taxCents, 1550);
    assert.equal(effectiveRate(compound.components), 0.155);
  });

  test('tax included: 115.50 gross → 100.00 net + 5.00 + 10.50', () => {
    const t = computeTax(11550, compound, true);
    assert.deepEqual([t.netCents, ...t.components.map(c => c.taxCents)], [10000, 500, 1050]);
  });

  test('tax included always adds up to the gross amount (rounding cent on the last part)', () => {
    // 10.00 at 20%: net 8.33, tax 1.67
    const a = computeTax(1000, vat20, true);
    assert.deepEqual([a.netCents, a.taxCents], [833, 167]);
    // 10.00 at 5% + 7%: net 8.93 (1000/1.12 = 892.86), parts 0.45 + 0.63 = 10.01 → last part 0.62
    const b = computeTax(1000, split, true);
    assert.deepEqual([b.netCents, ...b.components.map(c => c.taxCents)], [893, 45, 62]);
    for (const gross of [1, 99, 1001, 123457]) {
      const t = computeTax(gross, compound, true);
      assert.equal(t.netCents + t.taxCents, gross, `gross ${gross}`);
    }
  });

  test('zero-rated and exempt charge nothing; reverse charge charges nothing but the buyer owes it', () => {
    assert.equal(computeTax(10000, { ...vat20, treatment: 'zero_rated' }).taxCents, 0);
    assert.equal(computeTax(10000, { ...vat20, treatment: 'exempt' }).taxCents, 0);
    const rc = computeTax(10000, { ...vat20, treatment: 'reverse_charge' });
    assert.deepEqual([rc.taxCents, rc.selfAssessedCents], [0, 2000]);
    assert.equal(computeTax(10000, null).taxCents, 0);
  });
});

describe('Document totals (what the forms save)', () => {
  test('prices without tax: 100.00 lines − 10.00 discount = 90.00 + 20% = 108.00 owed', () => {
    const t = documentTotals(10000, 1000, vat20, false);
    assert.deepEqual([t.subtotalCents, t.discountCents, t.netCents, t.taxCents, t.amountCents], [10000, 1000, 9000, 1800, 10800]);
  });

  test('prices with tax: 120.00 lines = 100.00 + 20.00 tax, 120.00 owed', () => {
    const t = documentTotals(12000, 0, vat20, true);
    assert.deepEqual([t.netCents, t.taxCents, t.amountCents], [10000, 2000, 12000]);
  });

  test('saved like this, the shared money rules read the same tax and net', () => {
    const t = documentTotals(10000, 1000, vat20, false);
    const saved = { amountCents: t.amountCents, taxAmountCents: t.taxCents, discountCents: t.discountCents, taxInclusive: true, taxVersion: 2 };
    assert.equal(calculateDocumentTax(saved), 1800);
    assert.equal(calculateDocumentNet(saved), 9000, 'the discount is not taken off twice');
  });

  test('a discount larger than the lines leaves nothing, not a negative total', () => {
    assert.equal(documentTotals(500, 900, vat20, false).amountCents, 0);
  });

  test('saved tax rates become codes; old fractions (0.2) and percents (20) both work', () => {
    assert.equal(taxCodeFromRate({ id: 'r', name: 'VAT', rate: 0.2 }).components[0].rate, 20);
    assert.equal(taxCodeFromRate({ id: 'r', name: 'VAT', rate: 20 }).components[0].rate, 20);
    assert.equal(computeTax(10000, taxCodeFromRate({ id: 'q', name: 'GST+QST', components: [{ name: 'GST', rate: 5 }, { name: 'QST', rate: 9.975 }] })).taxCents, 1498); // 5.00 + 9.98 (997.5 → 998)
    assert.equal(customRateCode(0), null);
  });
});

describe('Invoice PDF', () => {
  test('shows subtotal, discount, each tax part and the total in the invoice currency', async () => {
    const { generateDocumentPdf } = await import('../server/services/pdfService');
    const t = documentTotals(10000, 1000, vat20, false);
    const pdf = (await generateDocumentPdf('invoice', {
      number: 'INV-7', currency: 'EUR', items: [{ description: 'Work', quantity: 1, amountCents: 10000 }],
      amountCents: t.amountCents, lineSumCents: t.subtotalCents, discountCents: t.discountCents, taxAmountCents: t.taxCents, taxBreakdown: t.components,
    }, { name: 'Shop' }));
    const text = (await import('./helpers/pdfText')).pdfText(pdf);
    for (const shown of ['Subtotal EUR 100.00', 'Discount -EUR 10.00', 'VAT 20% EUR 18.00', 'TOTAL EUR 108.00']) {
      assert.ok(text.includes(shown), `PDF shows ${shown}`);
    }
    assert.ok(!text.includes('$'), 'no dollar sign on a euro invoice');
  });
});

describe('The tax return', () => {
  const doc = (id: string, fields: Partial<TaxReturnDocument>): TaxReturnDocument => ({ id, date: '2026-07-15', status: 'sent', netCents: 0, taxCents: 0, ...fields });
  const ret = computeTaxReturn({
    startDate: '2026-07-01', endDate: '2026-09-30',
    sales: [
      doc('s1', { taxTreatment: 'standard', netCents: 10000, taxCents: 2000 }),
      doc('s2', { taxTreatment: 'standard', netCents: 1000, taxCents: 200, exchangeRate: 1.1 }), // EUR: 11.00 + 2.20 at home
      doc('s3', { taxTreatment: 'zero_rated', netCents: 5000 }),
      doc('s4', { taxTreatment: 'exempt', netCents: 3000 }),
      doc('s5', { taxTreatment: 'standard', netCents: 9999, taxCents: 999, status: 'draft' }), // not issued
      doc('s6', { taxTreatment: 'standard', netCents: 9999, taxCents: 999, date: '2026-10-01' }), // next quarter
    ],
    salesCredits: [doc('cn1', { taxTreatment: 'standard', netCents: 1000, taxCents: 200, status: 'issued' })],
    purchases: [
      doc('p1', { taxTreatment: 'standard', netCents: 4000, taxCents: 800, status: 'approved' }),
      doc('p2', { taxTreatment: 'reverse_charge', netCents: 2000, selfAssessedCents: 400, status: 'paid' }),
    ],
  });
  const box = (key: string) => ret.boxes.find(b => b.key === key)?.cents;

  test('sales: 100.00 + 11.00 − 10.00 taxed; tax 20.00 + 2.20 − 2.00 = 20.20', () => {
    assert.deepEqual(ret.sales.standard, { netCents: 10100, taxCents: 2020 });
    assert.equal(box('1'), 2020);
  });

  test('reverse charge: 4.00 due (box 2) and reclaimable (in box 4)', () => {
    assert.equal(box('2'), 400);
    assert.equal(box('3'), 2420);
    assert.equal(box('4'), 1200); // 8.00 + 4.00
    assert.equal(box('5'), 1220);
  });

  test('sales and purchases excluding tax; zero-rated and exempt shown separately', () => {
    assert.equal(box('6'), 18100); // 101.00 + 50.00 + 30.00
    assert.equal(box('7'), 6000);
    assert.equal(box('8'), 5000);
    assert.equal(box('9'), 3000);
    assert.equal(ret.documentCount, 7);
  });
});

describe('Tax rounding policy (Y-35)', () => {
  const vat10: TaxCode = { id: 'v10', name: 'VAT 10%', treatment: 'standard', components: [{ name: 'VAT', rate: 10 }] };

  test('rounding a fraction of a cent: half up, half to even, down', () => {
    // 2.5 → 3 / 2 / 2; 3.5 → 4 / 4 / 3; 2.4999 → 2 everywhere; 2.51 → 3 / 3 / 2
    assert.deepEqual([2.5, 3.5, 2.4999, 2.51].map(c => roundTaxCents(c, 'half_up')), [3, 4, 2, 3]);
    assert.deepEqual([2.5, 3.5, 2.4999, 2.51].map(c => roundTaxCents(c, 'half_even')), [2, 4, 2, 3]);
    assert.deepEqual([2.5, 3.5, 2.4999, 2.51].map(c => roundTaxCents(c, 'down')), [2, 3, 2, 2]);
    assert.equal(roundTaxCents(-2.5, 'half_even'), -2);
  });

  test('a product a hair off in floating point is treated as its exact value', () => {
    // 1005 × 10 / 100 = 100.5 exactly on paper; 0.1 + 0.2 style error must not turn half into below-half
    assert.equal(roundTaxCents((1005 * 10) / 100, 'half_up'), 101);
    assert.equal(roundTaxCents((1005 * 10) / 100, 'half_even'), 100);
    assert.equal(roundTaxCents((10 * 0.07) * 100, 'down'), 70, '10 × 0.07 × 100 is 70.00000000000001 in floating point, still 70');
  });

  test('10% of 10.05 is 1.005: 1.01 half up, 1.00 half to even and down; the default stays half up', () => {
    assert.equal(computeTax(1005, vat10).taxCents, 101);
    assert.equal(computeTax(1005, vat10, false, 'half_up').taxCents, 101);
    assert.equal(computeTax(1005, vat10, false, 'half_even').taxCents, 100);
    assert.equal(computeTax(1005, vat10, false, 'down').taxCents, 100);
    assert.equal(documentTotals(1005, 0, vat10, false, 'half_even').amountCents, 1105);
  });

  test('prices including tax: the policy rounds the included tax (19.99 at 10% holds 1.8172…)', () => {
    assert.equal(computeTax(1999, vat10, true, 'down').taxCents, 181);
    assert.equal(computeTax(1999, vat10, true, 'down').netCents, 1818);
    assert.equal(computeTax(1999, vat10, true, 'half_even').taxCents, 182);
    // 11.55 at 10% holds exactly 1.05: unchanged by any policy
    for (const mode of ['half_up', 'half_even', 'down'] as const) assert.equal(computeTax(1155, vat10, true, mode).taxCents, 105, mode);
  });

  test('prices including tax, two parts, rounding down: no part goes negative (0.10 at 10% + 1%)', () => {
    const two: TaxCode = { id: 't', name: 'A + B', treatment: 'standard', components: [{ name: 'A', rate: 10 }, { name: 'B', rate: 1 }] };
    const t = computeTax(10, two, true, 'down');
    assert.equal(t.taxCents, 0);
    assert.equal(t.netCents, 10);
    assert.ok(t.components.every(c => c.taxCents >= 0), JSON.stringify(t.components));
    assert.equal(t.components.reduce((s, c) => s + c.taxCents, 0), 0);
  });

  test('prices including tax still add up to the gross exactly under every policy', () => {
    for (const mode of ['half_up', 'half_even', 'down'] as const) {
      const t = computeTax(1999, compound, true, mode);
      assert.equal(t.netCents + t.taxCents, 1999, mode);
      assert.equal(t.components.reduce((s, c) => s + c.taxCents, 0), t.taxCents, mode);
    }
  });
});
