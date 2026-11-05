import type { Firestore } from '../db/firestore';
import { ledgerCreate } from './ledgerDoor';
import { FieldValue } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { lockMessage, postingLock, workspaceRole } from '../../lib/periodLock';
import { describeTransfer, transferLines } from '../../lib/assetTransfer';
import { formatTzDate } from '../../lib/calendarDate';
import type { AssetTransfer, ChartAccount, FixedAsset } from '../../types';
import { defaultDepreciationAccounts } from './depreciationService';
import { writeServerAuditLog } from './auditLogService';

/**
 * Moving a fixed asset (X-05) to another location and/or other accounts (src/lib/assetTransfer.ts):
 * a move between accounts posts one balanced entry on the day (cost and the depreciation posted so
 * far), in the same database transaction as the change to the asset; the move is kept on the asset
 * with what it was before, so the latest can be undone while its date is open. Owners, accountants
 * and bookkeepers; the period lock applies to a posted move.
 */
export class TransferError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const WRITERS = ['owner', 'accountant', 'bookkeeper'];
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

interface Actor { workspaceId: string; uid: string; email?: string; assetId: string }
export interface TransferInput extends Actor {
  date: string;
  location?: string;
  assetAccountId?: string;
  accumulatedAccountId?: string;
}

export async function transferAsset(db: Firestore, input: TransferInput) {
  if (!DAY.test(input.date)) throw new TransferError(400, 'Choose the day it moved');
  return db.runTransaction(async t => {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new TransferError(404, 'Workspace not found');
    if (!WRITERS.includes(workspaceRole(workspace, input.uid))) throw new TransferError(403, 'Viewers cannot move assets');
    const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    if (input.date > today) throw new TransferError(400, 'The day it moved cannot be in the future');
    const assetRef = db.collection('assets').doc(input.assetId);
    const data = (await t.get(assetRef)).data();
    if (!data || data.workspaceId !== input.workspaceId) throw new TransferError(404, 'That asset is not in this workspace');
    const asset = { ...data, id: input.assetId } as FixedAsset & { location?: string };
    if (asset.status === 'disposed') throw new TransferError(409, `${asset.name} was disposed of`);
    if (asset.purchaseDate && input.date < asset.purchaseDate.slice(0, 10)) throw new TransferError(400, `${asset.name} was bought on ${asset.purchaseDate.slice(0, 10)}`);

    const accounts = (await t.get(db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId))).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
    const byId = new Map(accounts.map(a => [a.id, a]));
    const assetSide = (id: string | undefined, what: string) => {
      if (!id) return undefined;
      const a = byId.get(id);
      if (!a || a.isArchived || String(a.type).toLowerCase() !== 'asset') throw new TransferError(400, `Choose ${what} from the asset accounts`);
      return { id: a.id, name: a.name };
    };
    const ref = (id?: string) => { const a = id ? byId.get(id) : undefined; return a ? { id: a.id, name: a.name } : undefined; };
    const fromAsset = ref(asset.assetAccountId);
    const fromAccumulated = ref(asset.accumulatedAccountId) || (() => { const d = defaultDepreciationAccounts(accounts).accumulated; return d ? { id: d.id, name: d.name } : undefined; })();
    const toAsset = assetSide(input.assetAccountId, 'the account it moves to') || fromAsset;
    const toAccumulated = assetSide(input.accumulatedAccountId, 'the accumulated depreciation account') || fromAccumulated;
    if (toAsset && toAccumulated && toAsset.id === toAccumulated.id) throw new TransferError(400, 'The asset and its accumulated depreciation need different accounts');
    const toLocation = input.location === undefined ? asset.location : input.location.trim().slice(0, 120);
    const change = { fromLocation: asset.location, toLocation, fromAsset, toAsset, fromAccumulated, toAccumulated };
    const description = describeTransfer(asset.name, change);
    if (!description) throw new TransferError(400, 'Nothing changes: choose a new location or account');

    const lines = transferLines(asset.purchasePriceCents || 0, asset.accumulatedDepreciationCents || 0, { asset: fromAsset, accumulated: fromAccumulated }, { asset: toAsset, accumulated: toAccumulated });
    let transactionId: string | undefined;
    if (lines.length) {
      try {
        const ledgerTx = await TransactionValidator.validateAndPrepare({
          id: db.collection('transactions').doc().id,
          workspaceId: input.workspaceId, uid: input.uid, date: input.date, description,
          totalAmountCents: asset.purchasePriceCents || 0, currency: String(workspace.currency || 'USD'), exchangeRate: 1, status: 'completed', type: 'journal',
          metadata: { type: 'asset-transfer', assetId: asset.id },
          lines: lines.map(l => ({ ...l, description })),
        }, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t);
        transactionId = ledgerTx.id;
        ledgerCreate(t, db.collection('transactions').doc(ledgerTx.id), { ...ledgerTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/Period Locked/i.test(message)) throw new TransferError(409, message);
        throw err;
      }
    }
    const record: AssetTransfer = {
      date: input.date, description, ...(transactionId ? { transactionId } : {}),
      before: { location: asset.location ?? null, assetAccountId: asset.assetAccountId ?? null, accumulatedAccountId: asset.accumulatedAccountId ?? null },
    };
    t.update(assetRef, {
      location: toLocation ?? null,
      ...(toAsset ? { assetAccountId: toAsset.id } : {}),
      ...(toAccumulated && (input.accumulatedAccountId || asset.accumulatedAccountId) ? { accumulatedAccountId: toAccumulated.id } : {}),
      transfers: [...(asset.transfers || []), record],
      updatedAt: new Date().toISOString(),
    });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'ASSET_TRANSFERRED', entityType: 'assets', entityId: asset.id,
      details: { description: `${description} on ${input.date}`, ...(transactionId ? { transactionId } : {}) },
    }, { db, tx: t });
    return { transactionId: transactionId || null, description };
  });
}

