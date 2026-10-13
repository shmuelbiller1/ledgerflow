/**
 * A-38: the tax tables as rule packs. What the test holds: every rule has an https source, a status
 * of 'calculation' and at least one condition; no pack answers the same facts twice with different
 * rates at the same time; the packs contain the tables row for row where they should; Eilat really
 * displaces the Israeli standard rule through `evaluateRules`; a reduced EU row only becomes a rule
 * when its words name an item category, and the others are reported rather than guessed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  taxRulePacks, allTaxRules, unmappedTaxRows, taxRulePackProblems,
  usSalesTaxPack, canadaVatPack, euVatPack, ukVatPack, ilVatPack, usNexusPack, productTaxabilityPack, categoriesInWords,
} from '../lib/rules/packs/index';
import { evaluateRules } from '../lib/rules/rules';
import { composeFacts, type Fact } from '../lib/rules/facts';
import { US_STATE_SALES_TAX } from '../lib/tax/usStateSalesTax';
import { IL_VAT_STANDARD } from '../lib/tax/ilVatRates';
import { US_PRODUCT_TAXABILITY } from '../lib/tax/usProductTaxability';
import { US_NEXUS_THRESHOLDS } from '../lib/tax/usNexus';

const DATE = '2026-10-11';

test('every pack holds to its own promises', () => {
  assert.deepEqual(taxRulePackProblems(), []);
  assert.ok(allTaxRules().length > 200, `the packs carry the tables: ${allTaxRules().length} rules`);
  for (const rule of allTaxRules()) {
    assert.match(rule.source.url, /^https:\/\//, rule.id);
    assert.equal(rule.status, 'calculation', rule.id);
    assert.ok(rule.when.length >= 1, rule.id);
    assert.match(rule.validFrom, /^\d{4}-\d{2}-\d{2}$/, rule.id);
  }
});

test('the packs carry the tables row for row', () => {
  assert.equal(usSalesTaxPack().rules.length, US_STATE_SALES_TAX.length);
  assert.equal(usNexusPack().rules.length, US_NEXUS_THRESHOLDS.length);
  assert.equal(ilVatPack().rules.length, IL_VAT_STANDARD.length + 4, 'the standard rows plus the four zero areas');
  assert.equal(canadaVatPack().rules.length, 24, '13 GST rows + 11 provincial/HST rows');
  assert.equal(ukVatPack().id, 'uk-vat');
  assert.ok(ukVatPack().rules.length >= 4, 'the standard-rate history plus the reduced rows whose words name a category');

  assert.equal(productTaxabilityPack().rules.length, US_PRODUCT_TAXABILITY.filter(r => r.treatment === 'exempt' || r.treatment === 'reduced').length);
});

test('only exemptions and reduced rates become product rules; unclear rows are reported', () => {
  const pack = productTaxabilityPack();
  for (const rule of pack.rules) {
    assert.ok(rule.effect.kind === 'rate' && (rule.effect.rate === 0 || rule.effect.rate < 0.07), rule.id);
  }
  const unclear = US_PRODUCT_TAXABILITY.filter(r => r.treatment === 'unclear');
  assert.equal(pack.unmapped.length, unclear.length);
  assert.ok(pack.unmapped.some(u => u.row === 'TX saas'));
  assert.ok(unmappedTaxRows().some(u => u.pack === 'us-product-taxability'));
});

test('a reduced EU row becomes a rule only when its words name an item category', () => {
  assert.deepEqual(categoriesInWords('food, books, transport'), ['groceries', 'books']);
  assert.deepEqual(categoriesInWords('hotels, catering, leisure'), ['prepared-food']);
  assert.deepEqual(categoriesInWords('domestic fuel and power'), [], 'fuel is not one of the item categories');
  assert.deepEqual(categoriesInWords('nothing like this'), []);
  const pack = euVatPack();
  assert.ok(pack.rules.some(r => r.id.includes('de-reduced')));
  assert.ok(pack.rules.some(r => r.when.some(c => c.attribute === 'productCategory')));
  assert.ok(pack.unmapped.length > 0, 'the rows nothing maps are reported');
  assert.ok(pack.unmapped.every(u => /no item tax category/.test(u.reason)));
});

test('every EU standard row is a rule, dated, with no overlap', () => {
  const pack = euVatPack();
  const standards = pack.rules.filter(r => r.name.includes('standard VAT'));
  assert.equal(standards.length, 28, '27 member states, with Estonia’s earlier 22% row kept');
  const inForce = standards.filter(r => r.validFrom <= DATE && (!r.validTo || DATE <= r.validTo));
  assert.equal(inForce.length, 27, 'one in force per member state today');
});

test('Eilat displaces the Israeli standard rule and the outcome says so', () => {
  const pack = ilVatPack();
  const facts = composeFacts({ books: [
    { attribute: 'country', value: 'IL' } as Fact,
    { attribute: 'district', value: 'eilat' } as Fact,
  ] }, {}, [], DATE);
  const outcome = evaluateRules(pack.rules, facts, { date: DATE, scope: 'line' });
  const applied = outcome.applied.map(a => a.rule.id);
  assert.ok(applied.includes('il-vat-area-eilat'), applied.join(','));
  assert.ok(!applied.includes('il-vat-2025-01-01'), 'the 18% rule does not also apply');
  assert.deepEqual(outcome.displaced.map(d => d.rule.id), ['il-vat-2025-01-01']);
  assert.equal(outcome.displaced[0].by, 'il-vat-area-eilat');
});

test('a Texas sale finds the state rule and the rule’s rate is the table’s rate', () => {
  const facts = composeFacts({ books: [{ attribute: 'country', value: 'US' } as Fact, { attribute: 'state', value: 'TX' } as Fact] }, {}, [], DATE);
  const outcome = evaluateRules(usSalesTaxPack().rules, facts, { date: DATE, scope: 'line' });
  assert.equal(outcome.applied.length, 1);
  assert.equal(outcome.applied[0].rule.effect.kind === 'rate' && outcome.applied[0].rule.effect.rate, 0.0625);
});

test('a state’s exemption excludes the state rate for that category', () => {
  const pack = productTaxabilityPack();
  const caGroceries = pack.rules.find(r => r.id.startsWith('us-cat-ca-groceries'));
  assert.ok(caGroceries);
  assert.equal(caGroceries.combine, 'exclude');
  assert.ok(caGroceries.targets?.length, 'it names the state rule it switches off');
  const facts = composeFacts({ books: [
    { attribute: 'country', value: 'US' } as Fact,
    { attribute: 'state', value: 'CA' } as Fact,
    { attribute: 'productCategory', value: 'groceries' } as Fact,
  ] }, {}, [], DATE);
  const outcome = evaluateRules([...usSalesTaxPack().rules, ...pack.rules], facts, { date: DATE, scope: 'line' });
  assert.deepEqual(outcome.applied.map(a => a.rule.id).filter(id => id.startsWith('us-sales-')), [], 'the California rate is switched off');
  assert.ok(outcome.displaced.some(d => d.rule.id.startsWith('us-sales-ca')));
  assert.ok(outcome.applied.some(a => a.rule.id.startsWith('us-cat-ca-groceries')));
});

test('the nexus pack is entity-period and says the numbers, not a conclusion', () => {
  const pack = usNexusPack();
  const tx = pack.rules.find(r => r.id.startsWith('us-nexus-tx'))!;
  assert.equal(tx.scope, 'entity-period');
  assert.ok(tx.effect.kind === 'nexus');
  assert.equal(tx.effect.thresholdCents, 500_000_00);
  assert.equal(tx.effect.transactions, null);
  assert.ok(!/must register/i.test(tx.name), 'a rule name never tells a person what they must do');
});

test('the pack list is stable and every pack is in it', () => {
  const ids = taxRulePacks().map(p => p.id);
  assert.deepEqual(ids, ['il-vat', 'us-sales-tax', 'us-nexus', 'us-product-taxability', 'ca-sales-tax', 'uk-vat', 'eu-vat', 'registration-thresholds', 'filings', 'us-marketplace-facilitator', 'il-withholding-defaults']);
  for (const pack of taxRulePacks()) assert.ok(pack.rules.length > 0, pack.id);
});
