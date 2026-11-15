import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { RequestUser } from '../server/auth/requestUser';
import { requiredApiKeyScope } from '../server/auth/apiAuthenticate';
import { API_KEY_SCOPE_IDS, validateApiKeyScopes } from '../lib/apiScopes';
import { AVAILABLE_SCOPES } from '../components/platform/ApiHubShared';
import type { Firestore } from '../server/db/firestore';
import { CommandRegistry } from '../server/commands/registry';
import { createDefaultCommandRegistry } from '../server/commands/defaultRegistry';
import { customerCreateCommand, customerCreateInput, customerUpdateCommand, customerUpdateInput, warrantyUpdateCommand, warrantyUpdateInput } from '../server/commands/customers';
import { vendorCreateCommand, vendorCreateInput, vendorUpdateCommand, vendorUpdateInput } from '../server/commands/vendors';
import { paymentReceiveCommand, paymentReceiveInput } from '../server/commands/payments';
import {
  billCreateCommand,
  billCreateInput,
  creditNoteCreateCommand,
  creditNoteCreateInput,
  creditNoteUpdateInput,
  invoiceCreateCommand,
  invoiceCreateInput,
  invoiceDeleteInput,
  invoiceUpdateInput,
  vendorCreditCreateCommand,
  vendorCreditCreateInput,
  vendorCreditUpdateInput,
} from '../server/commands/documents';
import type { CommandDefinition, CommandRole } from '../server/commands/types';
import { createCommandRouter } from '../server/routes/commandRoutes';
import { executeCommand, previewCommand, type CommandRunnerDependencies } from '../server/utils/commandExecutor';
import { paymentRequestHash } from '../server/services/paymentService';
import { CREDIT_LIMIT_METADATA_KEY } from '../lib/customerCreditLimits';
import { deriveScopedOperationKey, requestPayloadHash } from '../server/utils/idempotency';
import { RMAS_METADATA_FIELD, WARRANTIES_METADATA_FIELD, warrantyRecordKey } from '../lib/warehouseRecords';
import { autoRuleCreateCommand, autoRuleCreateInput, autoRuleUpdateCommand, autoRuleUpdateInput, autoRuleGroupCommand, autoRuleGroupInput, autoRuleRecordHitsCommand, autoRuleRecordHitsInput, autoRuleDeleteCommand, autoRuleDeleteInput } from '../server/commands/autoRules';

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

