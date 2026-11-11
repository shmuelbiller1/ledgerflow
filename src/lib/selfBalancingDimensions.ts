import type { DimensionDefinition, Transaction, TransactionLine, Workspace } from '../types';
import { canonicalJson, sha256Hex } from './auditHashChain';
import { getLineDimension } from './dimensionUtils';
import { labelRole } from './labelRoles';
import { isPostable, lineAmount } from './txFilters';

/**
 * Strategy 2 — Self-Balancing Dimensions, Cryptographic Bilateral Intercompany Identity,
 * Self-Proving Eliminations, and Multi-Entity Close Status.
 */

export interface ClearingAccountConfig {
  dueFromAccountId: string;
  dueFromAccountName?: string;
  dueToAccountId: string;
  dueToAccountName?: string;
}

export interface DimensionBalanceResult {
  lines: TransactionLine[];
  addedLines: TransactionLine[];
  balancedDimensions: string[];
  skippedUnlabelledDimensions: string[];
}

function setDimensionOnLine(line: TransactionLine, dimensionId: string, value: string): TransactionLine {
  const next: TransactionLine = {
    ...line,
    dimensions: { ...(line.dimensions || {}), [dimensionId]: value },
  };
  if (dimensionId === 'class') next.class = value;
  if (dimensionId === 'location') next.location = value;
  if (dimensionId === 'department') next.department = value;
  if (dimensionId === 'project') next.project = value;
  return next;
}

/**
 * Automatically generates balanced Due From / Due To clearing lines for every dimension marked
 * `role: 'self-balancing'` so each dimension value's sub-ledger nets to 0 cents.
 *
 * Precondition: the input lines themselves sum to 0 cents, and every line carries a value for the
 * self-balancing dimension. If any line is unlabelled for a dimension, that dimension is reported in
 * `skippedUnlabelledDimensions` rather than guessing which fund/entity owns it.
 */
export function balanceDimensionLines(
  tx: Pick<Transaction, 'lines' | 'projectId' | 'metadata'>,
  dimensions: readonly DimensionDefinition[] | undefined,
  clearing: ClearingAccountConfig,
): DimensionBalanceResult {
  const baseLines = (tx.lines || []).map(l => ({ ...l }));
  const totalNet = baseLines.reduce((sum, l) => sum + Math.trunc(Number(l.amountCents) || 0), 0);
  if (totalNet !== 0 || !dimensions?.length) {
    return { lines: baseLines, addedLines: [], balancedDimensions: [], skippedUnlabelledDimensions: [] };
  }

  const selfBalancing = dimensions.filter(d => d.id !== 'category' && labelRole(d) === 'self-balancing');
  if (selfBalancing.length === 0) {
    return { lines: baseLines, addedLines: [], balancedDimensions: [], skippedUnlabelledDimensions: [] };
  }

  let workingLines = baseLines;
  const allAdded: TransactionLine[] = [];
  const balancedDimensions: string[] = [];
  const skippedUnlabelledDimensions: string[] = [];

  for (const dim of selfBalancing) {
    const netByValue = new Map<string, number>();
    let hasUnlabelled = false;
    const pseudoTx = { ...tx, lines: workingLines } as Transaction;

    for (const line of workingLines) {
      const val = getLineDimension(line, pseudoTx, dim.id);
      if (!val || val === 'Unassigned') {
        hasUnlabelled = true;
        break;
      }
      netByValue.set(val, (netByValue.get(val) || 0) + Math.trunc(Number(line.amountCents) || 0));
    }

    if (hasUnlabelled) {
      skippedUnlabelledDimensions.push(dim.id);
      continue;
    }

    const imbalanced = [...netByValue.entries()]
      .filter(([, cents]) => cents !== 0)
      .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));

    if (imbalanced.length === 0) {
      balancedDimensions.push(dim.id);
      continue;
    }

    // Match positive-net values (excess debits -> need Credit Due To) with negative-net values (excess credits -> need Debit Due From)
    const debtors = imbalanced.filter(([, c]) => c > 0).map(([v, c]) => ({ value: v, remaining: c }));
    const creditors = imbalanced.filter(([, c]) => c < 0).map(([v, c]) => ({ value: v, remaining: -c }));

    let dIdx = 0;
    let cIdx = 0;
    const dimAdded: TransactionLine[] = [];

    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];
      const transferCents = Math.min(debtor.remaining, creditor.remaining);

      if (transferCents > 0) {
        // 1) Credit Due To <creditor> inside <debtor> so <debtor> nets to 0
        dimAdded.push(
          setDimensionOnLine(
            {
              accountId: clearing.dueToAccountId,
              accountName: clearing.dueToAccountName || `Due To ${creditor.value}`,
              amountCents: -transferCents,
              description: `Auto-balance ${dim.name}: ${debtor.value} due to ${creditor.value}`,
            },
            dim.id,
            debtor.value,
          ),
        );

        // 2) Debit Due From <debtor> inside <creditor> so <creditor> nets to 0
        dimAdded.push(
          setDimensionOnLine(
            {
              accountId: clearing.dueFromAccountId,
              accountName: clearing.dueFromAccountName || `Due From ${debtor.value}`,
              amountCents: transferCents,
              description: `Auto-balance ${dim.name}: ${creditor.value} due from ${debtor.value}`,
            },
            dim.id,
            creditor.value,
          ),
        );
      }

      debtor.remaining -= transferCents;
      creditor.remaining -= transferCents;
      if (debtor.remaining === 0) dIdx += 1;
      if (creditor.remaining === 0) cIdx += 1;
    }

    workingLines = [...workingLines, ...dimAdded];
    allAdded.push(...dimAdded);
    balancedDimensions.push(dim.id);
  }

  return {
    lines: workingLines,
    addedLines: allAdded,
    balancedDimensions,
    skippedUnlabelledDimensions,
  };
}

