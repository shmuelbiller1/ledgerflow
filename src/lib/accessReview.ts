/**
 * Access review (BJ-03 / C-35): one row per person in the workspace — what they may do, when they
 * last entered, what two-step login covers, and when their role last changed. Read-only: it reads
 * the audit trail the browser already has and never changes a role, a person or a table.
 *
 * Two limits, said on the screen as well as here:
 * - The audit trail in this app loads the newest 500 entries of the workspace
 *   (`LEDGER_COLLECTIONS.auditLogs`). "No sign-in found" therefore means "not in the entries shown",
 *   never "never signed in".
 * - Whether another person has an authenticator app is data of the sign-in service; this app can
 *   only read the signed-in person's own. When the workspace requires two-step login for everyone,
 *   a sign-in recorded after that rule was turned on proves the person passed it — that inference is
 *   the only cross-person evidence the browser holds, and it is named as an inference, never a
 *   reading of their account.
 */
import { auditTime } from './auditFormat';
import { BRAND } from '../config/brand';

export type AccessRole = 'owner' | 'accountant' | 'bookkeeper' | 'viewer';

export const ACCESS_ROLE_LABELS: Record<AccessRole, string> = {
  owner: 'Owner',
  accountant: 'Accountant',
  bookkeeper: 'Bookkeeper',
  viewer: 'Viewer',
};

/** Anything stored in the roles map that is not one of the four roles gets no more than read-only. */
export function accessRole(value: unknown): AccessRole {
  return value === 'owner' || value === 'accountant' || value === 'bookkeeper' || value === 'viewer' ? value : 'viewer';
}

/** The details of an audit entry: a description, or the fields a server or client entry carries. */
export type AuditDetails = string | { description?: unknown; [key: string]: unknown } | null | undefined;

/** The parts of an audit entry this reads; the same shape the Audit Trail screen shows. */
export interface AccessAuditEntry {
  action?: string;
  uid?: string;
  userEmail?: string;
  timestamp?: string | number | { toDate(): Date };
  details?: AuditDetails;
}

function detail(entry: AccessAuditEntry, key: string): string | null {
  const details = entry.details;
  if (!details || typeof details !== 'object') return null;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : null;
}

export type TwoStepState =
  /** the workspace requires two-step login and this person signed in after the rule took effect */
  | 'required-on'
  /** the workspace requires it, but no later sign-in of this person is in the entries shown */
  | 'required-no-signin'
  /** this is the reader and their own account has a verified authenticator */
  | 'self-on'
  /** this is the reader and their own account has none */
  | 'self-off'
  /** this is the reader but their own status could not be read */
  | 'self-unknown'
  /** no workspace rule, and another person's authenticator status is not readable from this app */
  | 'not-visible';

export const TWO_STEP_LABELS: Record<TwoStepState, string> = {
  'required-on': 'On — signed in since the workspace required it',
  'required-no-signin': 'Required by the workspace — no later sign-in shown',
  'self-on': 'On (your account)',
  'self-off': 'Off (your account)',
  'self-unknown': 'Could not read your account',
  'not-visible': 'Only that person can see it',
};

export interface AccessReviewInput {
  /** the workspace creator: always an owner, whether or not the roles map names them */
  ownerUid: string;
  members: readonly string[];
  roles: Readonly<Record<string, string>>;
  /** `workspace.requireTwoStep`: everyone in the workspace must use two-step login */
  requireTwoStep: boolean;
  auditLogs: readonly AccessAuditEntry[];
  /** the reader, so their own two-step status can be read from their own account */
  selfUid?: string;
  /** the reader's own verified authenticator: true/false, or null when it could not be read */
  selfTwoStep?: boolean | null;
  /** email per uid where the app can see one (the audit trail and presence records) */
  emails?: Readonly<Record<string, string>>;
}

export interface AccessReviewRow {
  uid: string;
  email: string;
  role: AccessRole;
  isSelf: boolean;
  /** newest recorded entry into a session of this workspace, from the audit trail */
  lastSignInAt: Date | null;
  roleChangedAt: Date | null;
  roleChangedFrom: AccessRole | null;
  roleChangedTo: AccessRole | null;
  roleChangedBy: string | null;
  /**
   * True when this uid holds a role but is not in the workspace's member list. That person still has
   * access — the database's membership check accepts a stored role, and a role can be written
   * without adding a member — so the review lists them instead of hiding them.
   */
  roleOnly: boolean;
  twoStep: TwoStepState;
}

/**
 * Everyone with access: the owner, then the member list in order, then anyone the roles map names
 * who is not in that list (role-only access), each once.
 */
export function accessPeople(input: Pick<AccessReviewInput, 'ownerUid' | 'members' | 'roles'>): string[] {
  const seen = new Set<string>();
  const people: string[] = [];
  const add = (value: unknown) => {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    people.push(id);
  };
  add(input.ownerUid);
  for (const uid of input.members) add(uid);
  for (const uid of Object.keys(input.roles)) add(uid);
  return people;
}

