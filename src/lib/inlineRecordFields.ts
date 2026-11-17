import { editableValueProblem } from './editableRecords';

/** C-15 edits only non-posting record fields, plus planning budget values. */
export const INLINE_RECORD_FIELDS = {
  projects: ['name', 'metadata.client', 'budgetCents', 'status'],
  employees: ['name', 'email', 'role'],
  assets: ['name', 'assetTag', 'location', 'category', 'warrantyExpires', 'insuranceRenews', 'nextServiceDue'],
  budgets: ['name', 'amountCents'],
  estimates: ['number', 'date', 'expiryDate', 'notes'],
  dimensionNodes: ['description'],
} as const;
export type InlineRecordCollection = keyof typeof INLINE_RECORD_FIELDS;
export interface InlineRecordTarget { collection: InlineRecordCollection; id: string }
export interface InlineRecordSession { sampleSession?: object; uid: string; workspaceId: string; writable: boolean }
export interface InlineRecordAdapter {
  session(): InlineRecordSession | null;
  read(target: InlineRecordTarget): Promise<Record<string, unknown> | undefined>;
  /**
   * `expected` is what the screen read for the fields it is writing, and `workspaceId` the workspace it read them in:
   * both travel with the write so the compare and the write are one transaction on the server.
   */
  update(
    target: InlineRecordTarget,
    fields: Record<string, string | number | string[]>,
    expected: Record<string, string | number | string[]>,
    workspaceId: string,
  ): Promise<void>;
}
export function inlineFieldValue(record: Record<string, unknown>, field: string): unknown {
  let value: unknown = record;
  for (const part of field.split('.')) { if (!value || typeof value !== 'object') return undefined; value = (value as Record<string, unknown>)[part]; }
  return value;
}
function validate(target: InlineRecordTarget, field: string, value: string | number) {
  if (!(INLINE_RECORD_FIELDS[target.collection] as readonly string[]).includes(field)) throw new Error('This field must use its own editor.');
  // the same rules the command applies to the same field, so a person typing here and an API caller see one answer
  const problem = editableValueProblem(target.collection, field, value);
  if (problem) throw new Error(problem);
}
/** Refuses an observed conflict; does not pretend this browser read/write is atomic. */
export async function saveInlineRecordField(adapter: InlineRecordAdapter, target: InlineRecordTarget, field: string, before: unknown, value: string | number): Promise<Record<string, string | number | string[]>> {
  validate(target, field, value);
  const session = adapter.session();
  if (!session?.writable) throw new Error('Your workspace role cannot edit this record.');
  const record = await adapter.read(target);
  const current = adapter.session();
  if (!current?.writable || current.uid !== session.uid || current.workspaceId !== session.workspaceId || current.sampleSession !== session.sampleSession) throw new Error('Workspace or permissions changed. Reopen this record.');
  if (!record || record.workspaceId !== session.workspaceId) throw new Error('This record is unavailable in the current workspace.');
  if (target.collection === 'estimates' && record.status !== 'draft') throw new Error('Only draft estimates can be edited here.');
  const actual = inlineFieldValue(record, field);
  const matches = field === 'amountCents' || field === 'budgetCents' ? Number(actual ?? 0) === Number(before ?? 0) : String(actual ?? '') === String(before ?? '');
  if (!matches) throw new Error('Someone changed this field. Reload its current value before saving.');
  const fields: Record<string, string | number | string[]> = { [field]: value };
  if (target.collection === 'dimensionNodes' && field === 'description') {
    const aliases = Array.isArray(record.aliases) ? record.aliases.filter((alias): alias is string => typeof alias === 'string') : [];
    const old = String(actual ?? '').trim();
    fields.aliases = old && !aliases.some(alias => alias.toLocaleLowerCase() === old.toLocaleLowerCase()) ? [...aliases, old] : aliases;
  }
  // what the screen read for each field it is writing, so the server can refuse a change it did not see
  const expected: Record<string, string | number | string[]> = {};
  for (const key of Object.keys(fields)) {
    const value = inlineFieldValue(record, key);
    expected[key] = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : (value as string | number | undefined) ?? '';
  }
  await adapter.update(target, fields, expected, session.workspaceId);
  return fields;
}
