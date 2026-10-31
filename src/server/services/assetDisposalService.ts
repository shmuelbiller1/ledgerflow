import type { Firestore } from '../db/firestore';
import { ledgerCreate } from './ledgerDoor';
import { FieldValue } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { depreciationThrough } from '../../lib/depreciationEngine';
import { postingLock, lockMessage, workspaceRole } from '../../lib/periodLock';
import { disposalGainLoss, disposalLines, disposalProblem, partialDisposalInput, portionOf, portionProblem, type DisposalAccounts } from '../../lib/assetDisposal';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { formatTzDate } from '../../lib/calendarDate';
import type { ChartAccount, FixedAsset, PartialDisposal } from '../../types';
import { defaultDepreciationAccounts } from './depreciationService';
import { writeServerAuditLog } from './auditLogService';

/**
 * Selling or scrapping a fixed asset (X-03): one ledger entry on the disposal date that posts the
 * depreciation still due through that month, takes the asset and its accumulated depreciation off
 * the books, records the money received and the gain or loss (src/lib/assetDisposal.ts). The asset
 * is marked disposed in the same database transaction. Undo voids that entry and puts the asset back
 * as it was, while the date is open. Owners, accountants and bookkeepers; the period lock applies.
 * Part of an asset (X-04, `portionPercent`): that share of the cost and accumulated depreciation
 * leaves, the rest stays active on the smaller cost; undo takes back the latest share while nothing
 * was posted for the asset after it.
 */
export class DisposalError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const WRITERS = ['owner', 'accountant', 'bookkeeper'];
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

interface Actor { workspaceId: string; uid: string; email?: string }
export interface DisposeInput extends Actor {
  assetId: string;
  date: string;
  proceedsCents: number;
  proceedsAccountId?: string;
  gainLossAccountId?: string;
  /** For an asset saved without its balance-sheet account. */
  assetAccountId?: string;
  /** X-04: only this share (more than 0, less than 100 percent) is sold or scrapped. */
  portionPercent?: number;
}

