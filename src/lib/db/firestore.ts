/**
 * Firestore-compatible data layer on Supabase (browser).
 *
 * Exposes the subset of the `firebase/firestore` API the app uses, so screens keep their code:
 * collection, doc, query, where, orderBy, limit, getDoc(s), setDoc, updateDoc, addDoc,
 * deleteDoc, onSnapshot, writeBatch, runTransaction, serverTimestamp, deleteField,
 * increment, arrayUnion, arrayRemove.
 *
 * Every collection is a Postgres table { id, data jsonb, workspace_id }. Reads go through
 * PostgREST with row level security; writes go through the lf_set / lf_update / lf_delete /
 * lf_batch database functions (see supabase/migrations), which keep Firestore semantics.
 * Live updates use Supabase Realtime plus an immediate local refresh after our own writes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordRead } from './readCounter';
import { getSupabase } from './client';
import { changedSince, latestUpdate, mergeChanges } from './liveQuery';
import type { LiveRow } from './liveQuery';

// Same shape as firebase's DocumentData: documents are free-form JSON whose fields the
// screens read directly, so field values are deliberately untyped (as in Firebase).
type FieldValueAny = ReturnType<typeof JSON.parse>;
export type DocumentData = { [field: string]: FieldValueAny };
export type WhereFilterOp =
  | '<' | '<=' | '==' | '!=' | '>=' | '>'
  | 'array-contains' | 'in' | 'not-in' | 'array-contains-any';
export type OrderByDirection = 'asc' | 'desc';
export type Unsubscribe = () => void;

export interface Firestore {
  readonly type: 'firestore';
  readonly client: () => SupabaseClient;
}

export class FirestoreError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FirebaseError';
  }
}

let defaultDb: Firestore | null = null;

export function getFirestore(client: () => SupabaseClient = getSupabase): Firestore {
  if (client === getSupabase) {
    if (!defaultDb) defaultDb = { type: 'firestore', client };
    return defaultDb;
  }
  return { type: 'firestore', client };
}

// ---------------------------------------------------------------------------
// Sentinels
// ---------------------------------------------------------------------------

type SentinelKind = 'serverTimestamp' | 'delete' | 'increment' | 'arrayUnion' | 'arrayRemove';

export class FieldValue {
  constructor(readonly kind: SentinelKind, readonly operand?: unknown) {}
  isEqual(other: FieldValue): boolean {
    return other instanceof FieldValue && other.kind === this.kind
      && JSON.stringify(other.operand) === JSON.stringify(this.operand);
  }
}

export const serverTimestamp = () => new FieldValue('serverTimestamp');
export const deleteField = () => new FieldValue('delete');
export const increment = (n: number) => new FieldValue('increment', n);
export const arrayUnion = (...elements: unknown[]) => new FieldValue('arrayUnion', elements);
export const arrayRemove = (...elements: unknown[]) => new FieldValue('arrayRemove', elements);

// ---------------------------------------------------------------------------
// References and queries
// ---------------------------------------------------------------------------

export class CollectionReference<T = DocumentData> {
  readonly type = 'collection' as const;
  constructor(readonly firestore: Firestore, readonly id: string) {}
  get path(): string { return this.id; }
  // phantom field so the generic parameter is used
  readonly _t?: T;
}

export class DocumentReference<T = DocumentData> {
  readonly type = 'document' as const;
  constructor(readonly firestore: Firestore, readonly collectionId: string, readonly id: string) {}
  get path(): string { return `${this.collectionId}/${this.id}`; }
  get parent(): CollectionReference<T> { return new CollectionReference<T>(this.firestore, this.collectionId); }
  readonly _t?: T;
}

interface Filter { field: string; op: WhereFilterOp; value: unknown }
interface Order { field: string; direction: OrderByDirection }

export class Query<T = DocumentData> {
  readonly type = 'query' as const;
  constructor(
    readonly firestore: Firestore,
    readonly collectionId: string,
    readonly filters: Filter[] = [],
    readonly orders: Order[] = [],
    readonly limitCount?: number,
  ) {}
  readonly _t?: T;
}

export type QueryConstraint =
  | { kind: 'where'; filter: Filter }
  | { kind: 'orderBy'; order: Order }
  | { kind: 'limit'; count: number };

export const where = (field: string, op: WhereFilterOp, value: unknown): QueryConstraint =>
  ({ kind: 'where', filter: { field, op, value } });
export const orderBy = (field: string, direction: OrderByDirection = 'asc'): QueryConstraint =>
  ({ kind: 'orderBy', order: { field, direction } });
export const limit = (count: number): QueryConstraint => ({ kind: 'limit', count });

function splitPath(path: string, segments: string[]): string[] {
  return [path, ...segments].flatMap(p => p.split('/')).filter(Boolean);
}

export function collection(db: Firestore, path: string, ...segments: string[]): CollectionReference {
  const parts = splitPath(path, segments);
  if (parts.length !== 1) {
    throw new FirestoreError('invalid-argument', `Only top-level collections are supported (got "${parts.join('/')}")`);
  }
  return new CollectionReference(db, parts[0]);
}

export function doc(dbOrCollection: Firestore | CollectionReference, path?: string, ...segments: string[]): DocumentReference {
  if (dbOrCollection instanceof CollectionReference) {
    return new DocumentReference(dbOrCollection.firestore, dbOrCollection.id, path || autoId());
  }
  const parts = splitPath(path || '', segments);
  if (parts.length !== 2) {
    throw new FirestoreError('invalid-argument', `A document path needs a collection and an id (got "${parts.join('/')}")`);
  }
  return new DocumentReference(dbOrCollection, parts[0], parts[1]);
}

export function query<T = DocumentData>(base: CollectionReference<T> | Query<T>, ...constraints: QueryConstraint[]): Query<T> {
  const start = base instanceof Query
    ? base
    : new Query<T>(base.firestore, base.id);
  const filters = [...start.filters];
  const orders = [...start.orders];
  let limitCount = start.limitCount;
  for (const c of constraints) {
    if (c.kind === 'where') filters.push(c.filter);
    else if (c.kind === 'orderBy') orders.push(c.order);
    else limitCount = c.count;
  }
  return new Query<T>(start.firestore, start.collectionId, filters, orders, limitCount);
}

const AUTO_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function autoId(): string {
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) id += AUTO_ID_CHARS[b % AUTO_ID_CHARS.length];
  return id;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

const NO_PENDING = Object.freeze({ hasPendingWrites: false, fromCache: false });

export class DocumentSnapshot<T = DocumentData> {
  readonly metadata = NO_PENDING;
  constructor(readonly ref: DocumentReference<T>, private readonly _data: T | undefined) {}
  get id(): string { return this.ref.id; }
  exists(): this is QueryDocumentSnapshot<T> { return this._data !== undefined; }
  data(): T | undefined { return this._data; }
  get(field: string): unknown {
    return field.split('.').reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
      this._data,
    );
  }
}

export class QueryDocumentSnapshot<T = DocumentData> extends DocumentSnapshot<T> {
  data(): T { return super.data() as T; }
}

export class QuerySnapshot<T = DocumentData> {
  readonly metadata = NO_PENDING;
  constructor(readonly query: Query<T>, readonly docs: QueryDocumentSnapshot<T>[]) {}
  get size(): number { return this.docs.length; }
  get empty(): boolean { return this.docs.length === 0; }
  forEach(cb: (doc: QueryDocumentSnapshot<T>) => void): void { this.docs.forEach(cb); }
}

// ---------------------------------------------------------------------------
// Encoding values for the database
// ---------------------------------------------------------------------------

/** Replace serverTimestamp / Date with ISO strings and drop undefined, recursively. */
function encodeValue(value: unknown, inSet: boolean): unknown {
  if (value instanceof FieldValue) {
    if (value.kind === 'serverTimestamp') return new Date().toISOString();
    if (inSet && value.kind === 'increment') return value.operand;
    if (inSet && value.kind === 'arrayUnion') return value.operand;
    if (inSet && value.kind === 'arrayRemove') return [];
    throw new FirestoreError('invalid-argument', `${value.kind}() is only allowed at the top level of an update`);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(v => encodeValue(v, inSet)).filter(v => v !== undefined);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown> & { toDate?: () => Date };
    if (typeof obj.toDate === 'function' && Object.keys(obj).length <= 2) {
      return obj.toDate().toISOString();
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      if (v instanceof FieldValue && v.kind === 'delete') continue;
      out[k] = encodeValue(v, inSet);
    }
    return out;
  }
  return value;
}

