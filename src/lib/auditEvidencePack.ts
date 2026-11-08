/**
 * Audit evidence pack (BJ-02 / C-36): for one period, the files an auditor asks for — the audit
 * trail as CSV, the period locks, the approvals, and the access review — assembled from data the
 * browser already holds and downloaded as one ZIP.
 *
 * Read-only by construction: nothing is calculated, nothing is posted and no figure is restated.
 * The only money in the pack is what a document already stores (an invoice's own total, a pay run's
 * own figure) written out as a decimal. What the pack cannot see, it says in its README instead of
 * guessing: the audit trail loads the newest 500 entries of the workspace, and another person's
 * authenticator status is not readable from this app.
 */
import { auditDescription, auditTime } from './auditFormat';
import { csvMoney, toCsv } from './csvExport';
import {
  ACCESS_ROLE_LABELS, ACCESS_REVIEW_HEADERS, accessReviewCsvRows, localDay, twoStepLimitNote, TWO_STEP_LABELS,
  type AccessReviewRow, type AuditDetails,
} from './accessReview';
import { trimChar } from './textShape';

export interface EvidenceEntry {
  action?: string;
  uid?: string;
  userEmail?: string;
  timestamp?: string | number | { toDate(): Date };
  entityType?: string;
  entityId?: string;
  details?: AuditDetails;
}

export interface EvidencePeriod { from: string; to: string }

export interface EvidenceWorkspace {
  id: string;
  name?: string;
  lockDate?: string | null;
  softLockDate?: string | null;
  /** the shared `LockException` model (src/lib/periodLock.ts): fromDate/toDate are the open range */
  lockException?: { fromDate?: string; toDate?: string; reason?: string; by?: string } | null;
  /** the workspace currency, used where a document carries none of its own */
  currency?: string;
  requireTwoStep?: boolean;
  twoPersonRule?: boolean;
  payrollApproval?: boolean;
  invoiceApproval?: { enabled?: boolean; thresholdCents?: number } | null;
}

export interface EvidenceInvoice {
  id: string;
  number?: string;
  date?: string;
  amountCents?: number;
  /** the invoice's own currency; blank means the workspace currency */
  currency?: string;
  status?: string;
  approval?: {
    state?: string; thresholdCents?: number; requestedAt?: string; requestedBy?: string;
    decidedAt?: string; decidedBy?: string; note?: string;
  } | null;
}

export interface EvidencePayRun {
  id: string;
  date?: string;
  totalAmountCents?: number;
  status?: string;
  submittedByEmail?: string;
  approvedByEmail?: string;
  approvedAt?: string;
  rejectedByEmail?: string;
  rejectedAt?: string;
  rejectionNote?: string;
  createdAt?: string;
}

export interface AuditEvidenceInput {
  workspace: EvidenceWorkspace;
  period: EvidencePeriod;
  generatedAt: string;
  auditLogs: readonly EvidenceEntry[];
  invoices: readonly EvidenceInvoice[];
  payRuns: readonly EvidencePayRun[];
  accessRows: readonly AccessReviewRow[];
  /** the audit collection stopped at its cap, so older entries are not in the pack */
  auditCapped?: boolean;
  /**
   * The browser cache stopped at its cap for these collections (10,000 invoices, 1,000 pay runs), so
   * approvals older than the loaded rows are not in the pack. Said in the README and on the screen;
   * never presented as complete history.
   */
  documentsCapped?: { invoices?: boolean; payRuns?: boolean };
}

export interface EvidenceFile {
  name: string;
  /** the header row of a CSV file; empty for the README */
  headers: string[];
  /** the same rows the screen builds, before they become text */
  rows: string[][];
  text: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A valid YYYY-MM-DD, or null. */
export function evidenceDay(value: unknown): string | null {
  return typeof value === 'string' && DAY.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime()) ? value : null;
}

