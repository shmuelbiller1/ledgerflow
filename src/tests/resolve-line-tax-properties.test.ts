import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLineTax, type RateTable } from '../lib/tax/resolveLineTax';
import type { ResolvedProfile, TaxPlace } from '../lib/tax/profile';

function createRng(seed = 456789123) {
  let s = seed;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Resolve Line Tax Property Invariants (D-35)', () => {
  const rng = createRng(555666777);

  const usStates = ['CA', 'NY', 'TX', 'WA', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC'];
  const categories = ['general', 'grocery', 'clothing', 'software', 'digital_goods', 'medical', undefined];

  function randomSellerProfile(country: 'US' | 'IL' = 'US', state = 'TX'): ResolvedProfile {
    return {
      name: 'Test Business Corp',
      place: country === 'US' ? { country: 'US', state, city: 'Austin' } : { country: 'IL', city: 'Tel Aviv' },
      registrations: country === 'US' ? [
        {
          kind: 'sales_tax',
          place: { country: 'US', state },
          number: `ST-${state}-123456`,
          validFrom: '2020-01-01',
        },
      ] : [
        {
          kind: 'vat',
          place: { country: 'IL' },
          number: '512345678',
          validFrom: '2020-01-01',
        },
      ],
      from: ['books'],
    };
  }

  it('Property 1 (Non-Negative Rates): resolveLineTax never produces a negative rate or NaN', () => {
    const mockStateTable: RateTable = (place, _date, category) => {
      const base = place.state === 'TX' ? 6.25 : place.state === 'CA' ? 7.25 : 5.0;
      const rate = category === 'grocery' ? 0 : base;
      return [{ level: 'state', name: `${place.state} State Tax`, rate }];
    };

    const tables: Record<string, RateTable> = { US: mockStateTable };
    for (const state of usStates) {
      tables[`US-${state}`] = mockStateTable;
    }

    let taxedCount = 0;

    for (let trial = 0; trial < 150; trial++) {
      const sellerState = usStates[Math.floor(rng() * usStates.length)];
      const seller = randomSellerProfile('US', sellerState);

      const buyerState = usStates[Math.floor(rng() * usStates.length)];
      const buyerCountry = rng() < 0.85 ? 'US' : rng() < 0.5 ? 'IL' : 'GB';
      const buyer: TaxPlace = { country: buyerCountry, state: buyerState, city: 'City' };

      const category = categories[Math.floor(rng() * categories.length)];
      const exempt = rng() < 0.2;
      const date = '2026-06-15';

      const lineTax = resolveLineTax({
        seller,
        buyer,
        date,
        category,
        exempt,
        tables,
      });

      if (lineTax.reason === 'taxed') {
        taxedCount++;
      }

      assert.ok(Number.isFinite(lineTax.rate), `Rate must be finite, got ${lineTax.rate}`);
      assert.ok(lineTax.rate >= 0, `Rate must be non-negative, got ${lineTax.rate}`);
      assert.ok(Array.isArray(lineTax.components), 'Components must be an array');

      const sumComponents = lineTax.components.reduce((acc, c) => acc + c.rate, 0);
      assert.ok(Math.abs(sumComponents - lineTax.rate) < 1e-5, 'Rate must equal sum of component rates');
    }

    assert.ok(taxedCount > 0, `Must have at least one taxed trial, got ${taxedCount}`);
  });

  it('Property 2 (Export Zero-Rating): Cross-border sales (US seller to non-US buyer) are always export with rate = 0', () => {
    const seller = randomSellerProfile('US', 'TX');
    const foreignCountries = ['IL', 'GB', 'DE', 'CA', 'FR', 'JP', 'AU'];

    for (const country of foreignCountries) {
      const buyer: TaxPlace = { country, city: 'Capital City' };
      const lineTax = resolveLineTax({
        seller,
        buyer,
        date: '2026-06-15',
      });

      assert.equal(lineTax.reason, 'export', `Cross-border sale to ${country} must have reason 'export'`);
      assert.equal(lineTax.rate, 0, 'Export sales must have tax rate = 0');
      assert.equal(lineTax.components.length, 0);
    }
  });

  it('Property 3 (Exemption Strictness): When exempt=true, tax rate is strictly 0 with exempt-certificate reason', () => {
    const seller = randomSellerProfile('US', 'TX');
    const buyer: TaxPlace = { country: 'US', state: 'TX', city: 'Dallas' };

    for (const category of categories) {
      const lineTax = resolveLineTax({
        seller,
        buyer,
        date: '2026-06-15',
        category,
        exempt: true,
      });

      assert.equal(lineTax.reason, 'exempt-certificate', 'When exempt=true, reason must be exempt-certificate');
      assert.equal(lineTax.rate, 0, 'Exempt sale rate must be 0');
      assert.equal(lineTax.components.length, 0, 'Exempt sale components must be empty');
    }
  });

  it('Property 4 (Determinism): Identical inputs produce identical tax resolution outputs', () => {
    const seller = randomSellerProfile('US', 'CA');
    const buyer: TaxPlace = { country: 'US', state: 'CA', city: 'San Francisco' };

    const result1 = resolveLineTax({
      seller,
      buyer,
      date: '2026-06-15',
      category: 'software',
    });

    const result2 = resolveLineTax({
      seller,
      buyer,
      date: '2026-06-15',
      category: 'software',
    });

    assert.deepEqual(result1, result2, 'Tax resolution must be deterministic');
  });

  it('Property 5 (Missing Registration Invariant): Domestic sale in state where seller is not registered yields not-registered', () => {
    const seller = randomSellerProfile('US', 'TX'); // Registered only in TX
    const buyer: TaxPlace = { country: 'US', state: 'FL', city: 'Miami' }; // Buyer in FL

    const lineTax = resolveLineTax({
      seller,
      buyer,
      date: '2026-06-15',
      category: 'general',
    });

    assert.equal(lineTax.reason, 'not-registered', 'Sale in unregistered state must yield not-registered');
    assert.equal(lineTax.rate, 0);
  });
});