function newest(entries: readonly AccessAuditEntry[]): AccessAuditEntry | null {
  let best: AccessAuditEntry | null = null;
  let bestAt = -Infinity;
  for (const entry of entries) {
    const at = auditTime(entry);
    if (!at) continue;
    if (at.getTime() > bestAt) { best = entry; bestAt = at.getTime(); }
  }
  return best;
}

/** The email this person's own entries carry, newest first; empty when the loaded entries name none. */
export function personEmail(logs: readonly AccessAuditEntry[], uid: string): string {
  const own = newest(logs.filter(log => log.uid === uid && Boolean(log.userEmail)));
  return own?.userEmail || '';
}

/** The newest recorded sign-in of this person, or null when the loaded entries hold none. */
export function lastSignIn(logs: readonly AccessAuditEntry[], uid: string): Date | null {
  const entry = newest(logs.filter(log => log.action === 'USER_LOGIN' && log.uid === uid));
  return entry ? auditTime(entry) : null;
}

/** The newest role change of this person, from the audit entry the server writes (ROLE_CHANGE). */
export function lastRoleChange(logs: readonly AccessAuditEntry[], uid: string): AccessAuditEntry | null {
  return newest(logs.filter(log => log.action === 'ROLE_CHANGE' && detail(log as AccessAuditEntry, 'targetUid') === uid));
}

/** When two-step login for everyone was last turned on or off, as far as the loaded entries show. */
export function twoStepRuleChangedAt(logs: readonly AccessAuditEntry[]): Date | null {
  const entry = newest(logs.filter(log => log.action === 'TWO_STEP_REQUIREMENT_SET'));
  return entry ? auditTime(entry) : null;
}

function twoStepFor(input: AccessReviewInput, uid: string, signInAt: Date | null, ruleChangedAt: Date | null): TwoStepState {
  const isSelf = Boolean(input.selfUid) && input.selfUid === uid;
  if (input.requireTwoStep) {
    // The server and the database refuse a password-only session of every member once the rule is on,
    // so a sign-in recorded after it was turned on is proof the person passed two-step login.
    return ruleChangedAt && signInAt && signInAt.getTime() >= ruleChangedAt.getTime() ? 'required-on' : 'required-no-signin';
  }
  if (!isSelf) return 'not-visible';
  if (input.selfTwoStep === true) return 'self-on';
  if (input.selfTwoStep === false) return 'self-off';
  return 'self-unknown';
}

/** One row per person, owner first, in the order the workspace lists them. */
export function accessReviewRows(input: AccessReviewInput): AccessReviewRow[] {
  const ruleChangedAt = twoStepRuleChangedAt(input.auditLogs);
  return accessPeople(input).map(uid => {
    const isOwner = uid === input.ownerUid;
    const change = lastRoleChange(input.auditLogs, uid);
    const signInAt = lastSignIn(input.auditLogs, uid);
    const changeAt = change ? auditTime(change) : null;
    return {
      uid,
      email: input.emails?.[uid] || personEmail(input.auditLogs, uid),
      role: isOwner ? 'owner' : accessRole(input.roles[uid]),
      isSelf: Boolean(input.selfUid) && input.selfUid === uid,
      lastSignInAt: signInAt,
      roleChangedAt: changeAt,
      roleChangedFrom: change ? accessRole(detail(change, 'beforeRole')) : null,
      roleChangedTo: change ? accessRole(detail(change, 'afterRole')) : null,
      roleChangedBy: change ? (change.userEmail || change.uid || null) : null,
      roleOnly: uid !== input.ownerUid && !input.members.includes(uid),
      twoStep: twoStepFor(input, uid, signInAt, ruleChangedAt),
    };
  });
}

/** The ISO day of a moment, in this browser's time zone (the same day an auditor reads on screen). */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const ACCESS_REVIEW_HEADERS = ['Person', 'Email', 'Role', 'Last sign-in', 'Two-step login', 'Role last changed', 'Role change', 'Changed by', 'Note'] as const;

/** CSV rows in the same order, and from the same rows, as the screen shows. Times are ISO for an auditor. */
export function accessReviewCsvRows(rows: readonly AccessReviewRow[]): string[][] {
  return rows.map(row => [
    row.uid,
    row.email,
    ACCESS_ROLE_LABELS[row.role],
    row.lastSignInAt ? row.lastSignInAt.toISOString() : 'Not in the recent audit entries',
    TWO_STEP_LABELS[row.twoStep],
    row.roleChangedAt ? row.roleChangedAt.toISOString() : 'No role change recorded',
    row.roleChangedFrom && row.roleChangedTo ? `${ACCESS_ROLE_LABELS[row.roleChangedFrom]} → ${ACCESS_ROLE_LABELS[row.roleChangedTo]}` : '',
    row.roleChangedBy || '',
    row.roleOnly ? 'Role on record; not in the workspace member list' : '',
  ]);
}

