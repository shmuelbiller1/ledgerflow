import { errorMessage, requestUser } from '../auth/requestUser';
import express from 'express';
import { PLANS, planFor, type PlanLimits } from '../../lib/plans';
import { getDb } from '../db/firestore';
import type { Firestore } from '../db/firestore';

export type MeteredResource =
  | 'entities'
  | 'firmClients'
  | 'rentalUnits'
  | 'paymentVolume'
  | 'seats'
  | 'storage'
  | 'transactions';

// Derived from the single plan table (src/lib/plans.ts); 'sandbox' maps to 'free'.
export const PLAN_LIMITS: Record<string, PlanLimits> = Object.fromEntries([
  ...PLANS.map(p => [p.id, { ...p.limits }] as const),
  ['sandbox', { ...planFor('sandbox').limits }] as const,
]);

async function countCollectionDocs(queryObj: unknown): Promise<number> {
  const q = queryObj as {
    count?: () => { get: () => Promise<{ data: (() => { count?: number }) | { count?: number } }> };
    get: () => Promise<{ size?: number; docs?: unknown[] }>;
  };
  if (typeof q.count === 'function') {
    const snap = await q.count().get();
    return typeof snap.data === 'function' ? (snap.data()?.count ?? 0) : (snap.data?.count ?? 0);
  }
  const snap = await q.get();
  return snap.size ?? (Array.isArray(snap.docs) ? snap.docs.length : 0);
}

