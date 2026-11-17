import { runNamedCommand } from '../../lib/commandByName';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { Transaction, BankStatementLine, AuditLogDetails } from '../../types';
import { handleFirestoreError, OperationType } from '../../lib/firebaseUtils';
import { retryWithBackoff } from '../../lib/retryUtils';
import { postingLock } from '../../lib/periodLock';

export type ImportedTransaction = Partial<Omit<Transaction, 'date' | 'description'>> & {
  date: string;
  description: string;
  amountCents: number;
  isAI?: boolean;
};
export type ImportedBankLine = Omit<BankStatementLine, 'matchedTransactionId'> & { matchedTransactionId?: string | null; createdAt?: string };
export type TransactionUpdates = Partial<Transaction> & {
  accountId?: string;
  accountName?: string;
  category?: string;
  'dimensions.category'?: string;
  'dimensions.project'?: string;
  /** EU-E2: labels to set (label id → value) on the entry and on its category lines; bank lines keep theirs */
  labels?: Record<string, string>;
};
export type TransactionConflictError = Error & { isConflict?: boolean; currentTransaction?: Transaction };
export type ReconcileOperation =
  | { type: 'updateBankLine'; id: string; data: { status: 'pending' | 'matched'; matchedTransactionId: string | null } }
  | { type: 'updateTransaction'; id: string; data: Pick<Transaction, 'status'> };

export function errorMessage(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return undefined;
}

export function isConflictError(error: unknown): error is TransactionConflictError {
  return error instanceof Error && 'isConflict' in error && Boolean(error.isConflict);
}


export const UNDO_WINDOW_MS = 30_000;


/**
 * What every group of transaction actions needs (F-05): the signed-in user and workspace, ledger
 * data from the stores, the audit writer and the period-lock check. Read once per render by
 * useTransactionActions and passed to each group.
 */
export function useActionContext() {
  const user = useAuthStore(s => s.user);
  const userProfile = useAuthStore(s => s.userProfile);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const getCurrentWorkspace = useAuthStore(s => s.getCurrentWorkspace);
  const setTransactions = useLedgerStore(s => s.setTransactions);
  const setAccounts = useLedgerStore(s => s.setAccounts);
  const accounts = useLedgerStore(s => s.accounts);
  const analyticalPatternCache = useLedgerStore(s => s.analyticalPatternCache);
  const matchingThreshold = useLedgerStore(s => s.matchingThreshold);
  const dimensionNodes = useLedgerStore(s => s.dimensionNodes);
  
  const userKey = userProfile?.geminiApiKey;
  const { setIsSyncing } = useUIStore.getState();

  const generateFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const recordAudit = async (action: string, entityType: string, entityId: string, details: AuditLogDetails | Partial<Transaction> | string) => {
    if (!user || !currentWorkspaceId) return;
    try {
      setIsSyncing(true);
      // the trail is a hash chain: a row `addDoc`-ed from the tab has no chain position, so the sequence and the
      // hashes (and the actor and the clock) come from the server. The screen only says what happened.
      const auditDetails = typeof details === 'string' ? { description: details } : (details || {});
      const description = typeof (auditDetails as { description?: unknown }).description === 'string'
        ? String((auditDetails as { description?: unknown }).description)
        : undefined;
      await retryWithBackoff(() => runNamedCommand('auditlog.append', {
        action,
        entityType,
        entityId,
        ...(description ? { description } : {}),
        ...(auditDetails as Record<string, unknown> && Object.keys(auditDetails).length ? { details: auditDetails as Record<string, string | number | boolean | null> } : {}),
      }, { workspaceId: currentWorkspaceId }));
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'auditLogs');
    }
  };

  // Closed for the signed-in user (src/lib/periodLock.ts: hard close, soft close, partial unlock)
  const isPeriodLocked = (date: string) => {
    const workspace = getCurrentWorkspace();
    return !!postingLock(date, workspace, user?.uid || '');
  };


  return { user, userProfile, currentWorkspaceId, getCurrentWorkspace, setTransactions, setAccounts, accounts, analyticalPatternCache, matchingThreshold, dimensionNodes, userKey, setIsSyncing, generateFileHash, recordAudit, isPeriodLocked };
}

export type ActionContext = ReturnType<typeof useActionContext>;
export type RunRegisteredCommand = (name: string, input: Record<string, unknown>, successMsg?: string) => Promise<Record<string, unknown>>;