/** Undo the latest move: its entry is voided and the asset is where it was, while the date is open. */
export async function undoTransfer(db: Firestore, input: Actor) {
  return db.runTransaction(async t => {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new TransferError(404, 'Workspace not found');
    if (!WRITERS.includes(workspaceRole(workspace, input.uid))) throw new TransferError(403, 'Viewers cannot move assets');
    const assetRef = db.collection('assets').doc(input.assetId);
    const asset = (await t.get(assetRef)).data() as (FixedAsset & { location?: string }) | undefined;
    if (!asset || asset.workspaceId !== input.workspaceId) throw new TransferError(404, 'That asset is not in this workspace');
    if (asset.status === 'disposed') throw new TransferError(409, 'Undo the disposal first');
    const moves = asset.transfers || [];
    const last = moves[moves.length - 1];
    if (!last) throw new TransferError(409, 'This asset was not moved here');
    if (last.transactionId) {
      const lock = postingLock(last.date, workspace as never, input.uid);
      if (lock) throw new TransferError(409, lockMessage(last.date, lock));
    }
    const entryRef = last.transactionId ? db.collection('transactions').doc(last.transactionId) : null;
    const entry = entryRef ? (await t.get(entryRef)).data() : undefined;
    const now = new Date().toISOString();
    if (entryRef && entry && entry.status !== 'void') t.update(entryRef, { status: 'void', voidedReason: 'Move undone', voidedAt: now, updatedAt: now });
    t.update(assetRef, {
      location: last.before.location, assetAccountId: last.before.assetAccountId, accumulatedAccountId: last.before.accumulatedAccountId,
      transfers: moves.slice(0, -1), updatedAt: now,
    });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'ASSET_TRANSFER_UNDONE', entityType: 'assets', entityId: input.assetId,
      details: { description: `Undid: ${last.description}`, ...(last.transactionId ? { transactionId: last.transactionId } : {}) },
    }, { db, tx: t });
    return { assetId: input.assetId };
  });
}
