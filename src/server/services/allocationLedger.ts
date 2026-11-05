/**
 * EG-2: the payment ledger (docs/design/EG-2-payment-ledger.md). One immutable row per settlement of an
 * invoice or bill in `paymentAllocations` (supabase/migrations/20261025010000_payment_allocations.sql), written
 * only here, in the same database transaction as the document update. Step 1: payments and later applications
 * of a payment's unapplied part. Step 2: credit notes / vendor credits applied, bad-debt write-offs, and the
 * reversal of a write-off (a `reversal` row with negated figures; nothing is deleted). `amountPaidCents` keeps
 * its additive update until the cutover after step 3.
 */
import { minorUnitRate } from '../../lib/currencyMinorUnits';
import { allocateCents } from '../../kernel/templates/TransactionTemplates';
import type { Firestore } from '../db/firestore';

export type AllocationKind = 'payment' | 'advance_application' | 'credit' | 'write_off' | 'deposit' | 'manual' | 'reversal';
export type AllocationSide = 'receivable' | 'payable';
export type DateSource = 'recorded' | 'payment-date' | 'application-entry' | 'write-off-date' | 'inferred';

export interface NewAllocation {
  workspaceId: string;
  side: AllocationSide;
  partyId: string | null;
  documentType: 'invoice' | 'bill';
  documentId: string;
  kind: AllocationKind;
  sourceType: 'payment' | 'creditNote' | 'vendorCredit' | 'writeOff' | 'document';
  sourceId: string;
  /** stable id of the settling operation (the payment id, or the client's idempotency key) */
  operationId: string;
  date: string;
  amountCents: number;
  currency: string;
  documentRate: number;
  settlementRate: number;
  baseClearedCents: number;
  baseSettledCents: number;
  realizedFxCents: number;
  transactionId: string | null;
  fxLineIndex: number | null;
  createdBy: string;
}

export interface SettlementAllocation {
  allocationId: string;
  documentId: string; documentType: 'invoice' | 'bill';
  kind: AllocationKind;
  date: string;
  amountCents: number;
  currency: string;
  documentRate: number;
  settlementRate: number;
  baseClearedCents: number; baseSettledCents: number; realizedFxCents: number;
  transactionId: string | null;
  reversed: boolean;
  dateSource: DateSource;
}

export const ALLOCATIONS = 'paymentAllocations';
export const ALLOCATION_OPERATIONS = 'allocationOperations';

export class AllocationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'AllocationError';
  }
}

/** `{sourceKind}-{operationId}-{sourceId}-{documentId}`: a retry of one operation lands on the same id. */
export function allocationId(kind: AllocationKind, operationId: string, sourceId: string, documentId: string): string {
  return `${kind}-${operationId}-${sourceId}-${documentId}`;
}

/** Side-normalized realized FX, gain > 0 (a bill booked at 1.10 and paid at 1.12 is a loss). */
export function realizedFxFor(side: AllocationSide, baseClearedCents: number, baseSettledCents: number): number {
  return side === 'receivable' ? baseSettledCents - baseClearedCents : baseClearedCents - baseSettledCents;
}

let readyAt = 0;
let ready = false;
let readyInFlight: Promise<boolean> | null = null;
let warnedMissing = false;

function recordAllocationLedgerReady(exists: boolean): boolean {
  ready = exists;
  readyAt = Date.now();
  if (!exists && !warnedMissing) {
    warnedMissing = true;
    console.warn('[allocations] the paymentAllocations table is missing: apply supabase/migrations/20261025010000_payment_allocations.sql. No payment ledger rows are written until then.');
  }
  return exists;
}

/**
 * Whether the allocation-ledger tables exist (cached; looked for again after a minute when missing).
 * Pass the active `Transaction` when called inside `db.runTransaction` so cold-start probes reuse
 * the checked-out transaction client instead of acquiring a second connection from `db.pool`.
 */
export async function allocationLedgerReady(db: Firestore, t?: unknown): Promise<boolean> {
  const pool = (db as unknown as { pool?: { query: (q: string) => Promise<{ rows: Array<{ ok: boolean }> }> } }).pool;
  if (!pool) return false;
  if (ready || Date.now() - readyAt < 60_000) return ready;
  const txTablesExist = (t as { tablesExist?: (...names: string[]) => Promise<boolean> } | undefined)?.tablesExist;
  if (typeof txTablesExist === 'function') {
    const exists = await txTablesExist.call(t, 'paymentAllocations', 'allocationOperations');
    return recordAllocationLedgerReady(exists);
  }
  if (readyInFlight) return readyInFlight;
  const probe: Promise<boolean> = (async () => {
    try {
      const result = await pool.query(`select to_regclass('public."paymentAllocations"') is not null and to_regclass('public."allocationOperations"') is not null as ok`);
      return recordAllocationLedgerReady(Boolean(result.rows[0]?.ok));
    } catch {
      return recordAllocationLedgerReady(false);
    }
  })().finally(() => {
    if (readyInFlight === probe) readyInFlight = null;
  });
  readyInFlight = probe;
  return probe;
}