export function requirePlanCapacity(resource: MeteredResource, dbOverride?: unknown) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const workspaceId =
        (req.params?.workspaceId as string) ||
        (req.body?.workspaceId as string) ||
        (req.body?.sourceWorkspaceId as string) ||
        (req.body?.transaction?.workspaceId as string) ||
        (req.query?.workspaceId as string) ||
        requestUser(req)?.developerWorkspaceId;

      if (!workspaceId) {
        return res.status(400).json({ status: 'error', message: 'Missing workspaceId parameter' });
      }

      const db = (dbOverride || getDb()) as ReturnType<typeof getDb>;
      const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
      if (!wsDoc.exists) {
        return res.status(404).json({ status: 'error', message: 'Workspace not found' });
      }

      const wsData = wsDoc.data() || {};
      if (wsData.bypassBilling === true) {
        return next();
      }

      const plan = String(wsData.plan || 'free').toLowerCase();
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

      if (resource === 'transactions') {
        // Strategy 7: Ledger entries are uncapped on standard plans so automation is never penalized.
        // Only enforce if an explicit enterprise/API tenant quota (`apiQuotaMonthlyLimitCents`) is set.
        if (!wsData.apiQuotaMonthlyLimitCents) {
          return next();
        }
        const txCap = Math.floor(Number(wsData.apiQuotaMonthlyLimitCents) / 100);
        const txCount = await countCollectionDocs(db.collection('transactions').where('workspaceId', '==', workspaceId));
        const adding = Array.isArray(req.body?.transactions) ? Math.max(1, req.body.transactions.length) : 1;
        if (txCount + adding > txCap) {
          return res.status(402).json({
            status: 'error',
            message: `Payment Required: Custom API transaction quota reached (${txCount}/${txCap}).`,
            code: 'PLAN_CAPACITY_EXCEEDED',
            cap: txCap,
            current: txCount,
          });
        }
      } else if (resource === 'entities') {
        const entityCap = Number(wsData.maxEntities || 0) || (limits.entities + Number(wsData.extraEntities || 0));
        const requestedEntities = Array.isArray(req.body?.workspaceIds)
          ? req.body.workspaceIds.length
          : Number(wsData.entityCount || 1) + 1;
        if (requestedEntities > entityCap) {
          return res.status(402).json({
            status: 'error',
            message: `Payment Required: Plan company/entity limit reached (${requestedEntities}/${entityCap}). Upgrade plan or add an extra entity slot.`,
            code: 'ENTITY_CAPACITY_EXCEEDED',
            cap: entityCap,
            current: requestedEntities,
          });
        }
      } else if (resource === 'firmClients') {
        const clientCap = Number(wsData.maxFirmClients || 0) || (limits.firmClients + Number(wsData.extraFirmClients || 0));
        const currentClients = Number(wsData.firmClientCount ?? (Array.isArray(req.body?.clientWorkspaceIds) ? req.body.clientWorkspaceIds.length : 0));
        if (currentClients >= clientCap) {
          return res.status(402).json({
            status: 'error',
            message: `Payment Required: Plan accounting-firm client limit reached (${currentClients}/${clientCap}). Upgrade plan or add client slots.`,
            code: 'FIRM_CLIENT_CAPACITY_EXCEEDED',
            cap: clientCap,
            current: currentClients,
          });
        }
      } else if (resource === 'rentalUnits') {
        const unitCap = Number(wsData.maxRentalUnits || 0) || (limits.rentalUnits + Number(wsData.extraRentalUnits || 0));
        const currentUnits = Number(wsData.rentalUnitCount ?? 0);
        const adding = Array.isArray(req.body?.units) ? Math.max(1, req.body.units.length) : 1;
        if (currentUnits + adding > unitCap) {
          return res.status(402).json({
            status: 'error',
            message: `Payment Required: Plan rental unit limit reached (${currentUnits}/${unitCap}). Upgrade plan or add per-unit capacity.`,
            code: 'RENTAL_UNIT_CAPACITY_EXCEEDED',
            cap: unitCap,
            current: currentUnits,
          });
        }
      } else if (resource === 'paymentVolume') {
        // Payment volume scales via platform revenue-share bps; never hard-block collecting cash unless explicitly capped.
        if (wsData.maxMonthlyPaymentVolumeCents && Number(wsData.currentMonthPaymentVolumeCents || 0) >= Number(wsData.maxMonthlyPaymentVolumeCents)) {
          return res.status(402).json({
            status: 'error',
            message: 'Payment Required: Monthly payment volume limit reached.',
            code: 'PAYMENT_VOLUME_CAPACITY_EXCEEDED',
            cap: Number(wsData.maxMonthlyPaymentVolumeCents),
            current: Number(wsData.currentMonthPaymentVolumeCents || 0),
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
            current: memberCount,
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
            current: currentStorageMb,
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
  /** Ledger entries recorded (limit is null when uncapped, so automation is never penalized). */
  entries: { used: number; limit: number | null };
  entities: { used: number; limit: number };
  firmClients: { used: number; limit: number };
  rentalUnits: { used: number; limit: number };
  paymentVolumeCents: { used: number; limit: number; platformFeeBps: number };
  seats: { used: number; limit: number };
  storageMb: { used: number; limit: number };
}

/**
 * Strategy 7 + L-15: what a workspace uses against its value-aligned plan meters:
 * companies/entities, accounting-firm clients, active rental units, monthly payment volume,
 * people with access, and document storage — while entries are counted for visibility without a cap.
 */
export async function workspaceUsage(db: Firestore, workspaceId: string): Promise<WorkspaceUsage | null> {
  const ws = (await db.collection('workspaces').doc(workspaceId).get()).data();
  if (!ws) return null;
  const plan = String(ws.plan || 'free').toLowerCase();
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const ownerUid = String(ws.uid || '');
  const currentMonth = new Date().toISOString().slice(0, 7);

  const [txRes, groupRes, clientRes, unitRes, payRes] = await Promise.all([
    db.pool.query('select count(*)::int as n from public.transactions where workspace_id = $1', [workspaceId]),
    ownerUid
      ? db.pool.query(
          `select coalesce(max(jsonb_array_length(coalesce(data->'workspaceIds', '[]'::jsonb))), 1)::int as n
             from public."workspaceGroups"
            where data->>'ownerUid' = $1`,
          [ownerUid],
        )
      : Promise.resolve({ rows: [{ n: 1 }] }),
    ownerUid
      ? db.pool.query(
          `select count(*)::int as n
             from public.workspaces
            where data->>'uid' = $1
               or coalesce(data->'members', '[]'::jsonb) ? $1
               or (data->'roles' ? $1)`,
          [ownerUid],
        )
      : Promise.resolve({ rows: [{ n: 1 }] }),
    db.pool.query(
      `select count(*)::int as n
         from public.projects
        where workspace_id = $1
          and (coalesce(data->>'unitType', '') = 'rental_unit' or coalesce((data->>'monthlyRentCents')::bigint, 0) > 0)`,
      [workspaceId],
    ),
    db.pool.query(
      `select coalesce(sum((data->>'amountCents')::bigint), 0)::bigint as vol
         from public.payments
        where workspace_id = $1
          and coalesce(data->>'status', 'completed') not in ('void', 'failed')
          and left(coalesce(data->>'paymentDate', data->>'date', ''), 7) = $2`,
      [workspaceId, currentMonth],
    ),
  ]);

  const rentalUnitsFromWs = Array.isArray(ws.rentalUnits) ? ws.rentalUnits.length : 0;

  return {
    plan,
    unlimited: ws.bypassBilling === true,
    entries: {
      used: txRes.rows[0]?.n || 0,
      limit: ws.apiQuotaMonthlyLimitCents ? Math.floor(Number(ws.apiQuotaMonthlyLimitCents) / 100) : null,
    },
    entities: {
      used: Math.max(1, Number(groupRes.rows[0]?.n || 1)),
      limit: Number(ws.maxEntities || 0) || (limits.entities + Number(ws.extraEntities || 0)),
    },
    firmClients: {
      used: Math.max(1, Number(clientRes.rows[0]?.n || 1)),
      limit: Number(ws.maxFirmClients || 0) || (limits.firmClients + Number(ws.extraFirmClients || 0)),
    },
    rentalUnits: {
      used: Math.max(rentalUnitsFromWs, Number(unitRes.rows[0]?.n || 0)),
      limit: Number(ws.maxRentalUnits || 0) || (limits.rentalUnits + Number(ws.extraRentalUnits || 0)),
    },
    paymentVolumeCents: {
      used: Number(payRes.rows[0]?.vol || 0),
      limit: Number(ws.maxMonthlyPaymentVolumeCents || 0) || limits.paymentVolumeCents,
      platformFeeBps: limits.platformFeeBps,
    },
    seats: {
      used: Array.isArray(ws.members) ? ws.members.length : 1,
      limit: Number(ws.concurrentUserLimit || ws.maxSeats) || limits.seats,
    },
    storageMb: {
      used: Number(ws.currentStorageMb) || 0,
      limit: Number(ws.maxStorageMb) || planFor(plan).limits.storageMb,
    },
  };
}
