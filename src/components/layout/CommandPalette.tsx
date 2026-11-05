import { groupPaletteResults } from '../../lib/paletteGroups';
import { normalizeSearchText } from '../../lib/textNormalization';
import type { RecordRef } from '../../lib/recordLinks';
import { useRecentRecordsStore } from '../../stores/useRecentRecordsStore';
import { recentRecordLabel } from '../../lib/recentRecordLabel';
interface PaletteResult { record?: RecordRef; id: string; type: string; label: string; category: string; actionId?: string; payload?: unknown; icon?: React.ReactNode }
import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Loader2, ArrowRight, FileText, User, Building, FolderKanban, Tags, DollarSign, Zap, FolderPlus } from 'lucide-react';
import { toast } from 'sonner';
import { SYSTEM_COMMANDS, ANALYTICAL_LENSES_REGISTRY } from '../../config/registry';
import { useUIStore } from '../../stores/useUIStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { recentWorkspaceIds, rememberWorkspace, switcherRows } from '../../lib/workspaceSwitcher';
import { parseNaturalLanguageEntry, ParsedCommandIntent } from '../../lib/algorithms/nl-parser';
import { useShallow } from 'zustand/react/shallow';
import { DimensionNode } from '../../types';
import { getLocalDateISO, resolveAccountName, formatCurrency } from '../../lib/utils';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { resolveAccountRole } from '../../lib/accountUtils';
import { isCashAccount, isPostable, lineAmount } from '../../lib/txFilters';
import { useTimeout } from '../../hooks/useTimeout';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useDialog } from '../../hooks/useDialog';
import { focusOnMount } from '../../lib/focusOnMount';
import { pageIndex, searchPages } from '../../config/pageIndex';
import { pageKey, type PinnedPage } from '../../lib/pinnedPages';
import { inBackground } from '../../lib/inBackground';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onAction?: (action: string, details?: unknown) => void;
  onQuery?: (q: string) => Promise<unknown>;
  recentQueries?: string[];
}