export async function disposeAsset(db: Firestore, input: DisposeInput) {
  if (!DAY.test(input.date)) throw new DisposalError(400, 'Choose the date it was sold or scrapped');
  const partial = input.portionPercent !== undefined && input.portionPercent !== 100;
  if (partial) {
    const problem = portionProblem(Number(input.portionPercent));
    if (problem) throw new DisposalError(400, problem);
  }
  return db.runTransaction(async t => {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new DisposalError(404, 'Workspace not found');
    if (!WRITERS.includes(workspaceRole(workspace, input.uid))) throw new DisposalError(403, 'Viewers cannot dispose of assets');
    const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    if (input.date > today) throw new DisposalError(400, 'The disposal date cannot be in the future');
    const assetRef = db.collection('assets').doc(input.assetId);
    const assetData = (await t.get(assetRef)).data();
    if (!assetData || assetData.workspaceId !== input.workspaceId) throw new DisposalError(404, 'That asset is not in this workspace');
    const asset = { ...assetData, id: input.assetId } as FixedAsset;
    if (asset.status === 'disposed') throw new DisposalError(409, `${asset.name} is already disposed of`);
    if (asset.purchaseDate && input.date < asset.purchaseDate.slice(0, 10)) throw new DisposalError(400, `${asset.name} was bought on ${asset.purchaseDate.slice(0, 10)}; it cannot go before that`);

    const accounts = (await t.get(db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId))).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
    const byId = new Map(accounts.map(a => [a.id, a]));
    const pick = (id?: string) => (id ? byId.get(id) : undefined);
    const defaults = defaultDepreciationAccounts(accounts);
    const month = input.date.slice(0, 7);
    const posted = asset.accumulatedDepreciationCents || 0;
    const target = Math.max(posted, depreciationThrough(asset, month));
    // X-04: the share leaving; what stays has accumulated what the engine says the smaller asset has by now
    const share = partial ? portionOf(asset, Number(input.portionPercent)) : null;
    const remainingDepreciation = share ? Math.min(target, depreciationThrough({ ...asset, purchasePriceCents: share.remainingCostCents, salvageValueCents: share.remainingSalvageCents }, month)) : 0;
    const amounts = share
      ? partialDisposalInput(share.costPartCents, target - remainingDepreciation, target - posted, input.proceedsCents)
      : { costCents: asset.purchasePriceCents || 0, postedDepreciationCents: posted, catchUpCents: target - posted, proceedsCents: input.proceedsCents };
    const chosen: Partial<DisposalAccounts> = {
      asset: pick(input.assetAccountId) || pick(asset.assetAccountId),
      accumulated: pick(asset.accumulatedAccountId) || defaults.accumulated,
      expense: pick(asset.expenseAccountId) || defaults.expense,
      gainLoss: pick(input.gainLossAccountId),
      proceeds: pick(input.proceedsAccountId),
    };
    if (input.gainLossAccountId && !chosen.gainLoss) throw new DisposalError(400, 'The gain or loss account is not in this workspace');
    if (input.proceedsAccountId && !chosen.proceeds) throw new DisposalError(400, 'The account the money went to is not in this workspace');
    const problem = disposalProblem(amounts, chosen);
    if (problem) throw new DisposalError(400, problem);
    const lines = disposalLines(amounts, chosen as DisposalAccounts);
    const gainLoss = disposalGainLoss(amounts);
    const currency = String(workspace.currency || 'USD');
    const description = `${input.proceedsCents > 0 ? 'Sale' : 'Disposal'} of ${share ? `${input.portionPercent}% of ` : ''}${asset.name}${gainLoss ? ` (${gainLoss > 0 ? 'gain' : 'loss'} ${formatCurrency(Math.abs(gainLoss), currency)})` : ''}`;
    const before = {
      status: asset.status || 'active', accumulatedDepreciationCents: posted,
      depreciatedThrough: asset.depreciatedThrough || null, assetAccountId: asset.assetAccountId || null,
    };

    let ledgerTx;
    try {
      ledgerTx = await TransactionValidator.validateAndPrepare({
        id: db.collection('transactions').doc().id,
        workspaceId: input.workspaceId,
        uid: input.uid,
        date: input.date,
        description,
        totalAmountCents: amounts.costCents,
        currency,
        exchangeRate: 1,
        status: 'completed',
        type: 'actual',
        metadata: { type: share ? 'asset-partial-disposal' : 'asset-disposal', assetId: asset.id, proceedsCents: input.proceedsCents, gainLossCents: gainLoss, catchUpCents: amounts.catchUpCents, before, ...(share ? { portionPercent: input.portionPercent } : {}) },
        lines: lines.map(l => ({ ...l, description })),
      }, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Period Locked/i.test(message)) throw new DisposalError(409, message);
      throw err;
    }

    ledgerCreate(t, db.collection('transactions').doc(ledgerTx.id), { ...ledgerTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    if (share) {
      const record: PartialDisposal = {
        date: input.date, percent: Number(input.portionPercent), costCents: share.costPartCents, salvageCents: share.salvagePartCents,
        accumulatedCents: target - remainingDepreciation, proceedsCents: input.proceedsCents, gainLossCents: gainLoss, transactionId: ledgerTx.id,
        before: { purchasePriceCents: asset.purchasePriceCents || 0, salvageValueCents: asset.salvageValueCents || 0, accumulatedDepreciationCents: posted, depreciatedThrough: asset.depreciatedThrough || null },
      };
      t.update(assetRef, {
        purchasePriceCents: share.remainingCostCents, salvageValueCents: share.remainingSalvageCents,
        accumulatedDepreciationCents: remainingDepreciation, depreciatedThrough: month,
        partialDisposals: [...(asset.partialDisposals || []), record],
        ...(chosen.asset && !asset.assetAccountId ? { assetAccountId: chosen.asset.id } : {}),
        updatedAt: new Date().toISOString(),
      });
      await writeServerAuditLog({
        workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'ASSET_PARTLY_DISPOSED', entityType: 'assets', entityId: asset.id,
        details: { description: `${description} on ${input.date}; received ${formatCurrency(input.proceedsCents, currency)}; cost left ${formatCurrency(share.remainingCostCents, currency)}`, transactionId: ledgerTx.id, gainLossCents: gainLoss },
      }, { db, tx: t });
      return { transactionId: ledgerTx.id, gainLossCents: gainLoss, catchUpCents: amounts.catchUpCents, partial: true };
    }
    t.update(assetRef, {
      status: 'disposed', disposedOn: input.date, disposalProceedsCents: input.proceedsCents, disposalGainLossCents: gainLoss,
      disposalTransactionId: ledgerTx.id, accumulatedDepreciationCents: target, depreciatedThrough: month,
      ...(chosen.asset && !asset.assetAccountId ? { assetAccountId: chosen.asset.id } : {}),
      updatedAt: new Date().toISOString(),
    });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'ASSET_DISPOSED', entityType: 'assets', entityId: asset.id,
      details: { description: `${description} on ${input.date}; received ${formatCurrency(input.proceedsCents, currency)}`, transactionId: ledgerTx.id, gainLossCents: gainLoss },
    }, { db, tx: t });
    return { transactionId: ledgerTx.id, gainLossCents: gainLoss, catchUpCents: amounts.catchUpCents };
  });
}

