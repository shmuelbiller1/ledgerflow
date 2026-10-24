import './helpers/dom';
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { canonicalContactRole, cleanContacts, contactsByRole, preferredEmailForRole, STANDARD_CONTACT_ROLES } from '../lib/contacts';
import PartyModal from '../components/common/PartyModal';

describe('A-136 contact roles on customers & vendors', () => {
  afterEach(() => cleanup());

  test('normalizes Billing / Shipping / AP / Purchasing / Owner aliases and resolves role email with company fallback', () => {
    const cleaned = cleanContacts([
      { name: 'Dana Levy', role: 'ap', email: 'AP@Vendor.co.il' },
      { name: 'Ron Avi', role: 'warehouse', email: 'dock@vendor.co.il' },
      { name: 'Noa Tal', role: 'ar', email: 'billing@vendor.co.il' },
    ]);
    assert.equal(canonicalContactRole('accounts_payable'), 'Accounts payable');
    assert.equal(contactsByRole(cleaned, 'Accounts payable')[0].name, 'Dana Levy');
    assert.equal(contactsByRole(cleaned, 'Shipping')[0].name, 'Ron Avi');
    assert.equal(preferredEmailForRole({ email: 'main@vendor.co.il', contacts: cleaned }, 'Billing'), 'billing@vendor.co.il');
    assert.equal(preferredEmailForRole({ email: 'main@vendor.co.il', contacts: cleaned }, 'Owner'), 'main@vendor.co.il');

    const { container } = render(
      <PartyModal side="customer" isOpen onClose={() => {}} onSave={() => {}} initial={null} />,
    );
    const options = Array.from(container.querySelectorAll('#contact-roles-customer option')).map(o => o.getAttribute('value'));
    assert.deepEqual(options, [...STANDARD_CONTACT_ROLES]);
  });
});