class MemoryDb {
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

class ReplayOnRetryMemoryDb extends MemoryDb {
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

const owner: RequestUser = { uid: 'owner-1', email: 'owner@example.test', aal: 'aal2' };
const workspaceId = 'ws-command-test';

function seedWorkspace(db: MemoryDb, id = workspaceId, fields: Record<string, unknown> = {}): void {
  db.seed(`workspaces/${id}`, { uid: owner.uid, members: [owner.uid], currency: 'USD', ...fields });
}

function fakeRequest(user: RequestUser, body: unknown, operationId?: string): Request {
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

function captureResponse(): { response: Response; status: number; body: unknown } {
  const captured: { status: number; body: unknown } = { status: 200, body: undefined };
  const response = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  } as unknown as Response;
  return { response, ...captured };
}

type TestCounters = { runs: number; previews: number; afterCommit: number; audits: number };
const testInput = z.object({ workspaceId: z.string(), value: z.string(), date: z.string().optional() }).strict();
type TestResult = { saved: true; value: string };

function recordingCommand(counters: TestCounters, name: `${string}.${string}` = 'demo.record', risk: 'normal' | 'high' = 'normal'): CommandDefinition<typeof testInput, TestResult> {
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

function runnerDependencies(db: MemoryDb, counters?: TestCounters): CommandRunnerDependencies {
  return {
    getDb: () => db as unknown as Firestore,
    auditWriter: async () => { if (counters) counters.audits++; return 'audit-test'; },
    checkCapacity: async () => {},
  };
}

const invocationInput = (value = 'first') => ({ workspaceId, value });


test('the default registry is sorted and unique across the registered customer, ledger, payment, and document commands', () => {
  const registry = createDefaultCommandRegistry();
  assert.deepEqual(registry.names(), [
    'autorule.create', 'autorule.delete', 'autorule.group', 'autorule.recordhits', 'autorule.update',
    'bill.create', 'bill.delete', 'bill.update',
    'creditnote.create', 'creditnote.delete', 'creditnote.update',
    'customer.create', 'customer.update',
    'invoice.create', 'invoice.delete', 'invoice.update',
    'journal.create', 'payment.receive',
    'vendor.create', 'vendor.update',
    'vendorcredit.create', 'vendorcredit.delete', 'vendorcredit.update',
    'warranty.update',
  ]);
  assert.deepEqual(registry.areaNames(), ['autorule', 'bill', 'creditnote', 'customer', 'invoice', 'journal', 'payment', 'vendor', 'vendorcredit', 'warranty']);
  assert.equal(registry.get('payment.receive'), paymentReceiveCommand);
  assert.equal(registry.get('unknown.create'), undefined);
  for (const command of registry.list()) {
    const schema = z.toJSONSchema(command.input, { io: 'input', unrepresentable: 'any' });
    assert.equal(schema.type, 'object', `${command.name} exposes a JSON Schema object`);
  }
});

test('invoice.create and bill.create expose the existing document schemas and reject unsafe ids or incomplete bills', () => {
  const invoiceExample = invoiceCreateCommand.describe.example as { invoice: Record<string, unknown> };
  const billExample = billCreateCommand.describe.example as { bill: Record<string, unknown> };
  assert.equal(invoiceCreateCommand.name, 'invoice.create');
  assert.equal(billCreateCommand.name, 'bill.create');
  assert.deepEqual(invoiceCreateCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(billCreateCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.equal(invoiceCreateInput.safeParse(invoiceExample).success, true);
  assert.equal(billCreateInput.safeParse(billExample).success, true);
  assert.equal(invoiceCreateInput.safeParse({ invoice: { ...invoiceExample.invoice, id: 'bad/id' } }).success, false);
  const { dueDate: _dueDate, ...incompleteBill } = billExample.bill;
  assert.equal(billCreateInput.safeParse({ bill: incompleteBill }).success, false);
});

test('document CRUD commands publish valid examples and keep document ids and workspace scope out of update data', () => {
  const creditExample = creditNoteCreateCommand.describe.example as { creditNote: Record<string, unknown> };
  const vendorExample = vendorCreditCreateCommand.describe.example as { vendorCredit: Record<string, unknown> };
  assert.equal(creditNoteCreateInput.safeParse(creditExample).success, true);
  assert.equal(vendorCreditCreateInput.safeParse(vendorExample).success, true);
  assert.equal(creditNoteUpdateInput.safeParse({ id: 'credit_1', data: { reason: 'Returned goods' } }).success, true);
  assert.equal(vendorCreditUpdateInput.safeParse({ id: 'vendor-credit_1', data: { reason: 'Damaged goods' } }).success, true);
  assert.equal(invoiceUpdateInput.safeParse({ id: 'invoice_1', data: { status: 'sent' } }).success, true);
  assert.equal(invoiceDeleteInput.safeParse({ id: 'unsafe/id' }).success, false);
  const attemptedScopeChange = invoiceUpdateInput.parse({ id: 'invoice_1', data: { id: 'other', workspaceId: 'other-workspace', status: 'sent' } });
  assert.equal('id' in attemptedScopeChange.data, false);
  assert.equal('workspaceId' in attemptedScopeChange.data, false);
});

test('credit-note and vendor-credit partial updates do not inject create-time status or currency defaults', () => {
  const customerCredit = creditNoteUpdateInput.parse({ id: 'cn-1', data: { reason: 'Damaged item' } });
  const supplierCredit = vendorCreditUpdateInput.parse({ id: 'vc-1', data: { remainingCents: 500 } });
  assert.deepEqual(customerCredit.data, { reason: 'Damaged item' });
  assert.deepEqual(supplierCredit.data, { remainingCents: 500 });

  assert.deepEqual(creditNoteUpdateInput.parse({ id: 'cn-1', data: { status: 'applied', currency: 'EUR' } }).data,
    { status: 'applied', currency: 'EUR' });
  assert.deepEqual(vendorCreditUpdateInput.parse({ id: 'vc-1', data: { status: 'partially_applied', currency: 'ILS' } }).data,
    { status: 'partially_applied', currency: 'ILS' });
});

test('registry refuses duplicate or malformed registrations and unregisters only its own entry', () => {
  const registry = new CommandRegistry();
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const command = recordingCommand(counters);
  const unregister = registry.register(command);
  assert.throws(() => registry.register(command), /Duplicate command/);
  assert.equal(registry.get('demo.record'), command);
  unregister();
  assert.equal(registry.get('demo.record'), undefined);
  assert.throws(() => registry.register({ ...command, name: 'Invalid.Name' as `${string}.${string}` }), /Invalid command name/);
  assert.throws(() => registry.register({ ...command, roles: [] }), /unique, supported roles/);
  assert.deepEqual(registry.areaNames(), []);
});

test('API-key scopes validate exact, unique permissions and command paths use the least-privilege scope', () => {
  assert.deepEqual(validateApiKeyScopes(['write:customers']), { ok: true, scopes: ['write:customers'] });
  assert.deepEqual(validateApiKeyScopes(['write:vendors']), { ok: true, scopes: ['write:vendors'] });
  assert.deepEqual(validateApiKeyScopes(['write:rules']), { ok: true, scopes: ['write:rules'] });
  assert.deepEqual(validateApiKeyScopes([]), { ok: false, reason: 'missing' });
  assert.deepEqual(validateApiKeyScopes(['write:everything']), { ok: false, reason: 'unsupported' });
  assert.deepEqual(validateApiKeyScopes(['write:customers', 'write:customers']), { ok: false, reason: 'duplicate' });
  assert.deepEqual(validateApiKeyScopes(['write:vendors', 'write:vendors']), { ok: false, reason: 'duplicate' });
  assert.deepEqual(AVAILABLE_SCOPES.map(scope => scope.id), [...API_KEY_SCOPE_IDS]);
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/customer.create'), 'write:customers');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/customer.update'), 'write:customers');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/warranty.update'), 'write:customers');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/autorule.create'), 'write:rules');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/autorule.group'), 'write:rules');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/vendor.create'), 'write:vendors');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/vendor.update/preview'), 'write:vendors');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/customer.create/preview'), 'write:customers');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/journal.create'), 'write:transactions');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/invoice.create'), 'write:transactions');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/bill.create/preview'), 'write:transactions');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/invoice.update'), 'write:transactions');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/invoice.delete'), 'write:transactions');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/creditNote.create'), 'write:transactions');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/vendorCredit.update/preview'), 'write:transactions');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/commands/payment.receive/preview'), 'write:transactions');
  assert.equal(requiredApiKeyScope('GET', '/api/v1/commands'), 'read:transactions');
  assert.equal(requiredApiKeyScope('POST', '/api/v1/transactions'), 'write:transactions');
});

