import { create } from 'zustand';
import { LedgerEngine } from '../kernel/ledger/LedgerEngine';
import { DoubleEntryAuditor, AuditResult } from '../services/auditor';
import { globalEventBus } from '../lib/eventBus';
import { isPostable, lineAmount, calculateTransactionImpact } from '../lib/txFilters';
import { 
  Transaction, 
  ChartAccount, 
  JournalEntry, 
  Project, 
  Budget, 
  Vendor, 
  Customer, 
  Invoice, 
  CreditNote,
  Payment,
  Estimate,
  Bill, 
  VendorCredit, 
  InventoryItem, 
  FixedAsset, 
  RecurringTransaction, 
  Employee, 
  PayRun, 
  TaxRate,
  CustomTemplate,
  BankStatementLine,
  DimensionNode,
  PeriodStatus,
  AuditLog,
  Partner,
  ReconciliationSession,
  AutoRule,
  WorkspaceInvite,
  SupportTicket,
  SupportMessage
} from '../types';
import type { Loan } from '../lib/loans';


import { DoubleEntryValidator } from '../kernel/validation/DoubleEntryValidator';
import type { LockException } from '../lib/periodLock';
import { entriesAfter, openingCutoff, type ServerOpening } from '../lib/serverBalances';
declare global {
  interface Window {
    _recomputeTimer?: ReturnType<typeof setTimeout>;
    __ledgerStore?: typeof useLedgerStore;
    __ledgerBaseCurrency?: string;
  }
}

type StoredAuditLog = Omit<AuditLog, 'uid'> & { uid?: string; targetId?: string };
type StoredPartner = Pick<Partner, 'id'> & Partial<Partner>;
type StoredReconciliation = ReconciliationSession & { accountId?: string; accountName?: string };

/**
 * Income, expenses and their difference over the posted entries (isPostable, lineAmount, by
 * account type), plus per-project and per-line-category figures. Needs the accounts: without them
 * no line is income or expense, so it is recomputed when either list changes.
 */
export function summarizeLedger(transactions: Transaction[], accounts: ChartAccount[]): LedgerState['runningBalances'] {
  const summary: LedgerState['runningBalances'] = { totalIncome: 0, totalExpense: 0, totalBalance: 0, projectMetrics: {}, categoryMetrics: {} };
  const accountMap = new Map(accounts.map(a => [a.id, a]));
  for (const tx of transactions) {
    if (!tx || typeof tx !== 'object' || !isPostable(tx)) continue;
    const impact = calculateTransactionImpact(tx, accountMap);
    if (impact > 0) summary.totalIncome += impact;
    else if (impact < 0) summary.totalExpense += Math.abs(impact);
    summary.totalBalance += impact;

    if (Array.isArray(tx.lines)) {
      for (const l of tx.lines) {
        if (!l || typeof l !== 'object') continue;
        const cat = (typeof l.category === 'string' && l.category) ? l.category : 'General';
        summary.categoryMetrics[cat] = (summary.categoryMetrics[cat] || 0) + lineAmount(l, tx);
      }
    }
    if (tx.projectId && typeof tx.projectId === 'string') {
      const project = summary.projectMetrics[tx.projectId] ||= { income: 0, expense: 0 };
      if (impact > 0) project.income += impact;
      else if (impact < 0) project.expense += Math.abs(impact);
    }
  }
  return summary;
}

