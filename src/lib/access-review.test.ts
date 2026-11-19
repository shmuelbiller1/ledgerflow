import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_REVIEW_HEADERS, accessReviewCalendarIcs, accessReviewCsvRows, accessReviewReminderState,
  accessReviewRows, lastRoleChange, lastSignIn, localDay, twoStepLimitNote, twoStepRuleChangedAt,
  type AccessAuditEntry,
} from './accessReview';

const owner = 'u-owner';
const accountant = 'u-accountant';
const viewer = 'u-viewer';

const logs: AccessAuditEntry[] = [
  { action: 'USER_LOGIN', uid: owner, userEmail: 'owner@example.test', timestamp: '2026-10-01T08:00:00.000Z' },
  { action: 'ROLE_CHANGE', uid: owner, userEmail: 'owner@example.test', timestamp: '2026-10-02T09:00:00.000Z', details: { targetUid: accountant, beforeRole: 'viewer', afterRole: 'accountant' } },
  { action: 'USER_LOGIN', uid: accountant, userEmail: 'acct@example.test', timestamp: '2026-10-03T10:00:00.000Z' },
  { action: 'USER_LOGIN', uid: viewer, userEmail: 'viewer@example.test', timestamp: '2026-09-20T07:30:00.000Z' },
  { action: 'ROLE_CHANGE', uid: owner, userEmail: 'owner@example.test', timestamp: '2026-10-04T09:00:00.000Z', details: { targetUid: accountant, beforeRole: 'accountant', afterRole: 'bookkeeper' } },
  { action: 'USER_LOGIN', uid: accountant, userEmail: 'acct@example.test', timestamp: '2026-10-05T11:00:00.000Z' },
];

test('one row per person, owner first, each once, with the stored role', () => {
  const rows = accessReviewRows({
    ownerUid: owner, members: [accountant, viewer, accountant, ''], roles: { [accountant]: 'bookkeeper', [viewer]: 'accountant', [owner]: 'viewer' },
    requireTwoStep: false, auditLogs: logs, selfUid: owner, selfTwoStep: true, emails: { [viewer]: 'known@example.test' },
  });
  assert.deepEqual(rows.map(row => row.uid), [owner, accountant, viewer]);
  // the creator is the owner whatever the roles map says; an unknown role gets no more than read-only
  assert.deepEqual(rows.map(row => row.role), ['owner', 'bookkeeper', 'accountant']);
  assert.deepEqual(rows.map(row => row.email), ['owner@example.test', 'acct@example.test', 'known@example.test']);
  assert.deepEqual(rows.map(row => row.isSelf), [true, false, false]);
});

test('last sign-in and last role change come from the newest audit entry, never an average', () => {
  assert.equal(lastSignIn(logs, accountant)?.toISOString(), '2026-10-05T11:00:00.000Z');
  assert.equal(lastSignIn(logs, 'nobody'), null);
  const change = lastRoleChange(logs, accountant);
  assert.equal(change?.timestamp, '2026-10-04T09:00:00.000Z');
  const rows = accessReviewRows({ ownerUid: owner, members: [accountant], roles: { [accountant]: 'bookkeeper' }, requireTwoStep: false, auditLogs: logs });
  const row = rows[1];
  assert.equal(row.roleChangedAt?.toISOString(), '2026-10-04T09:00:00.000Z');
  assert.equal(row.roleChangedFrom, 'accountant');
  assert.equal(row.roleChangedTo, 'bookkeeper');
  assert.equal(row.roleChangedBy, 'owner@example.test');
  // the owner created the workspace: no role change is recorded, and the screen says exactly that
  assert.equal(rows[0].roleChangedAt, null);
  assert.equal(accessReviewRows({ ownerUid: owner, members: [], roles: {}, requireTwoStep: false, auditLogs: [] })[0].roleChangedFrom, null);
});

