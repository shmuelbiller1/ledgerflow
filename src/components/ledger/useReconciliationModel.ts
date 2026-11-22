import { errorMessage } from '../../lib/errorRemedies';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useState, useMemo, useEffect } from 'react';

import { parseLocalDate } from '../../lib/utils';
import { useTimeout } from '../../hooks/useTimeout';
import { resolveAccountRole } from '../../lib/accountUtils';

import { jaroWinklerSimilarity, findGlobalOptimalMatch } from '../../lib/algorithms';
import { toast } from 'sonner';
import { isPostable, lineAmount } from '../../lib/txFilters';
import { cashLegForBankLine, cashLegFromLegs, cashLegsOf, type CashLegs } from '../../lib/reconciliationSuggestions';

import type { BankLineActionTarget } from './BankLineActionDialog';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';

export function useReconciliationModel() {
  const user = useAuthStore(s => s.user);
  useAuthStore(s => s.currentWorkspaceId);
  const transactions = useLedgerStore(s => s.transactions);
  const bankLines = useLedgerStore(s => s.bankLines || []);
  const accounts = useLedgerStore(s => s.accounts);
  useLedgerCollections('bankLines');
  const txActions = useTransactionActions();
  const onMatch = txActions.handleReconcileMatch;
  const onIgnore = txActions.handleReconcileIgnore;
  const onAddFromBank = txActions.handleReconcileCreate;
  const onAutoReconcile = txActions.handleAutoReconcile;
  const onUndoMatch = txActions.handleReconcileUndo;
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [selectedLedgerId, setSelectedLedgerId] = useState<string | null>(null);
  const [showAutoConfirm, setShowAutoConfirm] = useState(false);
  const [matchToleranceCents] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutoReconciling, setIsAutoReconciling] = useState(false);

  // Tab view: pending matching streams vs synchronized matched history logs
  const [viewMode, setViewMode] = useState<'pending' | 'history'>('pending');

  // Custom filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [bankLineAction, setBankLineAction] = useState<BankLineActionTarget | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');

  // Granular checkable state for the smart auto-alignment bulk modal
  const [selectedBatchIds, setSelectedBatchIds] = useState<Record<string, boolean>>({});
  const { setSafeTimeout } = useTimeout();

  const safeBankLines = useMemo(() => Array.isArray(bankLines) ? bankLines : [], [bankLines]);
  const safeTransactions = useMemo(() => Array.isArray(transactions) ? transactions : [], [transactions]);
  const safeAccounts = useMemo(() => Array.isArray(accounts) ? accounts : [], [accounts]);

  const cashAccounts = useMemo(() => safeAccounts.filter(a => resolveAccountRole(a) === 'cash'), [safeAccounts]);
  const cashAccountIds = useMemo(() => new Set(cashAccounts.map(a => a.id)), [cashAccounts]);

  // Active pending statement lines
  const unmatchedBankLines = useMemo(() => {
    return safeBankLines.filter(line => line.status === 'pending' && (selectedAccountId === 'all' || !line.accountId || line.accountId === selectedAccountId));
  }, [safeBankLines, selectedAccountId]);

  // Synchronized matched statement lines (History)
  const matchedBankLines = useMemo(() => {
    return safeBankLines.filter(line => line.status === 'matched' && (selectedAccountId === 'all' || !line.accountId || line.accountId === selectedAccountId));
  }, [safeBankLines, selectedAccountId]);

  // Share of in-scope statement lines already matched. Numerator and denominator use the same
  // account-scoped population; ignored lines are excluded so they cannot count as reconciled.
  const reconciledPercent = useMemo(() => {
    const matched = matchedBankLines.length;
    const total = matched + unmatchedBankLines.length;
    return total === 0 ? 0 : Math.round((matched / total) * 100);
  }, [matchedBankLines, unmatchedBankLines]);

  // Uncleared internal ledger transactions (excluding void and reconciled)
  const unclearedLedgerTransactions = useMemo(() => {
    return safeTransactions.filter(tx => {
      if (!isPostable(tx) || tx.status === 'reconciled') return false;
      if (selectedAccountId !== 'all') {
        const touchesAccount = tx.lines?.some((l) => l.accountId === selectedAccountId);
        if (!touchesAccount) return false;
      }
      return true;
    });
  }, [safeTransactions, selectedAccountId]);

  // AI/Heuristic dynamic suggestion index maps.
  // #891 (A10-H1-01): a suggested pair is a *cash* movement. The candidate amount is the entry's own
  // leg in the bank line's account (or, in the all-accounts view, its net movement across cash
  // accounts) — never the journal header total. An entry with no cash leg (a bill accrual, a journal
  // that only moves A/P and expense) cannot have produced a bank movement, so it is not a candidate,
  // and the direction must match the statement line (a deposit is not a withdrawal).
  const aiSuggestionsMap = useMemo(() => {
    if (unmatchedBankLines.length === 0 || unclearedLedgerTransactions.length === 0) return [];

    interface PreparedLedgerEntry {
      ltx: (typeof unclearedLedgerTransactions)[number];
      legs: CashLegs;
      dateMs: number;
    }
    // Same amount, same cash account -> same candidate. Indexed so a bank line only looks at its own
    // bucket instead of every entry (Gitar: the first version re-summed each entry per bank line).
    const byAccountAbs = new Map<string, Map<number, PreparedLedgerEntry[]>>();
    const byNetAbs = new Map<number, PreparedLedgerEntry[]>();

    for (const ltx of unclearedLedgerTransactions) {
      // An entry that touches no recognised cash account cannot have produced a bank movement.
      if (!(ltx.lines || []).some(l => cashAccountIds.has(l.accountId))) continue;
      const legs = cashLegsOf(ltx, cashAccountIds, l => lineAmount(l as Parameters<typeof lineAmount>[0], ltx));
      const prepared: PreparedLedgerEntry = { ltx, legs, dateMs: parseLocalDate(ltx.date).getTime() };
      legs.byAccount.forEach((leg, accountId) => {
        if (leg === 0) return;
        const bucket = byAccountAbs.get(accountId) || new Map<number, PreparedLedgerEntry[]>();
        const key = Math.abs(leg);
        const list = bucket.get(key) || [];
        list.push(prepared);
        bucket.set(key, list);
        byAccountAbs.set(accountId, bucket);
      });
      if (legs.net !== 0) {
        const key = Math.abs(legs.net);
        const list = byNetAbs.get(key) || [];
        list.push(prepared);
        byNetAbs.set(key, list);
      }
    }

    const sourceItems = unmatchedBankLines.map(btx => {
      const scoreMap = new Map<string, number>();
      const bAbsAmount = Math.abs(btx.amountCents);
      const bDateMs = parseLocalDate(btx.date).getTime();
      // #891: a candidate is a cash movement in this bank line's direction — its own account's leg,
      // or the entry's net cash in the all-accounts view. An entry with no cash leg is not offered.
      // At exact tolerance only the matching bucket can qualify; a tolerance widens it to the legs
      // already converted, so no line is ever converted inside this loop.
      // An unavailable named account has no bucket; only an unassigned line may use net cash.
      const indexed = btx.accountId ? byAccountAbs.get(btx.accountId) : byNetAbs;
      const pool: PreparedLedgerEntry[] = [];
      if (matchToleranceCents === 0) {
        pool.push(...(indexed?.get(bAbsAmount) || []));
      } else {
        indexed?.forEach((entries, absAmount) => {
          if (Math.abs(absAmount - bAbsAmount) <= matchToleranceCents) pool.push(...entries);
        });
      }

      for (const entry of pool) {
        const legCents = cashLegFromLegs(entry.legs, btx);
        if (legCents === null) continue;
        const absAmount = Math.abs(legCents);
        if (Math.abs(absAmount - bAbsAmount) > matchToleranceCents) continue;

        const { ltx, dateMs: lDateMs } = entry;
        let score = 0;

        // Exact Amount Match (High Weight)
        if (absAmount === bAbsAmount) {
          score += 100;
        } else {
          score += 30; // Near match / tiny difference, inside matchToleranceCents
        }

        // Description Similarity (Jaro-Winkler)
        const descSimilarity = jaroWinklerSimilarity(btx.description, ltx.description, user?.uid);
        score += descSimilarity * 65;

        // Date Proximity
        let dDiff = 99;
        if (!Number.isNaN(bDateMs) && !Number.isNaN(lDateMs)) {
          dDiff = Math.abs(bDateMs - lDateMs) / (1000 * 60 * 60 * 24);
          if (dDiff === 0) score += 30;
          else if (dDiff <= 3) score += 18;
          else if (dDiff <= 7) score += 8;
        }

        // Require similarity > 0.3 or dateDiff <= 2 to prevent pure amount-only false positives
        if (score > 115 && (descSimilarity >= 0.3 || dDiff <= 2)) {
          scoreMap.set(ltx.id, score);
        }
      }

      return { id: btx.id, scoreMap };
    });

    return sourceItems;
  }, [unmatchedBankLines, unclearedLedgerTransactions, user?.uid, matchToleranceCents, cashAccountIds]);

  const optimizedMatches = useMemo(() => {
     if (!aiSuggestionsMap || !Array.isArray(aiSuggestionsMap)) return new Map();

     const relevantTargets = new Set<string>();
     aiSuggestionsMap.forEach(item => {
        for (const key of item.scoreMap.keys()) relevantTargets.add(key);
     });

     return findGlobalOptimalMatch(aiSuggestionsMap, Array.from(relevantTargets));
  }, [aiSuggestionsMap]);

  // Initialize checkboxes for smart bulk matching modal when it opens
  useEffect(() => {
    if (showAutoConfirm) {
      const state: Record<string, boolean> = {};
      unmatchedBankLines.forEach(btx => {
        if (optimizedMatches.get(btx.id)) {
          state[btx.id] = true;
        }
      });
      setSafeTimeout(() => setSelectedBatchIds(state), 0);
    }
  }, [showAutoConfirm, unmatchedBankLines, optimizedMatches, setSafeTimeout]);

  // Execute confirmation for selected batch elements
  const executeSelectedBatchMatches = async () => {
    setIsProcessing(true);
    let matchedCount = 0;

    // Filter only those selected by checkboxes
    const pairsToMatch = unmatchedBankLines.map(btx => {
        const ltxId = optimizedMatches.get(btx.id);
        const isChecked = selectedBatchIds[btx.id];
        return { bankId: btx.id, ledgerId: ltxId, isChecked };
    }).filter(p => p.ledgerId && p.isChecked);

    if (pairsToMatch.length === 0) {
        toast.info("No matches selected.");
        setIsProcessing(false);
        return;
    }

    try {
        for (const pair of pairsToMatch) {
           await onMatch(pair.bankId, pair.ledgerId!);
           matchedCount++;
        }
        toast.success(`${matchedCount} match${matchedCount === 1 ? "" : "es"} applied.`);
        setShowAutoConfirm(false);
    } catch (err) {
        toast.error("Could not apply the matches.", {
          description: `Please try again. (${errorMessage(err) || 'Network error'})`
        });
    } finally {
        setIsProcessing(false);
    }
  };

  const handleAutoReconcile = async () => {
    setIsAutoReconciling(true);
    try {
       // The action layer reports its own completion toasts (with the applied count, or no-match).
       await onAutoReconcile({ bankLines: unmatchedBankLines, transactions: unclearedLedgerTransactions });
    } catch (e) {
        toast.error("Could not finish automatic matching.", {
          description: `Please try again. (${errorMessage(e) || 'Network error'})`
        });
    } finally {
       setIsAutoReconciling(false);
    }
  };

  // Revert / Undo a confirmed reconciliation link
  const handleUndoAlignment = async (bankLineId: string, matchedTxId?: string) => {
    if (!onUndoMatch) {
      toast.error("Undoing matches is not available in this workspace.");
      return;
    }

    setIsProcessing(true);
    try {
      await onUndoMatch(bankLineId, matchedTxId);
    } catch (e) {
      toast.error("Could not undo the match: " + errorMessage(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const selectedBankLine = useMemo(() => {
    if (viewMode === 'pending') {
      return unmatchedBankLines.find(b => b.id === selectedBankId);
    } else {
      return matchedBankLines.find(b => b.id === selectedBankId);
    }
  }, [unmatchedBankLines, matchedBankLines, selectedBankId, viewMode]);

  const selectedLedgerTx = useMemo(() => {
    if (viewMode === 'pending') {
      return unclearedLedgerTransactions.find(l => l.id === selectedLedgerId);
    } else {
      const matchTxId = selectedBankLine?.matchedTransactionId;
      return safeTransactions.find(tx => tx.id === matchTxId);
    }
  }, [unclearedLedgerTransactions, safeTransactions, selectedLedgerId, selectedBankLine, viewMode]);

  // DUAL-VERIFIER ALIGNMENT MATRIX METRICS
  const checkSimilarity = useMemo(() => {
    if (!selectedBankLine || !selectedLedgerTx) {
      return {
        textScore: 0,
        dateDiff: 0,
        amountDiff: 0,
        hasMatchingCashLeg: false,
        ledgerCashCents: null as number | null,
        overall: 0,
      };
    }

    // Description similarity
    const textScore = Math.round(jaroWinklerSimilarity(selectedBankLine.description, selectedLedgerTx.description, user?.uid) * 100);

    // Date Difference
    const bDate = parseLocalDate(selectedBankLine.date).getTime();
    const lDate = parseLocalDate(selectedLedgerTx.date).getTime();
    let dateDiff = 99;
    if (!Number.isNaN(bDate) && !Number.isNaN(lDate)) {
      dateDiff = Math.abs(bDate - lDate) / (1000 * 60 * 60 * 24);
    }

    // #891: compare the statement line against the entry's cash movement in this bank account
    // (or net cash in all-accounts view), never the journal header total.
    const ledgerCashCents = cashLegForBankLine(
      selectedLedgerTx,
      cashAccountIds,
      selectedBankLine,
      l => lineAmount(l as Parameters<typeof lineAmount>[0], selectedLedgerTx),
    );
    if (ledgerCashCents === null) {
      const cappedOverall = Math.min(40, Math.round(Math.max(0, 30 - (dateDiff * 8)) + (textScore * 0.1)));
      return {
        textScore,
        dateDiff,
        amountDiff: Math.abs(selectedBankLine.amountCents),
        hasMatchingCashLeg: false,
        ledgerCashCents: null,
        overall: cappedOverall,
      };
    }

    const amountDiff = Math.abs(selectedBankLine.amountCents) - Math.abs(ledgerCashCents);

    // Compute heuristic overall probability
    let overall = 0;
    if (amountDiff === 0) overall += 50;
    else if (Math.abs(amountDiff) < 100) overall += 25; // negligible difference

    overall += Math.max(0, 40 - (dateDiff * 8)); // Date penalty
    overall += (textScore * 0.1); // text likeness

    return {
      textScore,
      dateDiff,
      amountDiff,
      hasMatchingCashLeg: true,
      ledgerCashCents,
      overall: Math.min(100, Math.round(overall))
    };
  }, [selectedBankLine, selectedLedgerTx, user?.uid, cashAccountIds]);

  // Filter pending feeds
  const filteredBankFeed = useMemo(() => {
    const list = viewMode === 'pending' ? unmatchedBankLines : matchedBankLines;
    if (!searchQuery) return list;
    return list.filter(b =>
      b.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.amountCents.toString().includes(searchQuery)
    );
  }, [unmatchedBankLines, matchedBankLines, searchQuery, viewMode]);

  const filteredLedgerEntries = useMemo(() => {
    if (!searchQuery) return unclearedLedgerTransactions;
    return unclearedLedgerTransactions.filter(l =>
      l.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.totalAmountCents.toString().includes(searchQuery)
    );
  }, [unclearedLedgerTransactions, searchQuery]);

  return { bankLines, accounts, onMatch, onIgnore, onAddFromBank, selectedBankId, setSelectedBankId, selectedLedgerId, setSelectedLedgerId, showAutoConfirm, setShowAutoConfirm, isProcessing, isAutoReconciling, viewMode, setViewMode, searchQuery, setSearchQuery, bankLineAction, setBankLineAction, selectedAccountId, setSelectedAccountId, selectedBatchIds, setSelectedBatchIds, safeTransactions, cashAccounts, cashAccountIds, unmatchedBankLines, matchedBankLines, reconciledPercent, unclearedLedgerTransactions, optimizedMatches, executeSelectedBatchMatches, handleAutoReconcile, handleUndoAlignment, selectedBankLine, selectedLedgerTx, checkSimilarity, filteredBankFeed, filteredLedgerEntries };
}