export interface BilateralIntercompanySpec {
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  sourceTxId: string;
  targetTxId: string;
  date: string;
  sourceAmountCents: number;
  targetAmountCents: number;
  sourceCurrency: string;
  targetCurrency: string;
}

/** Deterministic SHA-256 shared identity digest binding both sides of an intercompany transfer. */
export function computeIntercompanyIdentityHash(spec: BilateralIntercompanySpec): string {
  return sha256Hex(
    canonicalJson({
      v: 1,
      sourceWorkspaceId: spec.sourceWorkspaceId,
      targetWorkspaceId: spec.targetWorkspaceId,
      sourceTxId: spec.sourceTxId,
      targetTxId: spec.targetTxId,
      date: String(spec.date || '').slice(0, 10),
      sourceAmountCents: Math.trunc(spec.sourceAmountCents),
      targetAmountCents: Math.trunc(spec.targetAmountCents),
      sourceCurrency: spec.sourceCurrency || 'USD',
      targetCurrency: spec.targetCurrency || 'USD',
    }),
  );
}

export interface SelfProvingEliminationPair {
  pairKey: string;
  sharedIdentityHash: string | null;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  sourceTxId: string;
  targetTxId: string | null;
  date: string;
  dueFromCents: number;
  dueToCents: number;
  discrepancyCents: number;
  status: 'matched_balanced' | 'unmatched_counterparty' | 'amount_mismatch';
  eliminationLines: Array<{
    workspaceId: string;
    accountId: string;
    accountName: string;
    amountCents: number;
    memo: string;
  }>;
}

export interface SelfProvingEliminationReport {
  asOfDate: string;
  selfProving: boolean;
  totalEliminatedCents: number;
  totalDiscrepancyCents: number;
  matchedCount: number;
  discrepancyCount: number;
  pairs: SelfProvingEliminationPair[];
}

/**
 * Matches reciprocal intercompany entries across entity workspaces and proves whether all
 * Due From and Due To clearing lines cancel to zero (`selfProving === true`).
 */
