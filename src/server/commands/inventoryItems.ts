import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { CommandContext, CommandDefinition } from './types';

/**
 * An inventory item's own card: what it is called, what it costs and how it is sold.
 *
 * `Inventory.tsx` wrote five of these by hand — the edit form, the add form, the quick add, the inline cell and the
 * delete — with `addDoc`, `updateDoc` and `deleteDoc`, `metadata.documentDefaults` written as a dotted path through
 * `deleteField()`, and `updatedAt` typed by the tab. The stock commands next door (`inventory.adjust`,
 * `inventory.count`, `inventory.transfer`, …) own every *quantity*; this command owns the card, and the two do not
 * overlap: a card cannot move stock, and a stock movement cannot rewrite a price.
 *
 * That separation is the point of the split:
 *
 * - `quantityAtHand` is **not** in the allowlist. Stock arrives through a receipt, a count, an adjustment or an
 *   opening balance, each of which posts the value with it — a card write would change the count without the entry.
 * - `unitCostCents` is settable only while the item has no stock (#839): with stock on hand a different cost is
 *   refused (`CONFLICT`) and goes through `inventory.revalue`, which posts the difference.
 * - the accounting links (`cogsAccountId`, `inventoryAccountId`, `incomeAccountId`) are left to the settings that own
 *   them, so a card edit cannot silently move where a sale's cost is posted.
 *
 * `inventoryitem.delete` removes the card; a card with stock on hand is refused (`CONFLICT`) rather than deleted with
 * value still attached to it, and the screen's confirmation is what decides to deplete first.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = (max: number) => z.string().trim().max(max);
const nonNegative = z.number().int().min(0).max(1_000_000);

/**
 * #839: a location's reorder band (`min` / `max`), the shape the item model and the screen use
 * (`Record<locationId, {min, max}>`). It was an array of `{locationId, quantityAtHand}`: that refused every card the
 * screen saved (it always sends the map) and let a card write a bin's stock with no entry behind it.
 */
const locationLevel = z.object({
  min: nonNegative,
  max: nonNegative,
}).strict().refine(level => level.max >= level.min, 'max cannot be below min');

const bundlePart = z.object({
  itemId: z.string().trim().min(1).max(200),
  quantity: z.number().min(0).max(100_000),
}).strict();

/**
 * The card's editable fields. `id` present means "change this one", absent means "add it".
 *
 * Every field is optional so a change can name only what the person changed: the screen's edit path deliberately
 * leaves the cost out while the item has stock (the cost is what the stock is valued at, and it is corrected by a
 * revaluation, not by a card write), and a schema that demanded it would refuse exactly the edit the screen offers.
 * What a *new* card must carry is checked in the handler, where "new" is known.
 */
const cardFields = {
  id: idSchema.optional(),
  name: text(200).min(1).optional(),
  sku: text(120).optional(),
  description: text(2000).optional(),
  unitPriceCents: cents.optional(),
  unitCostCents: cents.optional(),
  standardCostCents: cents.optional(),
  reorderPoint: nonNegative.optional(),
  measurementUnit: text(40).optional(),
  unitsPerPackage: z.number().int().min(1).max(100000).optional(),
  category: text(120).optional(),
  itemType: z.enum(['stock', 'service']).optional(),
  defaultTaxCodeId: text(120).nullable().optional(),
  productTaxCategory: text(60).optional(),
  consignment: text(60).optional(),
  bundleParts: z.array(bundlePart).max(200).optional(),
  assembleOnDemand: z.boolean().optional(),
  locationLevels: z.record(z.string().trim().min(1).max(120), locationLevel)
    .refine(levels => Object.keys(levels).length <= 200, 'At most 200 locations').optional(),
  /** the defaults a sale of this item starts with; `null` takes them away, absent leaves them as they were */
  documentDefaults: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: z.array(text(40)).max(40).optional(),
  status: z.enum(['active', 'inactive']).optional(),
};

export const inventoryItemSaveInput = z.object(cardFields).strict();

/** The inline cell: one field at a time, and only the ones a person may correct on the list. */
export const inventoryItemFieldInput = z.object({
  id: idSchema,
  field: z.enum(['name', 'sku', 'category', 'unitPriceCents', 'unitCostCents', 'standardCostCents']),
  value: z.union([text(200), cents]),
}).strict();

export const inventoryItemDeleteInput = z.object({ id: idSchema }).strict();

