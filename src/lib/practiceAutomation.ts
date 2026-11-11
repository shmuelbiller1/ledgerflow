import type { Invoice, Transaction } from '../types';
import { normalizeSearchText } from './textNormalization';
import { computeTFIDFWeights, similarityWithTFIDF } from './algorithms/tf-idf';
import { induceRules } from './algorithms/rule-induction';
import { learnCrossDimensionRules } from './algorithms/cross-dimension-inference';
import { detectRecurrences } from './algorithms/recurrence';
import { findReconciliationSubset } from './algorithms/subset-sum';
import { findMyError } from './algorithms/find-my-error';
import { DUPLICATE_DETECTION_ALGO } from './algorithms/duplicate-detection';
import { fingerprintBusiness } from './algorithms/auto-setup';
import { runContinuousCloseCheck } from './algorithms/continuous-close';
import { evaluateAmountExpression } from './amountExpression';
import { calculateLateFee } from './paymentTerms';
import { calculateAmountDue } from './documentMath';
import { isPostable } from './txFilters';

export interface BankLineForNoTouch {
  id: string;
  date?: string;
  status?: string;
  matchedTransactionId?: string | null;
  ruleIdsApplied?: string[];
  suggestion?: { accountId?: string; ruleIds?: string[] } | null;
  humanEdited?: boolean;
  acceptedUnchanged?: boolean;
}

export interface NoTouchMetrics {
  noTouchCount: number;
  totalBankLines: number;
  /** Null when there are zero bank lines (never invent a percentage on empty data). */
  ratePercent: number | null;
  editedAfterRuleCount: number;
  pendingCount: number;
}

/**
 * Strategy 1: Measured No-Touch Rate.
 * Formula: bank lines posted from a rule or learned history that no human subsequently edited
 * divided by total bank lines in scope.
 */
export function computeNoTouchRate(
  bankLines: readonly BankLineForNoTouch[],
  transactions: readonly Transaction[] = [],
  periodMonth?: string,
): NoTouchMetrics {
  const txById = new Map<string, Transaction>();
  for (const tx of transactions) {
    if (tx.id) txById.set(tx.id, tx);
  }

  const scoped = periodMonth
    ? bankLines.filter(bl => String(bl.date || '').slice(0, 7) === periodMonth)
    : bankLines;

  if (scoped.length === 0) {
    return {
      noTouchCount: 0,
      totalBankLines: 0,
      ratePercent: null,
      editedAfterRuleCount: 0,
      pendingCount: 0,
    };
  }

  let noTouchCount = 0;
  let editedAfterRuleCount = 0;
  let pendingCount = 0;

  for (const line of scoped) {
    const status = String(line.status || 'pending').toLowerCase();
    if (status === 'pending' && !line.matchedTransactionId) {
      pendingCount += 1;
      continue;
    }
    if (status === 'ignored' || status === 'excluded' || status === 'dismissed') {
      continue;
    }

    const linkedTx = line.matchedTransactionId ? txById.get(line.matchedTransactionId) : undefined;
    if (!linkedTx || !isPostable(linkedTx)) {
      continue;
    }

    const hadRuleOrHistory =
      (Array.isArray(line.ruleIdsApplied) && line.ruleIdsApplied.length > 0) ||
      Boolean(line.suggestion?.accountId) ||
      line.acceptedUnchanged === true;

    const verifMethod = String(linkedTx.verification?.method || '');
    const txFromAuto =
      Boolean((linkedTx.metadata as Record<string, unknown> | undefined)?.autoPosted) ||
      verifMethod === 'rule' ||
      verifMethod === 'learned';

    if (!hadRuleOrHistory && !txFromAuto) continue;

    const suggestedAccId = line.suggestion?.accountId;
    const postedNonCashLine = linkedTx?.lines?.find(l => l.accountId && l.accountId !== suggestedAccId);
    const postedMatchesSuggested =
      !suggestedAccId ||
      !linkedTx?.lines?.length ||
      linkedTx.lines.some(l => l.accountId === suggestedAccId) ||
      !postedNonCashLine;

    const wasEditedByHuman =
      line.humanEdited === true ||
      Boolean((linkedTx?.metadata as Record<string, unknown> | undefined)?.editedByHuman) ||
      !postedMatchesSuggested;

    if (wasEditedByHuman) {
      editedAfterRuleCount += 1;
    } else {
      noTouchCount += 1;
    }
  }

  return {
    noTouchCount,
    totalBankLines: scoped.length,
    ratePercent: Math.round((noTouchCount / scoped.length) * 1000) / 10,
    editedAfterRuleCount,
    pendingCount,
  };
}

