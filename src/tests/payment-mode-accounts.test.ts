import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ACCOUNT_SLOTS, accountInUse, paymentModeAccountId, paymentModeKey } from '../lib/accountDefaults';
import type { ChartAccount } from '../types';

/** CA-28: a default account per payment method (Settings → Defaults), preselected on the payment screen. */
const acct = (id: string, name: string, extra: Partial<ChartAccount> = {}) => ({ id, name, type: 'asset', category: 'Bank', ...extra }) as ChartAccount;
const checking = acct('chk', 'Checking');
const till = acct('till', 'Cash till', { category: 'Cash' });
const undeposited = acct('und', 'Undeposited Funds', { category: 'Other Current Asset' });

describe('Mode of payment (CA-28)', () => {
  test('every payment method has a slot on the Defaults page', () => {
    for (const method of ['cash', 'check', 'bank_transfer', 'card', 'other']) {
      assert.ok(DEFAULT_ACCOUNT_SLOTS.some(s => s.key === paymentModeKey(method as never)), method);
    }
  });

  test('the account chosen for the method wins; otherwise the Bank default; otherwise the first account', () => {
    const list = [checking, till, undeposited];
    assert.equal(paymentModeAccountId('cash', list, { 'payment cash': 'till', cash: 'chk' }), 'till');
    assert.equal(paymentModeAccountId('card', list, { 'payment cash': 'till', cash: 'und' }), 'und');
    assert.equal(paymentModeAccountId('check', list, undefined), 'chk');
  });

  test('a chosen account that is no longer offered (archived, not a bank) is skipped', () => {
    assert.equal(paymentModeAccountId('cash', [checking], { 'payment cash': 'till' }), 'chk');
    assert.equal(paymentModeAccountId('cash', [], { 'payment cash': 'till' }), '');
  });

  test('Undeposited Funds may be chosen for a method', () => {
    const slot = DEFAULT_ACCOUNT_SLOTS.find(s => s.key === paymentModeKey('cash'))!;
    assert.ok(slot.fits(undeposited));
  });

  test('an archived or inactive account is never preselected', () => {
    const archived = acct('old', 'Old till', { category: 'Cash', isArchived: true });
    const inactive = acct('off', 'Closed bank', { isActive: false });
    assert.equal(paymentModeAccountId('cash', [archived, inactive, checking], { 'payment cash': 'old', cash: 'off' }), 'chk');
  });

  test('Automatic on a method row shows the chosen Bank default, as Record payment uses', () => {
    const second = acct('chk2', 'Second checking');
    const slot = DEFAULT_ACCOUNT_SLOTS.find(s => s.key === paymentModeKey('card'))!;
    assert.equal(slot.automatic([checking, second], { cash: 'chk2' })?.id, 'chk2');
    assert.equal(paymentModeAccountId('card', [checking, second], { cash: 'chk2' }), 'chk2');
  });

  test('with nothing chosen, a bank comes before Undeposited Funds even when listed after it', () => {
    assert.equal(paymentModeAccountId('cash', [undeposited, checking], undefined), 'chk');
  });

  test('Undeposited Funds alone is the automatic account, and a reclassified choice is not shown as chosen', () => {
    const slot = DEFAULT_ACCOUNT_SLOTS.find(s => s.key === paymentModeKey('cash'))!;
    assert.equal(slot.automatic([undeposited])?.id, 'und');
    const rent = acct('rent', 'Rent', { type: 'expense', category: 'Expense' });
    assert.equal(accountInUse(slot, [checking, rent], { 'payment cash': 'rent' }).chosen, false);
    assert.equal(paymentModeAccountId('cash', [checking, rent], { 'payment cash': 'rent' }), 'chk');
  });
});
