/**
 * #904 (W11): a QuickBooks import is checked whole before anything is written, and it carries a
 * stable identity, so a retry of the same file replays what was saved instead of posting it again.
 *
 * - `migrationPreflight` refuses the file when any row has no real date or a date in a closed period
 *   (the server refuses those too, but by then earlier chunks would already be saved).
 * - each entry's id comes from its own row (`migrationRowIds`: SHA-256 of the workspace and that row,
 *   plus an occurrence count for identical rows), so editing one row after a partial import leaves
 *   the ids of the rows already saved unchanged (Gitar on #974). The wizard leaves out rows already
 *   saved, and the server refuses an id that exists, so a saved row is never posted twice.
 * - each chunk's Idempotency-Key is a hash of what that chunk sends (`contentKey`), so an unchanged
 *   retry replays it and a chunk sent with another account mapping is a new request, not a 409.
 */
import { postingLock, lockMessage, type PeriodLockSettings } from './periodLock';

export interface MigrationRow {
  date: string;
  num?: string;
  payee?: string;
  memo?: string;
  account: string;
  split?: string;
  debitCents: number;
  creditCents: number;
  netCents: number;
  class?: string;
  location?: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function realDate(date: string): boolean {
  if (!YMD.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** The problems that stop the whole import, one per row (row numbers start at 1); empty when it can go ahead. */
export function migrationPreflight(rows: readonly MigrationRow[], ws: PeriodLockSettings | null | undefined, uid: string): string[] {
  const problems: string[] = [];
  rows.forEach((row, i) => {
    const date = String(row.date || '');
    if (!realDate(date)) { problems.push(`Row ${i + 1}: "${date}" is not a date (YYYY-MM-DD).`); return; }
    const lock = postingLock(date, ws, uid);
    if (lock) problems.push(`Row ${i + 1}: ${lockMessage(date, lock)}`);
  });
  return problems;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const rowFields = (r: MigrationRow) => [r.date, r.num ?? '', r.payee ?? '', r.memo ?? '', r.account, r.split ?? '', r.debitCents, r.creditCents, r.netCents, r.class ?? '', r.location ?? ''];

/** One entry id per row, from the workspace and that row alone; identical rows are told apart by their occurrence. */
export async function migrationRowIds(workspaceId: string, rows: readonly MigrationRow[]): Promise<string[]> {
  const seen = new Map<string, number>();
  const ids: string[] = [];
  for (const row of rows) {
    const key = (await sha256Hex(JSON.stringify([workspaceId, rowFields(row)]))).slice(0, 24);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    ids.push(`tx-qbo-${key}-${occurrence}`);
  }
  return ids;
}

/** A key for exactly this content (hex SHA-256): the same chunk body gives the same Idempotency-Key. */
export function contentKey(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(value));
}
