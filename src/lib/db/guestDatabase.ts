/** Browser-only demo transport. No auth tokens, Supabase clients or server imports. */
export const SAMPLE_WORKSPACE_ID = 'guest';
export const SAMPLE_UID = 'owner-sample';
const STORAGE_KEY = 'ledgerflow_sample_company_v1';

type Data = Record<string, unknown>;
export type GuestTables = Record<string, Record<string, Data>>;
export type GuestOperation = { op: 'set' | 'update' | 'delete'; table: string; id: string; data?: Data; merge?: boolean; unset?: string[]; inc?: Data; union?: Data; remove?: Data };
let session: object | null = null;
let tables: GuestTables | null = null;
const listeners = new Set<() => void>();

export const guestSession = () => session;
export const guestReady = () => session !== null && tables !== null;
export function startGuestDatabase(): void {
  if (!session) session = {};
}
export function endGuestDatabase(): void {
  session = null;
  tables = null;
  listeners.clear();
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* Blocked storage must not prevent exit or sign-in. */ }
}

function isRecord(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validTables(value: unknown): value is GuestTables {
  if (!isRecord(value) || !isRecord(value.workspaces) || !isRecord(value.workspaces[SAMPLE_WORKSPACE_ID]) || value.workspaces[SAMPLE_WORKSPACE_ID].id !== SAMPLE_WORKSPACE_ID) return false;
  return Object.entries(value).every(([name, rows]) =>
    !['__proto__', 'constructor', 'prototype'].includes(name) && isRecord(rows) &&
    Object.entries(rows).every(([id, row]) => !['__proto__', 'constructor', 'prototype'].includes(id) && isRecord(row) && (row.workspaceId === undefined || row.workspaceId === SAMPLE_WORKSPACE_ID)));
}

export function initializeGuestDatabase(seed: GuestTables): void {
  if (!session) throw new Error('The sample company is no longer open.');
  if (tables) return;
  let restored: GuestTables | undefined;
  try {
    const saved = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
    if (saved) {
      const value = JSON.parse(saved);
      if (validTables(value)) restored = value;
    }
  } catch { /* A broken or outdated sample starts fresh, never falls through to a server. */ }
  tables = structuredClone(restored ?? seed);
  listeners.forEach(listener => listener());
}

export function assertGuestSession(expected: object | null): void {
  if (!expected || expected !== session || !tables) throw new Error('The sample company has closed. Reopen the demo and try again.');
}
export function guestTableNames(expected: object): string[] {
  assertGuestSession(expected);
  return Object.keys(tables!);
}
export function readGuestTable(table: string, expected: object): Array<{ id: string; data: Data }> {
  assertGuestSession(expected);
  return Object.entries(tables?.[table] ?? {}).map(([id, data]) => ({ id, data: structuredClone(data) }));
}
export function subscribeGuestDatabase(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const parts = (path: string) => {
  const result = path.split('.');
  if (result.some(p => ['__proto__', 'prototype', 'constructor'].includes(p))) throw new Error('Invalid sample field path.');
  return result;
};
function field(data: Data, path: string): unknown {
  return parts(path).reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Data)[key] : undefined, data);
}
function assign(data: Data, path: string, value: unknown, remove = false): void {
  const keys = parts(path);
  let target = data;
  for (const key of keys.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
    target = target[key] as Data;
  }
  if (remove) delete target[keys.at(-1)!]; else target[keys.at(-1)!] = structuredClone(value);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Commit to storage before publishing: quota/private-mode errors are save failures, not success. */
export function writeGuestBatch(operations: GuestOperation[], expected: object): void {
  assertGuestSession(expected);
  const next = structuredClone(tables!);
  for (const op of operations) {
    if (['__proto__', 'prototype', 'constructor'].includes(op.table) || ['__proto__', 'prototype', 'constructor'].includes(op.id)) throw new Error('Invalid sample record.');
    const table = next[op.table] ??= {};
    const existing = table[op.id];
    if (op.op === 'delete') { delete table[op.id]; continue; }
    if (op.op === 'update' && !existing) throw new Error(`Sample record ${op.table}/${op.id} was not found.`);
    const data: Data = op.op === 'set' && !op.merge ? {} : structuredClone(existing ?? {});
    if (op.op === 'set') Object.assign(data, structuredClone(op.data ?? {}));
    else for (const [key, value] of Object.entries(op.data ?? {})) assign(data, key, value);
    for (const key of op.unset ?? []) assign(data, key, undefined, true);
    for (const [key, value] of Object.entries(op.inc ?? {})) assign(data, key, Number(field(data, key) ?? 0) + Number(value));
    for (const [key, value] of Object.entries(op.union ?? {})) {
      const old = field(data, key);
      const list = Array.isArray(old) ? old : [];
      assign(data, key, [...list, ...(value as unknown[]).filter(v => !list.some(item => same(item, v)))]);
    }
    for (const [key, value] of Object.entries(op.remove ?? {})) {
      const old = field(data, key);
      assign(data, key, (Array.isArray(old) ? old : []).filter(item => !(value as unknown[]).some(v => same(item, v))));
    }
    // A demo cannot write a remembered signed-in workspace, even through the generic adapter.
    if (data.workspaceId !== undefined && data.workspaceId !== SAMPLE_WORKSPACE_ID) throw new Error('Only the sample company can be changed in the demo.');
    if (op.table === 'workspaces' && op.id !== SAMPLE_WORKSPACE_ID) throw new Error('Only the sample company can be changed in the demo.');
    table[op.id] = data;
  }
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  tables = next;
  listeners.forEach(listener => listener());
}

export function guestRows(table: string): Array<{ id: string; data: Data }> {
  if (!session) return [];
  return readGuestTable(table, session);
}

export function guestRpc(fn: string, args: Record<string, unknown>, expected: object): void {
  const table = String(args.p_table);
  const id = String(args.p_id);
  if (fn === 'lf_batch') return writeGuestBatch(args.p_ops as GuestOperation[], expected);
  if (fn === 'lf_set') return writeGuestBatch([{ op: 'set', table, id, data: args.p_data as Data, merge: Boolean(args.p_merge) }], expected);
  if (fn === 'lf_update') return writeGuestBatch([{ op: 'update', table, id, data: args.p_set as Data, unset: args.p_unset as string[], inc: args.p_inc as Data, union: args.p_union as Data, remove: args.p_remove as Data }], expected);
  if (fn === 'lf_delete') return writeGuestBatch([{ op: 'delete', table, id }], expected);
  throw new Error(`The sample company does not support ${fn}. Nothing was sent to the server.`);
}

/** Deterministic local query ordering (no locale/database collation claim). */
export function queryGuestRows(table: string, expected: object, filters: ReadonlyArray<{ field: string; op: string; value: unknown }>, orders: ReadonlyArray<{ field: string; direction: string }>, cap?: number) {
  const value = (row: { id: string; data: Data }, key: string) => key === 'id' || key === '__name__' ? row.id : field(row.data, key);
  const rows = readGuestTable(table, expected).filter(row => filters.every(filter => {
    const actual = value(row, filter.field);
    const wanted = filter.value;
    switch (filter.op) {
      case '==': return same(actual ?? null, wanted);
      case '!=': return actual != null && !same(actual, wanted);
      case 'in': return Array.isArray(wanted) && wanted.some(v => same(actual, v));
      case 'not-in': return actual != null && Array.isArray(wanted) && !wanted.some(v => same(actual, v));
      case 'array-contains': return Array.isArray(actual) && actual.some(v => same(v, wanted));
      case 'array-contains-any': return Array.isArray(actual) && Array.isArray(wanted) && actual.some(v => wanted.some(w => same(v, w)));
      case '<': case '<=': case '>': case '>=': {
        if (actual == null || wanted == null) return false;
        if (typeof actual !== 'string' && typeof actual !== 'number') return false;
        if (typeof wanted !== typeof actual) return false;
        const compare = typeof actual === 'number' ? actual - (wanted as number) : actual < (wanted as string) ? -1 : actual > (wanted as string) ? 1 : 0;
        return filter.op === '<' ? compare < 0 : filter.op === '<=' ? compare <= 0 : filter.op === '>' ? compare > 0 : compare >= 0;
      }
      default: throw new Error(`Unsupported sample filter ${filter.op}.`);
    }
  })).filter(row => orders.every(order => value(row, order.field) !== undefined));
  rows.sort((a, b) => {
    for (const order of orders) {
      const left = value(a, order.field) as string | number;
      const right = value(b, order.field) as string | number;
      const compare = left < right ? -1 : left > right ? 1 : 0;
      if (compare) return order.direction === 'desc' ? -compare : compare;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return rows.slice(0, cap);
}
