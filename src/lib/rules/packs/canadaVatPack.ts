/**
 * A-38: Canada's GST/HST/PST table (A-24) written as rules. HST is one rule per province period;
 * where the GST and a provincial tax are separate they are two rules that accumulate, which is the
 * point of the graph: the return still sees its own parts.
 */
import { CA_SALES_TAX } from '../../tax/caSalesTax';
import { rateRule, where, slug, type TaxRulePack, type UnmappedRow } from './shared';

const LEVEL: Record<string, 'country' | 'state'> = { GST: 'country', HST: 'country', PST: 'state', RST: 'state', QST: 'state' };

export function canadaVatPack(): TaxRulePack {
  const unmapped: UnmappedRow[] = [];
  /** The GST rules an HST rule replaces: in an HST province the 5% federal tax is inside the HST. */
  const gstRuleIds = (province: string) => CA_SALES_TAX
    .filter(r => r.province === province && r.kind === 'GST')
    .map(r => `ca-${slug(r.province)}-${slug(r.kind)}-${slug(r.validFrom)}`);
  const rules = CA_SALES_TAX.map(row => {
    const level = LEVEL[row.kind];
    if (!level) unmapped.push({ row: `${row.province} ${row.kind}`, reason: 'this tax kind has no component level' });
    return rateRule({
      id: `ca-${slug(row.province)}-${slug(row.kind)}-${slug(row.validFrom)}`,
      name: `${row.provinceName} ${row.kind} ${(row.rate * 100).toFixed(3).replace(/\.?(?<!0)0+$/, '')}%`,
      when: [where('country', ['CA']), where('state', [row.province])],
      effect: { kind: 'rate', level: level || 'state', name: `${row.kind} ${row.provinceName}`, rate: row.rate },
      // HST is one combined tax: it replaces the GST rule for that province rather than adding to it
      combine: row.kind === 'HST' ? 'override' : 'accumulate',
      ...(row.kind === 'HST' ? { targets: gstRuleIds(row.province) } : {}),
      validFrom: row.validFrom,
      ...(row.validTo ? { validTo: row.validTo } : {}),
      source: { authority: 'Canada Revenue Agency / province', url: row.source, retrieved: row.checked },
    });
  });
  return { id: 'ca-sales-tax', name: 'Canada GST / HST / PST / QST', rules, unmapped };
}