const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;
type SaveInput = z.output<typeof inventoryItemSaveInput>;
type FieldInput = z.output<typeof inventoryItemFieldInput>;
type DeleteInput = z.output<typeof inventoryItemDeleteInput>;
type ItemRow = Record<string, unknown> & { id?: string; metadata?: Record<string, unknown>; quantityAtHand?: number };
export type ItemSaved = { id: string; created: boolean; fields: string[] };

const INLINE_FIELD_RULES: Record<FieldInput['field'], (value: string | number) => boolean> = {
  name: value => typeof value === 'string' && value.trim().length > 0,
  sku: value => typeof value === 'string',
  category: value => typeof value === 'string',
  unitPriceCents: value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
  unitCostCents: value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
  standardCostCents: value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
};

/**
 * #839: an item with stock is valued at its unit cost, so changing that cost on the card would move the stock's value
 * with no entry behind it. While there is stock the cost changes through a revaluation; the same value is fine.
 */
function stockedCostRefusal(existing: ItemRow | undefined, nextCost: unknown): HttpError | null {
  if (nextCost === undefined || Number(existing?.quantityAtHand || 0) === 0) return null;
  if (Number(nextCost) === Number(existing?.unitCostCents ?? NaN)) return null;
  return Object.assign(new HttpError(
    'This item has stock, so its cost changes through a revaluation (inventory.revalue), which posts the difference.', 409,
  ), { code: 'CONFLICT' });
}

function cardPatch(input: SaveInput, existing?: ItemRow): Record<string, unknown> {
  const { id: _id, documentDefaults, ...rest } = input;
  const patch: Record<string, unknown> = { ...rest };
  if (documentDefaults !== undefined) {
    const { documentDefaults: _previous, ...metadata } = existing?.metadata || {};
    // merged here rather than with a dotted key: the whole metadata object is written, so a key this command does
    // not know about is kept instead of being dropped by the patch
    patch.metadata = documentDefaults === null ? metadata : { ...metadata, documentDefaults };
  }
  return patch;
}

export const inventoryItemSaveCommand: CommandDefinition<typeof inventoryItemSaveInput, ItemSaved> = {
  name: 'inventoryitem.save',
  input: inventoryItemSaveInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: SaveInput) {
    const now = new Date().toISOString();
    if (!input.id) {
      // a new card is what the form sends: its name and its two prices. Everything else has a default the list shows.
      const missing = (['name', 'unitPriceCents', 'unitCostCents', 'reorderPoint'] as const)
        .filter(key => input[key] === undefined);
      if (missing.length > 0) {
        throw Object.assign(new HttpError(`A new item needs ${missing.join(', ')}.`, 400), { code: 'INVALID_INPUT' });
      }
      const ref = ctx.db.collection('inventory').doc();
      const id = (ref as unknown as { id: string }).id;
      const patch = cardPatch(input);
      tx.set(ref, {
        ...patch,
        id,
        workspaceId: ctx.workspaceId,
        uid: ctx.actor,
        // stock is never created by a card: it arrives with a receipt, count, adjustment or opening balance
        quantityAtHand: 0,
        createdAt: now,
        updatedAt: now,
      });
      return { id, created: true, fields: Object.keys(patch) };
    }
    const ref = ctx.db.collection('inventory').doc(input.id);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as ItemRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This item is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    const costRefusal = stockedCostRefusal(existing, input.unitCostCents);
    if (costRefusal) throw costRefusal;
    const patch = cardPatch(input, existing);
    tx.update(ref, { ...patch, updatedAt: now });
    return { id: input.id, created: false, fields: Object.keys(patch) };
  },
  async preview(ctx: CommandContext, input: SaveInput) {
    if (input.id) {
      const snapshot = await ctx.db.collection('inventory').doc(input.id).get();
      const existing = snapshot.data() as ItemRow | undefined;
      if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
        throw new HttpError('This item is not in the selected workspace.', 404);
      }
      return { title: `Save ${String(existing?.name || input.id)}`, lines: ['The card changes; stock and its value do not'] };
    }
    return { title: `Add ${input.name}`, lines: [input.sku ? `SKU ${input.sku}` : 'No SKU', 'Starts with no stock'] };
  },
  audit(_input: SaveInput, result: ItemSaved) {
    return {
      action: result.created ? 'INVENTORY_ITEM_ADDED' : 'INVENTORY_ITEM_UPDATED',
      entityType: 'inventory',
      entityId: result.id,
      description: `${result.created ? 'Added' : 'Changed'} the item card ${result.id}`,
      details: { fields: result.fields },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Add an item card or change its name, price, cost, category, tax code, bundle parts, bin levels or sale defaults; do not use it to move stock, which needs a receipt, count or adjustment.',
    example: { name: 'Office chair', sku: 'CH-01', unitPriceCents: 24900, unitCostCents: 12000, reorderPoint: 5, category: 'Furniture' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A price is not whole cents, the unit is not a whole number, or the payload names a field the card does not keep (`quantityAtHand` is one: stock moves through its own commands).', next: 'Send amounts in cents, and move stock with inventory.adjust, inventory.count or a receipt.' },
      { code: 'NOT_FOUND', when: 'The item being changed is not in the selected workspace.', next: 'Reload the list and choose an item in this workspace.' },
      { code: 'CONFLICT', when: 'The item has stock and the payload changes its unit cost.', next: 'Change the cost with inventory.revalue, which posts the difference.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to change the card.' },
    ],
    next: [
      { command: 'inventory.adjust', label: 'Record a stock movement' },
      { command: 'inventoryitem.delete', label: 'Remove the card' },
    ],
  },
};

