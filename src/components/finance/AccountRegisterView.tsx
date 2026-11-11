import React, { useState, useMemo } from 'react';
import { usePagedRows } from '../../hooks/usePagedRows';
import { ShowMoreRows } from '../common/ShowMoreRows';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { Transaction } from '../../types';
import { isExpenseAccount, isPostable, lineAmount, transactionDate } from '../../lib/txFilters';
import { formatDecimal, formatCurrency, cn, getLocalDateISO } from '../../lib/utils';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { setCleared } from '../../services/clearanceActions';
import { toast } from 'sonner';
import { calculateAccountRegisterBalances, visibleAccountRegisterEntries } from '../../lib/accountRegister';
import { useServerOpening } from '../../hooks/useServerOpening';
import { BookOpen, Search, CheckCircle2, Circle, Filter, Building2 } from 'lucide-react';

export const AccountRegisterView: React.FC = () => {
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  const updateTransaction = useLedgerStore(s => s.updateTransaction);
  // L-123 step 3: the header balance = the server's sum through the oldest loaded day + the loaded entries after it
  const serverOpening = useServerOpening(transactions);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const role = useCurrentRole();
  const canClear = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  // the entry being marked cleared, and the day the bank cleared it (CA-04)
  const [clearing, setClearing] = useState<string | null>(null);
  const [clearOn, setClearOn] = useState('');

  // Default to first cash or asset account
  const defaultAccount = useMemo(() => {
    return accounts.find(a => a.type === 'asset') || accounts[0] || null;
  }, [accounts]);

  const [selectedAccountId, setSelectedAccountId] = useState<string>(() => defaultAccount?.id || '');
  const [unclearedOnly, setUnclearedOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const selectedAccount = useMemo(() => {
    return accounts.find(a => a.id === selectedAccountId) || defaultAccount;
  }, [accounts, selectedAccountId, defaultAccount]);

  // Extract all lines for this account across postable transactions, sorted newest first
  const { entries, registerCalculation } = useMemo(() => {
    if (!selectedAccount) {
      return { entries: [], registerCalculation: { endingBalanceMinor: 0, runningNewestFirst: [] } };
    }

    // debit-nature: assets and every kind of expense (expense, cost_of_goods, cogs: isExpenseAccount)
    const isDebitNature = selectedAccount.type === 'asset' || isExpenseAccount(selectedAccount);
    const openingBalance = selectedAccount.openingBalanceCents || 0;

    const rawEntries: Array<{
      id: string;
      txId: string;
      date: string;
      reference?: string;
      payee?: string;
      description: string;
      accountId: string;
      deltaMinor: number;
      debitMinor: number;
      creditMinor: number;
      isCleared: boolean;
      clearanceDate: string;
      originalTx: Transaction;
    }> = [];

    let totalActivityMinor = 0;
    // with the server's answer, the entries it summed (dated up to its day) count through it, not one by one
    const serverCents = serverOpening ? (serverOpening.accounts[selectedAccount.id] || 0) : 0;
    if (serverOpening) totalActivityMinor += isDebitNature ? serverCents : -serverCents;

    // Filter postable transactions
    const postableTxs = transactions.filter(isPostable);

    // Collect all lines for this account
    postableTxs.forEach(tx => {
      tx.lines?.forEach((line, lineIdx) => {
        if (line.accountId === selectedAccount.id) {
          const amt = lineAmount(line, tx);
          // For debit-nature accounts: positive amount is debit (+), negative is credit (-)
          // The delta to the balance:
          const delta = isDebitNature ? amt : -amt;
          if (!serverOpening || transactionDate(tx) > serverOpening.asOf) totalActivityMinor += delta;

          rawEntries.push({
            id: `${tx.id}-${lineIdx}`,
            txId: tx.id,
            date: tx.date,
            reference: (tx as typeof tx & { reference?: string; checkNumber?: string; entity?: string; isReconciled?: boolean }).reference || (tx as typeof tx & { reference?: string; checkNumber?: string; entity?: string; isReconciled?: boolean }).checkNumber || '',
            payee: (tx as typeof tx & { reference?: string; checkNumber?: string; entity?: string; isReconciled?: boolean }).payee || (tx as typeof tx & { reference?: string; checkNumber?: string; entity?: string; isReconciled?: boolean }).entity || '',
            description: line.description || tx.description || 'Transaction',
            accountId: line.accountId,
            deltaMinor: delta,
            debitMinor: amt > 0 ? amt : 0,
            creditMinor: amt < 0 ? Math.abs(amt) : 0,
            // cleared by reconciliation (isCleared) or marked here; it used to read only isReconciled, so
            // entries cleared by reconciliation showed as not cleared
            isCleared: tx.isCleared === true || (line as typeof line & { isCleared?: boolean }).isCleared === true || (tx as typeof tx & { reference?: string; checkNumber?: string; entity?: string; isReconciled?: boolean }).isReconciled === true,
            clearanceDate: tx.clearanceDate || (typeof tx.clearedAt === 'string' ? tx.clearedAt.slice(0, 10) : ''),
            originalTx: tx
          });
        }
      });
    });

    // Sort newest first
    rawEntries.sort((a, b) => {
      const cmp = b.date.localeCompare(a.date);
      if (cmp !== 0) return cmp;
      return b.txId.localeCompare(a.txId);
    });

    // Guard integer values for calculation
    const safeStart = Number.isSafeInteger(openingBalance) ? openingBalance : 0;
    const safeActivity = Number.isSafeInteger(totalActivityMinor) ? totalActivityMinor : 0;
    const newestAmounts = rawEntries.map(e => Number.isSafeInteger(e.deltaMinor) ? e.deltaMinor : 0);

    const calc = calculateAccountRegisterBalances(safeStart, safeActivity, newestAmounts);

    return {
      entries: rawEntries,
      registerCalculation: calc
    };
  }, [selectedAccount, transactions, serverOpening]);

  // Filter entries based on search and uncleared filter
  const displayedEntries = useMemo(() => {
    let list = entries.map((entry, idx) => ({
      ...entry,
      runningBalanceMinor: registerCalculation.runningNewestFirst[idx] ?? 0
    }));

    if (unclearedOnly) {
      list = visibleAccountRegisterEntries(list, true);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(e => 
        e.description.toLowerCase().includes(q) ||
        (e.reference && e.reference.toLowerCase().includes(q)) ||
        (e.payee && e.payee.toLowerCase().includes(q))
      );
    }

    return list;
  }, [entries, registerCalculation, unclearedOnly, searchQuery]);
  // #642: a busy account draws its first page of lines at once (printing draws them all)
  const paged = usePagedRows(displayedEntries, `${selectedAccount?.id || ''}|${unclearedOnly}|${searchQuery}`);

  // Cleared / not cleared is saved through the server (CA-04); it used to change only this screen
  // and was gone after a reload. Marking cleared asks for the day the bank cleared it.
  const handleToggleCleared = async (txId: string, currentCleared: boolean) => {
    const tx = transactions.find(t => t.id === txId);
    if (!tx || !canClear) return;
    if (!currentCleared) {
      const today = getLocalDateISO();
      setClearOn(String(tx.date || '').slice(0, 10) > today ? String(tx.date).slice(0, 10) : today);
      setClearing(txId);
      return;
    }
    try {
      await setCleared(workspaceId, [txId], { cleared: false });
      updateTransaction(txId, { isCleared: false, isReconciled: false, clearanceDate: undefined, clearedAt: undefined } as Partial<Transaction>);
      toast.success('Marked as not cleared');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmCleared = async (txId: string) => {
    try {
      await setCleared(workspaceId, [txId], { cleared: true, clearanceDate: clearOn });
      updateTransaction(txId, { isCleared: true, clearanceDate: clearOn } as Partial<Transaction>);
      setClearing(null);
      toast.success(`Cleared on ${clearOn}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div id="account-register-view" className="flex flex-col h-full bg-[var(--surface)] text-[var(--text)] overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border)] flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 bg-[var(--surface-sunken)]">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[var(--accent)]/10 text-[var(--accent)] rounded-lg">
            <BookOpen aria-hidden="true" className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Account Register</h1>
            <p className="text-xs text-[var(--text-muted)]">Checkbook-style running ledger with transactional clearance</p>
          </div>
        </div>

        {/* Account Selector & Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Building2 aria-hidden="true" className="w-4 h-4 text-[var(--text-muted)]" />
            <select aria-label="Register account"
              id="select-register-account"
              value={selectedAccount?.id || ''}
              onChange={e => setSelectedAccountId(e.target.value)}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            >
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>
                  {acc.code ? `${acc.code} — ` : ''}{acc.name} ({acc.type})
                </option>
              ))}
            </select>
          </div>

          <button
            id="btn-register-uncleared-toggle"
            onClick={() => setUnclearedOnly(prev => !prev)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 border transition",
              unclearedOnly 
                ? "bg-amber-500/15 text-amber-400 border-amber-500/30" 
                : "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)]"
            )}
          >
            <Filter aria-hidden="true" className="w-3.5 h-3.5" />
            <span>{unclearedOnly ? "Uncleared Only" : "All Entries"}</span>
          </button>
        </div>
      </div>

      {/* L-123: the balances are totals of every entry, the rows are the loaded entries */}
      <p className="px-4 pt-3 text-[11px] text-[var(--text-muted)]" data-testid="register-balances-source">
        {serverOpening
          ? `Balances include every entry through ${serverOpening.asOf} (summed by the server); the rows below are the loaded entries.`
          : 'Balances and rows: the loaded entries.'}
      </p>
      {/* Metric Cards Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="bg-[var(--surface-sunken)] p-3 rounded-lg border border-[var(--border)]">
          <span className="text-xs text-[var(--text-muted)] font-medium">Opening Balance</span>
          <p className="text-base font-semibold mt-0.5 tabular-nums">
            {formatCurrency(selectedAccount?.openingBalanceCents || 0)}
          </p>
        </div>
        <div className="bg-[var(--surface-sunken)] p-3 rounded-lg border border-[var(--border)]">
          <span className="text-xs text-[var(--text-muted)] font-medium">Period Activity</span>
          <p className={cn(
            "text-base font-semibold mt-0.5",
            (registerCalculation.endingBalanceMinor - (selectedAccount?.openingBalanceCents || 0)) >= 0 ? "text-emerald-400" : "text-rose-400"
          )}>
            {formatCurrency(registerCalculation.endingBalanceMinor - (selectedAccount?.openingBalanceCents || 0))}
          </p>
        </div>
        <div className="bg-[var(--surface-sunken)] p-3 rounded-lg border border-[var(--border)]">
          <span className="text-xs text-[var(--text-muted)] font-medium">Current Register Balance</span>
          <p className="text-base font-bold text-[var(--accent)] mt-0.5 tabular-nums">
            {formatCurrency(registerCalculation.endingBalanceMinor)}
          </p>
        </div>
        <div className="bg-[var(--surface-sunken)] p-3 rounded-lg border border-[var(--border)]">
          <span className="text-xs text-[var(--text-muted)] font-medium">Total Registered Rows</span>
          <p className="text-base font-semibold mt-0.5">
            {displayedEntries.length} rows
          </p>
        </div>
      </div>

      {/* Search Input */}
      <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-2 bg-[var(--surface-sunken)]">
        <Search aria-hidden="true" className="w-4 h-4 text-[var(--text-muted)]" />
        <input aria-label="Filter register by payee, reference, or description"
          id="input-register-search"
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Filter register by payee, reference, or description..."
          className="bg-transparent border-none text-sm w-full focus:outline-none placeholder:text-[var(--text-muted)]"
        />
      </div>

      {/* Checkbook Register Table */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-left border-collapse text-xs sm:text-sm">
          <caption className="sr-only">Account Register</caption>
          <thead className="sticky top-0 bg-[var(--surface-sunken)] border-b border-[var(--border)] text-[var(--text-muted)] uppercase tracking-wider font-semibold text-[11px] z-10">
            <tr>
              <th scope="col" className="py-2.5 px-3 w-10 text-center">Clr</th>
              <th scope="col" className="py-2.5 px-3 w-28">Date</th>
              <th scope="col" className="py-2.5 px-3 w-24">Ref / Chk</th>
              <th scope="col" className="py-2.5 px-3 w-40">Payee</th>
              <th scope="col" className="py-2.5 px-3">Description / Memo</th>
              <th scope="col" className="py-2.5 px-3 text-right w-28">Increase (Dr)</th>
              <th scope="col" className="py-2.5 px-3 text-right w-28">Decrease (Cr)</th>
              <th scope="col" className="py-2.5 px-3 text-right w-32">Running Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {displayedEntries.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-[var(--text-muted)]">
                  No register entries found for this account.
                </td>
              </tr>
            ) : (
              paged.visible.map(entry => (
                <React.Fragment key={entry.id}>
                <tr
                  className={cn(
                    "hover:bg-[var(--surface-sunken)]/60 transition-colors",
                    entry.isCleared && "bg-emerald-500/[0.02]"
                  )}
                >
                  <td className="py-2.5 px-3 text-center">
                    <button aria-label={entry.isCleared ? "Mark transaction as uncleared" : "Mark transaction as cleared"}
                      onClick={() => void handleToggleCleared(entry.txId, entry.isCleared)}
                      disabled={!canClear}
                      title={entry.isCleared ? `Cleared${entry.clearanceDate ? ` on ${entry.clearanceDate}` : ''}${canClear ? ' (click to unmark)' : ''}` : canClear ? 'Not cleared (click to mark cleared)' : 'Not cleared'}
                      className="text-[var(--text-muted)] hover:text-emerald-400 transition disabled:cursor-default"
                    >
                      {entry.isCleared ? (
                        <CheckCircle2 aria-hidden="true" className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Circle aria-hidden="true" className="w-4 h-4 opacity-40 hover:opacity-100" />
                      )}
                    </button>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-xs">
                    {entry.date}
                    {entry.isCleared && entry.clearanceDate && <div className="text-[10px] text-emerald-600">cleared {entry.clearanceDate}</div>}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-xs text-[var(--text-muted)] truncate max-w-[96px]">
                    {entry.reference || '—'}
                  </td>
                  <td className="py-2.5 px-3 truncate max-w-[160px] font-medium">
                    {entry.payee || '—'}
                  </td>
                  <td className="py-2.5 px-3 truncate max-w-[280px] text-[var(--text-muted)]">
                    {entry.description}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-emerald-400 font-medium tabular-nums">
                    {entry.debitMinor > 0 ? formatDecimal(entry.debitMinor) : ''}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-rose-400 font-medium tabular-nums">
                    {entry.creditMinor > 0 ? formatDecimal(entry.creditMinor) : ''}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">
                    {formatDecimal(entry.runningBalanceMinor)}
                  </td>
                </tr>
                {clearing === entry.txId && (
                  <tr>
                    <td colSpan={8} className="py-2 px-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="flex items-center gap-1.5">Cleared the bank on
                          <input type="date" value={clearOn} min={String(entry.date).slice(0, 10)} onChange={e => setClearOn(e.target.value)}
                            className="px-2 py-1 border border-[var(--border)] rounded bg-[var(--surface)]" />
                        </label>
                        <button type="button" disabled={!clearOn || clearOn < String(entry.date).slice(0, 10)} onClick={() => void confirmCleared(entry.txId)}
                          className="px-2 py-1 rounded bg-emerald-600 text-white font-semibold disabled:opacity-50">Mark cleared</button>
                        <button type="button" onClick={() => setClearing(null)} className="text-[var(--text-muted)] hover:underline">Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
        <ShowMoreRows shown={paged.visible.length} total={paged.total} noun="lines" onMore={paged.more} onAll={paged.all} />
      </div>
    </div>
  );
};

export default AccountRegisterView;
