import type { Request, Response } from 'express';
import { z } from 'zod';
import type { RequestUser } from '../../server/auth/requestUser';
import type { Firestore } from '../../server/db/firestore';
import type { CommandDefinition, CommandRole } from '../../server/commands/types';
import type { CommandRunnerDependencies } from '../../server/utils/commandExecutor';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class MemorySnapshot {
  readonly id: string;
  constructor(private readonly value: Record<string, unknown> | undefined, id: string) { this.id = id; }
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
      this.documents.set(write.path, { ...current, ...clone(write.data || {}) });
    } else {
      this.documents.set(write.path, clone(write.data || {}));
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
  async get(): Promise<MemorySnapshot> { return new MemorySnapshot(this.db.read(this.path), this.id); }
  async set(data: Record<string, unknown>): Promise<void> { this.db.recordDirectWrite({ method: 'set', path: this.path, data }); }
  async create(data: Record<string, unknown>): Promise<void> { this.db.recordDirectWrite({ method: 'create', path: this.path, data }); }
  async update(data: Record<string, unknown>): Promise<void> { this.db.recordDirectWrite({ method: 'update', path: this.path, data }); }
  async delete(): Promise<void> { this.db.recordDirectWrite({ method: 'delete', path: this.path }); }
}

class MemoryQuery {
  private readonly filters: Array<{ field: string; value: unknown }>;
  constructor(private readonly db: MemoryDb, private readonly collectionName: string, filters: Array<{ field: string; value: unknown }> = []) { this.filters = filters; }
  where(field: string, _op: string, value: unknown): MemoryQuery { return new MemoryQuery(this.db, this.collectionName, [...this.filters, { field, value }]); }
  async get(): Promise<{ docs: MemorySnapshot[]; size: number; empty: boolean }> {
    const docs = this.db.entries(this.collectionName).filter(row => this.filters.every(filter => row.data[filter.field] === filter.value))
      .map(row => new MemorySnapshot(row.data, row.id));
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
    if (ref instanceof MemoryQuery) return ref.get();
    const path = String((ref as { path?: unknown }).path || '');
    const pending = this.writes.get(path);
    if (pending) return new MemorySnapshot(pending.method === 'delete' ? undefined : pending.data, path.split('/').at(-1) || '');
    return new MemorySnapshot(this.db.read(path), path.split('/').at(-1) || '');
  }
  async getAll(...refs: unknown[]): Promise<unknown[]> { return Promise.all(refs.map(ref => this.get(ref))); }
  set(ref: unknown, data: Record<string, unknown>): this { this.stage('set', ref, data); return this; }
  create(ref: unknown, data: Record<string, unknown>): this { this.stage('create', ref, data); return this; }
  update(ref: unknown, data: Record<string, unknown>): this { this.stage('update', ref, data); return this; }
  delete(ref: unknown): this { this.stage('delete', ref); return this; }
  private stage(method: StoredWrite['method'], ref: unknown, data?: Record<string, unknown>): void {
    const path = String((ref as { path?: unknown }).path || '');
    this.writes.set(path, { method, path, ...(data ? { data: clone(data) } : {}) });
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
