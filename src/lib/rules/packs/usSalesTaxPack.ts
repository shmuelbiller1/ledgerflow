/**
 * A-38: the US state sales-tax table (A-22) written as rules. One accumulate rule per state row:
 * `country = US` and `state = TX` → the Texas state component on the date. The rate is the row's
 * rate, the validity the row's dates, the source the revenue department's page.
 */
import { US_STATE_SALES_TAX } from '../../tax/usStateSalesTax';
import { rateRule, where, slug, type TaxRulePack } from './shared';

export function usSalesTaxPack(): TaxRulePack {
  const rules = US_STATE_SALES_TAX.map(row => rateRule({
    id: `us-sales-${slug(row.state)}-${slug(row.validFrom)}`,
    name: `${row.stateName} state sales tax ${(row.rate * 100).toFixed(2).replace(/\.?(?<!0)0+$/, '')}%`,
    when: [where('country', ['US']), where('state', [row.state])],
    effect: { kind: 'rate', level: 'state', name: `${row.stateName} state sales tax`, rate: row.rate },
    validFrom: row.validFrom,
    ...(row.validTo ? { validTo: row.validTo } : {}),
    source: { authority: `${row.stateName} Department of Revenue`, url: row.source, retrieved: row.checked },
  }));
  return {
    id: 'us-sales-tax',
    name: 'US state sales tax (state rate)',
    rules,
    unmapped: [],
  };
}
