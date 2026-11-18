import express from 'express';
import type { Request, Response } from 'express';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import type { RequestUser } from '../../server/auth/requestUser';
import type { Firestore } from '../../server/db/firestore';
import type { AnyCommandDefinition, CommandDefinition, CommandRole } from '../../server/commands/types';
import type { CommandRunnerDependencies } from '../../server/utils/commandExecutor';
import { FieldValue } from '../../server/db/firestore';
import { CommandRegistry } from '../../server/commands/registry';
import { createCommandRouter } from '../../server/routes/commandRoutes';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The memory database stores a server timestamp as a plain ISO string, as the Postgres layer does. */
function plain(value: unknown): unknown {
  if (value instanceof FieldValue) return value.kind === 'serverTimestamp' ? new Date().toISOString() : null;
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, plain(inner)]));
  }
  return value;
}

/**
 * A write's fields as stored: a plain object replaces the value it names (as this harness always
 * wrote), `FieldValue.increment` adds to it, and a server timestamp becomes an ISO string.
 */
function merge(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value instanceof FieldValue && value.kind === 'increment') {
      merged[key] = Number(merged[key] || 0) + Number(value.operand);
    } else if (value instanceof FieldValue && value.kind === 'delete') {
      delete merged[key];
    } else {
      merged[key] = plain(value);
    }
  }
  return merged;
}

class MemorySnapshot {
  readonly id: string;
  /** The document this snapshot came from: services mark entries through `snap.ref`, as they do in production. */
  readonly ref: MemoryRef | undefined;
  constructor(private readonly value: Record<string, unknown> | undefined, id: string, ref?: MemoryRef) { this.id = id; this.ref = ref; }
  get exists(): boolean { return this.value !== undefined; }
  data(): Record<string, unknown> | undefined { return this.value ? clone(this.value) : undefined; }
}

type StoredWrite = { method: 'set' | 'create' | 'update' | 'delete'; path: string; data?: Record<string, unknown> };

export class MemoryDb {
  private readonly documents = new Map<string, Record<string, unknown>>();
  private sequence = 0;
  directWriteCount = 0;
  beforeTransaction?: () => void;

  seed(path: string, data: Record<string, unknown>): void { this.documents.set(path, clone(data)); }
  read(path: string): Record<string, unknown> | undefined {
    const value = this.documents.get(path);
    return value ? clone(value) : undefined;
  }
  entries(collection: string): Array<{ id: string; data: Record<string, unknown> }> {
    const prefix = `${collection}/`;
    return [...this.documents.entries()].filter(([path]) => path.startsWith(prefix))
      .map(([path, data]) => ({ id: path.slice(prefix.length), data: clone(data) }));
  }

  /** `getAll` over several references, as the Postgres layer offers it (account validation reads accounts so). */
  async getAll(...refs: MemoryRef[]): Promise<MemorySnapshot[]> {
    return Promise.all(refs.map(ref => ref.get()));
  }

  collection(name: string): MemoryCollection { return new MemoryCollection(this, name); }

  async runTransaction<T>(handler: (tx: MemoryTransaction) => Promise<T>): Promise<T> {
    this.beforeTransaction?.();
    const tx = new MemoryTransaction(this);
    const result = await handler(tx);
    tx.commit();
    return result;
  }

  recordDirectWrite(write: StoredWrite): void {
    this.directWriteCount++;
    this.apply(write);
  }

  apply(write: StoredWrite): void {
    const current = this.documents.get(write.path);
    if (write.method === 'delete') this.documents.delete(write.path);
    else if (write.method === 'create') {
      if (current) throw Object.assign(new Error(`ALREADY_EXISTS: ${write.path}`), { code: 6 });
      this.documents.set(write.path, clone(write.data || {}));
    } else if (write.method === 'update') {
      if (!current) throw Object.assign(new Error(`NOT_FOUND: ${write.path}`), { code: 5 });
      this.documents.set(write.path, merge(current, write.data || {}));
    } else {
      this.documents.set(write.path, merge({}, write.data || {}));
    }
  }
}

export class ReplayOnRetryMemoryDb extends MemoryDb {
  replayRecord?: { key: string; data: Record<string, unknown> };

  override async runTransaction<T>(handler: (tx: MemoryTransaction) => Promise<T>): Promise<T> {
    if (!this.replayRecord) return super.runTransaction(handler);
    const record = this.replayRecord;
    this.replayRecord = undefined;
    await handler(new MemoryTransaction(this)); // a concurrent transaction wins; discard this attempt's writes
    this.seed(`idempotencyKeys/${record.key}`, record.data);
    const retry = new MemoryTransaction(this);
    const result = await handler(retry);
    retry.commit();
    return result;
  }
}

