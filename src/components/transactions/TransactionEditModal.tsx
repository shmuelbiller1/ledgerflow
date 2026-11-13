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
import { isDocumentEntry } from '../../lib/transactionEdits';
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
  onUpdate: (id: string, updates: Partial<Transaction>) => void | boolean | Promise<void | boolean>;
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
  const storeBaseCurrency = useLedgerStore(s => s.baseCurrency);
  const getCurrentWorkspace = useAuthStore(s => s.getCurrentWorkspace);
  const currentWorkspace = getCurrentWorkspace();
  const baseCurrency = currentWorkspace?.currency || storeBaseCurrency || 'USD';
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
  const [originalCurrency, setOriginalCurrency] = useState(() => transaction?.originalCurrency || transaction?.currency || baseCurrency);
  const [exchangeRate, setExchangeRate] = useState<number>(() => transaction?.exchangeRate || 1.0);
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  useLedgerStore(s => s.classes);
  useLedgerStore(s => s.locations);
  useLedgerStore(s => s.projects);
  const transactions = useLedgerStore(s => s.transactions);
  const activeDimensions = currentWorkspace?.dimensions || DEFAULT_WORKSPACE_DIMENSIONS;
  
  // Manage lines for splitting and multiple assignments
  const [lines, setLines] = useState<TransactionLine[]>(() => transaction?.lines ? transaction.lines.map(l => ({ ...l })) : []);

  // UI-only keys are initialized once and survive changes to editable line fields.
  const [lineKeys, setLineKeys] = useState(() => withOccurrenceKeys(lines, line =>
    line.id || JSON.stringify([line.accountId, line.description, line.amountCents, line.project, line.class, line.location])
  ).map(({ key }) => `existing-${key}`));
  const nextLineKey = useRef(0);

  const txRec = transaction as unknown as Record<string, unknown> | undefined;
  const isDocBacked = isDocumentEntry(transaction) || Boolean(
    txRec?.invoiceId ||
    txRec?.billId ||
    txRec?.paymentId ||
    txRec?.creditNoteId ||
    txRec?.vendorCreditId ||
    txRec?.depositId ||
    txRec?.payRunId,
  );
  const isLocked = (!isReverseMode && closed(date)) || (!isReverseMode && isDocBacked);

  // Sum positive (debit) legs so balanced double-entry journals show their actual gross amount instead of 0
  const debitTotalCents = lines.reduce((sum, l) => sum + ((l.amountCents || 0) > 0 ? (l.amountCents || 0) : 0), 0);
  const totalAmountCents = debitTotalCents > 0 ? debitTotalCents : Math.abs(lines.reduce((sum, l) => sum + (l.amountCents || 0), 0));
  
  // Let's compute if the line items sum up correctly
  const sumLines = lines.reduce((sum, l) => sum + (l.amountCents || 0), 0);

  const lineKeysRef = useRef(lineKeys);
  useEffect(() => {
    lineKeysRef.current = lineKeys;
  }, [lineKeys]);

  const handleAddLine = () => {
    const defaultAcc = accounts.find(a => a.type === 'expense') || accounts[0];
    const key = `added-${nextLineKey.current++}`;
    const nextKeys = [...lineKeysRef.current, key];
    lineKeysRef.current = nextKeys;
    setLines(prev => [...prev, { 
      accountId: defaultAcc?.id || '', 
      accountName: defaultAcc?.name || '', 
      amountCents: 0 
    }]);
    setLineKeys(nextKeys);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length <= 1) {
      toast.error('At least one double-entry split ledger line is required for absolute integrity.');
      return;
    }
    const nextKeys = lineKeysRef.current.filter((_, i) => i !== index);
    lineKeysRef.current = nextKeys;
    setLines(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
    setLineKeys(nextKeys);
  };

  /** Updates a single transaction line functionally using its stable row key (ignoring completions for deleted rows). */
  const handleLineChange = (
    index: number,
    updates: Partial<TransactionLine> | ((current: TransactionLine) => Partial<TransactionLine>),
    lineKey?: string,
  ) => {
    setLines(prev => {
      let targetIdx = index;
      if (lineKey !== undefined) {
        targetIdx = lineKeysRef.current.indexOf(lineKey);
        if (targetIdx < 0) return prev;
      }
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
    if (!isReverseMode && isDocBacked) {
      toast.error('This entry belongs to a document. Void or credit the source invoice, bill, or payment instead.');
      return;
    }
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
    const isForeignCurrency = Boolean(originalCurrency && originalCurrency !== baseCurrency);
    const originalLinesByKey = new Map<string, TransactionLine>(
      withOccurrenceKeys(transaction.lines || [], line =>
        line.id || JSON.stringify([line.accountId, line.description, line.amountCents, line.project, line.class, line.location])
      ).map(({ item, key }) => [`existing-${key}`, item] as const),
    );
    const finalLines = lines.map((l, index) => {
      const acc = accounts.find(a => a.id === l.accountId);
      const normalizedDims = normalizeDimensionsMap(l.dimensions, currentNodes);
      const rawLineProject = l.project || project.trim() || undefined;
      const matchedLineProjectId =
        rawLineProject || normalizedDims?.project
          ? resolveWorkspaceProjectId([l.project, normalizedDims?.project, !l.project && !normalizedDims?.project ? project.trim() : undefined], workspaceProjects, currentNodes)
          : undefined;
      const cleanedBase = { ...l } as TransactionLine & { currency?: string };
      if (isForeignCurrency) {
        if (cleanedBase.exchangeRate === undefined) cleanedBase.exchangeRate = exchangeRate;
        const originalLine = originalLinesByKey.get(lineKeys[index]);
        const originalExchangeRate = originalLine?.exchangeRate ?? transaction.exchangeRate ?? 1.0;
        const currentExchangeRate = cleanedBase.exchangeRate ?? exchangeRate;
        if (!originalLine || l.amountCents !== originalLine.amountCents || currentExchangeRate !== originalExchangeRate) {
          delete cleanedBase.baseAmountCents;
        }
      } else if (cleanedBase.exchangeRate !== undefined || cleanedBase.baseAmountCents !== undefined || cleanedBase.currency !== undefined) {
        delete cleanedBase.exchangeRate;
        delete cleanedBase.baseAmountCents;
        delete cleanedBase.currency;
      }
      return {
        ...cleanedBase,
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

    const saveResult = await onUpdate(transaction.id, {
      date,
      description: description.trim(),
      payee: payee.trim() || undefined,
      type,
      status,
      project: project.trim() || undefined,
      isCleared,
      isFlagged,
      fileUrls,
      ...(transaction.currency !== undefined || isForeignCurrency
        ? { currency: isForeignCurrency ? originalCurrency : baseCurrency }
        : {}),
      originalCurrency: isForeignCurrency ? originalCurrency : undefined,
      exchangeRate: isForeignCurrency ? exchangeRate : undefined,
      lines: finalLines,
      totalAmountCents: calculatedTotal
    });
    if (saveResult === false) return;

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

  return { transaction, accounts, lockDate, onClose, onReverseAndCorrect, withOccurrenceKeys, formId, baseCurrency, isDocBacked, dimensionNodes, isReverseMode, setIsReverseMode, reversalDate, setReversalDate, correctionReason, setCorrectionReason, date, setDate, description, setDescription, payee, setPayee, type, setType, status, setStatus, project, setProject, isCleared, setIsCleared, isFlagged, setIsFlagged, fileUrls, setFileUrls, originalCurrency, setOriginalCurrency, exchangeRate, setExchangeRate, isFetchingRate, setIsFetchingRate, transactions, activeDimensions, lines, lineKeys, isLocked, totalAmountCents, sumLines, handleAddLine, handleRemoveLine, handleLineChange, handleSave, dialogProps, titleId };
}

export type TransactionEditModalModel = NonNullable<ReturnType<typeof useTransactionEditModalModel>>;

export default function TransactionEditModal(props: Parameters<typeof useTransactionEditModalModel>[0]) {
  const model = useTransactionEditModalModel(props);
  return model ? <TransactionEditModalView {...model} /> : null;
}
