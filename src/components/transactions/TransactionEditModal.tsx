import { useDialog } from '../../hooks/useDialog';
import { useState, useEffect, useRef, useId } from 'react';
import { Transaction, TransactionLine, ChartAccount } from '../../types';

import { toast } from 'sonner';
import { getLocalDateISO } from '../../lib/utils';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { DEFAULT_WORKSPACE_DIMENSIONS } from '../../lib/dimensionUtils';
import { normalizeDimensionsMap, resolveWorkspaceProjectId } from '../../lib/dimensionNodeActions';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import { isLockedDate } from '../../lib/periodLock';
import { TransactionEditModalView } from './TransactionEditModalView';

/** Assigns deterministic React keys to repeated transaction lines even when lines lack explicit IDs. */
function withOccurrenceKeys<T>(items: readonly T[], identity: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map(item => {
    const content = identity(item);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { item, key: JSON.stringify([content, occurrence]) };
  });
}

interface TransactionEditModalProps {
  isOpen: boolean;
  transaction: Transaction;
  accounts: ChartAccount[];
  lockDate?: string | null;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<Transaction>) => void;
  isReverseAndCorrectMode?: boolean;
  onReverseAndCorrect?: (id: string, reversalDate: string, reason: string, replacement?: Partial<Transaction>) => Promise<unknown>;
}

