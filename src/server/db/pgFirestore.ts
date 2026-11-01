/**
 * Firestore-compatible data layer on Postgres (server).
 *
 * The server was written against firebase-admin's Firestore API. This module implements the
 * part of that API the server uses, on the Supabase Postgres database, so routes keep their
 * code: collection / doc / get / set / update / create / delete, queries (where, orderBy,
 * limit, offset, startAfter / startAt / endAt / endBefore, count, stream), getAll, write
 * batches and transactions, FieldValue and Timestamp.
 *
 * Storage: one table per collection { id text, data jsonb, workspace_id (generated from
 * data.workspaceId), created_at, updated_at } (see supabase/migrations). The server logs in
 * with the database password, a role that bypasses row level security, and does its own
 * permission checks, exactly as it did with firebase-admin.
 *
 * Semantics kept from Firestore:
 * - set() replaces the document; set(..., { merge: true }) merges nested maps; update() takes
 *   dotted field paths and fails with NOT_FOUND when the document is missing; create() fails
 *   with ALREADY_EXISTS; delete() of a missing document succeeds.
 * - FieldValue.serverTimestamp / delete / increment / arrayUnion / arrayRemove.
 * - Timestamps and Dates are stored as ISO-8601 strings (the app already stores dates that way).
 * - Queries leave out documents that lack an orderBy field, and are ordered by document id
 *   last (Firestore's implicit __name__ order), so cursors page deterministically.
 * - Transactions are SERIALIZABLE and retried on conflicts, like Firestore's: "read a key,
 *   create it if missing" can't run twice concurrently. Writes are buffered and applied at the
 *   end, after the reads, as in Firestore.
 */
import pg from 'pg';
import { timePoolQueries } from './slowQueryLog';
import { Readable } from 'stream';
import crypto from 'crypto';
import {
  FieldPath, FirestoreError, Timestamp, hasTransforms, invalid, isPlainObject, readPath,
  splitWrite, toSegments,
} from './pg/values';
import type {
  DocumentData, FieldValueAny, OrderByDirection, Patch, Precondition, RefLike, SetOptions, WhereFilterOp,
  WriteResult,
} from './pg/values';
import {
  COLLECTION_ID, Params, compileLimit, compileOrder, compileWhere, effectiveOrders, isIdField, isRetryable,
  quoteIdent, translateError,
} from './pg/sql';
import type { Cursor, DocRow, QuerySpec, Runner } from './pg/sql';

export { FieldPath, FieldValue, FirestoreError, Timestamp } from './pg/values';
export type {
  DocumentData, OrderByDirection, Precondition, SetOptions, WhereFilterOp, WriteResult,
} from './pg/values';

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export class DocumentSnapshot<T = DocumentData> {
  constructor(
    readonly ref: DocumentReference<T>,
    private readonly raw: string | null,
    readonly createTime: Timestamp | undefined,
    readonly updateTime: Timestamp | undefined,
    readonly readTime: Timestamp,
  ) {}
  get id(): string { return this.ref.id; }
  get exists(): boolean { return this.raw !== null; }
  /** A fresh copy on every call, like firebase-admin (callers may mutate it). */
  data(): T | undefined {
    return this.raw === null ? undefined : (JSON.parse(this.raw) as T);
  }
  get(field: string | FieldPath): FieldValueAny {
    return this.raw === null ? undefined : readPath(JSON.parse(this.raw), toSegments(field));
  }
  isEqual(other: DocumentSnapshot<T>): boolean {
    return other instanceof DocumentSnapshot && other.ref.path === this.ref.path && other.raw === this.raw;
  }
}

export class QueryDocumentSnapshot<T = DocumentData> extends DocumentSnapshot<T> {
  data(): T { return super.data() as T; }
}

export interface DocumentChange<T = DocumentData> {
  type: 'added';
  doc: QueryDocumentSnapshot<T>;
  oldIndex: number;
  newIndex: number;
}

