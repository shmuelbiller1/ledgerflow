import { HttpError } from '../auth/requestUser';
import type { Firestore } from '../db/firestore';
import { getShardedCounterValue } from './shardedCounterService';

/** The developer API's credit and monthly quota gates, also used by its named write operations. */
export async function assertDeveloperUsageQuota(db: Firestore, workspaceId: string, workspace: Record<string, unknown>) {
  // ACC-1: free access given by LedgerFlow lifts both gates.
  if (workspace.bypassBilling === true) return;
  const baseline = workspace.computeCreditBalance !== undefined ? Number(workspace.computeCreditBalance) : 100000;
  const creditBalance = await getShardedCounterValue(db, workspaceId, 'computeCreditBalance', baseline);
  if (creditBalance <= 0) {
    throw Object.assign(new HttpError('PAYMENT_REQUIRED: This workspace has exhausted its compute credit balance (0 left). Please upgrade your plan or top up in settings.', 402), { code: 'PAYMENT_REQUIRED' });
  }
  const quotaLimitCents = Number(workspace.apiQuotaMonthlyLimitCents ?? 0);
  const quotaUsedCents = Number(workspace.apiQuotaTotalCentsUsed ?? 0);
  if (quotaLimitCents > 0 && quotaUsedCents >= quotaLimitCents) {
    throw Object.assign(new HttpError('QUOTA_EXCEEDED: Workspace monthly spending quota limit exceeded. Please configure custom plan limits with your administrator.', 429), { code: 'QUOTA_EXCEEDED' });
  }
}
