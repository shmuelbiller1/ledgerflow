import { errorMessage, requestUser } from '../auth/requestUser';
import express from 'express';
import { PLANS, planFor } from '../../lib/plans';
import { getDb } from '../db/firestore';
import type { Firestore } from '../db/firestore';

// From the one plan table (src/lib/plans.ts); 'sandbox' is the free plan's older name.
export const PLAN_LIMITS: Record<string, { transactions: number; seats: number }> = Object.fromEntries([
  ...PLANS.map(p => [p.id, { transactions: p.limits.transactions, seats: p.limits.seats }] as const),
  ['sandbox', { transactions: planFor('sandbox').limits.transactions, seats: planFor('sandbox').limits.seats }] as const,
]);

export function requirePlanCapacity(resource: 'transactions' | 'seats' | 'storage', dbOverride?: any) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const workspaceId =
        (req.params?.workspaceId as string) ||
        (req.body?.workspaceId as string) ||
        (req.body?.transaction?.workspaceId as string) ||
        (req.query?.workspaceId as string) ||
        requestUser(req)?.developerWorkspaceId;

      if (!workspaceId) {
        return res.status(400).json({ status: 'error', message: 'Missing workspaceId parameter' });
      }

      const db = dbOverride || getDb();
      const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
      if (!wsDoc.exists) {
        return res.status(404).json({ status: 'error', message: 'Workspace not found' });
      }

      const wsData = wsDoc.data() || {};
      if (wsData.bypassBilling === true) {
        return next();
      }

      const plan = (wsData.plan || 'free').toLowerCase();
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

      if (resource === 'transactions') {
        const txCap = wsData.apiQuotaMonthlyLimitCents ? Math.floor(wsData.apiQuotaMonthlyLimitCents / 100) : limits.transactions;
        const txQuery = db.collection('transactions').where('workspaceId', '==', workspaceId);
        
        let txCount = 0;
        if (typeof (txQuery as any).count === 'function') {
          const countSnap = await (txQuery as any).count().get();
          txCount = typeof countSnap.data === 'function' ? (countSnap.data()?.count ?? 0) : (countSnap.data?.count ?? 0);
        } else {
          // Fallback for test mocks lacking native count aggregation
          const txSnap = await txQuery.get();
          txCount = txSnap.size ?? (txSnap.docs ? txSnap.docs.length : 0);
        }

        // Z-03: a batch adds as many entries as it carries
        const adding = Array.isArray(req.body?.transactions) ? Math.max(1, req.body.transactions.length) : 1;
        if (txCount + adding > txCap) {
          return res.status(402).json({
            status: 'error',
            message: `Payment Required: Plan transaction limit reached (${txCount}/${txCap}). Upgrade workspace plan to continue creating transactions.`,
            code: 'PLAN_CAPACITY_EXCEEDED',
            cap: txCap,
            current: txCount
          });
        }
      } else if (resource === 'seats') {
        const seatCap = wsData.concurrentUserLimit || wsData.maxSeats || limits.seats;
        const members = wsData.members || [];
        const memberCount = Array.isArray(members) ? members.length : 1;

        if (memberCount >= seatCap) {
          return res.status(402).json({
            status: 'error',
            message: `Payment Required: Plan user seat limit reached (${memberCount}/${seatCap}). Upgrade workspace plan to invite more team members.`,
            code: 'SEAT_CAPACITY_EXCEEDED',
            cap: seatCap,
            current: memberCount
          });
        }
      } else if (resource === 'storage') {
        const storageCapMb = wsData.maxStorageMb || planFor(plan).limits.storageMb;
        const currentStorageMb = wsData.currentStorageMb || 0;
        if (currentStorageMb >= storageCapMb) {
          return res.status(402).json({
            status: 'error',
            message: `Payment Required: Plan storage limit reached (${currentStorageMb}/${storageCapMb} MB). Upgrade workspace plan for additional document storage.`,
            code: 'STORAGE_CAPACITY_EXCEEDED',
            cap: storageCapMb,
            current: currentStorageMb
          });
        }
      }

      next();
    } catch (err) {
      console.error('[requirePlanCapacity] Quota check error:', err);
      return res.status(500).json({ status: 'error', message: errorMessage(err) || 'Capacity verification failed' });
    }
  };
}

export interface WorkspaceUsage {
  plan: string;
  /** billing is not enforced for this workspace (no limits apply) */
  unlimited: boolean;
  entries: { used: number; limit: number };
  seats: { used: number; limit: number };
  storageMb: { used: number; limit: number };
}

/**
 * L-15: what a workspace uses against its plan, worked out the same way the limits above are checked:
 * entries (all of them), people with access, and document storage.
 */
export async function workspaceUsage(db: Firestore, workspaceId: string): Promise<WorkspaceUsage | null> {
  const ws = (await db.collection('workspaces').doc(workspaceId).get()).data();
  if (!ws) return null;
  const plan = String(ws.plan || 'free').toLowerCase();
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const { rows } = await db.pool.query('select count(*)::int as n from public.transactions where workspace_id = $1', [workspaceId]);
  return {
    plan,
    unlimited: ws.bypassBilling === true,
    entries: { used: rows[0]?.n || 0, limit: ws.apiQuotaMonthlyLimitCents ? Math.floor(Number(ws.apiQuotaMonthlyLimitCents) / 100) : limits.transactions },
    seats: { used: Array.isArray(ws.members) ? ws.members.length : 1, limit: Number(ws.concurrentUserLimit || ws.maxSeats) || limits.seats },
    storageMb: { used: Number(ws.currentStorageMb) || 0, limit: Number(ws.maxStorageMb) || (plan === 'enterprise' ? 100000 : plan === 'pro' ? 25000 : plan === 'growth' ? 5000 : 500) },
  };
}