export class QuerySnapshot<T = DocumentData> {
  constructor(readonly query: Query<T>, readonly docs: QueryDocumentSnapshot<T>[], readonly readTime: Timestamp) {}
  get size(): number { return this.docs.length; }
  get empty(): boolean { return this.docs.length === 0; }
  forEach(callback: (doc: QueryDocumentSnapshot<T>) => void, thisArg?: unknown): void {
    this.docs.forEach(callback, thisArg);
  }
  docChanges(): DocumentChange<T>[] {
    return this.docs.map((doc, newIndex) => ({ type: 'added', doc, oldIndex: -1, newIndex }));
  }
}

export interface AggregateQuerySnapshot {
  data(): { count: number };
  readTime: Timestamp;
}

export class AggregateQuery<T = DocumentData> {
  constructor(private readonly query: Query<T>) {}
  async get(): Promise<AggregateQuerySnapshot> {
    const count = await this.query.firestore.countQuery(this.query, null);
    const readTime = Timestamp.now();
    return { data: () => ({ count }), readTime };
  }
}

function snapshotFromRow<T>(ref: DocumentReference<T>, row: DocRow | undefined, readTime: Timestamp): DocumentSnapshot<T> {
  if (!row) return new DocumentSnapshot<T>(ref, null, undefined, undefined, readTime);
  return new DocumentSnapshot<T>(ref, row.data, Timestamp.fromDate(row.created_at), Timestamp.fromDate(row.updated_at), readTime);
}

// ---------------------------------------------------------------------------
// Queries and references
// ---------------------------------------------------------------------------

type CursorArg = DocumentSnapshot | unknown;

export class Query<T = DocumentData> {
  constructor(
    readonly firestore: Firestore,
    readonly collectionId: string,
    protected readonly spec: QuerySpec = { filters: [], orders: [] },
  ) {}

  private next(change: Partial<QuerySpec>): Query<T> {
    return new Query<T>(this.firestore, this.collectionId, { ...this.spec, ...change });
  }

  /** @internal */
  get querySpec(): QuerySpec { return this.spec; }

  where(field: string | FieldPath, op: WhereFilterOp, value: unknown): Query<T> {
    return this.next({ filters: [...this.spec.filters, { segments: toSegments(field), op, value }] });
  }

  orderBy(field: string | FieldPath, direction: OrderByDirection = 'asc'): Query<T> {
    if (direction !== 'asc' && direction !== 'desc') throw invalid(`Invalid order direction "${String(direction)}"`);
    return this.next({ orders: [...this.spec.orders, { segments: toSegments(field), direction }] });
  }

  limit(n: number): Query<T> {
    if (!Number.isSafeInteger(n) || n < 0) throw invalid('limit() needs a non-negative integer');
    return this.next({ limit: n });
  }

  offset(n: number): Query<T> {
    if (!Number.isSafeInteger(n) || n < 0) throw invalid('offset() needs a non-negative integer');
    return this.next({ offset: n });
  }

  private cursor(args: CursorArg[], inclusive: boolean): Cursor {
    if (args.length === 1 && args[0] instanceof DocumentSnapshot) {
      const snap = args[0];
      if (!snap.exists) throw invalid('Cannot use a missing document as a query cursor');
      const data = snap.data();
      const values = effectiveOrders(this.spec).map(o =>
        isIdField(o.segments) ? snap.id : (readPath(data, o.segments) ?? null));
      return { values, inclusive };
    }
    return { values: args, inclusive };
  }

  startAt(...args: CursorArg[]): Query<T> { return this.next({ startCursor: this.cursor(args, true) }); }
  startAfter(...args: CursorArg[]): Query<T> { return this.next({ startCursor: this.cursor(args, false) }); }
  endAt(...args: CursorArg[]): Query<T> { return this.next({ endCursor: this.cursor(args, true) }); }
  endBefore(...args: CursorArg[]): Query<T> { return this.next({ endCursor: this.cursor(args, false) }); }

  count(): AggregateQuery<T> { return new AggregateQuery<T>(this); }

  get(): Promise<QuerySnapshot<T>> { return this.firestore.runQuery(this, null); }

  /** Streams matching documents, reading 1,000 at a time. */
  stream(): Readable {
    return Readable.from(streamPages(this, 1000), { objectMode: true });
  }
}

