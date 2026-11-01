import { useDialog } from '../../hooks/useDialog';
import React, { useEffect, useId, useRef, useState } from 'react';
import { parseCsvChecked } from '../../lib/csv';
import { assertReadableText, mapBankCsvRows } from '../../lib/bankCsvRows';
import { headerSignature, mappingToSaved, savedToMapping } from '../../lib/importColumnMaps';
import type { LedgerState } from '../../stores/useLedgerStore';
import type { ColumnMapping } from '../../lib/importColumnMaps';
import { getIdToken } from '../../firebase';
import { 
  X, 
  FileText, 
  Check, 
  AlertCircle, 
  Loader2,
  ArrowRight,
  Activity,
  Upload,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Transaction, ChartAccount, AutoRule } from '../../types';
import { aiService } from '../../services/aiService';
import { IntentResolver } from '../../lib/intentResolver';
import { cn, getLocalDateISO, formatDate, formatCurrency, getCurrencyDivisor } from '../../lib/utils';

import { toast } from 'sonner';
import AsyncButton from '../ui/AsyncButton';
import { useAuthStore } from '../../stores/useAuthStore';
import { BloomFilter, MinHash, AnalyticalMatcher, generateImportIdentity } from '../../lib/algorithms';
import CategoryWhyPopover from '../common/CategoryWhyPopover';
import { Labelled } from '../ui/Labelled';
import { parseQIFStatement, type QIFDateOrder } from '../../lib/qifParser';
import { parseBAI2Statement } from '../../lib/bai2Parser';
import { parseOFXStatement } from '../../lib/ofxParser';
import { parseCamt053Import } from '../../lib/camt053Import';
import { parseUsBankCsv, type UsBankCsvFormat } from '../../lib/usBankCsv';
import { readIsraeliBankCsv, type IsraeliBankDateOrder } from '../../lib/israeliBankCsv';
import StatementFormatControls from './StatementFormatControls';

function withOccurrenceKeys<T>(items: readonly T[], identity: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map(item => {
    const content = identity(item);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { item, key: JSON.stringify([content, occurrence]) };
  });
}

interface StatementImporterProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves `false` when nothing was stored: the review then stays open with the selection kept. */
  onImport: (transactions: ParsedTx[]) => void | boolean | Promise<void | boolean>;
  existingTransactions: Transaction[];
  businessContext: string;
  accounts: ChartAccount[];
  autoRules?: AutoRule[];
  patternCache?: LedgerState['analyticalPatternCache'];
}

type StatementResult = Omit<ParsedTx, 'selected'> & { categorySuggestion?: string };

interface ParsedTx {
  date: string;
  description: string;
  amountCents: number;
  importIdentity?: string;
  isDuplicate?: boolean;
  selected: boolean;
  hasResolvedEntity?: boolean;
  resolutionScore?: number;
  suggestedAccount?: string;
  suggestedProjectId?: string;
  suggestedProject?: string;
  isLearned?: boolean;
  lines?: Array<{
    description: string;
    amountCents: number;
    quantity?: number;
    unitPriceCents?: number;
    category?: string;
    tags?: string[];
  }>;
}