interface EncodedSet { data: Record<string, unknown>; unset: string[] }
interface EncodedUpdate {
  set: Record<string, unknown>;
  unset: string[];
  inc: Record<string, number>;
  union: Record<string, unknown[]>;
  remove: Record<string, unknown[]>;
}

function encodeSet(data: DocumentData, merge: boolean): EncodedSet {
  const unset: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v instanceof FieldValue && v.kind === 'delete') {
      if (merge) unset.push(k);
      continue;
    }
    out[k] = encodeValue(v, true);
  }
  return { data: out, unset };
}

function encodeUpdate(data: DocumentData): EncodedUpdate {
  const enc: EncodedUpdate = { set: {}, unset: [], inc: {}, union: {}, remove: {} };
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v instanceof FieldValue) {
      if (v.kind === 'delete') enc.unset.push(k);
      else if (v.kind === 'increment') enc.inc[k] = Number(v.operand);
      else if (v.kind === 'arrayUnion') enc.union[k] = encodeValue(v.operand, false) as unknown[];
      else if (v.kind === 'arrayRemove') enc.remove[k] = encodeValue(v.operand, false) as unknown[];
      else enc.set[k] = encodeValue(v, false);
      continue;
    }
    enc.set[k] = encodeValue(v, false);
  }
  return enc;
}

