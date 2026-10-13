/**
 * A-43: Israel's default withholding-at-source rates as a dated table and as rules. Hand-checked here:
 * 30% on a payment for a service or an asset to an Israeli supplier, 35% on rent claimed as an expense,
 * 25% to a foreign resident, and the payee's own approval always replaces the default — an approval of
 * exemption suggests 0%, an expired one falls back to the default and says the approval expired. A
 * resident royalty has no default in this table and returns nothing (a person sets it).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IL_WITHHOLDING_DEFAULTS, IL_VENDOR_PAYMENT_TYPES, ilWithholdingDefault, ilWithholdingDefaultRows,
  suggestedWithholdingRate, suggestedWithholdingForVendor,
} from '../lib/tax/ilWithholdingDefaults';
import { ilWithholdingPack } from '../lib/rules/packs/ilWithholdingPack';
import { taxRulePacks, taxRulePackProblems } from '../lib/rules/packs/index';
import { evaluateRules } from '../lib/rules/rules';
import { composeFacts, type Fact } from '../lib/rules/facts';

const DATE = '2026-10-12';

test('the table is dated, sourced and answers the vendor payments', () => {
  assert.ok(IL_WITHHOLDING_DEFAULTS.length >= 9);
  for (const row of IL_WITHHOLDING_DEFAULTS) {
    assert.match(row.source.url, /^https:\/\//, row.id);
    assert.match(row.source.retrieved, /^\d{4}-\d{2}-\d{2}$/, row.id);
    assert.match(row.validFrom, /^\d{4}-\d{2}-\d{2}$/, row.id);
    assert.ok(row.ratePercent >= 0 && row.ratePercent <= 100, row.id);
    assert.ok(row.note.length > 20, `${row.id} says what the rate is and what can change it`);
  }
  assert.deepEqual(IL_VENDOR_PAYMENT_TYPES, ['services-or-assets', 'rent-expense', 'interest', 'royalty']);
  assert.equal(ilWithholdingDefault('services-or-assets', 'israel')?.ratePercent, 30);
  assert.equal(ilWithholdingDefault('services-or-assets', 'foreign')?.ratePercent, 25);
  assert.equal(ilWithholdingDefault('rent-expense', 'israel')?.ratePercent, 35);
  assert.equal(ilWithholdingDefault('interest', 'israel')?.ratePercent, 25);
  assert.equal(ilWithholdingDefault('royalty', 'foreign')?.ratePercent, 25);
  assert.equal(ilWithholdingDefault('royalty', 'israel'), undefined, 'no default for a resident royalty');
  assert.equal(ilWithholdingDefaultRows('dividend').length, 2);
  assert.equal(ilWithholdingDefault('dividend', 'israel', 'individual')?.ratePercent, 25);
  assert.equal(ilWithholdingDefault('dividend', 'israel', 'substantial-shareholder')?.ratePercent, 30);
});

test('the vendor’s own approval always wins, and an expired one falls back with a warning', () => {
  const plain = suggestedWithholdingRate({ paymentType: 'services-or-assets', residence: 'israel', date: DATE })!;
  assert.equal(plain.ratePercent, 30);
  assert.equal(plain.basis, 'default');
  assert.ok(plain.caveats.length >= 2, 'the note and the confirmation are shown');
  assert.match(plain.reason, /no approval on file/);

  const good = suggestedWithholdingRate({ paymentType: 'services-or-assets', residence: 'israel', date: DATE, certificate: { ratePercent: 20, expires: '2026-12-31' }, certificateState: 'good' })!;
  assert.equal(good.ratePercent, 20);
  assert.equal(good.basis, 'certificate');
  assert.match(good.reason, /20%/);

  const expired = suggestedWithholdingRate({ paymentType: 'rent-expense', residence: 'israel', date: DATE, certificate: { ratePercent: 5, expires: '2026-01-31' }, certificateState: 'expired' })!;
  assert.equal(expired.ratePercent, 35);
  assert.equal(expired.basis, 'default');
  assert.equal(expired.certificateState, 'expired');
  assert.match(expired.reason, /expired/);

  assert.equal(suggestedWithholdingRate({ paymentType: 'royalty', residence: 'israel', date: DATE }), undefined, 'nothing is suggested where the table has no answer');
});

test('the suggestion reads a stored vendor through the existing helper', () => {
  const exempt = suggestedWithholdingForVendor({ metadata: { withholding: { ratePercent: 0, expires: '2027-01-01' } } }, { paymentType: 'services-or-assets', date: DATE })!;
  assert.equal(exempt.ratePercent, 0);
  assert.equal(exempt.basis, 'certificate');
  assert.match(exempt.reason, /exemption/);

  const stale = suggestedWithholdingForVendor({ metadata: { withholding: { ratePercent: 5, expires: '2025-12-31' } } }, { paymentType: 'rent-expense', date: DATE })!;
  assert.equal(stale.ratePercent, 35);
  assert.equal(stale.certificateState, 'expired');

  const none = suggestedWithholdingForVendor({ metadata: {} }, { paymentType: 'interest', date: DATE })!;
  assert.equal(none.ratePercent, 25);
  assert.equal(none.basis, 'default');

  const foreign = suggestedWithholdingForVendor(null, { paymentType: 'services-or-assets', residence: 'foreign', date: DATE })!;
  assert.equal(foreign.ratePercent, 25);
});

test('the pack writes a rule per vendor payment and reports the payments a person sets', () => {
  const pack = ilWithholdingPack();
  assert.equal(pack.id, 'il-withholding-defaults');
  assert.equal(pack.rules.length, 7, 'services, rent, interest (resident and foreign) and a foreign royalty');
  for (const rule of pack.rules) {
    assert.equal(rule.scope, 'document');
    assert.equal(rule.effect.kind, 'withholding-default');
    assert.equal(rule.combine, 'accumulate');
    assert.equal(rule.status, 'calculation');
    assert.ok(rule.when.some(c => c.attribute === 'paymentType'));
    assert.ok(rule.when.some(c => c.attribute === 'payeeResidence'));
    assert.ok(rule.when.some(c => c.attribute === 'country' && c.values?.includes('IL')));
  }
  const unmapped = pack.unmapped.map(u => u.row);
  assert.ok(unmapped.includes('dividend israel individual'), unmapped.join(', '));
  assert.ok(unmapped.includes('wage'));
  assert.ok(unmapped.includes('royalty israel'));
  assert.ok(pack.unmapped.every(u => u.reason.length > 20));
  assert.ok(taxRulePacks().some(p => p.id === 'il-withholding-defaults'), 'the pack is registered');
  assert.deepEqual(taxRulePackProblems(), []);
});

test('a foreign supplier’s service payment answers 25% and an Israeli one 30%', () => {
  const rules = ilWithholdingPack().rules;
  const foreign = evaluateRules(rules, composeFacts({ books: [
    { attribute: 'country', value: 'IL' } as Fact,
    { attribute: 'paymentType', value: 'services-or-assets' } as Fact,
    { attribute: 'payeeResidence', value: 'foreign' } as Fact,
  ] }, {}, [], DATE), { date: DATE, scope: 'document' });
  assert.equal(foreign.applied.length, 1);
  const effect = foreign.applied[0].rule.effect;
  assert.equal(effect.kind === 'withholding-default' ? effect.ratePercent : 0, 25);

  const israeli = evaluateRules(rules, composeFacts({ books: [
    { attribute: 'country', value: 'IL' } as Fact,
    { attribute: 'paymentType', value: 'rent-expense' } as Fact,
    { attribute: 'payeeResidence', value: 'IL' } as Fact,
  ] }, {}, [], DATE), { date: DATE, scope: 'document' });
  assert.equal(israeli.applied.length, 1);
  const rent = israeli.applied[0].rule.effect;
  assert.equal(rent.kind === 'withholding-default' ? rent.ratePercent : 0, 35);
  assert.equal(rent.kind === 'withholding-default' ? rent.base : '', 'unspecified', 'the base stays a question, said so in the row');

  const other = evaluateRules(rules, composeFacts({ books: [
    { attribute: 'country', value: 'US' } as Fact,
    { attribute: 'paymentType', value: 'services-or-assets' } as Fact,
  ] }, {}, [], DATE), { date: DATE, scope: 'document' });
  assert.equal(other.applied.length, 0, 'a payment from books outside Israel is not answered by this pack');
});