export interface FirmNoTouchSummary {
  totalClients: number;
  totalBankLines: number;
  totalNoTouchLines: number;
  firmNoTouchPercent: number | null;
  averageCloseReadiness: number;
}

export function computeFirmNoTouchSummary(
  clients: ReadonlyArray<{
    noTouch?: { noTouchCount: number; totalBankLines: number } | null;
    closeReadiness?: { score: number } | null;
  }>,
): FirmNoTouchSummary {
  let totalBankLines = 0;
  let totalNoTouchLines = 0;
  let readinessSum = 0;
  let readinessCount = 0;

  for (const c of clients) {
    if (c.noTouch) {
      totalBankLines += c.noTouch.totalBankLines;
      totalNoTouchLines += c.noTouch.noTouchCount;
    }
    if (c.closeReadiness) {
      readinessSum += c.closeReadiness.score;
      readinessCount += 1;
    }
  }

  return {
    totalClients: clients.length,
    totalBankLines,
    totalNoTouchLines,
    firmNoTouchPercent: totalBankLines > 0 ? Math.round((totalNoTouchLines / totalBankLines) * 1000) / 10 : null,
    averageCloseReadiness: readinessCount > 0 ? Math.round(readinessSum / readinessCount) : 100,
  };
}

export interface CalibratedAutoPostOptions {
  minCases?: number;
  minAccuracy?: number;
}

export interface CalibratedAutoPostDecision {
  payeeKey: string;
  decision: 'auto_post' | 'needs_review';
  sampleSize: number;
  unchangedCount: number;
  accuracy: number | null;
  suggestedAccountId: string | null;
  suggestedAccountName: string | null;
  reason: string;
}

function normalizePayeeKey(payee?: string, description?: string): string {
  const raw = normalizeSearchText(payee || description || '');
  const tokens = (raw.match(/[\p{L}\p{M}\p{N}]+/gu) || []).filter(w => w.length >= 2);
  return tokens.slice(0, 3).join(' ');
}

/**
 * Strategy 1: Calibrated Automatic Posting.
 * Measures historical suggestion-accepted-unchanged accuracy per payee/merchant.
 * Auto-posts ONLY when accuracy >= threshold (default 99%) over >= minCases (default 10);
 * otherwise routes to human review with an explicit plain-English reason.
 */
