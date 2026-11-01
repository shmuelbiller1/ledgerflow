/**
 * A-38: the EU's VAT table (A-25) written as rules. Every country gets its standard-rate rules
 * (dated). A reduced row becomes a rule only when its `appliesTo` names an item tax category
 * (A-30) — the words maps below say which — and the rule then also requires `productCategory`.
 * A reduced row nothing maps is listed under `unmapped` with its words, never guessed into a rule.
 */
import { EU_VAT_RATES } from '../../tax/euVat';
import { rateRule, where, slug, type TaxRulePack, type UnmappedRow } from './shared';
import type { TaxCategoryId } from '../../tax/taxCategories';

/** The words a reduced row uses for a category. An exact word match; nothing inferred. */
const CATEGORY_WORDS: Array<[TaxCategoryId, string[]]> = [
  ['groceries', ['food', 'basic food', 'some food', 'food,']],
  ['prepared-food', ['restaurants', 'catering', 'hospitality', 'restaurants,', 'restaurant']],
  ['prescription-medicine', ['medicines', 'prescription medicines', 'medicines,', 'medicines (a 14% list)']],
  ['books', ['books', 'publications', 'newspapers', 'printed matter']],
  ['digital-goods', ['digital', 'software', 'e-books', 'electronically supplied services']],
  ['clothing', ['clothing', 'children’s clothes', 'footwear']],
];

/** The categories named by an `appliesTo` string (a word-by-word match against CATEGORY_WORDS). */
export function categoriesInWords(appliesTo: string): TaxCategoryId[] {
  const words = appliesTo.toLowerCase().split(/[,;()]/).map(w => w.trim()).filter(Boolean);
  const found = new Set<TaxCategoryId>();
  for (const [category, names] of CATEGORY_WORDS) {
    if (words.some(w => names.some(n => w === n || w.startsWith(n)))) found.add(category);
  }
  return [...found];
}

export function euVatPack(): TaxRulePack {
  const unmapped: UnmappedRow[] = [];
  const rules = EU_VAT_RATES.flatMap(row => {
    const base = {
      id: `eu-${slug(row.country)}-${row.kind}-${slug(row.validFrom)}-${slug(String(row.rate))}${row.appliesTo ? `-${slug(row.appliesTo)}` : ''}`,
      name: `${row.countryName} ${row.kind === 'standard' ? 'standard' : 'reduced'} VAT ${(row.rate * 100).toFixed(2).replace(/\.?(?<!0)0+$/, '')}%`,
      effect: { kind: 'rate' as const, level: 'country' as const, name: `${row.countryName} VAT`, rate: row.rate },
      validFrom: row.validFrom,
      ...(row.validTo ? { validTo: row.validTo } : {}),
      source: { authority: `${row.countryName} tax authority`, url: row.source, retrieved: row.checked },
    };
    if (row.kind === 'standard') {
      return [rateRule({ ...base, when: [where('country', [row.country])] })];
    }
    const categories = categoriesInWords(row.appliesTo || '');
    if (!categories.length && row.rate !== 0) {
      unmapped.push({ row: `${row.country} ${row.rate}: ${row.appliesTo}`, reason: 'no item tax category matches these words yet' });
      return [];
    }
    return [rateRule({
      ...base,
      when: [where('country', [row.country]), where('productCategory', categories)],
      ...(categories.length ? {} : { name: `${row.countryName} zero-rated VAT` }),
    })];
  });
  return { id: 'eu-vat', name: 'European Union VAT', rules, unmapped };
}
