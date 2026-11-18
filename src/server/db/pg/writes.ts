/** Write encoding is identical for live and copy-on-write documents. Only the target changes. */
import { quoteIdent } from './sql';
import { FieldPath, hasTransforms, invalid, isPlainObject, splitWrite, toSegments } from './values';
import type { DocumentData, Patch, Precondition, RefLike, SetOptions } from './values';

export type ScopedRef = RefLike & { readonly firestore: { readonly sandboxId?: string } };

type Write = { ref: ScopedRef; params: unknown[] };
export type WriteOp = Write & (
  | { kind: 'set'; fresh: string; merge?: (data: string) => string }
  | { kind: 'create'; fresh: string }
  | { kind: 'update'; patch: (data: string) => string; mustExist: true }
  | { kind: 'delete'; mustExist: boolean }
);

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
  return [JSON.stringify(patch.unset), JSON.stringify(patch.inc), JSON.stringify(patch.union), JSON.stringify(patch.remove)];
}

const APPLY = (doc: string, set: string) =>
  `public.lf_apply_patch(${doc}, ${set}, array(select jsonb_array_elements_text($3::jsonb)), $4::jsonb, $5::jsonb, $6::jsonb)`;

function encodeBody(ref: ScopedRef, data: DocumentData) {
  const patch = splitWrite(data, new Date().toISOString());
  const transforms = hasTransforms(patch);
  const params = [ref.id, JSON.stringify(patch.data), ...(transforms ? patchParams(patch) : [])];
  const fresh = transforms ? APPLY('$2::jsonb', `'{}'::jsonb`) : '$2::jsonb';
  return { params, fresh, transforms };
}

export function buildSet(ref: ScopedRef, data: DocumentData, options?: SetOptions): WriteOp {
  if (!isPlainObject(data)) throw invalid(`set() on ${ref.path} needs an object`);
  const { params, fresh, transforms } = encodeBody(ref, data);
  return { ref, kind: 'set', params, fresh, merge: options?.merge ? (before) => {
    const merged = `public.lf_deep_merge(${before}, $2::jsonb)`;
    return transforms ? APPLY(merged, `'{}'::jsonb`) : merged;
  } : undefined };
}

export function buildUpdate(ref: ScopedRef, dataOrField: DocumentData | string | FieldPath, more: unknown[]): WriteOp {
  const fields = toFieldMap(dataOrField, more);
  if (Object.keys(fields).length === 0) throw invalid(`update() on ${ref.path} needs at least one field`);
  for (const key of Object.keys(fields)) toSegments(key);
  const patch = splitWrite(fields, new Date().toISOString());
  return {
    ref, kind: 'update', patch: (before) => APPLY(before, '$2::jsonb'),
    params: [ref.id, JSON.stringify(patch.data), ...patchParams(patch)], mustExist: true,
  };
}

export function buildCreate(ref: ScopedRef, data: DocumentData): WriteOp {
  if (!isPlainObject(data)) throw invalid(`create() on ${ref.path} needs an object`);
  const { params, fresh } = encodeBody(ref, data);
  return { ref, kind: 'create', params, fresh };
}

export function buildDelete(ref: ScopedRef, precondition?: Precondition): WriteOp {
  return { ref, kind: 'delete', params: [ref.id], mustExist: precondition?.exists === true };
}

export function liveWriteSql(op: WriteOp): string {
  const table = `public.${quoteIdent(op.ref.collectionId)}`;
  switch (op.kind) {
    // One UPSERT so concurrent set(..., { merge: true }) increments are atomic.
    case 'set': return `insert into ${table} as t (id, data) values ($1, ${op.fresh}) on conflict (id) do update set data = ${op.merge?.('t.data') ?? 'excluded.data'}`;
    case 'create': return `insert into ${table} (id, data) values ($1, ${op.fresh})`;
    case 'update': return `update ${table} set data = ${op.patch('data')} where id = $1`;
    case 'delete': return `delete from ${table} where id = $1`;
  }
}

const PRESENT = 'prior.data is not null and not prior.deleted';

function draftValue(op: WriteOp): string {
  switch (op.kind) {
    case 'set': return op.merge ? `case when ${PRESENT} then ${op.merge('prior.data')} else ${op.fresh} end` : op.fresh;
    case 'create': return op.fresh;
    case 'update': return op.patch('prior.data');
    case 'delete': return `jsonb_build_object('workspaceId', sandbox.active_workspace())`;
  }
}

export function sandboxWriteSql(op: WriteOp): string {
  const name = quoteIdent(op.ref.collectionId);
  const target = `sandbox.${name}`;
  const where = op.kind === 'set' ? 'true' : op.kind === 'create' ? `not (${PRESENT})` : PRESENT;
  // The first mutation copies the live document and its content version, using an ordinary MVCC
  // SELECT (including on DELETE). Later mutations keep that version, even after a tombstone.
  // RLS on public enforces workspace scope. Only the overlay is locked by the UPSERT;
  // a concurrent edit of it retries at SERIALIZABLE.
  return `with draft as materialized (
      select data, deleted, base_version, created_at from ${target}
      where sandbox_id = (select sandbox.active_id()) and id = $1
    ), prior as (
      select * from draft
      union all
      select data, false, sandbox.content_version(data), created_at from public.${name}
      where id = $1 and not exists (select from draft)
    )
    insert into ${target} (sandbox_id, id, data, deleted, base_version, created_at)
      select sandbox.active_id(), $1, ${draftValue(op)}, ${op.kind === 'delete'}, prior.base_version,
        case when ${PRESENT} then prior.created_at else now() end
      from (values (1)) as required_row(n) left join prior on true
      where ${where}
    on conflict (sandbox_id, id) do update
      set data = excluded.data, deleted = excluded.deleted, created_at = excluded.created_at, updated_at = now()`;
}