function updateArgsFrom(fieldOrData: string | DocumentData, rest: unknown[]): DocumentData {
  if (typeof fieldOrData !== 'string') return fieldOrData;
  const out: DocumentData = { [fieldOrData]: rest[0] };
  for (let i = 1; i + 1 < rest.length; i += 2) out[String(rest[i])] = rest[i + 1];
  return out;
}

// ---------------------------------------------------------------------------
// Errors and local change notifications
// ---------------------------------------------------------------------------

interface DbError { message?: string; code?: string; details?: string | null; hint?: string | null }

function toFirestoreError(err: DbError | Error, path: string): FirestoreError {
  const e = err as DbError;
  const code = e.code === '42501' || /permission denied|row-level security/i.test(e.message || '')
    ? 'permission-denied'
    : e.code === 'P0002' ? 'not-found'
    : e.code === 'PGRST301' || e.code === '401' ? 'unauthenticated'
    : 'unknown';
  return new FirestoreError(code, `${e.message || 'Database error'} (${path})`);
}

const localListeners = new Map<string, Set<(deletedIds: string[]) => void>>();

/** Our own writes refresh the live lists at once; deletes say which rows went. */
function notifyLocalWrite(tables: Iterable<string>, deleted: Array<{ table: string; id: string }> = []): void {
  for (const t of new Set(tables)) {
    const ids = deleted.filter(d => d.table === t).map(d => d.id);
    localListeners.get(t)?.forEach(fn => fn(ids));
  }
}

