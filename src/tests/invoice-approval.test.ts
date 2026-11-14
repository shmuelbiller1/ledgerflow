/**
 * Invoice approval (BE-04): a workspace can hold a large invoice back from the customer until an
 * owner or an accountant has said yes. Everything decided here is a pure rule — the same rule the
 * screen, the save path and the server email send ask — so each expectation below is checked by
 * hand against the money and the wording a bookkeeper would actually see.
 *
 * The two things worth reading twice:
 * - the amount compared is the invoice total brought into the workspace's currency with the rate the
 *   invoice already carries, and the limit is "over", not "at least" — an invoice of exactly the
 *   limit goes out on its own;
 * - the state lives on the invoice as `approval`, never in `status`, because 'pending' means
 *   "issued and unpaid" (accounts receivable) and 'approved' / 'rejected' are payment states.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalChip, approvalDecision, approvalDetail, approvalForSave, approvalLimitUnits, approvalStatus,
  hasAlreadyGoneOut, holdsSending, isApproverRole, isIssuedForApproval, needsApproval, normalizeInvoiceApproval,
  parseApprovalLimit, MAX_APPROVAL_NOTE, invoiceTotalInWorkspaceCurrency,
  type InvoiceApprovalRecord,
} from '../lib/invoiceApproval';

const LIMIT = 100000; // $1,000.00
const rule = { enabled: true, thresholdCents: LIMIT };
const off = { enabled: false, thresholdCents: LIMIT };

const invoice = (over: Partial<{
  amountCents: number; exchangeRate: number; status: string; approval: InvoiceApprovalRecord | null;
  metadata: { lastSentAt?: string; sendCount?: number };
}> = {}) => ({ amountCents: 150000, status: 'pending', ...over });

describe('naming the limit', () => {
  test('a plain amount, with or without thousands separators', () => {
    assert.equal(parseApprovalLimit('1500'), 150000);
    assert.equal(parseApprovalLimit('1,500'), 150000, 'a comma separates thousands here');
    assert.equal(parseApprovalLimit(' 2000.50 '), 200050);
    assert.equal(parseApprovalLimit('2000.005'), 200001, 'half a cent rounds to the nearest cent');
    assert.equal(parseApprovalLimit(12.5), 1250, 'a number straight from a form field works too');
  });

  test('nothing usable leaves the rule off rather than inventing a threshold', () => {
    for (const junk of ['', '   ', 'ten', '€', null, undefined, {}]) {
      assert.equal(parseApprovalLimit(junk), 0, `${JSON.stringify(junk)} is not an amount`);
    }
    assert.equal(parseApprovalLimit('-5'), 0, 'a negative limit is no limit');
    assert.equal(parseApprovalLimit('0'), 0);
    assert.equal(parseApprovalLimit('NaN'), 0);
    assert.equal(parseApprovalLimit('Infinity'), 0);
  });

  test('a European decimal entry reads as the small amount it says, which holds more back, not fewer', () => {
    // "1.234,56" typed as one thousand two hundred thirty-four: commas are separators, so this
    // reads as 1.23. Deliberate — guessing at decimal points is how a limit ends up too *high*, and
    // a limit that is too low only makes the app ask for a signature.
    assert.equal(parseApprovalLimit('1.234,56'), 123);
  });

  test('the limit goes back into the box as the units a person typed', () => {
    assert.equal(approvalLimitUnits(LIMIT), '1000');
    assert.equal(approvalLimitUnits(200050), '2000.5');
    assert.equal(approvalLimitUnits(0), '', 'no limit: an empty box, not "0"');
    assert.equal(approvalLimitUnits(-1), '');
    assert.equal(parseApprovalLimit(approvalLimitUnits(150060)), 150060, 'cents survive a round trip');
  });
});

describe('the stored rule', () => {
  test('it is only on when there is a real amount to hold against', () => {
    assert.deepEqual(normalizeInvoiceApproval(rule), { enabled: true, thresholdCents: LIMIT });
    assert.deepEqual(normalizeInvoiceApproval({ enabled: true, thresholdCents: 0 }), { enabled: false, thresholdCents: 0 });
    assert.deepEqual(normalizeInvoiceApproval({ enabled: true, thresholdCents: -5 }), { enabled: false, thresholdCents: 0 }, 'a negative limit is off');
    assert.deepEqual(normalizeInvoiceApproval({ enabled: false, thresholdCents: LIMIT }), { enabled: false, thresholdCents: LIMIT }, 'the amount is kept, the switch is not');
  });

  test('a half-written or nonsense rule reads as off, and only whole cents count', () => {
    for (const junk of [undefined, null, {}, 'yes', 7, []]) {
      assert.deepEqual(normalizeInvoiceApproval(junk), { enabled: false, thresholdCents: 0 });
    }
    assert.deepEqual(normalizeInvoiceApproval({ enabled: true, thresholdCents: '1500.6' }), { enabled: true, thresholdCents: 1501 });
    assert.deepEqual(normalizeInvoiceApproval({ enabled: true, thresholdCents: Number.NaN }), { enabled: false, thresholdCents: 0 });
  });
});

describe('which invoices the rule catches', () => {
  test('over the limit; the limit itself is not over it', () => {
    assert.equal(needsApproval(invoice({ amountCents: LIMIT + 1 }), rule), true);
    assert.equal(needsApproval(invoice({ amountCents: LIMIT }), rule), false, 'an invoice of exactly the limit goes out as it always did');
    assert.equal(needsApproval(invoice({ amountCents: 99999 }), rule), false);
    assert.equal(needsApproval(invoice(), off), false, 'no rule, no approval');
  });

  test('in the workspace currency, using the rate on the invoice', () => {
    // 900.00 in a currency at 1.2 is 1,080.00 here: over a 1,000 limit.
    assert.equal(needsApproval(invoice({ amountCents: 90000, exchangeRate: 1.2 }), rule), true);
    // 900.00 at 0.5 is 450.00: under it.
    assert.equal(needsApproval(invoice({ amountCents: 90000, exchangeRate: 0.5 }), rule), false);
    assert.equal(needsApproval(invoice({ amountCents: 90000, exchangeRate: 0 }), rule), false, 'a missing rate means the invoice currency, never a zero amount');
    assert.equal(needsApproval(invoice({ amountCents: 90000, exchangeRate: -1 }), rule), false);
    assert.equal(needsApproval(invoice({ amountCents: 90000, exchangeRate: '1.5' as unknown as number }), rule), false, 'a rate that is not a number is the rate 1');
  });

  test('a draft or a void is nobody to approve, because nothing goes out of it', () => {
    for (const status of ['draft', 'void', 'cancelled']) {
      assert.equal(needsApproval(invoice({ status }), rule), false, `${status} invoices are not held`);
      assert.equal(isIssuedForApproval(status), false);
    }
    for (const status of ['pending', 'sent', 'paid', 'overdue', 'written_off']) {
      assert.equal(isIssuedForApproval(status), true, `${status} is out in the world`);
    }
    assert.equal(isIssuedForApproval(undefined), true, 'an invoice with no status at all is treated as issued, the way the rest of the app does');
  });
});

describe('where an invoice stands', () => {
  test('the five states, and what each one is waiting for', () => {
    assert.equal(approvalStatus(invoice(), off), 'off');
    assert.equal(approvalStatus(invoice({ amountCents: 50000 }), rule), 'not_needed');
    assert.equal(approvalStatus(invoice({ status: 'draft' }), rule), 'not_needed');
    assert.equal(approvalStatus(invoice(), rule), 'awaiting', 'over the limit with nothing written yet is waiting, not approved');
    assert.equal(approvalStatus(invoice({ approval: { state: 'approved', thresholdCents: LIMIT } }), rule), 'approved');
    assert.equal(approvalStatus(invoice({ approval: { state: 'rejected', thresholdCents: LIMIT } }), rule), 'rejected');
  });

  test('an approval is only ever about an invoice that is over the limit', () => {
    // The record can go stale: the amount was changed, or the workspace lowered its limit. Reading
    // it goes through the amount again, so a held invoice under the limit is released by itself.
    assert.equal(approvalStatus(invoice({ amountCents: 50000, approval: { state: 'awaiting', thresholdCents: LIMIT } }), rule), 'not_needed');
    assert.equal(holdsSending(invoice({ amountCents: 50000, approval: { state: 'awaiting', thresholdCents: LIMIT } }), rule), false);
    assert.equal(holdsSending(invoice({ amountCents: 50000, approval: { state: 'rejected', thresholdCents: LIMIT } }), rule), false);
    // ...and turning the rule off releases everything at once
    assert.equal(approvalStatus(invoice({ approval: { state: 'awaiting', thresholdCents: LIMIT } }), off), 'off');
    assert.equal(holdsSending(invoice({ approval: { state: 'awaiting', thresholdCents: LIMIT } }), off), false);
  });

  test('what may not go out', () => {
    assert.equal(holdsSending(invoice(), rule), true, 'nobody has signed it');
    assert.equal(holdsSending(invoice({ approval: { state: 'awaiting', thresholdCents: LIMIT } }), rule), true);
    assert.equal(holdsSending(invoice({ approval: { state: 'rejected', thresholdCents: LIMIT } }), rule), true, 'a sent-back invoice stays in');
    assert.equal(holdsSending(invoice({ approval: { state: 'approved', thresholdCents: LIMIT } }), rule), false);
    assert.equal(holdsSending(invoice({ status: 'paid', approval: { state: 'awaiting', thresholdCents: LIMIT } }), rule), true, 'the customer paid through the link; a further copy still waits for a signature');
  });
});

describe('a rule switched on today does not reach backwards', () => {
  test('an invoice already with the customer and no record needs nothing', () => {
    const alreadyOut = [
      invoice({ status: 'sent' }),
      invoice({ metadata: { lastSentAt: '2026-09-01T10:00:00.000Z' } }),
      invoice({ metadata: { sendCount: 3 } }),
    ];
    for (const doc of alreadyOut) {
      assert.equal(hasAlreadyGoneOut(doc), true);
      assert.equal(approvalStatus(doc, rule), 'not_needed', 'it went out before the rule existed; reminders and re-sends carry on');
      assert.equal(holdsSending(doc, rule), false);
    }
  });

  test('one that was only saved as sent, with nothing actually emailed, is still held', () => {
    const savedAsSentButBlocked = invoice({ status: 'sent', approval: { state: 'awaiting', thresholdCents: LIMIT } });
    assert.equal(approvalStatus(savedAsSentButBlocked, rule), 'awaiting', 'a record a person left is respected even after a send');
    assert.equal(holdsSending(savedAsSentButBlocked, rule), true);
    assert.equal(hasAlreadyGoneOut(invoice()), false, 'a pending invoice nobody emailed is not out yet');
    assert.equal(hasAlreadyGoneOut(invoice({ metadata: { sendCount: 0 } })), false);
  });
});

describe('stamping an invoice that starts going out', () => {
  const when = '2026-10-05T09:00:00.000Z';

  test('an owner or an accountant signs with that very save', () => {
    for (const role of ['owner', 'accountant']) {
      const stamp = approvalForSave(invoice(), rule, { role, uid: 'u1', now: when });
      assert.deepEqual(stamp, { state: 'approved', thresholdCents: LIMIT, decidedAt: when, decidedBy: 'u1' });
      assert.equal(stamp?.requestedAt, undefined, 'the signature is not a request');
    }
  });

  test('anybody else asks, and cannot approve themselves', () => {
    for (const role of ['bookkeeper', 'viewer', null, undefined, 'admin']) {
      const stamp = approvalForSave(invoice(), rule, { role, uid: 'u2', now: when });
      assert.equal(stamp?.state, 'awaiting', `${role} must wait for someone else`);
      assert.equal(stamp?.requestedBy, 'u2');
      assert.equal(stamp?.requestedAt, when);
      assert.equal(stamp?.decidedAt, undefined);
    }
  });

  test('a sent-back invoice that is fixed keeps the reason, so the author still sees what was wrong', () => {
    const sentBack = invoice({ approval: { state: 'rejected', thresholdCents: LIMIT, decidedAt: '2026-10-04T09:00:00.000Z', decidedBy: 'owner1', note: 'The hours are double-counted' } });
    const stamp = approvalForSave(sentBack, rule, { role: 'bookkeeper', uid: 'u2', now: when });
    assert.equal(stamp?.state, 'awaiting');
    assert.equal(stamp?.note, 'The hours are double-counted');
    // ...and once it is approved, the note is gone from the state that matters
    assert.equal(approvalStatus(sentBack, rule), 'rejected');
  });

  test('nothing is written when the rule does not apply, so an ordinary invoice keeps its record as it was', () => {
    assert.equal(approvalForSave(invoice({ amountCents: 50000 }), rule, { role: 'bookkeeper', now: when }), null);
    assert.equal(approvalForSave(invoice({ status: 'draft' }), rule, { role: 'owner', now: when }), null);
    assert.equal(approvalForSave(invoice(), off, { role: 'owner', now: when }), null);
  });

  test('the moment is optional: writing it now is honest enough', () => {
    const stamp = approvalForSave(invoice(), rule, { role: 'owner', uid: 'u1' });
    assert.equal(stamp?.state, 'approved');
    assert.match(String(stamp?.decidedAt), /^\d{4}-\d{2}-\d{2}T/, 'a timestamp the display can cut a date out of');
  });
});

describe('the decision from the invoice list', () => {
  test('approve leaves no note; send back carries one', () => {
    const approved = approvalDecision(rule, 'approved', { uid: 'u1', now: '2026-10-05T10:00:00.000Z', note: 'ignored' });
    assert.deepEqual(approved, { state: 'approved', thresholdCents: LIMIT, decidedAt: '2026-10-05T10:00:00.000Z', decidedBy: 'u1' });
    const rejected = approvalDecision(rule, 'rejected', { uid: 'u1', now: '2026-10-05T10:00:00.000Z', note:  ' wrong tax code ' });
    assert.equal(rejected.state, 'rejected');
    assert.equal(rejected.note, 'wrong tax code', 'spaces around a note are not part of it');
    assert.equal(rejected.decidedBy, 'u1');
    const anonymous = approvalDecision(rule, 'rejected', { uid: null });
    assert.equal(anonymous.decidedBy, undefined, 'a person we cannot name is not made up');
    assert.equal(anonymous.note, undefined, 'an empty note is no note');
  });

  test('a long reason is cut short, not refused', () => {
    const rejected = approvalDecision(rule, 'rejected', { note: 'x'.repeat(MAX_APPROVAL_NOTE + 500) });
    assert.equal(rejected.note?.length, MAX_APPROVAL_NOTE);
  });

  test('the decision is stamped against the limit in force, which may not be the one on the invoice', () => {
    const moved = approvalDecision({ enabled: true, thresholdCents: 250000 }, 'approved', {});
    assert.equal(moved.thresholdCents, 250000);
  });
});

describe('who may sign', () => {
  test('the two roles that also close the books', () => {
    assert.equal(isApproverRole('owner'), true);
    assert.equal(isApproverRole('accountant'), true);
    assert.equal(isApproverRole('bookkeeper'), false, 'a bookkeeper cannot approve their own invoice');
    assert.equal(isApproverRole('viewer'), false);
    assert.equal(isApproverRole(null), false);
    assert.equal(isApproverRole(undefined), false);
    assert.equal(isApproverRole(''), false);
  });
});

describe('what a person is told', () => {
  test('the chip only appears when there is something to say', () => {
    assert.equal(approvalChip('awaiting'), 'Waiting for approval');
    assert.equal(approvalChip('approved'), 'Approved');
    assert.equal(approvalChip('rejected'), 'Sent back');
    assert.equal(approvalChip('off'), '');
    assert.equal(approvalChip('not_needed'), '');
  });

  test('the sentence names the limit, in the workspace currency, and never a raw cent figure', () => {
    const waiting = approvalDetail('awaiting', rule);
    assert.match(waiting, /\$1,000\.00/, 'the number is the money amount a person reads');
    assert.match(waiting, /owner or an accountant/);
    assert.doesNotMatch(waiting, /100000/, 'cents are not shown to a person');
    assert.match(approvalDetail('awaiting', rule, undefined, 'EUR'), /€1,000\.00/);
    assert.equal(approvalDetail('off', rule), '');
    assert.equal(approvalDetail('not_needed', rule), '');
  });

  test('an approved invoice says it will not be asked for again', () => {
    const detail = approvalDetail('approved', rule, { state: 'approved', thresholdCents: LIMIT, decidedAt: '2026-10-05T09:00:00.000Z', decidedBy: 'dana' });
    assert.match(detail, /Approved by dana on 2026-10-05/);
    assert.match(detail, /does not take the approval back/);
  });

  test('a sent-back invoice carries the reason', () => {
    const detail = approvalDetail('rejected', rule, { state: 'rejected', thresholdCents: LIMIT, decidedAt: '2026-10-05T09:00:00.000Z', note: 'wrong address' });
    assert.match(detail, /Sent back on 2026-10-05: wrong address/);
    assert.match(detail, /not emailed/, 'it says what happens, not just what it is called');
  });
});

test('#648: a JPY invoice is compared with the limit in the books currency\'s own units (no 100x slip)', () => {
  const settings = { enabled: true, thresholdCents: 50_000 }; // $500.00
  const yen = { amountCents: 100_000, exchangeRate: 0.0067, currency: 'JPY', status: 'pending' }; // ¥100,000 = $670.00
  assert.equal(invoiceTotalInWorkspaceCurrency(yen as never, 'USD'), 67_000);
  assert.equal(needsApproval(yen as never, settings, 'USD'), true, 'over the $500 limit, so it needs approval');
  const small = { ...yen, amountCents: 70_000 }; // ¥70,000 = $469.00
  assert.equal(needsApproval(small as never, settings, 'USD'), false);
});