async function* streamPages<T>(base: Query<T>, pageSize: number): AsyncGenerator<QueryDocumentSnapshot<T>> {
  const spec = base.querySpec;
  if (spec.limit !== undefined || spec.offset !== undefined || spec.startCursor || spec.endCursor) {
    yield* (await base.get()).docs;
    return;
  }
  let page = base.limit(pageSize);
  for (;;) {
    const snap = await page.get();
    yield* snap.docs;
    if (snap.size < pageSize) return;
    page = base.limit(pageSize).startAfter(snap.docs[snap.size - 1]);
  }
}

export class CollectionReference<T = DocumentData> extends Query<T> {
  constructor(firestore: Firestore, readonly id: string) {
    super(firestore, id);
  }
  get path(): string { return this.id; }
  get parent(): null { return null; }
  doc(id?: string): DocumentReference<T> {
    if (id === undefined) return new DocumentReference<T>(this.firestore, this.id, autoId());
    if (typeof id !== 'string' || !id || id.includes('/')) {
      throw invalid(`Invalid document id "${String(id)}" in ${this.id} (sub-collections are not supported)`);
    }
    return new DocumentReference<T>(this.firestore, this.id, id);
  }
  async add(data: DocumentData): Promise<DocumentReference<T>> {
    const ref = this.doc();
    await ref.create(data);
    return ref;
  }
}

export class DocumentReference<T = DocumentData> {
  constructor(readonly firestore: Firestore, readonly collectionId: string, readonly id: string) {}
  get path(): string { return `${this.collectionId}/${this.id}`; }
  get parent(): CollectionReference<T> { return new CollectionReference<T>(this.firestore, this.collectionId); }
  collection(name: string): never {
    throw invalid(`Sub-collection "${this.path}/${name}" is not supported; use a top-level collection with workspaceId`);
  }
  isEqual(other: DocumentReference<T>): boolean {
    return other instanceof DocumentReference && other.path === this.path;
  }
  async get(): Promise<DocumentSnapshot<T>> {
    const [snap] = await this.firestore.readDocs([this], null);
    return snap;
  }
  set(data: DocumentData, options?: SetOptions): Promise<WriteResult> {
    return this.firestore.applyWrites([buildSet(this, data, options)]).then(r => r[0]);
  }
  update(dataOrField: DocumentData | string | FieldPath, ...more: unknown[]): Promise<WriteResult> {
    return this.firestore.applyWrites([buildUpdate(this, dataOrField, more)]).then(r => r[0]);
  }
  create(data: DocumentData): Promise<WriteResult> {
    return this.firestore.applyWrites([buildCreate(this, data)]).then(r => r[0]);
  }
  delete(precondition?: Precondition): Promise<WriteResult> {
    return this.firestore.applyWrites([buildDelete(this, precondition)]).then(r => r[0]);
  }
}