export function evaluateCalibratedAutoPost(
  candidate: { payee?: string; description?: string; suggestedAccountId?: string; suggestedAccountName?: string },
  historicalTransactions: readonly Transaction[],
  options: CalibratedAutoPostOptions = {},
): CalibratedAutoPostDecision {
  const minCases = options.minCases ?? 10;
  const minAccuracy = options.minAccuracy ?? 0.99;
  const payeeKey = normalizePayeeKey(candidate.payee, candidate.description);

  if (!payeeKey) {
    return {
      payeeKey: '',
      decision: 'needs_review',
      sampleSize: 0,
      unchangedCount: 0,
      accuracy: null,
      suggestedAccountId: candidate.suggestedAccountId || null,
      suggestedAccountName: candidate.suggestedAccountName || null,
      reason: 'Missing merchant/payee description — requires human review.',
    };
  }

  const accountCounts = new Map<string, { name: string; count: number; overriddenCount: number }>();
  let totalMatches = 0;

  for (const tx of historicalTransactions) {
    if (tx.status === 'draft' || tx.status === 'void' || tx.status === 'failed') continue;
    const txKey = normalizePayeeKey(tx.payee, tx.description);
    if (txKey !== payeeKey) continue;

    const primaryLine = tx.lines?.find(l => l.accountId && l.accountName !== 'Uncategorized');
    if (!primaryLine?.accountId) continue;

    totalMatches += 1;
    const meta = (tx.metadata || {}) as Record<string, unknown>;
    const overridden =
      meta.editedByHuman === true ||
      (typeof meta.suggestedAccountId === 'string' && meta.suggestedAccountId !== primaryLine.accountId);

    const existing = accountCounts.get(primaryLine.accountId) || {
      name: primaryLine.accountName || primaryLine.accountId,
      count: 0,
      overriddenCount: 0,
    };
    existing.count += 1;
    if (overridden) existing.overriddenCount += 1;
    accountCounts.set(primaryLine.accountId, existing);
  }

  let bestAccountId: string | null = candidate.suggestedAccountId || null;
  let bestAccountName: string | null = candidate.suggestedAccountName || null;
  let bestUnchanged = 0;

  for (const [accId, stats] of accountCounts.entries()) {
    const unchanged = stats.count - stats.overriddenCount;
    if (!bestAccountId || unchanged > bestUnchanged) {
      bestAccountId = accId;
      bestAccountName = stats.name;
      bestUnchanged = unchanged;
    }
  }

  if (candidate.suggestedAccountId && accountCounts.has(candidate.suggestedAccountId)) {
    const stats = accountCounts.get(candidate.suggestedAccountId)!;
    bestAccountId = candidate.suggestedAccountId;
    bestAccountName = candidate.suggestedAccountName || stats.name;
    bestUnchanged = stats.count - stats.overriddenCount;
  }

  const accuracy = totalMatches > 0 ? bestUnchanged / totalMatches : null;

  if (totalMatches < minCases) {
    return {
      payeeKey,
      decision: 'needs_review',
      sampleSize: totalMatches,
      unchangedCount: bestUnchanged,
      accuracy,
      suggestedAccountId: bestAccountId,
      suggestedAccountName: bestAccountName,
      reason:
        totalMatches === 0
          ? `New payee "${payeeKey}" — needs ${minCases} confirmed entries before automatic posting.`
          : `${bestUnchanged}/${totalMatches} unchanged for "${payeeKey}" (${minCases} required before automatic posting).`,
    };
  }

  if (accuracy !== null && accuracy >= minAccuracy && bestAccountId) {
    const pct = (accuracy * 100).toFixed(1).replace(/\.0$/, '');
    return {
      payeeKey,
      decision: 'auto_post',
      sampleSize: totalMatches,
      unchangedCount: bestUnchanged,
      accuracy,
      suggestedAccountId: bestAccountId,
      suggestedAccountName: bestAccountName,
      reason: `Accepted unchanged ${bestUnchanged}/${totalMatches} times (${pct}%) → ${bestAccountName || bestAccountId}.`,
    };
  }

  const pct = accuracy !== null ? (accuracy * 100).toFixed(1) : '0.0';
  return {
    payeeKey,
    decision: 'needs_review',
    sampleSize: totalMatches,
    unchangedCount: bestUnchanged,
    accuracy,
    suggestedAccountId: bestAccountId,
    suggestedAccountName: bestAccountName,
    reason: `Accuracy ${pct}% (${bestUnchanged}/${totalMatches}) is below the ${(minAccuracy * 100).toFixed(0)}% auto-post bar.`,
  };
}

export interface SimilarLineCluster {
  clusterId: string;
  label: string;
  leadId: string;
  memberIds: string[];
  count: number;
  totalAbsAmountCents: number;
  suggestedCategory: string | null;
}

/**
 * Strategy 1 ("Decide once, apply to many"):
 * Uses TF-IDF token weighting (`src/lib/algorithms/tf-idf.ts`) so banking noise tokens (POS, DEBIT,
 * ACH, CARD) get low IDF weight while merchant tokens cluster similar unreviewed lines together.
 */