/**
 * The window event the authenticator panel sends after an authenticator is added or removed, so an
 * open access review (and its CSV) never reports the reader's previous account status.
 */
export const TWO_STEP_CHANGED = 'ledgerflow:two-step-changed';

/** The one sentence the screen and the CSV share about what the two-step column can and cannot say. */
export function twoStepLimitNote(requireTwoStep: boolean): string {
  return requireTwoStep
    ? 'This workspace requires two-step login for everyone, so the server refuses a password-only session. A sign-in recorded after the rule was turned on is shown as proof; no later sign-in shown does not prove the person lacks an authenticator.'
    : 'No workspace rule requires two-step login. Another person’s authenticator status belongs to their own account and cannot be read from here; only your own is shown.';
}

/** S-21: monthly (30-day) access-review cadence tracking and RFC 5545 calendar reminder export. */
export const ACCESS_REVIEW_CADENCE_DAYS = 30;
const ACCESS_REVIEW_STORAGE_PREFIX = 'lf_access_review:';

export interface AccessReviewReminderState {
  status: 'never' | 'due' | 'ok';
  lastReviewedAt: string | null;
  daysSinceReview: number | null;
  nextDueDate: string;
  summary: string;
}

export function accessReviewReminderState(
  lastReviewedAt: string | Date | null | undefined,
  now: Date = new Date(),
  intervalDays: number = ACCESS_REVIEW_CADENCE_DAYS,
): AccessReviewReminderState {
  const cadence = Number.isFinite(intervalDays) && intervalDays > 0 ? Math.floor(intervalDays) : ACCESS_REVIEW_CADENCE_DAYS;
  const parsed = lastReviewedAt instanceof Date
    ? lastReviewedAt
    : typeof lastReviewedAt === 'string' && lastReviewedAt.trim()
      ? new Date(lastReviewedAt)
      : null;
  const validLast = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;

  if (!validLast) {
    return {
      status: 'never',
      lastReviewedAt: null,
      daysSinceReview: null,
      nextDueDate: localDay(now),
      summary: 'No monthly access review has been recorded on this device yet. Review the list below and mark it complete.',
    };
  }

  const diffDays = Math.max(0, Math.floor((now.getTime() - validLast.getTime()) / 86_400_000));
  const nextDue = new Date(validLast.getTime() + cadence * 86_400_000);
  const nextDueDate = localDay(nextDue);
  const isoLast = validLast.toISOString();

  if (diffDays >= cadence) {
    return {
      status: 'due',
      lastReviewedAt: isoLast,
      daysSinceReview: diffDays,
      nextDueDate: localDay(now),
      summary: `Monthly access review is due (last reviewed ${diffDays} days ago on ${localDay(validLast)}).`,
    };
  }

  const daysRemaining = cadence - diffDays;
  return {
    status: 'ok',
    lastReviewedAt: isoLast,
    daysSinceReview: diffDays,
    nextDueDate,
    summary: `Last reviewed on ${localDay(validLast)} (${diffDays}d ago). Next monthly review due on ${nextDueDate} (in ${daysRemaining}d).`,
  };
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

export function accessReviewCalendarIcs(workspaceName: string, nextDueDate: string): string {
  const compactDate = /^\d{4}-\d{2}-\d{2}$/.test(nextDueDate)
    ? nextDueDate.replace(/-/g, '')
    : localDay(new Date()).replace(/-/g, '');
  const label = escapeIcsText((workspaceName || BRAND.name).trim() || BRAND.name);
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${BRAND.name}//Access Review Reminder//EN`,
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:ledgerflow-access-review-${compactDate}@ledgerflow.app`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;VALUE=DATE:${compactDate}`,
    'RRULE:FREQ=MONTHLY',
    `SUMMARY:Monthly Access Review — ${label}`,
    `DESCRIPTION:${escapeIcsText(`Review workspace members, roles, last sign-in activity, and two-step login status in Settings -> Security -> Access review for ${workspaceName || 'this workspace'}.`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ];
  return lines.join('\r\n');
}

export function readLastAccessReviewAt(workspaceId: string): string | null {
  if (!workspaceId || typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(`${ACCESS_REVIEW_STORAGE_PREFIX}${workspaceId}`);
  } catch {
    return null;
  }
}

export function recordAccessReviewCompleted(workspaceId: string, now: Date = new Date()): string {
  const iso = now.toISOString();
  if (workspaceId && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(`${ACCESS_REVIEW_STORAGE_PREFIX}${workspaceId}`, iso);
    } catch {
      // Ignore private-mode storage errors while still returning the timestamp for state updates.
    }
  }
  return iso;
}