export const inventoryItemFieldCommand: CommandDefinition<typeof inventoryItemFieldInput, ItemSaved> = {
  name: 'inventoryitem.field',
  input: inventoryItemFieldInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: FieldInput) {
    if (!INLINE_FIELD_RULES[input.field](input.value)) {
      throw Object.assign(new HttpError(`"${input.field}" does not take that value.`, 400), { code: 'INVALID_INPUT' });
    }
    const ref = ctx.db.collection('inventory').doc(input.id);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as ItemRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This item is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    const costRefusal = input.field === 'unitCostCents' ? stockedCostRefusal(existing, input.value) : null;
    if (costRefusal) throw costRefusal;
    tx.update(ref, { [input.field]: input.value, updatedAt: new Date().toISOString() });
    return { id: input.id, created: false, fields: [input.field] };
  },
  async preview(ctx: CommandContext, input: FieldInput) {
    const snapshot = await ctx.db.collection('inventory').doc(input.id).get();
    const existing = snapshot.data() as ItemRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This item is not in the selected workspace.', 404);
    }
    return { title: `Change ${input.field}`, lines: [`${String(existing?.[input.field] ?? '—')} → ${String(input.value)}`] };
  },
  audit(_input: FieldInput, result: ItemSaved) {
    return {
      action: 'INVENTORY_ITEM_FIELD',
      entityType: 'inventory',
      entityId: result.id,
      description: `Changed ${result.fields[0]} on item ${result.id}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Correct one field of an item card from the list — its name, SKU, category, price or cost; do not use it to add or remove an item.',
    example: { id: 'item_1', field: 'unitPriceCents', value: 25900 },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The field is not one a list cell corrects, or the value does not fit it.', next: 'Send one of name, sku, category, unitPriceCents, unitCostCents, standardCostCents.' },
      { code: 'NOT_FOUND', when: 'The item is not in the selected workspace.', next: 'Reload the list and choose an item in this workspace.' },
      { code: 'CONFLICT', when: 'The cell is the unit cost and the item has stock.', next: 'Change the cost with inventory.revalue, which posts the difference.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to correct it.' },
    ],
    next: [{ command: 'inventoryitem.save', label: 'Edit the whole card' }],
  },
};

export const inventoryItemDeleteCommand: CommandDefinition<typeof inventoryItemDeleteInput, { id: string; name?: string }> = {
  name: 'inventoryitem.delete',
  input: inventoryItemDeleteInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: DeleteInput) {
    const ref = ctx.db.collection('inventory').doc(input.id);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as ItemRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This item is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    const onHand = Number(existing?.quantityAtHand || 0);
    if (Number.isFinite(onHand) && onHand > 0) {
      throw Object.assign(new HttpError(
        `"${String(existing?.name || input.id)}" still has ${onHand} on hand, which the books count as value. Record the stock out first (a count or an adjustment), then remove the card.`,
        409,
      ), { code: 'CONFLICT' });
    }
    tx.delete(ref);
    return { id: input.id, name: typeof existing?.name === 'string' ? existing.name : undefined };
  },
  async preview(ctx: CommandContext, input: DeleteInput) {
    const snapshot = await ctx.db.collection('inventory').doc(input.id).get();
    const existing = snapshot.data() as ItemRow | undefined;
    if (!snapshot.exists || existing?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This item is not in the selected workspace.', 404);
    }
    return {
      title: `Remove ${String(existing?.name || input.id)}`,
      lines: ['The card is removed; nothing has stock on it, so no value moves'],
    };
  },
  audit(_input: DeleteInput, result: { id: string; name?: string }) {
    return {
      action: 'INVENTORY_ITEM_REMOVED',
      entityType: 'inventory',
      entityId: result.id,
      description: `Removed the item card ${result.name || result.id}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Remove an item card that has no stock on hand; do not use it to take stock out of the books, which a count or adjustment does.',
    example: { id: 'item_1' },
    refusals: [
      { code: 'CONFLICT', when: 'The item still has stock on hand, which the books count as value.', next: 'Record the stock out with a count or an adjustment, then remove the card.' },
      { code: 'NOT_FOUND', when: 'The item is not in the selected workspace.', next: 'Reload the list and choose an item in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to remove it.' },
    ],
    next: [{ command: 'inventory.count', label: 'Count the stock first' }],
  },
};

