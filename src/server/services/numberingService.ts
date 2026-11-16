import type { DocumentData, Firestore, Transaction } from '../db/firestore';
import { formatTzDate } from '../../lib/calendarDate';
import { workspaceRole } from '../../lib/periodLock';

/**
 * Document numbers (BA-07): one series per type (prefix, next number, digits), allocated in a
 * database transaction (no gaps, no duplicates). Owners and accountants may change a series;
 * the next number must be above every number already used with that prefix.
 */

export type NumberedType = 'invoice' | 'bill' | 'estimate' | 'creditNote' | 'vendorCredit' | 'payment';
export const NUMBERED_TYPES: readonly NumberedType[] = ['invoice', 'bill', 'estimate', 'creditNote', 'vendorCredit', 'payment'];
const COLLECTION: Record<NumberedType, string> = { invoice: 'invoices', bill: 'bills', estimate: 'estimates', creditNote: 'creditNotes', vendorCredit: 'vendorCredits', payment: 'payments' };
const LEGACY: Record<NumberedType, [string, string]> = {
  invoice: ['invoicePrefix', 'invoiceNextNumber'], bill: ['billPrefix', 'billNextNumber'], estimate: ['estimatePrefix', 'estimateNextNumber'],
  creditNote: ['creditNotePrefix', 'creditNoteNextNumber'], vendorCredit: ['vendorCreditPrefix', 'vendorCreditNextNumber'],
  payment: ['paymentPrefix', 'paymentNextNumber'],
};
const PREFIX: Record<NumberedType, string> = { invoice: 'INV', bill: 'BIL', estimate: 'EST', creditNote: 'CN', vendorCredit: 'VC', payment: 'PMT' };

export interface Series { prefix: string; nextNumber: number; padding: number }

export class NumberingError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = 'NumberingError';
  }
}

export const defaultPrefix = (type: NumberedType, today: string) => `${PREFIX[type]}-${today.slice(0, 4)}-`;

export const formatDocumentNumber = (s: Series, n = s.nextNumber) => `${s.prefix}${String(n).padStart(s.padding, '0')}`;

/**
 * The series in effect: the numberingSeries record, else the workspace's numberingSeries field
 * (or its older flat fields), else the default (this year in the prefix, 4 digits, from 1).
 */
export function resolveSeries(type: NumberedType, stored: DocumentData | undefined, workspace: DocumentData | undefined, today: string): Series {
  const fallback = defaultPrefix(type, today);
  if (stored) return { prefix: stored.prefix ?? fallback, nextNumber: stored.nextNumber ?? 1, padding: stored.padding ?? 4 };
  const ns = (workspace?.numberingSeries || {}) as DocumentData;
  if (ns[type] && typeof ns[type] === 'object') return { prefix: ns[type].prefix ?? fallback, nextNumber: ns[type].nextNumber ?? 1, padding: ns[type].padding ?? 4 };
  const [p, n] = LEGACY[type];
  return { prefix: ns[p] || fallback, nextNumber: ns[n] || 1, padding: 4 };
}

/** Next number of a series, in one database transaction. */
export async function allocateNextNumber(db: Firestore, workspaceId: string, type: NumberedType, today: string = formatTzDate(new Date())): Promise<string> {
  return db.runTransaction(tx => allocateInTransaction(db, tx, workspaceId, type, today));
}

/** Next number of a series inside a transaction the caller already runs (a payment takes its number with it). */
export async function allocateInTransaction(db: Firestore, tx: Transaction, workspaceId: string, type: NumberedType, today: string = formatTzDate(new Date())): Promise<string> {
  const nsDocRef = db.collection('numberingSeries').doc(`${workspaceId}_${type}`);
  const nsSnap = await tx.get(nsDocRef);
  const now = new Date().toISOString();
  if (nsSnap.exists) {
    const series = resolveSeries(type, nsSnap.data() || {}, undefined, today);
    tx.update(nsDocRef, { nextNumber: series.nextNumber + 1, updatedAt: now });
    return formatDocumentNumber(series);
  }
  const wsSnap = await tx.get(db.collection('workspaces').doc(workspaceId));
  const series = resolveSeries(type, undefined, wsSnap.exists ? wsSnap.data() || {} : {}, today);
  tx.set(nsDocRef, { workspaceId, type, ...series, nextNumber: series.nextNumber + 1, createdAt: now, updatedAt: now });
  return formatDocumentNumber(series);
}