class MemoryRef {
  readonly path: string;
  constructor(private readonly db: MemoryDb, readonly collectionName: string, readonly id: string) { this.path = `${collectionName}/${id}`; }
  async get(): Promise<MemorySnapshot> { return new MemorySnapshot(this.db.read(this.path), this.id, this); }
  async set(data: Record<string, unknown>): Promise<void> { this.db.recordDirectWrite({ method: 'set', path: this.path, data }); }
  async create(data: Record<string, unknown>): Promise<void> { this.db.recordDirectWrite({ method: 'create', path: this.path, data }); }
  async update(data: Record<string, unknown>): Promise<void> { this.db.recordDirectWrite({ method: 'update', path: this.path, data }); }
  async delete(): Promise<void> { this.db.recordDirectWrite({ method: 'delete', path: this.path }); }
}

class MemoryQuery {
  private readonly filters: Array<{ field: string; op: string; value: unknown }>;
  constructor(
    private readonly db: MemoryDb,
    private readonly collectionName: string,
    filters: Array<{ field: string; op: string; value: unknown }> = [],
    /** `limit(1)` is how a command asks "is there any of these?" without reading the collection */
    private readonly max?: number,
  ) { this.filters = filters; }
  where(field: string, op: string, value: unknown): MemoryQuery { return new MemoryQuery(this.db, this.collectionName, [...this.filters, { field, op, value }], this.max); }
  limit(count: number): MemoryQuery { return new MemoryQuery(this.db, this.collectionName, this.filters, count); }
  async get(): Promise<{ docs: MemorySnapshot[]; size: number; empty: boolean }> {
    const matches = (row: Record<string, unknown>, filter: { field: string; op: string; value: unknown }) => {
      const current = row[filter.field];
      if (filter.op === 'array-contains') return Array.isArray(current) && current.includes(filter.value);
      return current === filter.value;
    };
    const docs = this.db.entries(this.collectionName).filter(row => this.filters.every(filter => matches(row.data, filter)))
      .slice(0, this.max ?? undefined)
      // every snapshot carries the reference it came from, as production snapshots do: a service deletes
      // `snap.ref` (`tx.delete(doc.ref)`), and without it a bulk delete fails only in the test harness
      .map(row => new MemorySnapshot(row.data, row.id, new MemoryRef(this.db, this.collectionName, row.id)));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class MemoryCollection {
  constructor(private readonly db: MemoryDb, readonly name: string) {}
  doc(id?: string): MemoryRef {
    const nextId = id || `memory-${++(this.db as unknown as { sequence: number }).sequence}`;
    return new MemoryRef(this.db, this.name, nextId);
  }
  where(field: string, op: string, value: unknown): MemoryQuery { return new MemoryQuery(this.db, this.name).where(field, op, value); }
}

class MemoryTransaction {
  private readonly writes = new Map<string, StoredWrite>();
  constructor(private readonly db: MemoryDb) {}
  async get(ref: unknown): Promise<unknown> {
    // the same rule the real transaction enforces (db/pgFirestore.ts): a read once a write is queued
    // throws. Without it a handler that reads after writing passes here and fails in production, which
    // is exactly how the first draft of transaction.reset shipped broken.
    if (this.writes.size > 0) throw new Error('Firestore transactions require all reads to be executed before all writes');
    if (ref instanceof MemoryQuery) return ref.get();
    const path = String((ref as { path?: unknown }).path || '');
    const pending = this.writes.get(path);
    const source = ref instanceof MemoryRef ? ref : undefined;
    if (pending) return new MemorySnapshot(pending.method === 'delete' ? undefined : pending.data, path.split('/').at(-1) || '', source);
    return new MemorySnapshot(this.db.read(path), path.split('/').at(-1) || '', source);
  }
  async getAll(...refs: unknown[]): Promise<unknown[]> { return Promise.all(refs.map(ref => this.get(ref))); }
  set(ref: unknown, data: Record<string, unknown>): this { this.stage('set', ref, data); return this; }
  create(ref: unknown, data: Record<string, unknown>): this { this.stage('create', ref, data); return this; }
  update(ref: unknown, data: Record<string, unknown>): this { this.stage('update', ref, data); return this; }
  delete(ref: unknown): this { this.stage('delete', ref); return this; }
  private stage(method: StoredWrite['method'], ref: unknown, data?: Record<string, unknown>): void {
    const path = String((ref as { path?: unknown }).path || '');
    // kept as written: a FieldValue.increment must reach the commit as itself, not as a plain object
    this.writes.set(path, { method, path, ...(data ? { data } : {}) });
  }
  commit(): void { for (const write of this.writes.values()) this.db.apply(write); }
}

export const owner: RequestUser = { uid: 'owner-1', email: 'owner@example.test', aal: 'aal2' };
export const workspaceId = 'ws-command-test';

export function seedWorkspace(db: MemoryDb, id = workspaceId, fields: Record<string, unknown> = {}): void {
  db.seed(`workspaces/${id}`, { uid: owner.uid, members: [owner.uid], currency: 'USD', ...fields });
}

export function fakeRequest(user: RequestUser, body: unknown, operationId?: string): Request {
  return {
    user,
    body,
    headers: operationId ? { 'idempotency-key': operationId } : {},
    params: {},
    query: {},
    method: 'POST',
    url: '/api/v1/commands/demo.record',
    originalUrl: '/api/v1/commands/demo.record',
  } as unknown as Request;
}

export function captureResponse(): { response: Response; status: number; body: unknown } {
  const captured: { status: number; body: unknown } = { status: 200, body: undefined };
  const response = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  } as unknown as Response;
  return { response, ...captured };
}

export type TestCounters = { runs: number; previews: number; afterCommit: number; audits: number };
export const testInput = z.object({ workspaceId: z.string(), value: z.string(), date: z.string().optional() }).strict();
export type TestResult = { saved: true; value: string };

export function recordingCommand(counters: TestCounters, name: `${string}.${string}` = 'demo.record', risk: 'normal' | 'high' = 'normal'): CommandDefinition<typeof testInput, TestResult> {
  return {
    name,
    input: testInput,
    roles: ['owner', 'accountant'] as const satisfies readonly CommandRole[],
    dated: 'date',
    async handler(ctx, tx, input) {
      counters.runs++;
      tx.set(ctx.db.collection('commandRecords').doc('last'), { workspaceId: ctx.workspaceId, value: input.value });
      ctx.afterCommit(() => { counters.afterCommit++; return { delivered: true }; });
      return { saved: true, value: input.value };
    },
    async preview(_ctx, input) { counters.previews++; return { title: `Record ${input.value}`, lines: [input.value] }; },
    audit(_input, result) { return { action: 'COMMAND_TEST', entityType: 'commandRecord', entityId: 'last', description: `Recorded ${result.value}` }; },
    inverse() { return null; },
    risk,
    describe: {
      sentence: 'Record a value for the test workspace, and do not use it for financial postings.',
      example: { workspaceId, value: 'example' },
      refusals: [{ code: 'INVALID_INPUT', when: 'Input is malformed.', next: 'Correct it.' }],
    },
  };
}

export function runnerDependencies(db: MemoryDb, counters?: TestCounters): CommandRunnerDependencies {
  return {
    getDb: () => db as unknown as Firestore,
    auditWriter: async () => { if (counters) counters.audits++; return 'audit-test'; },
    checkCapacity: async () => {},
  };
}

export const invocationInput = (value = 'first') => ({ workspaceId, value });

export interface CommandHarness {
  db: MemoryDb;
  counters: TestCounters;
  registry: CommandRegistry;
  dependencies: CommandRunnerDependencies;
  /** run a registered command as `uid`; `workspace` is the one named in the body (the seeded one by default) */
  run(uid: string, name: string, input: Record<string, unknown>, workspace?: string): Promise<globalThis.Response>;
  /** ask for a preview: it writes nothing, and the workspace is always the seeded one */
  preview(uid: string, name: string, input: Record<string, unknown>): Promise<globalThis.Response>;
  close(): Promise<void>;
}

/**
 * The command router over HTTP for a test: a memory database seeded by the caller, the runner's
 * dependencies and counters, the commands registered, and `run`/`preview` that ask the same router a
 * route asks. The tests that watch a batch of commands share this rather than rebuild the server.
 */
export async function commandHarness(options: {
  commands: AnyCommandDefinition[];
  /** the workspace the seeded data belongs to; `run` names it unless told otherwise */
  workspaceId: string;
  seed(db: MemoryDb): void;
}): Promise<CommandHarness> {
  const db = new MemoryDb();
  options.seed(db);
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const dependencies = runnerDependencies(db, counters);
  const registry = new CommandRegistry();
  for (const command of options.commands) registry.register(command);

  const app = express();
  // the API does not announce what it is built with (helmet does this in server.ts); the harness
  // answers as the server does
  app.disable('x-powered-by');
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.header('x-test-uid');
    if (uid) (req as unknown as { user: RequestUser }).user = { uid, email: `${uid}@example.test`, displayName: 'Test Person', aal: 'aal2' };
    next();
  });
  app.use('/api/v1/commands', createCommandRouter(registry, dependencies));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const run = (uid: string, name: string, input: Record<string, unknown>, workspace = options.workspaceId) => fetch(`${base}/api/v1/commands/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-uid': uid },
    body: JSON.stringify({ workspaceId: workspace, input }),
  });
  const preview = (uid: string, name: string, input: Record<string, unknown>) => fetch(`${base}/api/v1/commands/${name}/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-uid': uid },
    body: JSON.stringify({ workspaceId: options.workspaceId, input }),
  });

  return {
    db, counters, registry, dependencies, run, preview,
    async close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
