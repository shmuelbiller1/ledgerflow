import type { CommandPreview } from '../../commands/types';
import type { EffectIntent } from '../../services/sandboxEffects';
import type { RecordRef, RecordVersion } from './commandStage';
import { quoteIdent, type Runner } from './sql';

export interface SandboxBinding { id: string; workspaceId: string; personId: string }
export type StepState = 'pending' | 'accepted' | 'rejected' | 'needs-recheck' | 'failed' | 'undone';
export interface StepPreview extends CommandPreview {
  effects: EffectIntent[];
  entityId?: string;
  ledgerHash?: string;
  effectiveDate?: string;
  provisionalNumber?: string;
  allocatedIds: Record<string, string>;
}
export interface StoredStep {
  id: string;
  position: number;
  command: string;
  input: unknown;
  recordIds: RecordRef[];
  dependencies: RecordVersion[];
  preview: StepPreview;
  state: StepState;
  failureReason: string | null;
  inverse: { command: string; input: unknown } | null;
}
export const MAX_PENDING_STEPS = 200;
const MAX_OPEN_SANDBOXES = 3;
const MAX_OPEN_DRAFT_BYTES = 50_000_000;
export const isUnresolved = (step: StoredStep) => step.state !== 'accepted' && step.state !== 'rejected' && step.state !== 'undone';

export async function createBinding(runner: Runner, binding: SandboxBinding): Promise<'created' | 'person-limit' | 'workspace-limit'> {
  if (await openDraftBytes(runner, binding.workspaceId, binding.id) >= MAX_OPEN_DRAFT_BYTES) return 'workspace-limit';
  // Predicate reads and writes share the serializable batch: concurrent creates cannot exceed the cap.
  const res = await runner.query(`insert into sandbox.sandboxes (id, workspace_id, person_id)
    select $1, $2, $3 where (select count(*) from sandbox.sandboxes
      where person_id = $3 and status = 'open' and expires_at > statement_timestamp()) < $4`,
  [binding.id, binding.workspaceId, binding.personId, MAX_OPEN_SANDBOXES]);
  return res.rowCount === 1 ? 'created' : 'person-limit';
}

/** Serialize mutations on the draft's own row, not the real workspace/books. */
export async function lockBinding(runner: Runner, binding: SandboxBinding): Promise<boolean> {
  const res = await runner.query(`select id from sandbox.sandboxes
    where id = $1 and workspace_id = $2 and person_id = $3 and status = 'open' and expires_at > statement_timestamp()
    for update`, [binding.id, binding.workspaceId, binding.personId]);
  return res.rowCount === 1;
}

export async function stepsOf(runner: Runner, id: string): Promise<StoredStep[]> {
  return (await runner.query<StoredStep>(`select id, position, command_name as command, input, state, preview, inverse,
    record_ids as "recordIds", dependencies, failure_reason as "failureReason"
    from sandbox."sandboxSteps" where sandbox_id = $1 order by position`, [id])).rows;
}

export async function saveStep(runner: Runner, id: string, step: StoredStep): Promise<void> {
  await runner.query(`insert into sandbox."sandboxSteps"
    (sandbox_id, id, position, command_name, input, record_ids, dependencies, preview, state, failure_reason, inverse)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    on conflict (sandbox_id, id) do update set position = excluded.position, input = excluded.input,
      record_ids = excluded.record_ids, dependencies = excluded.dependencies, preview = excluded.preview,
      state = excluded.state, failure_reason = excluded.failure_reason, inverse = excluded.inverse`, [id, step.id,
    step.position, step.command, JSON.stringify(step.input), JSON.stringify(step.recordIds), JSON.stringify(step.dependencies),
    JSON.stringify(step.preview), step.state, step.failureReason, step.inverse ? JSON.stringify(step.inverse) : null]);
}

