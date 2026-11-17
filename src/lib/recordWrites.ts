/**
 * The records a screen writes, in the two worlds a tab can be in.
 *
 * A signed-in screen changes a record by naming a command: the server owns the allowlist, the role, the audit line
 * and the refusals, and the screen learns what happened. The sample company has no workspace on the server, so its
 * screens write their own in-memory copy through `localStore` and nothing leaves the tab.
 *
 * Before these helpers every one of those calls was `updateDoc(doc(db, table, id), …)`, which quietly did both: it
 * went to Postgres when signed in and to the sample database in a demo. Moving a screen to a command without the
 * branch would have made the demo ask a server that does not have its workspace — the failure a browser test caught on
 * the budget screen (a dialog that never closes because the save came back 401).
 *
 * So each helper below is the whole rule, in one place: `guestSession()` → the sample company's copy; otherwise → the
 * command, which is where the rules live. What lives here is only *which command* and *which row*; a helper that
 * invented a field would still be refused by the server.
 */
import { runNamedCommand } from './commandByName';
import { localAdd, localDelete, localSet, localUpdate } from './db/localStore';
import { guestSession } from './db/guestDatabase';

/** The sample company's own copy of a row: a patch when it exists, a full write when it does not. */
async function localRow(table: string, id: string, fields: Record<string, unknown>, create = false): Promise<void> {
  if (create) {
    await localSet(table, id, fields);
    return;
  }
  await localUpdate(table, id, fields);
}

/** A roster entry's fields (rate, pay type, deductions, holiday hours, direct deposit, title, status). */
export async function saveEmployee(workspaceId: string, id: string, fields: Record<string, unknown>): Promise<void> {
  if (guestSession()) return localRow('employees', id, fields);
  await runNamedCommand('employee.update', { id, ...fields }, { workspaceId });
}

/** Keys the server owns on every row a screen builds: the session's person and workspace, and the timestamps. */
const SERVER_OWNED_ROW_KEYS = ['uid', 'workspaceId', 'createdAt', 'updatedAt'];

/** The row a screen built, without the halves the server writes from the session. */
function withoutServerKeys(row: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...row };
  for (const key of SERVER_OWNED_ROW_KEYS) delete fields[key];
  if (fields.id === undefined) delete fields.id;
  return fields;
}

/** A new roster entry, with the id the screen already minted for it. */
export async function addEmployee(workspaceId: string, row: Record<string, unknown> & { id: string }): Promise<void> {
  if (guestSession()) return localRow('employees', row.id, row, true);
  // the form still builds the whole row; `employee.create` writes the owner, the workspace and the timestamps
  // itself, so they are dropped here rather than sent and refused
  await runNamedCommand('employee.create', withoutServerKeys(row), { workspaceId });
}

/** Keys the server owns on an item card, so a screen that kept building the whole row does not send them back. */
const SERVER_OWNED_ITEM_KEYS = ['uid', 'workspaceId', 'createdAt', 'updatedAt', 'quantityAtHand', 'metadata'];

/** An item card: its name, price, cost, category, tax code, bundle parts, bin levels, sale defaults. */
export async function saveInventoryItem(workspaceId: string, row: Record<string, unknown>): Promise<{ id?: string }> {
  if (guestSession()) {
    const { id, ...fields } = row;
    if (typeof id === 'string' && id) {
      await localRow('inventory', id, { ...fields, updatedAt: new Date().toISOString() });
      return { id };
    }
    const created = await localAdd('inventory', { ...fields, createdAt: new Date().toISOString() });
    return { id: created };
  }
  const input: Record<string, unknown> = { ...row };
  const metadata = input.metadata as Record<string, unknown> | undefined;
  for (const key of SERVER_OWNED_ITEM_KEYS) delete input[key];
  // the card's sale defaults live in `metadata.documentDefaults`; the command takes them as one field
  if (metadata && 'documentDefaults' in metadata) input.documentDefaults = metadata.documentDefaults ?? null;
  return runNamedCommand<{ id: string }>('inventoryitem.save', input, { workspaceId });
}

/** One field of an item card, corrected on the list. */
export async function saveInventoryItemField(workspaceId: string, id: string, field: string, value: string | number): Promise<void> {
  if (guestSession()) return localRow('inventory', id, { [field]: value, updatedAt: new Date().toISOString() });
  await runNamedCommand('inventoryitem.field', { id, field, value }, { workspaceId });
}

/** An item card with no stock on it. */
export async function removeInventoryItem(workspaceId: string, id: string): Promise<void> {
  if (guestSession()) return localDelete('inventory', id);
  await runNamedCommand('inventoryitem.delete', { id }, { workspaceId });
}

/** A quote: its terms, lines and milestone schedule. */
export async function saveEstimate(workspaceId: string, row: Record<string, unknown>): Promise<void> {
  if (guestSession()) {
    const { id, ...fields } = row;
    if (typeof id === 'string' && id) return localRow('estimates', id, { ...fields, updatedAt: new Date().toISOString() });
    await localAdd('estimates', { ...fields, createdAt: new Date().toISOString() });
    return;
  }
  await runNamedCommand('estimate.save', withoutServerKeys(row), { workspaceId });
}

