import { lineAmount } from '../../lib/txFilters';
import { collection, addDoc, updateDoc, deleteDoc, doc } from '../../lib/db/firestore';
import { db } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { Transaction } from '../../types';
import { toast } from 'sonner';
import { formatDate } from '../../lib/utils';
import { describeError } from '../../lib/errorRemedies';
import { safeConfirm, getLocalDateISO } from '../../lib/utils';
import { retentionFor } from '../../lib/retentionPolicy';
import { handleFirestoreError, OperationType } from '../../lib/firebaseUtils';
import type { ActionContext } from './shared';
import { errorMessage } from './shared';
import { csvMoney, downloadCsv } from '../../lib/csvExport';

/** Workspace and period work: reset, year and month close, export, delete an account, recurring entries. (F-05, moved from useTransactionActions.) */
export function createWorkspaceActions(ctx: ActionContext) {
  const { user, currentWorkspaceId, setIsSyncing } = ctx;

  const handleResetWorkspace = async () => {
    if (!user || !currentWorkspaceId) return;
    const workspace = useAuthStore.getState().getCurrentWorkspace();
    const name = workspace?.name || 'this workspace';
    const graceDays = retentionFor(workspace).deletionGraceDays;
    if (!safeConfirm(`Delete "${name}"? Everything in it (entries, invoices, bills, contacts, files) will be deleted in ${graceDays} days. Until then an owner can keep it. The audit trail is kept.`)) return;
    try {
      const response = await fetch(`/api/v1/workspaces/${encodeURIComponent(currentWorkspaceId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${await user.getIdToken()}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || body.error || 'The workspace could not be deleted');
      const when = body.scheduledPurgeAt ? formatDate(String(body.scheduledPurgeAt).slice(0, 10)) : `in ${graceDays} days`;
      toast.success(`"${name}" will be deleted on ${when}`, { description: 'Until then, an owner can keep it from the banner at the top of the screen.' });
      useAuthStore.getState().setWorkspaces(useAuthStore.getState().workspaces.map(w => w.id === currentWorkspaceId ? { ...w, status: 'pending_deletion', scheduledPurgeAt: body.scheduledPurgeAt } as typeof w : w));
    } catch (error) {
      const described = describeError(error, 'delete');
      toast.error(described.title, { description: described.remedy });
    }
  };

  const handleCloseYear = async (closingDate: string, lockPeriod: boolean = true) => {
    if (!user || !currentWorkspaceId) return;
    const loader = toast.loading('Initiating fiscal year close protocol...');
    try {
      setIsSyncing(true);
      const response = await fetch('/api/v1/transactions/close-year', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await user.getIdToken()}`
        },
        body: JSON.stringify({ workspaceId: currentWorkspaceId, closingDate, lockPeriod })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to execute year-end close.');
      }

      // Add the new transaction to the client-side store
      if (data.transaction) {
        const currentTxs = useLedgerStore.getState().transactions;
        useLedgerStore.getState().setTransactions([...currentTxs, data.transaction]);
      }

      // Add the generated synthetic account if it exists
      if (data.generatedAccount) {
        const currentAccs = useLedgerStore.getState().accounts;
        useLedgerStore.getState().setAccounts([...currentAccs, data.generatedAccount]);
      }

      if (lockPeriod) {
        useLedgerStore.getState().setLockDate(closingDate);
      }

      toast.success(data.message || `Fiscal year closed successfully.`, { id: loader });
      return data;
    } catch (error) {
      console.error('Close Year Error:', error);
      toast.error(errorMessage(error) || 'Year-end close failed.', { id: loader });
      throw error;
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExport = (transactions: Transaction[]) => {
    const headers = ['Date', 'Transaction ID', 'Description', 'Account ID', 'Account Name', 'Debit', 'Credit', 'Status', 'Project', 'Department'];
    
    const rows: string[][] = [];
    transactions.forEach(t => {
      t.lines.forEach(l => {
        const amt = lineAmount(l, t);
        const debit = amt > 0 ? csvMoney(amt) : '0.00';
        const credit = amt < 0 ? csvMoney(Math.abs(amt)) : '0.00';
        rows.push([t.date, t.id, t.description, l.accountId, l.accountName || '', debit, credit, t.status, t.project || '', l.department || '']);
      });
    });

    downloadCsv(`general_ledger_export_${getLocalDateISO()}.csv`, headers, rows);
    toast.success('General Ledger Export completed successfully');
  };

  const handleDeleteAccount = async (id: string, force = false) => {
    if (!user || !currentWorkspaceId) return;
    
    // Check if account has transactions
    const txs = useLedgerStore.getState().transactions;
    const jes = useLedgerStore.getState().journalEntries;
    const linkedTxs = txs.filter(t => t.lines?.some(l => l.accountId === id));
    const linkedJes = jes.filter(j => j.lines?.some(l => l.accountId === id));
    const hasTransactions = linkedTxs.length > 0 || linkedJes.length > 0;

    setIsSyncing(true);
    try {
      if (hasTransactions) {
        if (!force) {
          const confirmed = safeConfirm(`This account has ${linkedTxs.length + linkedJes.length} historical records. Deactivating it will preserve all transaction history and balance history while hiding it from active selection. Proceed with deactivation?`);
          if (!confirmed) {
            setIsSyncing(false);
            return;
          }
        }

        // Safely archive account to preserve accounting integrity and prevent security rule violations
        // isArchived (not "status", which accounts don't have: the database refused it, L-179)
        await updateDoc(doc(db, 'chartAccounts', id), {
          isActive: false,
          isArchived: true,
          updatedAt: new Date().toISOString()
        });

        await addDoc(collection(db, 'auditLogs'), {
          uid: user.uid,
          workspaceId: currentWorkspaceId,
          email: user.email,
          action: 'DEACTIVATE_ACCOUNT',
          entityType: 'account',
          entityId: id,
          details: { linkedTransactionsCount: linkedTxs.length },
          timestamp: new Date().toISOString()
        });

        toast.success('Account deactivated and archived (transaction history preserved)');
      } else {
        if (!force) {
          const confirm = safeConfirm("Are you sure you want to delete this account? This action is irreversible.");
          if (!confirm) {
            setIsSyncing(false);
            return;
          }
        }

        await deleteDoc(doc(db, 'chartAccounts', id));

        await addDoc(collection(db, 'auditLogs'), {
          uid: user.uid,
          workspaceId: currentWorkspaceId,
          email: user.email,
          action: 'DELETE_EMPTY_ACCOUNT',
          entityType: 'account',
          entityId: id,
          details: { description: 'Empty account deleted' },
          timestamp: new Date().toISOString()
        });

        toast.success('Account node decommissioned');
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `chartAccounts/${id}`);
      toast.error('Decommissioning sequence failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCloseMonth = async (dateStr: string | null) => {
    if (!user || !currentWorkspaceId) return;
    
    const loader = toast.loading('Applying fiscal period lock...');
    try {
      setIsSyncing(true);
      // Extract YYYY-MM from YYYY-MM-DD
      const month = dateStr ? dateStr.substring(0, 7) : '';
      
      if (!month) {
        throw new Error("Invalid month format for period lock.");
      }

      const response = await fetch('/api/v1/transactions/close-month', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await user.getIdToken()}`
        },
        body: JSON.stringify({ workspaceId: currentWorkspaceId, month })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to close month.');
      }

      useLedgerStore.getState().setLockDate(data.closingDate);
      toast.success(data.message || `Month closed successfully.`, { id: loader });
    } catch (error) {
      toast.error(errorMessage(error) || 'Month-end close failed.', { id: loader });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleProcessDueRecurring = async () => {
    if (!user || !currentWorkspaceId) return { count: 0 };
    const loader = toast.loading('Triggering server recurring transaction processing...');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/v1/system/recurring/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || 'Failed to process recurring transactions.');
      }

      const data = await res.json();
      const processedCount = data.data?.processedCount ?? 0;
      if (processedCount === 0) {
        toast.info('No recurring transactions due at this time.', { id: loader });
      } else {
        toast.success(`Successfully posted ${processedCount} recurring transaction(s).`, { id: loader });
      }
      return { count: processedCount };
    } catch (err) {
      console.error('Failed to process recurring transactions:', err);
      toast.error(errorMessage(err) || 'Failed to process recurring transactions.', { id: loader });
      return { count: 0 };
    }
  };

  return { handleResetWorkspace, handleCloseYear, handleExport, handleDeleteAccount, handleCloseMonth, handleProcessDueRecurring };
}

export type WorkspaceActions = ReturnType<typeof createWorkspaceActions>;
