/**
 * A-38: the UK's VAT table (A-26) written as rules. The standard rate is one dated rule per period;
 * the reduced and zero rows become rules that also require the item's `productCategory` where the
 * row names a category, and are listed under `unmapped` where nothing matches.
 */
import { UK_VAT_RATES } from '../../tax/ukVat';
import { rateRule, where, slug, type TaxRulePack, type UnmappedRow } from './shared';
import { categoriesInWords } from './euVatPack';

export function ukVatPack(): TaxRulePack {
  const unmapped: UnmappedRow[] = [];
  const rules = UK_VAT_RATES.flatMap(row => {
    const base = {
      id: `uk-vat-${row.kind}-${slug(row.validFrom)}-${slug(String(row.rate))}`,
      name: `UK ${row.kind} VAT ${(row.rate * 100).toFixed(2).replace(/\.?(?<!0)0+$/, '')}%`,
      effect: { kind: 'rate' as const, level: 'country' as const, name: 'UK VAT', rate: row.rate },
      validFrom: row.validFrom,
      ...(row.validTo ? { validTo: row.validTo } : {}),
      source: { authority: 'HM Revenue & Customs', url: row.source, retrieved: row.checked },
    };
    if (row.kind === 'standard') return [rateRule({ ...base, when: [where('country', ['GB'])] })];
    const categories = categoriesInWords(row.appliesTo || '');
    if (!categories.length) {
      unmapped.push({ row: `UK ${row.kind}: ${row.appliesTo}`, reason: 'no item tax category matches these words yet' });
      return [];
    }
    return [rateRule({ ...base, when: [where('country', ['GB']), where('productCategory', categories)] })];
  });
  return { id: 'uk-vat', name: 'United Kingdom VAT', rules, unmapped };
}
