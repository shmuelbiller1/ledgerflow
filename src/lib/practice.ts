/**
 * The Practice view (BD-01): "which clients need work today?" One row per workspace the person can
 * open, with what is waiting there, sorted by most work. The server counts each from that
 * workspace's own records (src/server/services/practiceService.ts), only for workspaces the person
 * belongs to; nothing here reads another workspace.
 */
export interface PracticeRow {
  workspaceId: string;
  name: string;
  role: string;
  currency: string;
  /** the person's groups of books it is in (DA-01) */
  groups: string[];
  /** bank lines not matched yet */
  bankLines: number;
  /** bank connections whose login expired */
  bankLogins: number;
  /** questions about entries waiting for an answer (BD-07) */
  questions: number;
  /** draft entries, invoices and bills waiting */
  drafts: number;
  /** bills in force with no file attached (the vendor's bill or receipt) */
  billsWithoutFile: number;
  /** last month, e.g. "2026-09", and whether it is closed */
  lastMonth: string;
  lastMonthClosed: boolean;
  /** the next recurring item due, if any */
  nextRecurring: { date: string; description: string } | null;
  /** Data Health from the nightly check (missing labels, duplicate bills, unbalanced entries…), when it ran */
  health: { serious: number; warnings: number; checkedAt: string } | null;
  /** Strategy 1: measured bank-feed no-touch automation rate for this client book */
  noTouch?: { noTouchCount: number; totalBankLines: number; ratePercent: number | null } | null;
  /** Strategy 1: deterministic 0–100 month-end close readiness score */
  closeReadiness?: { score: number; grade: 'ready' | 'almost_ready' | 'attention_needed' } | null;
}

/** How much is waiting: each count, and one for last month still open. */
export const practiceWork = (r: Pick<PracticeRow, 'bankLines' | 'bankLogins' | 'questions' | 'drafts' | 'lastMonthClosed'> & { health?: PracticeRow['health'] }) =>
  r.bankLines + r.bankLogins + r.questions + r.drafts + (r.lastMonthClosed ? 0 : 1) + (r.health?.serious || 0);

/** Most work first, then by name. */
export const sortPractice = (rows: PracticeRow[]) => [...rows].sort((a, b) => practiceWork(b) - practiceWork(a) || a.name.localeCompare(b.name));

/** The month before `today` (YYYY-MM-DD) as YYYY-MM. */
export function monthBefore(today: string): string {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
