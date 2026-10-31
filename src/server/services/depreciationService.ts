import type { DocumentReference, Firestore } from '../db/firestore';
import { ledgerCreate } from './ledgerDoor';
import { FieldValue } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { depreciationThrough } from '../../lib/depreciationEngine';
import { monthEnd, workspaceRole } from '../../lib/periodLock';
import { formatTzDate } from '../../lib/calendarDate';
import type { ChartAccount, FixedAsset } from '../../types';
import { writeServerAuditLog } from './auditLogService';

/**
 * Month-end depreciation run (R-06): one ledger entry for all active fixed assets, dated the last
 * day of the month (DR each asset's depreciation expense account, CR its accumulated depreciation
 * account). Per asset it posts what src/lib/depreciationEngine.ts says should be depreciated
 * through the month minus what was posted before, so a second run posts nothing and a missed
 * month is caught up. The entry and the asset updates are one database transaction; the period
 * lock and the accounts are checked by TransactionValidator.
 */

export class DepreciationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'DepreciationError';
  }
}

const WRITER_ROLES = ['owner', 'accountant', 'bookkeeper'];
const active = (a: ChartAccount) => !a.isArchived && !a.archived && a.isActive !== false;

/** Default accounts when an asset has none chosen: "Depreciation Expense" and "Accumulated Depreciation". */
export function defaultDepreciationAccounts(accounts: ChartAccount[]) {
  const usable = accounts.filter(active);
  return {
    expense: usable.find(a => /depreciation/i.test(a.name) && !/accumulated/i.test(a.name) && ['expense', 'cost_of_goods'].includes(String(a.type).toLowerCase())),
    accumulated: usable.find(a => /accumulated depreciation/i.test(a.name) && String(a.type).toLowerCase() === 'asset'),
  };
}

export async function runDepreciation(db: Firestore, input: { workspaceId: string; uid: string; email?: string; month: string }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new DepreciationError(400, 'Month must be YYYY-MM');
  const date = monthEnd(input.month);

  return db.runTransaction(async (t) => {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new DepreciationError(404, 'Workspace not found');
    if (!WRITER_ROLES.includes(workspaceRole(workspace, input.uid))) throw new DepreciationError(403, 'Viewers cannot post depreciation');
    const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    if (date > today) throw new DepreciationError(400, `${input.month} hasn't ended yet`);

    const assetDocs = (await t.get(db.collection('assets').where('workspaceId', '==', input.workspaceId))).docs;
    const accounts = (await t.get(db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId))).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
    const byId = new Map(accounts.map(a => [a.id, a]));
    const defaults = defaultDepreciationAccounts(accounts);

    const due: Array<{ ref: DocumentReference; asset: FixedAsset; amount: number; target: number; expense: ChartAccount; accumulated: ChartAccount }> = [];
    const missing: string[] = [];
    for (const d of assetDocs) {
      const asset = { ...d.data(), id: d.id } as FixedAsset;
      if (asset.status === 'disposed') continue;
      const target = depreciationThrough(asset, input.month);
      const amount = target - (asset.accumulatedDepreciationCents || 0);
      if (amount <= 0) continue;
      const expense = (asset.expenseAccountId && byId.get(asset.expenseAccountId)) || defaults.expense;
      const accumulated = (asset.accumulatedAccountId && byId.get(asset.accumulatedAccountId)) || defaults.accumulated;
      if (!expense || !accumulated) {
        missing.push(asset.name);
        continue;
      }
      due.push({ ref: d.ref, asset, amount, target, expense, accumulated });
    }
    if (missing.length) {
      throw new DepreciationError(400, `Choose the depreciation accounts for ${missing.join(', ')} (or add a "Depreciation Expense" expense account and an "Accumulated Depreciation" asset account)`);
    }
    if (due.length === 0) return { month: input.month, transactionId: null, totalCents: 0, assets: 0 };

    // One line per account: expenses debited, accumulated depreciation credited.
    const totals = new Map<string, { account: ChartAccount; cents: number }>();
    const add = (account: ChartAccount, cents: number) => {
      const row = totals.get(account.id) || { account, cents: 0 };
      row.cents += cents;
      totals.set(account.id, row);
    };
    for (const d of due) {
      add(d.expense, d.amount);
      add(d.accumulated, -d.amount);
    }
    const totalCents = due.reduce((sum, d) => sum + d.amount, 0);
    const description = `Depreciation for ${input.month} (${due.length} asset${due.length === 1 ? '' : 's'})`;

    let ledgerTx;
    try {
      ledgerTx = await TransactionValidator.validateAndPrepare({
        id: db.collection('transactions').doc().id,
        workspaceId: input.workspaceId,
        uid: input.uid,
        date,
        description,
        totalAmountCents: totalCents,
        currency: workspace.currency || 'USD',
        exchangeRate: 1,
        status: 'completed',
        type: 'actual',
        metadata: { type: 'depreciation-run', month: input.month, assets: due.map(d => ({ assetId: d.asset.id, amountCents: d.amount })) },
        lines: [...totals.values()].filter(r => r.cents !== 0).map(r => ({ accountId: r.account.id, accountName: r.account.name, amountCents: r.cents, description })),
      }, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Period Locked/i.test(message)) throw new DepreciationError(409, message);
      throw err;
    }

    ledgerCreate(t, db.collection('transactions').doc(ledgerTx.id), { ...ledgerTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    const now = new Date().toISOString();
    for (const d of due) {
      t.update(d.ref, { accumulatedDepreciationCents: d.target, depreciatedThrough: input.month, lastDepreciationTransactionId: ledgerTx.id, updatedAt: now });
    }
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'DEPRECIATION_RUN',
      entityType: 'transaction', entityId: ledgerTx.id,
      details: { description: `${description}: ${totalCents} cents`, month: input.month, totalCents, assets: due.length },
    }, { db, tx: t });
    return { month: input.month, transactionId: ledgerTx.id, totalCents, assets: due.length };
  });
}
