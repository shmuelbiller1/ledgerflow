import crypto from 'crypto';
import { ledgerCreate } from './ledgerDoor';
import { FieldValue } from '../db/firestore';
import type { DocumentData, Firestore, QueryDocumentSnapshot, Transaction } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { resolveAccountRole } from '../../lib/accountUtils';
import { IMPORT_DEFINITIONS, MAX_IMPORT_ROWS, identityKeys, openingStockCents, prepareImport } from '../../lib/recordImport';
import type { ImportIssue, ImportKind, ImportRow } from '../../lib/recordImport';
import type { ChartAccount } from '../../types';
import { writeServerAuditLog } from './auditLogService';
import { stockMovesReady, writeStockMoves } from './stockMoveService';

/**
 * Bulk import of customers, vendors, items or accounts (K-01), all rows in one database
 * transaction: every row is checked again here (src/lib/recordImport.ts); one bad row means
 * nothing is saved. Records that already exist (same name / SKU / code) are skipped and listed.
 * Items with a quantity and a cost also get one opening-stock ledger entry (DR Inventory,
 * CR Opening Balance Equity), so stock and the books agree. Every record carries the import's
 * batch id, so the import can be undone (records nothing uses yet are removed).
 */

export class ImportError extends Error {
  constructor(readonly status: number, message: string, readonly issues: ImportIssue[] = []) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ImportRecordsInput {
  workspaceId: string;
  uid: string;
  email?: string;
  kind: ImportKind;
  rows: ImportRow[];
  /** Date of the opening-stock entry (items with quantities), YYYY-MM-DD. */
  openingDate?: string;
  /** Check only: report what would be imported, save nothing. */
  dryRun?: boolean;
}

const OPENING_STOCK_TYPE = 'opening-stock-import';

const isOpeningEquity = (a: ChartAccount) => resolveAccountRole(a) === 'equity' && /opening balance/i.test(a.name || '');
const active = (a: ChartAccount) => !a.isArchived && !a.archived && a.isActive !== false;

async function postingPeriodError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Period Locked/i.test(message)) throw new ImportError(409, 'That date is in a locked period. Choose a date after the lock date.');
    throw err;
  }
}

/** What an import's write needs: the checked rows and the definition of the kind of record. */
export interface PreparedImport {
  definition: (typeof IMPORT_DEFINITIONS)[ImportKind];
  prepared: ReturnType<typeof prepareImport>;
}

/**
 * The checks and the reading an import needs, read-only, before its transaction: every row is
 * checked again here (src/lib/recordImport.ts) and one bad row means nothing is saved. The command
 * runner then holds the write, and its audit line, in its own transaction.
 */
export async function prepareImportRecords(db: Firestore, input: ImportRecordsInput): Promise<PreparedImport> {
  const definition = IMPORT_DEFINITIONS[input.kind];
  if (!definition) throw new ImportError(400, 'Unknown kind of record');
  if (!Array.isArray(input.rows) || input.rows.length === 0) throw new ImportError(400, 'The file has no rows to import');
  if (input.rows.length > MAX_IMPORT_ROWS) throw new ImportError(400, `At most ${MAX_IMPORT_ROWS} rows per import; split the file`);

  const prepared = prepareImport(input.kind, input.rows);
  if (prepared.errors.length > 0 && !input.dryRun) {
    throw new ImportError(400, `${new Set(prepared.errors.map(e => e.row)).size} row(s) have problems; nothing was imported`, prepared.errors);
  }
  const hasStock = input.kind === 'items' && openingStockCents(prepared.records) > 0;
  if (hasStock && !/^\d{4}-\d{2}-\d{2}$/.test(input.openingDate || '')) {
    throw new ImportError(400, 'Choose the date of the opening stock');
  }

  if (input.kind === 'items') await stockMovesReady(db);
  return { definition, prepared };
}

export async function importRecords(db: Firestore, input: ImportRecordsInput) {
  const prepared = await prepareImportRecords(db, input);
  return db.runTransaction(t => importRecordsInTransaction(db, t, input, prepared));
}

