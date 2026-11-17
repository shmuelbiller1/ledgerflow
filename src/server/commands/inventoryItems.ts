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
 * - `unitCostCents` is settable, but the screen only offers it while the item has no stock; the command cannot know
 *   what the screen showed, so it says in the description what the rule is rather than pretending to enforce a
 *   condition it cannot see.
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

const locationLevel = z.object({
  locationId: z.string().trim().min(1).max(120),
  quantityAtHand: z.number().min(0).max(1_000_000).optional(),
}).strict();

const bundlePart = z.object({
  itemId: z.string().trim().min(1).max(200),
  quantity: z.number().min(0).max(100_000),
}).strict();

/** The card's editable fields. `id` present means "change this one", absent means "add it". */
const cardFields = {
  id: idSchema.optional(),
  name: text(200).min(1),
  sku: text(120),
  description: text(2000),
  unitPriceCents: cents,
  unitCostCents: cents,
  standardCostCents: cents.optional(),
  reorderPoint: nonNegative,
  measurementUnit: text(40).optional(),
  unitsPerPackage: z.number().int().min(1).max(100000).optional(),
  category: text(120),
  itemType: z.enum(['stock', 'service']).optional(),
  defaultTaxCodeId: text(120).nullable().optional(),
  productTaxCategory: text(60).optional(),
  consignment: text(60).optional(),
  bundleParts: z.array(bundlePart).max(200).optional(),
  assembleOnDemand: z.boolean().optional(),
  locationLevels: z.array(locationLevel).max(200).optional(),
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
