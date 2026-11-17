/**
 * The rules a field's *value* has to pass, in one place.
 *
 * The allowlist (`editableRecords.ts`) says which fields a screen may write; this says what may be written into them.
 * Both used to live in the editors, so `record.fields` checked names and trusted values — and the API, which the SDK
 * publishes, was therefore the wider door: blank a required name, put `-5` or `"12"` in a planning amount, write `void`
 * as a project status, or change an estimate's number after it stopped being a draft. The editor calls this to answer
 * the person typing; the command calls it to refuse a request that skipped the editor. One function, two doors.
 */
import { code128Problem } from './code128';
import { isEmailShape } from './textShape';

/** The value at a field's path (`metadata.client` reads `record.metadata.client`); `undefined` when the chain breaks. */
export function recordValueAt(record: Record<string, unknown> | undefined, field: string): unknown {
  let current: unknown = record;
  for (const part of field.split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** The fields that must hold a value; every other text field may be cleared. */
const REQUIRED_TEXT = new Set(['name', 'description']);
/** The date fields a screen offers, and the one of them that a record cannot do without. */
const DATE_FIELDS = new Set(['date', 'expiryDate', 'warrantyExpires', 'insuranceRenews', 'nextServiceDue']);
const PLANNING_AMOUNTS = new Set(['amountCents', 'budgetCents']);
const PROJECT_STATUSES = ['active', 'completed', 'archived'];

/**
 * What is wrong with one field's *value*, in the words the screen already shows — or null.
 *
 * The rule lived in the two editors, so the command checked names and trusted the values. That made the API the wider
 * door: a caller could blank a name, put `-5` or `"12"` in a planning amount, write `void` as a project status, or an
 * estimate's number after it stopped being a draft. Both sides call this now: the editor to answer the person typing,
 * the command to refuse the request that skipped the editor.
 */
export function editableValueProblem(collection: string, field: string, value: unknown): string | null {
  if (PLANNING_AMOUNTS.has(field)) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? null : 'Enter a non-negative planning amount.';
  }
  if (field === 'aliases') {
    return Array.isArray(value) && value.every(alias => typeof alias === 'string' && alias.length <= 400) ? null : 'Enter valid text.';
  }
  if (typeof value !== 'string') return 'Enter valid text.';
  if (value.length > 10000) return 'Enter valid text.';
  if (REQUIRED_TEXT.has(field) && !value.trim()) return 'Name is required.';
  if (field === 'status' && collection === 'projects' && !PROJECT_STATUSES.includes(value)) return 'Choose a project status.';
  if (field === 'assetTag' && value) {
    if (value !== value.trim()) return 'The asset tag must not start or end with spaces.';
    const problem = code128Problem(value);
    if (problem) return problem;
  }
  if (field === 'email' && value && !isEmailShape(value)) return 'Enter an email address.';
  if (DATE_FIELDS.has(field)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    const bad = field === 'date' ? !value || (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
      : Boolean(value) && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value);
    if (bad) return 'Enter a valid date.';
  }
  return null;
}
