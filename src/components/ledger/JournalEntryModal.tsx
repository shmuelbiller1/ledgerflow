import { useDialog } from '../../hooks/useDialog';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { User } from '../../lib/db/auth';
import { ChartAccount, JournalLine } from '../../types';
import { 
  AlertCircle, 
  CheckCircle2,
  X,
  ArrowRightLeft,
  Type as TypeIcon
} from 'lucide-react';
import DocumentLineEditor, { type JournalEditorLine } from '../common/DocumentLineEditor';
import { motion, AnimatePresence } from 'motion/react';
import { cn, getLocalDateISO, formatCurrency, safeConfirm } from '../../lib/utils';
import { getIdToken } from '../../firebase';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { isPostable } from '../../lib/txFilters';
import AsyncButton from '../ui/AsyncButton';
import { MatchingEngine } from '../../lib/MatchingEngine';
import { SpellChecker } from '../../lib/algorithms';
import { useSuggestedRate } from '../../hooks/useSuggestedRate';
import { documentCurrencies } from '../../lib/exchangeRates';
import { firstOfNextMonth, reversalDateProblem, withReversal } from '../../lib/autoReversal';
import { useAuthStore } from '../../stores/useAuthStore';
import { DEFAULT_WORKSPACE_DIMENSIONS } from '../../lib/dimensionUtils';
import { resolveAccountRole } from '../../lib/accountUtils';
import { isLockedDate } from '../../lib/periodLock';
import { describeError } from '../../lib/errorRemedies';
import { savedInOtherWorkspace, workspaceChangedSince } from '../../lib/saveWorkspace';
import { formLines, templateLines, templateProblem, templateSummary, type JournalTemplate } from '../../lib/journalTemplates';
import { listJournalTemplates, removeJournalTemplate, saveJournalTemplate } from '../../services/journalTemplateActions';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { requiredLabelRules, requiredLabelWarnings } from '../../lib/requiredLabels';

interface JournalEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  accounts: ChartAccount[];
  workspaceId: string;
  /** Start from another entry's lines (K-05 "Duplicate"); the date is today and nothing is posted until saved. */
  /** BD-03: `adjusting` marks an accountant's adjusting entry (year-end, audit) */
  initialEntry?: { description?: string; reference?: string; lines: JournalLine[]; adjusting?: boolean };
}