export function buildSelfProvingEliminations(
  entityTransactions: ReadonlyArray<{ workspaceId: string; transactions: readonly Transaction[] }>,
  asOfDate = '9999-12-31',
): SelfProvingEliminationReport {
  const txById = new Map<string, { workspaceId: string; tx: Transaction }>();
  const intercompanyTxs: Array<{ workspaceId: string; tx: Transaction }> = [];

  for (const bucket of entityTransactions) {
    for (const tx of bucket.transactions) {
      if (!isPostable(tx)) continue;
      const day = String(tx.date || '').slice(0, 10);
      if (day && day > asOfDate) continue;
      txById.set(tx.id, { workspaceId: bucket.workspaceId, tx });
      if (tx.metadata?.isIntercompany) {
        intercompanyTxs.push({ workspaceId: bucket.workspaceId, tx });
      }
    }
  }

  const visited = new Set<string>();
  const pairs: SelfProvingEliminationPair[] = [];

  const clearingLineOf = (tx: Transaction): { accountId: string; accountName: string; amountCents: number } => {
    const line =
      (tx.lines || []).find(l => (l.accountName || '').toLowerCase().includes('intercompany') || (l.description || '').toLowerCase().includes('due ')) ||
      tx.lines?.[0];
    return {
      accountId: String(line?.accountId || 'intercompany_clearing'),
      accountName: String(line?.accountName || 'Intercompany Clearing'),
      amountCents: Math.trunc(line ? lineAmount(line, tx) : 0),
    };
  };

  for (const item of intercompanyTxs) {
    if (visited.has(item.tx.id)) continue;
    const meta = (item.tx.metadata || {}) as Record<string, unknown>;
    const partnerId = String(meta.targetTxId || meta.sourceTxId || '');
    const partner = partnerId ? txById.get(partnerId) : undefined;

    visited.add(item.tx.id);
    if (partner) visited.add(partner.tx.id);

    const aLine = clearingLineOf(item.tx);
    const bLine = partner ? clearingLineOf(partner.tx) : null;

    // Determine source (Due From > 0) vs target (Due To < 0)
    const isASource = aLine.amountCents >= 0;
    const dueFromCents = isASource ? aLine.amountCents : (bLine ? Math.max(0, bLine.amountCents) : 0);
    const dueToCents = isASource ? (bLine ? bLine.amountCents : 0) : aLine.amountCents;

    // In balanced reciprocal books, dueFromCents + dueToCents === 0
    const discrepancyCents = partner ? dueFromCents + dueToCents : dueFromCents + dueToCents;
    let status: SelfProvingEliminationPair['status'] = 'matched_balanced';
    if (!partner) {
      status = 'unmatched_counterparty';
    } else if (discrepancyCents !== 0) {
      status = 'amount_mismatch';
    }

    const eliminationLines: SelfProvingEliminationPair['eliminationLines'] = [];
    if (partner && discrepancyCents === 0 && dueFromCents !== 0) {
      // Reverse both clearing lines so consolidated Due From and Due To both become 0
      eliminationLines.push(
        {
          workspaceId: item.workspaceId,
          accountId: aLine.accountId,
          accountName: aLine.accountName,
          amountCents: -aLine.amountCents,
          memo: `Eliminate intercompany ${item.tx.id} ↔ ${partner.tx.id}`,
        },
        {
          workspaceId: partner.workspaceId,
          accountId: bLine!.accountId,
          accountName: bLine!.accountName,
          amountCents: -bLine!.amountCents,
          memo: `Eliminate intercompany ${partner.tx.id} ↔ ${item.tx.id}`,
        },
      );
    }

    const sharedHash =
      typeof meta.sharedIdentityHash === 'string'
        ? meta.sharedIdentityHash
        : partner && typeof (partner.tx.metadata as Record<string, unknown> | undefined)?.sharedIdentityHash === 'string'
          ? String((partner.tx.metadata as Record<string, unknown>).sharedIdentityHash)
          : null;

    pairs.push({
      pairKey: partner ? [item.tx.id, partner.tx.id].sort().join(':') : item.tx.id,
      sharedIdentityHash: sharedHash,
      sourceWorkspaceId: isASource ? item.workspaceId : (partner?.workspaceId || String(meta.sourceWorkspaceId || '')),
      targetWorkspaceId: isASource ? (partner?.workspaceId || String(meta.targetWorkspaceId || '')) : item.workspaceId,
      sourceTxId: isASource ? item.tx.id : (partner?.tx.id || item.tx.id),
      targetTxId: isASource ? (partner?.tx.id || null) : item.tx.id,
      date: String(item.tx.date || '').slice(0, 10),
      dueFromCents,
      dueToCents,
      discrepancyCents,
      status,
      eliminationLines,
    });
  }

  const matchedCount = pairs.filter(p => p.status === 'matched_balanced').length;
  const discrepancyCount = pairs.length - matchedCount;
  const totalEliminatedCents = pairs
    .filter(p => p.status === 'matched_balanced')
    .reduce((sum, p) => sum + Math.abs(p.dueFromCents), 0);
  const totalDiscrepancyCents = pairs.reduce((sum, p) => sum + Math.abs(p.discrepancyCents), 0);

  return {
    asOfDate,
    selfProving: discrepancyCount === 0,
    totalEliminatedCents,
    totalDiscrepancyCents,
    matchedCount,
    discrepancyCount,
    pairs,
  };
}

export interface MultiEntityCloseRow {
  workspaceId: string;
  name: string;
  currency: string;
  lockDate: string | null;
  periodClosed: boolean;
  unreviewedCount: number;
  intercompanyDiscrepancyCents: number;
  readyToConsolidate: boolean;
}

export function computeMultiEntityCloseStatus(
  entities: ReadonlyArray<{ workspace: Pick<Workspace, 'id' | 'name' | 'currency' | 'lockDate'>; transactions: readonly Transaction[] }>,
  periodEnd: string,
): MultiEntityCloseRow[] {
  const elim = buildSelfProvingEliminations(
    entities.map(e => ({ workspaceId: e.workspace.id, transactions: e.transactions })),
    periodEnd,
  );

  return entities.map(({ workspace, transactions }) => {
    const lockDate = workspace.lockDate || null;
    const periodClosed = Boolean(lockDate && lockDate >= periodEnd);
    const unreviewedCount = transactions.filter(
      tx => (tx.status === 'pending' || tx.status === 'draft') && String(tx.date || '').slice(0, 10) <= periodEnd,
    ).length;
    const intercompanyDiscrepancyCents = elim.pairs
      .filter(p => p.sourceWorkspaceId === workspace.id || p.targetWorkspaceId === workspace.id)
      .reduce((sum, p) => sum + Math.abs(p.discrepancyCents), 0);

    return {
      workspaceId: workspace.id,
      name: workspace.name || workspace.id,
      currency: workspace.currency || 'USD',
      lockDate,
      periodClosed,
      unreviewedCount,
      intercompanyDiscrepancyCents,
      readyToConsolidate: unreviewedCount === 0 && intercompanyDiscrepancyCents === 0,
    };
  });
}
