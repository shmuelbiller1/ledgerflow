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
  sourceCurrency?: string;
  targetCurrency?: string;
  reportingCurrency?: string;
  dueFromCents: number;
  dueToCents: number;
  discrepancyCents: number;
  status: 'matched_balanced' | 'unmatched_counterparty' | 'amount_mismatch' | 'unsupported_translation';
  eliminationLines: Array<{
    workspaceId: string;
    accountId: string;
    accountName: string;
    amountCents: number;
    currency?: string;
    reportingAmountCents?: number;
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
  untranslatedCount?: number;
  pairs: SelfProvingEliminationPair[];
}

export interface IntercompanyTranslationOptions {
  reportingCurrency?: string;
  /** Explicit units of `reportingCurrency` per 1 unit of source/target currency (e.g. `{ USD: 1, ILS: 0.27027027 }`). */
  exchangeRates?: Readonly<Record<string, number>>;
}

/**
 * Matches reciprocal intercompany entries across entity workspaces and proves whether all
 * Due From and Due To clearing lines cancel to zero (`selfProving === true`).
 * Cross-currency pairs are translated into `reportingCurrency` using an explicit `exchangeRates`
 * basis, or reported as `unsupported_translation` rather than subtracting incompatible minor units.
 */
export function buildSelfProvingEliminations(
  entityTransactions: ReadonlyArray<{ workspaceId: string; currency?: string; transactions: readonly Transaction[] }>,
  asOfDate = '9999-12-31',
  translation?: IntercompanyTranslationOptions,
): SelfProvingEliminationReport {
  const txById = new Map<string, { workspaceId: string; bucketCurrency?: string; tx: Transaction }>();
  const intercompanyTxs: Array<{ workspaceId: string; bucketCurrency?: string; tx: Transaction }> = [];

  for (const bucket of entityTransactions) {
    for (const tx of bucket.transactions) {
      if (!isPostable(tx)) continue;
      const day = String(tx.date || '').slice(0, 10);
      if (day && day > asOfDate) continue;
      txById.set(tx.id, { workspaceId: bucket.workspaceId, bucketCurrency: bucket.currency, tx });
      if (tx.metadata?.isIntercompany) {
        intercompanyTxs.push({ workspaceId: bucket.workspaceId, bucketCurrency: bucket.currency, tx });
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

  const currencyOf = (entry: { bucketCurrency?: string; tx: Transaction }): string =>
    String(entry.tx.currency || entry.bucketCurrency || 'USD').trim().toUpperCase();

  const resolveRate = (ccy: string, repCcy: string): number | null => {
    if (ccy === repCcy) return 1;
    const raw = translation?.exchangeRates?.[ccy];
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
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
    const sourceEntry = isASource ? item : partner;
    const targetEntry = isASource ? partner : item;
    const sourceCurrency = sourceEntry ? currencyOf(sourceEntry) : currencyOf(item);
    const targetCurrency = targetEntry ? currencyOf(targetEntry) : sourceCurrency;
    const reportingCurrency = String(translation?.reportingCurrency || sourceCurrency).trim().toUpperCase();

    const nativeDueFromCents = isASource ? aLine.amountCents : (bLine ? Math.max(0, bLine.amountCents) : 0);
    const nativeDueToCents = isASource ? (bLine ? bLine.amountCents : 0) : aLine.amountCents;

    let dueFromCents = nativeDueFromCents;
    let dueToCents = nativeDueToCents;
    let discrepancyCents = 0;
    let status: SelfProvingEliminationPair['status'] = 'matched_balanced';

    if (!partner) {
      status = 'unmatched_counterparty';
      discrepancyCents = nativeDueFromCents + nativeDueToCents;
    } else if (sourceCurrency === targetCurrency && sourceCurrency === reportingCurrency) {
      discrepancyCents = nativeDueFromCents + nativeDueToCents;
      if (discrepancyCents !== 0) status = 'amount_mismatch';
    } else {
      const sourceRate = resolveRate(sourceCurrency, reportingCurrency);
      const targetRate = resolveRate(targetCurrency, reportingCurrency);
      if (sourceRate === null || targetRate === null) {
        status = 'unsupported_translation';
      } else {
        dueFromCents = Math.round(nativeDueFromCents * sourceRate);
        dueToCents = Math.round(nativeDueToCents * targetRate);
        discrepancyCents = dueFromCents + dueToCents;
        if (discrepancyCents !== 0) status = 'amount_mismatch';
      }
    }

    const eliminationLines: SelfProvingEliminationPair['eliminationLines'] = [];
    if (partner && status === 'matched_balanced' && dueFromCents !== 0) {
      const itemCcy = currencyOf(item);
      const partnerCcy = currencyOf(partner);
      eliminationLines.push(
        {
          workspaceId: item.workspaceId,
          accountId: aLine.accountId,
          accountName: aLine.accountName,
          amountCents: -aLine.amountCents,
          currency: itemCcy,
          reportingAmountCents: isASource ? -dueFromCents : -dueToCents,
          memo: `Eliminate intercompany ${item.tx.id} ↔ ${partner.tx.id}`,
        },
        {
          workspaceId: partner.workspaceId,
          accountId: bLine!.accountId,
          accountName: bLine!.accountName,
          amountCents: -bLine!.amountCents,
          currency: partnerCcy,
          reportingAmountCents: isASource ? -dueToCents : -dueFromCents,
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
      pairKey: partner ? [item.tx.id, partner.tx.id].sort((a, b) => a.localeCompare(b, 'en')).join(':') : item.tx.id,
      sharedIdentityHash: sharedHash,
      sourceWorkspaceId: isASource ? item.workspaceId : (partner?.workspaceId || String(meta.sourceWorkspaceId || '')),
      targetWorkspaceId: isASource ? (partner?.workspaceId || String(meta.targetWorkspaceId || '')) : item.workspaceId,
      sourceTxId: isASource ? item.tx.id : (partner?.tx.id || item.tx.id),
      targetTxId: isASource ? (partner?.tx.id || null) : item.tx.id,
      date: String(item.tx.date || '').slice(0, 10),
      sourceCurrency,
      targetCurrency,
      reportingCurrency,
      dueFromCents,
      dueToCents,
      discrepancyCents,
      status,
      eliminationLines,
    });
  }

  const matchedCount = pairs.filter(p => p.status === 'matched_balanced').length;
  const untranslatedCount = pairs.filter(p => p.status === 'unsupported_translation').length;
  const discrepancyCount = pairs.filter(p => p.status === 'unmatched_counterparty' || p.status === 'amount_mismatch').length;
  const totalEliminatedCents = pairs
    .filter(p => p.status === 'matched_balanced')
    .reduce((sum, p) => sum + Math.abs(p.dueFromCents), 0);
  const totalDiscrepancyCents = pairs
    .filter(p => p.status === 'unmatched_counterparty' || p.status === 'amount_mismatch')
    .reduce((sum, p) => sum + Math.abs(p.discrepancyCents), 0);

  return {
    asOfDate,
    selfProving: discrepancyCount === 0 && untranslatedCount === 0,
    totalEliminatedCents,
    totalDiscrepancyCents,
    matchedCount,
    discrepancyCount,
    untranslatedCount,
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
  untranslatedIntercompanyCount?: number;
  readyToConsolidate: boolean;
}

export function computeMultiEntityCloseStatus(
  entities: ReadonlyArray<{ workspace: Pick<Workspace, 'id' | 'name' | 'currency' | 'lockDate'>; transactions: readonly Transaction[] }>,
  periodEnd: string,
  translation?: IntercompanyTranslationOptions,
): MultiEntityCloseRow[] {
  const elim = buildSelfProvingEliminations(
    entities.map(e => ({ workspaceId: e.workspace.id, currency: e.workspace.currency, transactions: e.transactions })),
    periodEnd,
    translation,
  );

  return entities.map(({ workspace, transactions }) => {
    const lockDate = workspace.lockDate || null;
    const periodClosed = Boolean(lockDate && lockDate >= periodEnd);
    const unreviewedCount = transactions.filter(
      tx => (tx.status === 'pending' || tx.status === 'draft') && String(tx.date || '').slice(0, 10) <= periodEnd,
    ).length;
    const relatedPairs = elim.pairs.filter(
      p => p.sourceWorkspaceId === workspace.id || p.targetWorkspaceId === workspace.id,
    );
    const intercompanyDiscrepancyCents = relatedPairs
      .filter(p => p.status === 'unmatched_counterparty' || p.status === 'amount_mismatch')
      .reduce((sum, p) => sum + Math.abs(p.discrepancyCents), 0);
    const untranslatedIntercompanyCount = relatedPairs.filter(p => p.status === 'unsupported_translation').length;

    return {
      workspaceId: workspace.id,
      name: workspace.name || workspace.id,
      currency: workspace.currency || 'USD',
      lockDate,
      periodClosed,
      unreviewedCount,
      intercompanyDiscrepancyCents,
      untranslatedIntercompanyCount,
      readyToConsolidate: unreviewedCount === 0 && intercompanyDiscrepancyCents === 0 && untranslatedIntercompanyCount === 0,
    };
  });
}
