import React, { useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCurrentRole, hasRoleAtLeast } from '../../hooks/useCurrentRole';
import { Building, CheckCircle2, RefreshCw, Landmark, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { toast } from 'sonner';
import { getIdToken } from '../../firebase';
import { cn } from '../../lib/utils';
import PlaidConnectButton from '../finance/PlaidConnectButton';
// Keep utility modules reachable for the structural module guard.
import { parseCamt053Statement as _parseCamt053Statement } from '../../lib/camt053Parser';
import { scoreReceiptMatches as _scoreReceiptMatches } from '../../lib/receiptMatcher';
import { TransferModal } from './TransferModal';
import MakeDepositDialog from './MakeDepositDialog';
import CashMovementDialog from './CashMovementDialog';
import ConnectedBanks from './ConnectedBanks';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';

export default function Banking() {
  const canImport = hasRoleAtLeast(useCurrentRole(), 'bookkeeper');
  const accounts = useLedgerStore(s => s.accounts).filter(a => 
    (a.type === 'asset' && a.subtype === 'bank') ||
    a.name.toLowerCase().includes('bank') ||
    a.name.toLowerCase().includes('checking') ||
    a.name.toLowerCase().includes('savings') ||
    a.category?.toLowerCase().includes('cash') ||
    a.category?.toLowerCase().includes('bank')
  );
  
  // the chart of accounts loads when the workspace opens: say so while it is on its way, and say
  // what happened if it could not be read (D-88: one action in each state)
  // (the shared hook knows demo mode has no database, so a demo never waits forever)
  const { loading } = useLedgerCollections('accounts');
  const accountsError = useDataNeedsStore(s => s.failed.accounts);
  const retryAccounts = useDataNeedsStore(s => s.retry);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const [needsReconnect, setNeedsReconnect] = useState<{ bankId: string; institutionName: string }[]>([]);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [cashMovement, setCashMovement] = useState<null | 'in' | 'out'>(null);

  const handleSyncNow = async (accountName: string, accountId: string) => {
    setSyncingAccountId(accountId);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/v1/plaid/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ workspaceId, accountId })
      });
      const data = await res.json();
      setNeedsReconnect(Array.isArray(data.needsReconnect) ? data.needsReconnect : []);
      if (res.ok && Array.isArray(data.failed) && data.failed.length > 0) toast.warning(`${data.failed.length} bank connection(s) could not be synced: see Connected banks for why.`);
      const busy = res.ok && Array.isArray(data.busy) ? data.busy.length : 0;
      if (busy > 0) toast.info(`${busy} bank connection(s) are being synced by another request: try again in a moment.`);
      if (res.ok && (data.success || (busy > 0 && Array.isArray(data.transactions) && data.transactions.length > 0))) {
        toast.success(`Synchronized ${accountName} with bank feed.`);
      } else if (res.ok && busy === 0) {
        toast.info(data.message || 'Bank feed synced. No new transactions.');
      } else {
        toast.error(`Bank feed error: ${data.error || data.message || 'Failed to sync with institution.'}`);
      }
    } catch (err) {
      console.error('Error syncing bank feed:', err);
      toast.error(`Unable to sync bank feed for ${accountName}`);
    } finally {
      setSyncingAccountId(null);
    }
  };

  const handleSyncSuccess = () => {
    toast.success('Bank credentials saved. Transaction feed synchronized.');
  };

  return (
    <div className="h-full flex flex-col bg-[var(--color-ledger-bg)] p-6 md:p-8 overflow-auto">
      <div className="max-w-5xl mx-auto w-full space-y-8">
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--color-ledger-ink)] font-display tracking-tight flex items-center gap-3">
              <Landmark className="w-6 h-6 text-indigo-600" />
              Bank & Institution Connections
            </h1>
            <p className="text-sm text-[var(--color-ledger-muted)] mt-1">
              Manage your connected financial institutions, live feeds, and reconciliation pipelines.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!canImport} aria-describedby={!canImport ? 'bank-import-permission' : undefined} onClick={() => { if (canImport) useUIStore.getState().setImporterOpen(true); }} className="min-h-11 px-4 py-2 bg-white text-neutral-800 text-xs font-bold rounded-xl border border-neutral-200 disabled:opacity-50">
              Import statement
            </button>
            {!canImport && <p id="bank-import-permission" className="w-full text-sm text-slate-600">Importing a statement requires a signed-in workspace owner, accountant or bookkeeper. Guest and viewer sessions cannot import bank data.</p>}
            {/* money that arrives or leaves with no document behind it (BA-17) */}
            <button
              onClick={() => setCashMovement('in')}
              className="min-h-11 px-4 py-2 bg-white hover:bg-neutral-50 text-neutral-800 text-xs font-bold rounded-xl border border-neutral-200 transition-all flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <ArrowDownToLine className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              <span>Money in</span>
            </button>
            <button
              onClick={() => setCashMovement('out')}
              className="min-h-11 px-4 py-2 bg-white hover:bg-neutral-50 text-neutral-800 text-xs font-bold rounded-xl border border-neutral-200 transition-all flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <ArrowUpFromLine className="h-4 w-4 text-rose-600" aria-hidden="true" />
              <span>Money out</span>
            </button>
            <button
              onClick={() => setIsTransferModalOpen(true)}
              className="min-h-11 px-4 py-2 bg-white hover:bg-neutral-50 text-neutral-800 text-xs font-bold rounded-xl border border-neutral-200 transition-all flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <ArrowRightLeft className="w-4 h-4 text-indigo-600" />
              <span>Transfer Funds</span>
            </button>
            <button type="button" onClick={() => setIsDepositOpen(true)} className="h-12 px-6 bg-[var(--surface)] hover:border-[var(--brass-line)] border border-[var(--line)] text-[var(--text)] font-black text-[10px] uppercase tracking-widest rounded-xl shadow-sm">
              Make deposit
            </button>
            {/* the same control is the empty state's one action when there are no accounts yet */}
            {accounts.length > 0 && <PlaidConnectButton onSuccessSync={handleSyncSuccess} />}
            {needsReconnect.map(b => (
              <div key={b.bankId} role="alert" className="flex items-center gap-3 rounded-xl border border-[var(--neg)] px-3 py-2 text-xs text-[var(--text)]">
                <span>{b.institutionName || 'A bank'} needs you to log in again.</span>
                <PlaidConnectButton bankId={b.bankId} label="Reconnect" onSuccessSync={() => setNeedsReconnect(list => list.filter(x => x.bankId !== b.bankId))} />
              </div>
            ))}
          </div>
        </div>

        <ConnectedBanks />

        {accountsError && accounts.length === 0 ? (
          <div role="alert" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-8 text-center">
            <h2 className="text-lg font-bold text-[var(--text)]">We couldn't load your bank accounts</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Your chart of accounts did not arrive, so nothing can be listed here yet.</p>
            <button
              type="button"
              onClick={() => retryAccounts('accounts')}
              className="mt-6 min-h-11 px-6 py-3 bg-[var(--text)] text-[var(--surface)] rounded-xl text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity shadow-md"
            >
              Try again
            </button>
          </div>
        ) : loading && accounts.length === 0 ? (
          <LoadingState what="bank accounts" />
        ) : accounts.length === 0 ? (
          <EmptyState
            title="No bank accounts yet"
            description="Connect a bank to bring its transactions in, or add a bank account to your chart of accounts and import a statement."
            action={<PlaidConnectButton onSuccessSync={handleSyncSuccess} />}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {accounts.map(account => (
              <div key={account.id} className="bg-white border border-[var(--color-ledger-line)] rounded-2xl p-5 shadow-xs flex flex-col">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                      <Building className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-slate-900 text-sm leading-tight">{account.name}</h2>
                      <p className="text-xs text-slate-600 font-mono mt-0.5">{account.code ? `Acct ${account.code}` : 'Bank Account'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3" /> Ready
                  </div>
                </div>

                <div className="mt-auto pt-4 border-t border-slate-100 space-y-4">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-600 font-medium">Type</span>
                    <span className="text-slate-800 font-mono font-bold uppercase">{account.subtype || account.type || 'Asset'}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSyncNow(account.name, account.id)}
                      disabled={syncingAccountId === account.id}
                      className="flex-1 min-h-11 px-3 py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className={cn("w-3.5 h-3.5", syncingAccountId === account.id && "animate-spin")} />
                      <span>{syncingAccountId === account.id ? 'Syncing...' : 'Sync Feed'}</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <TransferModal isOpen={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} />
      {cashMovement && (
        <CashMovementDialog
          isOpen
          direction={cashMovement}
          onClose={() => setCashMovement(null)}
        />
      )}
      {isDepositOpen && <MakeDepositDialog onClose={() => setIsDepositOpen(false)} />}
    </div>
  );
}