test('two-step login: a workspace rule plus a later sign-in is proof, nothing else is claimed', () => {
  const withRule: AccessAuditEntry[] = [
    ...logs,
    { action: 'TWO_STEP_REQUIREMENT_SET', uid: owner, userEmail: 'owner@example.test', timestamp: '2026-10-04T12:00:00.000Z', details: { description: 'Everyone in the workspace must now use two-step login' } },
  ];
  assert.equal(twoStepRuleChangedAt(withRule)?.toISOString(), '2026-10-04T12:00:00.000Z');
  assert.equal(twoStepRuleChangedAt(logs), null);
  const governed = accessReviewRows({ ownerUid: owner, members: [accountant, viewer], roles: { [accountant]: 'accountant', [viewer]: 'viewer' }, requireTwoStep: true, auditLogs: withRule, selfUid: viewer, selfTwoStep: false });
  // accountant signed in on 5 Oct, after the rule; the owner and the viewer did not
  assert.deepEqual(governed.map(row => row.twoStep), ['required-no-signin', 'required-on', 'required-no-signin']);

  const noRule = accessReviewRows({ ownerUid: owner, members: [accountant], roles: { [accountant]: 'accountant' }, requireTwoStep: false, auditLogs: logs, selfUid: accountant, selfTwoStep: true });
  assert.equal(noRule[0].twoStep, 'not-visible');
  assert.equal(noRule[1].twoStep, 'self-on');

  const off = accessReviewRows({ ownerUid: owner, members: [], roles: {}, requireTwoStep: false, auditLogs: [], selfUid: owner, selfTwoStep: false });
  assert.equal(off[0].twoStep, 'self-off');
  const unreadable = accessReviewRows({ ownerUid: owner, members: [], roles: {}, requireTwoStep: false, auditLogs: [], selfUid: owner, selfTwoStep: null });
  assert.equal(unreadable[0].twoStep, 'self-unknown');
  assert.match(twoStepLimitNote(true), /refuses a password-only session/);
  assert.match(twoStepLimitNote(false), /cannot be read from here/);
});

test('the CSV holds the same rows as the screen, in order, with ISO times', () => {
  const rows = accessReviewRows({ ownerUid: owner, members: [accountant], roles: { [accountant]: 'accountant' }, requireTwoStep: true, auditLogs: logs });
  const csv = accessReviewCsvRows(rows);
  assert.equal(csv.length, rows.length);
  assert.equal(csv[0].length, ACCESS_REVIEW_HEADERS.length);
  assert.equal(csv[0][0], owner);
  assert.equal(csv[0][2], 'Owner');
  assert.equal(csv[1][2], 'Accountant');
  assert.equal(csv[1][3], '2026-10-05T11:00:00.000Z');
  assert.equal(csv[1][4], 'Required by the workspace — no later sign-in shown');
  assert.equal(csv[1][5], '2026-10-04T09:00:00.000Z');
  assert.equal(csv[1][6], 'Accountant → Bookkeeper');
  assert.equal(csv[1][7], 'owner@example.test');
  // nothing recorded is written as a sentence, never as a blank that reads like "never"
  const quiet = accessReviewCsvRows(accessReviewRows({ ownerUid: 'solo', members: [], roles: {}, requireTwoStep: false, auditLogs: [] }));
  assert.deepEqual(quiet[0].slice(3), ['Not in the recent audit entries', 'Only that person can see it', 'No role change recorded', '', '', '']);
});

test('localDay reads the day a person sees, not UTC', () => {
  assert.equal(localDay(new Date(2026, 0, 9, 23, 30)), '2026-01-09');
  assert.equal(localDay(new Date(2026, 11, 31, 0, 1)), '2026-12-31');
});

test('a person with a stored role but no member row still reaches the review', () => {
  const rows = accessReviewRows({
    ownerUid: owner, members: [accountant], roles: { [accountant]: 'accountant', ghost: 'bookkeeper' },
    requireTwoStep: false, auditLogs: logs,
  });
  assert.deepEqual(rows.map(row => row.uid), [owner, accountant, 'ghost']);
  assert.deepEqual(rows.map(row => row.roleOnly), [false, false, true]);
  assert.equal(rows[2].role, 'bookkeeper');
  assert.match(accessReviewCsvRows(rows)[2][8], /Role on record; not in the workspace member list/);
});

test('S-21: monthly access-review reminder flags never, ok, and due states and generates RFC 5545 ICS', () => {
  const now = new Date('2026-11-19T12:00:00.000Z');
  const never = accessReviewReminderState(null, now);
  assert.equal(never.status, 'never');
  assert.equal(never.nextDueDate, localDay(now));

  const recent = accessReviewReminderState('2026-11-10T12:00:00.000Z', now);
  assert.equal(recent.status, 'ok');
  assert.equal(recent.daysSinceReview, 9);

  const overdue = accessReviewReminderState('2026-10-15T12:00:00.000Z', now);
  assert.equal(overdue.status, 'due');
  assert.equal(overdue.daysSinceReview, 35);

  const ics = accessReviewCalendarIcs('Acme, Inc; Books', '2026-12-10');
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /RRULE:FREQ=MONTHLY\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261210\r\n/);
  assert.match(ics, /SUMMARY:Monthly Access Review — Acme\\, Inc\\; Books\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});
