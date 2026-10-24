/**
 * A-127: Projects — retention (holdback) tracking on milestone bills (report + metadata tracking).
 *
 * Tracks contractual retention held back from supplier/subcontractor milestone bills
 * (`Bill.metadata.retention = { heldCents, percent?, releaseDate?, releasedAt?, project?, notes? }`).
 *
 * Strict accounting rules:
 * - Whole minor units (`heldCents`), capped at `[0, bill.amountCents]`.
 * - Grouped strictly by currency (`bill.currency`) — currencies are never added together or converted.
 * - Read/metadata tracking only: does NOT alter `Bill.amountCents` or post separate GL entries.
 */
import type { Bill } from '../types';

export type RetentionState = 'past-due' | 'upcoming' | 'unscheduled' | 'released';

export interface BillRetentionMeta {
  heldCents: number;
  percent?: number;
  releaseDate?: string;
  releasedAt?: string;
  project?: string;
  notes?: string;
}

export interface BillRetentionRow {
  billId: string;
  billNumber: string;
  billDate: string;
  vendorName: string;
  project: string;
  currency: string;
  grossBillCents: number;
  heldCents: number;
  netPayableBeforeReleaseCents: number;
  percent?: number;
  releaseDate: string;
  releasedAt: string;
  state: RetentionState;
  notes: string;
}

export interface BillRetentionCurrencyTotal {
  currency: string;
  grossCents: number;
  heldOpenCents: number;
  pastDueCents: number;
  releasedCents: number;
}

const IGNORED_BILLS = new Set(['draft', 'void', 'cancelled', 'rejected']);

export function retentionFromBill(bill: Bill): BillRetentionMeta | null {
  const raw = bill.metadata?.retention;
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const heldCents = Math.round(Number(obj.heldCents) || 0);
  if (heldCents <= 0) return null;
  return {
    heldCents,
    ...(Number.isFinite(Number(obj.percent)) && Number(obj.percent) > 0 ? { percent: Number(obj.percent) } : {}),
    ...(typeof obj.releaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.releaseDate) ? { releaseDate: obj.releaseDate } : {}),
    ...(typeof obj.releasedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.releasedAt) ? { releasedAt: obj.releasedAt } : {}),
    ...(typeof obj.project === 'string' && obj.project.trim() ? { project: obj.project.trim() } : {}),
    ...(typeof obj.notes === 'string' && obj.notes.trim() ? { notes: obj.notes.trim().slice(0, 240) } : {}),
  };
}

export function retentionInputProblem(input: {
  billAmountCents: number;
  heldCents: number;
  releaseDate?: string;
}): string | null {
  if (!(input.heldCents > 0)) return 'Enter a retention holdback amount above zero.';
  if (input.heldCents > input.billAmountCents) return 'Retention held back cannot exceed the total bill amount.';
  if (input.releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.releaseDate)) return 'Release due date must be YYYY-MM-DD.';
  return null;
}

const STATE_ORDER: Record<RetentionState, number> = {
  'past-due': 0,
  upcoming: 1,
  unscheduled: 2,
  released: 3,
};

export function computeBillRetentionReport(
  bills: Bill[],
  asOfDate: string,
  defaultCurrency = 'USD',
): { rows: BillRetentionRow[]; totalsByCurrency: BillRetentionCurrencyTotal[] } {
  const rows: BillRetentionRow[] = [];

  for (const bill of bills || []) {
    if (IGNORED_BILLS.has(String(bill.status))) continue;
    const meta = retentionFromBill(bill);
    if (!meta) continue;
    const gross = Math.max(0, Math.round(Number(bill.amountCents) || 0));
    const heldCents = Math.min(gross, meta.heldCents);
    const splitProject = (bill.splits || []).find(s => s.dimensions?.project?.trim())?.dimensions?.project?.trim();
    const project = meta.project || splitProject || String(bill.projectId || '').trim() || 'Unassigned';
    const releaseDate = meta.releaseDate || '';
    const releasedAt = meta.releasedAt || '';
    const state: RetentionState = releasedAt
      ? 'released'
      : releaseDate
        ? (releaseDate <= asOfDate ? 'past-due' : 'upcoming')
        : 'unscheduled';

    rows.push({
      billId: bill.id,
      billNumber: String(bill.number || bill.id),
      billDate: String(bill.date || bill.issueDate || '').slice(0, 10),
      vendorName: String(bill.vendorName || 'Vendor'),
      project,
      currency: String(bill.currency || defaultCurrency || 'USD').toUpperCase(),
      grossBillCents: gross,
      heldCents,
      netPayableBeforeReleaseCents: gross - heldCents,
      ...(meta.percent !== undefined ? { percent: meta.percent } : {}),
      releaseDate,
      releasedAt,
      state,
      notes: meta.notes || '',
    });
  }

  rows.sort((a, b) =>
    STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || (a.releaseDate || '9999-99-99').localeCompare(b.releaseDate || '9999-99-99')
    || a.vendorName.localeCompare(b.vendorName));

  const totalsMap = new Map<string, BillRetentionCurrencyTotal>();
  for (const r of rows) {
    let t = totalsMap.get(r.currency);
    if (!t) {
      t = { currency: r.currency, grossCents: 0, heldOpenCents: 0, pastDueCents: 0, releasedCents: 0 };
      totalsMap.set(r.currency, t);
    }
    t.grossCents += r.grossBillCents;
    if (r.state === 'released') {
      t.releasedCents += r.heldCents;
    } else {
      t.heldOpenCents += r.heldCents;
      if (r.state === 'past-due') t.pastDueCents += r.heldCents;
    }
  }

  return {
    rows,
    totalsByCurrency: [...totalsMap.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

export const BILL_RETENTION_CSV_HEADERS = [
  'Bill', 'Bill date', 'Vendor', 'Project', 'Currency', 'Gross bill (minor units)',
  'Held back (minor units)', 'Before release (minor units)', 'Release due', 'Status', 'Released on', 'Notes',
];

export function billRetentionCsvRows(rows: BillRetentionRow[]): Array<Array<string | number>> {
  return rows.map(r => [
    r.billNumber,
    r.billDate,
    r.vendorName,
    r.project,
    r.currency,
    r.grossBillCents,
    r.heldCents,
    r.netPayableBeforeReleaseCents,
    r.releaseDate,
    r.state,
    r.releasedAt,
    r.notes,
  ]);
}
