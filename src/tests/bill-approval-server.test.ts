/**
 * Bill approval on the server (G-19, #893): a bill over the workspace limit, in book currency, is
 * decided only by an owner or an accountant other than whoever entered it, unless they are the only
 * approver; a reject can be followed by a fresh submission.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalRefused } from '../server/services/invoiceApprovalGuard';
import { BILL_PAID_BEFORE_APPROVAL, BILL_SECOND_PERSON_REFUSAL, billAwaitsApproval, serverBillApproval } from '../server/services/billApprovalGuard';
import { DEFAULT_BILL_LIMIT_CENTS, billBookCents, billLimitCents } from '../lib/billApproval';

const team = { uid: 'owner', currency: 'USD', members: ['owner', 'acc', 'book'], roles: { acc: 'accountant', book: 'bookkeeper' } };
const solo = { uid: 'owner', currency: 'USD', members: ['owner', 'book'], roles: { book: 'bookkeeper' } };
const now = '2026-11-21T16:00:00.000Z';
const heldBy = (who: string) => ({ amountCents: 600000, status: 'pending', uid: who, metadata: { approval: { state: 'awaiting', thresholdCents: 500000, requestedBy: who, requestedAt: '2026-11-20T10:00:00.000Z' } } });
const approval = (out: { metadata?: Record<string, unknown> }) => out.metadata?.approval as Record<string, unknown> | undefined;

describe('limit and currency', () => {
  test('default limit is the old $5,000; a workspace can set its own', () => {
    assert.equal(billLimitCents(undefined), DEFAULT_BILL_LIMIT_CENTS);
    assert.equal(billLimitCents({ billThresholdCents: 100000 }), 100000);
    assert.equal(billLimitCents({ billThresholdCents: 0 }), DEFAULT_BILL_LIMIT_CENTS);
  });
  test('a foreign-currency bill is measured in book currency at its own rate', () => {
    assert.equal(billBookCents({ amountCents: 400000, currency: 'EUR', exchangeRate: 1.5 }, 'USD'), 600000);
    const out = serverBillApproval(undefined, { amountCents: 400000, currency: 'EUR', exchangeRate: 1.5, status: 'approved' }, team, 'book', now);
    assert.equal(out.status, 'pending');
  });
  test('below or at the limit nothing changes (USD control)', () => {
    assert.deepEqual(serverBillApproval(undefined, { amountCents: 4250, status: 'approved' }, team, 'book', now), {});
    assert.deepEqual(serverBillApproval({ amountCents: 500000, status: 'pending' }, { status: 'approved' }, team, 'book', now), {});
  });
});

describe('deciding a held bill', () => {
  test('another approver approves it, and the record says who and when', () => {
    const out = serverBillApproval(heldBy('book'), { status: 'approved' }, team, 'acc', now);
    assert.equal(out.status, undefined);
    assert.equal(approval(out)?.state, 'approved');
    assert.equal(approval(out)?.decidedBy, 'acc');
    assert.equal(approval(out)?.requestedBy, 'book');
    assert.equal(approval(out)?.selfApproved, null);
  });
  test('the owner can finish it (the G-19 loop)', () => {
    assert.equal(approval(serverBillApproval(heldBy('book'), { status: 'approved' }, team, 'owner', now))?.state, 'approved');
  });
  test('a bookkeeper may not approve or reject it', () => {
    for (const status of ['approved', 'rejected']) assert.throws(() => serverBillApproval(heldBy('acc'), { status }, team, 'book', now), ApprovalRefused);
  });
  test('an approver may not approve a bill they entered when someone else can', () => {
    assert.throws(() => serverBillApproval(heldBy('acc'), { status: 'approved' }, team, 'acc', now), { message: BILL_SECOND_PERSON_REFUSAL });
  });
  test('the only approver may approve their own bill, and it is recorded', () => {
    const out = serverBillApproval(heldBy('owner'), { status: 'approved' }, solo, 'owner', now);
    assert.equal(approval(out)?.selfApproved, true);
  });
  test('raising the amount while approving is a new submission', () => {
    const out = serverBillApproval(heldBy('book'), { status: 'approved', amountCents: 900000 }, team, 'acc', now);
    assert.equal(out.status, 'pending');
    assert.equal(approval(out)?.requestedBy, 'acc');
  });
  test('reject, then submit again, then another approver approves', () => {
    const rejected = serverBillApproval(heldBy('book'), { status: 'rejected' }, team, 'owner', now);
    assert.equal(approval(rejected)?.state, 'rejected');
    const after = { ...heldBy('book'), status: 'rejected', metadata: rejected.metadata };
    const again = serverBillApproval(after, { status: 'pending' }, team, 'book', now);
    assert.equal(approval(again)?.state, 'awaiting');
    assert.equal(approval(again)?.requestedBy, 'book');
    const held = { ...after, status: 'pending', metadata: again.metadata };
    assert.equal(approval(serverBillApproval(held, { status: 'approved' }, team, 'acc', now))?.state, 'approved');
  });
});

describe('review findings (#978)', () => {
  test('raising a held bill and keeping it held makes the raiser the requester, so they cannot then approve it', () => {
    const raised = serverBillApproval(heldBy('book'), { amountCents: 900000 }, team, 'acc', now);
    assert.equal(approval(raised)?.requestedBy, 'acc');
    const after = { ...heldBy('book'), amountCents: 900000, metadata: raised.metadata };
    assert.throws(() => serverBillApproval(after, { status: 'approved' }, team, 'acc', now), { message: BILL_SECOND_PERSON_REFUSAL });
  });
  test('an active delegate counts as a second approver', () => {
    const delegated = { ...solo, approvalDelegates: [{ from: 'owner', to: 'book', until: '2026-12-31' }] };
    assert.equal(serverBillApproval(undefined, { amountCents: 600000, status: 'approved' }, delegated, 'book', now).status, 'pending');
    assert.throws(() => serverBillApproval(heldBy('book'), { status: 'approved' }, delegated, 'book', now), { message: BILL_SECOND_PERSON_REFUSAL });
  });
  test('an expense claim the accountant approves stays approved, recorded against the submitter', () => {
    const claim = { amountCents: 600000, status: 'draft', uid: 'book', metadata: { expenseClaim: { state: 'submitted', submittedBy: 'book', submittedAt: '2026-11-20' } } };
    const out = serverBillApproval(claim, { status: 'approved' }, team, 'acc', now);
    assert.equal(out.status, undefined);
    assert.equal(approval(out)?.state, 'approved');
    assert.equal(approval(out)?.requestedBy, 'book');
  });
});

test('a claim naming someone else as submitter than who wrote it is not trusted', () => {
  const forged = { amountCents: 600000, status: 'draft', uid: 'acc', metadata: { expenseClaim: { state: 'submitted', submittedBy: 'owner' } } };
  const out = serverBillApproval(forged, { status: 'approved' }, team, 'acc', now);
  assert.equal(out.status, 'pending');
  assert.equal(approval(out)?.requestedBy, 'acc');
});

test('a new request clears the earlier decision fields (the record is deep-merged on save)', () => {
  const after = { ...heldBy('book'), status: 'rejected', metadata: { approval: { state: 'rejected', decidedBy: 'owner', decidedAt: 'x', selfApproved: true } } };
  const again = approval(serverBillApproval(after, { status: 'pending' }, team, 'book', now));
  assert.equal(again?.decidedBy, null);
  assert.equal(again?.selfApproved, null);
});

test('a delegation runs to its last day in the workspace time zone', () => {
  const ny = { ...solo, timezone: 'America/New_York', approvalDelegates: [{ from: 'owner', to: 'book', until: '2026-11-21' }] };
  // 01:00 UTC on the 22nd is still the 21st in New York: the delegate may decide
  assert.equal(approval(serverBillApproval(heldBy('owner'), { status: 'approved' }, ny, 'book', '2026-11-22T01:00:00.000Z'))?.decidedBy, 'book');
});

test('saving the invoice or PO rule keeps the bill limit', async () => {
  const { normalizeInvoiceApproval } = await import('../lib/invoiceApproval');
  assert.equal(billLimitCents(normalizeInvoiceApproval({ enabled: true, thresholdCents: 100, billThresholdCents: 100000 })), 100000);
});

describe('saving a bill straight to approved', () => {
  test('by a bookkeeper or by one of several approvers: held for someone else', () => {
    for (const who of ['book', 'acc']) {
      const out = serverBillApproval(undefined, { amountCents: 600000, status: 'approved' }, team, who, now);
      assert.equal(out.status, 'pending');
      assert.equal(approval(out)?.requestedBy, who);
    }
  });
  test('by the only approver: approved and marked self-approved', () => {
    const out = serverBillApproval(undefined, { amountCents: 600000, status: 'approved' }, solo, 'owner', now);
    assert.equal(out.status, undefined);
    assert.equal(approval(out)?.selfApproved, true);
  });
  test('an over-limit bill saved straight as unpaid, paid or overdue is held too; a held one moved to unpaid needs an approver', () => {
    for (const status of ['unpaid', 'overdue']) {
      assert.equal(serverBillApproval(undefined, { amountCents: 600000, status }, team, 'book', now).status, 'pending', status);
    }
    // paid ones are refused: their payment entry was already built for the save
    for (const status of ['partially_paid', 'paid']) {
      assert.throws(() => serverBillApproval(undefined, { amountCents: 600000, status }, team, 'book', now), { message: BILL_PAID_BEFORE_APPROVAL });
    }
    assert.throws(() => serverBillApproval(heldBy('acc'), { status: 'unpaid' }, team, 'book', now), ApprovalRefused);
    assert.equal(approval(serverBillApproval(heldBy('book'), { status: 'unpaid' }, team, 'acc', now))?.state, 'approved');
  });
  test('raising an approved bill over the limit sends it back for approval', () => {
    const out = serverBillApproval({ amountCents: 4250, status: 'approved' }, { amountCents: 90000000 }, team, 'book', now);
    assert.equal(out.status, 'pending');
    const decided = { amountCents: 600000, status: 'approved' };
    assert.equal(serverBillApproval(decided, { amountCents: 700000 }, team, 'acc', now).status, 'pending');
    assert.deepEqual(serverBillApproval(decided, { amountCents: 550000 }, team, 'book', now), {}, 'lowering is fine');
  });
  test('an already approved bill edited again is left alone', () => {
    assert.deepEqual(serverBillApproval({ amountCents: 600000, status: 'approved' }, { notes: 'x' }, team, 'book', now), {});
  });
});

test('the payment path: a held or refused bill over the limit cannot be paid; approved or small ones can', () => {
  assert.equal(billAwaitsApproval({ amountCents: 600000, status: 'pending' }, team), true);
  assert.equal(billAwaitsApproval({ amountCents: 600000, status: 'rejected' }, team), true);
  assert.equal(billAwaitsApproval({ amountCents: 600000, status: 'approved' }, team), false);
  assert.equal(billAwaitsApproval({ amountCents: 4250, status: 'pending' }, team), false);
});
