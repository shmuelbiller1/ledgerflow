import { normalizeSearchText } from '../../lib/textNormalization';
import { ChartAccount, Transaction, JournalEntry } from '../../types';
import { isPostable } from '../../lib/txFilters';
import { allocateCents } from '../../lib/Allocation';
import { resolveAccountRole } from '../../lib/accountUtils';

export interface NormalizedLedgerTransaction extends Transaction {
  notes?: string;
  _normalized: { searchStr: string; month: string; absAmount: number; sanitizedDescription: string; year: string; isLarge: boolean; isTiny: boolean; isBalanced: boolean };
}

type NormalizedMeta = NormalizedLedgerTransaction['_normalized'];

export interface NormalizationCacheStats {
  workspaces: number;
  entries: number;
  maxWorkspaces: number;
  maxEntriesPerWorkspace: number;
}

const DEFAULT_WORKSPACE_SCOPE = '__default__';

function serializeDimensions(dimensions?: Record<string, string>): string {
  if (!dimensions) return '';
  let out = '';
  for (const [key, value] of Object.entries(dimensions)) {
    out += `${key}=${value};`;
  }
  return out;
}

function buildLinesSignature(lines?: Transaction['lines']): string {
  if (!lines || lines.length === 0) return '';
  return lines
    .map(
      (l) =>
        `${l.accountId}:${l.amountCents}:${l.accountName || ''}:${l.description || ''}:${l.tags?.join(',') || ''}:${l.class || ''}:${l.location || ''}:${l.project || ''}:${serializeDimensions(l.dimensions)}`,
    )
    .join('|');
}

function buildNormalizationKey(tx: Transaction, metadataJson: string): string {
  return [
    tx.id || '',
    tx.totalAmountCents || 0,
    tx.exchangeRate || 1,
    tx.date || '',
    tx.status || '',
    tx.description || '',
    tx.isCleared ? 1 : 0,
    tx.tags?.join(',') || '',
    tx.project || '',
    tx.classId || '',
    tx.locationId || '',
    serializeDimensions(tx.dimensions),
    metadataJson,
    buildLinesSignature(tx.lines),
  ].join('\u001f');
}

export class LedgerEngine {
  /**
   * Validates if a transaction satisfies the fundamental double-entry invariant.
   */
  static isBalanced(tx: Transaction): boolean {
    if (!tx.lines || tx.lines.length === 0) return false;
    // We use integer cents, so sum must be exactly zero
    const sum = tx.lines.reduce((acc, line) => acc + (line.amountCents || 0), 0);
    return sum === 0;
  }

  private static readonly workspaceNormalizationCaches = new Map<string, Map<string, NormalizedMeta>>();
  private static readonly MAX_CACHED_WORKSPACES = 2;
  private static readonly MAX_CACHE_ENTRIES_PER_WORKSPACE = 10_000;

  static clearNormalizationCache(workspaceId?: string): void {
    if (workspaceId !== undefined) {
      this.workspaceNormalizationCaches.delete(workspaceId || DEFAULT_WORKSPACE_SCOPE);
      return;
    }
    this.workspaceNormalizationCaches.clear();
  }

  static getNormalizationCacheStats(): NormalizationCacheStats {
    let entries = 0;
    for (const wsCache of this.workspaceNormalizationCaches.values()) {
      entries += wsCache.size;
    }
    return {
      workspaces: this.workspaceNormalizationCaches.size,
      entries,
      maxWorkspaces: this.MAX_CACHED_WORKSPACES,
      maxEntriesPerWorkspace: this.MAX_CACHE_ENTRIES_PER_WORKSPACE,
    };
  }

  private static getWorkspaceCache(workspaceScope: string): Map<string, NormalizedMeta> {
    const existing = this.workspaceNormalizationCaches.get(workspaceScope);
    if (existing) {
      this.workspaceNormalizationCaches.delete(workspaceScope);
      this.workspaceNormalizationCaches.set(workspaceScope, existing);
      return existing;
    }
    if (this.workspaceNormalizationCaches.size >= this.MAX_CACHED_WORKSPACES) {
      const oldestWorkspace = this.workspaceNormalizationCaches.keys().next().value;
      if (oldestWorkspace !== undefined) {
        this.workspaceNormalizationCaches.delete(oldestWorkspace);
      }
    }
    const created = new Map<string, NormalizedMeta>();
    this.workspaceNormalizationCaches.set(workspaceScope, created);
    return created;
  }