test('registered command execution checks authorization, period locks, and rechecks the role in the transaction', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const command = recordingCommand(counters);
  const db = new MemoryDb();
  seedWorkspace(db, workspaceId, { lockDate: '2026-09-30', roles: { writer: 'bookkeeper' }, members: ['owner-1', 'writer'] });
  const deps = runnerDependencies(db, counters);

  const closedReq = fakeRequest(owner, { workspaceId, input: { ...invocationInput(), date: '2026-09-30' } });
  const closedRes = captureResponse();
  const closed = await executeCommand(closedReq, closedRes.response, { definition: command, workspaceId, input: { ...invocationInput(), date: '2026-09-30' } }, deps);
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.code, 'PERIOD_LOCKED');
  assert.equal(counters.runs, 0);

  const writer: RequestUser = { uid: 'writer', aal: 'aal2' };
  db.beforeTransaction = () => db.seed(`workspaces/${workspaceId}`, { uid: owner.uid, members: [owner.uid, writer.uid], roles: { writer: 'viewer' } });
  const roleReq = fakeRequest(writer, { workspaceId, input: invocationInput() });
  const roleRes = captureResponse();
  const demoted = await executeCommand(roleReq, roleRes.response, { definition: command, workspaceId, input: invocationInput() }, deps);
  assert.equal(demoted.ok, false);
  if (!demoted.ok) assert.equal(demoted.code, 'ROLE_REQUIRED');
  assert.equal(counters.runs, 0);
  assert.equal(counters.audits, 0);
});

test('operation IDs replay the committed result once, refuse changed input, and do not repeat after-commit work or audits', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const command = recordingCommand(counters);
  const db = new MemoryDb();
  seedWorkspace(db);
  const deps = runnerDependencies(db, counters);
  const body = { workspaceId, input: invocationInput() };
  const request = fakeRequest(owner, body, 'operation-42');
  const firstRes = captureResponse();
  const first = await executeCommand(request, firstRes.response, { definition: command, workspaceId, input: invocationInput() }, deps);
  assert.equal(first.ok, true);
  assert.deepEqual(db.read('commandRecords/last'), { workspaceId, value: 'first' });
  assert.deepEqual(counters, { runs: 1, previews: 0, afterCommit: 1, audits: 1 });

  const replayRes = captureResponse();
  const replay = await executeCommand(request, replayRes.response, { definition: command, workspaceId, input: invocationInput() }, deps);
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.replayed, true);
  assert.equal(counters.runs, 1);
  assert.equal(counters.afterCommit, 1);
  assert.equal(counters.audits, 1);

  const changedRes = captureResponse();
  const changedBody = { workspaceId, input: invocationInput('changed') };
  const changed = await executeCommand(fakeRequest(owner, changedBody, 'operation-42'), changedRes.response,
    { definition: command, workspaceId, input: invocationInput('changed') }, deps);
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.equal(changed.status, 409);
  assert.equal(counters.runs, 1);
});

test('an idempotency replay on transaction retry discards callbacks from the losing attempt', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const command = recordingCommand(counters);
  const db = new ReplayOnRetryMemoryDb();
  seedWorkspace(db);
  const operationId = 'operation-race-retry';
  const body = { workspaceId, input: invocationInput() };
  const scopedKey = deriveScopedOperationKey(workspaceId, command.name, operationId);
  db.replayRecord = {
    key: scopedKey,
    data: {
      id: scopedKey,
      actor: owner.uid,
      workspaceId,
      operationType: command.name,
      payloadHash: requestPayloadHash(body),
      status: 'success',
      result: { saved: true, value: 'competing request' },
      createdAt: '2026-11-15T00:00:00.000Z',
      expiresAt: '2026-12-15T00:00:00.000Z',
    },
  };

  const outcome = await executeCommand(fakeRequest(owner, body, operationId), captureResponse().response,
    { definition: command, workspaceId, input: invocationInput() }, runnerDependencies(db, counters));
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.replayed, true);
    assert.deepEqual(outcome.data, { saved: true, value: 'competing request' });
  }
  assert.equal(counters.runs, 1, 'the losing attempt ran once; the replay did not rerun the handler');
  assert.equal(counters.afterCommit, 0, 'no callback from the rolled-back attempt ran');
});

