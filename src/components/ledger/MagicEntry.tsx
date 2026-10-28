import { useDialog } from '../../hooks/useDialog';
import React, { useState, useEffect, useId } from 'react';
import { aiService } from '../../services/aiService';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { parseNaturalLanguageEntry } from '../../lib/algorithms/nl-parser';
import { Check, Wand2, Camera, X, Loader2, Edit2 } from 'lucide-react';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { toast } from 'sonner';
import { getLocalDateISO, formatCurrency } from '../../lib/utils';
import { resolveAccountRole } from '../../lib/accountUtils';
import { isCashAccount } from '../../lib/txFilters';
import AsyncButton from '../ui/AsyncButton';
import { focusOnMount } from '../../lib/focusOnMount';

export default function MagicEntry({ isOpen, onClose }: { isOpen?: boolean; onClose?: () => void; onAdd?: (data: Partial<import("../../types").Transaction> & { amount: number }) => void; categories?: string[]; accounts?: import("../../types").ChartAccount[]; projects?: string[]; autoRules?: import("../../types").AutoRule[]; patternCache?: Record<string, unknown> }) {
  const formId = useId();
  const [isAiParsing, setIsAiParsing] = useState(false);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<{ action?: string; amount: number; description?: string; method?: string; dateStr?: string } | null>(null);
  const [, setReceiptMode] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const { handleQuickAdd, handleParseReceipt } = useTransactionActions();

  const isModal = isOpen !== undefined;
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(() => onClose?.(), !!isModal && isOpen !== false);

  const handleParse = (val: string) => {
    setText(val);
    if (val.length < 5) {
      setParsed(null);
    }
  };

  useEffect(() => {
    if (text.length < 5) return;
    const timer = setTimeout(async () => {
      setIsAiParsing(true);
      try {
        const { accounts, projects } = useLedgerStore.getState();
        const catNames = accounts.map(a => a.name);
        const projNames = projects.map(p => p.name) || [];
        const resultArr = await aiService.parseMagicEntry(text, catNames, accounts, projNames);
        if (resultArr && resultArr.length > 0) {
          const r = resultArr[0];
          setParsed({
            action: r.amountCents < 0 ? 'expense' : 'revenue',
            amount: Math.abs(r.amountCents),
            description: r.description,
            method: r.dimensions?.account || 'Default',
            dateStr: r.date
          });
        } else {
          const fallback = parseNaturalLanguageEntry(text);
          setParsed({
            action: fallback.action,
            amount: fallback.amountCents || 0,
            description: fallback.description,
            method: fallback.method,
            dateStr: fallback.dateStr
          });
        }
      } catch {
        const fallback = parseNaturalLanguageEntry(text);
        setParsed({
            action: fallback.action,
            amount: fallback.amountCents || 0,
            description: fallback.description,
            method: fallback.method,
            dateStr: fallback.dateStr
        });
      } finally {
        setIsAiParsing(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [text]);

  const handleUploadReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Call it normally as a hook if we can, but since this is inside a component, we can destructure it at the top level.
    if (handleParseReceipt) {
      await handleParseReceipt(file);
      if (onClose) onClose();
    }
  };

  const handleSave = async () => {
    if (!parsed) return;
    {
       // the quick-entry window used to hand only { amount } to onAdd, which the save ignores: the entry
       // reached the server with no lines and was refused ('at least 2 lines required'). Build both lines here.
       const { accounts } = useLedgerStore.getState();
       const actionType = parsed.action || 'expense';
       const isExp = actionType === 'expense';
       const targetAcc = accounts.find(a => resolveAccountRole(a) === (isExp ? 'expense' : 'revenue')) || accounts.find(a => a.type === (isExp ? 'expense' : 'income')) || accounts[0];
       const cashAcc = accounts.find(a => resolveAccountRole(a) === 'cash') || accounts.find(a => isCashAccount(a)) || accounts[0];

       if (!targetAcc || !cashAcc) {
         toast.error('Cannot post transaction: No chart of accounts available.');
         return;
       }

       const amt = Math.abs(parsed.amount || 0);
       if (!amt) {
         toast.error('Enter an amount, for example "Paid $45 for lunch".');
         return;
       }
       const saved = await handleQuickAdd({
         description: parsed.description || 'Natural Language Entry',
         totalAmountCents: amt,
         date: parsed.dateStr || getLocalDateISO(),
         type: actionType as import("../../types").Transaction['type'],
         lines: [
           {
             accountId: targetAcc.id,
             accountName: targetAcc.name,
             description: parsed.description,
             amountCents: isExp ? amt : -amt
           },
           {
             accountId: cashAcc.id,
             accountName: cashAcc.name,
             amountCents: isExp ? -amt : amt
           }
         ]
       });
       // handleQuickAdd says "added" itself once the server saved it
       if (!saved) return;
    }
    setText('');
    setParsed(null);
    setReceiptMode(false);
    setIsEditing(false);
    if (onClose) onClose();
  };

  const content = (
    <div className="p-6 space-y-6">
      <div className="relative">
        <input 
          aria-label="Describe the transaction"
          ref={focusOnMount}
          className="w-full text-lg py-6 pl-12 pr-32 rounded-xl border border-[var(--line)] bg-[var(--panel)] text-[var(--text)] shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brass)] focus:border-[var(--brass)] placeholder:text-[var(--faint)]"
          placeholder="e.g., paid $40 gas cash yesterday"
          value={text}
          onChange={(e) => handleParse(e.target.value)}
        />
        {isAiParsing ? <Loader2 aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--brass)] w-5 h-5 animate-spin" /> : <Wand2 aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--brass)] w-5 h-5" />}
        <label htmlFor={`${formId}-receipt`} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)] px-3 py-2 rounded-lg font-medium text-sm flex items-center transition-colors cursor-pointer">
          <Camera aria-hidden="true" className="w-4 h-4 mr-2" /> Snap Receipt
          <input id={`${formId}-receipt`} type="file" accept="image/*" className="hidden" onChange={handleUploadReceipt} />
        </label>
      </div>

      {parsed && (
        <div className="mt-8 bg-[var(--panel)] border border-[var(--line)] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">We understood:</h3>
          </div>
          {isEditing ? (
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Amount ($)</p>
                <input 
                  aria-label="Amount ($)"
                  type="number" 
                  step="0.01"
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded p-2 text-sm focus:outline-none focus:border-[var(--brass)] text-[var(--text)]"
                  value={(parsed.amount / 100).toFixed(2)}
                  onChange={(e) => setParsed({...parsed, amount: Math.round(parseFloat(e.target.value || '0') * 100)})}
                />
              </div>
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Action</p>
                <select 
                  aria-label="Action"
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded p-2 text-sm focus:outline-none focus:border-[var(--brass)] text-[var(--text)]"
                  value={parsed.action}
                  onChange={(e) => setParsed({...parsed, action: e.target.value})}
                >
                  <option value="expense">Expense (Out)</option>
                  <option value="revenue">Revenue (In)</option>
                </select>
              </div>
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Method</p>
                <input 
                  aria-label="Method"
                  type="text" 
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded p-2 text-sm focus:outline-none focus:border-[var(--brass)] text-[var(--text)]"
                  value={parsed.method}
                  onChange={(e) => setParsed({...parsed, method: e.target.value})}
                />
              </div>
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Date</p>
                <input 
                  aria-label="Date"
                  type="date" 
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded p-2 text-sm focus:outline-none focus:border-[var(--brass)] text-[var(--text)]"
                  value={parsed.dateStr}
                  onChange={(e) => setParsed({...parsed, dateStr: e.target.value})}
                />
              </div>
              <div className="col-span-2">
                <p className="text-xs text-[var(--faint)] mb-1">Description / Category</p>
                <input 
                  aria-label="Description / Category"
                  type="text" 
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded p-2 text-sm focus:outline-none focus:border-[var(--brass)] text-[var(--text)]"
                  value={parsed.description}
                  onChange={(e) => setParsed({...parsed, description: e.target.value})}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Amount</p>
                <p className={`text-xl font-bold tabular-nums ${parsed.action === 'expense' ? 'text-[var(--neg)]' : 'text-[var(--pos)]'}`}>
                  {formatCurrency(Math.abs(parsed.amount))} {parsed.action === 'expense' ? 'Out' : 'In'}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Method</p>
                <p className="text-lg font-medium text-[var(--text)]">{parsed.method}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Description / Category</p>
                <p className="text-lg font-medium text-[var(--text)] capitalize">{parsed.description || 'General'}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Date</p>
                <p className="text-lg font-medium text-[var(--text)]">{parsed.dateStr}</p>
              </div>
            </div>
          )}
          
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            {!isEditing ? (
              <button 
                className="w-full sm:w-1/3 bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] font-medium py-3 px-4 rounded-xl transition-colors hover:bg-[var(--elevated)] shadow-sm flex items-center justify-center"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 aria-hidden="true" className="w-4 h-4 mr-2" /> Edit Details
              </button>
            ) : (
              <button 
                className="w-full sm:w-1/3 bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] font-medium py-3 px-4 rounded-xl transition-colors hover:bg-[var(--elevated)] shadow-sm flex items-center justify-center"
                onClick={() => setIsEditing(false)}
              >
                Done Editing
              </button>
            )}
            <AsyncButton 
              className="w-full sm:flex-1 bg-[var(--brass)] text-[var(--ink)] font-bold py-3 px-4 rounded-xl flex items-center justify-center transition-opacity hover:opacity-90 shadow-md"
              onClick={handleSave}
              loadingText="Saving..."
            >
              <Check aria-hidden="true" className="w-4 h-4 mr-2" /> Looks Right - Save It
            </AsyncButton>
          </div>
        </div>
      )}
      
      <div className="flex flex-wrap gap-2 justify-center pt-4">
        <span className="text-xs text-[var(--muted)]">Try typing:</span>
        <button className="text-xs bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] px-2 py-0.5 rounded cursor-pointer hover:bg-[var(--elevated)]" type="button" onClick={() => handleParse("earned $1500 client retainer check today")}>earned $1500 client retainer check today</button>
        <button className="text-xs bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] px-2 py-0.5 rounded cursor-pointer hover:bg-[var(--elevated)]" type="button" onClick={() => handleParse("paid $80 lunch card yesterday")}>paid $80 lunch card yesterday</button>
      </div>
    </div>
  );

  if (isOpen === false) return null;

  if (isModal) {
    return (
      <div {...overlayDialogProps} className="fixed inset-0 z-[300] flex items-center justify-center p-4">
        <div role="presentation" aria-hidden="true" className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-2xl bg-[var(--surface)] rounded-2xl shadow-2xl border border-[var(--line)] overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-[var(--line)]">
            <div>
              <h2 id={overlayTitleId} className="text-2xl font-bold tracking-tight">Magic Entry</h2>
              <p className="text-[var(--muted)]">Just type what happened. No debit/credit knowledge required.</p>
            </div>
            {onClose && (
              <button aria-label="Close" onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-[var(--muted)]"><X aria-hidden="true" className="w-5 h-5" /></button>
            )}
          </div>
          {content}
        </div>
      </div>
    );
  }

  // Full page view
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Magic Entry</h1>
        <p className="text-[var(--muted)]">Just type what happened. No debit/credit knowledge required.</p>
      </div>
      <div className="bg-[var(--surface)] rounded-xl shadow-sm border border-[var(--line)] overflow-hidden">
        {content}
      </div>
    </div>
  );
}
