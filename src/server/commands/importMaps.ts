import { z } from 'zod';
import type { CommandDefinition } from './types';

const MAX_IMPORT_MAPS = 50;
const mapSignature = z.string().regex(/^csv_\d{1,3}_[0-9a-f]{8}$/);
const mapColumns = z.object({
  date: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(200).optional(),
  amount: z.string().min(1).max(200).optional(),
  debit: z.string().min(1).max(200).optional(),
  credit: z.string().min(1).max(200).optional(),
  payee: z.string().min(1).max(200).optional(),
  memo: z.string().min(1).max(200).optional(),
}).strict();
const savedMap = z.object({
  columns: mapColumns,
  skipRows: z.number().int().min(0).max(20),
  savedAt: z.string().optional(),
}).strict();
const mapsSchema = z.record(mapSignature, savedMap)
  .refine(maps => Object.keys(maps).length <= MAX_IMPORT_MAPS, `A snapshot can contain at most ${MAX_IMPORT_MAPS} layouts`);

export const importMapSaveInput = z.object({
  signature: mapSignature,
  columns: mapColumns,
  skipRows: z.number().int().min(0).max(20),
}).strict();
export const importMapRestoreInput = z.object({ maps: mapsSchema }).strict();

type ImportMapSaveInput = z.output<typeof importMapSaveInput>;
type ImportMapRestoreInput = z.output<typeof importMapRestoreInput>;
type SavedMap = z.output<typeof savedMap>;
type SavedMaps = Record<string, SavedMap>;
type ImportMapSaveResult = { workspaceId: string; signature: string; previousMaps: SavedMaps; maps: SavedMaps };
type ImportMapRestoreResult = { workspaceId: string; previousMaps: SavedMaps; maps: SavedMaps };

const roles = ['owner', 'accountant', 'bookkeeper'] as const;

function savedMaps(value: unknown): SavedMaps {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as SavedMaps) }
    : {};
}

function sortAndLimit(maps: SavedMaps): SavedMaps {
  return Object.fromEntries(Object.entries(maps)
    .sort((a, b) => String(b[1].savedAt || '').localeCompare(String(a[1].savedAt || '')))
    .slice(0, MAX_IMPORT_MAPS));
}

function layoutLines(columns: ImportMapSaveInput['columns'], skipRows: number): string[] {
  return [
    `Skip ${skipRows} header row${skipRows === 1 ? '' : 's'}`,
    ...Object.entries(columns)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([field, header]) => `${field}: ${header}`),
  ];
}

/**
 * Saved CSV column layouts are workspace preferences, not ledger entries. Keep the old endpoint's
 * validation, recency order, 50-layout cap, transaction, and audit action while making the write
 * available through the shared command runner and safe to retry.
 */
export const importMapSaveCommand: CommandDefinition<typeof importMapSaveInput, ImportMapSaveResult> = {
  name: 'workspace.importmap',
  input: importMapSaveInput,
  roles,
  async handler(ctx, tx, input: ImportMapSaveInput) {
    const workspaceRef = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    const workspace = await tx.get(workspaceRef);
    if (!workspace.exists) throw Object.assign(new Error('Workspace not found'), { status: 404, code: 'WORKSPACE_NOT_FOUND' });
    const previousMaps = savedMaps(workspace.data()?.importColumnMaps);
    const now = new Date().toISOString();
    const maps = sortAndLimit({
      ...previousMaps,
      [input.signature]: { columns: input.columns, skipRows: input.skipRows, savedAt: now },
    });
    tx.update(workspaceRef, { importColumnMaps: maps, updatedAt: now });
    return { workspaceId: ctx.workspaceId, signature: input.signature, previousMaps, maps };
  },
  async preview(_ctx, input) {
    return { title: 'Save bank import column layout', lines: layoutLines(input.columns, input.skipRows) };
  },
  audit(_input, result) {
    return {
      action: 'IMPORT_MAP_SAVED',
      entityType: 'workspace',
      entityId: result.workspaceId,
      description: `Saved CSV import column layout (${result.signature})`,
      details: { signature: result.signature },
    };
  },
  inverse(_input, result) {
    return { command: 'workspace.restoremaps', input: { maps: result.previousMaps } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Remember how a bank CSV header maps to statement fields for the next import; do not use this to import or change ledger entries.',
    example: {
      signature: 'csv_5_1234abcd',
      columns: { date: 'Posted Date', description: 'Description', debit: 'Debit', credit: 'Credit' },
      skipRows: 1,
    },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The header signature, mapped columns, or skipped-row count is invalid.', next: 'Send a csv_<header-count>_<8 lowercase hex digits> signature, only known column names, and skipRows from 0 to 20.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace bookkeeper or above to save the mapping.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace and retry.' },
    ],
  },
};

/** Restores the saved-layout snapshot captured by importMapSaveCommand's inverse. */
export const importMapRestoreCommand: CommandDefinition<typeof importMapRestoreInput, ImportMapRestoreResult> = {
  name: 'workspace.restoremaps',
  input: importMapRestoreInput,
  roles,
  async handler(ctx, tx, input: ImportMapRestoreInput) {
    const workspaceRef = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    const workspace = await tx.get(workspaceRef);
    if (!workspace.exists) throw Object.assign(new Error('Workspace not found'), { status: 404, code: 'WORKSPACE_NOT_FOUND' });
    const previousMaps = savedMaps(workspace.data()?.importColumnMaps);
    const maps = input.maps as SavedMaps;
    tx.update(workspaceRef, { importColumnMaps: maps, updatedAt: new Date().toISOString() });
    return { workspaceId: ctx.workspaceId, previousMaps, maps };
  },
  async preview(_ctx, input) {
    return { title: 'Restore bank import column layouts', lines: [`Restore ${Object.keys(input.maps).length} saved layout${Object.keys(input.maps).length === 1 ? '' : 's'}`] };
  },
  audit(_input, result) {
    return {
      action: 'IMPORT_MAPS_RESTORED',
      entityType: 'workspace',
      entityId: result.workspaceId,
      description: `Restored ${Object.keys(result.maps).length} saved CSV import column layout${Object.keys(result.maps).length === 1 ? '' : 's'}`,
      details: { count: Object.keys(result.maps).length },
    };
  },
  inverse(_input, result) {
    return { command: 'workspace.restoremaps', input: { maps: result.previousMaps } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Restore a saved snapshot of bank CSV column layouts when undoing a layout change; do not use this to import or change ledger entries.',
    example: { maps: {} },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A saved layout or its header signature is malformed, or the snapshot exceeds 50 layouts.', next: 'Restore a snapshot with valid CSV signatures and at most 50 layouts.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace bookkeeper or above to restore the layout snapshot.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace and retry.' },
    ],
  },
};
