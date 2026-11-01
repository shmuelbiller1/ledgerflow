import { Transaction, ChartAccount, TransactionLine } from '../types';
import { isPostable, isCashAccount, lineAmount } from './txFilters';

export interface TransferParams {
  workspaceId: string;
  uid: string;
  fromAccountId: string;
  fromAccountName: string;
  toAccountId: string;
  toAccountName: string;
  amountCents: number;
  date: string;
  description?: string;
  exchangeRate?: number;
}

/**
 * Creates a double-entry inter-account transfer transaction.
 * Marked with isTransfer: true so P&L and Cash Flow operating metrics exclude it.
 */
export function createAccountTransfer(params: TransferParams): Partial<Transaction> {
  const {
    workspaceId,
    uid,
    fromAccountId,
    fromAccountName,
    toAccountId,
    toAccountName,
    amountCents,
    date,
    description,
    exchangeRate = 1
  } = params;

  const desc = description || `Transfer: ${fromAccountName} → ${toAccountName}`;

  const lines: TransactionLine[] = [
    {
      accountId: fromAccountId,
      accountName: fromAccountName,
      amountCents: -Math.abs(amountCents), // Credit from account (outflow)
      exchangeRate,
      isTransfer: true,
      description: `Transfer out to ${toAccountName}`
    },
    {
      accountId: toAccountId,
      accountName: toAccountName,
      amountCents: Math.abs(amountCents), // Debit to account (inflow)
      exchangeRate,
      isTransfer: true,
      description: `Transfer in from ${fromAccountName}`
    }
  ];

  return {
    workspaceId,
    uid,
    date,
    description: desc,
    totalAmountCents: Math.abs(amountCents),
    currency: 'USD',
    exchangeRate,
    isTransfer: true,
    transferDetails: {
      fromAccountId,
      toAccountId
    },
    lines,
    status: 'completed',
    type: 'journal',
    createdAt: new Date().toISOString()
  };
}

export interface TransferMatchCandidate {
  outflowTx: Transaction;
  inflowTx: Transaction;
  fromAccount: ChartAccount;
  toAccount: ChartAccount;
  amountCents: number;
  dateDiffDays: number;
  confidence: number;
}

/**
 * Automatically scans recent transactions to detect matching pairs of opposite transfers
 * across owned cash/bank accounts.
 */
export function detectPotentialTransfers(
  transactions: Transaction[],
  accounts: ChartAccount[],
  windowDays = 3
): TransferMatchCandidate[] {
  const cashAccounts = new Map<string, ChartAccount>();
  accounts.filter(isCashAccount).forEach(a => cashAccounts.set(a.id, a));

  const postables = transactions.filter(t => isPostable(t) && !t.isTransfer);
  const candidates: TransferMatchCandidate[] = [];
  const pairedIds = new Set<string>();

  for (let i = 0; i < postables.length; i++) {
    const txA = postables[i];
    if (pairedIds.has(txA.id)) continue;

    const dateA = new Date(txA.date).getTime();
    if (Number.isNaN(dateA)) continue;

    for (let j = i + 1; j < postables.length; j++) {
      const txB = postables[j];
      if (pairedIds.has(txB.id)) continue;

      const dateB = new Date(txB.date).getTime();
      if (Number.isNaN(dateB)) continue;

      const daysDiff = Math.abs(dateA - dateB) / (1000 * 60 * 60 * 24);
      if (daysDiff > windowDays) continue;

      // Check amounts
      const amountA = txA.totalAmountCents || 0;
      const amountB = txB.totalAmountCents || 0;

      if (Math.abs(amountA - amountB) < 5) {
        // Find cash accounts on both sides
        const linesA = txA.lines || [];
        const linesB = txB.lines || [];

        const cashLineA = linesA.find(l => cashAccounts.has(l.accountId));
        const cashLineB = linesB.find(l => cashAccounts.has(l.accountId));

        if (cashLineA && cashLineB && cashLineA.accountId !== cashLineB.accountId) {
          const valA = lineAmount(cashLineA, txA);
          const valB = lineAmount(cashLineB, txB);

          // One should be negative (credit), one positive (debit)
          if ((valA < 0 && valB > 0) || (valA > 0 && valB < 0)) {
            const outflow = valA < 0 ? txA : txB;
            const inflow = valA < 0 ? txB : txA;
            const outflowLine = valA < 0 ? cashLineA : cashLineB;
            const inflowLine = valA < 0 ? cashLineB : cashLineA;

            const fromAcc = cashAccounts.get(outflowLine.accountId)!;
            const toAcc = cashAccounts.get(inflowLine.accountId)!;

            let confidence = 0.85;
            if (daysDiff === 0) confidence += 0.1;
            if (txA.description.toLowerCase().includes('transfer') || txB.description.toLowerCase().includes('transfer')) {
              confidence += 0.05;
            }

            candidates.push({
              outflowTx: outflow,
              inflowTx: inflow,
              fromAccount: fromAcc,
              toAccount: toAcc,
              amountCents: Math.abs(amountA),
              dateDiffDays: Math.round(daysDiff),
              confidence: Math.min(1.0, confidence)
            });

            pairedIds.add(txA.id);
            pairedIds.add(txB.id);
            break;
          }
        }
      }
    }
  }

  return candidates;
}