  private static CACHED_SANITIZE_REGEX_CORP = /(?<![\p{L}\p{M}\p{N}_])(inc|ltd|corp|co|llc|plc|gmbh|sa|bv|nv|ag|sas)(?![\p{L}\p{M}\p{N}_])/gu;
  private static CACHED_SANITIZE_REGEX_CHARS = /[^\p{L}\p{M}\p{N}]/gu;

  private static sanitizeText(s: string) {
    return normalizeSearchText(s)
        .replace(LedgerEngine.CACHED_SANITIZE_REGEX_CORP, '')
        .replace(LedgerEngine.CACHED_SANITIZE_REGEX_CHARS, ' ')
        .trim();
  }

  private static computeNormalizedMeta(t: Transaction, metadataJson: string): NormalizedMeta {
    const absAmount = Math.abs(Math.round((t.totalAmountCents || 0) * (t.exchangeRate || 1))) / 100;
    const tDate = t.date || '';
    const lineSearch = t.lines
      ?.map(
        (l) =>
          `${l.accountName} ${l.description || ''} ${l.tags?.join(' ') || ''} ${l.class || ''} ${l.location || ''} ${l.project || ''} ${l.dimensions ? Object.values(l.dimensions).join(' ') : ''}`,
      )
      .join(' ');
    const rawSearch = `${t.description || ''} ${absAmount} ${tDate} ${t.isCleared ? 'cleared' : 'pending'} ${t.tags?.join(' ') || ''} ${t.project || ''} ${t.classId || ''} ${t.locationId || ''} ${t.dimensions ? Object.values(t.dimensions).join(' ') : ''} ${metadataJson} ${lineSearch}`;

    return {
      searchStr: rawSearch.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
      month: tDate.length >= 7 ? tDate.substring(0, 7) : '',
      absAmount,
      sanitizedDescription: this.sanitizeText(t.description || ''),
      year: tDate.length >= 4 ? tDate.substring(0, 4) : '',
      isLarge: absAmount > 5000,
      isTiny: absAmount < 1.00,
      isBalanced: (t.lines?.reduce((acc, line) => acc + (line.amountCents || 0), 0) || 0) === 0,
    };
  }

  static normalize(transactions: Transaction[]): NormalizedLedgerTransaction[] {
    return transactions.map((t) => {
      const workspaceScope = t.workspaceId || DEFAULT_WORKSPACE_SCOPE;
      const wsCache = this.getWorkspaceCache(workspaceScope);
      const metadataJson = t.metadata ? JSON.stringify(t.metadata) : '';
      const cacheKey = buildNormalizationKey(t, metadataJson);

      const cachedMeta = wsCache.get(cacheKey);
      if (cachedMeta) {
        wsCache.delete(cacheKey);
        wsCache.set(cacheKey, cachedMeta);
        return { ...t, _normalized: cachedMeta };
      }

      const meta = this.computeNormalizedMeta(t, metadataJson);
      if (wsCache.size >= this.MAX_CACHE_ENTRIES_PER_WORKSPACE) {
        const oldestKey = wsCache.keys().next().value;
        if (oldestKey !== undefined) {
          wsCache.delete(oldestKey);
        }
      }
      wsCache.set(cacheKey, meta);
      return { ...t, _normalized: meta };
    });
  }

