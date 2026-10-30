/**
 * L-123 step 4c: the fixed-asset register as of a date over every asset and every posted depreciation run of the
 * workspace, for the register screen when the browser's assets or entries are capped. Read-only.
 */
import type { ChartAccount, FixedAsset, Transaction } from '../../types';
import type { Firestore } from '../db/firestore';
import { assetRegisterReport, type AssetRegisterReport } from '../../lib/assetRegisterReport';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const chunks = <T>(list: T[], size = 100) => { const out: T[][] = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };

/** Runs are found by metadata.type; their reversals by either reversal link the browser's ledger honours. */
export async function assetRegisterAsOf(db: Firestore, workspaceId: string, asOf: string): Promise<AssetRegisterReport & { runsRead: number }> {
  if (!DATE.test(asOf)) throw new Error(`An as-of date is YYYY-MM-DD (got "${asOf}")`);
  const tx = () => db.collection('transactions').where('workspaceId', '==', workspaceId);
  const [assetsSnap, accountsSnap, runsSnap] = await Promise.all([
    db.collection('assets').where('workspaceId', '==', workspaceId).get(),
    db.collection('chartAccounts').where('workspaceId', '==', workspaceId).get(),
    tx().where('metadata.type', '==', 'depreciation-run').get(),
  ]);
  const of = <T>(d: { id: string; data: () => unknown }) => ({ ...(d.data() as object), id: d.id }) as T;
  const runs = runsSnap.docs.map(d => of<Transaction>(d));
  const reversals = new Map<string, Transaction>();
  for (const ids of chunks(runs.map(r => r.id))) {
    for (const field of ['metadata.reversesTxId', 'metadata.reversedTransactionId']) {
      for (const d of (await tx().where(field, 'in', ids).get()).docs) reversals.set(d.id, of<Transaction>(d));
    }
  }
  // a run may name its reversal itself (reversalEventId): read those by id, this workspace's only (Codex on #449)
  const named = [...new Set(runs.map(r => r.reversalEventId).filter((id): id is string => !!id && !reversals.has(id)))];
  for (const ids of chunks(named)) {
    for (const d of await db.getAll(...ids.map(id => db.collection('transactions').doc(id)))) {
      const t = d.exists ? of<Transaction>(d) : null;
      if (t?.workspaceId === workspaceId) reversals.set(t.id, t);
    }
  }
  const report = assetRegisterReport(assetsSnap.docs.map(d => of<FixedAsset>(d)), accountsSnap.docs.map(d => of<ChartAccount>(d)),
    [...runs, ...[...reversals.values()].filter(r => !runs.some(x => x.id === r.id))], asOf);
  return { ...report, runsRead: runs.length };
}