/** All physical writes come from reviewed steps. Clear just the manifest's collections. */
let tableCache: { overlay: string[]; writable: string[] } | undefined;
async function tables(runner: Runner): Promise<NonNullable<typeof tableCache>> {
  if (!tableCache) {
    // Every overlay table, and whether the sandbox role may read its live base. A draft write
    // copies the live row's version first, so a table the role cannot read cannot be drafted.
    const { rows } = await runner.query<{ table_name: string; book: boolean }>(`select table_name,
      has_table_privilege('lf_sandbox', format('public.%I', table_name), 'SELECT') as book
      from information_schema.tables where table_schema = 'sandbox' and table_type = 'BASE TABLE'
      and table_name not in ('sandboxes', 'sandboxSteps') order by table_name`);
    tableCache = { overlay: rows.map(row => row.table_name),
      writable: rows.filter(row => row.book).map(row => row.table_name) };
  }
  return tableCache;
}
/** Every overlay table (one per document table in public), read once from the catalogue. */
export const overlayTables = async (runner: Runner): Promise<string[]> => (await tables(runner)).overlay;
/** The tables a draft step may write: the books the sandbox role can read. Drafted stock moves get a provisional `dbSeq` (migration 20261120090000). */
export const draftWritableTables = async (runner: Runner): Promise<string[]> => (await tables(runner)).writable;

export async function clearDraft(runner: Runner, collections: readonly string[]): Promise<void> {
  for (const id of collections) {
    await runner.query(`delete from sandbox.${quoteIdent(id)} where sandbox_id = sandbox.active_id()`);
  }
}

export async function draftBytes(runner: Runner, collections: readonly string[]): Promise<number> {
  const sources = [...collections.map(id => `sandbox.${quoteIdent(id)}`), 'sandbox."sandboxSteps"'];
  const sums = sources.map(source => `select coalesce(sum(pg_column_size(to_jsonb(r))), 0) as n from ${source} r where sandbox_id = sandbox.active_id()`);
  const { rows: [row] } = await runner.query<{ bytes: string }>(`select sum(n) as bytes from (${sums.join(' union all ')}) sizes`);
  return Number(row?.bytes ?? 0);
}

async function openDraftBytes(runner: Runner, workspaceId: string, except: string): Promise<number> {
  const { rows: [row] } = await runner.query<{ used: string }>(`select coalesce(sum(overlay_bytes), 0) as used
    from sandbox.sandboxes where workspace_id = $1 and id <> $2 and status = 'open' and expires_at > statement_timestamp()`, [workspaceId, except]);
  return Number(row.used);
}

export async function updateBinding(runner: Runner, binding: SandboxBinding, bytes: number, elapsedMs: number, closed = false): Promise<boolean> {
  if (!closed && await openDraftBytes(runner, binding.workspaceId, binding.id) + bytes > MAX_OPEN_DRAFT_BYTES) return false;
  // Updating even when bytes are unchanged makes concurrent owners of the same draft retry on a new snapshot.
  await runner.query(`update sandbox.sandboxes set overlay_bytes = $2, last_rebuild_ms = $3, status = $4 where id = $1`,
  [binding.id, bytes, elapsedMs, closed ? 'closed' : 'open']);
  return true;
}

export async function boundWorkspace(runner: Runner, workspaceId: string): Promise<Record<string, unknown> | undefined> {
  const { rows: [row] } = await runner.query<{ data: Record<string, unknown> }>('select data from public."workspaces" where id = $1', [workspaceId]);
  return row?.data;
}

/** Whether an open, unexpired sandbox with this binding exists (a read; no lock). */
export async function ownsOpenSandbox(runner: Runner, binding: SandboxBinding): Promise<boolean> {
  const res = await runner.query(`select 1 from sandbox.sandboxes
    where id = $1 and workspace_id = $2 and person_id = $3 and status = 'open' and expires_at > statement_timestamp()`,
  [binding.id, binding.workspaceId, binding.personId]);
  return res.rowCount === 1;
}

export interface OpenSandboxSummary { id: string; createdAt: string; expiresAt: string; pendingSteps: number }

/** The person's own open sandboxes in one workspace, newest first: what the review screen lists. */
export async function listOpenSandboxes(runner: Runner, workspaceId: string, personId: string): Promise<OpenSandboxSummary[]> {
  const { rows } = await runner.query<{ id: string; created_at: string; expires_at: string; pending: number }>(`
    select s.id, s.created_at::text as created_at, s.expires_at::text as expires_at,
      (select count(*)::int from sandbox."sandboxSteps" st where st.sandbox_id = s.id and st.state in ('pending', 'needs-recheck', 'failed')) as pending
    from sandbox.sandboxes s
    where s.workspace_id = $1 and s.person_id = $2 and s.status = 'open' and s.expires_at > statement_timestamp()
    order by s.created_at desc`, [workspaceId, personId]);
  return rows.map(row => ({ id: row.id, createdAt: row.created_at, expiresAt: row.expires_at, pendingSteps: row.pending }));
}