/**
 * Rename an item category across the items that carry it — or clear it by renaming it to nothing.
 *
 * `CategoryManagerDialog` did this with a `writeBatch` built from the items the open page had loaded: an item in the
 * category that the list had not scrolled to kept the old name, so a "renamed" category came back on the next load,
 * and the `updatedAt` on each row was the browser's clock.
 *
 * The command reads the workspace's item cards inside the transaction, renames the ones whose category is the one
 * named (compared the way the screen compares them: trimmed, case-insensitive), and rewrites the same field on each.
 * An empty `to` clears the category rather than storing `""`, which is what the screen's "removed" message says.
 */
export const inventoryCategoryRenameInput = z.object({
  from: text(120).min(1),
  /** absent or empty removes the category from those items */
  to: text(120).optional(),
}).strict();

type RenameInput = z.output<typeof inventoryCategoryRenameInput>;
export type CategoryRenamed = { renamed: number; from: string; to: string };

export const inventoryCategoryRenameCommand: CommandDefinition<typeof inventoryCategoryRenameInput, CategoryRenamed> = {
  name: 'inventory.categoryrename',
  input: inventoryCategoryRenameInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: RenameInput) {
    const source = input.from.trim().toLowerCase();
    const target = (input.to || '').trim();
    if (source === target.toLowerCase() && target !== '') {
      throw Object.assign(new HttpError('The category already has that name.', 409), { code: 'CONFLICT' });
    }
    const rows = await tx.get(ctx.db.collection('inventory').where('workspaceId', '==', ctx.workspaceId));
    const now = new Date().toISOString();
    let renamed = 0;
    for (const row of rows.docs) {
      const category = String((row.data() as { category?: unknown }).category || '').trim().toLowerCase();
      if (category !== source) continue;
      // the reference is rebuilt from the id rather than taken off the snapshot: a query snapshot's own ref is not
      // part of the interface every database layer offers
      tx.update(ctx.db.collection('inventory').doc(row.id), { category: target, updatedAt: now });
      renamed += 1;
    }
    return { renamed, from: input.from.trim(), to: target };
  },
  async preview(ctx: CommandContext, input: RenameInput) {
    const rows = await ctx.db.collection('inventory').where('workspaceId', '==', ctx.workspaceId).get();
    const source = input.from.trim().toLowerCase();
    const count = rows.docs.filter(row => String((row.data() as { category?: unknown }).category || '').trim().toLowerCase() === source).length;
    return {
      title: input.to ? `Rename the category “${input.from}” to “${input.to}”` : `Remove the category “${input.from}”`,
      lines: [`${count} item(s)`, 'No stock and no price changes'],
    };
  },
  audit(_input: RenameInput, result: CategoryRenamed) {
    return {
      action: 'INVENTORY_CATEGORY_RENAMED',
      entityType: 'inventory',
      entityId: result.from,
      description: result.to
        ? `Renamed the item category “${result.from}” to “${result.to}” on ${result.renamed} item(s)`
        : `Removed the item category “${result.from}” from ${result.renamed} item(s)`,
      details: { renamed: result.renamed, to: result.to },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Rename one item category across every item that carries it, or remove it; do not use it to change an item’s price, cost or stock.',
    example: { from: 'Furniture', to: 'Office furniture' },
    refusals: [
      { code: 'CONFLICT', when: 'The new name is the same as the old one.', next: 'Give the category a different name, or leave the field empty to remove it.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to rename the category.' },
    ],
    next: [{ command: 'inventoryitem.field', label: 'Correct one item’s category' }],
  },
};
