/**
 * A-38: the US product-taxability table (A-31) written as rules. Only rows that change the outcome
 * become rules — an exemption (0%) or a reduced rate (which replaces the state rate) — because "taxable at the state rate" is the
 * default the state rule already says. Rows marked `unclear` are never turned into rules: they are
 * listed under `unmapped` so a person confirms them, which is what the table's own note says.
 */
import { US_PRODUCT_TAXABILITY } from '../../tax/usProductTaxability';
import { US_STATE_SALES_TAX } from '../../tax/usStateSalesTax';
import { rateRule, where, slug, type TaxRulePack, type UnmappedRow } from './shared';

/** The state's sales-tax rule(s) in force on a date — the rules an exemption switches off. */
export function stateSalesRuleIds(state: string, date: string): string[] {
  return US_STATE_SALES_TAX
    .filter(r => r.state === state && r.validFrom <= date && (!r.validTo || date <= r.validTo))
    .map(r => `us-sales-${slug(r.state)}-${slug(r.validFrom)}`);
}

/**
 * #258 review: every state sales-tax rule whose validity overlaps a category row's (from its start to its end, or on
 * with no end), so a later general-rate row is also switched off or replaced, never added to the category's rate.
 */
export function overlappingStateSalesRuleIds(state: string, validFrom: string, validTo?: string): string[] {
  return US_STATE_SALES_TAX
    .filter(r => r.state === state && (!r.validTo || r.validTo >= validFrom) && (!validTo || r.validFrom <= validTo))
    .map(r => `us-sales-${slug(r.state)}-${slug(r.validFrom)}`);
}

export function productTaxabilityPack(): TaxRulePack {
  const unmapped: UnmappedRow[] = [];
  const rules = US_PRODUCT_TAXABILITY.flatMap(row => {
    if (row.treatment === 'taxable') return [];
    if (row.treatment === 'unclear') {
      unmapped.push({ row: `${row.state} ${row.category}`, reason: 'the state’s answer is not established in this table; confirm before relying on it' });
      return [];
    }
    const rate = row.treatment === 'exempt' ? 0 : row.rate ?? 0;
    return [rateRule({
      id: `us-cat-${slug(row.state)}-${slug(row.category)}-${slug(row.validFrom)}`,
      name: `${row.state} ${row.category}: ${row.treatment === 'exempt' ? 'exempt' : `reduced ${(rate * 100).toFixed(3).replace(/\.?(?<!0)0+$/, '')}%`}`,
      when: [where('country', ['US']), where('state', [row.state]), where('productCategory', [row.category])],
      effect: { kind: 'rate', level: 'state', name: `${row.state} ${row.category}`, rate },
      // an exemption switches the state's own rate rule off for that category (the graph's `exclude`); a reduced rate is
      // the state part itself (Utah groceries 1.75%), so it replaces the state's own rule rather than adding to it
      // (it used to accumulate: 6.25% + 1% = 7.25%). Local rates still add on top, as for any category.
      combine: row.treatment === 'exempt' ? 'exclude' : 'override',
      targets: overlappingStateSalesRuleIds(row.state, row.validFrom, row.validTo),
      validFrom: row.validFrom,
      ...(row.validTo ? { validTo: row.validTo } : {}),
      source: { authority: `${row.state} Department of Revenue`, url: row.source, retrieved: row.checked },
    })];
  });
  return { id: 'us-product-taxability', name: 'US state product taxability', rules, unmapped };
}
