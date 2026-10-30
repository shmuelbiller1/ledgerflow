import type { Firestore } from '../db/firestore';
import { ledgerCreate } from './ledgerDoor';
import { FieldValue } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { lockMessage, postingLock, workspaceRole } from '../../lib/periodLock';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { formatTzDate } from '../../lib/calendarDate';
import type { ChartAccount, FixedAsset } from '../../types';
import { writeServerAuditLog } from './auditLogService';

/**
 * Construction in progress (X-09). While an asset is being built its costs sit in a
 * construction-in-progress account and nothing depreciates. Placing it in service posts one entry on
 * that day (DR the asset account it belongs in, CR the construction-in-progress account, with the
 * cost so far), makes it an ordinary asset from that day (depreciation starts the month after, over
 * the life and with the salvage value given then) and keeps where it came from. Undo, while the date
 * is open and before any depreciation was posted, voids the entry and makes it in progress again.
 */
export class InServiceError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const WRITERS = ['owner', 'accountant', 'bookkeeper'];
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

interface Actor { workspaceId: string; uid: string; email?: string; assetId: string }
export interface PlaceInServiceInput extends Actor {
  date: string;
  assetAccountId: string;
  usefulLifeYears?: number;
  salvageValueCents?: number;
}

export async function placeInService(db: Firestore, input: PlaceInServiceInput) {
  if (!DAY.test(input.date)) throw new InServiceError(400, 'Choose the day it was ready to use');
  return db.runTransaction(async t => {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new InServiceError(404, 'Workspace not found');
    if (!WRITERS.includes(workspaceRole(workspace, input.uid))) throw new InServiceError(403, 'Viewers cannot change assets');
    const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    if (input.date > today) throw new InServiceError(400, 'The day it was ready cannot be in the future');
    const assetRef = db.collection('assets').doc(input.assetId);
    const data = (await t.get(assetRef)).data();
    if (!data || data.workspaceId !== input.workspaceId) throw new InServiceError(404, 'That asset is not in this workspace');
    const asset = { ...data, id: input.assetId } as FixedAsset;
    if (asset.status !== 'in_progress') throw new InServiceError(409, `${asset.name} is not being built`);
    if (asset.purchaseDate && input.date < asset.purchaseDate.slice(0, 10)) throw new InServiceError(400, `Building ${asset.name} started on ${asset.purchaseDate.slice(0, 10)}`);
    const cost = asset.purchasePriceCents || 0;
    if (cost <= 0) throw new InServiceError(400, `Add what ${asset.name} cost first`);
    const salvage = input.salvageValueCents ?? asset.salvageValueCents ?? 0;
    const life = input.usefulLifeYears ?? asset.usefulLifeYears;
    if (!Number.isSafeInteger(salvage) || salvage < 0 || salvage > cost) throw new InServiceError(400, 'The value at the end must be between 0 and the cost');
    if (!(life > 0 && life <= 100)) throw new InServiceError(400, 'Useful life must be between 0 and 100 years');

    const accounts = (await t.get(db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId))).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
    const byId = new Map(accounts.map(a => [a.id, a]));
    const cip = asset.assetAccountId ? byId.get(asset.assetAccountId) : undefined;
    if (!cip) throw new InServiceError(400, `Record which construction-in-progress account ${asset.name} is in first`);
    const target = byId.get(input.assetAccountId);
    if (!target || target.isArchived || String(target.type).toLowerCase() !== 'asset') throw new InServiceError(400, 'Choose the asset account it belongs in from the asset accounts');
    if (target.id === cip.id) throw new InServiceError(400, 'Choose an account other than the construction-in-progress account');

    const currency = String(workspace.currency || 'USD');
    const description = `${asset.name} placed in service (${formatCurrency(cost, currency)} from ${cip.name} to ${target.name})`;
    let ledgerTx;
    try {
      ledgerTx = await TransactionValidator.validateAndPrepare({
        id: db.collection('transactions').doc().id,
        workspaceId: input.workspaceId, uid: input.uid, date: input.date, description,
        totalAmountCents: cost, currency, exchangeRate: 1, status: 'completed', type: 'journal',
        metadata: { type: 'asset-in-service', assetId: asset.id },
        lines: [
          { accountId: target.id, accountName: target.name, amountCents: cost, description },
          { accountId: cip.id, accountName: cip.name, amountCents: -cost, description },
        ],
      }, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Period Locked/i.test(message)) throw new InServiceError(409, message);
      throw err;
    }
    ledgerCreate(t, db.collection('transactions').doc(ledgerTx.id), { ...ledgerTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    t.update(assetRef, {
      status: 'active', purchaseDate: input.date, assetAccountId: target.id, usefulLifeYears: life, salvageValueCents: salvage,
      accumulatedDepreciationCents: 0, depreciatedThrough: null,
      placedInService: { date: input.date, transactionId: ledgerTx.id, cipAccountId: cip.id, startedOn: asset.purchaseDate || input.date },
      updatedAt: new Date().toISOString(),
    });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'ASSET_PLACED_IN_SERVICE', entityType: 'assets', entityId: asset.id,
      details: { description: `${description} on ${input.date}`, transactionId: ledgerTx.id },
    }, { db, tx: t });
    return { transactionId: ledgerTx.id, description };
  });
}

export async function undoPlaceInService(db: Firestore, input: Actor) {
  return db.runTransaction(async t => {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new InServiceError(404, 'Workspace not found');
    if (!WRITERS.includes(workspaceRole(workspace, input.uid))) throw new InServiceError(403, 'Viewers cannot change assets');
    const assetRef = db.collection('assets').doc(input.assetId);
    const asset = (await t.get(assetRef)).data() as FixedAsset | undefined;
    if (!asset || asset.workspaceId !== input.workspaceId) throw new InServiceError(404, 'That asset is not in this workspace');
    const placed = asset.placedInService;
    if (!placed || asset.status !== 'active') throw new InServiceError(409, 'This asset was not placed in service here');
    if ((asset.accumulatedDepreciationCents || 0) > 0 || asset.depreciatedThrough || (asset.partialDisposals || []).length || (asset.transfers || []).some(m => m.date >= placed.date)) {
      throw new InServiceError(409, `${asset.name} has been depreciated, sold in part or moved since; undo those first`);
    }
    const lock = postingLock(placed.date, workspace as never, input.uid);
    if (lock) throw new InServiceError(409, lockMessage(placed.date, lock));
    const entryRef = db.collection('transactions').doc(placed.transactionId);
    const entry = (await t.get(entryRef)).data();
    const now = new Date().toISOString();
    if (entry && entry.status !== 'void') t.update(entryRef, { status: 'void', voidedReason: 'Placing in service undone', voidedAt: now, updatedAt: now });
    t.update(assetRef, { status: 'in_progress', purchaseDate: placed.startedOn, assetAccountId: placed.cipAccountId, placedInService: FieldValue.delete(), updatedAt: now });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'ASSET_IN_SERVICE_UNDONE', entityType: 'assets', entityId: input.assetId,
      details: { description: `${String(asset.name)} is being built again; the entry placing it in service is void`, transactionId: placed.transactionId },
    }, { db, tx: t });
    return { assetId: input.assetId };
  });
}
