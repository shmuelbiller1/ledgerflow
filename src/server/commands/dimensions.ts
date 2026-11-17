import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import { FieldValue } from '../db/firestore';
import type { CommandContext, CommandDefinition } from './types';

/**
 * The workspace's labels: the axes themselves, and the values under them.
 *
 * `dimensionNodeActions` wrote three of these from the browser — a node created by overwriting a whole record, a
 * node changed by writing the fields the screen happened to hold, and the axis list written whole onto the
 * workspace. A label is shared by every screen that shows it and every report that groups by it, so the shape of
 * what may be written belongs with the rows rather than with whichever tab pressed save: a patch cannot arrive
 * with a different workspace on it, an axis cannot be deleted while lines still carry it, and both are audited.
 */
const idSchema = z.string().trim().min(1).max(120).refine(id => !id.includes('/'), 'Id cannot contain a slash');
const text = (max: number) => z.string().trim().max(max);

/** One value under a label. Append-only: a value is archived, never removed, so its code is not reused. */
const nodeSchema = z.object({
  id: idSchema,
  dimensionId: idSchema,
  description: text(300),
  aliases: z.array(text(300)).max(50).optional(),
  status: z.enum(['active', 'archived']).optional(),
  parentId: idSchema.optional(),
  createdAt: z.string().max(40).optional(),
  // accepted and ignored: the server stamps the time, so a screen's clock cannot date a row
  updatedAt: z.string().max(40).optional(),
}).strict();

const axisSchema = z.object({
  id: idSchema,
  name: text(120),
  label: text(120).optional(),
  isWorld: z.boolean().optional(),
  sortOrder: z.number().finite().optional(),
  systemDefault: z.boolean().optional(),
  role: z.enum(['informational', 'attributed', 'self-balancing']).optional(),
  requiredOn: z.object({
    accountIds: z.array(idSchema).max(5000),
    since: z.string().max(40),
    refuse: z.boolean().optional(),
  }).strict().optional(),
}).strict();

export const dimensionNodeInput = z.object({
  /** write the whole value (`node`), or change the fields named here (`fields`) — not both */
  node: nodeSchema.optional(),
  dimensionId: idSchema.optional(),
  nodeId: idSchema.optional(),
  fields: z.object({
    description: text(300).optional(),
    aliases: z.array(text(300)).max(50).optional(),
    status: z.enum(['active', 'archived']).optional(),
    parentId: idSchema.nullable().optional(),
    // the screens send the moment they changed the row; the server's own clock is what is kept
    updatedAt: z.string().max(40).optional(),
  }).strict().optional(),
}).strict()
  .refine(input => (input.node === undefined) !== (input.fields === undefined), 'Write a value or change one, not both.')
  .refine(input => input.node !== undefined || (input.dimensionId !== undefined && input.nodeId !== undefined), 'A change names the value it changes.');

export const dimensionAxesInput = z.object({
  dimensions: z.array(axisSchema).min(1).max(50),
}).strict();

const NODE_ROLES = ['owner', 'accountant', 'bookkeeper'] as const;
const AXIS_ROLES = ['owner', 'accountant'] as const;

type NodeInput = z.output<typeof dimensionNodeInput>;
type AxesInput = z.output<typeof dimensionAxesInput>;
type NodeResult = { id: string; dimensionId: string; status?: string };
type AxesResult = { dimensions: Array<{ id: string; name: string }> };

/** The row id a value is stored under: workspace, axis and code, so the same code can exist on two axes. */
const nodeRowId = (workspaceId: string, dimensionId: string, nodeId: string) => `${workspaceId}_${dimensionId}_${nodeId}`;