  /**
   * Detects "Zombie" transactions - entries that passed balance check but contain 
   * orphaned accounts or zero-value non-offsetting lines.
   */
  static auditTransaction(tx: Transaction, accounts: ChartAccount[] | Set<string>): string[] {
    const errors: string[] = [];
    if (!this.isBalanced(tx)) errors.push('Mathematical imbalance');
    
    const isSet = accounts instanceof Set;

    if (tx.lines) {
      tx.lines.forEach((line, idx) => {
        const found = isSet ? (accounts as Set<string>).has(line.accountId) : (accounts as ChartAccount[]).some(a => a.id === line.accountId);
        if (!found) {
          errors.push(`Line ${idx + 1}: Account "${line.accountName}" not found in chart`);
        }
        if (line.amountCents === 0) {
          errors.push(`Line ${idx + 1}: Zero-value entries skew audit trails`);
        }
      });
    }

    return errors;
  }

  /**
   * Calculates multidimensional balances (by project, tag, etc).
   * Moved from lib/ledger-engine to kernel/ledger.
   */
  static computeDimensionalBalances(
    accounts: ChartAccount[],
    transactions: Transaction[],
    journalEntries: JournalEntry[] = []
  ): Map<string, { total: number, projects: Map<string, number> }> {
    const balances = new Map<string, { total: number, projects: Map<string, number> }>();
    
    // Initialize map
    accounts.forEach(acc => {
      const isDebit = acc.type === 'asset' || acc.type === 'expense' || acc.type === 'cost_of_goods';
      const opening = acc.openingBalanceCents || 0;
      balances.set(acc.id, { total: isDebit ? opening : -opening, projects: new Map() });
    });

    // We no longer loop UI transactions manually without Fx rates, etc.
    // For now, doing a basic translation.
    
    if (Array.isArray(transactions)) {
      transactions.forEach(tx => {
        if (!tx || typeof tx !== 'object') return;
        if (!isPostable(tx)) return;
        
        if (Array.isArray(tx.lines)) {
          const convertedLines = tx.lines.map(line => {
            if (!line || typeof line !== 'object') return { line, amount: 0, rawAmount: 0, rate: 1 };
            const rawAmount = typeof line.amountCents === 'number' && Number.isSafeInteger(line.amountCents) ? line.amountCents : 0;
            const rate = (typeof line.exchangeRate === 'number' && line.exchangeRate > 0 && Number.isFinite(line.exchangeRate))
              ? line.exchangeRate
              : ((typeof tx.exchangeRate === 'number' && tx.exchangeRate > 0 && Number.isFinite(tx.exchangeRate)) ? tx.exchangeRate : 1);
            
            // #90: Enforce Number.isSafeInteger after FX conversion - fail closed on overflow
            const rawConverted = Math.round(rawAmount * rate);
            if (!Number.isSafeInteger(rawConverted)) {
              throw new Error(`Monetary overflow: Converted FX amount ${rawConverted} exceeds safe integer bounds for transaction ${tx.id || 'unknown'}.`);
            }
            const amount = rawConverted;
            return { line, amount, rawAmount, rate };
          });

          // Post FX rounding difference to an explicit rounding account
          const sumRaw = convertedLines.reduce((acc, curr) => acc + curr.rawAmount, 0);
          if (sumRaw === 0 && convertedLines.length > 0) {
            const sumConverted = convertedLines.reduce((acc, curr) => acc + curr.amount, 0);
            if (sumConverted !== 0) {
              const roundingAccount = accounts.find(a => resolveAccountRole(a) === 'fx_rounding');
              if (!roundingAccount) {
                throw new Error("Cannot post transaction: Foreign exchange rounding difference detected, but no FX rounding account exists. Please ensure an account with role 'fx_rounding' is configured.");
              }
              const roundingAccId = roundingAccount.id;
              const roundingAccName = roundingAccount.name;

              // Post difference to explicit rounding account leg
              convertedLines.push({
                line: {
                  accountId: roundingAccId,
                  accountName: roundingAccName,
                  amountCents: -sumConverted,
                  description: 'FX Rounding Difference'
                },
                amount: -sumConverted,
                rawAmount: 0,
                rate: 1
              });
            }
          }

          convertedLines.forEach(({ line, amount }) => {
            if (!line || typeof line !== 'object') return;
            const accId = typeof line.accountId === 'string' ? line.accountId : '';
            // #89: Strict ID resolution - no silent guessing by code or name fallback
            const accData = balances.get(accId);

            if (accData) {
              accData.total += amount;
              
              if (line.splitAllocations && Array.isArray(line.splitAllocations) && line.splitAllocations.length > 0) {
                const allocs = line.splitAllocations;
                const weights = allocs.map(a => a.weight || 0);
                const calculatedAmounts = allocateCents(amount, weights);

                allocs.forEach((alloc, idx) => {
                  const allocAmount = calculatedAmounts[idx];
                  const proj = alloc.dimensions?.project || alloc.dimensions?.projectId || alloc.dimensions?.property || alloc.dimensions?.world || alloc.dimensions?.classId;
                  if (proj) {
                    accData.projects.set(proj, (accData.projects.get(proj) || 0) + allocAmount);
                  }
                });
              } else {
                const proj = (typeof line.project === 'string' && line.project) || (typeof tx.projectId === 'string' && tx.projectId);
                if (proj) {
                  accData.projects.set(proj, (accData.projects.get(proj) || 0) + amount);
                }
              }
            }
          });
        }
      });
    }

    if (Array.isArray(journalEntries)) {
      journalEntries.forEach(je => {
        if (!je || typeof je !== 'object') return;
        if (je.deletedAt) return; // Journal entries only have deletedAt, not status
        if ((je as JournalEntry & { transactionId?: string; parentEventId?: string }).transactionId || (je as JournalEntry & { transactionId?: string; parentEventId?: string }).parentEventId) return; // Skip journal entries originating from transactions to prevent double-counting
        if (Array.isArray(je.lines)) {
          je.lines.forEach(line => {
            if (!line || typeof line !== 'object') return;
            const accId = typeof line.accountId === 'string' ? line.accountId : '';
            const accData = balances.get(accId);
            if (accData) {
              const debit = typeof line.debit === 'number' ? line.debit : ((line as typeof line & { debitCents?: number }).debitCents || 0);
              const credit = typeof line.credit === 'number' ? line.credit : ((line as typeof line & { creditCents?: number }).creditCents || 0);
              accData.total += debit - credit;
            }
          });
        }
      });
    }

    return balances;
  }

