/**
 * Metered usage billing for the AI and developer endpoints: one place that charges a workspace for
 * a call — quota cents and compute credits on the workspace, the monthly counters, and the trace row
 * the billing ledger keeps — so every metered route charges the same way.
 */
import crypto from 'crypto';
import type { Firestore } from '../db/firestore';
import { calculateWorkspaceCharges } from '../http/serverKit';
import { incrementShardedCounter } from './shardedCounterService';

/** The per-call fields of a billing trace row; a route may add its own (model, tokens, cost…). */
export interface UsageTrace {
  algorithmName: string;
  complexityFormat: string;
  executionTimeMs: number;
  [field: string]: unknown;
}

export interface ChargeUsageParams {
  db: Firestore;
  workspaceId: string;
  /** Credits to charge before the workspace's own multiplier. */
  baseWeight: number;
  /** Cents to charge before the workspace's own multiplier. */
  baseCents: number;
  isCustomKeyUsed: boolean;
  /** The workspace's settings when the caller already read them; read from the document otherwise. */
  wsData?: Record<string, unknown>;
  uid?: string;
  userEmail?: string;
  trace: UsageTrace;
}

export interface ChargedUsage {
  weightScore: number;
  deltaCents: number;
}

/**
 * Charges the workspace and writes the trace. Returns null when the workspace no longer exists (the
 * call itself still succeeds — billing never blocks the answer). The caller keeps its own try/catch:
 * a failed charge is logged and bypassed, not turned into an error for the reader.
 */
export async function chargeUsageAndTrace(params: ChargeUsageParams): Promise<ChargedUsage | null> {
  const { db, workspaceId, baseWeight, baseCents, isCustomKeyUsed } = params;
  const wsRef = db.collection('workspaces').doc(workspaceId);
  let wsData = params.wsData;
  if (!wsData) {
    const wsDoc = await wsRef.get();
    if (!wsDoc.exists) return null;
    wsData = wsDoc.data() || {};
  }

  const { credits: weightScore, cents: deltaCents } = calculateWorkspaceCharges(wsData, baseWeight, baseCents, isCustomKeyUsed);

  const usedCents = typeof wsData.apiQuotaTotalCentsUsed === 'number' ? wsData.apiQuotaTotalCentsUsed : 0;
  const hardness = typeof wsData.computeHardnessScore === 'number' ? wsData.computeHardnessScore : 0;
  await wsRef.update({
    apiQuotaTotalCentsUsed: usedCents + deltaCents,
    computeHardnessScore: hardness + weightScore
  });

  await incrementShardedCounter(db, workspaceId, 'totalQueriesThisMonth', 1);
  await incrementShardedCounter(db, workspaceId, 'computeCreditBalance', -weightScore);

  const traceId = `trace-${crypto.randomUUID()}`;
  await db.collection('billingLedgerTraces').doc(traceId).set({
    id: traceId,
    workspaceId,
    uid: params.uid || 'api_user',
    userEmail: params.userEmail || 'developer@ledgerflow.io',
    ...params.trace,
    weightScore,
    timestamp: new Date().toISOString()
  });

  return { weightScore, deltaCents };
}