export default function CommandPalette({ isOpen, onClose, onAction }: CommandPaletteProps) {
  const { dialogProps, titleId } = useDialog(onClose, isOpen);
  const [query, setQuery] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const { setSafeTimeout } = useTimeout();
  const language = useUIStore(state => state.language);
  const ledger = useLedgerStore(useShallow(state => ({
    transactions: state.transactions,
    projects: state.projects,
    customers: state.customers,
    vendors: state.vendors,
    accounts: state.accounts,
    invoices: state.invoices,
    bills: state.bills,
    recurring: state.recurring,
    inventory: state.inventory,
    bankLines: state.bankLines
  })));
  useLedgerCollections('bills', 'customers', 'invoices', 'vendors', 'recurring', 'inventory', 'bankLines');
  const recentRecords = useRecentRecordsStore(state => state.records);
  const { handleQuickAdd } = useTransactionActions();
  const { addEntity } = useEntityOperations();

  // Parse natural language intent live from search query
  const parsedIntent: ParsedCommandIntent = useMemo(() => {
    return parseNaturalLanguageEntry(query);
  }, [query]);

  // Execute Natural Language Intent
  // Execute Natural Language Intent
  const handleExecuteIntent = async () => {
    if (!parsedIntent || parsedIntent.type === 'unknown') return;
    if (parsedIntent.type === 'transaction') {
      const amountCents = parsedIntent.amountCents || 0;
      const isExpense = parsedIntent.action === 'expense';
      const cashAccount = ledger.accounts.find(a => resolveAccountRole(a) === 'cash') || ledger.accounts.find(a => isCashAccount(a)) || ledger.accounts[0];
      const categoryAccount = ledger.accounts.find(a => resolveAccountRole(a) === (isExpense ? 'expense' : 'revenue')) || ledger.accounts.find(a => a.type === (isExpense ? 'expense' : 'income')) || ledger.accounts[0];
      if (!cashAccount || !categoryAccount) {
        toast.error('Cannot post transaction: No chart of accounts available.');
        return;
      }
      const cashAccountId = cashAccount.id;
      const categoryAccountId = categoryAccount.id;
      const cashAccountName = cashAccount.name;
      const categoryAccountName = categoryAccount.name;
      await handleQuickAdd({
        date: parsedIntent.dateStr || getLocalDateISO(),
        description: parsedIntent.description || 'Natural Language Entry',
        totalAmountCents: amountCents,
        lines: [
          {
            accountId: categoryAccountId,
            accountName: categoryAccountName,
            amountCents: isExpense ? amountCents : -amountCents,
            description: parsedIntent.description || 'NL line'
          },
          {
            accountId: cashAccountId,
            accountName: cashAccountName,
            amountCents: isExpense ? -amountCents : amountCents,
            description: 'Payment settlement'
          }
        ]
      });
      setQuery('');
      onClose();
    } else if (parsedIntent.type === 'project' && parsedIntent.projectName) {
      await addEntity('projects', {
        name: parsedIntent.projectName,
        status: 'active',
        type: 'general',
        budgetCents: 0,
        dimensions: ['project'],
        description: 'Created via Omnibox Command'
      }, `✨ Created project "${parsedIntent.projectName}"`);
      setQuery('');
      onClose();
    } else if (parsedIntent.type === 'query' && parsedIntent.queryText) {
      useUIStore.getState().setFilterCriteria({ searchTerm: parsedIntent.queryText });
      useUIStore.getState().setActiveTab('transactions');
      toast.info(`Filtered ledger for "${parsedIntent.queryText}"`);
      setQuery('');
      onClose();
    }
  };

  const developerMode = useUIStore(state => state.developerMode);
  // BB-07: modules turned off are not offered
  const modules = useAuthStore(s => s.getCurrentWorkspace()?.modules);
  const workspaces = useAuthStore(s => s.workspaces);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const switcherUid = useAuthStore(s => s.user?.uid || '');
  const pages = useMemo(() => pageIndex(language, { developerMode, modules }), [language, developerMode, modules]);

  // Map commands to the currently active UI language
  const localizedCommands = React.useMemo(() => {
    const base = SYSTEM_COMMANDS.map(cmd => ({
      id: cmd.id,
      type: 'command',
      label: cmd.label[language] || cmd.label['en'],
      category: cmd.category,
      actionId: cmd.actionId,
      payload: cmd.payload,
      icon: <ArrowRight aria-hidden="true" size={16} />
    }));
    
    const lenses = ANALYTICAL_LENSES_REGISTRY.map((lens) => ({
      id: `lens-${lens.id}`,
      type: 'command',
      label: `Open: ${(lens.label && lens.label[language]) || (lens.label && lens.label['en']) || (lens as typeof lens & { name?: string }).name || lens.id}`,
      category: 'Calculators & Analytics',
      actionId: 'switch-tab',
      payload: { tab: 'intelligence', channel: lens.id },
      icon: <ArrowRight aria-hidden="true" size={16} />
    }));
    
    return [...base, ...lenses];
  }, [language]);

  // Deep Omnisearch across the entire business model
  const dataResults = useMemo(() => {
    if (!query || query.length < 2) return [];
    
    const lowerQ = normalizeSearchText(query);
    const results: PaletteResult[] = [];
    const searchTerms = lowerQ.split(' ').filter(t => t.length > 0);

    // Helper to check if all search terms match a string
    const match = (str?: string) => {
      if (!str) return false;
      const lower = normalizeSearchText(str);
      return searchTerms.every(term => lower.includes(term));
    };

    // Helper to check array of tags
    const matchArray = (arr?: string[]) => {
      if (!arr) return false;
      const str = arr.join(' ').toLowerCase();
      return searchTerms.every(term => str.includes(term));
    };

    const dimensionNodes: DimensionNode[] = useLedgerStore.getState().dimensionNodes || [];
    const accounts = useLedgerStore.getState().accounts;
    
    // Check if the query matches a DimensionNode
    const matchedDimensionNodes = dimensionNodes.filter((n: DimensionNode) => 
      match(n.id) || match(n.description) || matchArray(n.aliases)
    ).map((n: DimensionNode) => n.id);

    // 1. Transactions
    ledger.transactions.filter(isPostable).forEach(t => {
      const hasMatchedDim = t.dimensions && matchedDimensionNodes.length > 0 && Object.values(t.dimensions).some(val => matchedDimensionNodes.includes(val as string));
      
      if (match(t.description) || matchArray(t.tags) || match(t.payee) || match(t.id) || hasMatchedDim) {
        const absAmount = Math.abs(t.totalAmountCents || 0);
        results.push({
          id: `tx-${t.id}`,
          type: 'data',
          label: `${t.description || 'Transaction'} - ${formatCurrency(absAmount, t.currency)}`,
          category: `Transaction • ${t.date} ${t.tags ? '• ' + t.tags.join(', ') : ''}`,
          actionId: 'switch-tab',
          record: { type: 'transaction', id: t.id },
              payload: { tab: 'transactions', id: t.id },
          icon: <DollarSign aria-hidden="true" size={16} className="text-emerald-500 shrink-0" />
        });
      } else {
        // Search inside lines
        for (const line of t.lines) {
          const accName = resolveAccountName(accounts, line.accountId, line.accountName);
          const lineHasMatchedDim = line.dimensions && matchedDimensionNodes.length > 0 && Object.values(line.dimensions).some(val => matchedDimensionNodes.includes(val as string));
          if (match(line.description) || match(accName) || matchArray(line.tags) || match(line.project) || match(line.class) || match(line.location) || lineHasMatchedDim) {
            const amount = lineAmount(line, t);
            results.push({
              id: `tx-line-${t.id}-${line.accountId}`,
              type: 'data',
              label: `${line.description || t.description} (in ${accName})`,
              category: `Transaction Line • ${formatCurrency(Math.abs(amount), t.currency || 'USD')} ${line.tags ? '• ' + line.tags.join(', ') : ''}`,
              actionId: 'switch-tab',
              record: { type: 'transaction', id: t.id },
              payload: { tab: 'transactions', id: t.id },
              icon: <FileText aria-hidden="true" size={16} className="text-blue-500 shrink-0" />
            });
            break; // Don't duplicate if multiple lines match
          }
        }
      }
    });

    // 1.5. Dimension Nodes
    dimensionNodes.forEach((node: DimensionNode) => {
      if (match(node.id) || match(node.description) || matchArray(node.aliases)) {
        results.push({
          id: `dim-${node.id}`,
          type: 'data',
          label: `${node.id.toUpperCase()}: ${node.description}`,
          category: `Dimension Node • ${node.dimensionId}`,
          actionId: 'switch-tab',
          payload: { tab: 'intelligence' },
          icon: <FolderPlus aria-hidden="true" size={16} className="text-purple-500 shrink-0" />
        });
      }
    });

    // 2. Projects / Units
    ledger.projects.forEach(p => {
      if (match(p.name) || match(p.description)) {
        results.push({
          id: `proj-${p.id}`,
          type: 'data',
          label: p.name,
          category: `Project / Unit • ${p.status}`,
          actionId: 'switch-tab',
          payload: { tab: 'projects', id: p.id },
          icon: <FolderKanban aria-hidden="true" size={16} className="text-purple-500 shrink-0" />
        });
      }
    });

    // 3. Customers
    ledger.customers.forEach(c => {
      if (match(c.name) || match(c.email) || matchArray(c.tags) || match((c as typeof c & { group?: string }).group)) {
        results.push({
          id: `cust-${c.id}`,
          type: 'data',
          label: c.name,
          category: `Customer ${(c as typeof c & { group?: string }).group ? '• ' + (c as typeof c & { group?: string }).group : ''}`,
          actionId: 'switch-tab',
          payload: { tab: 'sales', id: c.id },
          icon: <User aria-hidden="true" size={16} className="text-amber-500 shrink-0" />
        });
      }
    });

    // 4. Vendors
    ledger.vendors.forEach(v => {
      if (match(v.name) || match(v.email) || matchArray(v.tags) || match((v as typeof v & { group?: string }).group)) {
        results.push({
          id: `vend-${v.id}`,
          type: 'data',
          label: v.name,
          category: `Vendor ${(v as typeof v & { group?: string }).group ? '• ' + (v as typeof v & { group?: string }).group : ''}`,
          actionId: 'switch-tab',
          payload: { tab: 'purchases', id: v.id },
          icon: <Building aria-hidden="true" size={16} className="text-rose-500 shrink-0" />
        });
      }
    });

    // 5. Accounts
    ledger.accounts.forEach(a => {
      if (match(a.name) || match(a.code) || match(a.category)) {
        results.push({
          id: `acc-${a.id}`,
          type: 'data',
          label: `${a.code ? a.code + ' - ' : ''}${a.name}`,
          category: `Account • ${a.type} ${a.category ? '• ' + a.category : ''}`,
          actionId: 'switch-tab',
          record: { type: 'account', id: a.id },
          payload: { tab: 'ledger', accountId: a.id },
          icon: <Tags aria-hidden="true" size={16} className="text-blue-500 shrink-0" />
        });
      }
    });

    // 6. Invoices
    ledger.invoices?.forEach(i => {
      if (match(i.number) || match(i.customerName) || match(i.status)) {
        results.push({
          id: `inv-${i.id}`,
          type: 'data',
          label: `Invoice ${i.number || 'Draft'} - ${formatCurrency(i.amountCents, i.currency)}`,
          category: `Invoice • ${i.customerName} • ${i.number}`,
          actionId: 'switch-tab',
          record: { type: 'invoice', id: i.id },
          payload: { tab: 'sales', id: i.id },
          icon: <FileText aria-hidden="true" size={16} className="text-emerald-500 shrink-0" />
        });
      }
    });

    // 7. Bills
    ledger.bills?.forEach(b => {
      if (match(b.number) || match(b.vendorName) || match(b.status)) {
        results.push({
          id: `bill-${b.id}`,
          type: 'data',
          label: `Bill ${b.number || 'Draft'} - ${formatCurrency(b.amountCents, b.currency)}`,
          category: `Bill • ${b.vendorName} • ${b.number}`,
          actionId: 'switch-tab',
          record: { type: 'bill', id: b.id },
          payload: { tab: 'purchases', id: b.id },
          icon: <FileText aria-hidden="true" size={16} className="text-rose-500 shrink-0" />
        });
      }
    });

    return results.slice(0, 50); // Limit to top 50 results
  }, [query, ledger.transactions, ledger.projects, ledger.customers, ledger.vendors, ledger.accounts, ledger.invoices, ledger.bills]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (isOpen) {
          onClose();
        } else {
          onAction?.('open-command-palette');
        }
      }
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [isOpen, onClose, onAction]);

  useEffect(() => {
    if (!isOpen) {
      setSafeTimeout(() => {
        setQuery('');
        setIsExecuting(false);
      }, 0);
    }
  }, [isOpen, setSafeTimeout]);

  const filteredCommands = query
    ? localizedCommands.filter((command) =>
        normalizeSearchText(command.label).includes(normalizeSearchText(query))
      )
    : localizedCommands;

  const recentResults: PaletteResult[] = query.trim() ? [] : recentRecords.map(record => ({ id: `recent-${record.type}-${record.id}`, type: 'recent', label: recentRecordLabel(record, ledger), category: 'Recent items', record, icon: <FileText aria-hidden="true" size={16} /> }));

