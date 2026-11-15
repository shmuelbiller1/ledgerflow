/** Which existing customer a typed name means (#725 review): exact first, one loose match only, never archived. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPartyByName } from '../lib/contacts';

const people = [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Globex Ltd' }];

test('a name typed with other capitals or spaces is the existing customer', () => {
  assert.equal(matchPartyByName(people, '  acme ').party?.id, 'c1');
  assert.equal(matchPartyByName(people, 'c2').party?.id, 'c2', 'an id works too');
  assert.deepEqual(matchPartyByName(people, 'Initech'), { ambiguous: false });
});

test('ACME and Acme stay apart: the exact one wins; a loose match to both is ambiguous', () => {
  const twins = [{ id: 'up', name: 'ACME' }, { id: 'low', name: 'Acme' }];
  assert.equal(matchPartyByName(twins, 'Acme').party?.id, 'low');
  assert.equal(matchPartyByName(twins, 'ACME').party?.id, 'up');
  assert.deepEqual(matchPartyByName(twins, 'acme'), { ambiguous: true });
});

test('an archived customer is never matched (it is restored first)', () => {
  const list = [{ id: 'old', name: 'ACME', status: 'archived' }];
  assert.deepEqual(matchPartyByName(list, 'acme'), { ambiguous: false });
  assert.deepEqual(matchPartyByName(list, 'ACME'), { ambiguous: false });
});

test("editing an invoice keeps its own customer even after that customer was archived", () => {
  const list = [{ id: 'old', name: 'ACME', status: 'archived' }];
  assert.equal(matchPartyByName(list, 'ACME', ['old']).party?.id, 'old');
  assert.equal(matchPartyByName(list, 'acme', ['old']).party?.id, 'old');
  assert.deepEqual(matchPartyByName(list, 'ACME', ['other']), { ambiguous: false });
});

test('Hebrew names match through invisible direction marks and vowel marks', () => {
  const list = [{ id: 'h1', name: 'שלום' }];
  assert.equal(matchPartyByName(list, '\u200fשלום').party?.id, 'h1');
  assert.equal(matchPartyByName(list, 'שָׁלוֹם').party?.id, 'h1');
});

