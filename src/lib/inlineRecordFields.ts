import { code128Problem } from './code128';
import { isEmailShape } from './textShape';

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
export interface InlineRecordSession { uid: string; workspaceId: string; writable: boolean }
export interface InlineRecordAdapter {
  session(): InlineRecordSession | null;
  read(target: InlineRecordTarget): Promise<Record<string, unknown> | undefined>;
  update(target: InlineRecordTarget, fields: Record<string, string | number | string[]>): Promise<void>;
}
export function inlineFieldValue(record: Record<string, unknown>, field: string): unknown {
  let value: unknown = record;
  for (const part of field.split('.')) { if (!value || typeof value !== 'object') return undefined; value = (value as Record<string, unknown>)[part]; }
  return value;
}
function validate(target: InlineRecordTarget, field: string, value: string | number) {
  if (!(INLINE_RECORD_FIELDS[target.collection] as readonly string[]).includes(field)) throw new Error('This field must use its own editor.');
  if (field === 'amountCents' || field === 'budgetCents') { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Enter a non-negative planning amount.'); }
  else {
    if (typeof value !== 'string' || value.length > 10000) throw new Error('Enter valid text.');
    if ((field === 'name' || target.collection === 'dimensionNodes' && field === 'description') && !value.trim()) throw new Error('Name is required.');
    if (field === 'status' && !['active', 'completed', 'archived'].includes(value)) throw new Error('Choose a project status.');
    if (field === 'assetTag' && value) {
      if (value !== value.trim()) throw new Error('The asset tag must not start or end with spaces.');
      const problem = code128Problem(value);
      if (problem) throw new Error(problem);
    }
    if (field === 'email' && value && !isEmailShape(value)) throw new Error('Enter an email address.');
    if (['date', 'expiryDate', 'warrantyExpires', 'insuranceRenews', 'nextServiceDue'].includes(field)) { const date = new Date(`${value}T00:00:00Z`); if (field === 'date' && !value || value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)) throw new Error('Enter a valid date.'); }
  }
}
/** Refuses an observed conflict; does not pretend this browser read/write is atomic. */
export async function saveInlineRecordField(adapter: InlineRecordAdapter, target: InlineRecordTarget, field: string, before: unknown, value: string | number): Promise<Record<string, string | number | string[]>> {
  validate(target, field, value);
  const session = adapter.session();
  if (!session?.writable) throw new Error('Your workspace role cannot edit this record.');
  const record = await adapter.read(target);
  const current = adapter.session();
  if (!current?.writable || current.uid !== session.uid || current.workspaceId !== session.workspaceId) throw new Error('Workspace or permissions changed. Reopen this record.');
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
  await adapter.update(target, fields);
  return fields;
}
