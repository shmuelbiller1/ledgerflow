import React, { useEffect } from 'react';
import { ShieldAlert, Download, X } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { getBackupHealth, BackupHealth } from '../../lib/ledgerBackupHealth';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';

export const LedgerBackupReminder: React.FC = () => {
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const isGuest = useAuthStore(s => s.isGuest);
  const userId = useAuthStore(s => s.user?.uid);
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const identityKey = JSON.stringify([currentWorkspaceId, isGuest, userId]);
  const [health, setHealth] = usePageSyncedState<BackupHealth>(identityKey, getBackupHealth(currentWorkspaceId), () => getBackupHealth(currentWorkspaceId));
  const [isDismissed, setIsDismissed] = usePageSyncedState(identityKey, false, false);
  const [demoDismissed, setDemoDismissed] = usePageSyncedState(identityKey, false, false);

  useEffect(() => {
    const handleBackupDone = () => {
      setHealth(getBackupHealth(currentWorkspaceId));
    };

    window.addEventListener('ledgerflow:backup_completed', handleBackupDone);
    return () => window.removeEventListener('ledgerflow:backup_completed', handleBackupDone);
  }, [currentWorkspaceId, setHealth]);

  const showBackup = health.isDue && !isDismissed;
  const showDemo = !userId && isGuest && !demoDismissed;
  if (!showBackup && !showDemo) {
    return null;
  }

  const handleGoToBackup = () => {
    setActiveTab('settings' as unknown as string);
  };

  return (<>
    <div role="status" aria-label="Ledger notices" data-testid="compact-ledger-notices"
      className="sm:hidden flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--surface)] text-[var(--text)] px-3 text-xs font-medium">
      <span className="min-w-0 flex-1 truncate">
        {showDemo ? 'Demo data' : ''}{showDemo && showBackup ? ' · ' : ''}{showBackup ? 'Backup due' : ''}
      </span>
      {showBackup && <button onClick={handleGoToBackup} aria-label="Export backup" title="Export backup"
        className="min-h-11 min-w-11 inline-flex items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brass)]">
        <Download aria-hidden="true" className="w-4 h-4" />
      </button>}
      <button onClick={() => { setIsDismissed(true); setDemoDismissed(true); }} aria-label="Dismiss notices" title="Dismiss notices"
        className="min-h-11 min-w-11 inline-flex items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brass)]">
        <X aria-hidden="true" className="w-4 h-4" />
      </button>
    </div>
    {showBackup &&
    <div 
      role="status"
      id="ledger-backup-reminder-banner"
      className="hidden sm:flex bg-amber-500/10 border-b border-amber-500/20 text-amber-900 dark:text-amber-300 px-4 py-1 min-h-9 items-center justify-between text-xs font-medium transition-colors"
    >
      <div className="flex items-center gap-2.5 overflow-hidden">
        <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" aria-hidden="true" />
        {showDemo && <span data-testid="desktop-demo-notice" className="shrink-0 font-semibold text-purple-800 dark:text-purple-300">Demo data — sign up to save your own ·</span>}
        <span className="min-w-0">
          {health.status === 'never'
            ? "You've never exported a backup. Export a copy to protect your books."
            : `Last backup was ${health.daysSinceLastBackup} days ago. Export a fresh copy every 30 days.`}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-3">
        <button
          onClick={handleGoToBackup}
          id="btn-backup-reminder-export"
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 border border-amber-500/30 rounded text-xs font-semibold transition"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export backup</span>
        </button>
        <button
          onClick={() => setIsDismissed(true)}
          id="btn-backup-reminder-dismiss"
          aria-label="Dismiss backup reminder"
          className="p-1 hover:bg-amber-500/20 rounded text-amber-800 dark:text-amber-400/80 hover:text-amber-950 dark:hover:text-amber-200 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>}
    {showDemo && !showBackup && <div data-testid="desktop-demo-notice" className="hidden sm:block bg-purple-600/10 text-purple-800 dark:text-purple-300 border-b border-purple-500/20 px-4 py-1.5 text-xs text-center font-semibold">
      Demo data — sign up to save your own
    </div>}
  </>
  );
};

export default LedgerBackupReminder;