/** Whether a moment falls inside the pack's period, compared as the local day a person reads. */
export function inEvidencePeriod(at: Date | null, period: EvidencePeriod): boolean {
  if (!at) return false;
  const day = localDay(at);
  return day >= period.from && day <= period.to;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function descriptionOf(entry: EvidenceEntry): string {
  return auditDescription(entry);
}

function detailText(entry: EvidenceEntry, key: string): string {
  const details = entry.details;
  if (!details || typeof details !== 'object') return '';
  return text((details as Record<string, unknown>)[key]);
}

function isoOrEmpty(at: Date | null): string {
  return at ? at.toISOString() : '';
}

function csvFile(name: string, headers: readonly string[], rows: readonly string[][]): EvidenceFile {
  return { name, headers: [...headers], rows: rows.map(row => [...row]), text: toCsv([...headers], rows.map(row => [...row])) };
}

/** The audit trail, restricted to entries inside the period, newest first (as the screen lists it). */
export function auditEntriesInPeriod(logs: readonly EvidenceEntry[], period: EvidencePeriod): EvidenceEntry[] {
  return logs
    .filter(entry => inEvidencePeriod(auditTime(entry), period))
    .slice()
    .sort((a, b) => (auditTime(b)?.getTime() || 0) - (auditTime(a)?.getTime() || 0));
}

export const AUDIT_LOG_HEADERS = ['When', 'Action', 'Person', 'Email', 'Entity type', 'Entity id', 'Description'] as const;
export const PERIOD_LOCK_HEADERS = ['When', 'Kind', 'Month or scope', 'Detail', 'Person'] as const;
export const APPROVAL_HEADERS = ['Requested', 'Decided', 'Kind', 'Document', 'Document id', 'Amount', 'Currency', 'Status', 'Prepared by', 'Decided by', 'Note'] as const;
export const APPROVAL_RULE_HEADERS = ['Rule', 'State', 'Limit or scope', 'Note'] as const;

export function auditLogRows(logs: readonly EvidenceEntry[], period: EvidencePeriod): string[][] {
  return auditEntriesInPeriod(logs, period).map(entry => [
    isoOrEmpty(auditTime(entry)),
    text(entry.action),
    text(entry.uid),
    text(entry.userEmail),
    text(entry.entityType),
    text(entry.entityId),
    descriptionOf(entry),
  ]);
}

/** The current lock state plus every close, reopen, unlock and sign-off recorded in the period. */
export function periodLockRows(workspace: EvidenceWorkspace, logs: readonly EvidenceEntry[], period: EvidencePeriod): string[][] {
  const rows: string[][] = [];
  rows.push(['', 'Current lock date', text(workspace.lockDate), workspace.lockDate ? 'Nothing on or before this date changes without an owner or accountant overriding the lock.' : 'No hard lock is set.', '']);
  rows.push(['', 'Current soft close', text(workspace.softLockDate), workspace.softLockDate ? 'Only owners and accountants may post on or before this date.' : 'No soft close is set.', '']);
  const exception = workspace.lockException;
  rows.push([
    '',
    'Open partial unlock',
    // the shared LockException model stores the open range as fromDate/toDate
    exception ? `${text(exception.fromDate)} to ${text(exception.toDate)}` : '',
    exception ? (exception.reason || 'A range inside the locked period may be changed.') : 'None.',
    exception ? text(exception.by) : '',
  ]);
  const events = auditEntriesInPeriod(logs.filter(entry => /^PERIOD_|^FISCAL_YEAR_CLOSE$/.test(text(entry.action))), period);
  for (const entry of events) {
    rows.push([isoOrEmpty(auditTime(entry)), 'Period event', detailText(entry, 'month') || text(entry.entityId), descriptionOf(entry) || text(entry.action), text(entry.userEmail) || text(entry.uid)]);
  }
  return rows;
}

function moment(value: string | undefined): Date | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Invoice approvals and pay-run approvals whose request **or** decision falls inside the period.
 * Both timestamps are tested: a request made in the period and decided after it must not disappear
 * from the earlier period's evidence, and the row shows each date so the gap is visible. Each amount
 * is the document's own figure in the currency named on that row (never silently converted).
 */
export function approvalRows(
  invoices: readonly EvidenceInvoice[],
  payRuns: readonly EvidencePayRun[],
  period: EvidencePeriod,
  workspaceCurrency = '',
): string[][] {
  const rows: string[][] = [];
  for (const invoice of invoices) {
    const approval = invoice.approval;
    if (!approval || !approval.state) continue;
    const requestedAt = moment(approval.requestedAt);
    const decidedAt = moment(approval.decidedAt);
    if (!inEvidencePeriod(requestedAt, period) && !inEvidencePeriod(decidedAt, period)) continue;
    rows.push([
      isoOrEmpty(requestedAt), isoOrEmpty(decidedAt), 'Invoice approval',
      text(invoice.number) || text(invoice.id), text(invoice.id),
      csvMoney(invoice.amountCents), text(invoice.currency) || text(workspaceCurrency), text(approval.state),
      text(approval.requestedBy), text(approval.decidedBy), text(approval.note),
    ]);
  }
  for (const run of payRuns) {
    const requestedAt = moment(run.createdAt);
    const decidedAt = moment(run.approvedAt) || moment(run.rejectedAt);
    if (!inEvidencePeriod(requestedAt, period) && !inEvidencePeriod(decidedAt, period)) continue;
    rows.push([
      isoOrEmpty(requestedAt), isoOrEmpty(decidedAt), 'Pay run approval', `Pay run of ${text(run.date)}`, text(run.id),
      csvMoney(run.totalAmountCents), text(workspaceCurrency), text(run.status),
      text(run.submittedByEmail), text(run.approvedByEmail) || text(run.rejectedByEmail), text(run.rejectionNote),
    ]);
  }
  return rows.sort((a, b) => (a[1] || a[0]).localeCompare(b[1] || b[0]));
}

/** The approval rules as they stand, so a reader knows what the approvals above are being checked against. */
export function approvalRuleRows(workspace: EvidenceWorkspace): string[][] {
  const rule = workspace.invoiceApproval;
  const limit = rule && rule.enabled && Number(rule.thresholdCents) > 0 ? csvMoney(rule.thresholdCents) : '';
  return [
    ['Invoice approval', rule?.enabled ? 'On' : 'Off', limit, rule?.enabled ? 'An invoice above the limit waits for an owner or an accountant before it goes to the customer.' : 'No invoice waits for a signature.'],
    ['Two-person rule', workspace.twoPersonRule ? 'On' : 'Off', '', workspace.twoPersonRule ? 'Nobody approves what they prepared themselves.' : 'A person may approve their own document.'],
    ['Pay run approval', workspace.payrollApproval ? 'On' : 'Off', '', workspace.payrollApproval ? 'A pay run prepared by someone else waits for an owner (or an accountant) to approve it.' : 'Pay runs are posted without a second signature.'],
  ];
}

export function accessReviewFileRows(rows: readonly AccessReviewRow[]): string[][] {
  return accessReviewCsvRows(rows);
}

function readme(input: AuditEvidenceInput, counts: Record<string, number>): string {
  const lines = [
    `Audit evidence pack — ${input.workspace.name || input.workspace.id}`,
    '',
    `Workspace: ${input.workspace.name || '(no name)'} (${input.workspace.id})`,
    `Period: ${input.period.from} to ${input.period.to}`,
    `Generated: ${input.generatedAt}`,
    'Generated by LedgerFlow from the records this workspace already holds. Nothing was recalculated, posted or changed.',
    '',
    'Files in this pack',
    `- audit-log.csv — ${counts.auditLog} audit entries dated inside the period, newest first.`,
    `- period-locks.csv — the lock dates now in force and every close, reopen, unlock and sign-off recorded in the period (${counts.locks} recorded events).`,
    `- approvals.csv — invoice approvals and pay-run approvals decided or asked for inside the period (${counts.approvals} rows).`,
    '- approval-rules.csv — the invoice approval limit, the two-person rule and pay-run approval as they stand today.',
    '- Amounts are each document\'s own figure in the currency named on its row; nothing is converted here.',
    `- access-review.csv — one row per person with access: role, last recorded sign-in, two-step login and last role change (${counts.access} people).`,
    '',
    'Limits you should know',
    `- The audit trail in the app loads the newest 500 entries of the workspace, the same list the Audit Trail screen shows.${input.auditCapped ? ' This workspace has more entries than that, so older entries are not in this pack.' : ''}`,
    ...(input.documentsCapped?.invoices || input.documentsCapped?.payRuns
      ? [`- The browser also caps what it loads: ${[input.documentsCapped?.invoices ? 'invoices (10,000)' : '', input.documentsCapped?.payRuns ? 'pay runs (1,000)' : ''].filter(Boolean).join(' and ')} reached that limit in this workspace, so an approval older than the loaded rows may be missing from approvals.csv. This is stated, never presented as a complete history.`]
      : []),
    '- "Not in the recent audit entries" in access-review.csv means exactly that: no entry among those loaded, not "never signed in".',
    '- A sign-in is the app recording that someone entered this workspace in a browser session; every authentication event of an account lives with the sign-in service, not here.',
    `- ${twoStepLimitNote(Boolean(input.workspace.requireTwoStep))}`,
    '- This pack is evidence, not an audit opinion: a person still has to read it against the documents it points to.',
    '',
  ];
  return lines.join('\n');
}

/** Every file of the pack, in the order they are zipped. */
export function buildAuditEvidencePack(input: AuditEvidenceInput): EvidenceFile[] {
  const auditRows = auditLogRows(input.auditLogs, input.period);
  const lockRows = periodLockRows(input.workspace, input.auditLogs, input.period);
  const approvals = approvalRows(input.invoices, input.payRuns, input.period, input.workspace.currency);
  const rules = approvalRuleRows(input.workspace);
  const access = accessReviewFileRows(input.accessRows);
  const audit = csvFile('audit-log.csv', AUDIT_LOG_HEADERS, auditRows);
  const locks = csvFile('period-locks.csv', PERIOD_LOCK_HEADERS, lockRows);
  const approvalFile = csvFile('approvals.csv', APPROVAL_HEADERS, approvals);
  const rulesFile = csvFile('approval-rules.csv', APPROVAL_RULE_HEADERS, rules);
  const accessFile = csvFile('access-review.csv', ACCESS_REVIEW_HEADERS, access);
  const readmeFile: EvidenceFile = {
    name: 'README.txt', headers: [], rows: [],
    text: readme(input, { auditLog: auditRows.length, locks: lockRows.length - 3, approvals: approvals.length, access: access.length }),
  };
  return [readmeFile, audit, locks, approvalFile, rulesFile, accessFile];
}

/** `ledgerflow-audit-evidence-2026-10-01-to-2026-10-31.zip`, with anything unsafe in the name removed. */
export function evidencePackFileName(workspace: Pick<EvidenceWorkspace, 'name' | 'id'>, period: EvidencePeriod): string {
  const clean = (value: string | undefined) => trimChar((value || '')
    .normalize('NFKD').replace(/[^\p{L}\p{N}_-]+/gu, '-'), '-').slice(0, 60);
  const base = clean(workspace.name) || clean(workspace.id) || 'workspace';
  return `${base}-audit-evidence-${period.from}-to-${period.to}.zip`;
}

/** The role labels are exported for the screen's legend; kept here so both copies read the same table. */
export const accessRoleLabels = ACCESS_ROLE_LABELS;
export const twoStepLabels = TWO_STEP_LABELS;