async function rpc(db: Firestore, fn: string, args: Record<string, unknown>, path: string): Promise<void> {
  const { error } = await db.client().rpc(fn, args);
  if (error) throw toFirestoreError(error, path);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function jsonPath(field: string, asText: boolean): string {
  const parts = field.split('.');
  if (parts.length === 1) return `data${asText ? '->>' : '->'}${parts[0]}`;
  const last = parts.pop();
  return `data->${parts.join('->')}${asText ? '->>' : '->'}${last}`;
}

function columnFor(field: string, value: unknown): string {
  if (field === 'workspaceId') return 'workspace_id';
  if (field === '__name__' || field === 'id') return 'id';
  const asText = typeof value === 'string' || (Array.isArray(value) && typeof value[0] === 'string');
  return jsonPath(field, asText);
}

function pgList(values: unknown[]): string {
  return `(${values.map(v => (typeof v === 'string'
    ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : String(v))).join(',')})`;
}

// Loose builder type: PostgREST filter builders are chainable and share these methods.
interface FilterBuilder {
  eq(c: string, v: unknown): FilterBuilder;
  neq(c: string, v: unknown): FilterBuilder;
  lt(c: string, v: unknown): FilterBuilder;
  lte(c: string, v: unknown): FilterBuilder;
  gt(c: string, v: unknown): FilterBuilder;
  gte(c: string, v: unknown): FilterBuilder;
  in(c: string, v: unknown[]): FilterBuilder;
  is(c: string, v: null): FilterBuilder;
  not(c: string, op: string, v: unknown): FilterBuilder;
  filter(c: string, op: string, v: unknown): FilterBuilder;
  or(expr: string): FilterBuilder;
  order(c: string, opts: { ascending: boolean; nullsFirst?: boolean }): FilterBuilder;
  range(from: number, to: number): FilterBuilder;
  then: PromiseLike<{ data: unknown; error: DbError | null }>['then'];
}

function applyFilter(b: FilterBuilder, f: Filter): FilterBuilder {
  const col = columnFor(f.field, f.value);
  switch (f.op) {
    case '==': return f.value === null ? b.is(jsonPath(f.field, true), null) : b.eq(col, f.value);
    case '!=': return f.value === null ? b.not(jsonPath(f.field, true), 'is', null) : b.neq(col, f.value);
    case '<': return b.lt(col, f.value);
    case '<=': return b.lte(col, f.value);
    case '>': return b.gt(col, f.value);
    case '>=': return b.gte(col, f.value);
    case 'in': return b.in(col, f.value as unknown[]);
    case 'not-in': return b.not(col, 'in', pgList(f.value as unknown[]));
    case 'array-contains': return b.filter(jsonPath(f.field, false), 'cs', JSON.stringify([f.value]));
    case 'array-contains-any':
      return b.or((f.value as unknown[]).map(v => `${jsonPath(f.field, false)}.cs.${JSON.stringify([v])}`).join(','));
    default: throw new FirestoreError('invalid-argument', `Unsupported operator ${String(f.op)}`);
  }
}

const PAGE_SIZE = 1000;

interface Row { id: string; data: DocumentData; updated_at?: string }

/** Pages asked for at once after the first (C-20): 20 pages took 20 round trips one after another. */
const PAGES_AT_ONCE = 4;

async function fetchRows(q: Query): Promise<Row[]> {
  const client = q.firestore.client();
  const max = q.limitCount ?? Number.POSITIVE_INFINITY;
  const page = async (from: number): Promise<Row[]> => {
    const to = Math.min(from + PAGE_SIZE, max) - 1;
    let b = client.from(q.collectionId).select('id,data,updated_at') as unknown as FilterBuilder;
    for (const f of q.filters) b = applyFilter(b, f);
    for (const o of q.orders) {
      // Firestore leaves out documents that don't have the orderBy field.
      b = b.not(jsonPath(o.field, true), 'is', null);
      b = b.order(jsonPath(o.field, false), { ascending: o.direction === 'asc' });
    }
    // a unique last key keeps the order the same on every page (rows with equal dates would otherwise shift between pages)
    b = b.order('id', { ascending: true });
    const { data, error } = await b.range(from, to);
    if (error) throw toFirestoreError(error, q.collectionId);
    return (data || []) as Row[];
  };
  const rows: Row[] = [];
  const first = await page(0);
  rows.push(...first);
  // most lists fit in one page; a longer one is fetched a few pages at a time instead of one after another
  let more = first.length === Math.min(PAGE_SIZE, max);
  for (let from = PAGE_SIZE; more && from < max;) {
    const starts: number[] = [];
    for (let i = 0; i < PAGES_AT_ONCE && from + i * PAGE_SIZE < max; i++) starts.push(from + i * PAGE_SIZE);
    const pages = await Promise.all(starts.map(page));
    for (let i = 0; i < pages.length; i++) {
      rows.push(...pages[i]);
      if (pages[i].length < Math.min(PAGE_SIZE, max - starts[i])) { more = false; break; }
    }
    from += starts.length * PAGE_SIZE;
  }
  // a row written while the pages were read can show up twice: keep the first
  const seen = new Set<string>();
  const out = rows.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true))).slice(0, Number.isFinite(max) ? max : undefined);
  recordRead(q.collectionId, rows.length);
  return out;
}

