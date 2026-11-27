import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactsLookAlike } from '../lib/contactLikeness';

test('contacts look alike by email, company email domain, tax number or a distinctive name word', () => {
  assert.equal(contactsLookAlike({ name: 'Acme Ltd' }, { name: 'ACME LTD.' }), true);
  assert.equal(contactsLookAlike({ name: 'Acme Ltd' }, { name: 'Acme Holdings' }), true);
  assert.equal(contactsLookAlike({ name: 'IBM', email: 'ap@ibm.com' }, { name: 'International Business Machines', email: 'billing@ibm.com' }), true, 'same company domain');
  assert.equal(contactsLookAlike({ name: 'One', taxId: 'GB 123.456-789' }, { name: 'Two', taxNumber: 'gb123456789' }), true, 'tax number, any spacing');
  assert.equal(contactsLookAlike({ name: 'Jo', email: 'jo@x.test' }, { name: 'Joanne', email: 'JO@X.TEST' }), true);
});

test('two different companies do not: legal forms and public mail domains are not evidence', () => {
  assert.equal(contactsLookAlike({ name: 'Acme Ltd', email: 'ap@acme.example' }, { name: 'Beta Corp', email: 'billing@beta.example' }), false);
  assert.equal(contactsLookAlike({ name: 'Acme Ltd' }, { name: 'Beta Ltd' }), false, '"Ltd" alone is not a shared name');
  assert.equal(contactsLookAlike({ name: 'Ann', email: 'ann@gmail.com' }, { name: 'Bob', email: 'bob@gmail.com' }), false, 'a public mail domain is not shared ownership');
  assert.equal(contactsLookAlike({}, {}), false);
});

test('Hebrew company names: the legal form בע"מ is not a shared name, the real name is (Codex review on #1054)', () => {
  assert.equal(contactsLookAlike({ name: 'אלפא בע"מ' }, { name: 'בטא בע"מ' }), false);
  assert.equal(contactsLookAlike({ name: 'אלפא בע״מ' }, { name: 'בטא בעמ' }), false, 'any quote mark, or none');
  assert.equal(contactsLookAlike({ name: 'חברת אלפא' }, { name: 'חברת בטא' }), false);
  assert.equal(contactsLookAlike({ name: 'אלפא בע"מ' }, { name: 'אלפא תוכנה בע״מ' }), true, 'the same name word');
});

test('regional public-mail domains are not shared ownership either (Codex review on #1054)', () => {
  for (const domain of ['yahoo.co.uk', 'hotmail.co.uk', 'outlook.fr', 'gmail.com', 'walla.co.il', 'bezeqint.net', 'mail.ru'])
    assert.equal(contactsLookAlike({ name: 'Alpha Ltd', email: `alpha@${domain}` }, { name: 'Beta Ltd', email: `beta@${domain}` }), false, domain);
  assert.equal(contactsLookAlike({ name: 'Alpha', email: 'a@alpha.co.uk' }, { name: 'Alpha Trading', email: 'b@alpha.co.uk' }), true, 'a company domain still counts');
  assert.equal(contactsLookAlike({ name: 'One', email: 'a@acme.co.uk' }, { name: 'Two', email: 'b@acme.co.uk' }), true);
});