/** Undo a disposal: its entry is voided and the asset is as it was before, while the date is open. */
export async function undoDisposal(db: Firestore, input: Actor & { assetId: string }) {
  return db.runTransaction(async t => {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new DisposalError(404, 'Workspace not found');
    if (!WRITERS.includes(workspaceRole(workspace, input.uid))) throw new DisposalError(403, 'Viewers cannot change assets');
    const assetRef = db.collection('assets').doc(input.assetId);
    const asset = (await t.get(assetRef)).data();
    if (!asset || asset.workspaceId !== input.workspaceId) throw new DisposalError(404, 'That asset is not in this workspace');
    const shares = (asset.partialDisposals || []) as PartialDisposal[];
    if (asset.status !== 'disposed' && shares.length) {
      // X-04: take back the latest share sold, while nothing was posted for the asset after it
      const last = shares[shares.length - 1];
      const shareLock = postingLock(last.date, workspace as never, input.uid);
      if (shareLock) throw new DisposalError(409, lockMessage(last.date, shareLock));
      if (asset.depreciatedThrough && asset.depreciatedThrough > last.date.slice(0, 7)) {
        throw new DisposalError(409, `Depreciation for ${String(asset.name)} was posted after this sale (through ${String(asset.depreciatedThrough)}); undo that first`);
      }
      const now = new Date().toISOString();
      const shareTx = db.collection('transactions').doc(last.transactionId);
      if ((await t.get(shareTx)).data()?.status !== 'void') t.update(shareTx, { status: 'void', voidedReason: 'Partial disposal undone', voidedAt: now, updatedAt: now });
      t.update(assetRef, { ...last.before, partialDisposals: shares.slice(0, -1), updatedAt: now });
      await writeServerAuditLog({
        workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'ASSET_PARTIAL_DISPOSAL_UNDONE', entityType: 'assets', entityId: input.assetId,
        details: { description: `Undid the sale of ${last.percent}% of ${String(asset.name || input.assetId)}; its entry is void`, transactionId: last.transactionId },
      }, { db, tx: t });
      return { assetId: input.assetId };
    }
    if (asset.status !== 'disposed' || !asset.disposalTransactionId) throw new DisposalError(409, 'This asset was not disposed of here');
    const txRef = db.collection('transactions').doc(String(asset.disposalTransactionId));
    const entry = (await t.get(txRef)).data();
    const lock = postingLock(String(entry?.date || asset.disposedOn || ''), workspace as never, input.uid);
    if (lock) throw new DisposalError(409, lockMessage(String(entry?.date || asset.disposedOn), lock));
    const before = (entry?.metadata?.before || {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    if (entry && entry.status !== 'void') t.update(txRef, { status: 'void', voidedReason: 'Disposal undone', voidedAt: now, updatedAt: now });
    t.update(assetRef, {
      status: before.status || 'active',
      accumulatedDepreciationCents: typeof before.accumulatedDepreciationCents === 'number' ? before.accumulatedDepreciationCents : asset.accumulatedDepreciationCents,
      depreciatedThrough: before.depreciatedThrough ?? null,
      disposedOn: FieldValue.delete(), disposalProceedsCents: FieldValue.delete(), disposalGainLossCents: FieldValue.delete(), disposalTransactionId: FieldValue.delete(),
      updatedAt: now,
    });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'ASSET_DISPOSAL_UNDONE', entityType: 'assets', entityId: input.assetId,
      details: { description: `Undid the disposal of ${String(asset.name || input.assetId)}; its entry is void`, transactionId: asset.disposalTransactionId },
    }, { db, tx: t });
    return { assetId: input.assetId };
  });
}
