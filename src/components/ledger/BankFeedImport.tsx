import { useDialog } from '../../hooks/useDialog';
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Check, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Transaction, ChartAccount, AutoRule } from '../../types';
import { suggestFromRules } from '../../lib/bankRules';
import { cn, reportError, OperationType, formatCurrency } from '../../lib/utils';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { toast } from 'sonner';
import { collection, getDocs, query, where, limit } from '../../lib/db/firestore';
import { db, getIdToken } from '../../firebase';
import { MatchingEngine } from '../../lib/MatchingEngine';
import { generateImportIdentity } from '../../lib/algorithms';
import { isPostable } from '../../lib/txFilters';
import CategoryWhyPopover from '../common/CategoryWhyPopover';
import PlaidConnectButton from '../finance/PlaidConnectButton';

interface BankFeedRow {
  id: string; date: string; description: string; amountCents: number; category?: string; accountId?: string; confidence?: number; matchSource?: string; dimensions?: Record<string, string>;
}

interface BankFeedImportProps {
  workspaceId: string;
  accounts: ChartAccount[];
  onImport: (transactions: Partial<Transaction>[]) => void;
  onClose: () => void;
}

const BankFeedImport: React.FC<BankFeedImportProps> = ({
  workspaceId,
  accounts,
  onImport,
  onClose
}) => {
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(onClose, true);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const [rawTransactions, setRawTransactions] = useState<BankFeedRow[]>([]);
  const [mappedTransactions, setMappedTransactions] = useState<BankFeedRow[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const user = useAuthStore(s => s.user);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  useAuthStore(s => s.userProfile);
  const matchingThreshold = useLedgerStore(state => state.matchingThreshold);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false
  });

  const handleUpload = async () => {
    if (!file || !user) return;
    setIsUploading(true);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workspaceId', workspaceId);

    try {
      const token = await getIdToken();
      const res = await fetch('/api/upload-bank-csv', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRawTransactions(data);
      handleAutoMap(data);
    } catch (err) {
      reportError(err, OperationType.SYNC, 'bank_upload', { fileName: file.name });
    } finally {
      setIsUploading(false);
    }
  };

  const fetchFromPlaid = async () => {
    if (!user) return;
    setIsUploading(true);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/v1/plaid/sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: currentWorkspaceId })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (Array.isArray(data.needsReconnect) && data.needsReconnect.length > 0) {
        toast.warning(`${data.needsReconnect.length} bank connection(s) need you to log in again: open Banking → Reconnect.`);
      }
      if (Array.isArray(data.failed) && data.failed.length > 0) {
        toast.warning(`${data.failed.length} bank connection(s) could not be synced: see Banking → Connected banks for why.`);
      }

      // AF-001: the server already stored these rows as bank lines (with the cursor, in one transaction);
      // booking them again here would make a second record of the same bank event (Codex on #439)
      // the lines actually added, not Plaid's raw rows (card holds and rows already stored are not new lines)
      const count = typeof data.storedLines === 'number' ? data.storedLines : 0;
      if (count > 0) toast.success(`${count} bank line(s) downloaded. Review and match them in Banking → Reconciliation.`);
      else toast.info('Bank feed synced. No new bank lines.');
      onClose();
    } catch (err) {
      reportError(err, OperationType.SYNC, 'plaid_sync');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAutoMap = async (transactions: BankFeedRow[]) => {
    if (!user) return;
    setIsMapping(true);
    try {
      // Fetch automated rules for local deterministic evaluation
      const qRules = query(
        collection(db, 'autoRules'),
        // EG-9: the workspace's rules, whoever made them (the server suggests from the same rules)
        where('workspaceId', '==', workspaceId)
      );
      const rulesSnap = await getDocs(qRules);
      const activeRules = rulesSnap.docs.map(d => ({ id: d.id, ...d.data() } as AutoRule));

      // Fetch sample historical fields to train dynamic Bayesian auto-learner
      const qHistory = query(
        collection(db, 'transactions'),
        where('workspaceId', '==', workspaceId),
        where('uid', '==', user.uid),
        limit(1000)
      );
      const historySnap = await getDocs(qHistory);
      const historicalTxs = historySnap.docs.map(d => d.data() as Transaction).filter(isPostable);

      const dimensionNodes = useLedgerStore.getState().dimensionNodes;
      const localEngine = new MatchingEngine(activeRules, {}, '', Math.max(0.5, matchingThreshold - 0.03), historicalTxs, dimensionNodes, accounts);

      const resolvedBatch: BankFeedRow[] = [];
      const outstandingForAI: BankFeedRow[] = [];

      for (const t of transactions) {
        // Step A: Check if Excel/CSV row already contains a pre-labeled category! (Bypass of AI)
        if (t.category && typeof t.category === 'string' && t.category.trim().length > 0) {
          const rawCat = t.category.trim().toLowerCase();
          
          // Try to map exactly to account name or account code (skip archived/inactive)
          const matchedAcct = accounts.find(a => 
            !a.archived && !(a as ChartAccount & { isArchived?: boolean }).isArchived && a.isActive !== false && (
              a.name.toLowerCase() === rawCat || 
              a.code === rawCat ||
              a.name.toLowerCase().includes(rawCat)
            )
          );

          if (matchedAcct) {
            resolvedBatch.push({
              ...t,
              accountId: matchedAcct.id,
              category: matchedAcct.name,
              confidence: 1.0,
              matchSource: 'Excel/CSV Labeled'
            });
            continue;
          }
        }

        // Step A.5 (EG-9): the bank rules, the same pure function the server runs on every imported line
        const ruled = suggestFromRules(activeRules, { description: t.description, amountCents: t.amountCents, date: t.date }, { accounts });
        const ruledAcct = ruled?.accountId ? accounts.find(a => a.id === ruled.accountId) : undefined;
        if (ruled && ruledAcct) {
          resolvedBatch.push({ ...t, accountId: ruledAcct.id, category: ruledAcct.name, confidence: 1, matchSource: `Rule: ${ruled.ruleIds[0]}`, dimensions: Object.keys(ruled.dimensions).length ? ruled.dimensions : undefined });
          continue;
        }

        // Step B: Match with high-efficiency local rule engine OR dynamic Bayesian classification
        const dbg = localEngine.debugResolveCategory(t.description);
        if (dbg && dbg.accountName !== 'Manual Review') {
          const matchedAcct = accounts.find(a => a.name === dbg.accountName);
          if (matchedAcct) {
            const source = dbg.layer.includes('Rule:') ? 'Local Rule Machine' : 'Dynamic Auto-Learner';
            resolvedBatch.push({
              ...t,
              accountId: matchedAcct.id,
              category: matchedAcct.name,
              confidence: Number(dbg.confidence?.toFixed(2)) || 0.95,
              matchSource: dbg.layer || source,
              dimensions: dbg.dimensions || undefined
            });
            continue;
          }
        }

        // Step C: Otherwise, delegate to external analysis
        outstandingForAI.push(t);
      }

      // Step C: Process remaining using fast mathematical model fallback (Bypassing LLMs for speed and strict deterministic mapping)
      const aiMapped: Partial<BankFeedRow>[] = [];
      if (outstandingForAI.length > 0) {
        outstandingForAI.forEach(t => {
          const dbg = localEngine.debugResolveCategory(t.description);
          // If the fallback engine resolves exactly to "Manual Review", let it stay as Uncategorized for manual review, otherwise map it
          const matchedAcct = 
            (dbg && dbg.accountName !== 'Manual Review') 
              ? accounts.find(a => a.name === dbg.accountName) 
              : null;
          
          if (matchedAcct) {
            aiMapped.push({
              id: t.id,
              accountId: matchedAcct.id,
              category: matchedAcct.name,
              confidence: Number(dbg.confidence?.toFixed(2)) || 0.65,
              matchSource: dbg.layer || 'Fast Math Model Fallback',
              dimensions: dbg.dimensions || undefined
            });
          } else {
            // Put it into Manual Review
            const uncatAcc = accounts.find(a => a.name === 'Uncategorized') || accounts.find(a => a.type === 'expense') || accounts[0];
            aiMapped.push({
              id: t.id,
              accountId: uncatAcc?.id || '',
              category: uncatAcc?.name || 'Uncategorized',
              confidence: 0,
              matchSource: dbg.layer || 'Classification Insufficient - Manual Review',
              dimensions: dbg.dimensions || undefined
            });
          }
        });
      }

      // Combine direct matches with AI/fallback mappings
      const combined = transactions.map(t => {
        const resolvedDirect = resolvedBatch.find(m => m.id === t.id);
        if (resolvedDirect) return resolvedDirect;

        const resolvedAI = aiMapped.find(m => m.id === t.id);
        return { ...t, ...resolvedAI };
      });

      setMappedTransactions(combined);
      setSelectedIndices(new Set(combined.keys()));
    } catch (err) {
      reportError(err, OperationType.SYNC, 'bank_auto_map');
    } finally {
      setIsMapping(false);
    }
  };

  const handleConfirm = () => {
    if (!user) return;
    const toImport = mappedTransactions
      .filter((_, idx) => selectedIndices.has(idx))
      .map((t, idx) => {
        const fallbackAcc = accounts.find(a => a.name === 'Uncategorized') || accounts.find(a => a.type === 'expense') || accounts[0];
        const accountId = t.accountId || fallbackAcc?.id || '';
        const account = accounts.find(a => a.id === accountId);
        const importIdentity = generateImportIdentity('bank_feed', 'feed_item', {
          date: t.date,
          amountCents: t.amountCents,
          description: t.description,
          reference: t.id
        }, idx);
        
        return {
          uid: user.uid,
          workspaceId,
          date: t.date,
          description: t.description,
          totalAmountCents: t.amountCents,
          type: 'actual' as const,
          status: 'completed' as const,
          isCleared: true,
          importIdentity,
          lines: [
            {
              accountId: accountId,
              accountName: account?.name || 'Uncategorized',
              amountCents: t.amountCents // For imported expenses, assume debit for the category
            },
            {
              accountId: 'offset-bank', // In a real app, this would be the bank account selected
              accountName: 'Bank Account (Imported)',
              amountCents: -t.amountCents
            }
          ],
          createdAt: new Date().toISOString()
        };
      });
    
    onImport(toImport);
    onClose();
  };

  return (
    <div {...overlayDialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[var(--ink)] rounded-[40px] shadow-2xl w-full max-w-4xl max-h-[90dvh] flex flex-col overflow-hidden border border-[var(--line)]"
      >
        <div className="p-4 md:p-8 border-b border-[var(--line)] flex items-center justify-between bg-[var(--ink)]/30">
          <div>
            <h2 id={overlayTitleId} className="text-xl font-black text-[var(--text)] uppercase italic tracking-tighter">Import bank feed</h2>
            <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] mt-1 opacity-40">CSV import with rule-based categorization</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 bg-[var(--ink)] hover:bg-slate-200 rounded-[32px] flex items-center justify-center text-[var(--muted)] transition-all" aria-label="Close">
            <AlertCircle aria-hidden="true" className="rotate-45" size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 md:p-8 bg-[var(--ink)]">
          {!rawTransactions.length ? (
            <div 
              {...getRootProps()} 
              className={cn(
                "border-2 border-dashed rounded-[32px] p-20 flex flex-col items-center justify-center transition-all cursor-pointer group",
                isDragActive ? "border-indigo-600 bg-indigo-600/5" : "border-[var(--line)] hover:border-indigo-600/30 hover:bg-[var(--ink)]/20"
              )}
            >
              <input {...getInputProps()} aria-label="Upload bank statement" />
              <div className="w-24 h-24 bg-[var(--ink)] rounded-[32px] flex items-center justify-center mb-8 border border-[var(--line)] group-hover:scale-110 transition-transform">
                <Upload aria-hidden="true" className={cn("text-[var(--muted)] group-hover:text-indigo-600 transition-colors", isDragActive && "text-indigo-600")} size={40} />
              </div>
              {file ? (
                <div className="text-center">
                  <p className="text-lg font-black text-[var(--text)] italic uppercase tracking-tight">{file.name}</p>
                  <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest mt-1">{(file.size / 1024).toFixed(1)} KB file</p>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleUpload(); }}
                    disabled={isUploading}
                    className="mt-10 px-10 py-3 bg-indigo-600 text-white rounded-[32px] font-black uppercase tracking-[0.2em] text-xs hover:brightness-110 transition-all flex items-center gap-3 shadow-xl shadow-ledger-accent/20"
                  >
                    {isUploading ? <Loader2 aria-hidden="true" className="animate-spin" size={18} /> : <ArrowRight aria-hidden="true" size={18} />}
                    Upload file
                  </button>
                </div>
              ) : (
                <div className="text-center flex flex-col items-center">
                  <p className="text-lg font-black text-[var(--text)] uppercase italic tracking-tighter">Upload bank statement</p>
                  <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.3em] mt-2 opacity-40 mb-8">Drop a CSV file here, or click to browse</p>
                  
                  <div role="presentation" className="flex gap-4 items-center mt-4" onClick={(e) => e.stopPropagation()}>
                    <PlaidConnectButton />
                    <button 
                      onClick={(e) => { e.stopPropagation(); fetchFromPlaid(); }}
                      disabled={isUploading}
                      className="h-12 px-6 bg-slate-900 hover:bg-black text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-sm flex items-center gap-2 active:scale-95 disabled:opacity-50"
                    >
                      {isUploading ? <Loader2 aria-hidden="true" size={14} className="animate-spin" /> : <ArrowRight aria-hidden="true" size={14} />}
                      Sync from Plaid
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                   <div className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
                   <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em]">
                    {isMapping ? "Categorizing with rules..." : `${mappedTransactions.length} rows ready`}
                  </p>
                </div>
                {!isMapping && (
                  <button 
                    onClick={() => setSelectedIndices(new Set(mappedTransactions.keys()))}
                    className="text-[10px] text-indigo-600 font-black uppercase tracking-[0.2em] hover:underline"
                  >
                    Select all
                  </button>
                )}
              </div>

              <div className="border border-[var(--line)] rounded-[32px] overflow-hidden bg-[var(--surface)]/50">
                <table className="w-full text-left text-sm border-collapse">
                  <caption className="sr-only">Imported bank lines</caption>
                  <thead>
                    <tr className="bg-[var(--ink)]/50 border-b border-[var(--line)]">
                      <th scope="col" className="px-6 py-4 w-12"><span className="sr-only">Actions</span></th>
                      <th scope="col" className="px-4 py-4 font-black text-[var(--muted)] uppercase tracking-widest text-[9px]">Date</th>
                      <th scope="col" className="px-4 py-4 font-black text-[var(--muted)] uppercase tracking-widest text-[9px]">Description</th>
                      <th scope="col" className="px-4 py-4 font-black text-[var(--muted)] uppercase tracking-widest text-[9px]">Amount</th>
                      <th scope="col" className="px-4 py-4 font-black text-[var(--muted)] uppercase tracking-widest text-[9px]">Suggested category</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ledger-line/50">
                    {mappedTransactions.map((tx, idx) => (
                      <tr key={tx.id} className={cn("hover:bg-[var(--ink)]/30 transition-all group", !selectedIndices.has(idx) && "opacity-30")}>
                        <td className="px-6 py-4">
                          <button aria-label={`${selectedIndices.has(idx) ? "Deselect" : "Select"} bank statement row ${idx + 1}`}
                            onClick={() => {
                              const next = new Set(selectedIndices);
                              if (next.has(idx)) next.delete(idx);
                              else next.add(idx);
                              setSelectedIndices(next);
                            }}
                            className={cn(
                              "w-6 h-6 rounded-lg border flex items-center justify-center transition-all",
                              selectedIndices.has(idx) ? "bg-indigo-600 border-indigo-600 text-white" : "border-[var(--line)] bg-[var(--ink)]"
                            )}
                          >
                            {selectedIndices.has(idx) && <Check aria-hidden="true" size={14} />}
                          </button>
                        </td>
                        <td className="px-4 py-4 text-[11px] font-mono font-bold text-[var(--muted)]">{tx.date}</td>
                        <td className="px-4 py-4 font-black text-[var(--text)] italic uppercase tracking-tight text-xs">{tx.description}</td>
                        <td className="px-4 py-4 font-mono font-black text-[var(--text)] text-sm tabular-nums">
                          {formatCurrency(tx.amountCents)}
                        </td>
                        <td className="px-4 py-4">
                          {isMapping ? (
                            <div className="h-2 w-24 bg-[var(--ink)] animate-pulse rounded-full" />
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <span className="px-3 py-1 bg-indigo-600/10 text-indigo-600 border border-indigo-600/20 rounded-lg text-[9px] font-medium uppercase tracking-wider">
                                  {tx.category || 'PENDING'}
                                </span>
                                <CategoryWhyPopover 
                                  description={tx.description}
                                  accountName={tx.category}
                                />
                                <span className="text-[9px] font-mono text-slate-500/40 font-bold uppercase tracking-tighter">
                                  {Math.round((tx.confidence || 0) * 100)}% Match
                                </span>
                              </div>
                              {tx.matchSource && (
                                <span className="text-[8px] text-emerald-600 dark:text-emerald-400 uppercase tracking-widest font-black italic mt-0.5">
                                  {tx.matchSource}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 md:p-8 border-t border-[var(--line)] flex items-center justify-end gap-5 bg-[var(--ink)]/20">
          <button onClick={onClose} className="px-8 py-3 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] hover:text-[var(--text)] transition-all" aria-label="Cancel">
            Cancel
          </button>
          <button 
            onClick={handleConfirm}
            disabled={!selectedIndices.size || isMapping}
            className="px-10 py-3 bg-indigo-600 text-white rounded-[32px] font-black uppercase tracking-[0.2em] text-xs hover:brightness-110 disabled:opacity-30 disabled:grayscale transition-all shadow-xl shadow-ledger-accent/20"
           aria-label="Import selected rows">
            Import {selectedIndices.size} rows
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default BankFeedImport;
