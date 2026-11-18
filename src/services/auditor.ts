import { isPostable, lineAmount } from '../lib/txFilters';
import { Transaction, ChartAccount, JournalEntry } from '../types';
import { MerkleTree, MinHash, sha256Sync } from '../lib/algorithms';
import { PerformanceTelemetry } from '../lib/telemetry';
import { parseLocalDate } from '../lib/utils';

export interface AuditResult {
  isBalanced: boolean;
  totalDebits: number;
  totalCredits: number;
  imbalances: Array<{ id: string; type: 'transaction' | 'journal'; diff: number }>;
  orphans: Array<{ id: string; type: 'transaction' | 'journal'; message: string }>;
  duplicateCandidates: Array<{ id: string; reason: string }>;
  missingAccounts: Array<{ id: string; accountName: string; lineIdx: number }>;
  hashChainValid: boolean;
  brokenChainIndex: number | null;
  merkleRoot: string;
  duplicateCheckSkipped?: boolean;
}

export const DoubleEntryAuditor = {
  /**
   * Deterministic audit of the entire ledger.
   * Zero AI. Pure mathematical verification.
   */
  auditLedger: (
    transactions: Transaction[], 
    accounts: ChartAccount[], 
    journalEntries: JournalEntry[] = []
  ): AuditResult => {
    PerformanceTelemetry.start("DoubleEntryAuditor:auditLedger");
    let totalDebits = 0;
    let totalCredits = 0;
    const imbalances: AuditResult['imbalances'] = [];
    const orphans: AuditResult['orphans'] = [];
    const missingAccounts: AuditResult['missingAccounts'] = [];
    const duplicateCandidates: AuditResult['duplicateCandidates'] = [];
    
    // Google-Scale Similarity Engine (MinHash)
    const minHash = new MinHash(64);
    
    // Rule Hash Chain Verification
    let hashChainValid = true;
    let brokenChainIndex: number | null = null;
    
    const accountIds = new Set(accounts.map(a => a.id));

    // Sort transactions by chronological creation to verify the causal chain
    // O(N log N) mapped sort (Schwartzian transform) to prevent millions of native Date parses on 50,000+ inputs
    const chronosTxs = transactions
      .map(t => ({ t, time: t.createdAt ? new Date(t.createdAt).getTime() : (t.date ? parseLocalDate(t.date).getTime() : 0) }))
      .sort((a, b) => { if (a.time !== b.time) return a.time - b.time; return (a.t && b.t && a.t.id && b.t.id) ? a.t.id.localeCompare(b.t.id) : 0; })
      .map(item => item.t);

    // Causal Integrity Check: All transactions with a verification block are part of the cryptographic sequence.
    // We do NOT filter to isPostable() because void/deleted transactions still exist in the immutable chain.
    // Only entries that record a link (`previousHash`) are checked: the server signs every entry it writes
    // (`hash`) without linking it, and an unlinked signed entry is not a broken link. A linked entry is
    // valid when it points to the preceding linked entry's hash, to an unlinked server-signed entry strictly
    // between the preceding linked entry and itself, or (for the very first linked entry) to 'genesis'.
    let lastLinkedHash: string | null = null;
    const interveningUnlinkedHashes = new Set<string>();

    // Optimized Duplicate Detection using Bucketing
    const signatureBuckets = new Map<number, { id: string; sig: number[] }[]>();
    const skipDuplicateCheck = chronosTxs.length > 5000;

    // 1. Audit Transactions & Hash Chain
    chronosTxs.forEach((t, i) => {
      const isActive = isPostable(t);
      const currentHash = typeof t.verification?.hash === 'string' && t.verification.hash !== '' ? t.verification.hash : null;
      const link = typeof t.verification?.previousHash === 'string' && t.verification.previousHash !== '' ? t.verification.previousHash : null;

      // Verify Cryptographic Link in a single chronological pass (O(1) per entry)
      if (link !== null) {
        const validLink = lastLinkedHash === null
          ? link === 'genesis' || interveningUnlinkedHashes.has(link)
          : link === lastLinkedHash || interveningUnlinkedHashes.has(link);
        if (!validLink) {
          hashChainValid = false;
          if (brokenChainIndex === null) brokenChainIndex = i;
        }
        lastLinkedHash = currentHash;
        interveningUnlinkedHashes.clear();
      } else if (currentHash !== null) {
        interveningUnlinkedHashes.add(currentHash);
      }

      // Only perform financial auditing on postable entries
      if (isActive) {
        let txDebit = 0;
        let txCredit = 0;
        
        const lines = t.lines || [];
        if (lines.length === 0) {
          orphans.push({ id: t.id, type: 'transaction', message: 'No allocation lines found' });
        }

        for (let lIdx = 0; lIdx < lines.length; lIdx++) {
          const line = lines[lIdx];
          if (!accountIds.has(line.accountId)) {
            missingAccounts.push({ id: t.id, accountName: line.accountName || line.accountId, lineIdx: lIdx });
          }
          
          const amt = lineAmount(line, t);
          if (amt > 0) txDebit += amt;
          else txCredit += Math.abs(amt);
        }

        const diff = txDebit - txCredit;
        if (Math.abs(diff) > 0.01) {
          imbalances.push({ id: t.id, type: 'transaction', diff });
        }

        totalDebits += txDebit;
        totalCredits += txCredit;

        // 1.1 Causal Integrity Check
        // Payload hash verification is handled server-side because client lacks the secret SYSTEM_SALT.
        // Client still verifies the hash chain link sequence (previousHash matches previous hash pointer).

        // 1.2 Optimized Duplicate Check (LSH MinHash with Bucketing - F7 checks all bucket entries)
        if (!skipDuplicateCheck) {
          const currentSig = minHash.createSignature(`${t.description || ''} ${t.totalAmountCents} ${t.date}`);
          const amountKey = t.totalAmountCents;
          
          const bucket = signatureBuckets.get(amountKey) || [];
          for (let bIdx = 0; bIdx < bucket.length; bIdx++) {
            const prev = bucket[bIdx];
            const similarity = minHash.compare(currentSig, prev.sig);
            if (similarity > 0.95) {
              duplicateCandidates.push({ id: t.id, reason: `Pattern similarity (${Math.round(similarity * 100)}%) with ${prev.id}` });
              break; 
            }
          }
          
          if (!signatureBuckets.has(amountKey)) signatureBuckets.set(amountKey, []);
          signatureBuckets.get(amountKey)!.push({ id: t.id, sig: currentSig });
        }
      }
    });

    // 2. Audit Journal Entries (F5: Defensive NaN guards)
    journalEntries.forEach(entry => {
      let entryDebit = 0;
      let entryCredit = 0;

      entry.lines?.forEach((line, idx) => {
        if (!accountIds.has(line.accountId)) {
          missingAccounts.push({ id: entry.id, accountName: line.accountName || line.accountId, lineIdx: idx });
        }
        const deb = Number(line.debit) || 0;
        const cred = Number(line.credit) || 0;
        entryDebit += deb;
        entryCredit += cred;
      });

      const diff = entryDebit - entryCredit;
      if (Math.abs(diff) > 0.01) {
        imbalances.push({ id: entry.id, type: 'journal', diff });
      }

      totalDebits += Math.round(entryDebit);
      totalCredits += Math.round(entryCredit);
    });

    // 3. Construct Merkle Root of Trust
    const tree = new MerkleTree(chronosTxs.filter(t => t.verification?.hash).map(t => t.verification!.hash));

    PerformanceTelemetry.end("DoubleEntryAuditor:auditLedger");
    return {
      isBalanced: Math.abs(totalDebits - totalCredits) < 1,
      totalDebits,
      totalCredits,
      imbalances,
      orphans,
      duplicateCandidates,
      missingAccounts,
      hashChainValid,
      brokenChainIndex,
      merkleRoot: tree.root,
      duplicateCheckSkipped: skipDuplicateCheck
    };
  },

  /**
   * Generates a deterministic signature for a transaction.
   * Cryptographically covers all transaction fields to prevent tampering (F3).
   * Uses a canonical string representation (sorted keys) to ensure order-independence.
   */
  computeHash: (tx: Transaction, previousHash?: string): string => {
    // Canonical Object construction (Sorted Keys) - comprehensive coverage
    const canonical = {
      amount: tx.totalAmountCents,
      currency: tx.currency || 'USD',
      date: tx.date,
      desc: tx.description || '',
      dimensions: tx.dimensions || {},
      dueDate: tx.dueDate || '',
      eventId: tx.eventId || '',
      exchangeRate: tx.exchangeRate || 1,
      id: tx.id || '',
      isCleared: Boolean(tx.isCleared),
      isFlagged: Boolean(tx.isFlagged),
      isIntercompany: Boolean(tx.isIntercompany),
      isLocked: Boolean(tx.isLocked),
      lines: (tx.lines || []).map(l => ({
        accountId: l.accountId || '',
        accountName: l.accountName || '',
        amountCents: l.amountCents || 0,
        class: l.class || '',
        desc: l.description || '',
        dimensions: l.dimensions || {},
        loc: l.location || '',
        proj: l.project || '',
        quantity: l.quantity ?? null,
        splitAllocations: l.splitAllocations || [],
        unitPriceCents: l.unitPriceCents ?? null
      })).sort((a, b) => a.accountId.localeCompare(b.accountId) || a.amountCents - b.amountCents),
      lockedAt: tx.lockedAt || '',
      metadata: tx.metadata || {},
      parentEventId: tx.parentEventId || '',
      payee: tx.payee || '',
      paymentToken: tx.paymentToken || '',
      prev: previousHash || 'genesis',
      project: tx.project || tx.projectId || '',
      reversalEventId: tx.reversalEventId || '',
      status: tx.status || 'completed',
      tags: tx.tags || [],
      taxAmountCents: tx.taxAmountCents ?? 0,
      type: tx.type || 'expense',
      uid: tx.uid || '',
      workspaceId: tx.workspaceId || ''
    };
    
    const salt = (typeof process !== 'undefined' && process.env?.SYSTEM_SALT) 
      || 'ledgerflow-forensic-vault-v1';
    return sha256Sync(JSON.stringify(canonical) + `:${salt}`);
  },

  /**
   * Causal Chain Repair: Re-hashes the sequence of active transactions
   * to establish an explicit audited recovery checkpoint.
   */
  repairChain: (transactions: Transaction[], auditorUid?: string): Transaction[] => {
    const sorted = transactions
      .map(tx => ({ tx, time: tx.createdAt ? new Date(tx.createdAt).getTime() : (tx.date ? parseLocalDate(tx.date).getTime() : 0) }))
      .sort((a, b) => { if (a.time !== b.time) return a.time - b.time; return (a.tx && b.tx && a.tx.id && b.tx.id) ? a.tx.id.localeCompare(b.tx.id) : 0; })
      .map(item => item.tx);
    let lastHash = 'genesis';
    
    return sorted.map(tx => {
      if (!isPostable(tx)) {
        return tx;
      }
      const newHash = DoubleEntryAuditor.computeHash(tx, lastHash);
      const updatedTx = {
        ...tx,
        verification: {
          ...(tx.verification || {}),
          status: 'verified' as const,
          hash: newHash,
          previousHash: lastHash,
          verifiedAt: new Date().toISOString(),
          timestamp: tx.verification?.timestamp || new Date().toISOString(),
          repairedAt: new Date().toISOString(),
          repairedBy: auditorUid || tx.uid || 'system'
        }
      };
      lastHash = newHash;
      return updatedTx;
    });
  }
};
