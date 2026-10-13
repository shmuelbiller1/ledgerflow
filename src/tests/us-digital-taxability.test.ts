/**
 * A-42 (extends A-31): SaaS, digital downloads and streaming per state. Hand-checked here: Washington
 * taxes a hosted subscription and a stream; California does not tax either; Texas' SaaS answer is a
 * data-processing service with an 80% base, so the row is unclear rather than a rate; New Jersey does
 * not tax a stream; Maine taxes streaming from 1 Jan 2026 and Utah from 1 Jul 2026; the five states
 * with no state sales tax are unclear in all three forms. The test also holds the two tables together
 * (a download row and A-31's `digital-goods` row are one answer) and proves the exemption reaches the
 * rule graph: a California SaaS line displaces California's own rate rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  US_DIGITAL_TAXABILITY, DIGITAL_SUBTYPES, DIGITAL_SUBTYPE_LABELS, digitalTaxabilityRows, digitalTreatment,
  digitalIsExempt, digitalIsTaxed, digitalFormMismatches, DIGITAL_GOODS_TAXABLE_STATES,
} from '../lib/tax/usDigitalTaxability';
import { US_STATE_SALES_TAX } from '../lib/tax/usStateSalesTax';
import { US_PRODUCT_TAXABILITY, productTreatment, TAX_TREATMENT_LABELS, unclearCategories } from '../lib/tax/usProductTaxability';
import { taxRulePacks, taxRulePackProblems, productTaxabilityPack, usSalesTaxPack } from '../lib/rules/packs/index';
import { evaluateRules } from '../lib/rules/rules';
import { composeFacts, type Fact } from '../lib/rules/facts';

const DATE = '2026-10-12';
const NO_STATE_TAX = ['AK', 'DE', 'MT', 'NH', 'OR'];

test('every jurisdiction answers all three forms, dated, with an https source', () => {
  assert.equal(US_DIGITAL_TAXABILITY.length, US_STATE_SALES_TAX.length * DIGITAL_SUBTYPES.length);
  assert.deepEqual(DIGITAL_SUBTYPES, ['saas', 'digital-downloads', 'streaming']);
  assert.equal(DIGITAL_SUBTYPE_LABELS.saas, 'Software as a service (SaaS)');
  for (const row of US_DIGITAL_TAXABILITY) {
    assert.match(row.source, /^https:\/\//, `${row.state} ${row.subtype}`);
    assert.match(row.validFrom, /^\d{4}-\d{2}-\d{2}$/, `${row.state} ${row.subtype}`);
    assert.match(row.checked, /^\d{4}-\d{2}-\d{2}$/, `${row.state} ${row.subtype}`);
    assert.ok(Object.keys(TAX_TREATMENT_LABELS).includes(row.treatment), `${row.state} ${row.subtype} ${row.treatment}`);
    if (row.treatment === 'exempt' || row.treatment === 'unclear') assert.equal(row.rate, undefined, `${row.state} ${row.subtype} carries no rate`);
  }
  for (const state of NO_STATE_TAX) {
    for (const subtype of DIGITAL_SUBTYPES) {
      assert.equal(digitalTreatment(state, subtype)?.treatment, 'unclear', `${state} ${subtype} has no state tax to answer`);
      assert.match(digitalTreatment(state, subtype)?.note || '', /no state sales tax/, `${state} ${subtype} says why`);
    }
  }
});

test('hand-checked answers', () => {
  assert.equal(digitalIsTaxed('WA', 'saas'), true);
  assert.equal(digitalIsExempt('CA', 'saas'), true);
  assert.equal(digitalTreatment('TX', 'saas')?.treatment, 'unclear', 'Texas taxes it as data processing on an 80% base');
  assert.match(digitalTreatment('TX', 'saas')?.note || '', /80%/, 'the base is stated');
  assert.equal(digitalTreatment('NJ', 'streaming')?.treatment, 'exempt');
  assert.equal(digitalTreatment('FL', 'streaming')?.treatment, 'exempt', 'the sales tax does not reach it; the communications services tax does');
  assert.match(digitalTreatment('FL', 'streaming')?.note || '', /communications services tax/);
  assert.equal(digitalIsTaxed('AZ', 'digital-downloads'), true);
  assert.equal(digitalIsExempt('CA', 'digital-downloads'), true);
  assert.equal(digitalTreatment('ME', 'streaming')?.validFrom, '2026-01-01', 'Maine taxes it from 1 Jan 2026');
  assert.equal(digitalTreatment('UT', 'streaming')?.validFrom, '2026-07-01', 'Utah taxes it from 1 Jul 2026');
  assert.equal(digitalTreatment('UT', 'streaming')?.treatment, 'taxable');
  assert.equal(digitalTaxabilityRows('WA').length, 3);
  assert.equal(digitalTaxabilityRows('XX').length, 0, 'an unknown state is never invented');
});

test('a download row and A-31 are one answer, so the two tables cannot drift', () => {
  for (const state of US_STATE_SALES_TAX.map(r => r.state)) {
    assert.equal(
      digitalTreatment(state, 'digital-downloads')?.treatment,
      productTreatment(state, 'digital-goods')?.treatment,
      `${state}: the download row and the coarse digital-goods row agree`,
    );
  }
  const downloads = US_DIGITAL_TAXABILITY.filter(r => r.subtype === 'digital-downloads');
  assert.equal(downloads.filter(r => r.treatment === 'taxable').length, DIGITAL_GOODS_TAXABLE_STATES.length);
});

test('A-31 reads A-42 for SaaS, and Texas stays a question', () => {
  for (const state of US_STATE_SALES_TAX.map(r => r.state)) {
    assert.equal(productTreatment(state, 'saas')?.treatment, digitalTreatment(state, 'saas')?.treatment, `${state} saas`);
  }
  assert.match(productTreatment('TX', 'saas')?.note || '', /data processing|business|confirm/i);
  assert.deepEqual([...unclearCategories('TX')].sort(), ['books', 'saas', 'services'], 'the existing hand-checked expectation still holds');
  assert.equal(productTreatment('OR', 'saas')?.treatment, 'unclear');
});

test('the states where a download and a stream differ are named, not hidden', () => {
  const mismatches = digitalFormMismatches();
  const states = mismatches.map(m => m.state);
  assert.ok(mismatches.length > 10, `${mismatches.length} states answer the two forms differently`);
  for (const state of ['NJ', 'NY', 'MI', 'WV', 'WY', 'MA']) assert.ok(states.includes(state), `${state} is listed`);
  for (const state of ['CA', 'WA', 'TX']) assert.ok(!states.includes(state), `${state} answers both forms the same way`);
  for (const mismatch of mismatches) assert.notEqual(mismatch.downloads, mismatch.streaming);
});

test('a state that does not tax SaaS switches its own rate rule off', () => {
  const exemptStates = US_STATE_SALES_TAX.map(r => r.state).filter(s => digitalIsExempt(s, 'saas'));
  assert.equal(exemptStates.length, 21, 'the states whose own guidance keeps a hosted subscription out');
  const saasRules = productTaxabilityPack().rules.filter(r => r.id.includes('-saas-'));
  assert.equal(saasRules.length, exemptStates.length);
  for (const rule of saasRules) {
    assert.equal(rule.effect.kind === 'rate' ? rule.effect.rate : -1, 0, rule.id);
    assert.equal(rule.combine, 'exclude', `${rule.id} switches the state rule off`);
    assert.ok(rule.targets?.length, rule.id);
  }

  const rules = [...usSalesTaxPack().rules, ...productTaxabilityPack().rules];
  const facts = composeFacts({ books: [
    { attribute: 'country', value: 'US' } as Fact,
    { attribute: 'state', value: 'CA' } as Fact,
    { attribute: 'productCategory', value: 'saas' } as Fact,
  ] }, {}, [], DATE);
  const outcome = evaluateRules(rules, facts, { date: DATE, scope: 'line' });
  const applied = outcome.applied.map(a => a.rule.id);
  assert.ok(applied.includes('us-cat-ca-saas-2026-01-01'), `the exemption applies: ${applied.join(', ')}`);
  assert.equal(outcome.applied.reduce((sum, a) => sum + (a.rule.effect.kind === 'rate' ? a.rule.effect.rate : 0), 0), 0, 'nothing is added back');
  assert.ok(outcome.displaced.some(d => d.rule.id === 'us-sales-ca-2004-07-01' && d.by === 'us-cat-ca-saas-2026-01-01'), 'California’s own rate rule is displaced');
});

test('the packs still hold to their promises with the digital rows and the new pack', () => {
  assert.deepEqual(taxRulePackProblems(), []);
  assert.ok(taxRulePacks().some(p => p.id === 'us-product-taxability'));
  assert.ok(US_PRODUCT_TAXABILITY.length > 0);
});