export default function StatementImporter({ 
  isOpen, 
  onClose, 
  onImport, 
  existingTransactions,
  businessContext,
  accounts,
  patternCache
}: StatementImporterProps) {
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(onClose, isOpen);
  const formId = useId();
  const user = useAuthStore(s => s.user);
  const [rawText, setRawText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parsedTxs, setParsedTxs] = useState<ParsedTx[]>([]);
  const [step, setStep] = useState<'input' | 'mapping' | 'review'>('input');
  const backButtonRef = useRef<HTMLButtonElement>(null);
  // Upload/mapping fields unmount on review; keep keyboard events inside useDialog's boundary.
  useEffect(() => { if (isOpen && step !== 'input') backButtonRef.current?.focus(); }, [isOpen, step]);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [qifDateOrder, setQifDateOrder] = useState<QIFDateOrder | ''>('');
  const [usBankCsvFormat, setUsBankCsvFormat] = useState<UsBankCsvFormat | ''>('');
  // E-26/E-43: Israeli banks' activity CSVs, chosen deliberately and read by column names only.
  const [israeliBankCsv, setIsraeliBankCsv] = useState(false);
  const [israeliDateOrder, setIsraeliDateOrder] = useState<IsraeliBankDateOrder | ''>('');
  const [fileError, setFileError] = useState('');
  const [mappingError, setMappingError] = useState('');
  const csvHeaders = withOccurrenceKeys(csvData[0] || [], column => column);
  const csvPreview = withOccurrenceKeys(csvData.slice(1, 6), row => JSON.stringify(row));
  const [mapping, setMapping] = useState({ date: -1, description: -1, amount: -1, debit: -1, credit: -1, payee: -1, memo: -1, skipRows: 1 });

  // #101: the shared RFC 4180 reader — only double quotes quote, so "O'Brien" stays one cell, and
  // quoted commas, line breaks and doubled quotes are kept
  const parseCsvText = (text: string): string[][] => parseCsvChecked(text).map(row => row.map(cell => cell.trim()));

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setFileError('');
    const loader = toast.loading(`Reading ${file.name}…`);
    
    try {
      const labels = accounts.map(a => a.name);
      let results: StatementResult[] = [];
      const fileType = file.type;
      const fileName = file.name.toLowerCase();
      
      if (fileName.endsWith('.qif') || fileName.endsWith('.bai') || fileName.endsWith('.bai2') || fileName.endsWith('.ofx') || fileName.endsWith('.qfx') || fileName.endsWith('.xml') || fileName.endsWith('.camt053')) {
        const workspaceId = useAuthStore.getState().currentWorkspaceId;
        const userId = useAuthStore.getState().user?.uid;
        const content = await file.text();
        if (workspaceId !== useAuthStore.getState().currentWorkspaceId || userId !== useAuthStore.getState().user?.uid) throw new Error('Workspace or user changed. Upload the statement again in the current workspace.');
        assertReadableText(content, file.name);
        const isOfx = fileName.endsWith('.ofx') || fileName.endsWith('.qfx');
        const isCamt = fileName.endsWith('.xml') || fileName.endsWith('.camt053');
        if (fileName.endsWith('.qif') && !qifDateOrder) throw new Error('Choose the QIF date order before uploading the statement.');
        const currency = useAuthStore.getState().getCurrentWorkspace()?.currency || 'USD';
        if (fileName.endsWith('.qif') && getCurrencyDivisor(currency) !== 100) throw new Error('QIF import supports two-decimal workspace currencies only. No amount was imported.');
        if ((isOfx || isCamt) && getCurrencyDivisor(currency) !== 100) throw new Error('OFX/QFX/CAMT.053 import supports two-decimal workspace currencies only. No amount was imported.');
        const bankLines = fileName.endsWith('.qif')
          ? parseQIFStatement(content, qifDateOrder as QIFDateOrder)
          : isOfx ? parseOFXStatement(content, currency) : isCamt ? parseCamt053Import(content, currency) : parseBAI2Statement(content, currency);
        processResults(bankLines);
        toast.success(`Loaded ${bankLines.length} statement entries from ${file.name}. Review before importing.`, { id: loader });
      } else if (israeliBankCsv && (fileName.endsWith('.csv') || fileName.endsWith('.txt'))) {
        // E-26/E-43: the date order is chosen, never inferred; the parser reads columns by header name.
        const workspaceId = useAuthStore.getState().currentWorkspaceId;
        const userId = useAuthStore.getState().user?.uid;
        if (!israeliDateOrder) throw new Error('Choose the statement date order before uploading an Israeli bank file.');
        const content = await file.text();
        if (workspaceId !== useAuthStore.getState().currentWorkspaceId || userId !== useAuthStore.getState().user?.uid)
          throw new Error('Workspace or user changed. Upload the statement again in the current workspace.');
        const currency = useAuthStore.getState().getCurrentWorkspace()?.currency || 'USD';
        if (getCurrencyDivisor(currency) !== 100)
          throw new Error('Israeli bank CSV import requires a two-decimal workspace currency. No amount was imported.');
        const read = readIsraeliBankCsv(content, israeliDateOrder);
        processResults(read.lines);
        const used = [read.columns.date, read.columns.description, read.columns.reference, read.columns.debit, read.columns.credit, read.columns.amount]
          .filter(Boolean).join(' · ');
        toast.success(`Loaded ${read.lines.length} bank entries from ${file.name} (columns: ${used}). Review before importing.`, { id: loader });
      } else if (usBankCsvFormat && (fileName.endsWith('.csv') || fileName.endsWith('.txt'))) {
        // E-27: deliberate bank selection; particularly important for Wells Fargo's headerless export.
        const workspaceId = useAuthStore.getState().currentWorkspaceId;
        const userId = useAuthStore.getState().user?.uid;
        const content = await file.text();
        if (workspaceId !== useAuthStore.getState().currentWorkspaceId || userId !== useAuthStore.getState().user?.uid)
          throw new Error('Workspace or user changed. Upload the statement again in the current workspace.');
        const currency = useAuthStore.getState().getCurrentWorkspace()?.currency || 'USD';
        if (getCurrencyDivisor(currency) !== 100)
          throw new Error('Selected US bank CSV import requires a two-decimal workspace currency. No amount was imported.');
        assertReadableText(content, file.name);
        const bankLines = parseUsBankCsv(content, usBankCsvFormat);
        processResults(bankLines);
        toast.success(`Loaded ${bankLines.length} bank entries from ${file.name}. Review before importing.`, { id: loader });
      } else if (fileType.startsWith('image/')) {
        const result = await aiService.parseReceipt(file, undefined, patternCache, labels);
        if (result) {
          results = [{
            date: result.date || getLocalDateISO(),
            description: result.vendorName as string,
            amountCents: result.totalAmountCents,
            categorySuggestion: result.categorySuggestion,
            lines: result.lines || []
          }];
        }
        if (results && results.length > 0) {
          processResults(results as unknown as StatementResult[]);
          toast.success(`Extracted ${results.length} rows from ${file.name}`, { id: loader });
        } else {
          toast.error('Could not read any rows from this file.', { id: loader });
        }
      } else if (fileName.endsWith('.csv') || fileName.endsWith('.txt') || fileType.includes('csv') || fileType.includes('text')) {
        const fileContent = await file.text();
        assertReadableText(fileContent, file.name);
        const rows = parseCsvText(fileContent);
        setMappingError('');
        if (rows.length > 0) {
          setCsvData(rows);
          // Auto detect headers
          const header = rows[0].map(h => h.toLowerCase());
          const dateIdx = header.findIndex(h => h.includes('date') || h.includes('time') || h.includes('posted'));
          const descIdx = header.findIndex(h => h.includes('desc') || h.includes('narrat') || h.includes('payee') || h.includes('title') || h.includes('name') || h.includes('merchant'));
          const amtIdx = header.findIndex(h => h.includes('amount') || h.includes('total') || h.includes('net') || h.includes('sum'));
          const debitIdx = header.findIndex(h => h.includes('debit') || h.includes('withdraw') || h.includes('out'));
          const creditIdx = header.findIndex(h => h.includes('credit') || h.includes('deposit') || h.includes('in'));
          const payeeIdx = header.findIndex(h => h.includes('payee') || h.includes('vendor') || h.includes('party'));
          const memoIdx = header.findIndex(h => h.includes('memo') || h.includes('note') || h.includes('comment'));

          const savedLayout = useAuthStore.getState().getCurrentWorkspace()?.importColumnMaps?.[headerSignature(rows[0])];
          if (savedLayout) {
            setMapping(savedToMapping(savedLayout, rows[0]));
            setStep('mapping');
            toast.success(`Loaded ${rows.length - 1} records from ${file.name} using this bank's saved column layout.`, { id: loader });
            return;
          }
          setMapping({
            date: dateIdx !== -1 ? dateIdx : 0,
            description: descIdx !== -1 ? descIdx : (rows[0].length > 1 ? 1 : 0),
            amount: amtIdx !== -1 ? amtIdx : -1,
            debit: debitIdx !== -1 ? debitIdx : -1,
            credit: creditIdx !== -1 ? creditIdx : -1,
            payee: payeeIdx !== -1 ? payeeIdx : -1,
            memo: memoIdx !== -1 ? memoIdx : -1,
            skipRows: 1
          });

          setStep('mapping');
          toast.success(`Loaded ${rows.length - 1} records from ${file.name}. Verify mapping below.`, { id: loader });
        } else {
          toast.error('File appears empty or unreadable.', { id: loader });
        }
      } else {
        results = await aiService.parseStatement(file, businessContext, undefined, patternCache, labels) as unknown as StatementResult[];
        if (results && results.length > 0) {
          processResults(results as unknown as StatementResult[]);
          toast.success(`Extracted ${results.length} rows from ${file.name}`, { id: loader });
        } else {
          toast.error('Could not read any rows from this file.', { id: loader });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Parsing failure';
      setFileError(message);
      toast.error(message, { id: loader });
      console.error(error);
    } finally {
      setIsParsing(false);
      e.target.value = '';
    }
  };

  const handleMapColumns = () => {
    // #101 / PREV-6: an empty or unreadable amount is never $0, and the whole file or nothing is
    // imported: a row that cannot be read is named in the message instead of being skipped
    let results: ReturnType<typeof mapBankCsvRows>;
    try {
      results = mapBankCsvRows(csvData, mapping);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The file could not be read.';
      setMappingError(message);
      toast.error(message);
      return;
    }
    setMappingError('');
    processResults(results as unknown as StatementResult[]);
    if (results.length > 0 && csvData[0]) void saveColumnLayout(csvData[0], mapping as ColumnMapping);
  };

  // Remember this bank's column layout (keyed by its header row) for the next import
  const saveColumnLayout = async (header: string[], used: ColumnMapping) => {
    const workspaceId = useAuthStore.getState().currentWorkspaceId;
    if (!workspaceId) return;
    const signature = headerSignature(header);
    const saved = mappingToSaved(used, header);
    try {
      const token = await getIdToken().catch(() => null);
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/import-maps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ signature, ...saved }),
      });
      if (!res.ok) return;
      const { workspaces, setWorkspaces } = useAuthStore.getState();
      setWorkspaces(workspaces.map(w => (w.id === workspaceId
        ? { ...w, importColumnMaps: { ...(w.importColumnMaps || {}), [signature]: { ...saved, savedAt: new Date().toISOString() } } }
        : w)));
    } catch {
      // Saving the layout is a convenience; the import itself already succeeded
    }
  };

  const handleParse = async () => {
    if (!rawText.trim()) return;
    setIsParsing(true);
    try {
      const labels = accounts.map(a => a.name);
      const results = IntentResolver.resolveEntry(rawText, { accounts: accounts.map(a => ({ id: a.id, name: a.name })), ruleCache: patternCache });
      if (results && results.length > 0) {
        processResults(results as unknown as StatementResult[]);
      } else {
        const fallbackResults = await aiService.parseStatement(rawText, businessContext, undefined, patternCache, labels);
        processResults(fallbackResults as unknown as StatementResult[]);
      }
    } catch (error) {
      console.error("Parsing error:", error);
    } finally {
      setIsParsing(false);
    }
  };

  const processResults = (results: StatementResult[]) => {
    // THE HARD WORK: Layer 2 - Entity Resolution
    // Using Bloom for exact match and MinHash for structural similarity
    const bloom = new BloomFilter(Math.max(1000, existingTransactions.length * 10), 7);
    const minHash = new MinHash(128, user?.uid || ''); // 128 hashes per signature
    
    const existingSignatures = existingTransactions.map(et => ({
      id: et.id,
      sig: minHash.createSignature(et.description)
    }));
    
    // Warm up the filter and track existing fingerprints
    const existingIdentities = new Set(existingTransactions.map(et => et.importIdentity).filter(Boolean));
    existingTransactions.forEach(et => {
      bloom.add(`${et.date}-${et.totalAmountCents}-${et.description.toLowerCase()}`);
    });

    const occurrences: Record<string, number> = {};

    const processed = results.map((tx) => {
      const txKey = `${tx.date}-${Math.abs(tx.amountCents)}-${tx.description.toLowerCase()}`;
      const occIndex = occurrences[txKey] || 0;
      occurrences[txKey] = occIndex + 1;

      // Deterministic import fingerprint
      const importIdentity = generateImportIdentity('statement_csv', 'line', {
        date: tx.date,
        amountCents: tx.amountCents,
        description: tx.description,
      }, occIndex);
      
      // Fast bitwise lookup and fingerprint deduplication
      let isDuplicate = existingIdentities.has(importIdentity) || bloom.has(txKey);
      
      // Verification of potential collisions
      if (isDuplicate && !existingIdentities.has(importIdentity)) {
         isDuplicate = existingTransactions.some(et => 
            et.date === tx.date && 
            Math.abs(et.totalAmountCents - Math.abs(tx.amountCents)) < 1 &&
            et.description.toLowerCase().trim() === tx.description.toLowerCase().trim()
         );
      }

      // 1. Check Analytical Memory/Cache for learned patterns (Project + Account)
      const learned = AnalyticalMatcher.predict(tx.description, patternCache as Parameters<typeof AnalyticalMatcher.predict>[1]);
      
      const suggestedAccount = learned?.accountName || tx.categorySuggestion || learned?.accountId;
      const suggestedProjectId = learned?.projectId;
      const suggestedProject = learned?.projectName;
      const isLearned = !!learned;

      // Pattern Recognition (Near Duplicate Detection for UI feedback)
      const currentSig = minHash.createSignature(tx.description);
      const similarity = existingSignatures.reduce((max, prev) => {
        const sim = minHash.compare(currentSig, prev.sig);
        return Math.max(max, sim);
      }, 0);

      return {
        ...tx,
        importIdentity,
        isDuplicate,
        hasResolvedEntity: isLearned || similarity > 0.85,
        isLearned,
        suggestedAccount,
        suggestedProjectId,
        suggestedProject,
        resolutionScore: isLearned ? (learned?.confidence || 1.0) : similarity,
        selected: !isDuplicate
      };
    });
    
    setParsedTxs(processed);
    setStep('review');
  };

  const [importing, setImporting] = useState(false);
  const handleImport = async () => {
    if (importing) return;
    const toImport = parsedTxs.filter(t => t.selected);
    setImporting(true);
    let stored: void | boolean;
    try {
      stored = await onImport(toImport);
    } finally {
      setImporting(false);
    }
    // #110: close and clear only when the import was stored
    if (stored === false) return;
    onClose();
    setStep('input');
    setRawText('');
    setParsedTxs([]);
  };

  const toggleSelect = (index: number) => {
    setParsedTxs(prev => prev.map((t, i) => i === index ? { ...t, selected: !t.selected } : t));
  };

  const toggleAll = () => {
    const allSelected = parsedTxs.every(t => t.selected);
    setParsedTxs(prev => prev.map(t => ({ ...t, selected: !allSelected })));
  };

  if (!isOpen) return null;

  return (
    <div {...overlayDialogProps} className="fixed inset-0 z-[500] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/60 backdrop-blur-md"
      />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-4xl bg-[var(--surface)] rounded-2xl shadow-2xl border border-[var(--line)] overflow-hidden flex flex-col max-h-[90dvh]"
      >
        {/* Header */}
        <div className="p-4 md:p-8 border-b border-[var(--line)] flex items-center justify-between bg-[var(--surface)]">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-[var(--brass-soft)] border border-[var(--brass-line)] rounded-xl flex items-center justify-center text-[var(--brass)]">
              <FileText aria-hidden="true" size={24} />
            </div>
            <div>
              <h2 id={overlayTitleId} className="text-2xl font-black text-[var(--text)] tracking-tight">Import bank statement</h2>
              <p className="text-xs text-[var(--muted)] font-bold uppercase tracking-wider">Review each line before importing</p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="p-2 hover:bg-[var(--ink)] rounded-full transition-all text-[var(--muted)] cursor-pointer"><X aria-hidden="true" size={24} /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <AnimatePresence mode="wait">
            {step === 'input' ? (
              <motion.div 
                key="input"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label htmlFor={`${formId}-statement-text`} className="micro-label">Paste Statement Text or Upload a Statement</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="file" 
                        id={`${formId}-csv-upload`}
                        accept=".csv,.txt,.qif,.bai,.bai2,.ofx,.qfx,.xml,.camt053"
                        className="hidden" 
                        onChange={handleFileUpload}
                        disabled={isParsing}
                      />
                      <label 
                        htmlFor={`${formId}-csv-upload`}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 text-zinc-600 rounded-xl text-[10px] font-medium uppercase tracking-wider hover:bg-zinc-200 transition-all cursor-pointer"
                      >
                        <Upload aria-hidden="true" size={14} />
                        Upload CSV / QIF / BAI2 / OFX / QFX / CAMT.053
                      </label>
                    </div>
                  </div>
                  <StatementFormatControls
                    disabled={isParsing}
                    qifDateOrder={qifDateOrder}
                    onQifDateOrder={setQifDateOrder}
                    usBankCsvFormat={usBankCsvFormat}
                    onUsBankCsvFormat={setUsBankCsvFormat}
                    israeliBankCsv={israeliBankCsv}
                    onIsraeliBankCsv={setIsraeliBankCsv}
                    israeliDateOrder={israeliDateOrder}
                    onIsraeliDateOrder={setIsraeliDateOrder}
                  />
                  {fileError && <p role="alert" className="text-sm text-rose-600">{fileError}</p>}
                  <textarea
                    id={`${formId}-statement-text`}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="Paste raw text from your bank statement, CSV, or PDF export here..."
                    className="w-full h-64 p-6 bg-[var(--surface)] border border-[var(--line)] rounded-2xl font-mono text-sm text-[var(--text)] focus:border-[var(--brass-line)] outline-none transition-all resize-none"
                  />
                </div>
              </motion.div>
            ) : step === 'mapping' ? (
              <motion.div 
                key="mapping"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-8"
              >
                <div className="p-6 bg-[var(--ink)] border border-[var(--line)] rounded-2xl text-[var(--text)]">
                  <h3 className="text-xl font-black mb-1 uppercase tracking-tight">Map file columns</h3>
                  <p className="text-xs text-[var(--muted)] font-medium">Match each column in your file to the LedgerFlow field it contains.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-3 md:col-span-3">
                    <Labelled labelClassName="micro-label !text-[var(--text)]" label="Header Rows to Skip">
                      <input type="number" min="0" value={mapping.skipRows} onChange={(e) => setMapping({...mapping, skipRows: parseInt(e.target.value) || 0})} className="w-full px-4 py-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl font-bold text-sm text-[var(--text)] outline-none focus:border-[var(--brass-line)]" />
                    </Labelled>
                  </div>
                  {(['date', 'description', 'amount', 'debit', 'credit', 'payee', 'memo'] as const).map(field => (
                    <div key={field} className="space-y-3">
                      <Labelled labelClassName="micro-label !text-[var(--text)] capitalize" label={<>{field} Column</>}>
                        <select 
                          value={mapping[field]}
                          onChange={(e) => setMapping({...mapping, [field]: parseInt(e.target.value, 10)})}
                          className="w-full px-4 py-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl font-bold text-sm text-[var(--text)] outline-none focus:border-[var(--brass-line)] cursor-pointer"
                        >
                          <option value={-1}>Select Column</option>
                          {csvHeaders.map(({ item: col, key }, idx) => (
                            <option key={key} value={idx}>{col || `Column ${idx + 1}`}</option>
                          ))}
                        </select>
                      </Labelled>
                    </div>
                  ))}
                </div>

                <div className="border border-[var(--line)] rounded-2xl overflow-hidden">
                  <div className="p-4 bg-[var(--surface)] border-b border-[var(--line)]">
                    <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest">Data Preview (First 5 Rows)</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[600px]">
                      <caption className="sr-only">Statement preview</caption>
                      <thead>
                        <tr className="bg-[var(--ink)] border-b border-[var(--line)]">
                          {csvHeaders.map(({ item: col, key }, idx) => (
                            <th scope="col" key={key} className="p-4 font-black text-[var(--text)] truncate max-w-[150px]">{col || `Col ${idx + 1}`}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreview.map(({ item: row, key }) => (
                          <tr key={key} className="border-b border-[var(--line)]/50">
                            {withOccurrenceKeys(row, cell => cell).map(({ item: cell, key: cellKey }, column) => (
                              <td key={csvHeaders[column] ? `column-${csvHeaders[column].key}` : `extra-${cellKey}`} className="p-4 text-[var(--muted)] font-medium truncate max-w-[150px]">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="review"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={toggleAll}
                      className="text-xs font-black text-indigo-600 uppercase tracking-widest hover:underline"
                     >
                      {parsedTxs.every(t => t.selected) ? 'Deselect All' : 'Select All'}
                    </button>
                    <span className="text-xs text-[var(--muted)] font-bold uppercase tracking-widest">
                      {parsedTxs.filter(t => t.selected).length} Selected
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-black text-rose-500 uppercase tracking-widest">
                    <AlertCircle aria-hidden="true" size={12} />
                    {parsedTxs.filter(t => t.isDuplicate).length} Potential Duplicates
                  </div>
                </div>

                <div className="space-y-2">
                  {withOccurrenceKeys(parsedTxs, tx => JSON.stringify([tx.importIdentity, tx.date, tx.description, tx.amountCents])).map(({ item: tx, key }, idx) => (
                    <div 
                      key={key}
                      className={cn(
                        "p-4 rounded-xl border transition-all flex flex-col gap-3 group bg-[var(--surface)]",
                        tx.selected 
                          ? "border-[var(--brass-line)] shadow-sm" 
                          : "border-[var(--line)] opacity-60 grayscale bg-[var(--surface)]",
                        tx.isDuplicate && tx.selected && "border-rose-300 bg-rose-500/10"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <button type="button"
                            aria-label={`Select ${tx.description} on ${formatDate(tx.date)}`}
                            aria-pressed={tx.selected}
                            onClick={(e) => { e.stopPropagation(); toggleSelect(idx); }}
                            className={cn(
                              "w-6 h-6 rounded-lg border flex items-center justify-center transition-all cursor-pointer",
                              tx.selected ? "bg-[var(--brass)] border-[var(--brass-line)] text-black" : "bg-[var(--surface)] border-[var(--line)]"
                            )}
                          >
                            {tx.selected && <Check aria-hidden="true" size={14} />}
                          </button>
                          <div>
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-[10px] font-mono text-[var(--muted)]">{formatDate(tx.date)}</p>
                              {tx.hasResolvedEntity && (
                                <span className={cn(
                                  "flex items-center gap-1 text-[8px] font-black px-1.5 py-0.5 rounded border uppercase tracking-tighter",
                                  tx.isLearned ? "text-[var(--brass)] bg-[var(--brass-soft)] border-[var(--brass-line)]" : "text-[var(--pos)] bg-[var(--pos)]/10 border-[var(--pos)]/20"
                                )}>
                                  {tx.isLearned ? <Zap aria-hidden="true" size={8} /> : <Activity aria-hidden="true" size={8} />}
                                  {tx.isLearned ? "Rule Memory" : `Pattern Resolved (${Math.round((tx.resolutionScore || 0) * 100)}%)`}
                                  {tx.suggestedAccount && ` → ${tx.suggestedAccount}`}
                                  {tx.suggestedProject && ` [Proj: ${tx.suggestedProject}]`}
                                </span>
                              )}
                              <CategoryWhyPopover 
                                description={tx.description}
                                accountName={tx.suggestedAccount}
                              />
                            </div>
                            <p className="text-sm font-bold text-[var(--text)]">{tx.description}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={cn(
                            "text-sm font-black mono-value",
                            tx.amountCents > 0 ? "text-[var(--pos)]" : "text-[var(--text)]"
                          )}>
                            {tx.amountCents > 0 ? '+' : ''}{formatCurrency(tx.amountCents)}
                          </p>
                          {tx.isDuplicate && (
                            <span className="text-[9px] font-black text-rose-500 uppercase tracking-tighter">Duplicate Detected</span>
                          )}
                        </div>
                      </div>

                      {/* Sub-item Drilldown */}
                      {tx.lines && tx.lines.length > 1 && (
                        <div className="mt-2 pt-2 border-t border-[var(--line)] space-y-1.5 pl-10">
                          {withOccurrenceKeys(tx.lines, item => JSON.stringify([item.description, item.amountCents, item.quantity, item.unitPriceCents, item.category])).map(({ item, key }) => (
                            <div key={key} className="flex items-center justify-between group/item">
                              <div className="flex flex-col">
                                <p className="text-[11px] font-medium text-[var(--muted)] group-hover/item:text-[var(--text)] transition-colors">
                                  {item.description}
                                  {item.quantity && item.quantity > 1 && (
                                    <span className="ml-2 text-[9px] text-[var(--muted)] font-bold px-1 py-0.5 bg-[var(--surface)] rounded border border-[var(--line)]">
                                      {item.quantity} units @ {formatCurrency((item.unitPriceCents || 0))}
                                    </span>
                                  )}
                                </p>
                                {item.category && item.category !== tx.suggestedAccount && (
                                  <span className="text-[8px] text-[var(--brass)] font-medium uppercase tracking-wider">{item.category}</span>
                                )}
                              </div>
                              <p className="text-[10px] font-mono font-bold text-[var(--muted)] tabular-nums">
                                {formatCurrency((item.amountCents || 0))}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {step === 'mapping' && mappingError && <p role="alert" className="mt-4 text-sm text-rose-600">{mappingError}</p>}
        </div>

        {/* Footer */}
        <div className="p-4 md:p-6 border-t border-[var(--line)] bg-[var(--ink)] flex items-center justify-between">
          {step !== 'input' ? (
            <button 
              ref={backButtonRef}
              onClick={() => setStep('input')}
              className="px-5 py-2.5 text-[var(--muted)] font-bold hover:text-[var(--text)] transition-all cursor-pointer text-xs uppercase tracking-wider"
            >
              Back to Input
            </button>
          ) : (
            <div />
          )}
          
          <div className="flex items-center gap-4">
            {step === 'input' ? (
              <button 
                onClick={handleParse}
                disabled={isParsing || !rawText.trim()}
                className="px-8 py-3 bg-[var(--brass)] text-[var(--ink)] rounded-xl font-bold hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md text-xs uppercase tracking-wider cursor-pointer"
               >
                {isParsing ? <Loader2 aria-hidden="true" className="animate-spin" size={16} /> : <ArrowRight aria-hidden="true" size={16} />}
                {isParsing ? 'Reading file...' : 'Parse statement'}
              </button>
            ) : step === 'mapping' ? (
              <button 
                onClick={handleMapColumns}
                className="px-8 py-3 bg-[var(--brass)] text-[var(--ink)] rounded-xl font-bold hover:opacity-90 transition-all flex items-center gap-2 shadow-md text-xs uppercase tracking-wider cursor-pointer"
               aria-label="Review and continue">
                <ArrowRight aria-hidden="true" size={16} />
                Review and continue
              </button>
            ) : (
              <AsyncButton 
                onClick={handleImport}
                loadingText="Importing..."
                className="px-8 py-3 bg-[var(--brass)] text-[var(--ink)] rounded-xl font-bold hover:opacity-90 transition-all flex items-center gap-2 shadow-md text-xs uppercase tracking-wider cursor-pointer"
              >
                <Check aria-hidden="true" size={16} />
                Import {parsedTxs.filter(t => t.selected).length} Entries
              </AsyncButton>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