export async function getDoc<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
  const { data, error } = await ref.firestore.client()
    .from(ref.collectionId).select('id,data').eq('id', ref.id).maybeSingle();
  if (error) throw toFirestoreError(error, ref.path);
  recordRead(ref.collectionId, data ? 1 : 0);
  return new DocumentSnapshot<T>(ref, data ? ((data as Row).data as T) : undefined);
}

export async function getDocs<T = DocumentData>(q: Query<T> | CollectionReference<T>): Promise<QuerySnapshot<T>> {
  const qq = q instanceof Query ? q : query(q);
  const rows = await fetchRows(qq as unknown as Query);
  return new QuerySnapshot<T>(qq, rows.map(r =>
    new QueryDocumentSnapshot<T>(new DocumentReference<T>(qq.firestore, qq.collectionId, r.id), r.data as T)));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface SetOptions { merge?: boolean; mergeFields?: string[] }

export async function setDoc<T = DocumentData>(ref: DocumentReference<T>, data: DocumentData, options?: SetOptions): Promise<void> {
  const merge = Boolean(options?.merge || options?.mergeFields);
  const enc = encodeSet(data, merge);
  if (enc.unset.length) {
    await rpc(ref.firestore, 'lf_batch', {
      p_ops: [
        { op: 'set', table: ref.collectionId, id: ref.id, data: enc.data, merge },
        { op: 'update', table: ref.collectionId, id: ref.id, data: {}, unset: enc.unset },
      ],
    }, ref.path);
  } else {
    await rpc(ref.firestore, 'lf_set', { p_table: ref.collectionId, p_id: ref.id, p_data: enc.data, p_merge: merge }, ref.path);
  }
  notifyLocalWrite([ref.collectionId]);
}

export async function updateDoc<T = DocumentData>(ref: DocumentReference<T>, fieldOrData: string | DocumentData, ...rest: unknown[]): Promise<void> {
  const enc = encodeUpdate(updateArgsFrom(fieldOrData, rest));
  await rpc(ref.firestore, 'lf_update', {
    p_table: ref.collectionId, p_id: ref.id, p_set: enc.set, p_unset: enc.unset,
    p_inc: enc.inc, p_union: enc.union, p_remove: enc.remove,
  }, ref.path);
  notifyLocalWrite([ref.collectionId]);
}

export async function addDoc<T = DocumentData>(coll: CollectionReference<T>, data: DocumentData): Promise<DocumentReference<T>> {
  const ref = new DocumentReference<T>(coll.firestore, coll.id, autoId());
  await setDoc(ref, data);
  return ref;
}

export async function deleteDoc<T = DocumentData>(ref: DocumentReference<T>): Promise<void> {
  await rpc(ref.firestore, 'lf_delete', { p_table: ref.collectionId, p_id: ref.id }, ref.path);
  notifyLocalWrite([ref.collectionId], [{ table: ref.collectionId, id: ref.id }]);
}

type BatchOp = Record<string, unknown> & { table: string };

export class WriteBatch {
  private ops: BatchOp[] = [];
  constructor(private readonly db: Firestore) {}

  set(ref: DocumentReference, data: DocumentData, options?: SetOptions): WriteBatch {
    const merge = Boolean(options?.merge || options?.mergeFields);
    const enc = encodeSet(data, merge);
    this.ops.push({ op: 'set', table: ref.collectionId, id: ref.id, data: enc.data, merge });
    if (enc.unset.length) this.ops.push({ op: 'update', table: ref.collectionId, id: ref.id, data: {}, unset: enc.unset });
    return this;
  }

  update(ref: DocumentReference, fieldOrData: string | DocumentData, ...rest: unknown[]): WriteBatch {
    const enc = encodeUpdate(updateArgsFrom(fieldOrData, rest));
    this.ops.push({
      op: 'update', table: ref.collectionId, id: ref.id, data: enc.set, unset: enc.unset,
      inc: enc.inc, union: enc.union, remove: enc.remove,
    });
    return this;
  }

  delete(ref: DocumentReference): WriteBatch {
    this.ops.push({ op: 'delete', table: ref.collectionId, id: ref.id });
    return this;
  }

  async commit(): Promise<void> {
    if (this.ops.length === 0) return;
    await rpc(this.db, 'lf_batch', { p_ops: this.ops }, 'batch');
    notifyLocalWrite(this.ops.map(o => o.table),
      this.ops.filter(o => o.op === 'delete').map(o => ({ table: o.table, id: String(o.id) })));
  }
}

export const writeBatch = (db: Firestore): WriteBatch => new WriteBatch(db);

export class Transaction {
  constructor(private readonly db: Firestore, private readonly batch: WriteBatch) {}
  get<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> { return getDoc(ref); }
  set(ref: DocumentReference, data: DocumentData, options?: SetOptions): Transaction { this.batch.set(ref, data, options); return this; }
  update(ref: DocumentReference, fieldOrData: string | DocumentData, ...rest: unknown[]): Transaction {
    this.batch.update(ref, fieldOrData, ...rest); return this;
  }
  delete(ref: DocumentReference): Transaction { this.batch.delete(ref); return this; }
}

/**
 * Reads happen immediately; all writes are applied together in one database transaction
 * at the end. (Unlike Firestore there is no automatic retry on conflicting writes;
 * money-critical transactions run on the server with row locks.)
 */
export async function runTransaction<R>(db: Firestore, fn: (tx: Transaction) => Promise<R>): Promise<R> {
  const batch = new WriteBatch(db);
  const result = await fn(new Transaction(db, batch));
  await batch.commit();
  return result;
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

type SnapshotTarget<T> = DocumentReference<T> | Query<T> | CollectionReference<T>;
interface SnapshotObserver<S> { next?: (snap: S) => void; error?: (err: FirestoreError) => void; complete?: () => void }
export interface SnapshotListenOptions { includeMetadataChanges?: boolean }
type OnError = (err: FirestoreError) => void;

let channelCounter = 0;

/** Rows changed since `since` in one workspace, oldest change first; null when too many (reload). */
const MAX_CHANGED_ROWS = 2000;
async function fetchChanged(q: Query, workspaceId: string, since: string): Promise<LiveRow[] | null> {
  const client = q.firestore.client();
  const out: LiveRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const b = (client.from(q.collectionId).select('id,data,updated_at') as unknown as FilterBuilder)
      .eq('workspace_id', workspaceId)
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true });
    const { data, error } = await b.range(from, from + PAGE_SIZE - 1);
    if (error) throw toFirestoreError(error, q.collectionId);
    const page = (data || []) as Row[];
    out.push(...page.map(r => ({ id: r.id, data: r.data, updatedAt: r.updated_at || '' })));
    if (out.length > MAX_CHANGED_ROWS) return null;
    if (page.length < PAGE_SIZE) return out;
  }
}