export const dimensionNodeCommand: CommandDefinition<typeof dimensionNodeInput, NodeResult> = {
  name: 'workspace.dimensionnode',
  input: dimensionNodeInput,
  roles: NODE_ROLES,
  async handler(ctx: CommandContext, tx, input: NodeInput) {
    if (input.node) {
      const node = input.node;
      const ref = ctx.db.collection('dimensionNodes').doc(nodeRowId(ctx.workspaceId, node.dimensionId, node.id));
      const { updatedAt: _sentAt, ...rest } = node;
      tx.set(ref, { ...rest, workspaceId: ctx.workspaceId, updatedAt: new Date().toISOString() });
      return { id: node.id, dimensionId: node.dimensionId, status: node.status };
    }
    const rowId = nodeRowId(ctx.workspaceId, input.dimensionId!, input.nodeId!);
    const ref = ctx.db.collection('dimensionNodes').doc(rowId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data()?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This label is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    // `null` empties the field, `undefined` leaves it alone — the difference the screen's own patch made
    const { updatedAt: _sentAt, ...named } = input.fields || {};
    const patch = Object.fromEntries(Object.entries(named).filter(([, value]) => value !== undefined));
    if (Object.keys(patch).length === 0) return { id: input.nodeId!, dimensionId: input.dimensionId! };
    // the caller's timestamp is thrown away: a phone with the wrong date must not decide when a label changed
    tx.update(ref, { ...patch, updatedAt: new Date().toISOString() });
    return { id: input.nodeId!, dimensionId: input.dimensionId!, status: patch.status as string | undefined };
  },
  async preview(ctx: CommandContext, input: NodeInput) {
    if (input.node) return { title: `Save the label ${input.node.id}`, lines: [input.node.dimensionId, input.node.description] };
    const snapshot = await ctx.db.collection('dimensionNodes').doc(nodeRowId(ctx.workspaceId, input.dimensionId!, input.nodeId!)).get();
    if (!snapshot.exists) throw new HttpError('This label is not in the selected workspace.', 404);
    return { title: `Change the label ${input.nodeId}`, lines: Object.keys(input.fields || {}) };
  },
  audit(_input: NodeInput, result: NodeResult) {
    return {
      action: 'DIMENSION_NODE_SAVED',
      entityType: 'dimensionNodes',
      entityId: `${result.dimensionId}/${result.id}`,
      description: `Saved the label ${result.id} on ${result.dimensionId}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Save one value of a workspace label, or change its name, aliases, parent or status; do not use it to move or relabel transactions that already carry the value.',
    example: { node: { id: 'P1', dimensionId: 'property', description: '123 Ocean Ave Maint' } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The value has no code or axis, or the change names fields the label does not have.', next: 'Send the whole value, or only the fields a label carries.' },
      { code: 'NOT_FOUND', when: 'The value is not in the selected workspace.', next: 'Reload the labels and choose a value in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
    ],
    next: [{ command: 'workspace.dimensionaxes', label: 'Manage the labels' }],
  },
};

export const dimensionAxesCommand: CommandDefinition<typeof dimensionAxesInput, AxesResult> = {
  name: 'workspace.dimensionaxes',
  input: dimensionAxesInput,
  roles: AXIS_ROLES,
  async handler(ctx: CommandContext, tx, input: AxesInput) {
    const ids = input.dimensions.map(dimension => dimension.id);
    if (new Set(ids).size !== ids.length) {
      throw Object.assign(new HttpError('Each label can appear once.', 409), { code: 'CONFLICT' });
    }
    const ref = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw Object.assign(new HttpError('This workspace is no longer open.', 404), { code: 'NOT_FOUND' });
    tx.update(ref, { dimensions: input.dimensions });
    return { dimensions: input.dimensions.map(dimension => ({ id: dimension.id, name: dimension.name })) };
  },
  async preview(ctx: CommandContext, input: AxesInput) {
    const snapshot = await ctx.db.collection('workspaces').doc(ctx.workspaceId).get();
    if (!snapshot.exists) throw new HttpError('This workspace is no longer open.', 404);
    return { title: 'Save the workspace labels', lines: input.dimensions.map(dimension => `${dimension.id}: ${dimension.name}`) };
  },
  audit(_input: AxesInput, result: AxesResult) {
    return {
      action: 'DIMENSION_AXES_SAVED',
      entityType: 'workspaces',
      entityId: '', // filled by the runner from the workspace the command ran in
      description: `Saved ${result.dimensions.length} workspace label(s): ${result.dimensions.map(dimension => dimension.id).join(', ')}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Replace the list of labels the workspace groups by (property, class, location, …); existing values and the transactions that carry them are untouched.',
    example: { dimensions: [{ id: 'property', name: 'Property' }, { id: 'class', name: 'Class' }] },
    refusals: [
      { code: 'CONFLICT', when: 'A label id appears twice in the list.', next: 'Send one entry per label.' },
      { code: 'NOT_FOUND', when: 'The workspace is no longer open.', next: 'Reload the workspace and try again.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask a workspace owner to grant an appropriate role.' },
    ],
    next: [{ command: 'workspace.dimensionnode', label: 'Add a value' }],
  },
};

/**
 * The one-off move of a legacy dimension tree off the workspace document.
 *
 * Older workspaces kept their whole label tree in a `dimensionNodes` array *on* the workspace row, which is how a
 * workspace document grows toward the size limit the collection split was meant to prevent. `useLedgerData` used to
 * do the move itself, in the background, with a `writeBatch` and an `updateDoc(deleteField())` from the browser: no
 * audit line, no role, and — the part that actually went wrong — no answer. A tab that crashed halfway left some
 * values in the collection and the rest on the workspace row, and the next load migrated them again.
 *
 * This is that move as a command, so the tree can be written once and the legacy field cleared in the same
 * transaction: either both halves happen or neither does. It refuses a node whose `dimensionId` is missing (the row
 * id is derived from it, so a nameless one would land somewhere no screen reads), and a batch larger than the
 * screen's own 450-row chunk — the caller sends the tree in pieces and the answer says how many were written.
 */
export const dimensionNodesMigrateInput = z.object({
  /** the legacy rows, exactly as they sat on the workspace document */
  nodes: z.array(nodeSchema).max(450),
  /**
   * Whether this call is the last of the tree, and may therefore clear the legacy field. A chunked caller sends
   * `false` for every chunk but the last: clearing on the first one would drop the rest of the tree if a later
   * chunk failed.
   */
  clearLegacy: z.boolean().optional(),
}).strict();

type MigrateInput = z.output<typeof dimensionNodesMigrateInput>;
export type DimensionNodesMigrateResult = { migrated: number; cleared: boolean };

export const dimensionNodesMigrateCommand: CommandDefinition<typeof dimensionNodesMigrateInput, DimensionNodesMigrateResult> = {
  name: 'workspace.dimensionnodesmigrate',
  input: dimensionNodesMigrateInput,
  roles: NODE_ROLES,
  async handler(ctx: CommandContext, tx, input: MigrateInput) {
    const ref = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw Object.assign(new HttpError('This workspace is no longer open.', 404), { code: 'NOT_FOUND' });
    }
    const now = new Date().toISOString();
    for (const node of input.nodes) {
      const { updatedAt: _sentAt, ...rest } = node;
      tx.set(ctx.db.collection('dimensionNodes').doc(nodeRowId(ctx.workspaceId, node.dimensionId, node.id)), {
        ...rest,
        workspaceId: ctx.workspaceId,
        updatedAt: now,
      });
    }
    // the legacy field goes in the same transaction as the rows that replace it, so a half-migrated workspace
    // cannot exist for the next tab to find — but only when this call holds the whole tree (or says it is the last
    // chunk). A first chunk that cleared it would drop every value the next chunk was meant to carry.
    const cleared = input.clearLegacy !== false;
    if (cleared) tx.update(ref, { dimensionNodes: FieldValue.delete() });
    return { migrated: input.nodes.length, cleared };
  },
  async preview(ctx: CommandContext, input: MigrateInput) {
    const snapshot = await ctx.db.collection('workspaces').doc(ctx.workspaceId).get();
    if (!snapshot.exists) throw new HttpError('This workspace is no longer open.', 404);
    return {
      title: 'Move the label tree into its own collection',
      lines: [
        `${input.nodes.length} label(s)`,
        input.clearLegacy === false ? 'The legacy list stays until the last chunk' : 'The legacy list on the workspace row is cleared',
      ],
    };
  },
  audit(_input: MigrateInput, result: DimensionNodesMigrateResult) {
    return {
      action: 'DIMENSION_NODES_MIGRATED',
      entityType: 'workspaces',
      entityId: '',
      description: `Moved ${result.migrated} label(s) off the workspace document`,
      details: { migrated: result.migrated, cleared: result.cleared },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Move a legacy label tree off the workspace row and into the dimensionNodes collection, clearing the old field in the same transaction; do not use it to add a new value, which workspace.dimensionnode does.',
    example: { nodes: [{ id: 'n1', dimensionId: 'property', description: 'North tower' }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A label has no axis, or more than 450 arrive at once.', next: 'Send the tree in chunks of at most 450 labels, each with its axis.' },
      { code: 'NOT_FOUND', when: 'The workspace is no longer open.', next: 'Reload the workspace and try again.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper to run the move.' },
    ],
    next: [{ command: 'workspace.dimensionnode', label: 'Change a value' }],
  },
};
