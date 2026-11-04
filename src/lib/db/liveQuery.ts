/**
 * Live lists that fetch only what changed (launch step 9, C-14/C-15/AA-06).
 *
 * A live query (onSnapshot in ./firestore.ts) loads its rows once; after that, a change fetches
 * only the rows whose `updated_at` moved and merges them here. Filters and ordering are applied
 * in the browser with the same meaning the database gives them (applyFilter in ./firestore.ts);
 * where that meaning can't be reproduced exactly (`null` from these functions), the caller reloads
 * the whole list instead, so a list is never wrong, at worst slower.
 */

export interface LiveRow { id: string; data: Record<string, unknown>; updatedAt: string }
export interface LiveFilter { field: string; op: string; value: unknown }
export interface LiveOrder { field: string; direction: 'asc' | 'desc' }
export interface LiveQueryShape { filters: readonly LiveFilter[]; orders: readonly LiveOrder[]; limitCount?: number }

/** A row's value for a (dotted) field; `id` and `__name__` are the row id. */
export function fieldValue(row: LiveRow, field: string): unknown {
  if (field === 'id' || field === '__name__') return row.id;
  let v: unknown = row.data;
  for (const part of field.split('.')) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

/** `data->>field` in SQL: the text of a scalar, null when missing. undefined = not reproducible. */
function asText(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : undefined;
  return undefined;
}

// Dates and timestamps compare the same way in the database's text collation and in JS.
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** a < b → negative; null = the database might order these differently than JS would. */
function compareScalars(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) return 0;
    if (!ISO_LIKE.test(a) || !ISO_LIKE.test(b)) return null;
    return a < b ? -1 : 1;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return null;
}

/** Whether one row passes one filter; null = can't tell exactly (reload instead). */
function passes(row: LiveRow, f: LiveFilter): boolean | null {
  const raw = fieldValue(row, f.field);
  const value = f.value;
  const textMode = f.field === 'workspaceId' || f.field === 'id' || f.field === '__name__'
    || typeof value === 'string' || (Array.isArray(value) && typeof value[0] === 'string');

  switch (f.op) {
    case '==':
    case '!=': {
      if (value === null) {
        const missing = raw === undefined || raw === null;
        return f.op === '==' ? missing : !missing;
      }
      if (raw === undefined || raw === null) return false; // SQL NULL never equals / differs
      let equal: boolean;
      if (textMode) {
        const t = asText(raw);
        if (t === undefined) return null;
        equal = t === String(value);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        equal = typeof raw === typeof value && raw === value;
      } else {
        return null;
      }
      return f.op === '==' ? equal : !equal;
    }
    case '<': case '<=': case '>': case '>=': {
      if (raw === undefined || raw === null) return false;
      const left = textMode ? asText(raw) : raw;
      if (left === undefined) return null;
      const c = compareScalars(left, value);
      if (c === null) return null;
      return f.op === '<' ? c < 0 : f.op === '<=' ? c <= 0 : f.op === '>' ? c > 0 : c >= 0;
    }
    case 'in':
    case 'not-in': {
      if (!Array.isArray(value)) return null;
      if (raw === undefined || raw === null) return false;
      let inList: boolean;
      if (textMode) {
        const t = asText(raw);
        if (t === undefined) return null;
        inList = value.some(v => String(v) === t);
      } else {
        if (typeof raw === 'object') return null;
        inList = value.some(v => typeof v === typeof raw && v === raw);
      }
      return f.op === 'in' ? inList : !inList;
    }
    case 'array-contains':
    case 'array-contains-any': {
      const wanted = f.op === 'array-contains' ? [value] : value;
      if (!Array.isArray(wanted) || wanted.some(v => v !== null && typeof v === 'object')) return null;
      if (!Array.isArray(raw)) return false;
      return wanted.some(v => raw.some(x => x === v));
    }
    default:
      return null;
  }
}

/** Whether a row belongs in the query's result; null = can't tell exactly. */
export function rowMatches(row: LiveRow, filters: readonly LiveFilter[]): boolean | null {
  let result = true;
  for (const f of filters) {
    const p = passes(row, f);
    if (p === null) return null;
    if (!p) result = false;
  }
  return result;
}

/**
 * The query's result from the rows that match its filters: rows without an orderBy field are
 * left out (as the database does), then sorted and cut to the limit. null = the order can't be
 * reproduced exactly.
 */
export function orderedResult(rows: Iterable<LiveRow>, q: LiveQueryShape): LiveRow[] | null {
  const list = [...rows].filter(r => q.orders.every(o => {
    const v = fieldValue(r, o.field);
    return v !== undefined && v !== null;
  }));
  let unknown = false;
  list.sort((a, b) => {
    for (const o of q.orders) {
      const c = compareScalars(fieldValue(a, o.field), fieldValue(b, o.field));
      if (c === null) { unknown = true; return 0; }
      if (c !== 0) return o.direction === 'desc' ? -c : c;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  if (unknown) return null;
  return q.limitCount === undefined ? list : list.slice(0, q.limitCount);
}

export interface MergeOutcome {
  /** the new result, or null when the whole list must be reloaded */
  rows: LiveRow[] | null;
  changed: boolean;
}

/**
 * Apply changed rows and deleted ids to the current result. When the current result was cut by
 * the limit, a row that leaves it would have to be replaced by the next one, which isn't loaded,
 * so that case asks for a full reload. So does a loaded row whose sort key changed there: it may now rank behind a
 * row that was never loaded.
 */
export function mergeChanges(current: readonly LiveRow[], changed: readonly LiveRow[], deletedIds: readonly string[], q: LiveQueryShape): MergeOutcome {
  const byId = new Map(current.map(r => [r.id, r]));
  const wasFull = q.limitCount !== undefined && current.length >= q.limitCount;
  let didChange = false;
  let left = false;

  for (const id of deletedIds) {
    if (byId.delete(id)) { didChange = true; left = true; }
  }
  for (const row of changed) {
    const match = rowMatches(row, q.filters);
    if (match === null) return { rows: null, changed: true };
    const before = byId.get(row.id);
    if (match) {
      if (!before || before.updatedAt !== row.updatedAt || JSON.stringify(before.data) !== JSON.stringify(row.data)) {
        // a loaded row whose sort key changed in a list cut by the limit may now rank behind a row that was never
        // loaded (an entry moved to an earlier date): only a reload knows, so treat it like a row that left
        if (before && wasFull && q.orders.some(o => JSON.stringify(fieldValue(before, o.field)) !== JSON.stringify(fieldValue(row, o.field)))) left = true;
        byId.set(row.id, row);
        didChange = true;
      }
    } else if (before) {
      byId.delete(row.id);
      didChange = true;
      left = true;
    }
  }
  if (!didChange) return { rows: [...current], changed: false };
  if (left && wasFull) return { rows: null, changed: true };
  const rows = orderedResult(byId.values(), q);
  return { rows, changed: true };
}

/** The latest `updated_at` among rows (ISO text from the database), or the previous one. */
export function latestUpdate(rows: readonly LiveRow[], previous: string | null): string | null {
  let latest = previous;
  for (const r of rows) {
    if (r.updatedAt && (!latest || Date.parse(r.updatedAt) > Date.parse(latest))) latest = r.updatedAt;
  }
  return latest;
}

/**
 * Where to start the next "what changed" fetch: a little before the latest change seen, because a
 * transaction that started earlier can commit after a later one (rows fetched twice are merged
 * again harmlessly).
 */
export function changedSince(latest: string, overlapMs = 10_000): string {
  return new Date(Date.parse(latest) - overlapMs).toISOString();
}
