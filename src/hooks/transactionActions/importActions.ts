import { validateReceiptPayload, mapReceiptToCoordinates } from '../../lib/receiptIngestion';
import { collection, doc } from '../../lib/db/firestore';
import { db } from '../../firebase';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { MatchingEngine } from '../../lib/MatchingEngine';
import { Transaction, ChartAccount } from '../../types';
import { toast } from 'sonner';
import { aiService } from '../../services/aiService';
import { DoubleEntryAuditor } from '../../services/auditor';
import { getLocalDateISO } from '../../lib/utils';
import { describeError } from '../../lib/errorRemedies';
import { uiLanguageNow } from '../../lib/i18n/uiLanguageNow';
import { savedInOtherWorkspace, workspaceChangedSince } from '../../lib/saveWorkspace';
import type { ActionContext, ImportedTransaction, ImportedBankLine } from './shared';
import type { PostingHelpers } from './postingHelpers';
import type { EntryActions } from './entryActions';
import { runCommand } from '../../lib/runCommand';

/** Bringing entries in: statement/file import and receipt reading. (F-05, moved from useTransactionActions.) */
export function createImportActions(ctx: ActionContext, posting: PostingHelpers, entries: EntryActions) {
  const { user, currentWorkspaceId, getCurrentWorkspace, setTransactions, accounts, matchingThreshold, dimensionNodes, userKey, setIsSyncing, generateFileHash, isPeriodLocked } = ctx;
  const { recordRulePattern, balanceTransactionLines } = posting;
  const { handleQuickAdd, handleUpdateTransaction } = entries;

  /** Resolves `true` only when the server stored the import (#110: the review stays open otherwise). */
  const handleImportTransactions = async (newTransactions: ImportedTransaction[]): Promise<boolean> => {
    if (!user || !currentWorkspaceId) return false;

    const existingTransactions = useLedgerStore.getState().transactions;
    // Fast deduplication via hash and date
    const existingIds = new Set<string | undefined>(existingTransactions.map(t => t.bankTransactionId || t.id));
    
    setIsSyncing(true);
    const loader = toast.loading(`Synchronizing ${newTransactions.length} transactions...`);

    try {
      const txsToMatch = newTransactions.filter(tx => !existingIds.has(tx.bankTransactionId) && !existingIds.has(tx.id) && !isPeriodLocked(tx.date));

      const accountsByName = new Map<string, ChartAccount>();
      const accountsById = new Map<string, ChartAccount>();
      accounts.forEach(a => {
        accountsByName.set(a.name, a);
        accountsById.set(a.id, a);
      });

      const processedTxs: Transaction[] = [];
      const bankLineRecords: ImportedBankLine[] = [];
      // PREV-5: learned only once the server stored the import (a refused import taught the rules anyway)
      const toLearn: Array<Parameters<typeof recordRulePattern>> = [];

      txsToMatch.forEach(tx => {
        // EG-9: a line with no account chosen is no longer posted to a default expense account
        const lines = tx.lines && tx.lines.length > 0 ? tx.lines : [];

        const isPreCategorized = lines.length > 0 && 
          Boolean(lines[0].accountId) &&
          lines[0].accountId !== 'uncategorized' && 
          lines[0].accountId !== 'unassigned' &&
          lines[0].accountName !== 'Uncategorized' && 
          lines[0].accountName !== 'Manual Review';

        // EG-9: a line the person did not categorise in the review is sent as a pending bank line.
        // The server runs the bank rules on it (src/lib/bankRules.ts) and stores what they suggest;
        // nothing is posted until a person accepts the suggestion.
        const balancedLines = isPreCategorized ? balanceTransactionLines(lines, tx.amountCents || 0) : [];
        const isResolvedCategory = isPreCategorized;

        // 1. ALWAYS inject into the BankLines validation layer
        const bankLineRef = doc(collection(db, 'bankLines'));
        const bankLineRecord: ImportedBankLine = {
          id: bankLineRef.id,
          workspaceId: currentWorkspaceId,
          uid: user.uid,
          date: tx.date,
          description: tx.description,
          amountCents: tx.amountCents || 0,
          status: isResolvedCategory ? 'matched' : 'pending',
          matchedTransactionId: null as string | null,
          // EG-9: the statement's fingerprint; the server keeps one bank line per fingerprint
          ...(tx.importIdentity ? { importIdentity: tx.importIdentity } : {}),
          createdAt: new Date().toISOString()
        };

        // 2. ONLY synthesize actual atomic transaction if category was resolved
        if (isResolvedCategory) {
          const newTxId = doc(collection(db, 'transactions')).id;
          const txDraft = {
            ...tx,
            id: newTxId,
            lines: balancedLines,
            uid: user.uid,
            workspaceId: currentWorkspaceId,
            status: tx.isAI ? 'draft' : 'pending',
            type: 'actual',
            createdAt: new Date().toISOString()
          } as Transaction;

          // Resolution check: If accountName was provided, resolve its ID FIRST
          if (txDraft.lines && txDraft.lines.length > 0) {
            txDraft.lines = txDraft.lines.map((line) => {
              if (line.accountName && line.accountId === 'uncategorized') {
                const resolved = accountsByName.get(line.accountName);
                if (resolved) {
                  return { ...line, accountId: resolved.id };
                }
              }
              if (line.accountId && line.accountId !== "uncategorized" && !accountsById.has(line.accountId)) {
                return { ...line, accountId: "uncategorized", accountName: "Manual Review" };
              }
              return line;
            });
          }

          const finalTx = {
            ...txDraft,
            verification: {
              status: 'verified' as const,
              verifiedAt: new Date().toISOString(),
              method: 'manual' as const,
              hash: DoubleEntryAuditor.computeHash(txDraft),
              timestamp: new Date().toISOString()
            }
          };
          
          bankLineRecord.matchedTransactionId = newTxId;
          processedTxs.push(finalTx);

          // LEARN: Record as a seen pattern for every line item
          if (finalTx.lines && finalTx.lines.length > 0) {
            finalTx.lines.forEach((line) => {
              if (line.accountName && line.accountName !== 'Uncategorized' && line.accountName !== 'Manual Review') {
                const searchDesc = line.description || (finalTx.lines.length === 1 ? finalTx.description : undefined);
                if (searchDesc) {
                  toLearn.push([searchDesc, line.accountId || 'uncategorized', line.accountName, line.tags, line.dimensions]);
                }
              }
            });
          }
        }
        
        bankLineRecords.push(bankLineRecord);
      });

      // Bank lines and their ledger entries go to the server together (one database transaction;
      // the browser isn't allowed to write bank lines itself)
      let skipped = 0;
      let storedTxs = processedTxs;
      if (processedTxs.length > 0 || bankLineRecords.length > 0) {
        const answer = await runCommand<{ skippedDuplicates?: number; transactions?: Array<{ id?: string }> }>({
          path: '/api/v1/transactions/bulk',
          method: 'POST',
          body: {
            workspaceId: currentWorkspaceId,
            transactions: processedTxs,
            bankLines: bankLineRecords.map(({ id, date, description, amountCents, status, matchedTransactionId, importIdentity }) => ({ id, date, description, amountCents, status, matchedTransactionId, ...(importIdentity ? { importIdentity } : {}) }))
          }
        }) ?? {};

        // EG-9: lines of the statement already imported are skipped by the server, with their entries
        skipped = Number(answer.skippedDuplicates) || 0;
        const saved = answer.transactions;
        if (skipped > 0 && Array.isArray(saved)) {
          const written = new Set(saved.map(t => t.id));
          storedTxs = processedTxs.filter(t => written.has(t.id));
        }
      }

      toLearn.forEach(args => { void recordRulePattern(...args); });
      // PREV-5: another workspace was opened while the import was on its way: its entries stay out
      // of that workspace's list, and the message says where they went
      if (workspaceChangedSince(currentWorkspaceId)) {
        toast.info(savedInOtherWorkspace(`The import of ${newTransactions.length} transactions`, currentWorkspaceId), { id: loader });
        return true;
      }
      const current = useLedgerStore.getState().transactions;
      setTransactions([...storedTxs, ...current]);
      toast.success(`Imported ${newTransactions.length - skipped} transactions${skipped ? ` (${skipped} already imported, skipped)` : ''}.`, { id: loader });
      return true;
    } catch (error) {
      // PREV-5: handleFirestoreError rethrows, so this message never showed and the import rejected
      // instead of returning false; the reason now goes into the one message shown
      console.error('[FORENSIC ERROR] WRITE: transactions-batch-import', error);
      const described = describeError(error, 'write', uiLanguageNow());
      toast.error(`Import failed: ${described.title.charAt(0).toLowerCase()}${described.title.slice(1)}. Nothing was imported; your selection is kept so you can try again.`, { id: loader, description: described.remedy });
      return false;
    } finally {
      setIsSyncing(false);
    }
  };

  const handleParseReceipt = async (file: File, transactionId?: string) => {
    const { addParsingItem, updateParsingItem, parsingQueue } = useUIStore.getState();
    
    // 1. Generate Idempotency Key (SHA-256 Hash of content)
    const idempotencyKey = await generateFileHash(file);
    
    // 2. Prevent duplicate processing
    const isDuplicate = parsingQueue.some((item) => item.idempotencyKey === idempotencyKey && item.status !== 'error');
    if (isDuplicate) {
      toast.info(`Receipt ${file.name} is already being processed.`);
      return;
    }

    const parsingId = crypto.randomUUID();
    
    addParsingItem({
      id: parsingId,
      idempotencyKey,
      name: file.name,
      status: 'uploading'
    });

    const loader = toast.loading(`Parsing ${file.name}...`);
    
    try {
      updateParsingItem(parsingId, { status: 'parsing' });
      const { analyticalPatternCache, accounts, autoRules, transactions: existingTransactions } = useLedgerStore.getState();
      const currentWorkspace = getCurrentWorkspace();
      const labels = accounts.map(a => a.name);
      const data = await aiService.parseReceipt(file, userKey, analyticalPatternCache, labels);
      
      if (!data) {
        updateParsingItem(parsingId, { status: 'error' });
        toast.error(`Extraction failed for ${file.name}`, { id: loader });
        return;
      }

      // Reconciliation & Summary Row Validation Guard
      const validation = validateReceiptPayload(data);
      if (!validation.valid) {
        updateParsingItem(parsingId, { status: 'error' });
        toast.error(validation.error || 'Receipt validation failed', { id: loader });
        return;
      }
      
      setIsSyncing(true);

      const engine = new MatchingEngine(
        autoRules || [],
        analyticalPatternCache || {},
        user?.uid || '',
        matchingThreshold || 0.85,
        existingTransactions || [],
        dimensionNodes,
        accounts
      );

      const headerDimensions: { world?: string; class?: string; project?: string } = {};
      if (currentWorkspace?.dimensions) {
        const worldDim = currentWorkspace.dimensions.find((d) => d.isWorld || d.id === 'world');
        if (worldDim) headerDimensions.world = worldDim.id;
      }

      const debitLines = mapReceiptToCoordinates(data, accounts, engine, headerDimensions);

      if (transactionId) {
        // Attaching receipt to an existing transaction: balance the itemized lines with the settlement leg
        const balancedLines = balanceTransactionLines(debitLines, data.totalAmountCents || 0);

        const success = await handleUpdateTransaction(transactionId, {
          description: data.vendorName,
          totalAmountCents: data.totalAmountCents,
          taxAmountCents: data.taxAmountCents || 0,
          isCleared: true,
          clearedAt: new Date().toISOString(),
          lines: balancedLines
        });

        // #111: the receipt is "done" only when the entry was really saved
        if (!success) {
          updateParsingItem(parsingId, { status: 'error' });
          toast.error(`${file.name} was read but the entry was not updated`, { id: loader });
          return;
        }
        toast.success(`${file.name} matched and verified with ${data.lines?.length || 0} items`, { id: loader });
      } else {
        const saved = await handleQuickAdd({ 
          description: data.vendorName || 'Receipt Entry',
          totalAmountCents: data.totalAmountCents,
          taxAmountCents: data.taxAmountCents || 0,
          date: data.date || getLocalDateISO(),
          lines: debitLines
        });
        if (!saved) {
          updateParsingItem(parsingId, { status: 'error' });
          toast.error(`${file.name} was read but the entry was not saved`, { id: loader });
          return;
        }
        toast.success(`${file.name} processed with ${debitLines.length} line items`, { id: loader });
      }
      
      updateParsingItem(parsingId, { status: 'done' });
      // Cleanup successful items from queue after 5 seconds
      setTimeout(() => {
        const { parsingQueue, setParsingQueue } = useUIStore.getState();
        setParsingQueue(parsingQueue.filter((i) => i.id !== parsingId));
      }, 5000);

    } catch {
      updateParsingItem(parsingId, { status: 'error' });
      toast.error(`AI processing failed for ${file.name}`, { id: loader });
    }
  };

  // "Delete this workspace": the server keeps it for the recovery window, 30 days by default (an owner can keep it until then),
  // then deletes everything in it; the audit trail stays (workspaceRoutes.ts, workspacePurgeService.ts)

  return { handleImportTransactions, handleParseReceipt };
}

export type ImportActions = ReturnType<typeof createImportActions>;