export function groupSimilarUnreviewedLines(
  unreviewed: readonly Transaction[],
  corpus: readonly Transaction[] = unreviewed,
  similarityThreshold = 0.62,
): SimilarLineCluster[] {
  if (unreviewed.length === 0) return [];
  const idf = computeTFIDFWeights(corpus.length >= unreviewed.length ? corpus : unreviewed);
  const visited = new Set<string>();
  const clusters: SimilarLineCluster[] = [];

  for (let i = 0; i < unreviewed.length; i++) {
    const lead = unreviewed[i];
    if (!lead.id || visited.has(lead.id)) continue;
    visited.add(lead.id);

    const memberIds = [lead.id];
    let totalAbsAmountCents = Math.abs(lead.totalAmountCents || 0);

    for (let j = i + 1; j < unreviewed.length; j++) {
      const other = unreviewed[j];
      if (!other.id || visited.has(other.id)) continue;
      const sim = similarityWithTFIDF(lead.description || '', other.description || '', idf);
      if (sim >= similarityThreshold) {
        visited.add(other.id);
        memberIds.push(other.id);
        totalAbsAmountCents += Math.abs(other.totalAmountCents || 0);
      }
    }

    const suggestedCategory =
      lead.lines?.find(l => l.accountName && l.accountName !== 'Uncategorized')?.accountName ||
      lead.lines?.find(l => l.category && l.category !== 'Uncategorized')?.category ||
      null;

    clusters.push({
      clusterId: `cluster_${lead.id}`,
      label: lead.payee || lead.description || 'Unreviewed entry',
      leadId: lead.id,
      memberIds,
      count: memberIds.length,
      totalAbsAmountCents,
      suggestedCategory,
    });
  }

  return clusters.sort((a, b) => b.count - a.count || b.totalAbsAmountCents - a.totalAbsAmountCents);
}

export interface CloseReadinessInput {
  bankLines: number;
  bankLogins: number;
  questions: number;
  drafts: number;
  billsWithoutFile: number;
  lastMonthClosed: boolean;
  health: { serious: number; warnings: number } | null;
}

export interface CloseReadinessResult {
  score: number;
  grade: 'ready' | 'almost_ready' | 'attention_needed';
  blockers: string[];
}

/**
 * Strategy 1: Close-Readiness Score (0–100) per client book.
 * Penalizes unreconciled bank lines, open client questions, serious data health problems,
 * unposted drafts, broken bank logins, and an unclosed prior month.
 */
export function computeCloseReadiness(input: CloseReadinessInput): CloseReadinessResult {
  let penalty = 0;
  const blockers: string[] = [];

  if (input.bankLines > 0) {
    penalty += Math.min(35, input.bankLines * 4);
    blockers.push(`${input.bankLines} bank line${input.bankLines === 1 ? '' : 's'} to review`);
  }
  if (input.questions > 0) {
    penalty += Math.min(24, input.questions * 8);
    blockers.push(`${input.questions} open client question${input.questions === 1 ? '' : 's'}`);
  }
  if ((input.health?.serious || 0) > 0) {
    const s = input.health!.serious;
    penalty += Math.min(40, s * 20);
    blockers.push(`${s} serious data health issue${s === 1 ? '' : 's'}`);
  }
  if ((input.health?.warnings || 0) > 0) {
    penalty += Math.min(9, input.health!.warnings * 3);
  }
  if (input.drafts > 0) {
    penalty += Math.min(20, input.drafts * 5);
    blockers.push(`${input.drafts} draft${input.drafts === 1 ? '' : 's'} waiting`);
  }
  if (input.bankLogins > 0) {
    penalty += Math.min(15, input.bankLogins * 10);
    blockers.push(`${input.bankLogins} bank login${input.bankLogins === 1 ? '' : 's'} expired`);
  }
  if (input.billsWithoutFile > 0) {
    penalty += Math.min(8, input.billsWithoutFile * 2);
  }
  if (!input.lastMonthClosed) {
    penalty += 12;
    blockers.push('Prior month still open');
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));
  const grade: CloseReadinessResult['grade'] =
    score >= 90 ? 'ready' : score >= 70 ? 'almost_ready' : 'attention_needed';

  return { score, grade, blockers };
}