/**
 * A safety net for missed live events: coming back online, or to the tab after more than a
 * minute away, reloads every live list in full.
 */
const fullReloadListeners = new Set<() => void>();
let reloadTriggersInstalled = false;
function installReloadTriggers(): void {
  if (reloadTriggersInstalled || typeof window === 'undefined' || typeof document === 'undefined') return;
  reloadTriggersInstalled = true;
  let hiddenAt = 0;
  const reloadAll = () => fullReloadListeners.forEach(fn => fn());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 60_000) reloadAll();
    hiddenAt = 0;
  });
  window.addEventListener('online', reloadAll);
}

export function onSnapshot<T = DocumentData>(ref: DocumentReference<T>,
  onNext: (snap: DocumentSnapshot<T>) => void, onError?: OnError): Unsubscribe;
export function onSnapshot<T = DocumentData>(ref: DocumentReference<T>, options: SnapshotListenOptions,
  onNext: (snap: DocumentSnapshot<T>) => void, onError?: OnError): Unsubscribe;
export function onSnapshot<T = DocumentData>(ref: DocumentReference<T>,
  observer: SnapshotObserver<DocumentSnapshot<T>>): Unsubscribe;
export function onSnapshot<T = DocumentData>(q: Query<T> | CollectionReference<T>,
  onNext: (snap: QuerySnapshot<T>) => void, onError?: OnError): Unsubscribe;