export default function JournalEntryModal({ isOpen, onClose, user, accounts, workspaceId, initialEntry }: JournalEntryModalProps) {
  const [description, setDescription] = useState(initialEntry?.description || '');
  const [date, setDate] = useState(getLocalDateISO());
  const [reference, setReference] = useState('');
  // R-05: an accrual that undoes itself (on the 1st of the next month unless another date is chosen)
  const [autoReverse, setAutoReverse] = useState(false);
  const [adjusting, setAdjusting] = useState(Boolean(initialEntry?.adjusting));
  const [reverseOnTyped, setReverseOnTyped] = useState('');
  const reverseOn = reverseOnTyped || (date ? firstOfNextMonth(date) : '');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [showDimensions, setShowDimensions] = useState(false);
  
  const baseCurrency = useLedgerStore(state => state.baseCurrency);
  const lockDate = useLedgerStore(state => state.lockDate);
  const lockException = useLedgerStore(state => state.lockException);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const activeDimensions = (workspace?.dimensions || DEFAULT_WORKSPACE_DIMENSIONS).filter(d => d.id !== 'category');
  
  const [transactionCurrency, setTransactionCurrency] = useState(baseCurrency || 'USD');
  // the rate the person confirms (filled from the last one used or today's; never a made-up one, L-190)
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [rateTyped, setRateTyped] = useState(false);
  
  const isLocked = !!date && isLockedDate(date, lockDate, lockException);

  const nextLineKey = useRef(0);
  const toEditorLine = (l: Partial<JournalLine>, id: string): JournalEditorLine => ({
    id,
    description: '',
    accountId: l.accountId || '',
    accountName: l.accountName || '',
    debit: l.debit || 0,
    credit: l.credit || 0,
    amountCents: (l.debit || 0) > 0 ? (l.debit || 0) : -(l.credit || 0),
    class: l.class,
    location: l.location,
    project: l.project,
    dimensions: { ...(l.dimensions || {}) },
  });

  const [lines, setLines] = useState<JournalEditorLine[]>(() => initialEntry?.lines.length
    ? initialEntry.lines.map((l, i) => toEditorLine(l, `initial-${i}`))
    : [
      toEditorLine({}, 'initial-first'),
      toEditorLine({}, 'initial-second'),
    ]);

  // BD-09 / CA-27: start from a saved template, or keep these lines as one
  const role = useCurrentRole();
  const canSaveTemplates = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const [templates, setTemplates] = useState<JournalTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState<string | null>(null);
  const chosenTemplate = templates.find(t => t.id === templateId);

  useEffect(() => {
    if (!isOpen || !workspaceId) return;
    let live = true;
    // templates are a convenience: the form works the same without them
    listJournalTemplates(workspaceId).then(list => { if (live) setTemplates(list); }).catch(() => {});
    return () => { live = false; };
  }, [isOpen, workspaceId]);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = templates.find(t => t.id === id);
    if (!template) return;
    const { lines: filled, missing } = formLines(template, accounts);
    while (filled.length < 2) filled.push({ accountId: '', accountName: '', debit: 0, credit: 0, dimensions: {} });
    setLines(filled.map(l => toEditorLine(l, `template-${nextLineKey.current++}`)));
    if (template.description) setDescription(template.description);
    setAdjusting(Boolean(template.adjusting));
    if (missing) toast.warning(`${missing} ${missing === 1 ? 'line was' : 'lines were'} left out: the account no longer exists`);
  };

  const saveTemplate = async () => {
    const input = { name: (templateName || '').trim(), description: description.trim(), adjusting, lines: templateLines(lines) };
    const problem = templateProblem(input, new Set(accounts.map(a => a.id)));
    if (problem) { toast.error(problem); return; }
    try {
      const { template, replaced } = await saveJournalTemplate(workspaceId, input);
      setTemplates(list => [...list.filter(t => t.id !== template.id), template].sort((a, b) => a.name.localeCompare(b.name)));
      setTemplateId(template.id);
      setTemplateName(null);
      toast.success(replaced ? `Template "${template.name}" replaced` : `Saved as the template "${template.name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const removeTemplate = async () => {
    if (!chosenTemplate || !safeConfirm(`Remove the template "${chosenTemplate.name}"? Entries already made from it stay as they are.`)) return;
    try {
      await removeJournalTemplate(workspaceId, chosenTemplate.id);
      setTemplates(list => list.filter(t => t.id !== chosenTemplate.id));
      setTemplateId('');
      toast.success(`Template "${chosenTemplate.name}" removed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const { dialogProps, titleId } = useDialog(onClose, isOpen);

  const transactions = useLedgerStore(s => s.transactions);
  const usedRates = useMemo(() => transactions
    .filter(t => t.originalCurrency && typeof t.exchangeRate === 'number')
    .map(t => ({ currency: t.originalCurrency, exchangeRate: t.exchangeRate, date: t.date })), [transactions]);
  const rateNote = useSuggestedRate({
    currency: transactionCurrency, homeCurrency: baseCurrency || 'USD', enabled: !rateTyped, docs: usedRates, date,
    onRate: rate => setExchangeRate(rate),
  });
  const currencyChoices = useMemo(() => documentCurrencies(baseCurrency || 'USD', transactionCurrency, usedRates), [baseCurrency, transactionCurrency, usedRates]);
  const chooseCurrency = (code: string) => { setTransactionCurrency(code); setExchangeRate(null); setRateTyped(false); };
  const analyticalPatternCache = useLedgerStore(s => s.analyticalPatternCache);
  const autoRules = useLedgerStore(s => s.autoRules);
  const matchingThreshold = useLedgerStore(s => s.matchingThreshold);
  const dimensionNodes = useLedgerStore(s => s.dimensionNodes);
  
  const engine = useMemo(() => new MatchingEngine(autoRules, analyticalPatternCache, undefined, matchingThreshold, transactions.filter(isPostable), dimensionNodes, accounts), [autoRules, analyticalPatternCache, transactions, matchingThreshold, dimensionNodes, accounts]);
  
  const spellChecker = useMemo(() => {
    const dictionary = [
      ...accounts.map(a => a.name),
      ...Object.keys(analyticalPatternCache || {})
    ];
    return new SpellChecker(dictionary);
  }, [accounts, analyticalPatternCache]);

  const handleDescriptionChange = (val: string) => {
    setDescription(val);
    
    // Spell Check Logic
    const words = val.split(/\s+/);
    const lastWord = words[words.length - 1];
    if (lastWord && lastWord.length > 3) {
      const closest = spellChecker.findClosest(lastWord, 1);
      if (closest && closest.toLowerCase() !== lastWord.toLowerCase()) {
        setSuggestion(closest);
      } else {
        setSuggestion(null);
      }
    } else {
      setSuggestion(null);
    }

    if (val.length > 3) {
      const match = engine.resolveCategory(val);
      if (match) {
        const found = accounts.find(a => a.name === match.accountName);
        if (found && lines[0].accountId === '') {
          setLines(prev => prev.map((lineItem, i) => i === 0 ? { ...lineItem, accountId: found.id, accountName: found.name } : lineItem));
          toast.info(`Smart Category: Suggesting ${found.name} based on rule patterns.`, { duration: 2000 });
        }
      }
    }
  };

  const totals = useMemo(() => {
    const debit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
    const credit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
    return { debit, credit, isBalanced: debit === credit && (debit > 0 || (lines.length >= 2 && lines.some(l => l.accountId))) };
  }, [lines]);
  const labelWarnings = requiredLabelWarnings(lines, date, workspace?.dimensions, accounts);
  // a line on an account that needs a label shows the label columns, so the warning can be acted on
  const labelRuleAccounts = useMemo(() => new Set(requiredLabelRules(workspace?.dimensions).flatMap(r => [...r.accountIds])), [workspace?.dimensions]);
  const dimensionsShown = showDimensions || lines.some(l => labelRuleAccounts.has(l.accountId));

  const createJournalLine = (): JournalEditorLine =>
    toEditorLine({ class: '', location: '', project: '', dimensions: {} }, `added-${nextLineKey.current++}`);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) {
      toast.error(`Ledger period is sealed. Cannot modify entries on or before ${lockDate}.`);
      return;
    }
    if (!totals.isBalanced) {
      toast.error('Journal entry must be balanced (Debits = Credits)');
      return;
    }

    try {
      const isForeignCurrency = transactionCurrency !== baseCurrency;
      if (isForeignCurrency && !(exchangeRate && exchangeRate > 0)) {
        toast.error(`Enter the exchange rate: how much 1 ${transactionCurrency} is in ${baseCurrency}`);
        return;
      }
      const appliedRate = isForeignCurrency ? exchangeRate as number : 1.0;
      
      const filteredLines = lines.filter(l => l.accountId && ((l.debit || 0) > 0 || (l.credit || 0) > 0));
      if (filteredLines.length < 2) {
        toast.error('At least two lines with account assignments are required for double-entry.');
        return;
      }

      const mappedLines = filteredLines.map(l => {
        const debitCents = l.debit || 0;
        const creditCents = l.credit || 0;
        const baseCents = Math.round((debitCents > 0 ? debitCents : -creditCents) * appliedRate);
        const rawDims = l.dimensions || {};
        const dims: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawDims)) {
          if (v) dims[k] = v;
        }
        if (l.class && !('class' in rawDims)) dims.class = l.class;
        if (l.location && !('location' in rawDims)) dims.location = l.location;
        if (l.project && !('project' in rawDims)) dims.project = l.project;
        if ((l as typeof l & { world?: string }).world && !('world' in rawDims)) dims.world = (l as typeof l & { world: string }).world;
        
        return {
          accountId: l.accountId,
          accountName: l.accountName,
          amountCents: baseCents,
          class: dims.class || undefined,
          location: dims.location || undefined,
          project: dims.project || undefined,
          dimensions: Object.keys(dims).length > 0 ? dims : undefined
        };
      });

      // Post any foreign currency rounding difference to an explicit rounding account
      const netImbalanceCents = mappedLines.reduce((sum, l) => sum + l.amountCents, 0);
      if (netImbalanceCents !== 0 && mappedLines.length > 0) {
        const roundingAccount = accounts.find(a => resolveAccountRole(a) === 'fx_rounding');
        if (!roundingAccount) {
          toast.error("Multi-currency rounding difference detected, but no FX rounding account exists. Please add an account with role 'fx_rounding'.");
          return;
        }
        mappedLines.push({
          accountId: roundingAccount.id,
          accountName: roundingAccount.name,
          amountCents: -netImbalanceCents,
          class: undefined,
          location: undefined,
          project: undefined,
          dimensions: undefined
        } as unknown as { accountId: string; accountName: string; amountCents: number; class: string | undefined; location: string | undefined; project: string | undefined; dimensions: Record<string, string> | undefined; });
      }

      const totalAmountCents = mappedLines
        .filter(l => l.amountCents > 0)
        .reduce((sum, l) => sum + l.amountCents, 0) || Math.round(totals.debit * appliedRate);

      const entryId = `tx_je_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const payload = {
        id: entryId,
        uid: user.uid,
        workspaceId,
        date,
        description,
        reference,
        totalAmountCents,
        currency: baseCurrency,
        originalCurrency: isForeignCurrency ? transactionCurrency : undefined,
        exchangeRate: isForeignCurrency ? appliedRate : undefined,
        type: 'journal',
        status: 'completed',
        lines: mappedLines,
        isCleared: true,
        // an adjusting entry (BD-03): marked so the journal can list and filter them
        ...(adjusting ? { metadata: { adjusting: true } } : {}),
      };

      const token = await getIdToken();
      if (autoReverse) {
        const problem = reversalDateProblem(date, reverseOn);
        if (problem) { toast.error(problem); return; }
      }
      // with a reversal: both entries in one request, so there is never one without the other (R-05)
      const res = autoReverse
        ? await fetch('/api/v1/transactions/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Idempotency-Key': payload.id },
          body: JSON.stringify({ transactions: withReversal(payload, reverseOn), workspaceId }),
        })
        : await fetch('/api/v1/transactions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'x-operation-id': payload.id
          },
          body: JSON.stringify({ transaction: payload })
        });

      if (!res.ok) {
        const errObj = await res.json().catch(() => ({}));
        throw new Error(errObj.error || `HTTP error ${res.status}`);
      }

      // PREV-5: another workspace was opened while the entry was on its way: say where it went
      if (workspaceChangedSince(workspaceId)) toast.info(savedInOtherWorkspace('The journal entry', workspaceId));
      else toast.success(autoReverse ? `Journal entry recorded; it reverses on ${reverseOn}` : 'Journal entry recorded');
      onClose();
      // Reset form
      setAutoReverse(false);
      setReverseOnTyped('');
      setDescription('');
      setReference('');
      setLines([
        toEditorLine({}, 'initial-first'),
        toEditorLine({}, 'initial-second'),
      ]);
    } catch (error) {
      console.error("Journal Entry Error:", error);
      // PREV-5: why, in words (it said only "Failed to record journal entry"); the entry stays in the form
      const described = describeError(error, 'create');
      toast.error(`Journal entry not recorded: ${described.title.charAt(0).toLowerCase()}${described.title.slice(1)}`, { description: described.remedy });
    }
  };

  const activeCurrency = (transactionCurrency && /^[A-Z]{3}$/.test(transactionCurrency)) ? transactionCurrency : (baseCurrency || 'USD');

  return (
    <AnimatePresence>
      {isOpen && (
        <div {...dialogProps} className="fixed inset-0 z-[300] flex items-center justify-center p-4">
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
            className="relative w-full max-w-4xl bg-[var(--surface)] rounded-2xl shadow-2xl border border-[var(--line)] overflow-hidden flex flex-col max-h-[95dvh] md:max-h-[90dvh]"
          >
            {/* Header */}
            <div className="p-4 md:p-6 lg:p-8 border-b border-[var(--line)] flex items-center justify-between bg-[var(--ink)]/30 gap-4">
              <div className="flex items-center gap-3 md:gap-4">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-[var(--brass)] text-[var(--ink)] rounded-xl flex items-center justify-center shadow-md shrink-0">
                  <ArrowRightLeft size={20} className="md:size-[24px]" />
                </div>
                <div>
                  <h2 id={titleId} className="text-xl md:text-2xl font-bold text-[var(--text)] tracking-tight">New Journal Entry</h2>
                  <p className="text-xs md:text-sm text-[var(--muted)] font-medium">Record manual adjustments to the ledger</p>
                </div>
              </div>
              <button aria-label="Close" onClick={onClose} className="p-2 hover:bg-[var(--ink)] rounded-full transition-colors shrink-0 cursor-pointer"><X size={20} className="text-[var(--muted)]" /></button>
            </div>

            {/* Form Content */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 space-y-6 md:space-y-8">
              {isLocked && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 flex items-start gap-3">
                  <AlertCircle size={20} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-xs uppercase tracking-wider">Accounting Period Sealed</p>
                    <p className="text-[11px] opacity-90 leading-relaxed mt-0.5">
                      This date ({date}) falls within a closed and sealed ledger accounting period (Lock ended: {lockDate}). 
                      Recording manual journal entries under sealed periods is strictly prohibited by GAAP/IFRS controls.
                    </p>
                  </div>
                </div>
              )}

              {/* Meta Info */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                <div className="space-y-2">
                  <label htmlFor="je-date" className="block text-[11px] font-bold text-[var(--muted)] uppercase tracking-widest">Date</label>
                  <input 
                    id="je-date"
                    type="date" 
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-4 md:px-5 py-3 md:py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:outline-none focus:border-[var(--brass-line)] focus:bg-[var(--surface)] transition-all font-bold text-[var(--text)]"
                  />
                </div>
                <div className="md:col-span-2 space-y-2 relative">
                  <label htmlFor="je-desc" className="block text-[11px] font-bold text-[var(--muted)] uppercase tracking-widest">Description</label>
                  <input 
                    id="je-desc"
                    type="text" 
                    required
                    value={description}
                    onChange={(e) => handleDescriptionChange(e.target.value)}
                    placeholder="e.g. Monthly depreciation adjustment"
                    className="w-full px-4 md:px-5 py-3 md:py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:outline-none focus:border-[var(--brass-line)] focus:bg-[var(--surface)] transition-all font-bold text-[var(--text)]"
                  />
                  
                  <AnimatePresence>
                    {suggestion && (
                      <motion.button
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        type="button"
                        onClick={() => {
                          const words = description.split(/\s+/);
                           words[words.length - 1] = suggestion;
                           setDescription(words.join(' ') + ' ');
                           setSuggestion(null);
                        }}
                        className="absolute right-4 top-1/2 translate-y-1 py-1 px-3 bg-[var(--brass-soft)] border border-[var(--brass-line)] text-[var(--brass)] rounded-lg text-[9px] font-black uppercase flex items-center gap-2 hover:bg-[var(--brass-soft)]/80 transition-all shadow-lg z-20 cursor-pointer"
                      >
                        <TypeIcon size={10} />
                        Did you mean "{suggestion}"?
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
                <div className="space-y-2">
                  <label htmlFor="je-ref" className="block text-[11px] font-bold text-[var(--muted)] uppercase tracking-widest">Reference (Optional)</label>
                  <input 
                    id="je-ref"
                    type="text" 
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="e.g. JE-2026-001"
                    className="w-full px-4 md:px-5 py-3 md:py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:outline-none focus:border-[var(--brass-line)] focus:bg-[var(--surface)] transition-all shadow-sm font-bold text-[var(--text)]"
                  />
                </div>
                
                <div className="space-y-2">
                   <label htmlFor="je-currency" className="block text-[11px] font-bold text-[var(--muted)] uppercase tracking-widest">Currency</label>
                   <select 
                     id="je-currency"
                     value={transactionCurrency}
                     onChange={(e) => chooseCurrency(e.target.value)}
                     className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:outline-none focus:border-[var(--brass-line)] focus:bg-[var(--surface)] transition-all font-bold appearance-none text-[var(--text)] cursor-pointer"
                   >
                     {currencyChoices.map(cur => (
                       <option key={cur} value={cur}>{cur}</option>
                     ))}
                   </select>
                </div>
                
                {transactionCurrency !== baseCurrency && (
                   <div className="space-y-2">
                     <label htmlFor="je-fx-rate" className="block text-[11px] font-bold text-[var(--muted)] uppercase tracking-widest">
                       {baseCurrency} for 1 {transactionCurrency}
                     </label>
                     <input 
                       id="je-fx-rate"
                       type="number" 
                       step="0.000001"
                       min="0"
                       value={exchangeRate ?? ''}
                       onChange={(e) => { setRateTyped(true); const n = Number.parseFloat(e.target.value); setExchangeRate(Number.isFinite(n) && n > 0 ? n : null); }}
                       placeholder="Type the rate"
                       required
                       className="w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:outline-none focus:border-[var(--brass-line)] focus:bg-[var(--surface)] transition-all font-mono font-bold text-[var(--text)]"
                     />
                     {rateNote && <p className="text-[11px] text-[var(--muted)]">{rateNote}</p>}
                   </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--text)]">
                <label htmlFor="je-auto-reverse" className="flex items-center gap-2 cursor-pointer">
                  <input id="je-auto-reverse" type="checkbox" checked={autoReverse} onChange={e => setAutoReverse(e.target.checked)} />
                  Reverse automatically (an accrual)
                </label>
                <label htmlFor="je-adjusting" className="flex items-center gap-2 cursor-pointer" title="An accountant's adjustment: year-end, audit or correction">
                  <input id="je-adjusting" type="checkbox" checked={adjusting} onChange={e => setAdjusting(e.target.checked)} />
                  Adjusting entry
                </label>
                {autoReverse && (
                  <label htmlFor="je-reverse-on" className="flex items-center gap-2">
                    <span className="text-[var(--muted)]">on</span>
                    <input id="je-reverse-on" type="date" value={reverseOn} min={date || undefined} onChange={e => setReverseOnTyped(e.target.value)}
                      className="px-3 py-1.5 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-[var(--text)]" />
                  </label>
                )}
              </div>

              {(templates.length > 0 || canSaveTemplates) && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text)]">
                  {templates.length > 0 && (
                    <label htmlFor="je-template" className="flex items-center gap-2">
                      <span className="text-[var(--muted)]">Start from a template</span>
                      <select id="je-template" value={templateId} onChange={e => applyTemplate(e.target.value)}
                        className="px-3 py-1.5 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-[var(--text)] cursor-pointer">
                        <option value="">Choose…</option>
                        {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                  )}
                  {chosenTemplate && <span className="text-xs text-[var(--muted)]">{templateSummary(chosenTemplate, c => formatCurrency(c, activeCurrency))}</span>}
                  {chosenTemplate && canSaveTemplates && (
                    <button type="button" onClick={() => void removeTemplate()} className="text-xs text-[var(--muted)] hover:text-rose-600 cursor-pointer">Remove template</button>
                  )}
                  {canSaveTemplates && (templateName === null ? (
                    <button type="button" onClick={() => setTemplateName(chosenTemplate?.name || description.trim())}
                      className="text-xs font-semibold text-[var(--brass)] hover:underline cursor-pointer">Save as template</button>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <input aria-label="Template name" value={templateName} maxLength={60} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Monthly payroll accrual"
                        dir="auto" className="px-3 py-1.5 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-[var(--text)]" />
                      <button type="button" onClick={() => void saveTemplate()} disabled={!templateName.trim()}
                        className="px-3 py-1.5 text-xs rounded-lg bg-[var(--brass)] text-[var(--ink)] font-bold disabled:opacity-50 cursor-pointer">Save template</button>
                      <button type="button" onClick={() => setTemplateName(null)} className="text-xs text-[var(--muted)] hover:underline cursor-pointer">Cancel</button>
                      <span className="text-[11px] text-[var(--muted)]">Keeps the accounts and any amounts typed; leave amounts empty to type them each time.</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Lines Table */}
              <DocumentLineEditor
                side="journal"
                lines={lines}
                onChange={setLines}
                createLine={createJournalLine}
                accounts={accounts}
                currency={activeCurrency}
                date={date}
                showDimensions={showDimensions}
                onShowDimensionsChange={setShowDimensions}
                dimensionsShown={dimensionsShown}
                activeDimensions={activeDimensions}
              />

              {/* Validation Status */}
              <div className={cn(
                "p-4 md:p-5 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all duration-300 shadow-sm",
                totals.isBalanced 
                  ? "bg-[var(--pos)]/10 border-[var(--pos)]/30 text-[var(--pos)]" 
                  : "bg-rose-500/10 border-rose-500/30 text-rose-500"
              )}>
                <div className="flex items-start sm:items-center gap-3">
                  {totals.isBalanced ? <CheckCircle2 size={22} className="shrink-0 mt-1 sm:mt-0" /> : <AlertCircle size={22} className="shrink-0 mt-1 sm:mt-0" />}
                  <div>
                    <p className="font-bold text-xs uppercase tracking-wider">{totals.isBalanced ? "TOPOLOGY SYNCED: BALANCED" : "IMBALANCE DETECTED"}</p>
                    <p className="text-xs opacity-90 font-medium mt-0.5">
                      {totals.isBalanced 
                        ? "The total debits equal the total credits. Your fiscal structure is integrity-verified." 
                        : "Dimensional mismatch: Debits and credits must be equivalent to commit."}
                    </p>
                  </div>
                </div>
                <div className="text-left sm:text-right shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-60">Delta</p>
                  <p className="text-lg font-bold font-mono tracking-tight tabular-nums">{formatCurrency(Math.abs(totals.debit - totals.credit), activeCurrency)}</p>
                </div>
              </div>
              {/* Z-12: labels the workspace requires on these accounts (a warning; saving still works) */}
              {labelWarnings.length > 0 && (
                <ul role="status" aria-label="Required labels missing" className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                  {labelWarnings.map(w => <li key={w}>{w}</li>)}
                </ul>
              )}
            </form>

            {/* Footer Actions */}
            <div className="p-4 md:p-6 border-t border-[var(--line)] bg-[var(--ink)]/30 flex flex-col sm:flex-row gap-3">
              <button 
                type="button"
                onClick={onClose}
                className="py-3 px-4 bg-[var(--surface)] border border-[var(--line)] text-[var(--muted)] rounded-xl font-bold hover:bg-[var(--ink)] hover:text-[var(--text)] transition-all order-2 sm:order-1 sm:flex-1 cursor-pointer text-xs uppercase tracking-wider"
               aria-label="Discard Entry">
                Discard Entry
              </button>
              <AsyncButton 
                onClick={handleSubmit}
                disabled={!totals.isBalanced || isLocked}
                loadingText="COMMITTING..."
                className={cn(
                  "py-3 px-4 rounded-xl font-bold transition-all shadow-md order-1 sm:order-2 sm:flex-[2] text-xs uppercase tracking-wider",
                  (totals.isBalanced && !isLocked)
                    ? "bg-[var(--brass)] text-[var(--ink)] hover:opacity-90 cursor-pointer" 
                    : "bg-[var(--ink)] text-[var(--muted)] cursor-not-allowed shadow-none"
                )}
              >
                {isLocked ? "PERIOD IS SEALED" : "COMMIT TO LEDGER"}
              </AsyncButton>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
