import { parseAmountToCents } from './utils';
/**
 * Invoice approval (BE-04): a workspace can say "an invoice over X must be signed off by an owner
 * or an accountant before it goes to the customer". It is a gate on **sending**, not on the books:
 * the invoice is dated, saved and posted as it always was, so the ledger and the reports stay
 * complete — what waits for a signature is the customer receiving it. Nothing here adds money up:
 * the only amount looked at is the invoice total, brought into the workspace's currency with the
 * rate the invoice already carries (`toBaseCents`, the same rule the aging and balances use).
 *
 * The state is stored on the invoice as its own field, `approval`, and never in `status`: for an
 * invoice 'pending' already means "issued, not paid yet" and 'approved' / 'rejected' are payment
 * states, so reusing them would move the amount in and out of accounts receivable.
 *
 * Who stamps what, and when. The hook `src/hooks/useEntityOperations.ts` asks here at the two
 * moments an invoice starts going out — it is created issued, or a draft is moved to issued:
 * - an owner or an accountant approves it on the spot with that very save (their save is the
 *   signature, as everywhere else in the app a person's action is their decision);
 * - anybody else's save leaves it **awaiting**;
 * - ordinary later edits (a due date, a note) change nothing, so an invoice already with the
 *   customer keeps getting its reminders and its place in the accounts;
 * - a draft or a voided invoice is never held (nothing goes out of it anyway), and an invoice under
 *   the limit — or any invoice with the rule off — gets nothing written at all, so records and
 *   behaviour stay exactly as they were;
 * - nothing is reached backwards: an invoice that already went out before the rule existed has no
 *   record and is treated as needing none (`hasAlreadyGoneOut`).
 *
 * The gate sits on both sides: the client refuses before it asks, and the server refuses too, so it
 * is not only a screen. The daily reminder job does not nag about an invoice that never went out —
 * that would be worse than late. Once an invoice is with the customer nothing holds: the payment
 * page, the thank-you mail and the reminders for that document keep working, and editing the
 * invoice afterwards cannot take it back.
 */
import { toBaseCents } from '../server/reports/partyReports';
import { formatCurrency } from './utils';

export interface InvoiceApprovalSettings {
  enabled: boolean;
  /** Invoices above this amount, in the workspace's currency, need a signature. 0 turns the rule off. */
  thresholdCents: number;
  /** A-120: Optional purchase-order approval threshold stored alongside invoiceApproval on the workspace. */
  poEnabled?: boolean;
  poThresholdCents?: number;
}

export interface PoApprovalSettings {
  enabled: boolean;
  thresholdCents: number;
}

/** Clean the A-120 purchase-order approval threshold stored inside workspace.invoiceApproval. */
export function normalizePoApproval(input: unknown): PoApprovalSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<InvoiceApprovalSettings>;
  const cents = Number(raw.poThresholdCents);
  const thresholdCents = Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0;
  return { enabled: Boolean(raw.poEnabled) && thresholdCents > 0, thresholdCents };
}

/** Roles allowed to sign off; the same pair that may close the books (src/lib/periodLock.ts). */
export const APPROVER_ROLES = ['owner', 'accountant'] as const;
export type ApprovalRole = (typeof APPROVER_ROLES)[number];

export type ApprovalState = 'awaiting' | 'approved' | 'rejected';

export interface InvoiceApprovalRecord {
  state: ApprovalState;
  /** the limit in force when this was stamped, so the message can name the number it is about */
  thresholdCents: number;
  requestedAt?: string;
  requestedBy?: string;
  decidedAt?: string;
  decidedBy?: string;
  /** why an owner or an accountant sent it back */
  note?: string;
}

/** The parts of an invoice this rule reads: its total, its rate, whether it has been issued, and
 * whether it has already gone out (a send is recorded in `metadata`). */
export interface ApprovalDoc {
  amountCents?: number;
  exchangeRate?: number;
  status?: string;
  approval?: InvoiceApprovalRecord | null;
  /** `lastSentAt` and `sendCount` are read off it; typed loosely so any document object fits */
  metadata?: object | null;
}

export type ApprovalStatus = 'off' | 'not_needed' | ApprovalState;