export interface LedgerState {
  _version: number;
  _lastSync: number;
  transactions: Transaction[];
  accounts: ChartAccount[];
  journalEntries: JournalEntry[];
  projects: Project[];
  budgets: Budget[];
  vendors: Vendor[];
  customers: Customer[];
  invoices: Invoice[];
  creditNotes: CreditNote[];
  payments: Payment[];
  estimates: Estimate[];
  bills: Bill[];
  vendorCredits: VendorCredit[];
  inventory: InventoryItem[];
  assets: FixedAsset[];
  loans: Loan[];
  recurring: RecurringTransaction[];
  employees: Employee[];
  payRuns: PayRun[];
  taxRates: TaxRate[];
  classes: string[];
  locations: string[];
  customFields: { name: string, type: string, showOnSales: boolean, showOnExpenses: boolean }[];
  dimensionNodes: DimensionNode[];
  auditLogs: StoredAuditLog[];
  bankLines: BankStatementLine[];
  periods: PeriodStatus[];
  partners: StoredPartner[];
  reconciliations: StoredReconciliation[];
  customTemplates: CustomTemplate[];
  autoRules: AutoRule[];
  invites: WorkspaceInvite[];
  workspaceShards: Record<string, unknown>[];
  billingLedgerTraces: Record<string, unknown>[];
  supportTickets: SupportTicket[];
  supportMessages: SupportMessage[];
  integrityStatus: {
    lastChecked: string;
    isConsistent: boolean;
    driftCents: number;
    shadowTotalCents: number;
    incrementalTotalCents: number;
    isVerifying: boolean;
  };
  projectedBalanceCents: number;
  lastActivity: string;
  analyticalPatternCache: Record<string, { accountId: string, accountName: string, projectId?: string, projectName?: string, count: number, tags?: string[], dimensions?: Record<string, string> }>;
  activityFeed: Record<string, unknown>[];
  auditResult: AuditResult | null;
  optimisticIds: Set<string>;
  computedAccounts: ChartAccount[];
  totalLedgerBalance: number;
  /** L-123 step 3b: the server's balances through the oldest loaded day (src/lib/serverBalances.ts); null = loaded entries only. */
  serverOpening: ServerOpening | null;
  /** The last closed date for the signed-in user (hard close, or soft close for bookkeepers). */
  lockDate: string | null;
  /** Partial unlock inside the closed period (dates in it are open again). */
  lockException: LockException | null;
  isPrivacyMode: boolean;
  baseCurrency: string;
  matchingThreshold: number;
  isDataTruncated: boolean;
  truncatedCollections: Record<string, boolean>;
  runningBalances: {
    totalIncome: number;
    totalExpense: number;
    totalBalance: number;
    projectMetrics: Record<string, { income: number, expense: number }>;
    categoryMetrics: Record<string, number>;
  };

  // Actions
  reconcileIntegrity: () => boolean;
  setTransactions: (data: Transaction[]) => void;
  deleteTransaction: (id: string) => void;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
  setLockDate: (date: string | null) => void;
  setLockException: (exception: LockException | null) => void;
  setBaseCurrency: (currency: string) => void;
  setMatchingThreshold: (threshold: number) => void;
  setPrivacyMode: (active: boolean) => void;
  setIsDataTruncated: (isTruncated: boolean) => void;
  setCollectionTruncated: (collectionName: string, isTruncated: boolean) => void;
  validateTransaction: (tx: Transaction) => { success: boolean, error?: string };
  setAccounts: (data: ChartAccount[]) => void;
  updateAccount: (id: string, updates: Partial<ChartAccount>) => void;
  setJournalEntries: (data: JournalEntry[]) => void;
  setProjects: (data: Project[]) => void;
  setBudgets: (data: Budget[]) => void;
  setVendors: (data: Vendor[]) => void;
  updateVendor: (id: string, updates: Partial<Vendor>) => void;
  setCustomers: (data: Customer[]) => void;
  updateCustomer: (id: string, updates: Partial<Customer>) => void;
  setInvoices: (data: Invoice[]) => void;
  setCreditNotes: (data: CreditNote[]) => void;
  setPayments: (data: Payment[]) => void;
  setEstimates: (data: Estimate[]) => void;
  setBills: (data: Bill[]) => void;
  setVendorCredits: (data: VendorCredit[]) => void;
  setInventory: (data: InventoryItem[]) => void;
  setAssets: (data: FixedAsset[]) => void;
  setLoans: (data: Loan[]) => void;
  setRecurring: (data: RecurringTransaction[]) => void;
  setEmployees: (data: Employee[]) => void;
  setPayRuns: (data: PayRun[]) => void;
  setTaxRates: (data: TaxRate[]) => void;
  setClasses: (data: string[]) => void;
  setLocations: (data: string[]) => void;
  setCustomFields: (data: { name: string, type: string, showOnSales: boolean, showOnExpenses: boolean }[]) => void;
  setAuditLogs: (data: StoredAuditLog[]) => void;
  setDimensionNodes: (data: DimensionNode[]) => void;
  setPartners: (data: StoredPartner[]) => void;
  setReconciliations: (data: StoredReconciliation[]) => void;
  setBankLines: (data: BankStatementLine[]) => void;
  setPeriods: (data: PeriodStatus[]) => void;
  setCustomTemplates: (data: CustomTemplate[]) => void;
  setAutoRules: (data: AutoRule[]) => void;
  setInvites: (data: WorkspaceInvite[]) => void;
  setWorkspaceShards: (data: Record<string, unknown>[]) => void;
  setBillingLedgerTraces: (data: Record<string, unknown>[]) => void;
  setSupportTickets: (data: SupportTicket[]) => void;
  setSupportMessages: (data: SupportMessage[]) => void;
  setAnalyticalPatternCache: (data: LedgerState['analyticalPatternCache']) => void;
  updateAnalyticalMatchCache: (description: string, accountId: string, accountName: string, tags?: string[], projectId?: string, projectName?: string, dimensions?: Record<string, string>) => void;
  setActivityFeed: (data: Record<string, unknown>[]) => void;
  runFullAudit: () => void;
  recomputeBalances: () => void;
  setServerOpening: (opening: ServerOpening | null) => void;
  resetStore: () => void;
}

