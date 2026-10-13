/**
 * A-43: Israel's default withholding-at-source rates (A-43's table in `src/lib/tax/ilWithholdingDefaults.ts`)
 * as rules. A row that answers a payment a business makes to a vendor becomes a rule over the facts
 * a payment carries (the country, the payment type and where the payee resides); the payments this
 * table documents but does not answer for a vendor — a shareholder dividend, a wage, a resident
 * royalty — are reported under `unmapped` with the reason, never dropped.
 *
 * The rules are content: `evaluateRules` decides, and the payee's own approval (evidence a rule cannot
 * invent) always replaces the default — that is why a row says so in its note and the screens read
 * `suggestedWithholdingRate`, which prefers the approval.
 */
import { IL_WITHHOLDING_DEFAULTS, type IlWithholdingDefaultRow } from '../../tax/ilWithholdingDefaults';
import { rateRule, where, type TaxRulePack, type UnmappedRow } from './shared';

export function ilWithholdingPack(): TaxRulePack {
  const unmapped: UnmappedRow[] = [];
  const rules = IL_WITHHOLDING_DEFAULTS.flatMap(row => {
    if (!row.vendorPayment) {
      unmapped.push({
        row: `${row.paymentType} ${row.residence}${row.payeeKind ? ` ${row.payeeKind}` : ''}`,
        reason: 'not a payment a business makes to a vendor on the bills path; the rate follows the payee’s own status and a person sets it (the row documents it)',
      });
      return [];
    }
    return [rateRule({
      id: row.id,
      name: `Israel withholding ${row.ratePercent}% on ${labelFor(row)}`,
      scope: 'document',
      when: [where('country', ['IL']), where('paymentType', [row.paymentType]), where('payeeResidence', [factResidence(row.residence)])],
      effect: {
        kind: 'withholding-default',
        paymentType: row.paymentType,
        residence: row.residence,
        ratePercent: row.ratePercent,
        base: row.base,
        note: row.note,
      },
      validFrom: row.validFrom,
      ...(row.validTo ? { validTo: row.validTo } : {}),
      source: row.source,
    })];
  });
  // the payments the table names but leaves to a person: the pack says so instead of staying silent
  unmapped.push(
    { row: 'royalty israel', reason: 'no default rate is established for a royalty paid to a resident; the obligation comes from a decree or the payee’s approval, so a person sets the rate' },
    { row: 'wage', reason: 'a wage is withheld by the brackets and the employee’s own approval, not by a flat default; the payroll path owns it' },
    { row: 'exempt bodies', reason: 'the regulations exempt payments to bodies the schedule names (the state, banks, listed institutions); a person confirms the payee is one' },
  );
  return { id: 'il-withholding-defaults', name: 'Israel withholding at source — default rates', rules, unmapped };
}

const labelFor = (row: IlWithholdingDefaultRow): string => ({
  'services-or-assets': 'payments for services or assets',
  'rent-expense': 'rent claimed as an expense',
  interest: 'interest',
  royalty: 'royalties',
  dividend: 'dividends',
  wage: 'wages',
} as const)[row.paymentType] + (row.residence === 'foreign' ? ' to a foreign resident' : '');

const factResidence = (residence: 'israel' | 'foreign') => (residence === 'israel' ? 'IL' : 'foreign');