test('API-key workspace binding and high-risk two-step rules are enforced before command writes', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const highRisk = recordingCommand(counters, 'demo.secure', 'high');
  const db = new MemoryDb();
  seedWorkspace(db);
  const deps = runnerDependencies(db, counters);
  const apiKeyUser: RequestUser = { ...owner, developerWorkspaceId: workspaceId };
  const scopedReq = fakeRequest(apiKeyUser, { workspaceId: 'another-workspace', input: { workspaceId: 'another-workspace', value: 'blocked' } });
  const scopedRes = captureResponse();
  const scoped = await executeCommand(scopedReq, scopedRes.response, { definition: highRisk, workspaceId: 'another-workspace', input: { workspaceId: 'another-workspace', value: 'blocked' } }, deps);
  assert.equal(scoped.ok, false);
  if (!scoped.ok) assert.equal(scoped.code, 'WORKSPACE_SCOPE');

  const keyRes = captureResponse();
  const keyOutcome = await executeCommand(fakeRequest(apiKeyUser, { workspaceId, input: invocationInput() }), keyRes.response,
    { definition: highRisk, workspaceId, input: invocationInput() }, deps);
  assert.equal(keyOutcome.ok, false);
  if (!keyOutcome.ok) assert.equal(keyOutcome.code, 'TWO_STEP_REQUIRED');
  assert.equal(counters.runs, 0);
});

test('previews call only the read-only preview hook and pass the effective date', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const command = recordingCommand(counters);
  const db = new MemoryDb();
  seedWorkspace(db);
  const outcome = await previewCommand(fakeRequest(owner, { workspaceId, input: { ...invocationInput(), date: '2026-11-15' } }),
    { definition: command, workspaceId, input: { ...invocationInput(), date: '2026-11-15' } }, runnerDependencies(db, counters));
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.deepEqual(outcome.preview, { title: 'Record first', lines: ['first'] });
  assert.equal(counters.previews, 1);
  assert.equal(counters.runs, 0);
  assert.equal(counters.audits, 0);
  assert.equal(db.entries('commandRecords').length, 0);
});

test('customer.create accepts the PartyModal fields, ignores client identity, and rejects unwriteable server fields', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const party = {
    id: 'customer-1', workspaceId,
    name: 'Acme Supplies', email: 'billing@example.test', phone: '+1 212 555 0100', status: 'active',
    address: 'New York, NY', currency: 'USD', deliveryMethod: 'email', groupId: 'wholesale', tags: ['priority'],
    contacts: [{ name: 'Mara Lee', email: 'mara@example.test', role: 'billing' }],
    metadata: { documentLanguage: 'en', documentTerms: 'net_30', taxExemption: { number: 'EX-1' }, taxPlace: { country: 'US', state: 'NY' }, vatNumber: 'US123' },
  };
  assert.equal(customerCreateInput.safeParse({ customer: party }).success, true);
  assert.equal(customerCreateInput.safeParse({ customer: { ...party, id: 'bad/customer' } }).success, false);
  assert.equal(customerCreateInput.safeParse({ customer: { ...party, uid: 'spoofed-user' } }).success, false);
  assert.equal(customerCreateInput.safeParse({ customer: { ...party, balanceCents: 10000 } }).success, false);
  assert.equal(customerCreateInput.safeParse({ customer: { ...party, portalToken: 'server-only' } }).success, false);
  for (const field of [WARRANTIES_METADATA_FIELD, RMAS_METADATA_FIELD]) {
    assert.equal(customerCreateInput.safeParse({ customer: { ...party, metadata: { [field]: { forged: true } } } }).success, false,
      `customer.create rejects client-managed ${field}`);
  }

  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const outcome = await executeCommand(fakeRequest(owner, { workspaceId, input: { customer: party } }), captureResponse().response,
    { definition: customerCreateCommand, workspaceId, input: { customer: party } }, runnerDependencies(db, counters));
  assert.equal(outcome.ok, true);
  const stored = db.read('customers/customer-1');
  assert.equal(stored?.uid, owner.uid);
  assert.equal(stored?.workspaceId, workspaceId);
  assert.equal(stored?.balanceCents, 0);
  assert.match(String(stored?.createdAt), /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(stored?.metadata, party.metadata);
  assert.deepEqual(stored?.contacts, party.contacts);
  assert.equal(counters.audits, 1);
});