/** Builds form state, stable line keys, and save handlers for editing or reversing a ledger transaction. */
function useTransactionEditModalModel({
  isOpen,
  transaction,
  accounts,
  lockDate,
  onClose,
  onUpdate,
  isReverseAndCorrectMode: initialReverseMode = false,
  onReverseAndCorrect
}: TransactionEditModalProps) {
  const formId = useId();
  const baseCurrency = useLedgerStore(s => s.baseCurrency) || 'USD';
  const dimensionNodes = useLedgerStore(s => s.dimensionNodes);
  const todayISO = getLocalDateISO();
  const [isReverseMode, setIsReverseMode] = useState(initialReverseMode);
  const [reversalDate, setReversalDate] = useState(() => todayISO);
  const [correctionReason, setCorrectionReason] = useState(() => `Correction for ${transaction?.description || 'transaction'}`);

  // In reverse mode on a locked transaction, suggest an open date (today) for the replacement
  const initialTxDate = transaction?.date || '';
  const lockException = useLedgerStore(s => s.lockException);
  const closed = (d: string) => !!d && isLockedDate(d, lockDate, lockException);
  const isOriginalLocked = closed(initialTxDate);
  const [date, setDate] = useState(() => {
    if (initialReverseMode && isOriginalLocked) {
      return todayISO > (lockDate || '') ? todayISO : initialTxDate;
    }
    return initialTxDate;
  });

  const [description, setDescription] = useState(() => transaction?.description || '');
  const [payee, setPayee] = useState(() => transaction?.payee || '');
  const [type, setType] = useState<Transaction['type']>(transaction.type || 'actual');
  const [status, setStatus] = useState<Transaction['status']>(transaction.status || 'completed');
  const [project, setProject] = useState(() => transaction?.project || '');
  const [isCleared, setIsCleared] = useState(() => transaction?.isCleared || false);
  const [isFlagged, setIsFlagged] = useState(() => transaction?.isFlagged || false);
  const [fileUrls, setFileUrls] = useState<string[]>(() => transaction?.fileUrls || []);
  const [originalCurrency, setOriginalCurrency] = useState(() => transaction?.originalCurrency || baseCurrency);
  const [exchangeRate, setExchangeRate] = useState<number>(() => transaction?.exchangeRate || 1.0);
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  useLedgerStore(s => s.classes);
  useLedgerStore(s => s.locations);
  useLedgerStore(s => s.projects);
  const transactions = useLedgerStore(s => s.transactions);
  const getCurrentWorkspace = useAuthStore(s => s.getCurrentWorkspace);
  const currentWorkspace = getCurrentWorkspace();
  const activeDimensions = currentWorkspace?.dimensions || DEFAULT_WORKSPACE_DIMENSIONS;
  
  // Manage lines for splitting and multiple assignments
  const [lines, setLines] = useState<TransactionLine[]>(() => transaction?.lines ? transaction.lines.map(l => ({ ...l })) : []);

  // UI-only keys are initialized once and survive changes to editable line fields.
  const [lineKeys, setLineKeys] = useState(() => withOccurrenceKeys(lines, line =>
    line.id || JSON.stringify([line.accountId, line.description, line.amountCents, line.project, line.class, line.location])
  ).map(({ key }) => `existing-${key}`));
  const nextLineKey = useRef(0);

  const isLocked = !isReverseMode && closed(date);

  // Compute total absolute sum (or sum of debits/credits in standard book)
  // Our types.ts says line.amountCents: Positive for Debit, Negative for Credit
  const totalAmountCents = Math.abs(lines.reduce((sum, l) => sum + l.amountCents, 0));
  
  // Let's compute if the line items sum up correctly
  const sumLines = lines.reduce((sum, l) => sum + l.amountCents, 0);

  const handleAddLine = () => {
    const defaultAcc = accounts.find(a => a.type === 'expense') || accounts[0];
    setLines([...lines, { 
      accountId: defaultAcc?.id || '', 
      accountName: defaultAcc?.name || '', 
      amountCents: 0 
    }]);
    const key = `added-${nextLineKey.current++}`;
    setLineKeys(keys => [...keys, key]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length <= 1) {
      toast.error('At least one double-entry split ledger line is required for absolute integrity.');
      return;
    }
    setLines(lines.filter((_, i) => i !== index));
    setLineKeys(keys => keys.filter((_, i) => i !== index));
  };

  const lineKeysRef = useRef(lineKeys);
  useEffect(() => {
    lineKeysRef.current = lineKeys;
  }, [lineKeys]);

  /** Updates a single transaction line functionally using its stable row key so async callbacks keep intervening edits. */
  const handleLineChange = (
    index: number,
    updates: Partial<TransactionLine> | ((current: TransactionLine) => Partial<TransactionLine>),
    lineKey?: string,
  ) => {
    setLines(prev => {
      const keyIdx = lineKey ? lineKeysRef.current.indexOf(lineKey) : -1;
      const targetIdx = keyIdx >= 0 ? keyIdx : index;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const current = prev[targetIdx];
      const patch = typeof updates === 'function' ? updates(current) : updates;
      const next = [...prev];
      next[targetIdx] = { ...current, ...patch };
      return next;
    });
  };

  /** Validates double-entry balance, normalizes dimension nodes, preserves workspace project IDs, and commits changes. */
  const handleSave = async () => {
    if (isLocked) {
      toast.error('Period is sealed. Changes are prohibited to protect general ledger integrity.');
      return;
    }

    if (!description.trim()) {
      toast.error('Description must be specified.');
      return;
    }

    // Check if any line has unassigned account
    const hasUnassigned = lines.some(l => !l.accountId || l.accountId === '' || l.accountId === 'uncategorized' || l.accountId === 'unassigned');
    if (hasUnassigned) {
      toast.error('All transaction ledger lines must be linked to a valid chart of account.');
      return;
    }

    // Perform rigid double-entry offset check to protect ledger consistency
    const balancedSum = lines.reduce((acc, l) => acc + (l.amountCents || 0), 0);
    if (balancedSum !== 0) {
      toast.error('Double-entry violation: Debits (positive) and Credits (negative) must sum to exactly zero.');
      return;
    }

    // In double-entry ledger bookkeeping, the gross transaction size is the total debit value (or absolute credit size)
    const calculatedTotal = Math.abs(TruthEngine.deriveSignedTotal(lines, accounts));

    const currentNodes = useLedgerStore.getState().dimensionNodes || [];
    const workspaceProjects = useLedgerStore.getState().projects || [];
    const finalLines = lines.map(l => {
      const acc = accounts.find(a => a.id === l.accountId);
      const normalizedDims = normalizeDimensionsMap(l.dimensions, currentNodes);
      const rawLineProject = l.project || project.trim() || undefined;
      const matchedLineProjectId =
        rawLineProject || normalizedDims?.project
          ? resolveWorkspaceProjectId([l.project, normalizedDims?.project, !l.project && !normalizedDims?.project ? project.trim() : undefined], workspaceProjects, currentNodes)
          : undefined;
      return {
        ...l,
        accountName: acc ? acc.name : l.accountName,
        project: matchedLineProjectId ?? rawLineProject,
        ...(normalizedDims !== l.dimensions ? { dimensions: normalizedDims } : {}),
      };
    });

    if (isReverseMode) {
      if (closed(reversalDate)) {
        toast.error(`Reversal date (${reversalDate}) must be in an open period (after ${lockDate}).`);
        return;
      }
      if (closed(date)) {
        toast.error(`Replacement date (${date}) must be in an open period (after ${lockDate}).`);
        return;
      }
      if (!onReverseAndCorrect) {
        toast.error('Reverse and correct operation is not available.');
        return;
      }

      await onReverseAndCorrect(transaction.id, reversalDate, correctionReason.trim(), {
        date,
        description: description.trim(),
        payee: payee.trim() || undefined,
        type,
        status,
        project: project.trim() || undefined,
        isCleared,
        isFlagged,
        fileUrls,
        originalCurrency: originalCurrency !== baseCurrency ? originalCurrency : undefined,
        exchangeRate: originalCurrency !== baseCurrency ? exchangeRate : undefined,
        lines: finalLines,
        totalAmountCents: calculatedTotal
      });
      onClose();
      return;
    }

    await onUpdate(transaction.id, {
      date,
      description: description.trim(),
      payee: payee.trim() || undefined,
      type,
      status,
      project: project.trim() || undefined,
      isCleared,
      isFlagged,
      fileUrls,
      originalCurrency: originalCurrency !== baseCurrency ? originalCurrency : undefined,
      exchangeRate: originalCurrency !== baseCurrency ? exchangeRate : undefined,
      lines: finalLines,
      totalAmountCents: calculatedTotal
    });

    toast.success('Ledger state synchronized with extreme precision');
    onClose();
  };

  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; });

  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        void handleSaveRef.current();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, onClose]);

  const { dialogProps, titleId } = useDialog(onClose, isOpen);
  if (!isOpen) return null;

  return { transaction, accounts, lockDate, onClose, onReverseAndCorrect, withOccurrenceKeys, formId, dimensionNodes, isReverseMode, setIsReverseMode, reversalDate, setReversalDate, correctionReason, setCorrectionReason, date, setDate, description, setDescription, payee, setPayee, type, setType, status, setStatus, project, setProject, isCleared, setIsCleared, isFlagged, setIsFlagged, fileUrls, setFileUrls, originalCurrency, setOriginalCurrency, exchangeRate, setExchangeRate, isFetchingRate, setIsFetchingRate, transactions, activeDimensions, lines, lineKeys, isLocked, totalAmountCents, sumLines, handleAddLine, handleRemoveLine, handleLineChange, handleSave, dialogProps, titleId };
}

export type TransactionEditModalModel = NonNullable<ReturnType<typeof useTransactionEditModalModel>>;

export default function TransactionEditModal(props: Parameters<typeof useTransactionEditModalModel>[0]) {
  const model = useTransactionEditModalModel(props);
  return model ? <TransactionEditModalView {...model} /> : null;
}
