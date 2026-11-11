/**
 * The owner's rule graph (PLAN §10): facts from every dimension, rules that accumulate, override or
 * exclude, verified facts required where the law decides, and conflicts never silently resolved.
 * The rules here are examples of the machinery, not tax content.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeFacts, type Fact, type FactSources } from '../lib/rules/facts';
import { evaluateRules, type Rule } from '../lib/rules/rules';

const checked = (ref: string) => ({ kind: 'authority' as const, ref, verifiedBy: 'accountant-1', verifiedAt: '2026-02-01' });
const f = (attribute: Fact['attribute'], value: string, extra: Partial<Fact> = {}): Fact => ({ attribute, value, ...extra });

const sources: FactSources = {
  books: [f('country', 'US'), f('accountingMethod', 'accrual')],
  labels: {
    // Company A: an LLC in Texas taxed as an S corporation (the election is verified)
    'world:a': [f('legalForm', 'llc'), f('taxTreatment', 's_corporation', { evidence: checked('IRS acceptance letter') }), f('state', 'TX')],
    'world:a/austin': [f('city', 'Austin')],
    // Company D: a nonprofit corporation whose exemption is only declared
    'world:d': [f('legalForm', 'nonprofit_corporation'), f('exemptStatus', 'recognized_exempt', { evidence: { kind: 'declared' } }), f('state', 'NY')],
    // Company C: an Israeli osek patur
    'world:c': [f('country', 'IL'), f('taxTreatment', 'il_osek_patur')],
    // labels of other dimensions add facts too
    'activity:retail': [f('activity', 'retail')],
    'activity:services': [f('activity', 'services')],
    'location:ny-shop': [f('state', 'NY')],
  },
};
const order = ['world', 'activity', 'location'];

const SRC = { authority: 'example', url: 'https://example.test' };
const rules: Rule<string>[] = [
  { id: 'us-1120s', name: 'Files Form 1120-S', scope: 'entity-period', when: [{ attribute: 'taxTreatment', op: 'in', values: ['s_corporation'] }], requiresVerified: ['taxTreatment'], combine: 'accumulate', effect: '1120-S', validFrom: '2000-01-01', source: SRC, status: 'calculation' },
  { id: 'tx-franchise', name: 'Texas franchise tax report', scope: 'entity-period', when: [{ attribute: 'state', op: 'in', values: ['TX'] }, { attribute: 'legalForm', op: 'in', values: ['llc', 'corporation'] }], combine: 'accumulate', effect: 'franchise', validFrom: '2000-01-01', source: SRC, status: 'calculation' },
  { id: 'us-990', name: 'Files Form 990', scope: 'entity-period', when: [{ attribute: 'exemptStatus', op: 'in', values: ['recognized_exempt'] }], requiresVerified: ['exemptStatus'], combine: 'accumulate', effect: '990', validFrom: '2000-01-01', source: SRC, status: 'calculation' },
  { id: 'il-vat', name: 'Charges VAT', scope: 'line', when: [{ attribute: 'country', op: 'in', values: ['IL'] }], combine: 'accumulate', effect: 'vat18', validFrom: '2025-01-01', source: SRC, status: 'calculation' },
  { id: 'il-patur', name: 'Osek patur charges no VAT', scope: 'line', when: [{ attribute: 'taxTreatment', op: 'in', values: ['il_osek_patur'] }], combine: 'exclude', targets: ['il-vat'], effect: 'no-vat', validFrom: '2025-01-01', source: SRC, status: 'calculation' },
  { id: 'tx-sales', name: 'Texas sales tax on retail', scope: 'line', when: [{ attribute: 'state', op: 'in', values: ['TX'] }, { attribute: 'activity', op: 'in', values: ['retail'] }], combine: 'accumulate', effect: 'tx-6.25', validFrom: '2000-01-01', source: SRC, status: 'calculation' },
  { id: 'austin-local', name: 'Austin local sales tax', scope: 'line', when: [{ attribute: 'city', op: 'in', values: ['Austin'] }, { attribute: 'activity', op: 'in', values: ['retail'] }], combine: 'accumulate', effect: 'austin-2', validFrom: '2000-01-01', source: SRC, status: 'calculation' },
];
const applied = (o: ReturnType<typeof evaluateRules<string>>) => o.applied.map(a => a.rule.id).sort();

test('facts are composed from every dimension, inherited from parents and the books', () => {
  const { facts, conflicts } = composeFacts(sources, { world: 'a/austin', activity: 'retail' }, order, '2026-10-11');
  assert.deepEqual([facts.legalForm?.values, facts.taxTreatment?.values, facts.state?.values, facts.city?.values, facts.country?.values, facts.activity?.values],
    [['llc'], ['s_corporation'], ['TX'], ['Austin'], ['US'], ['retail']]);
  assert.equal(facts.taxTreatment?.verified, true);
  assert.equal(facts.legalForm?.verified, false, 'a label only declares');
  assert.deepEqual(facts.city?.from, ['world:a/austin']);
  assert.deepEqual(conflicts, []);
});

test('Company A: an LLC taxed as an S corporation in Texas files 1120-S and the franchise report; a retail line in Austin gets state and city', () => {
  const entity = composeFacts(sources, { world: 'a' }, order, '2026-10-11');
  assert.deepEqual(applied(evaluateRules(rules, entity, { date: '2026-10-11', scope: 'entity-period' })), ['tx-franchise', 'us-1120s']);
  const line = composeFacts(sources, { world: 'a/austin', activity: 'retail' }, order, '2026-10-11');
  assert.deepEqual(applied(evaluateRules(rules, line, { date: '2026-10-11', scope: 'line' })), ['austin-local', 'tx-sales']);
  const services = composeFacts(sources, { world: 'a/austin', activity: 'services' }, order, '2026-10-11');
  assert.deepEqual(applied(evaluateRules(rules, services, { date: '2026-10-11', scope: 'line' })), [], 'the activity changes the outcome');
});

test('Company D: a declared exemption is not enough; the rule is blocked and says what is missing', () => {
  const o = evaluateRules(rules, composeFacts(sources, { world: 'd' }, order, '2026-10-11'), { date: '2026-10-11', scope: 'entity-period' });
  assert.deepEqual(applied(o), []);
  assert.deepEqual(o.blocked.map(b => [b.rule.id, b.unverified]), [['us-990', ['exemptStatus']]]);
});

test('Company C: the osek patur rule switches VAT off, and the trail shows both', () => {
  const o = evaluateRules(rules, composeFacts(sources, { world: 'c' }, order, '2026-10-11'), { date: '2026-10-11', scope: 'line' });
  assert.deepEqual(applied(o), ['il-patur']);
  assert.deepEqual(o.displaced.map(d => [d.rule.id, d.by]), [['il-vat', 'il-patur']]);
  assert.deepEqual(applied(evaluateRules(rules, composeFacts(sources, { world: 'c' }, order, '2024-06-01'), { date: '2024-06-01', scope: 'line' })), [], 'rules have dates');
});

test('two dimensions that disagree on a fact: nothing that reads it is decided', () => {
  const composed = composeFacts(sources, { world: 'a', location: 'ny-shop', activity: 'retail' }, order, '2026-10-11');
  assert.deepEqual(composed.conflicts, [{ attribute: 'state', candidates: [{ value: 'TX', from: 'world:a' }, { value: 'NY', from: 'location:ny-shop' }] }]);
  const o = evaluateRules(rules, composed, { date: '2026-10-11', scope: 'line' });
  assert.deepEqual(o.undecided.map(u => [u.rule.id, u.conflicting]), [['tx-sales', ['state']]]);
});

test('saved tax profiles feed the same facts: place and registrations, inherited across dimensions', async () => {
  const { factSources } = await import('../lib/rules/fromTaxProfiles');
  const s = factSources(
    { books: { place: { country: 'IL' }, registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' } }] },
      labels: { 'world:tx': { place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', number: '32', place: { country: 'US', state: 'TX' } }] } } },
    { labels: { 'world:tx': [f('legalForm', 'llc')] } },
  );
  const { facts } = composeFacts(s, { world: 'tx' }, ['world'], '2026-10-11');
  assert.deepEqual([facts.country?.values, facts.state?.values, facts.legalForm?.values], [['US'], ['TX'], ['llc']]);
  assert.deepEqual(facts.registration?.values, ['sales_tax:US-TX:32', 'vat:IL:514000000'], 'registrations accumulate across levels');
  assert.equal(facts.registration?.verified, false, 'a number is evidence to check, not a checked fact');
});

test('set-valued fact stated both declared and verified reports verified=true (A8-1111-F6)', () => {
  const { facts } = composeFacts(
    {
      labels: { 'world:tx': [{ attribute: 'registration', value: 'sales_tax:US-TX:32', evidence: { kind: 'declared' } }] },
      books: [{ attribute: 'registration', value: 'sales_tax:US-TX:32', evidence: { kind: 'registration', ref: 'permit-32', verifiedBy: 'owner-1', verifiedAt: '2026-01-15' } }],
    },
    { world: 'tx' },
    ['world'],
    '2026-10-11',
  );
  assert.deepEqual(facts.registration?.values, ['sales_tax:US-TX:32']);
  assert.equal(facts.registration?.verified, true, 'verified evidence on books satisfies the same registration declared on a label');
});