/** The highest number already used with this prefix (0 when none), from the documents themselves. */
export function highestUsed(numbers: unknown[], prefix: string): number {
  let max = 0;
  for (const value of numbers) {
    if (typeof value !== 'string' || !value.startsWith(prefix)) continue;
    const rest = value.slice(prefix.length);
    if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return max;
}

export async function usedDocumentNumbers(db: Firestore, workspaceId: string, type: NumberedType): Promise<unknown[]> {
  const snap = await db.collection(COLLECTION[type]).where('workspaceId', '==', workspaceId).get();
  return snap.docs.map(d => d.data().number);
}

export interface NumberingView extends Series { type: NumberedType; next: string; highestUsed: number }

export async function readNumbering(db: Firestore, workspaceId: string, today: string = formatTzDate(new Date())): Promise<NumberingView[]> {
  const workspace = (await db.collection('workspaces').doc(workspaceId).get()).data();
  return Promise.all(NUMBERED_TYPES.map(async type => {
    const stored = (await db.collection('numberingSeries').doc(`${workspaceId}_${type}`).get()).data();
    const series = resolveSeries(type, stored, workspace, today);
    return { type, ...series, next: formatDocumentNumber(series), highestUsed: highestUsed(await usedDocumentNumbers(db, workspaceId, type), series.prefix) };
  }));
}

export interface NumberingUpdate extends Series { workspaceId: string; uid: string; email?: string; type: NumberedType }
export interface NumberingUpdateResult {
  before: Series;
  previousHighestUsed: number;
  series: NumberingView;
}

/** Apply a series change inside the command runner's transaction, without writing a second audit entry. */
export async function updateNumberingInTransaction(
  db: Firestore,
  tx: Transaction,
  input: NumberingUpdate,
  today: string = formatTzDate(new Date()),
): Promise<NumberingUpdateResult> {
  const ref = db.collection('numberingSeries').doc(`${input.workspaceId}_${input.type}`);
  const workspace = (await tx.get(db.collection('workspaces').doc(input.workspaceId))).data();
  if (!workspace) throw new NumberingError(404, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
  if (!['owner', 'accountant'].includes(workspaceRole(workspace, input.uid))) {
    throw new NumberingError(403, 'Only owners and accountants change document numbers', 'ROLE_REQUIRED');
  }

  const snap = await tx.get(db.collection(COLLECTION[input.type]).where('workspaceId', '==', input.workspaceId));
  const usedNumbers = snap.docs.map(doc => doc.data().number);
  const highestForNewPrefix = highestUsed(usedNumbers, input.prefix);
  const series: Series = { prefix: input.prefix, nextNumber: input.nextNumber, padding: input.padding };
  if (input.nextNumber <= highestForNewPrefix) {
    throw new NumberingError(
      400,
      `${formatDocumentNumber(series, highestForNewPrefix)} is already used: start at ${highestForNewPrefix + 1} or higher`,
      'NUMBER_ALREADY_USED',
    );
  }

  const before = resolveSeries(input.type, (await tx.get(ref)).data(), workspace, today);
  const now = new Date().toISOString();
  tx.set(ref, { workspaceId: input.workspaceId, type: input.type, ...series, updatedAt: now }, { merge: true });
  return {
    before,
    previousHighestUsed: highestUsed(usedNumbers, before.prefix),
    series: { type: input.type, ...series, next: formatDocumentNumber(series), highestUsed: highestForNewPrefix },
  };
}

export function numberingAuditSummary(input: Pick<NumberingUpdate, 'type' | 'prefix' | 'nextNumber' | 'padding'>, result: NumberingUpdateResult) {
  const after: Series = { prefix: input.prefix, nextNumber: input.nextNumber, padding: input.padding };
  return {
    action: 'NUMBERING_CHANGED',
    entityType: 'numberingSeries',
    entityId: input.type,
    description: `${input.type} numbers: next ${formatDocumentNumber(result.before)} → ${formatDocumentNumber(after)}`,
    details: { before: result.before, after },
  };
}