/** A draft isn't in the customer's hands and a void is nowhere, so approval is about neither. */
const NOT_SENT = new Set(['draft', 'void', 'cancelled']);

export const MAX_APPROVAL_NOTE = 500;

/** The limit shown in a settings box: cents as the units a person types (0 shows nothing). */
export const approvalLimitUnits = (cents: number): string => (cents > 0 ? String(Math.round(cents) / 100) : '');

/**
 * "1,500" or "2000.50" into cents, the only unit money is stored in. Commas are separators, so a
 * thousands-separated entry reads correctly; European decimal commas are not guessed at, the same
 * rule the exchange-rate editor follows. Blank, nonsense or a negative number all mean 0, which is
 * the rule off: an approval limit is never invented.
 */
export function parseApprovalLimit(text: unknown): number {
  const cleaned = String(text ?? '').replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const units = Number.parseFloat(cleaned);
  // the decimal text is turned into cents exactly (AU-5): 1.005 is 101 cents, never 100
  return Number.isFinite(units) && units > 0 ? parseAmountToCents(String(units)) : 0;
}

/** The stored setting, cleaned. Enabled only with a real limit, so a half-saved rule can't block anyone. */
export function normalizeInvoiceApproval(input: unknown): InvoiceApprovalSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<InvoiceApprovalSettings>;
  const cents = Number(raw.thresholdCents);
  const thresholdCents = Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0;
  const po = normalizePoApproval(raw);
  return {
    enabled: Boolean(raw.enabled) && thresholdCents > 0,
    thresholdCents,
    ...(po.enabled || po.thresholdCents > 0 ? { poEnabled: po.enabled, poThresholdCents: po.thresholdCents } : {}),
  };
}

/** Only these two roles sign off (a bookkeeper's own save cannot approve itself). */
export const isApproverRole = (role: string | null | undefined): boolean =>
  (APPROVER_ROLES as readonly string[]).includes(String(role));

/** The invoice total in the workspace's currency (1 is the rate of an invoice already in it). */
export function invoiceTotalInWorkspaceCurrency(doc: ApprovalDoc): number {
  return toBaseCents(doc.amountCents || 0, doc.exchangeRate);
}

/** The rule applies to this invoice right now: it is issued, the rule is on, and it is over the limit. */
export function needsApproval(doc: ApprovalDoc, settings: unknown): boolean {
  const { enabled, thresholdCents } = normalizeInvoiceApproval(settings);
  if (!enabled || NOT_SENT.has(String(doc.status))) return false;
  return invoiceTotalInWorkspaceCurrency(doc) > thresholdCents;
}

/** Evidence that a customer already has this document: it is marked sent, or a send is recorded. */
export function hasAlreadyGoneOut(doc: ApprovalDoc): boolean {
  const meta = (doc.metadata || {}) as { lastSentAt?: unknown; sendCount?: unknown };
  return String(doc.status) === 'sent' || Boolean(meta.lastSentAt) || (Number(meta.sendCount) || 0) > 0;
}

/**
 * Where this invoice stands: 'off' (no rule in this workspace), 'not_needed' (under the limit or
 * not going out), 'awaiting' (nobody has signed it), 'approved', or 'rejected' (sent back).
 *
 * An invoice that is already with the customer and carries no record is 'not_needed', not 'awaiting'.
 * A workspace switching this rule on today must not reach backwards: every over-limit invoice sent
 * until then would otherwise stop getting its reminders and could not be emailed again, as if
 * somebody had broken the rule. Approval is about a document that has not gone out yet.
 */
export function approvalStatus(doc: ApprovalDoc, settings: unknown): ApprovalStatus {
  if (!normalizeInvoiceApproval(settings).enabled) return 'off';
  if (!needsApproval(doc, settings)) return 'not_needed';
  if (!doc.approval && hasAlreadyGoneOut(doc)) return 'not_needed';
  return doc.approval?.state ?? 'awaiting';
}

/** An invoice a customer could be sent (a draft or a void is not). */
export const isIssuedForApproval = (status: string | null | undefined): boolean => !NOT_SENT.has(String(status));