const AUTO_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 20-character random id, like Firestore's auto ids. */
export function autoId(): string {
  let id = '';
  while (id.length < 20) {
    for (const byte of crypto.randomBytes(40)) {
      // 62 * 4 = 248: reject the top bytes so every character is equally likely
      if (byte < 248 && id.length < 20) id += AUTO_ID_CHARS[byte % 62];
    }
  }
  return id;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

interface WriteOp {
  ref: RefLike;
  kind: 'set' | 'update' | 'create' | 'delete';
  sql: string;
  params: unknown[];
  mustExist?: boolean;
}

function toFieldMap(dataOrField: DocumentData | string | FieldPath, more: unknown[]): Record<string, unknown> {
  if (typeof dataOrField === 'string' || dataOrField instanceof FieldPath) {
    if (more.length % 2 !== 1) throw invalid('update(field, value, ...) needs field/value pairs');
    const out: Record<string, unknown> = {};
    const pairs: unknown[] = [dataOrField, ...more];
    for (let i = 0; i < pairs.length; i += 2) {
      const f = pairs[i];
      if (typeof f !== 'string' && !(f instanceof FieldPath)) throw invalid('update() field names must be strings');
      out[toSegments(f).join('.')] = pairs[i + 1];
    }
    return out;
  }
  if (!isPlainObject(dataOrField)) throw invalid('update() needs an object of field paths');
  return dataOrField;
}

function patchParams(patch: Patch): unknown[] {
  return [
    JSON.stringify(patch.unset.length ? patch.unset : []),
    JSON.stringify(patch.inc),
    JSON.stringify(patch.union),
    JSON.stringify(patch.remove),
  ];
}

const APPLY = (doc: string, set: string) =>
  `public.lf_apply_patch(${doc}, ${set}, array(select jsonb_array_elements_text($3::jsonb)), $4::jsonb, $5::jsonb, $6::jsonb)`;

function buildSet(ref: RefLike, data: DocumentData, options?: SetOptions): WriteOp {
  if (!isPlainObject(data)) throw invalid(`set() on ${ref.path} needs an object`);
  const patch = splitWrite(data, new Date().toISOString());
  const table = quoteIdent(ref.collectionId);
  const transforms = hasTransforms(patch);
  const fresh = transforms ? APPLY('$2::jsonb', `'{}'::jsonb`) : '$2::jsonb';
  const merged = options?.merge
    ? (transforms ? APPLY('public.lf_deep_merge(t.data, $2::jsonb)', `'{}'::jsonb`) : 'public.lf_deep_merge(t.data, $2::jsonb)')
    : 'excluded.data';
  const sql = `insert into public.${table} as t (id, data) values ($1, ${fresh}) on conflict (id) do update set data = ${merged}`;
  const params = transforms ? [ref.id, JSON.stringify(patch.data), ...patchParams(patch)] : [ref.id, JSON.stringify(patch.data)];
  return { ref, kind: 'set', sql, params };
}

function buildUpdate(ref: RefLike, dataOrField: DocumentData | string | FieldPath, more: unknown[]): WriteOp {
  const fields = toFieldMap(dataOrField, more);
  if (Object.keys(fields).length === 0) throw invalid(`update() on ${ref.path} needs at least one field`);
  for (const key of Object.keys(fields)) toSegments(key);
  const patch = splitWrite(fields, new Date().toISOString());
  const table = quoteIdent(ref.collectionId);
  const sql = `update public.${table} set data = ${APPLY('data', '$2::jsonb')} where id = $1`;
  return { ref, kind: 'update', sql, params: [ref.id, JSON.stringify(patch.data), ...patchParams(patch)], mustExist: true };
}

function buildCreate(ref: RefLike, data: DocumentData): WriteOp {
  if (!isPlainObject(data)) throw invalid(`create() on ${ref.path} needs an object`);
  const patch = splitWrite(data, new Date().toISOString());
  const table = quoteIdent(ref.collectionId);
  if (hasTransforms(patch)) {
    const sql = `insert into public.${table} (id, data) values ($1, ${APPLY('$2::jsonb', `'{}'::jsonb`)})`;
    return { ref, kind: 'create', sql, params: [ref.id, JSON.stringify(patch.data), ...patchParams(patch)] };
  }
  return { ref, kind: 'create', sql: `insert into public.${table} (id, data) values ($1, $2::jsonb)`, params: [ref.id, JSON.stringify(patch.data)] };
}

function buildDelete(ref: RefLike, precondition?: Precondition): WriteOp {
  const table = quoteIdent(ref.collectionId);
  return { ref, kind: 'delete', sql: `delete from public.${table} where id = $1`, params: [ref.id], mustExist: precondition?.exists === true };
}

// ---------------------------------------------------------------------------
// Batches and transactions
// ---------------------------------------------------------------------------

export class WriteBatch {
  private readonly ops: WriteOp[] = [];
  private committed = false;
  constructor(private readonly firestore: Firestore) {}
  set<T>(ref: DocumentReference<T>, data: DocumentData, options?: SetOptions): WriteBatch {
    this.ops.push(buildSet(ref, data, options));
    return this;
  }
  update<T>(ref: DocumentReference<T>, dataOrField: DocumentData | string | FieldPath, ...more: unknown[]): WriteBatch {
    this.ops.push(buildUpdate(ref, dataOrField, more));
    return this;
  }
  create<T>(ref: DocumentReference<T>, data: DocumentData): WriteBatch {
    this.ops.push(buildCreate(ref, data));
    return this;
  }
  delete<T>(ref: DocumentReference<T>, precondition?: Precondition): WriteBatch {
    this.ops.push(buildDelete(ref, precondition));
    return this;
  }
  async commit(): Promise<WriteResult[]> {
    if (this.committed) throw new FirestoreError(9, 'This batch has already been committed');
    this.committed = true;
    return this.firestore.applyWrites(this.ops);
  }
}

interface TxState { failure: unknown }

export class Transaction {
  private readonly ops: WriteOp[] = [];
  constructor(
    private readonly firestore: Firestore,
    private readonly runner: Runner,
    private readonly state: TxState,
  ) {}

  get<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>>;
  get<T = DocumentData>(query: Query<T>): Promise<QuerySnapshot<T>>;
  async get<T = DocumentData>(target: DocumentReference<T> | Query<T>): Promise<DocumentSnapshot<T> | QuerySnapshot<T>> {
    if (this.ops.length > 0) throw invalid('Firestore transactions require all reads to be executed before all writes');
    if (target instanceof DocumentReference) {
      const [snap] = await this.firestore.readDocs([target], this.tx());
      return snap;
    }
    return this.firestore.runQuery(target, this.tx());
  }

  async getAll<T = DocumentData>(...refs: DocumentReference<T>[]): Promise<DocumentSnapshot<T>[]> {
    if (this.ops.length > 0) throw invalid('Firestore transactions require all reads to be executed before all writes');
    return this.firestore.readDocs(refs.filter(r => r instanceof DocumentReference), this.tx());
  }

  set<T>(ref: DocumentReference<T>, data: DocumentData, options?: SetOptions): Transaction {
    this.ops.push(buildSet(ref, data, options));
    return this;
  }
  update<T>(ref: DocumentReference<T>, dataOrField: DocumentData | string | FieldPath, ...more: unknown[]): Transaction {
    this.ops.push(buildUpdate(ref, dataOrField, more));
    return this;
  }
  create<T>(ref: DocumentReference<T>, data: DocumentData): Transaction {
    this.ops.push(buildCreate(ref, data));
    return this;
  }
  delete<T>(ref: DocumentReference<T>, precondition?: Precondition): Transaction {
    this.ops.push(buildDelete(ref, precondition));
    return this;
  }

  private tx(): { runner: Runner; state: TxState } {
    return { runner: this.runner, state: this.state };
  }

  /** @internal Applies the buffered writes (called by runTransaction before COMMIT). */
  async flush(): Promise<void> {
    await this.firestore.executeOps(this.ops, this.runner, this.state);
  }
}

export interface TransactionOptions { maxAttempts?: number; readOnly?: boolean }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Connection settings
// ---------------------------------------------------------------------------

export interface FirestoreSettings {
  /** Postgres connection string. Default: DATABASE_URL, then POSTGRES_URL, then SUPABASE_DB_URL. */
  connectionString?: string;
  /** An existing pool (tests). */
  pool?: pg.Pool;
  /** Maximum connections in the pool. Default: PG_POOL_MAX or 10. */
  max?: number;
}

function isLocalHost(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return ['localhost', '127.0.0.1', '::1', ''].includes(host) || (url.searchParams.get('host') || '').startsWith('/');
}

/** Startup warning when a remote database is reached without certificate verification. */
export const DATABASE_CA_WARNING = '[Database] DATABASE_CA_CERT is not set: the connection to the remote database is '
  + 'encrypted but the server certificate is NOT verified. Set DATABASE_CA_CERT to the database CA certificate '
  + '(Supabase dashboard > Database > SSL) to verify it.';

/** Default pool size on serverless runtimes (proven safe floor >= 5 for nested tx reads + 12-way fan-out). */
export const SERVERLESS_DEFAULT_POOL_MAX = 5;
/** Default pool size on long-lived standalone Node servers. */
export const STANDALONE_DEFAULT_POOL_MAX = 10;

let caWarningLogged = false;
const warnOnceAtStartup = (message: string): void => {
  if (caWarningLogged) return;
  caWarningLogged = true;
  console.warn(message);
};

/** Resolves the effective pg.Pool max connections from explicit settings, PG_POOL_MAX, or runtime defaults. */
function resolvePoolMax(settingsMax: number | undefined, env: NodeJS.ProcessEnv, isServerless: boolean): number {
  if (typeof settingsMax === 'number' && Number.isFinite(settingsMax) && settingsMax > 0) {
    return Math.floor(settingsMax);
  }
  const parsedEnvMax = Number.parseInt(env.PG_POOL_MAX ?? '', 10);
  if (Number.isFinite(parsedEnvMax) && parsedEnvMax > 0) {
    return parsedEnvMax;
  }
  return isServerless ? SERVERLESS_DEFAULT_POOL_MAX : STANDALONE_DEFAULT_POOL_MAX;
}

/** Builds a pg.PoolConfig from explicit settings and environment variables with TLS and serverless sizing. */
export function poolConfigFromEnv(
  settings: FirestoreSettings = {},
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = warnOnceAtStartup,
): pg.PoolConfig {
  const raw = settings.connectionString
    || env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_DB_URL;
  if (!raw) {
    throw new FirestoreError(14, 'No database configured. Set DATABASE_URL (or POSTGRES_URL) to the Supabase Postgres connection string.');
  }
  const url = new URL(raw);
  const local = isLocalHost(url);
  // TLS is configured below; libpq-style URL flags would override it inside pg.
  for (const param of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'supa', 'pgbouncer']) {
    url.searchParams.delete(param);
  }
  const ca = env.DATABASE_CA_CERT?.replace(/\\n/g, '\n').trim();
  let ssl: pg.PoolConfig['ssl'];
  if (!local) {
    // Supabase signs its database certificates with its own root CA. With DATABASE_CA_CERT
    // (the CA from the Supabase dashboard) the certificate is verified; without it the
    // connection is still encrypted but the server is not authenticated, so say so (AUD-20).
    if (ca) {
      ssl = { ca, rejectUnauthorized: true };
    } else {
      ssl = { rejectUnauthorized: false };
      warn(DATABASE_CA_WARNING);
    }
  }
  const isServerless = Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME);
  return {
    connectionString: url.toString(),
    ssl,
    max: resolvePoolMax(settings.max, env, isServerless),
    idleTimeoutMillis: isServerless ? 5_000 : 10_000,
    connectionTimeoutMillis: 15_000,
    ...(isServerless ? { allowExitOnIdle: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------

type TxContext = { runner: Runner; state: TxState } | null;

export class Firestore {
  private poolInstance: pg.Pool | null = null;
  private tableList: Promise<Set<string>> | null = null;
  private readonly warnedCollections = new Set<string>();

  constructor(private readonly settingsValue: FirestoreSettings = {}) {
    if (settingsValue.pool) {
      this.poolInstance = settingsValue.pool;
      timePoolQueries(settingsValue.pool as never);
    }
  }

  /** firebase-admin compatibility; connection settings come from FirestoreSettings. */
  settings(_settings: unknown): void {}

  get pool(): pg.Pool {
    if (!this.poolInstance) {
      this.poolInstance = new pg.Pool(poolConfigFromEnv(this.settingsValue));
      timePoolQueries(this.poolInstance as never); // D-22: slow queries are logged by shape
      this.poolInstance.on('error', err => {
        console.error('[Database] Idle connection error:', err.message);
      });
    }
    return this.poolInstance;
  }

  async terminate(): Promise<void> {
    const pool = this.poolInstance;
    this.poolInstance = null;
    this.tableList = null;
    if (pool && !this.settingsValue.pool) await pool.end();
  }

  collection(path: string): CollectionReference {
    if (typeof path !== 'string' || !COLLECTION_ID.test(path)) {
      throw invalid(`Invalid collection "${String(path)}" (only top-level collections are supported)`);
    }
    return new CollectionReference(this, path);
  }

  /** Every collection is top-level here, so a collection group is the collection itself. */
  collectionGroup(collectionId: string): Query {
    return this.collection(collectionId);
  }

  doc(path: string): DocumentReference {
    const parts = String(path).split('/');
    if (parts.length !== 2) throw invalid(`Invalid document path "${path}" (expected "collection/id")`);
    return this.collection(parts[0]).doc(parts[1]);
  }

  batch(): WriteBatch {
    return new WriteBatch(this);
  }

  async getAll(...args: (DocumentReference | { fieldMask?: unknown })[]): Promise<DocumentSnapshot[]> {
    const refs = args.filter((a): a is DocumentReference => a instanceof DocumentReference);
    return this.readDocs(refs, null);
  }

  async runTransaction<R>(fn: (t: Transaction) => Promise<R>, options: TransactionOptions = {}): Promise<R> {
    const maxAttempts = Math.max(1, options.maxAttempts ?? 8);
    for (let attempt = 1; ; attempt++) {
      const client = await this.connect();
      let broken: Error | undefined;
      try {
        await client.query(options.readOnly
          ? 'begin isolation level serializable read only'
          : 'begin isolation level serializable');
        const state: TxState = { failure: undefined };
        const t = new Transaction(this, client, state);
        const result = await fn(t);
        // A statement that failed inside the callback (and was caught there) aborted the
        // database transaction; COMMIT would silently roll back, so surface the failure.
        if (state.failure !== undefined) throw state.failure;
        await t.flush();
        await client.query('commit');
        return result;
      } catch (err) {
        try {
          await client.query('rollback');
        } catch (rollbackErr) {
          broken = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
        }
        if (isRetryable(err) && attempt < maxAttempts) {
          await sleep(Math.min(1000, 10 * 2 ** attempt) * (0.5 + Math.random()));
          continue;
        }
        throw translateError(err, 'Transaction');
      } finally {
        client.release(broken);
      }
    }
  }

  // ----- internals shared by references, queries, batches and transactions -----

  private async connect(): Promise<pg.PoolClient> {
    try {
      return await this.pool.connect();
    } catch (err) {
      throw translateError(err, 'Connecting to the database');
    }
  }

  /** @internal Names of the document tables (from lf_rules, one row per collection). */
  async tables(runner: Runner = this.pool, state: TxState | null = null): Promise<Set<string>> {
    if (!this.tableList) {
      const usedTxRunner = runner !== this.pool;
      this.tableList = runner
        .query<{ table_name: string }>('select table_name from public.lf_rules')
        .then(r => new Set(r.rows.map(row => row.table_name)))
        .catch(err => {
          this.tableList = null;
          if (usedTxRunner && state && state.failure === undefined) {
            state.failure = err;
          }
          throw translateError(err, 'Loading collections');
        });
    }
    return this.tableList;
  }

  /** Selects the active transaction runner when healthy, falling back to the shared pool. */
  private runnerForTables(tx: TxContext): { runner: Runner; state: TxState | null } {
    if (tx && tx.state.failure === undefined) {
      return { runner: tx.runner, state: tx.state };
    }
    return { runner: this.pool, state: null };
  }

  /** Checks whether a collection has a backing document table, logging a one-time warning when absent. */
  private async hasTable(collectionId: string, tx: TxContext = null): Promise<boolean> {
    const { runner, state } = this.runnerForTables(tx);
    const known = (await this.tables(runner, state)).has(collectionId);
    if (!known && !this.warnedCollections.has(collectionId)) {
      this.warnedCollections.add(collectionId);
      console.warn(`[Database] Collection "${collectionId}" has no table; reads return nothing.`);
    }
    return known;
  }

  private async run<R extends pg.QueryResultRow>(tx: TxContext, sql: string, params: unknown[], context: string): Promise<pg.QueryResult<R>> {
    try {
      return await (tx ? tx.runner : this.pool).query<R>(sql, params);
    } catch (err) {
      if (tx && tx.state.failure === undefined) tx.state.failure = err;
      throw translateError(err, context);
    }
  }

  /** @internal */
  async readDocs<T>(refs: DocumentReference<T>[], tx: TxContext): Promise<DocumentSnapshot<T>[]> {
    const readTime = Timestamp.now();
    const byCollection = new Map<string, string[]>();
    for (const ref of refs) {
      const ids = byCollection.get(ref.collectionId) || [];
      ids.push(ref.id);
      byCollection.set(ref.collectionId, ids);
    }
    const rows = new Map<string, DocRow>();
    for (const [collectionId, ids] of byCollection) {
      if (!(await this.hasTable(collectionId, tx))) continue;
      const unique = Array.from(new Set(ids));
      const sql = unique.length === 1
        ? `select id, data::text as data, created_at, updated_at from public.${quoteIdent(collectionId)} where id = $1`
        : `select id, data::text as data, created_at, updated_at from public.${quoteIdent(collectionId)} where id = any($1::text[])`;
      const result = await this.run<DocRow>(tx, sql, [unique.length === 1 ? unique[0] : unique], `Reading ${collectionId}`);
      for (const row of result.rows) rows.set(`${collectionId}/${row.id}`, row);
    }
    return refs.map(ref => snapshotFromRow(ref, rows.get(ref.path), readTime));
  }

  /** @internal */
  async runQuery<T>(query: Query<T>, tx: TxContext): Promise<QuerySnapshot<T>> {
    const readTime = Timestamp.now();
    if (!(await this.hasTable(query.collectionId, tx))) return new QuerySnapshot<T>(query, [], readTime);
    const spec = query.querySpec;
    const p = new Params();
    const sql = `select id, data::text as data, created_at, updated_at from public.${quoteIdent(query.collectionId)}`
      + compileWhere(spec, p) + compileOrder(spec) + compileLimit(spec);
    const result = await this.run<DocRow>(tx, sql, p.values, `Querying ${query.collectionId}`);
    const collection = new CollectionReference<T>(this, query.collectionId);
    const docs = result.rows.map(row => new QueryDocumentSnapshot<T>(
      collection.doc(row.id), row.data, Timestamp.fromDate(row.created_at), Timestamp.fromDate(row.updated_at), readTime));
    return new QuerySnapshot<T>(query, docs, readTime);
  }

  /** @internal */
  async countQuery<T>(query: Query<T>, tx: TxContext): Promise<number> {
    if (!(await this.hasTable(query.collectionId, tx))) return 0;
    const spec = query.querySpec;
    const p = new Params();
    const inner = `select 1 from public.${quoteIdent(query.collectionId)}` + compileWhere(spec, p)
      + (spec.limit !== undefined || spec.offset !== undefined ? compileOrder(spec) + compileLimit(spec) : '');
    const result = await this.run<{ count: string }>(tx, `select count(*) as count from (${inner}) s`, p.values, `Counting ${query.collectionId}`);
    return Number(result.rows[0]?.count || 0);
  }

  /** @internal Runs writes as one database transaction (a batch, or a single write). */
  async applyWrites(ops: WriteOp[]): Promise<WriteResult[]> {
    if (ops.length === 0) return [];
    if (ops.length === 1) {
      await this.executeOps(ops, this.pool, null);
      return [{ writeTime: Timestamp.now() }];
    }
    const client = await this.connect();
    let broken: Error | undefined;
    try {
      await client.query('begin');
      await this.executeOps(ops, client, null);
      await client.query('commit');
    } catch (err) {
      try {
        await client.query('rollback');
      } catch (rollbackErr) {
        broken = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
      }
      throw translateError(err, 'Batch write');
    } finally {
      client.release(broken);
    }
    const writeTime = Timestamp.now();
    return ops.map(() => ({ writeTime }));
  }

  /** @internal */
  async executeOps(ops: WriteOp[], runner: Runner, state: TxState | null): Promise<void> {
    const tx: TxContext = state ? { runner, state } : null;
    const useTxRunner = !state || state.failure === undefined;
    const tableRunner = useTxRunner ? runner : this.pool;
    const tableState = useTxRunner ? state : null;
    for (const op of ops) {
      if (!(await this.tables(tableRunner, tableState)).has(op.ref.collectionId)) {
        throw invalid(`Unknown collection "${op.ref.collectionId}": add a table for it in supabase/migrations`);
      }
      let result: pg.QueryResult;
      try {
        result = tx ? await this.run(tx, op.sql, op.params, `Writing ${op.ref.path}`) : await runner.query(op.sql, op.params);
      } catch (err) {
        const translated = translateError(err, `Writing ${op.ref.path}`);
        if (op.kind === 'create' && translated instanceof FirestoreError && translated.code === 6) {
          throw new FirestoreError(6, `Document already exists: ${op.ref.path}`, { cause: err });
        }
        throw translated;
      }
      if (op.mustExist && result.rowCount === 0) {
        throw new FirestoreError(5, `No document to ${op.kind}: ${op.ref.path}`);
      }
    }
  }
}