test('customer.update validates profile fields, protects derived/immutable fields, and checks linked-vendor scope', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const protectedMetadata = {
    custom: 'retained',
    documentLanguage: 'en',
    [WARRANTIES_METADATA_FIELD]: { serial_one: { endDate: '2028-01-01', updatedByUid: 'system' } },
    [RMAS_METADATA_FIELD]: { rma_one: { status: 'approved', requestedByUid: 'owner-1' } },
  };
  db.seed('customers/customer-1', {
    id: 'customer-1', uid: owner.uid, workspaceId, name: 'Old Name', balanceCents: 4250,
    importBatchId: 'import-batch-1', createdAt: '2026-01-01T00:00:00.000Z', metadata: protectedMetadata,
  });
  db.seed('vendors/vendor-1', { id: 'vendor-1', uid: owner.uid, workspaceId, name: 'Vendor One' });
  const input = customerUpdateInput.parse({ id: 'customer-1', data: { name: 'New Name', linkedVendorId: 'vendor-1', metadata: { [CREDIT_LIMIT_METADATA_KEY]: 10000 } } });
  assert.equal(customerUpdateInput.safeParse({ id: 'customer-1', data: { balanceCents: 0 } }).success, false);
  assert.equal(customerUpdateInput.safeParse({ id: 'customer-1', data: { importBatchId: 'spoofed' } }).success, false);
  for (const field of [WARRANTIES_METADATA_FIELD, RMAS_METADATA_FIELD]) {
    assert.equal(customerUpdateInput.safeParse({ id: 'customer-1', data: { metadata: { [field]: { forged: true } } } }).success, false,
      `customer.update rejects client-managed ${field}`);
  }

  const outcome = await executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: customerUpdateCommand, workspaceId, input }, runnerDependencies(db));
  assert.equal(outcome.ok, true);
  const saved = db.read('customers/customer-1');
  assert.equal(saved?.name, 'New Name');
  assert.equal(saved?.linkedVendorId, 'vendor-1');
  assert.equal(saved?.balanceCents, 4250);
  assert.equal(saved?.importBatchId, 'import-batch-1');
  assert.equal(saved?.uid, owner.uid);
  assert.deepEqual(saved?.metadata, { ...protectedMetadata, [CREDIT_LIMIT_METADATA_KEY]: 10000 },
    'partial metadata updates merge editable keys and retain server-managed warranty and return-authorization history');

  const clearMetadataInput = customerUpdateInput.parse({ id: 'customer-1', data: { metadata: { documentLanguage: null } } });
  const cleared = await executeCommand(fakeRequest(owner, { workspaceId, input: clearMetadataInput }), captureResponse().response,
    { definition: customerUpdateCommand, workspaceId, input: clearMetadataInput }, runnerDependencies(db));
  assert.equal(cleared.ok, true);
  const afterClear = db.read('customers/customer-1')?.metadata as Record<string, unknown>;
  assert.equal('documentLanguage' in afterClear, false, 'null removes an editable metadata key');
  assert.equal(afterClear.custom, 'retained');
  assert.deepEqual(afterClear[WARRANTIES_METADATA_FIELD], protectedMetadata[WARRANTIES_METADATA_FIELD]);
  assert.deepEqual(afterClear[RMAS_METADATA_FIELD], protectedMetadata[RMAS_METADATA_FIELD]);

  const foreignDb = new MemoryDb();
  seedWorkspace(foreignDb);
  foreignDb.seed('customers/customer-1', { id: 'customer-1', uid: owner.uid, workspaceId, name: 'Old Name' });
  foreignDb.seed('vendors/vendor-foreign', { id: 'vendor-foreign', workspaceId: 'other-workspace' });
  const foreignInput = customerUpdateInput.parse({ id: 'customer-1', data: { linkedVendorId: 'vendor-foreign' } });
  const foreign = await executeCommand(fakeRequest(owner, { workspaceId, input: foreignInput }), captureResponse().response,
    { definition: customerUpdateCommand, workspaceId, input: foreignInput }, runnerDependencies(foreignDb));
  assert.equal(foreign.ok, false);

  const duplicateDb = new MemoryDb();
  seedWorkspace(duplicateDb);
  duplicateDb.seed('vendors/vendor-1', { id: 'vendor-1', workspaceId, name: 'Vendor One' });
  duplicateDb.seed('customers/customer-1', { id: 'customer-1', uid: owner.uid, workspaceId, name: 'First' });
  duplicateDb.seed('customers/customer-2', { id: 'customer-2', uid: owner.uid, workspaceId, name: 'Second', linkedVendorId: 'vendor-1' });
  const duplicateInput = customerUpdateInput.parse({ id: 'customer-1', data: { linkedVendorId: 'vendor-1' } });
  const duplicate = await executeCommand(fakeRequest(owner, { workspaceId, input: duplicateInput }), captureResponse().response,
    { definition: customerUpdateCommand, workspaceId, input: duplicateInput }, runnerDependencies(duplicateDb));
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.code, 'CONFLICT');
});