export const getPostableTransactions = (state: LedgerState): Transaction[] => {
  return state.transactions.filter(isPostable);
};

export const useLedgerStore = create<LedgerState>((set, get) => ({
  _version: 0,
  _lastSync: Date.now(),
  transactions: [],
  optimisticIds: new Set(),
  accounts: [],
  journalEntries: [],
  projects: [],
  budgets: [],
  vendors: [],
  customers: [],
  invoices: [],
  creditNotes: [],
  payments: [],
  estimates: [],
  bills: [],
  vendorCredits: [],
  inventory: [],
  assets: [],
  loans: [],
  recurring: [],
  employees: [],
  payRuns: [],
  taxRates: [],
  classes: [],
  locations: [],
  customFields: [],
  dimensionNodes: [],
  auditLogs: [],
  partners: [],
  reconciliations: [],
  bankLines: [],
  periods: [],
  customTemplates: [],
  autoRules: [],
  invites: [],
  workspaceShards: [],
  billingLedgerTraces: [],
  supportTickets: [],
  supportMessages: [],
  activityFeed: [],
  analyticalPatternCache: {},
  runningBalances: {
    totalIncome: 0,
    totalExpense: 0,
    totalBalance: 0,
    projectMetrics: {},
    categoryMetrics: {}
  },
  integrityStatus: {
    lastChecked: new Date().toISOString(),
    isConsistent: true,
    shadowTotalCents: 0,
    incrementalTotalCents: 0,
    driftCents: 0,
    isVerifying: false
  },
  auditResult: null,

  computedAccounts: [],
  serverOpening: null,
  totalLedgerBalance: 0,
  projectedBalanceCents: 0,
  lastActivity: '',
  deleteTransaction: (id) => {
    const state = get();
    const nextTxs = state.transactions.filter(t => t.id !== id);
    state.setTransactions(nextTxs);
  },
  updateTransaction: (id, updates) => {
    const state = get();
    const nextTxs = state.transactions.map(t => t.id === id ? { ...t, ...updates } as typeof t : t);
    state.setTransactions(nextTxs);
  },
  lockDate: null,
  lockException: null,
  baseCurrency: 'USD',
  matchingThreshold: 0.8,
  isDataTruncated: false,
  truncatedCollections: {},
  isPrivacyMode: false,

  setLockDate: (date) => set({ lockDate: date }),
  setLockException: (exception) => set({ lockException: exception }),
  setBaseCurrency: (currency) => set({ baseCurrency: currency }),
  setMatchingThreshold: (threshold) => set({ matchingThreshold: threshold }),
  setPrivacyMode: (active) => set({ isPrivacyMode: active }),
  setIsDataTruncated: (isTruncated) => set({ isDataTruncated: isTruncated }),
  setCollectionTruncated: (collectionName, isTruncated) => set((state) => {
    const next = { ...state.truncatedCollections, [collectionName]: isTruncated };
    const isAnyTruncated = Object.values(next).some(Boolean);
    return { truncatedCollections: next, isDataTruncated: isAnyTruncated };
  }),

  recomputeBalances: () => {
    if (typeof window !== 'undefined') {
      if (window._recomputeTimer) {
        clearTimeout(window._recomputeTimer);
      }
      window._recomputeTimer = setTimeout(() => {
      const { accounts, transactions, computedAccounts: currentComputed } = get();
      if (!accounts.length) {
        if (currentComputed.length > 0 || get().totalLedgerBalance !== 0) {
          set({ computedAccounts: [], totalLedgerBalance: 0 });
        }
        return;
      }

      // L-123 step 3b: with the server's answer for the current cut-off, every reader of computedAccounts (the
      // Sidebar, the widgets, the health checks) gets the server's balance plus the loaded entries after its day
      const opening = get().serverOpening;
      const useOpening = !!opening && opening.asOf === openingCutoff(transactions);
      const balances = LedgerEngine.computeDimensionalBalances(accounts, useOpening ? entriesAfter(transactions, opening.asOf) : transactions);
      let totalBal = 0;
      let changed = false;
      
      const nextComputedAccounts = accounts.map((acc, idx) => {
        const data = balances.get(acc.id);
        const signedBalance = (data?.total || 0) + (useOpening ? opening.accounts[acc.id] || 0 : 0);
        const isDebit = acc.type === 'asset' || acc.type === 'expense' || acc.type === 'cost_of_goods';
        const balance = isDebit ? signedBalance : -signedBalance;
        
        if (isDebit) totalBal += balance;
        else totalBal -= balance;

        const projectAllocations = data ? Object.fromEntries(data.projects) : {};
        const current = currentComputed[idx];
        
        // Minimal stability check
        const hasChanged = !current || 
                          current.id !== acc.id || 
                          current.balanceCents !== balance ||
                          JSON.stringify(current.projectAllocations) !== JSON.stringify(projectAllocations);

        if (hasChanged) changed = true;

        return { 
          ...acc, 
          balanceCents: balance,
          projectAllocations 
        };
      });

      if (changed || get().totalLedgerBalance !== totalBal || currentComputed.length !== nextComputedAccounts.length) {
        set({ 
          computedAccounts: nextComputedAccounts,
          totalLedgerBalance: totalBal
        });
      }
      }, 10);
    }
  },

  setServerOpening: (opening) => {
    const current = get().serverOpening;
    if (current === opening || (current && opening && current.workspaceId === opening.workspaceId && current.asOf === opening.asOf && JSON.stringify(current.accounts) === JSON.stringify(opening.accounts))) return;
    set({ serverOpening: opening });
    get().recomputeBalances();
  },

  validateTransaction: (tx) => { 
    try {
      DoubleEntryValidator.validateJournalEntry(tx);
      // Usually here it would call an API or event ledger
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : undefined };
    }
  },

  reconcileIntegrity: () => {
    const { transactions, runningBalances, accounts } = get();
    
    set({ integrityStatus: { ...get().integrityStatus, isVerifying: true } });

    const integrity = summarizeLedger(Array.isArray(transactions) ? transactions : [], accounts);

    const isConsistent = 
      integrity.totalBalance === runningBalances.totalBalance &&
      integrity.totalIncome === runningBalances.totalIncome;

    const drift = integrity.totalBalance - runningBalances.totalBalance;

    set({ 
      integrityStatus: {
        lastChecked: new Date().toISOString(),
        isConsistent,
        driftCents: drift,
        shadowTotalCents: integrity.totalBalance,
        incrementalTotalCents: runningBalances.totalBalance,
        isVerifying: false
      }
    });

    if (!isConsistent) {
      console.warn('Physical Integrity Variance Detected: Delta engine corrected to O(N) Integrity.');
      const formattedDelta = `$${(drift / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const { auditLogs } = get();
      const driftLog = {
        id: crypto.randomUUID(),
        action: `PHYSICAL_INTEGRITY_DRIFT: Balance Delta is ${formattedDelta} [Shadow: $${(integrity.totalBalance / 100).toFixed(2)} · Incremental: $${(runningBalances.totalBalance / 100).toFixed(2)}]`,
        entityType: 'system',
        entityId: 'SHADOW_RECONCILER',
        email: 'SYSTEM_AUTOPILOT@ledgerflow.security',
        userEmail: 'SYSTEM_AUTOPILOT@ledgerflow.security',
        targetId: 'LEDGER_INTEGRITY_VIOLATION',
        details: {
          driftCents: drift,
          shadowTotalCents: integrity.totalBalance,
          incrementalTotalCents: runningBalances.totalBalance
        },
        timestamp: new Date().toISOString()
      };
      set({ 
        runningBalances: integrity,
        auditLogs: [driftLog, ...(Array.isArray(auditLogs) ? auditLogs : [])]
      });
    }

    return isConsistent;
  },

  setTransactions: (transactions) => {
    const currentVersion = get()._version;
    set({ _version: currentVersion + 1, _lastSync: Date.now() });
    if (!Array.isArray(transactions)) {
      throw new Error("Validation Failed: Transactions payload must be an array.");
    }
    
    const validTxs = transactions
      .filter((tx): tx is Transaction => Boolean(tx && typeof tx === 'object'))
      .map(tx => ({
        ...tx,
        lines: Array.isArray(tx.lines) ? tx.lines : []
      }));
    
    const { recomputeBalances } = get();
    const allTxs = validTxs.sort((a, b) => {
      const aDate = typeof a.date === 'string' ? a.date : '';
      const bDate = typeof b.date === 'string' ? b.date : '';
      if (aDate > bDate) return -1;
      if (aDate < bDate) return 1;
      const aTime = typeof a.createdAt === 'string' ? a.createdAt : '';
      const bTime = typeof b.createdAt === 'string' ? b.createdAt : '';
      if (aTime > bTime) return -1;
      if (aTime < bTime) return 1;
      return 0;
    });

    // the account map used to be rebuilt for every entry (entries × accounts work on each load)
    const runningBalances = summarizeLedger(allTxs, get().accounts);

    set({ transactions: allTxs, runningBalances });
    recomputeBalances();
  },

  

  

  setAccounts: (accounts) => {
    // the totals depend on which accounts are income or expense: entries loaded before the
    // accounts used to keep all-zero totals until the next change to the entries
    set({ accounts, runningBalances: summarizeLedger(get().transactions, accounts) });
    get().recomputeBalances();
  },
  
  updateAccount: (id, updates) => {
    const nextAccounts = get().accounts.map(a => a.id === id ? { ...a, ...updates } : a);
    get().setAccounts(nextAccounts);
  },

  setJournalEntries: (journalEntries) => {
    set({ journalEntries });
    get().recomputeBalances();
  },
  setProjects: (projects) => set({ projects }),
  setBudgets: (budgets) => set({ budgets }),
  setVendors: (vendors) => set({ vendors }),

  updateVendor: (id, updates) => {
    const nextVendors = get().vendors.map(v => v.id === id ? { ...v, ...updates } : v);
    get().setVendors(nextVendors);
  },

  setCustomers: (customers) => set({ customers }),

  updateCustomer: (id, updates) => {
    const nextCustomers = get().customers.map(c => c.id === id ? { ...c, ...updates } : c);
    get().setCustomers(nextCustomers);
  },
  setInvoices: (invoices) => set({ invoices }),
  setCreditNotes: (creditNotes) => set({ creditNotes }),
  setPayments: (payments) => set({ payments }),
  setEstimates: (estimates) => set({ estimates }),
  setBills: (bills) => set({ bills }),
  setVendorCredits: (vendorCredits) => set({ vendorCredits }),
  setInventory: (inventory) => set({ inventory }),
  setAssets: (assets) => set({ assets }),
  setLoans: (loans) => set({ loans }),
  setRecurring: (recurring) => set({ recurring }),
  setEmployees: (employees) => set({ employees }),
  setPayRuns: (payRuns) => set({ payRuns }),
  setTaxRates: (taxRates) => set({ taxRates }),
  setClasses: (classes) => set({ classes }),
  setLocations: (locations) => set({ locations }),
  setCustomFields: (customFields) => set({ customFields }),
  setAuditLogs: (auditLogs) => set({ auditLogs }),
  setDimensionNodes: (dimensionNodes) => set({ dimensionNodes }),
  setPartners: (partners) => set({ partners }),
  setReconciliations: (reconciliations) => set({ reconciliations }),
  setBankLines: (bankLines) => set({ bankLines }),
  setPeriods: (periods) => set({ periods }),
  setCustomTemplates: (customTemplates) => set({ customTemplates }),
  setAutoRules: (autoRules) => set({ autoRules }),
  setInvites: (invites) => set({ invites }),
  setWorkspaceShards: (workspaceShards) => set({ workspaceShards }),
  setBillingLedgerTraces: (billingLedgerTraces) => set({ billingLedgerTraces }),
  setSupportTickets: (supportTickets) => set({ supportTickets }),
  setSupportMessages: (supportMessages) => set({ supportMessages }),
  setAnalyticalPatternCache: (analyticalPatternCache) => set({ analyticalPatternCache }),
  updateAnalyticalMatchCache: (description, accountId, accountName, tags, projectId, projectName, dimensions) => set((state) => {
    const cleanDesc = (description || '').toLowerCase().trim();
    // Index by vendor + project for precision
    const key = projectId ? `${cleanDesc}::${projectId}` : cleanDesc;
    
    const existing = state.analyticalPatternCache[key];
    const combinedTags = Array.from(new Set([...(existing?.tags || []), ...(tags || [])])).slice(0, 5);
    const combinedDimensions = { ...(existing?.dimensions || {}), ...(dimensions || {}) };
    return {
      analyticalPatternCache: {
        ...state.analyticalPatternCache,
        [key]: {
          accountId,
          accountName,
          projectId,
          projectName,
          tags: combinedTags,
          dimensions: Object.keys(combinedDimensions).length > 0 ? combinedDimensions : undefined,
          count: (existing?.count || 0) + 1
        }
      }
    };
  }),
  setActivityFeed: (activityFeed) => set({ activityFeed }),
  runFullAudit: () => {
    const { transactions, accounts } = get();
    if (!transactions.length || !accounts.length) return;
    const auditResult = DoubleEntryAuditor.auditLedger(transactions, accounts);
    set({ auditResult });

    const hasIssues = !auditResult.isBalanced || 
                      auditResult.imbalances.length > 0 || 
                      auditResult.orphans.length > 0 || 
                      !auditResult.hashChainValid || 
                      auditResult.missingAccounts.length > 0;

    if (hasIssues) {
      globalEventBus.publish('LEDGER_AUDIT_EXCEPTION', {
        result: auditResult,
        timestamp: new Date().toISOString(),
        severity: !auditResult.isBalanced || !auditResult.hashChainValid ? 'critical' : 'warning'
      });
    }
  },
  /** A workspace switch or sign-out: every record of the old workspace goes (only the person's
   * preferences stay: privacy mode, matching threshold, base currency until the new one loads).
   * Closed periods, the lock exception, invites and the truncation flags used to stay, so the new
   * workspace was checked against the old one's closed months until its own loaded. */
  resetStore: () => {
    set({
      periods: [],
      invites: [],
      workspaceShards: [],
      billingLedgerTraces: [],
      supportTickets: [],
      supportMessages: [],
      lockException: null,
      isDataTruncated: false,
      truncatedCollections: {},
      transactions: [],
      optimisticIds: new Set(),
      accounts: [],
      journalEntries: [],
      projects: [],
      budgets: [],
      vendors: [],
      customers: [],
      invoices: [],
      creditNotes: [],
      payments: [],
      estimates: [],
      bills: [],
      vendorCredits: [],
      inventory: [],
      assets: [],
      loans: [],
      recurring: [],
      employees: [],
      payRuns: [],
      taxRates: [],
      classes: [],
      locations: [],
      customFields: [],
      dimensionNodes: [],
      auditLogs: [],
      partners: [],
      reconciliations: [],
      bankLines: [],
      customTemplates: [],
      autoRules: [],
      activityFeed: [],
      analyticalPatternCache: {},
      computedAccounts: [],
      serverOpening: null,
      totalLedgerBalance: 0,
      projectedBalanceCents: 0,
      lastActivity: '',
      lockDate: null,
      auditResult: null,
      runningBalances: {
        totalIncome: 0,
        totalExpense: 0,
        totalBalance: 0,
        projectMetrics: {},
        categoryMetrics: {}
      },
      integrityStatus: {
        lastChecked: new Date().toISOString(),
        isConsistent: true,
        shadowTotalCents: 0,
        incrementalTotalCents: 0,
        driftCents: 0,
        isVerifying: false
      }
    });
  }
}));

if (typeof window !== 'undefined') {
  window.__ledgerStore = useLedgerStore;
  window.__ledgerBaseCurrency = 'USD';
  useLedgerStore.subscribe((state) => {
    window.__ledgerBaseCurrency = state.baseCurrency || 'USD';
  });
}
