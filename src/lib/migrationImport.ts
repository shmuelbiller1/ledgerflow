/**
 * #904 (W11): a QuickBooks import is checked whole before anything is written, and it carries a
 * stable identity, so a retry of the same file replays what was saved instead of posting it again.
 *
 * - `migrationPreflight` refuses the file when any row has no real date or a date in a closed period
 *   (the server refuses those too, but by then earlier chunks would already be saved).
 * - `migrationRunKey` is a SHA-256 of the workspace and the rows: the same file in the same
 *   workspace gives the same key, so each chunk's Idempotency-Key and each entry's id stay the same
 *   across retries; a corrected file gives a new key and imports as new.
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

/** A stable key for this file in this workspace (hex SHA-256). */
export async function migrationRunKey(workspaceId: string, rows: readonly MigrationRow[]): Promise<string> {
  const canonical = JSON.stringify([workspaceId, rows.map(r => [r.date, r.num ?? '', r.payee ?? '', r.memo ?? '', r.account, r.split ?? '', r.debitCents, r.creditCents, r.netCents, r.class ?? '', r.location ?? ''])]);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