/** @internal Resets cached allocation-ledger readiness state between unit tests. */
export function resetAllocationLedgerReadyForTests(): void {
  readyAt = 0;
  ready = false;
  readyInFlight = null;
  warnedMissing = false;
}

export interface SplitInput {
  allocations: Array<{ documentId: string; documentType: 'invoice' | 'bill'; amountCents: number }>;
  side: AllocationSide;
  currency: string;
  baseCurrency: string;
  documentRate: number;
  settlementRate: number;
  /** the applied part of the gross settled amount in base (cash + withholding − the unapplied part) */
  settledBaseCents: number;
}

/**
 * Per-document base figures: cleared at the document rate and settled at the settlement rate, each split by
 * largest remainder so the rows add up to the totals exactly; FX is their side-normalized difference.
 */
export function splitAllocations(input: SplitInput): Array<{ baseClearedCents: number; baseSettledCents: number; realizedFxCents: number }> {
  const amounts = input.allocations.map(a => a.amountCents);
  const total = amounts.reduce((s, a) => s + a, 0);
  const clearedTotal = Math.round(total * minorUnitRate(input.documentRate, input.currency, input.baseCurrency));
  const cleared = allocateCents(clearedTotal, amounts);
  const settled = allocateCents(input.settledBaseCents, amounts);
  return amounts.map((_, i) => ({
    baseClearedCents: cleared[i],
    baseSettledCents: settled[i],
    realizedFxCents: realizedFxFor(input.side, cleared[i], settled[i]),
  }));
}

/** Refuses an application dated before what settles or what is settled. */
export function assertApplicationDate(date: string, sourceDate: string | undefined, documentDate: string | undefined, label: string): void {
  const d = String(date).slice(0, 10);
  if (sourceDate && d < String(sourceDate).slice(0, 10)) throw new AllocationError(409, `The application date ${d} is before the payment's date ${String(sourceDate).slice(0, 10)}`);
  if (documentDate && d < String(documentDate).slice(0, 10)) throw new AllocationError(409, `The application date ${d} is before ${label}'s date ${String(documentDate).slice(0, 10)}`);
}

/** Stages the insert of one row (a create: an existing id fails the transaction). Asserts amount ≤ due. */
export function recordAllocation(db: Firestore, tx: { create: (ref: never, data: Record<string, unknown>) => unknown }, row: NewAllocation, opts: { dueCents?: number } = {}): string {
  if (!Number.isInteger(row.amountCents) || row.amountCents <= 0) throw new AllocationError(400, 'An allocation is a positive whole amount');
  if (opts.dueCents !== undefined && row.amountCents > opts.dueCents) throw new AllocationError(409, `Allocation of ${row.amountCents} exceeds what is due (${opts.dueCents}) on ${row.documentId}`);
  const id = allocationId(row.kind, row.operationId, row.sourceId, row.documentId);
  tx.create(db.collection(ALLOCATIONS).doc(id) as never, {
    ...row, id, reversesAllocationId: null, reversedBy: null, dateSource: 'recorded', backfillRunId: null,
    createdAt: new Date().toISOString(),
  });
  return id;
}

/** Base figures of one settlement, rounded as posting rounds (BM-04: the document's minor units → the books'). */
export function baseFigures(side: AllocationSide, amountCents: number, currency: string, baseCurrency: string, documentRate: number, settlementRate: number) {
  const baseClearedCents = Math.round(amountCents * minorUnitRate(documentRate, currency, baseCurrency));
  const baseSettledCents = Math.round(amountCents * minorUnitRate(settlementRate, currency, baseCurrency));
  return { baseClearedCents, baseSettledCents, realizedFxCents: realizedFxFor(side, baseClearedCents, baseSettledCents) };
}

export interface StoredAllocation { id: string; data: Record<string, unknown> }

/** A document's live (not reversed, not a reversal) rows as stored, for a reversal; read before any write. */
export async function liveStoredRowsOf(db: Firestore, tx: Reader, workspaceId: string, documentId: string): Promise<StoredAllocation[]> {
  const query = db.collection(ALLOCATIONS).where('workspaceId', '==', workspaceId).where('documentId', '==', documentId);
  const snap = tx ? await tx.get(query as never) : await query.get();
  return snap.docs.map(d => ({ id: d.id, data: d.data() })).filter(r => r.data.kind !== 'reversal' && !r.data.reversedBy);
}