test('vendor.create and vendor.update keep balance and identity server-managed', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const vendor = {
    id: 'vendor-1', workspaceId, name: 'Paper Co', category: 'Office Supplies', status: 'active',
    bankDetails: { accountName: 'Paper Co', accountNumber: '1234', routingCode: '021000021' },
    metadata: { existingLabel: 'preserve' },
  };
  assert.equal(vendorCreateInput.safeParse({ vendor }).success, true);
  assert.equal(vendorCreateInput.safeParse({ vendor: { ...vendor, balanceCents: 999 } }).success, false);
  assert.equal(vendorUpdateInput.safeParse({ id: 'vendor-1', data: { balanceCents: 0 } }).success, false);
  assert.equal(vendorUpdateInput.safeParse({ id: 'vendor-1', data: { importBatchId: 'spoofed' } }).success, false);

  const create = await executeCommand(fakeRequest(owner, { workspaceId, input: { vendor } }), captureResponse().response,
    { definition: vendorCreateCommand, workspaceId, input: { vendor } }, runnerDependencies(db));
  assert.equal(create.ok, true);
  assert.equal(db.read('vendors/vendor-1')?.balanceCents, 0);
  assert.equal(db.read('vendors/vendor-1')?.uid, owner.uid);

  const input = vendorUpdateInput.parse({ id: 'vendor-1', data: {
    billsExpected: false,
    bankDetails: { accountName: 'Paper Co Ltd' },
    metadata: { savedNote: 'update only this key' },
  } });
  const update = await executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: vendorUpdateCommand, workspaceId, input }, runnerDependencies(db));
  assert.equal(update.ok, true);
  assert.equal(db.read('vendors/vendor-1')?.balanceCents, 0);
  assert.equal(db.read('vendors/vendor-1')?.billsExpected, false);
  assert.deepEqual(db.read('vendors/vendor-1')?.bankDetails, { accountName: 'Paper Co Ltd' });
  assert.deepEqual(db.read('vendors/vendor-1')?.metadata, { existingLabel: 'preserve', savedNote: 'update only this key' });
});

test('warranty.update revalidates an issued invoice serial and writes an audited history entry transactionally', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('customers/customer-1', { id: 'customer-1', workspaceId, name: 'Acme', metadata: { custom: 'keep-me' } });
  db.seed('invoices/invoice-1', {
    id: 'invoice-1', workspaceId, customerId: 'customer-1', number: 'INV-1', date: '2026-10-01', status: 'sent',
    items: [{ id: 'line-1', itemId: 'item-1', description: 'Monitor', serialNumbers: ['SN-100'] }],
  });
  db.seed('inventory/item-1', { id: 'item-1', workspaceId, name: 'Monitor', sku: 'MON-24', itemType: 'inventory' });
  const candidate = {
    id: warrantyRecordKey({ invoiceId: 'invoice-1', invoiceLineId: 'line-1', itemId: 'item-1', serial: 'SN-100' }),
    workspaceId, customerId: 'customer-1', invoiceId: 'invoice-1', invoiceLineId: 'line-1', itemId: 'item-1', serial: 'SN-100',
  };
  const input = warrantyUpdateInput.parse({ candidate, endDate: '2028-10-01' });
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const outcome = await executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: warrantyUpdateCommand, workspaceId, input }, runnerDependencies(db, counters));
  assert.equal(outcome.ok, true);
  const customer = db.read('customers/customer-1')!;
  const warranties = customer.metadata as Record<string, unknown>;
  const records = warranties.warrantiesById as Record<string, Record<string, unknown>>;
  const saved = records[candidate.id];
  assert.equal(saved.endDate, '2028-10-01');
  assert.deepEqual(saved.changeLog, [{ previousEndDate: null, endDate: '2028-10-01', at: saved.updatedAt, byUid: owner.uid, byName: 'owner@example.test' }]);
  assert.equal(warranties.custom, 'keep-me');
  assert.equal(counters.audits, 1);

  const staleDb = new MemoryDb();
  seedWorkspace(staleDb);
  staleDb.seed('customers/customer-1', { id: 'customer-1', workspaceId, name: 'Acme' });
  staleDb.seed('invoices/invoice-1', { id: 'invoice-1', workspaceId, customerId: 'customer-1', status: 'draft', items: [{ id: 'line-1', itemId: 'item-1', serialNumbers: ['SN-100'] }] });
  staleDb.seed('inventory/item-1', { id: 'item-1', workspaceId, name: 'Monitor' });
  const refused = await executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: warrantyUpdateCommand, workspaceId, input }, runnerDependencies(staleDb));
  assert.equal(refused.ok, false);
  assert.equal(staleDb.read('customers/customer-1')?.metadata, undefined);
});