  /**
   * Recomputes ChartAccount array with live calculated balanceCents
   */
  static recomputeAccountBalances(
    accounts: ChartAccount[],
    transactions: Transaction[],
    journalEntries: JournalEntry[] = []
  ): ChartAccount[] {
    const map = this.computeDimensionalBalances(accounts, transactions, journalEntries);
    return accounts.map(acc => {
      const data = map.get(acc.id);
      const isDebit = acc.type === 'asset' || acc.type === 'expense' || acc.type === 'cost_of_goods';
      const net = data ? data.total : (isDebit ? (acc.openingBalanceCents || 0) : -(acc.openingBalanceCents || 0));
      // Convert signed balance to natural account balance
      const balanceCents = isDebit ? net : -net;
      return {
        ...acc,
        balanceCents
      };
    });
  }

  /**
   * Verifies double-entry zero-sum across all computed accounts
   */
  static verifyZeroSum(accounts: ChartAccount[]): boolean {
    let totalNet = 0;
    accounts.forEach(acc => {
      const isDebit = acc.type === 'asset' || acc.type === 'expense' || acc.type === 'cost_of_goods';
      const signed = isDebit ? (acc.balanceCents || 0) : -(acc.balanceCents || 0);
      totalNet += signed;
    });
    return Math.abs(totalNet) === 0;
  }

  /**
   * Validates that the sum of all balances across all accounts is zero.
   * Useful for ensuring the ledger is balanced at a global level.
   */
  static calculateTrialBalance(balances: Map<string, { total: number }>): { debitTotal: number, creditTotal: number, isBalanced: boolean, difference: number } {
    let debitTotal = 0;
    let creditTotal = 0;

    balances.forEach((data) => {
      if (data.total > 0) {
        debitTotal += data.total;
      } else {
        creditTotal += Math.abs(data.total);
      }
    });

    const difference = Math.abs(debitTotal - creditTotal);

    return {
      debitTotal,
      creditTotal,
      isBalanced: difference === 0,
      difference
    };
  }
}