const pageResults: PaletteResult[] = useMemo(() => (query.trim().length < 2 ? [] : searchPages(pages, query).slice(0, 8).map(p => ({
    id: `page-${pageKey(p.page)}`, type: 'page', label: `Go to ${p.label}`, category: 'Pages', payload: p.page, icon: <ArrowRight aria-hidden="true" size={16} />,
  }))), [pages, query]);

  // K-34: "Switch to …" for the workspaces the person belongs to
  const workspaceResults: PaletteResult[] = useMemo(() => (query.trim().length < 1 || workspaces.length < 2 ? [] : switcherRows(workspaces, { uid: switcherUid, query, recent: recentWorkspaceIds(), currentId: currentWorkspaceId })
    .filter(w => !w.current).slice(0, 5).map(w => ({
      id: `workspace-${w.id}`, type: 'workspace', label: `Switch to ${w.name}`, category: 'Workspaces', payload: w.id, icon: <ArrowRight aria-hidden="true" size={16} />,
    }))), [query, workspaces, switcherUid, currentWorkspaceId]);

  const combinedResults = [...recentResults, ...workspaceResults, ...pageResults, ...dataResults, ...filteredCommands];
  const groupedResults = groupPaletteResults(combinedResults);

  const handleSelect = async (item: PaletteResult) => {
    // go to any page, report or settings tab (BB-09); no artificial wait before acting
    if (item.type === 'workspace') {
      rememberWorkspace(String(item.payload));
      useAuthStore.getState().setCurrentWorkspaceId(String(item.payload));
      setQuery('');
      onClose();
      return;
    }
    if (item.type === 'page') {
      useUIStore.getState().goToPage(item.payload as PinnedPage);
      setQuery('');
      onClose();
      return;
    }
    setIsExecuting(true);

    // Core Application Action Mappings
    if (item.record) {
      useUIStore.getState().openRecord(item.record);
    } else if (onAction && item.actionId) {
      onAction(item.actionId, item.payload);
    }
    toast.success(`${item.label} opened`);
    setIsExecuting(false);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-gray-900/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            {...dialogProps}
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="fixed z-[201] top-[10%] left-1/2 -translate-x-1/2 w-full max-w-3xl bg-[var(--surface)] rounded-[32px] shadow-2xl overflow-hidden border border-gray-200"
          >
            <h2 id={titleId} className="sr-only">Command palette</h2>
            <div className="flex items-center px-6 py-5 border-b border-gray-100">
              <Search aria-hidden="true" className="text-indigo-600 mr-4" size={24} />
              <input aria-label="Search commands or enter a transaction"
                ref={focusOnMount}
                className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-400 text-xl font-medium"
                placeholder='Type $40 gas cash, paid Maria 150, new project: Aspen, or search...'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && parsedIntent.type !== 'unknown') {
                    e.preventDefault();
                    inBackground(handleExecuteIntent());
                  }
                }}
                disabled={isExecuting}
              />
              <div className="px-2 py-1 bg-gray-100 text-gray-500 rounded text-[10px] font-mono uppercase tracking-widest hidden sm:block">
                ESC to close
              </div>
            </div>
            
            <div className="max-h-[60dvh] overflow-y-auto bg-[var(--ink)]">
              {parsedIntent.type !== 'unknown' && (
                <div className="p-3 bg-indigo-50/80 border-b border-indigo-100">
                  <button
                    onClick={handleExecuteIntent}
                    className="w-full flex items-center justify-between p-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl transition-all shadow-md group text-left cursor-pointer"
                   aria-label="Instant Command Execution (Press Enter) Execute">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-white/20 rounded-xl">
                        {parsedIntent.type === 'project' ? <FolderPlus aria-hidden="true" size={20} /> : <Zap aria-hidden="true" size={20} />}
                      </div>
                      <div>
                        <p className="text-sm font-bold tracking-wide uppercase text-indigo-200">Instant Command Execution (Press Enter)</p>
                        <p className="text-base font-semibold">{parsedIntent.displaySummary}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold bg-white/20 px-3 py-1.5 rounded-lg group-hover:bg-white/30 transition-colors">
                      <span>Execute</span>
                      <ArrowRight aria-hidden="true" size={14} />
                    </div>
                  </button>
                </div>
              )}

              {isExecuting ? (
                <div className="flex flex-col items-center justify-center p-16 text-gray-500">
                  <Loader2 aria-hidden="true" className="animate-spin mb-4" size={32} />
                  <p className="text-base font-medium">Navigating universe...</p>
                </div>
              ) : combinedResults.length > 0 ? (
                <div className="p-3 space-y-1">
                  {groupedResults.map(group => (
                    <section key={group.label} aria-label={group.label}>
                      <h3 className="px-5 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{group.label}</h3>
                      {group.items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--surface)] hover:shadow-sm rounded-2xl transition-all group text-left border border-transparent hover:border-[var(--line)]"
                    >
                      <div className="flex items-center gap-4 min-w-0 flex-1 mr-4">
                        <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors shrink-0">
                          {item.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-semibold text-gray-900 truncate">{item.label}</p>
                          <p className="text-xs font-medium text-gray-500 truncate">{item.category}</p>
                        </div>
                      </div>
                      <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center shrink-0">
                         <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 mr-2 hidden sm:inline">Jump</span>
                         <ArrowRight aria-hidden="true" size={16} className="text-indigo-600 inline-block -translate-x-2 group-hover:translate-x-0 transition-all shrink-0" />
                      </div>
                    </button>
                      ))}
                    </section>
                  ))}
                </div>
              ) : query.length > 0 ? (
                <div className="p-16 text-center text-gray-500">
                  <Tags aria-hidden="true" size={48} className="mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-bold text-gray-900">No dimensions matched</p>
                  <p className="text-sm font-medium mt-1">Try searching by tags, units, categories, or dollar amounts.</p>
                </div>
              ) : (
                 <div className="p-10 flex items-center justify-center opacity-50">
                    <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted)] text-center max-w-sm">
                      Amount Search Matrix active.<br/>Type any tag, location, class, or entity to instantly filter your workspace.
                    </p>
                 </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
