import { AsyncLocalStorage } from 'node:async_hooks';
import type { Firestore, Transaction } from '../pgFirestore';
import { quoteIdent, type Runner } from './sql';

export interface RecordRef { collectionId: string; id: string }
export interface RecordVersion extends RecordRef {
  baseVersion: string | null;
  fromOverlay: boolean;
  read: boolean;
  written: boolean;
}
export type StageState = { failure: unknown };
export interface StageOptions {
  ids: Map<string, string>;
  writable: ReadonlySet<string>;
  expectedLive?: { workspaceId: string; writes: readonly RecordRef[]; creates: readonly RecordRef[] };
}
interface Stage {
  db: Firestore;
  runner: Runner;
  tx: Transaction;
  state: StageState;
  active: boolean;
  ids: Map<string, string>;
  slots: Map<string, number>;
  reads: Map<string, Set<string>>;
}
const stages = new AsyncLocalStorage<Stage>();
export const stageWrites = Symbol('stageWrites');

class CommandStageRefusal extends Error {
  readonly status = 409;
  readonly code = 'SANDBOX_STAGE_UNSAFE';
}

/** Even a caught refusal aborts this attempt. A delayed callback cannot reuse a released runner. */
export function refuseCommandStage(error: Error): never {
  const stage = stages.getStore();
  if (stage?.active) stage.state.failure ??= error;
  throw error;
}

function current(db: Firestore, runner?: Runner, tx?: Transaction): Stage | undefined {
  const stage = stages.getStore();
  if (stage && (!stage.active || stage.db !== db || (runner && runner !== stage.runner) || (tx && tx !== stage.tx))) {
    refuseCommandStage(new CommandStageRefusal('A command step must use its active database transaction'));
  }
  return stage;
}

export function commandStageReader(db: Firestore, runner?: Runner, tx?: Transaction): { runner: Runner; state: StageState } | undefined {
  return current(db, runner, tx);
}

export function assertOutsideCommandStage(message?: string): void {
  if (stages.getStore()) refuseCommandStage(new CommandStageRefusal(message ?? 'A command step cannot start a new write or connection'));
}

/** Replay uses the same new record ids; ordinary live commands still allocate exactly as before. */
export function commandStageId(db: Firestore, collection: string, generate: () => string): string {
  const stage = current(db);
  if (!stage) return generate();
  const slot = stage.slots.get(collection) ?? 0;
  stage.slots.set(collection, slot + 1);
  const key = `${collection}:${slot}`;
  const id = stage.ids.get(key) ?? generate();
  stage.ids.set(key, id);
  return id;
}

export function recordCommandReads(db: Firestore, collection: string, ids: Iterable<string>): void {
  const stage = current(db);
  if (!stage || !db.sandboxId) return;
  const seen = stage.reads.get(collection) ?? new Set<string>();
  for (const id of ids) seen.add(id);
  stage.reads.set(collection, seen);
}

async function readVersions(stage: Stage, writes: readonly RecordRef[]): Promise<RecordVersion[]> {
  const written = new Map<string, Set<string>>();
  for (const ref of writes) {
    const ids = written.get(ref.collectionId) ?? new Set<string>();
    ids.add(ref.id);
    written.set(ref.collectionId, ids);
  }
  const versions: RecordVersion[] = [];
  for (const collectionId of [...new Set([...stage.reads.keys(), ...written.keys()])].sort()) {
    const read = stage.reads.get(collectionId);
    const wrote = written.get(collectionId);
    const ids = [...new Set([...(read ?? []), ...(wrote ?? [])])];
    if (ids.length === 0) continue;
    const table = quoteIdent(collectionId);
    const { rows } = await stage.runner.query<{ id: string; base_version: string | null; overlay: boolean }>(`
      select wanted.id, d.id is not null as overlay,
        case when d.id is not null then d.base_version else sandbox.content_version(p.data) end as base_version
      from unnest($1::text[]) wanted(id)
      left join sandbox.${table} d on d.sandbox_id = sandbox.active_id() and d.id = wanted.id
      left join public.${table} p on p.id = wanted.id
      order by wanted.id collate "C"`, [ids]);
    versions.push(...rows.map(row => ({ collectionId, id: row.id, fromOverlay: row.overlay, baseVersion: row.base_version,
      read: read?.has(row.id) ?? false, written: wrote?.has(row.id) ?? false })));
  }
  return versions;
}

export const refKey = (ref: RecordRef) => `${ref.collectionId}/${ref.id}`;

function validateWrites(writes: readonly RecordRef[], options: StageOptions): void {
  if (writes.some(ref => !options.writable.has(ref.collectionId))) {
    throw Object.assign(new Error('This step needs a write that has not been reviewed for the sandbox'), {
      status: 409, code: 'SANDBOX_WRITE_NOT_REVIEWED',
    });
  }
  if (!options.expectedLive) return;
  const expected = new Set(options.expectedLive.writes.map(refKey));
  const actual = new Set(writes.filter(ref => ref.collectionId !== 'auditLogs').map(refKey));
  if (actual.size !== expected.size || [...actual].some(path => !expected.has(path))) {
    throw Object.assign(new Error('The live step would change a different set of records. Review the draft again.'), {
      status: 409, code: 'SANDBOX_WRITE_CHANGED',
    });
  }
}

/** Draft RLS cannot see ids occupied by another workspace. An upsert must never replace them. */
async function assertLiveTargets(runner: Runner, expected: NonNullable<StageOptions['expectedLive']>): Promise<void> {
  const creates = new Set(expected.creates.map(refKey));
  const groups = new Map<string, string[]>();
  for (const { collectionId, id } of expected.writes) {
    const ids = groups.get(collectionId) ?? [];
    ids.push(id);
    groups.set(collectionId, ids);
  }
  for (const [collectionId, ids] of groups) {
    const { rows } = await runner.query<{ id: string; workspace_id: string }>(
      `select id, workspace_id from public.${quoteIdent(collectionId)} where id = any($1::text[])`, [ids]);
    if (rows.some(row => row.workspace_id !== expected.workspaceId || creates.has(refKey({ collectionId, id: row.id })))) {
      throw Object.assign(new Error('A record for this step already exists'), { status: 409, code: 'DUPLICATE_RECORD' });
    }
  }
}

/** Flush only this step. Its writes then become visible to the next step inside the same transaction. */
export async function runCommandStage<R>(db: Firestore, runner: Runner, tx: Transaction, state: StageState,
  options: StageOptions, work: (tx: Transaction) => Promise<R>) {
  if (options.expectedLive) await assertLiveTargets(runner, options.expectedLive);
  const stage: Stage = { db, runner, tx, state, active: true, ids: options.ids, slots: new Map(), reads: new Map() };
  const value = await stages.run(stage, async () => {
    try { return await work(tx); }
    catch (error) { throw state.failure ?? error; }
    finally { stage.active = false; }
  });
  if (state.failure !== undefined) throw state.failure;
  const writes = tx[stageWrites]();
  validateWrites(writes, options);
  const dependencies = db.sandboxId ? await readVersions(stage, writes) : [];
  const allocatedIds = Object.fromEntries([...stage.slots].flatMap(([collection, n]) =>
    Array.from({ length: n }, (_, i) => [`${collection}:${i}`, stage.ids.get(`${collection}:${i}`)!])));
  await tx.flush();
  return { value, dependencies, allocatedIds };
}
