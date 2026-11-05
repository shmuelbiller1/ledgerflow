export const LEDGER_BACKUP_REMINDER_DAYS = 30;

export interface BackupHealth {
  lastBackupAt: string | null;
  daysSinceLastBackup: number | null;
  isDue: boolean;
  status: 'never' | 'overdue' | 'fresh';
}

export function getBackupHealth(workspaceId?: string | null): BackupHealth {
  if (!workspaceId) {
    return { lastBackupAt: null, daysSinceLastBackup: null, isDue: false, status: 'fresh' };
  }
  const key = `ledgerflow:last_backup:${workspaceId}`;
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  if (!stored) {
    return {
      lastBackupAt: null,
      daysSinceLastBackup: null,
      isDue: true,
      status: 'never'
    };
  }
  const lastDate = new Date(stored);
  if (Number.isNaN(lastDate.getTime())) {
    return { lastBackupAt: null, daysSinceLastBackup: null, isDue: true, status: 'never' };
  }
  const diffMs = Date.now() - lastDate.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const isDue = days >= LEDGER_BACKUP_REMINDER_DAYS;
  return {
    lastBackupAt: stored,
    daysSinceLastBackup: days,
    isDue,
    status: isDue ? 'overdue' : 'fresh'
  };
}

export function recordBackupCompleted(workspaceId: string): void {
  if (typeof localStorage === 'undefined') return;
  const now = new Date().toISOString();
  localStorage.setItem(`ledgerflow:last_backup:${workspaceId}`, now);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ledgerflow:backup_completed', { detail: { workspaceId, timestamp: now } }));
  }
}
