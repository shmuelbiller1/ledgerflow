import React, { useState, useMemo } from 'react';
import { MessageSquare, CheckCircle2, Building2, User, Tag } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';
import { inBackground } from '../../lib/inBackground';

export default function AskLoop() {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const { handleUpdateTransaction } = useTransactionActions();
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, string>>({});

  // Find real transactions that need clarification/action:
  // 1. uncategorized/unassigned account
  // 2. pending or draft status
  // 3. flagged for review
  const pendingTransactions = useMemo(() => {
    return transactions.filter(t => {
      const isPending = t.status === 'pending' || t.status === 'draft' || t.status === 'flagged';
      const isUncategorized = !t.lines || t.lines.length === 0 || t.lines.some(l => 
        !l.accountId || 
        l.accountId === 'uncategorized' || 
        l.accountId === 'unassigned' ||
        l.accountName?.toLowerCase().includes('uncategorized') ||
        l.category === 'Uncategorized'
      );
      return isPending || isUncategorized;
    });
  }, [transactions]);

  // Find default expense and owner draw accounts from the real chart of accounts
  const defaultExpenseAccount = useMemo(() => {
    return accounts.find(a => a.type === 'expense') || accounts[0];
  }, [accounts]);

  const ownerDrawAccount = useMemo(() => {
    return accounts.find(a => 
      a.type === 'equity' || 
      a.name.toLowerCase().includes('draw') || 
      a.name.toLowerCase().includes('distribution') ||
      a.name.toLowerCase().includes('owner')
    ) || accounts.find(a => a.type === 'equity') || accounts[0];
  }, [accounts]);

  const handleResolve = async (txId: string, accountId: string, accountName: string, note?: string) => {
    const tx = transactions.find(t => t.id === txId);
    if (!tx || !accountId) return;

    let updatedLines = tx.lines && tx.lines.length > 0 ? tx.lines.map(l => ({ ...l })) : [];
    if (updatedLines.length === 0) {
      const cashAcc = accounts.find(a => a.code === '1010' || a.category === 'Cash' || a.category === 'cash_and_equivalents' || a.type === 'asset') || accounts[0];
      const amt = tx.totalAmountCents || 0;
      updatedLines = [
        { accountId, accountName, amountCents: amt, description: note || tx.description },
        { accountId: cashAcc?.id || accountId, accountName: cashAcc?.name || 'Main Checking', amountCents: -amt }
      ];
    } else {
      // Find the uncategorized line or positive expense line
      const catLineIdx = updatedLines.findIndex(l => !l.accountId || l.accountId === 'uncategorized' || l.accountId === 'unassigned' || l.amountCents > 0);
      const targetIdx = catLineIdx !== -1 ? catLineIdx : 0;
      updatedLines[targetIdx] = {
        ...updatedLines[targetIdx],
        accountId,
        accountName,
        description: note || updatedLines[targetIdx].description || tx.description
      };
    }

    try {
      await handleUpdateTransaction(txId, {
        lines: updatedLines,
        status: 'reviewed',
        verification: {
          status: 'verified',
          verifiedAt: new Date().toISOString(),
          method: 'manual',
          hash: tx.verification?.hash || 'user-clarified',
          timestamp: new Date().toISOString()
        }
      });
      toast.success(`Categorized "${tx.description}" as ${accountName}`);
    } catch (err) {
      toast.error(`Failed to update transaction: ${(err as Error)?.message || 'Double-entry integrity check failed'}`);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Accountant Ask</h1>
        <p className="text-[var(--muted)] text-sm mt-1">
          Review and clarify uncategorized or pending transactions in your General Ledger.
        </p>
      </div>

      <div className="space-y-4 tabular-nums">
        {pendingTransactions.length === 0 ? (
          <div className="bg-[var(--ink)] border border-[var(--line)]/80 rounded-2xl p-12 flex flex-col items-center justify-center text-center">
            <div className="w-14 h-14 bg-emerald-100/80 rounded-2xl flex items-center justify-center mb-4">
              <CheckCircle2 aria-hidden="true" className="h-8 w-8 text-emerald-600" />
            </div>
            <h2 className="font-bold text-[var(--text)] text-lg mb-1">Inbox Zero — All Caught Up!</h2>
            <p className="text-[var(--muted)] text-sm max-w-md">
              All transactions in your General Ledger are fully categorized and verified. No pending questions.
            </p>
          </div>
        ) : (
          pendingTransactions.map(tx => {
            const formattedAmt = formatCurrency(tx.totalAmountCents);
            const questionText = `Was this ${formattedAmt} payment to "${tx.description}" a business expense or personal draw?`;

            return (
              <div 
                key={tx.id} 
                className="bg-[var(--surface)] rounded-2xl shadow-sm border border-[var(--line)]/90 border-l-4 border-l-amber-500 overflow-hidden transition-all hover:shadow-md"
              >
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h2 className="font-bold text-lg text-[var(--text)]">{tx.description || 'Unlabeled Transaction'}</h2>
                      <p className="text-xs font-semibold text-[var(--muted)] mt-0.5">
                        {tx.date} • <span className="font-mono text-[var(--text)] font-bold">{formattedAmt}</span>
                      </p>
                    </div>
                    <div className="bg-amber-100/80 text-amber-800 text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5">
                      <MessageSquare aria-hidden="true" className="w-3.5 h-3.5" /> Needs Action
                    </div>
                  </div>
                  
                  <div className="bg-[var(--ink)] border border-[var(--line)] p-4 rounded-xl mb-6">
                    <p className="text-[var(--text)] font-medium text-sm sm:text-base">"{questionText}"</p>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <button 
                        onClick={() => handleResolve(tx.id, defaultExpenseAccount.id, defaultExpenseAccount.name, 'Business Expense')} 
                        className="flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/80 transition-colors shadow-sm"
                      >
                        <Building2 aria-hidden="true" className="w-4 h-4 mr-2" /> Business Expense
                      </button>

                      <button 
                        onClick={() => handleResolve(tx.id, ownerDrawAccount.id, ownerDrawAccount.name, 'Personal Draw')} 
                        className="flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center bg-slate-100 text-slate-700 hover:bg-slate-200 border border-[var(--line)] transition-colors shadow-sm"
                      >
                        <User aria-hidden="true" className="w-4 h-4 mr-2" /> Personal (Owner Draw)
                      </button>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Tag aria-hidden="true" className="w-3.5 h-3.5 text-[var(--muted)]" />
                      <span className="text-xs font-semibold text-[var(--muted)]">Or assign account:</span>
                      <div className="relative flex-1">
                        <select aria-label="Assign account"
                          className="w-full bg-[var(--ink)] border border-[var(--line)] rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-600 focus:bg-[var(--surface)]"
                          value={selectedAccounts[tx.id] || ''}
                          onChange={(e) => {
                            const accId = e.target.value;
                            if (!accId) return;
                            const acc = accounts.find(a => a.id === accId);
                            if (acc) {
                              setSelectedAccounts({ ...selectedAccounts, [tx.id]: accId });
                              inBackground(handleResolve(tx.id, acc.id, acc.name));
                            }
                          }}
                        >
                          <option value="">Select custom Chart of Account...</option>
                          {accounts.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.code ? `${a.code} - ${a.name}` : a.name} ({a.type})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