/** Every live row a source (a payment, a credit) settled, across its documents, for its void; read before any write. */
export async function liveStoredRowsOfSource(db: Firestore, tx: Reader, workspaceId: string, sourceType: NewAllocation['sourceType'], sourceId: string): Promise<StoredAllocation[]> {
  const query = db.collection(ALLOCATIONS).where('workspaceId', '==', workspaceId).where('sourceId', '==', sourceId);
  const snap = tx ? await tx.get(query as never) : await query.get();
  return snap.docs.map(d => ({ id: d.id, data: d.data() }))
    .filter(r => r.data.sourceType === sourceType && r.data.kind !== 'reversal' && !r.data.reversedBy)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Stages the reversal of one row: a new `reversal-{id}` row with the amount and every base figure negated,
 * dated max(date, the row's date), and `reversedBy` on the original (the only field ever set later).
 * A second reversal of the same row fails the transaction (the id exists).
 */
export function reverseAllocation(
  db: Firestore,
  tx: { create: (ref: never, data: Record<string, unknown>) => unknown; update: (ref: never, data: Record<string, unknown>) => unknown },
  original: StoredAllocation,
  date: string,
  opts: { createdBy: string; transactionId: string | null; reason?: string },
): string {
  const o = original.data;
  if (o.kind === 'reversal' || o.reversedBy) throw new AllocationError(409, `Allocation ${original.id} is already reversed`);
  const id = `reversal-${original.id}`;
  const rowDate = String(o.date || '').slice(0, 10);
  const d = String(date).slice(0, 10);
  const neg = (k: string) => -(Number(o[k]) || 0);
  tx.create(db.collection(ALLOCATIONS).doc(id) as never, {
    workspaceId: o.workspaceId, side: o.side, partyId: o.partyId ?? null, documentType: o.documentType, documentId: o.documentId,
    kind: 'reversal', sourceType: o.sourceType, sourceId: o.sourceId, operationId: o.operationId,
    date: d > rowDate ? d : rowDate, amountCents: neg('amountCents'), currency: o.currency,
    documentRate: o.documentRate, settlementRate: o.settlementRate,
    baseClearedCents: neg('baseClearedCents'), baseSettledCents: neg('baseSettledCents'), realizedFxCents: neg('realizedFxCents'),
    transactionId: opts.transactionId, fxLineIndex: null, reason: opts.reason || null,
    id, reversesAllocationId: original.id, reversedBy: null, dateSource: 'recorded', backfillRunId: null,
    createdBy: opts.createdBy, createdAt: new Date().toISOString(),
  });
  tx.update(db.collection(ALLOCATIONS).doc(original.id) as never, { reversedBy: id });
  return id;
}

function toSettlement(id: string, d: Record<string, unknown>): SettlementAllocation {
  return {
    allocationId: id,
    documentId: String(d.documentId), documentType: d.documentType as 'invoice' | 'bill',
    kind: d.kind as AllocationKind,
    date: String(d.date || ''),
    amountCents: Number(d.amountCents) || 0,
    currency: String(d.currency || ''),
    documentRate: Number(d.documentRate) || 1,
    settlementRate: Number(d.settlementRate) || 1,
    baseClearedCents: Number(d.baseClearedCents) || 0,
    baseSettledCents: Number(d.baseSettledCents) || 0,
    realizedFxCents: Number(d.realizedFxCents) || 0,
    transactionId: (d.transactionId as string) || null,
    reversed: Boolean(d.reversedBy),
    dateSource: (d.dateSource as DateSource) || 'recorded',
  };
}

type Reader = { get: (q: never) => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }> } | null | undefined;

/**
 * A document's rows. With asOf: every signed event dated ≤ asOf (originals and reversals, including originals
 * reversed later). Without: the current live projection (originals not reversed). Date order.
 */
export async function allocationsOf(db: Firestore, tx: Reader, workspaceId: string, documentId: string, opts: { asOf?: string } = {}): Promise<SettlementAllocation[]> {
  const query = db.collection(ALLOCATIONS).where('workspaceId', '==', workspaceId).where('documentId', '==', documentId);
  const snap = tx ? await tx.get(query as never) : await query.get();
  const rows = snap.docs.map(d => toSettlement(d.id, d.data()));
  const picked = opts.asOf
    ? rows.filter(r => r.date.slice(0, 10) <= String(opts.asOf).slice(0, 10))
    : rows.filter(r => r.kind !== 'reversal' && !r.reversed);
  return picked.sort((a, b) => a.date.localeCompare(b.date) || a.allocationId.localeCompare(b.allocationId));
}

/** The live rows of a document in date order (what EG-1's fx-settlement recomputer reads). */
export function liveAllocationsOf(db: Firestore, tx: Reader, workspaceId: string, documentId: string): Promise<SettlementAllocation[]> {
  return allocationsOf(db, tx, workspaceId, documentId);
}
