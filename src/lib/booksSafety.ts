/**
 * EU-H2: "Your books are safe" — three plain facts on the overview, each with where to look: the last backup, how far
 * the books are closed, and the problems the data checks found. Read-only: worked out from what the app already knows.
 */
import type { BackupHealth } from './ledgerBackupHealth';
import type { CheckFinding } from './dataChecks';
import type { PinnedPage } from './pinnedPages';

export interface SafetyRow { id: 'backup' | 'closed' | 'problems'; ok: boolean; text: string; page: PinnedPage }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export function booksSafety(input: { backup: BackupHealth; lockDate?: string | null; findings: readonly Pick<CheckFinding, 'severity'>[] }): SafetyRow[] {
  const { backup, lockDate, findings } = input;
  const backupRow: SafetyRow = backup.status === 'never'
    ? { id: 'backup', ok: false, text: 'No backup downloaded yet', page: { tab: 'settings', sub: 'export' } }
    : {
      id: 'backup', ok: backup.status === 'fresh',
      text: backup.daysSinceLastBackup === 0 ? 'Last backup today' : `Last backup ${backup.daysSinceLastBackup} ${backup.daysSinceLastBackup === 1 ? 'day' : 'days'} ago${backup.isDue ? ' — time for a new one' : ''}`,
      page: { tab: 'settings', sub: 'export' },
    };
  const closed = /^\d{4}-\d{2}-\d{2}$/.test(lockDate || '') ? lockDate! : null;
  const closedRow: SafetyRow = closed
    ? { id: 'closed', ok: true, text: `Closed through ${monthName(closed)}`, page: { tab: 'month-end-close' } }
    : { id: 'closed', ok: false, text: 'No month closed yet', page: { tab: 'month-end-close' } };
  const serious = findings.filter(f => f.severity === 'high').length;
  const problemsRow: SafetyRow = findings.length === 0
    ? { id: 'problems', ok: true, text: 'No problems found', page: { tab: 'data-health' } }
    : { id: 'problems', ok: serious === 0, text: `${findings.length} ${findings.length === 1 ? 'problem' : 'problems'} found${serious ? ` (${serious} serious)` : ''}`, page: { tab: 'data-health' } };
  return [backupRow, closedRow, problemsRow];
}