test('automation-rule commands validate workspace scope for CRUD, group changes, and server-owned match counters', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const firstInput = autoRuleCreateInput.parse({ rule: {
    id: 'rule-1', name: 'Cloud', groupName: 'General', condition: { descriptionContains: 'AWS' },
    action: { targetAccountId: 'expense-cloud' }, confidence: 1, isHardened: true,
  } });
  assert.equal(autoRuleCreateInput.safeParse({ rule: { ...firstInput.rule, uid: 'spoofed-user' } }).success, false);
  const first = await executeCommand(fakeRequest(owner, { workspaceId, input: firstInput }), captureResponse().response,
    { definition: autoRuleCreateCommand, workspaceId, input: firstInput }, runnerDependencies(db));
  assert.equal(first.ok, true);
  assert.equal(db.read('autoRules/rule-1')?.uid, owner.uid);
  assert.equal(db.read('autoRules/rule-1')?.hitCount, 0);

  const secondInput = autoRuleCreateInput.parse({ rule: {
    id: 'rule-2', name: 'Paper', groupName: 'General', condition: { vendor: 'Paper Co' }, action: { type: 'categorize', targetNodeId: 'expense-office' },
  } });
  await executeCommand(fakeRequest(owner, { workspaceId, input: secondInput }), captureResponse().response,
    { definition: autoRuleCreateCommand, workspaceId, input: secondInput }, runnerDependencies(db));
  const updateInput = autoRuleUpdateInput.parse({ id: 'rule-1', data: { priority: -5, isActive: false } });
  assert.equal(autoRuleUpdateInput.safeParse({ id: 'rule-1', data: { hitCount: 999 } }).success, false);
  assert.equal(autoRuleUpdateInput.safeParse({ id: 'rule-1', data: { workspaceId: 'other' } }).success, false);
  const update = await executeCommand(fakeRequest(owner, { workspaceId, input: updateInput }), captureResponse().response,
    { definition: autoRuleUpdateCommand, workspaceId, input: updateInput }, runnerDependencies(db));
  assert.equal(update.ok, true);
  assert.equal(db.read('autoRules/rule-1')?.priority, -5);

  const rename = autoRuleGroupInput.parse({ groupName: 'General', newName: 'Cloud services' });
  const renamed = await executeCommand(fakeRequest(owner, { workspaceId, input: rename }), captureResponse().response,
    { definition: autoRuleGroupCommand, workspaceId, input: rename }, runnerDependencies(db));
  assert.equal(renamed.ok, true);
  assert.equal(db.read('autoRules/rule-2')?.groupName, 'Cloud services');
  const pause = autoRuleGroupInput.parse({ groupName: 'Cloud services', groupIsActive: false });
  await executeCommand(fakeRequest(owner, { workspaceId, input: pause }), captureResponse().response,
    { definition: autoRuleGroupCommand, workspaceId, input: pause }, runnerDependencies(db));
  assert.equal(db.read('autoRules/rule-1')?.groupIsActive, false);
  assert.equal(db.read('autoRules/rule-2')?.groupIsActive, false);

  const hits = autoRuleRecordHitsInput.parse({ rules: [{ id: 'rule-1', hits: 2 }, { id: 'rule-2', hits: 3 }] });
  await executeCommand(fakeRequest(owner, { workspaceId, input: hits }), captureResponse().response,
    { definition: autoRuleRecordHitsCommand, workspaceId, input: hits }, runnerDependencies(db));
  assert.equal(db.read('autoRules/rule-1')?.hitCount, 2);
  assert.equal(db.read('autoRules/rule-2')?.hitCount, 3);

  const foreignDb = new MemoryDb();
  seedWorkspace(foreignDb);
  foreignDb.seed('autoRules/foreign-rule', { id: 'foreign-rule', workspaceId: 'elsewhere', uid: owner.uid });
  const deleteInput = autoRuleDeleteInput.parse({ id: 'foreign-rule' });
  const refused = await executeCommand(fakeRequest(owner, { workspaceId, input: deleteInput }), captureResponse().response,
    { definition: autoRuleDeleteCommand, workspaceId, input: deleteInput }, runnerDependencies(foreignDb));
  assert.equal(refused.ok, false);
  const localDelete = autoRuleDeleteInput.parse({ id: 'rule-1' });
  await executeCommand(fakeRequest(owner, { workspaceId, input: localDelete }), captureResponse().response,
    { definition: autoRuleDeleteCommand, workspaceId, input: localDelete }, runnerDependencies(db));
  assert.equal(db.read('autoRules/rule-1'), undefined);
});

test('payment command fingerprints match the legacy route before preparation, including default dates', () => {
  const context = { actor: owner.uid, workspaceId, role: 'owner' as const, user: owner, db: new MemoryDb() as unknown as Firestore, workspace: {}, effectiveDate: '2026-11-15' };
  const raw = paymentReceiveInput.parse({ amountCents: 5000, cashAccountId: 'cash', customerId: 'cust-1', allocations: [] });
  const request = fakeRequest(owner, { workspaceId, input: raw });
  const hash = paymentReceiveCommand.idempotencyHash?.(context, raw, undefined, request);
  const { workspaceId: _bodyWorkspaceId, sendRemittance: _sendRemittance, paymentTypeId: _paymentTypeId, ...rest } = raw;
  assert.equal(hash, paymentRequestHash({ ...rest, paymentDate: context.effectiveDate, workspaceId, uid: owner.uid }));

  const typed = paymentReceiveInput.parse({ amountCents: 5000, cashAccountId: 'cash', paymentTypeId: 'cash-type', allocations: [] });
  const typedHash = paymentReceiveCommand.idempotencyHash?.(context, typed, undefined, request);
  const { workspaceId: _typedWorkspaceId, sendRemittance: _typedSendRemittance, paymentTypeId, ...typedRest } = typed;
  assert.equal(typedHash, paymentRequestHash({ ...typedRest, paymentTypeId, paymentDate: null, workspaceId, uid: owner.uid }));
});