/** A quote's stage: accepted as an order, declined, or converted by an invoice. */
export async function setEstimateStatus(workspaceId: string, id: string, status: string, extra: Record<string, unknown> = {}): Promise<void> {
  if (guestSession()) {
    const now = new Date().toISOString();
    await localRow('estimates', id, {
      status,
      updatedAt: now,
      ...(status === 'accepted' ? { orderedAt: now, ...extra } : {}),
      ...(status === 'converted' ? extra : {}),
    });
    return;
  }
  await runNamedCommand('estimate.status', { id, status, ...extra }, { workspaceId });
}

/** One account's own fields: its name, code, description, category, group, archived state, workpapers. */
export async function saveChartAccount(workspaceId: string, fields: Record<string, unknown> & { id: string }): Promise<void> {
  if (guestSession()) {
    const { id, archived, ...rest } = fields;
    await localRow('chartAccounts', id, {
      ...rest,
      ...(archived === undefined ? {} : { isArchived: archived, isActive: !archived }),
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await runNamedCommand('chartaccount.update', fields, { workspaceId });
}

/**
 * A new account in the chart, or a new item, returned with the id the server gave it.
 *
 * An account starts at zero by the command's own rule (`chartaccount.create`), so the form sends the row's
 * *description* — code, name, type, category, group — and nothing about money.
 */
export async function addChartAccount(workspaceId: string, fields: Record<string, unknown>): Promise<{ id: string }> {
  if (guestSession()) {
    const created = await localAdd('chartAccounts', {
      ...fields,
      workspaceId,
      openingBalanceCents: 0,
      balanceCents: 0,
      createdAt: new Date().toISOString(),
    });
    return { id: created };
  }
  return runNamedCommand<{ id: string }>('chartaccount.create', fields, { workspaceId });
}

/** The server-owned half of a document row: a tab that built the whole record does not send these back. */
const SERVER_OWNED_DOCUMENT_KEYS = ['uid', 'workspaceId', 'createdAt', 'updatedAt', 'id'];

/**
 * A file kept with the books: a new row when `id` is absent, a link or a change when it is present.
 *
 * `document.save` writes `uid`, `workspaceId` and `createdAt` from the session — the one collection where a tab
 * could otherwise file something into a workspace it could not write, and date it from its own clock.
 */
export async function saveDocument(workspaceId: string, row: Record<string, unknown>): Promise<{ id: string }> {
  const fields = { ...row };
  for (const key of SERVER_OWNED_DOCUMENT_KEYS) delete fields[key];
  if (guestSession()) {
    const id = typeof row.id === 'string' && row.id ? row.id : await localAdd('documents', { ...fields, workspaceId, createdAt: new Date().toISOString() });
    if (typeof row.id === 'string' && row.id) await localUpdate('documents', row.id, { ...fields, updatedAt: new Date().toISOString() });
    return { id };
  }
  return runNamedCommand<{ id: string }>('document.save', fields, { workspaceId });
}

/** Many label values at once (the settings screen's save and its backfill), up to the command's own 450. */
export async function saveDimensionNodes<T extends { id: string; dimensionId: string }>(workspaceId: string, nodes: T[]): Promise<void> {
  if (nodes.length === 0) return;
  if (guestSession()) {
    for (const node of nodes) {
      await localSet('dimensionNodes', `${workspaceId}_${node.dimensionId}_${node.id}`, { ...node, workspaceId });
    }
    return;
  }
  // the screen's nodes came out of the collection, so they carry `workspaceId` and whatever else was stored: the
  // command's allowlist is what a value *is*, and the rest is the row's own bookkeeping
  const value = (node: Record<string, unknown>) => {
    const { id, dimensionId, description, aliases, status, parentId, createdAt } = node;
    return { id, dimensionId, description, aliases, status, parentId, createdAt };
  };
  for (let i = 0; i < nodes.length; i += 450) {
    await runNamedCommand('workspace.dimensionnodes', { nodes: nodes.slice(i, i + 450).map(node => value(node as unknown as Record<string, unknown>)) }, { workspaceId });
  }
}

/**
 * One payment against a loan: the instalment the entry just posted settles.
 *
 * The sample company keeps the list on its own copy of the loan, so the caller hands in what it already shows; the
 * command reads that list on the server instead, which is the half that makes a retry answer "already recorded".
 */
export async function recordLoanPayment(
  workspaceId: string,
  loan: { id: string; payments?: unknown[] },
  payment: { installment: number; date: string; transactionId?: string },
): Promise<void> {
  if (guestSession()) {
    await localUpdate('loans', loan.id, {
      payments: [...(Array.isArray(loan.payments) ? loan.payments : []), payment],
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await runNamedCommand('loan.payment', { loanId: loan.id, ...payment }, { workspaceId });
}

/** A capitalised cost on an asset: one cost, added to the list the caller shows (the sample company) or read. */
export async function addAssetCost(
  workspaceId: string,
  asset: { id: string; purchasePriceCents?: number; costAdditions?: unknown[] },
  cost: { date: string; amountCents: number; note?: string },
): Promise<{ purchasePriceCents: number }> {
  const purchasePriceCents = Number(asset.purchasePriceCents || 0) + cost.amountCents;
  if (guestSession()) {
    await localUpdate('assets', asset.id, {
      purchasePriceCents,
      costAdditions: [...(Array.isArray(asset.costAdditions) ? asset.costAdditions : []), { date: cost.date, amountCents: cost.amountCents, ...(cost.note ? { note: cost.note } : {}) }],
      updatedAt: new Date().toISOString(),
    });
    return { purchasePriceCents };
  }
  return runNamedCommand<{ purchasePriceCents: number }>('asset.costaddition', { assetId: asset.id, ...cost }, { workspaceId });
}