export interface ConnectedAlgorithmSignals {
  inducedRules: ReturnType<typeof induceRules>;
  crossDimensionRules: ReturnType<typeof learnCrossDimensionRules>;
  recurringPatterns: ReturnType<typeof detectRecurrences>;
  subsetPayoutMatchIds: string[] | null;
  errorSuspects: ReturnType<typeof findMyError>;
  duplicateInsights: string[];
  industryFingerprint: ReturnType<typeof fingerprintBusiness>;
  continuousClose: ReturnType<typeof runContinuousCloseCheck>;
  overdueLateFees: Array<{ invoiceId: string; invoiceNumber: string; daysOverdue: number; lateFeeCents: number }>;
}

/**
 * Audit M-7 + Strategy 1: Connects the previously standalone algorithms in `src/lib/algorithms/`,
 * `amountExpression.ts`, and `paymentTerms.ts` into one deterministic workspace signal digest.
 */
export function buildConnectedAlgorithmSignals(params: {
  transactions: readonly Transaction[];
  invoices?: readonly Invoice[];
  bankDepositTargetCents?: number;
  trialBalanceDiscrepancyCents?: number;
  asOfDateIso?: string;
}): ConnectedAlgorithmSignals {
  const {
    transactions,
    invoices = [],
    bankDepositTargetCents,
    trialBalanceDiscrepancyCents = 0,
    asOfDateIso = new Date().toISOString().slice(0, 10),
  } = params;

  const verifiedCorpus = transactions.map(t =>
    t.verification?.status === 'verified'
      ? t
      : { ...t, verification: { status: 'verified' as const, method: 'manual' as const, hash: '', timestamp: '' } },
  );

  const inducedRules = induceRules(verifiedCorpus, 3, 0.85);
  const crossDimensionRules = learnCrossDimensionRules(transactions);
  const recurringPatterns = detectRecurrences(transactions, 2);

  const openInvoiceCandidates = invoices
    .filter(inv => inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'draft')
    .map(inv => ({ id: inv.id, amountCents: calculateAmountDue(inv) }))
    .filter(c => c.amountCents > 0);

  const subsetPayoutMatchIds =
    typeof bankDepositTargetCents === 'number' && bankDepositTargetCents > 0 && openInvoiceCandidates.length > 0
      ? findReconciliationSubset(openInvoiceCandidates, bankDepositTargetCents)?.map(m => m.id) || null
      : null;

  const errorSuspects =
    Math.abs(trialBalanceDiscrepancyCents) > 0 ? findMyError(transactions, trialBalanceDiscrepancyCents) : [];

  const dupResult = DUPLICATE_DETECTION_ALGO.compute(
    {
      transactions: transactions as Transaction[],
      accounts: [],
      projects: [],
      accounting: {
        isCash: () => false,
        isReceivable: () => false,
        isPayable: () => false,
        isRevenue: () => false,
        isExpense: () => false,
        isCOGS: () => false,
      },
    } as never,
    { timeWindowDays: 3 },
  );

  const overdueLateFees = invoices
    .filter(inv => inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'draft' && inv.dueDate)
    .map(inv => {
      const due = calculateAmountDue(inv);
      const fee = calculateLateFee(due, String(inv.dueDate).slice(0, 10), asOfDateIso);
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.number || inv.id,
        daysOverdue: fee.daysOverdue,
        lateFeeCents: fee.lateFeeCents,
        isOverdue: fee.isOverdue,
      };
    })
    .filter(x => x.isOverdue && x.lateFeeCents > 0)
    .map(({ isOverdue: _over, ...rest }) => rest);

  return {
    inducedRules,
    crossDimensionRules,
    recurringPatterns,
    subsetPayoutMatchIds,
    errorSuspects,
    duplicateInsights: dupResult.insights || [],
    industryFingerprint: fingerprintBusiness(transactions),
    continuousClose: runContinuousCloseCheck(transactions),
    overdueLateFees,
  };
}

/** Safe wrapper around `evaluateAmountExpression` for inline quick-split / review calculators. */
export function tryEvaluateAmountInput(rawInput: string): { ok: true; cents: number } | { ok: false; error: string } {
  try {
    return { ok: true, cents: evaluateAmountExpression(rawInput) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid expression' };
  }
}