test('payment.receive replays an operation using the same workspace-local effective date as its stored fingerprint', async () => {
  const db = new MemoryDb();
  seedWorkspace(db, workspaceId, { timezone: 'UTC' });
  const input = paymentReceiveInput.parse({ amountCents: 5000, cashAccountId: 'cash', allocations: [] });
  const workspace = db.read(`workspaces/${workspaceId}`)!;
  const baseContext = { actor: owner.uid, workspaceId, role: 'owner' as const, user: owner, db: db as unknown as Firestore, workspace };
  const effectiveDate = paymentReceiveCommand.resolveDate?.(baseContext, input);
  assert.ok(effectiveDate);
  const context = { ...baseContext, effectiveDate };
  const request = fakeRequest(owner, { workspaceId, input }, 'payment-op-local-date');
  const payloadHash = paymentReceiveCommand.idempotencyHash?.(context, input, undefined, request);
  assert.ok(payloadHash);
  const key = deriveScopedOperationKey(workspaceId, 'PAYMENT_CREATE', 'payment-op-local-date');
  db.seed(`idempotencyKeys/${key}`, { id: key, actor: owner.uid, workspaceId, operationType: 'PAYMENT_CREATE', status: 'success', payloadHash, result: { paymentId: 'committed-payment' } });

  const outcome = await executeCommand(request, captureResponse().response,
    { definition: paymentReceiveCommand, workspaceId, input }, runnerDependencies(db));
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.replayed, true);
    assert.deepEqual(outcome.data, { paymentId: 'committed-payment' });
  }
  assert.equal(db.entries('payments').length, 0);
});

test('payment preview stages dry-run transaction writes in memory and leaves database records untouched', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('chartAccounts/cash', { workspaceId, name: 'Checking', type: 'asset', category: 'Cash', isActive: true });
  db.seed('chartAccounts/ar', { workspaceId, name: 'Accounts Receivable', type: 'asset', category: 'Receivables', isActive: true });
  db.seed('invoices/invoice-1', { workspaceId, status: 'sent', amountCents: 10000, amountPaidCents: 0, date: '2026-11-01', customerId: 'customer-1', currency: 'USD' });
  const input = paymentReceiveInput.parse({
    workspaceId, amountCents: 10000, paymentDate: '2026-11-15', cashAccountId: 'cash', offsetAccountId: 'ar', customerId: 'customer-1', entityName: 'Acme',
    allocations: [{ documentId: 'invoice-1', documentType: 'invoice', amountCents: 10000 }],
  });
  const context = { actor: owner.uid, workspaceId, role: 'owner' as const, user: owner, db: db as unknown as Firestore, workspace: db.read(`workspaces/${workspaceId}`)!, effectiveDate: '2026-11-15' };
  const preview = await paymentReceiveCommand.preview(context, input);
  assert.match(preview.title, /10000 cents/);
  assert.deepEqual((preview.accounts || []).map(account => [account.accountId, account.accountName, account.amountCents]), [
    ['cash', 'Checking', 10000], ['ar', 'Accounts Receivable', -10000],
  ]);
  assert.equal(db.directWriteCount, 0);
  assert.equal(db.entries('payments').length, 0);
  assert.equal(db.entries('transactions').length, 0);
  assert.equal(db.read('invoices/invoice-1')?.amountPaidCents, 0);
});

test('the authenticated command router lists metadata and serves preview, execution, and unknown-command responses', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const registry = new CommandRegistry();
  registry.register(recordingCommand(counters));
  const db = new MemoryDb();
  seedWorkspace(db);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as Request & { user: RequestUser }).user = owner; next(); });
  app.use('/api/v1/commands', createCommandRouter(registry, runnerDependencies(db, counters)));
  const server = app.listen(0);
  try {
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}/api/v1/commands`;
    const listing = await fetch(base);
    assert.equal(listing.status, 200);
    const listingBody = await listing.json() as { commands: Array<{ name: string; inputSchema: { type?: string } }> };
    assert.equal(listingBody.commands[0].name, 'demo.record');
    assert.equal(listingBody.commands[0].inputSchema.type, 'object');

    const envelope = { workspaceId, input: invocationInput('routed') };
    const preview = await fetch(`${base}/demo.record/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) });
    assert.equal(preview.status, 200);
    assert.deepEqual((await preview.json() as { preview: { title: string } }).preview.title, 'Record routed');
    assert.equal(counters.runs, 0);

    const run = await fetch(`${base}/demo.record`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'route-op' }, body: JSON.stringify(envelope) });
    assert.equal(run.status, 200);
    assert.equal((await run.json() as { status: string }).status, 'success');
    assert.equal(counters.runs, 1);

    const unknown = await fetch(`${base}/no.such.command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) });
    assert.equal(unknown.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
