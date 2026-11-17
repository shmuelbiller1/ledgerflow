/**
 * The fields of an ordinary record that a screen may edit in place, and the collections that may be edited at all.
 *
 * Two screens edit records a field at a time: the inline field (`RecordInlineField` → `inlineRecordFields`) and the
 * details drawer (`RecordDetailsDrawer` → `recordDetails`). Each already had its own allowlist, and each wrote the
 * change with `updateDoc(doc(db, kind, id), { ...fields, updatedAt: new Date().toISOString() })` — a browser write with
 * the tab's clock, no audit line, and the allowlist enforced only on the side of the request that the person can edit.
 *
 * `record.fields` reads **this** table on the server, so the two lists are one list: the screen cannot send a field the
 * table does not name, and the table cannot name a collection the command refuses. That is the fail-closed half of the
 * question the checklist left open — an allowlist, not a denylist, because a collection added to the app tomorrow is
 * *not* editable until someone says it is here (and the test that compares the two sides fails until they do).
 *
 * What this table deliberately does not name: anything with a ledger meaning — amounts on a document, posting dates,
 * balances, quantities, prices, statuses that a dedicated command owns. `budgetCents`, `amountCents` and `status` are
 * here because they are *planning* fields on a project and a budget, not postings.
 */
import { INLINE_RECORD_FIELDS } from './inlineRecordFields';
import { RECORD_DETAIL_FIELDS } from './recordDetails';

// re-exported so the server reads one module: the rules are the same rules, and the cycle (the editors import the
// rules, the table imports the editors) would break `EDITABLE_RECORD_FIELDS` at load time if they lived here
export { editableValueProblem, recordValueAt } from './editableValues';

type FieldLists = Readonly<Record<string, readonly string[]>>;

/** Both screens' lists, merged per collection: `projects` is named by both, and no field may be lost in the merge. */
function merge(...lists: FieldLists[]): FieldLists {
  const merged: Record<string, string[]> = {};
  for (const list of lists) {
    for (const [collection, fields] of Object.entries(list)) {
      merged[collection] = [...new Set([...(merged[collection] || []), ...fields])];
    }
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * `dimensionNodes.aliases` is not something a person edits: the inline editor derives it from the old label when the
 * description changes, and it has to travel in the same patch or the history loses the previous name. It is listed
 * here, not in the screens' tables, so the server accepts it for that one collection and nowhere else.
 */
const DERIVED_FIELDS: FieldLists = { dimensionNodes: ['aliases'] };

export const EDITABLE_RECORD_FIELDS: FieldLists = merge(RECORD_DETAIL_FIELDS, INLINE_RECORD_FIELDS, DERIVED_FIELDS);

export type EditableRecordCollection = keyof typeof EDITABLE_RECORD_FIELDS;

export const EDITABLE_RECORD_COLLECTIONS = Object.keys(EDITABLE_RECORD_FIELDS) as EditableRecordCollection[];

/** The fields of one collection a screen may edit; empty for a collection that is not editable at all. */
export function editableRecordFields(collection: string): readonly string[] {
  return EDITABLE_RECORD_FIELDS[collection] ?? [];
}

/** A stored value and what the caller says it read, compared the way the editors compare: text as text, arrays whole. */
export function sameRecordValue(stored: unknown, expected: unknown): boolean {
  if (Array.isArray(stored) || Array.isArray(expected)) {
    return JSON.stringify(stored ?? []) === JSON.stringify(expected ?? []);
  }
  if (typeof stored === 'number' && typeof expected === 'number') return stored === expected;
  return String(stored ?? '') === String(expected ?? '');
}