/** True when the invoice must not reach the customer yet — the gate the email paths ask. */
export function holdsSending(doc: ApprovalDoc, settings: unknown): boolean {
  const status = approvalStatus(doc, settings);
  return status === 'awaiting' || status === 'rejected';
}

export interface ApprovalActor {
  /** the role of the person saving; for an approver the save is the signature */
  role: string | null | undefined;
  uid?: string | null;
  /**
   * ISO time of the save. Left out, the moment of writing is used — the timestamp records when the
   * record was created, and components must not build dates themselves (see no-new-date-in-handlers).
   */
  now?: string;
  /** the two-person rule (P-05, src/lib/twoPersonRule.ts): nobody's own save is their signature */
  twoPerson?: boolean;
}

const stampTime = (now?: string): string => now || new Date().toISOString();

/**
 * The approval to store with an invoice that starts going out (created issued, or a draft moved to
 * issued), or null to write nothing. The caller skips it when the save carries an approval of its
 * own — the Approve and Send back buttons in the invoice list write their own.
 */
export function approvalForSave(doc: ApprovalDoc, settings: unknown, actor: ApprovalActor): InvoiceApprovalRecord | null {
  if (!needsApproval(doc, settings)) return null;
  const { thresholdCents } = normalizeInvoiceApproval(settings);
  if (isApproverRole(actor.role) && !actor.twoPerson) {
    return { state: 'approved', thresholdCents, decidedAt: stampTime(actor.now), ...(actor.uid ? { decidedBy: actor.uid } : {}) };
  }
  const previous = doc.approval;
  return {
    state: 'awaiting',
    thresholdCents,
    requestedAt: stampTime(actor.now),
    ...(actor.uid ? { requestedBy: actor.uid } : {}),
    // a fixed invoice still carries the reason it was sent back, so the author knows what changed
    ...(previous?.state === 'rejected' && previous.note ? { note: previous.note } : {}),
  };
}

/** The decision an approver records from the invoice list (approve, or send back with a note). */
export function approvalDecision(
  settings: unknown,
  decision: 'approved' | 'rejected',
  actor: { uid?: string | null; now?: string; note?: string },
): InvoiceApprovalRecord {
  const { thresholdCents } = normalizeInvoiceApproval(settings);
  const note = String(actor.note || '').trim().slice(0, MAX_APPROVAL_NOTE);
  return {
    state: decision,
    thresholdCents,
    decidedAt: stampTime(actor.now),
    ...(actor.uid ? { decidedBy: actor.uid } : {}),
    ...(decision === 'rejected' && note ? { note } : {}),
  };
}

/** The short words on the chip; '' when there is nothing to say. */
export function approvalChip(status: ApprovalStatus): string {
  switch (status) {
    case 'awaiting': return 'Waiting for approval';
    case 'approved': return 'Approved';
    case 'rejected': return 'Sent back';
    default: return '';
  }
}

/** One plain sentence with the number, the person and the reason behind the chip. */
export function approvalDetail(
  status: ApprovalStatus,
  settings: unknown,
  record?: InvoiceApprovalRecord | null,
  currency?: string,
): string {
  const { thresholdCents } = normalizeInvoiceApproval(settings);
  const limit = formatCurrency(thresholdCents, currency);
  const when = (iso?: string) => (iso ? iso.slice(0, 10) : '');
  const on = record?.decidedAt ? ` on ${when(record.decidedAt)}` : '';
  switch (status) {
    case 'awaiting':
      return record?.note
        ? `Waiting for an owner or an accountant to approve it (the limit is ${limit}). It was sent back once already: ${record.note}`
        : `Waiting for an owner or an accountant to approve it: the invoice is over the ${limit} limit, so it is not emailed yet.`;
    case 'approved':
      return `Approved${record?.decidedBy ? ` by ${record.decidedBy}` : ''}${on}. It goes out as usual, and editing it does not take the approval back — the amount and the state did not change.`;
    case 'rejected':
      return `Sent back${on}${record?.note ? `: ${record.note}` : ''}. It is not emailed and its reminders wait too; saving a fixed invoice asks for approval again.`;
    default:
      return '';
  }
}