export async function importRecordsInTransaction(db: Firestore, t: Transaction, input: ImportRecordsInput, prepped: PreparedImport) {
  const { definition, prepared } = prepped;
  const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
  if (!workspace) throw new ImportError(404, 'Workspace not found');

  const existing = (await t.get(db.collection(definition.collection).where('workspaceId', '==', input.workspaceId))).docs;
  const taken = new Set(existing.flatMap(d => identityKeys(input.kind, d.data())));
  const skipped: ImportIssue[] = [];
  const toCreate = prepared.records.filter(r => {
    if (!r.keys.some(k => taken.has(k))) return true;
    skipped.push({ row: r.row, message: `${r.label} already exists` });
    return false;
  });

  const batchId = `imp_${crypto.randomBytes(8).toString('hex')}`;
  const itemRefs = toCreate.map(() => db.collection(definition.collection).doc());
  const stockValues = input.kind === 'items'
    ? toCreate.map((r, i) => ({ itemId: itemRefs[i].id, valueCents: (Number(r.data.quantityAtHand) || 0) * (Number(r.data.unitCostCents) || 0) }))
        .filter(v => v.valueCents > 0)
    : [];
  const stockCents = stockValues.reduce((sum, v) => sum + v.valueCents, 0);
  if (!Number.isSafeInteger(stockCents)) throw new ImportError(400, 'The opening stock value is too large');

  let openingTx: DocumentData | null = null;
  if (stockCents > 0) {
    const accounts = (await t.get(db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId))).docs
      .map(d => ({ ...d.data(), id: d.id }) as ChartAccount).filter(active);
    const inventory = accounts.find(a => resolveAccountRole(a) === 'inventory');
    const equity = accounts.find(isOpeningEquity);
    if (!inventory || !equity) {
      throw new ImportError(400, `To record the opening stock, add ${!inventory ? 'an Inventory account' : ''}${!inventory && !equity ? ' and ' : ''}${!equity ? 'an Opening Balance Equity account' : ''} to the chart of accounts, or import the items without quantities`);
    }
    const description = `Opening stock: ${stockValues.length} imported item${stockValues.length === 1 ? '' : 's'}`;
    if (!input.dryRun) {
      openingTx = await postingPeriodError(() => TransactionValidator.validateAndPrepare({
        id: db.collection('transactions').doc().id,
        workspaceId: input.workspaceId,
        uid: input.uid,
        date: input.openingDate,
        description,
        totalAmountCents: stockCents,
        currency: workspace.currency || 'USD',
        exchangeRate: 1,
        status: 'completed',
        type: 'actual',
        metadata: { type: OPENING_STOCK_TYPE, importBatchId: batchId, items: stockValues },
        lines: [
          { accountId: inventory.id, accountName: inventory.name, amountCents: stockCents, description },
          { accountId: equity.id, accountName: equity.name, amountCents: -stockCents, description },
        ],
      }, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t));
    }
  }

  const summary = { kind: input.kind, created: toCreate.length, skipped, errors: prepared.errors, openingStockCents: stockCents };
  if (input.dryRun) return { ...summary, dryRun: true as const, batchId: null, openingTransactionId: null };

  const now = new Date().toISOString();
  toCreate.forEach((record, i) => {
    const extra = input.kind === 'accounts' ? { balanceCents: 0, isArchived: false } : {};
    t.create(itemRefs[i], { ...record.data, ...extra, id: itemRefs[i].id, uid: input.uid, workspaceId: input.workspaceId, importBatchId: batchId, createdAt: now, updatedAt: now });
  });
  if (openingTx) {
    ledgerCreate(t, db.collection('transactions').doc(String(openingTx.id)), { ...openingTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  }
  // W-02: each imported item's opening quantity starts its stock history
  if (input.kind === 'items') {
    writeStockMoves(db, t, toCreate.flatMap((record, i) => {
      const quantity = Number(record.data.quantityAtHand) || 0;
      if (quantity === 0) return [];
      const unitCostCents = Number(record.data.unitCostCents) || 0;
      return [{
        workspaceId: input.workspaceId, itemId: itemRefs[i].id, itemName: String(record.data.name || ''), date: input.openingDate || now.slice(0, 10),
        kind: 'opening' as const, quantity, quantityBefore: 0, quantityAfter: quantity, unitCostCents, valueCents: Math.round(quantity * unitCostCents),
        transactionId: openingTx ? String(openingTx.id) : null, documentType: 'import' as const, documentId: batchId, uid: input.uid,
      }];
    }));
  }
  await writeServerAuditLog({
    workspaceId: input.workspaceId,
    uid: input.uid,
    email: input.email,
    action: 'records_imported',
    entityType: input.kind,
    entityId: batchId,
    details: {
      description: `Imported ${toCreate.length} ${definition.label.toLowerCase()} from a spreadsheet${skipped.length ? ` (${skipped.length} already existed)` : ''}`,
      batchId,
      kind: input.kind,
      created: toCreate.length,
      skipped: skipped.length,
    },
  }, { db, tx: t });
  return { ...summary, dryRun: false as const, batchId, openingTransactionId: openingTx ? String(openingTx.id) : null };
}

// ----- undo -----

/** Where each kind of record can be used; an imported record that is used is kept on undo. */
async function usedIds(db: Firestore, t: Transaction, workspaceId: string, kind: ImportKind, ids: string[], historyKept: boolean): Promise<Set<string>> {
  const used = new Set<string>();
  const inWorkspace = (collection: string) => db.collection(collection).where('workspaceId', '==', workspaceId);
  const byField = async (collection: string, field: string) => {
    for (let i = 0; i < ids.length; i += 200) {
      const snap = await t.get(inWorkspace(collection).where(field, 'in', ids.slice(i, i + 200)));
      snap.docs.forEach(d => used.add(String(d.get(field))));
    }
  };
  // Lines are arrays of objects: { accountId } / { itemId } matches a line that has that value.
  const byLine = async (collection: string, arrayField: string, key: string) => {
    for (let i = 0; i < ids.length; i += 200) {
      const snap = await t.get(inWorkspace(collection).where(arrayField, 'array-contains-any', ids.slice(i, i + 200).map(id => ({ [key]: id }))));
      const wanted = new Set(ids);
      snap.docs.forEach(d => {
        const lines = d.get(arrayField);
        if (Array.isArray(lines)) lines.forEach((l: Record<string, unknown>) => { if (wanted.has(String(l?.[key]))) used.add(String(l[key])); });
      });
    }
  };

  if (kind === 'customers') {
    for (const c of ['invoices', 'estimates', 'creditNotes']) await byField(c, 'customerId');
    await byField('payments', 'contactId');
    await byField('payments', 'customerId');
  } else if (kind === 'vendors') {
    for (const c of ['bills', 'vendorCredits']) await byField(c, 'vendorId');
    await byField('payments', 'contactId');
    await byField('payments', 'vendorId');
  } else if (kind === 'items') {
    // invoices keep their lines under `items` (checking only `lines` let an item already sold be removed)
    await byLine('invoices', 'items', 'itemId');
    await byLine('invoices', 'lines', 'itemId');
    await byLine('estimates', 'lines', 'itemId');
    await byField('transactions', 'metadata.inventoryItemId');
    // W-02: a stock move other than the import's own opening stock (a sale, an adjustment, a count) means in use
    for (let i = 0; historyKept && i < ids.length; i += 200) {
      const snap = await t.get(inWorkspace('stockMoves').where('itemId', 'in', ids.slice(i, i + 200)));
      snap.docs.forEach(d => { if (d.get('documentType') !== 'import') used.add(String(d.get('itemId'))); });
    }
  } else {
    await byLine('transactions', 'lines', 'accountId');
    await byLine('bills', 'splits', 'accountId');
    await byLine('invoices', 'lines', 'accountId');
    await byField('payments', 'depositAccountId');
  }
  return used;
}

export type UndoImportInput = { workspaceId: string; uid: string; email?: string; batchId: string; allowAccounts: boolean };

/** What an undo needs before its transaction (read-only): the batch id's shape and a ready stock store. */
export async function prepareUndoImport(db: Firestore, input: UndoImportInput): Promise<void> {
  if (!/^imp_[0-9a-f]{16}$/.test(input.batchId)) throw new ImportError(400, 'Unknown import');
  await stockMovesReady(db);
}

export async function undoImport(db: Firestore, input: UndoImportInput) {
  await prepareUndoImport(db, input);
  return db.runTransaction(t => undoImportInTransaction(db, t, input));
}

export async function undoImportInTransaction(db: Firestore, t: Transaction, input: UndoImportInput) {
  const historyKept = await stockMovesReady(db);
  {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new ImportError(404, 'Workspace not found');

    let kind: ImportKind | null = null;
    let docs: QueryDocumentSnapshot[] = [];
    for (const def of Object.values(IMPORT_DEFINITIONS)) {
      const snap = await t.get(db.collection(def.collection).where('workspaceId', '==', input.workspaceId).where('importBatchId', '==', input.batchId));
      if (!snap.empty) {
        kind = def.id;
        docs = snap.docs;
        break;
      }
    }
    if (!kind || docs.length === 0) throw new ImportError(404, 'Nothing is left from this import');
    if (kind === 'accounts' && !input.allowAccounts) throw new ImportError(403, 'Only owners and accountants can change the chart of accounts');

    const used = await usedIds(db, t, input.workspaceId, kind, docs.map(d => d.id), historyKept);
    const removable = docs.filter(d => !used.has(d.id) && d.get('isSystem') !== true);
    const kept = docs.filter(d => !removable.includes(d)).map(d => String(d.get('name') || d.id));

    // Items: take the removed items' opening stock back out of the books (a reversing entry).
    let reversal: DocumentData | null = null;
    if (kind === 'items' && removable.length > 0) {
      const opening = (await t.get(db.collection('transactions').where('workspaceId', '==', input.workspaceId).where('metadata.importBatchId', '==', input.batchId).limit(1))).docs[0];
      const values: Array<{ itemId: string; valueCents: number }> = opening?.get('metadata.items') || [];
      const removedIds = new Set(removable.map(d => d.id));
      const cents = values.filter(v => removedIds.has(v.itemId)).reduce((sum, v) => sum + (Number(v.valueCents) || 0), 0);
      if (opening && cents > 0) {
        const lines = (opening.get('lines') as Array<{ accountId: string; accountName?: string; amountCents: number }>) || [];
        const description = `Undo import: opening stock of ${removable.length} item${removable.length === 1 ? '' : 's'}`;
        reversal = await postingPeriodError(() => TransactionValidator.validateAndPrepare({
          id: db.collection('transactions').doc().id,
          workspaceId: input.workspaceId,
          uid: input.uid,
          date: opening.get('date'),
          description,
          totalAmountCents: cents,
          currency: opening.get('currency') || workspace.currency || 'USD',
          exchangeRate: 1,
          status: 'completed',
          type: 'actual',
          metadata: { type: `${OPENING_STOCK_TYPE}-undo`, reversesTxId: opening.id, importBatchId: input.batchId },
          lines: lines.map(l => ({ accountId: l.accountId, accountName: l.accountName, amountCents: l.amountCents > 0 ? -cents : cents, description })),
        }, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t));
      }
    }

    // W-02: the removed items' history (only their imported opening stock, or they would be in use)
    const removedHistory = kind === 'items' && historyKept && removable.length > 0
      ? (await Promise.all(Array.from({ length: Math.ceil(removable.length / 200) }, (_, n) => t.get(db.collection('stockMoves')
          .where('workspaceId', '==', input.workspaceId).where('itemId', 'in', removable.slice(n * 200, n * 200 + 200).map(d => d.id)))))).flatMap(s => s.docs)
      : [];

    removable.forEach(d => t.delete(d.ref));
    removedHistory.forEach(d => t.delete(d.ref));
    if (reversal) ledgerCreate(t, db.collection('transactions').doc(String(reversal.id)), { ...reversal, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    const label = IMPORT_DEFINITIONS[kind].label.toLowerCase();
    await writeServerAuditLog({
      workspaceId: input.workspaceId,
      uid: input.uid,
      email: input.email,
      action: 'records_import_undone',
      entityType: kind,
      entityId: input.batchId,
      details: {
        description: `Undid an import: removed ${removable.length} ${label}${kept.length ? `, kept ${kept.length} already in use` : ''}`,
        batchId: input.batchId,
        removed: removable.length,
        kept: kept.length,
      },
    }, { db, tx: t });
    return { kind, removed: removable.length, kept, reversalTransactionId: reversal ? String(reversal.id) : null };
  }
}
