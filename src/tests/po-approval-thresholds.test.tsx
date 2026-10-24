/**
 * A-120: Purchase order approval thresholds per amount.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInvoiceApproval, normalizePoApproval } from '../lib/invoiceApproval';
import { orderNeedsApproval, poOrderNeedsApproval } from '../lib/purchaseOrders';

describe('A-120 purchase order approval thresholds per amount', () => {
  afterEach(() => undefined);

  test('when PO threshold rule is off, K-23 default behavior is preserved identically', () => {
    assert.deepEqual(['owner', 'accountant', 'bookkeeper'].filter(orderNeedsApproval), ['bookkeeper']);
    assert.equal(poOrderNeedsApproval('bookkeeper'), true);
    assert.equal(poOrderNeedsApproval('accountant'), false);
    assert.equal(poOrderNeedsApproval('owner'), false);
    assert.equal(poOrderNeedsApproval('bookkeeper', { totalAmountCents: 5_00, settings: { enabled: true, thresholdCents: 100_000 } }), true);
  });

  test('when PO threshold rule is enabled, small orders pass while orders above threshold wait for approval', () => {
    const settings = normalizeInvoiceApproval({
      enabled: true,
      thresholdCents: 200_000,
      poEnabled: true,
      poThresholdCents: 150_000, // $1,500.00
    });
    assert.deepEqual(normalizePoApproval(settings), { enabled: true, thresholdCents: 150_000 });

    // Bookkeeper under or equal to $1,500.00 -> approved immediately without waiting
    assert.equal(poOrderNeedsApproval('bookkeeper', {
      totalAmountCents: 150_000,
      settings,
      currency: 'USD',
      workspaceCurrency: 'USD',
    }), false);

    // 1 cent over $1,500.00 ($1,500.01) -> requires approval for non-owners
    assert.equal(poOrderNeedsApproval('bookkeeper', {
      totalAmountCents: 150_001,
      settings,
      currency: 'USD',
      workspaceCurrency: 'USD',
    }), true);
    assert.equal(poOrderNeedsApproval('accountant', {
      totalAmountCents: 150_001,
      settings,
      currency: 'USD',
      workspaceCurrency: 'USD',
    }), true);

    // Owner signing their own PO passes immediately
    assert.equal(poOrderNeedsApproval('owner', {
      totalAmountCents: 500_000,
      settings,
      currency: 'USD',
      workspaceCurrency: 'USD',
    }), false);

    // Foreign currency PO never guesses an exchange rate -> waits for approval
    assert.equal(poOrderNeedsApproval('bookkeeper', {
      totalAmountCents: 10_000,
      settings,
      currency: 'EUR',
      workspaceCurrency: 'USD',
    }), true);
  });
});