export function onSnapshot<T = DocumentData>(q: Query<T> | CollectionReference<T>, options: SnapshotListenOptions,
  onNext: (snap: QuerySnapshot<T>) => void, onError?: OnError): Unsubscribe;
export function onSnapshot<T = DocumentData>(q: Query<T> | CollectionReference<T>,
  observer: SnapshotObserver<QuerySnapshot<T>>): Unsubscribe;
export function onSnapshot<T = DocumentData>(target: SnapshotTarget<T>, ...args: unknown[]): Unsubscribe {
  // Accepts (target, onNext, onError?), (target, observer) and (target, options, onNext, onError?).
  const fnArgs = args.filter(a => typeof a === 'function') as Array<(x: unknown) => void>;
  const observer = args.find(a => a && typeof a === 'object' && ('next' in (a as object) || 'error' in (a as object))) as
    SnapshotObserver<unknown> | undefined;
  const onNext = fnArgs[0] || observer?.next || (() => {});
  const onError = fnArgs[1] || observer?.error || ((err: unknown) => console.error('[db] snapshot listener failed', err));

  const db = target.firestore;
  const table = target instanceof DocumentReference ? target.collectionId
    : target instanceof Query ? target.collectionId : target.id;
  const q: Query | null = target instanceof DocumentReference ? null
    : (target instanceof Query ? target : query(target)) as unknown as Query;
  // Lists of one workspace fetch only what changed after the first load (liveQuery.ts).
  const wsFilter = q?.filters.find(f => f.field === 'workspaceId' && f.op === '==' && typeof f.value === 'string');
  const incremental = Boolean(q && wsFilter);
  installReloadTriggers();

  let active = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let wantFull = true;
  let wantDelta = false;
  const pendingDeletes = new Set<string>();
  let current: LiveRow[] = [];
  let latest: string | null = null;

  const emitList = () => {
    if (!q) return;
    onNext(new QuerySnapshot(q, current.map(r =>
      new QueryDocumentSnapshot(new DocumentReference(q.firestore, q.collectionId, r.id), r.data))));
  };

  const fullLoad = async () => {
    if (target instanceof DocumentReference) {
      const snap = await getDoc(target);
      if (active) onNext(snap);
      return;
    }
    if (!q) return;
    if (!incremental) {
      const snap = await getDocs(q);
      if (active) onNext(snap);
      return;
    }
    const rows = await fetchRows(q);
    current = rows.map(r => ({ id: r.id, data: r.data, updatedAt: r.updated_at || '' }));
    latest = latestUpdate(current, null);
    if (active) emitList();
  };

  const deltaLoad = async () => {
    if (!q || !wsFilter) return;
    const deletes = [...pendingDeletes];
    pendingDeletes.clear();
    let changed: LiveRow[] = [];
    if (latest) {
      const fetched = await fetchChanged(q, String(wsFilter.value), changedSince(latest));
      if (fetched === null) return fullLoad();
      changed = fetched;
    } else if (deletes.length === 0) {
      return fullLoad(); // nothing loaded yet to measure changes from
    }
    const out = mergeChanges(current, changed, deletes, { filters: q.filters, orders: q.orders, limitCount: q.limitCount });
    if (out.rows === null) return fullLoad();
    latest = latestUpdate(changed, latest);
    if (out.changed) {
      current = out.rows;
      if (active) emitList();
    }
  };

  const run = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      while (active && (wantFull || wantDelta || pendingDeletes.size > 0)) {
        if (wantFull || !incremental) {
          wantFull = false; wantDelta = false; pendingDeletes.clear();
          await fullLoad();
        } else {
          wantDelta = false;
          await deltaLoad();
        }
      }
    } catch (err) {
      wantFull = true; wantDelta = false; // start over on the next change
      if (active) onError(err instanceof FirestoreError ? err : toFirestoreError(err as Error, table));
    } finally {
      inFlight = false;
    }
  };

  const schedule = () => {
    if (!active) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void run(); }, 150);
  };

  // Our own writes refresh listeners right away (like Firestore's local cache).
  const onLocalWrite = (deletedIds: string[]) => {
    deletedIds.forEach(id => pendingDeletes.add(id));
    wantDelta = true;
    schedule();
  };
  let set = localListeners.get(table);
  if (!set) { set = new Set(); localListeners.set(table, set); }
  set.add(onLocalWrite);

  const reloadAll = () => { wantFull = true; schedule(); };
  fullReloadListeners.add(reloadAll);

  // Changes by other people arrive through Supabase Realtime.
  let filter: string | undefined;
  if (target instanceof DocumentReference) filter = `id=eq.${target.id}`;
  else if (wsFilter) filter = `workspace_id=eq.${String(wsFilter.value)}`;
  const client = db.client();
  const onRealtime = (payload: { eventType?: string; old?: { id?: unknown } }) => {
    if (payload?.eventType === 'DELETE') {
      const id = payload.old?.id;
      if (typeof id === 'string') pendingDeletes.add(id);
      else wantFull = true;
    } else {
      wantDelta = true;
    }
    schedule();
  };
  const channel = client.channel(`lf-${table}-${++channelCounter}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, onRealtime)
    .subscribe();

  void run();

  return () => {
    active = false;
    if (timer) clearTimeout(timer);
    const tableListeners = localListeners.get(table);
    if (tableListeners) {
      tableListeners.delete(onLocalWrite);
      if (tableListeners.size === 0) {
        localListeners.delete(table);
      }
    }
    fullReloadListeners.delete(reloadAll);
    void client.removeChannel(channel);
  };
}

/** Diagnostic snapshot of active in-memory listener sets for subscription cleanup verification. */
export function getActiveSnapshotListenerCounts(): {
  tables: number;
  localListeners: number;
  fullReloadListeners: number;
} {
  let localCount = 0;
  for (const set of localListeners.values()) {
    localCount += set.size;
  }
  return {
    tables: localListeners.size,
    localListeners: localCount,
    fullReloadListeners: fullReloadListeners.size,
  };
}
