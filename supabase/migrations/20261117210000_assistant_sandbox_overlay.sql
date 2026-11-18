-- SBX-1 foundation. A sandbox is a workspace-scoped, copy-on-write branch of document data.
-- Nothing in sandbox or sandbox_read is exposed to PostgREST. The app uses SET LOCAL ROLE on
-- its checked-out connection; this role owns no objects and cannot lock or mutate public rows.
do $$
begin
  if not exists (select from pg_catalog.pg_roles where rolname = 'lf_sandbox') then
    create role lf_sandbox nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;
grant lf_sandbox to current_user;

create schema sandbox;
create schema sandbox_read;
revoke all on schema sandbox, sandbox_read from public, anon, authenticated, service_role;
grant usage on schema public, sandbox, sandbox_read to lf_sandbox;

create table sandbox.sandboxes (
  id uuid primary key,
  workspace_id text not null,
  person_id text not null,
  status text not null default 'open' check (status in ('open', 'closed', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  overlay_bytes bigint not null default 0 check (overlay_bytes >= 0),
  last_rebuild_ms integer check (last_rebuild_ms >= 0)
);
-- No FK into public: even a foreign-key check could lock a live row.
create index sandboxes_person_idx on sandbox.sandboxes (person_id) where status = 'open';
create index sandboxes_workspace_idx on sandbox.sandboxes (workspace_id) where status = 'open';
create index sandboxes_expiry_idx on sandbox.sandboxes (expires_at) where status = 'open';

create table sandbox."sandboxSteps" (
  sandbox_id uuid not null references sandbox.sandboxes(id) on delete cascade,
  id uuid not null,
  position integer not null check (position > 0),
  command_name text not null,
  input jsonb not null,
  record_ids jsonb not null default '[]',
  dependencies jsonb not null default '[]', -- records and their base versions, not only ids
  preview jsonb not null,
  state text not null default 'pending' check (state in ('pending', 'accepted', 'rejected', 'needs-recheck', 'failed')),
  failure_reason text,
  inverse jsonb,
  primary key (sandbox_id, id),
  unique (sandbox_id, position) deferrable
);

-- The server sets the id after authenticating and authorizing the caller (never directly from
-- an HTTP parameter). Null scope, a closed sandbox, and expiry all fail closed in RLS.
create function sandbox.active_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(current_setting('lf.sandbox_id', true), '')::uuid
$$;

revoke all on sandbox.sandboxes from public, anon, authenticated, service_role;
alter table sandbox.sandboxes enable row level security;
create policy scoped_sandbox on sandbox.sandboxes for select to lf_sandbox
  using (id = (select sandbox.active_id()) and status = 'open' and expires_at > statement_timestamp());
grant select on sandbox.sandboxes to lf_sandbox;

create function sandbox.active_workspace() returns text
language sql stable set search_path = '' as $$
  select workspace_id from sandbox.sandboxes
  where id = sandbox.active_id() and status = 'open' and expires_at > statement_timestamp()
$$;

-- A content hash deliberately ignores updated_at: not all paths maintain it. JSONB produces the
-- same key ordering regardless of insertion order. Keep this function for both copy and re-check.
create function sandbox.content_version(data jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select encode(sha256(convert_to(data::text, 'UTF8')), 'hex')
$$;

revoke execute on all functions in schema sandbox from public, anon, authenticated, service_role;
grant execute on all functions in schema sandbox to lf_sandbox;

revoke all on sandbox."sandboxSteps" from public, anon, authenticated, service_role;
alter table sandbox."sandboxSteps" enable row level security;
create policy scoped_steps on sandbox."sandboxSteps" to lf_sandbox
  using (sandbox_id = (select sandbox.active_id()) and (select sandbox.active_workspace()) is not null);
grant select, insert, update, delete on sandbox."sandboxSteps" to lf_sandbox;

-- The role can discover the same collections as the live adapter, and use the same pure patch
-- functions. Do not grant it write RPCs, sequence privileges, or access to other schemas.
grant select on public.lf_rules to lf_sandbox;
create policy sandbox_catalog on public.lf_rules for select to lf_sandbox using (true);
grant execute on function public.lf_is_client(), public.lf_claims(), public.lf_set_path(jsonb, text[], jsonb),
  public.lf_deep_merge(jsonb, jsonb), public.lf_apply_patch(jsonb, jsonb, text[], jsonb, jsonb, jsonb) to lf_sandbox;

-- lf_rules is the Firestore collection catalog. The rules suite also checks the actual public
-- table shapes, so an unregistered document table (or a missing overlay) cannot go unnoticed.
-- Future document-table migrations call this as the migration owner after registering lf_rules.
create procedure sandbox.install_overlay(t text)
language plpgsql set search_path = '' as $$
declare
  has_workspace_column boolean;
  workspace_column text;
  live_scope text;
  overlay_scope text;
begin
  if not exists (select from public.lf_rules where table_name = t) then
    raise exception 'Register public.% in lf_rules before installing its sandbox overlay', t;
  end if;
  if not exists (select from pg_catalog.pg_class where oid = format('public.%I', t)::regclass and relrowsecurity) then
    raise exception 'Enable RLS on public.% before granting sandbox reads', t;
  end if;

  has_workspace_column := exists (select from pg_catalog.pg_attribute
    where attrelid = format('public.%I', t)::regclass and attname = 'workspace_id' and not attisdropped);
  workspace_column := case when has_workspace_column then 'live.workspace_id' else 'null::text as workspace_id' end;
  live_scope := case
    when t = 'workspaces' then 'id = (select sandbox.active_workspace())'
    when has_workspace_column then 'workspace_id = (select sandbox.active_workspace())'
    else 'false' -- recoveryCodes has no workspace column; never read live recovery codes
    end;
  overlay_scope := case when t = 'workspaces'
    then 'id = (select sandbox.active_workspace()) and (workspace_id is null or workspace_id = id)'
    else 'workspace_id = (select sandbox.active_workspace())' end;

  -- Preserve generated fields and row CHECKs, but never copy an index, FK, default, identity,
  -- sequence or trigger from public. Trigger reuse is deliberately allowlisted below.
  execute format($ddl$
    create table sandbox.%1$I (
      like public.%1$I including generated including constraints,
      sandbox_id uuid not null references sandbox.sandboxes(id) on delete cascade,
      deleted boolean not null default false,
      base_version text,
      primary key (sandbox_id, id)
    )$ddl$, t);
  if not has_workspace_column then
    execute format($ddl$alter table sandbox.%I add column workspace_id text
      generated always as (data->>'workspaceId') stored$ddl$, t);
  end if;
  execute format('alter table sandbox.%I alter column created_at set default now(), alter column updated_at set default now()', t);
  execute format('alter table sandbox.%I enable row level security', t);
  execute format('revoke all on sandbox.%I from public, anon, authenticated, service_role', t);
  execute format('grant select, insert, update, delete on sandbox.%I to lf_sandbox', t);
  execute format($ddl$
    create policy scoped_overlay on sandbox.%I to lf_sandbox
    using (sandbox_id = (select sandbox.active_id()) and (select sandbox.active_workspace()) is not null)
    with check (sandbox_id = (select sandbox.active_id()) and (%s))$ddl$, t, overlay_scope);

  execute format('grant select on public.%I to lf_sandbox', t);
  execute format($ddl$
    create policy sandbox_read_workspace on public.%I for select to lf_sandbox
    using (%s)$ddl$, t, live_scope);

  -- Explicit scope also matters for the chart guard's SECURITY DEFINER caller. Keeping the
  -- anti-join here gives point reads, lists, counts and future raw-SQL readers one relation.
  execute format($ddl$
    create view sandbox_read.%1$I with (security_invoker = true) as
      select live.id, live.data, %2$s, live.created_at, live.updated_at
      from public.%1$I live
      where (%3$s)
        and not exists (
          select from sandbox.%1$I draft
          where draft.sandbox_id = (select sandbox.active_id()) and draft.id = live.id
        )
      union all
      select draft.id, draft.data, draft.workspace_id, draft.created_at, draft.updated_at
      from sandbox.%1$I draft
      where draft.sandbox_id = (select sandbox.active_id())
        and (select sandbox.active_workspace()) is not null and not draft.deleted
  $ddl$, t, workspace_column, live_scope);
  execute format('revoke all on sandbox_read.%I from public, anon, authenticated, service_role', t);
  execute format('grant select on sandbox_read.%I to lf_sandbox', t);

  if exists (select from pg_catalog.pg_trigger
    where tgrelid = format('public.%I', t)::regclass and tgname = 'lf_guard') then
    -- With no browser JWT, the cross-table browser rules are not entered, as on live server saves.
    execute format('create trigger lf_guard before insert or update or delete on sandbox.%I
      for each row execute function public.lf_guard()', t);
  end if;
end $$;
revoke execute on procedure sandbox.install_overlay(text) from public, anon, authenticated, service_role, lf_sandbox;

do $$
declare
  t text;
begin
  for t in select table_name from public.lf_rules order by table_name loop
    call sandbox.install_overlay(t);
  end loop;
end $$;

-- Row-local guards use the original trigger functions. The ledger guards do not see tombstones:
-- deleting a document is not the same as trying to post its tombstone as a ledger entry.
create trigger lf_balanced_ledger before insert or update on sandbox.transactions
  for each row when (not new.deleted) execute function public.lf_enforce_balanced_ledger();
create trigger lf_balanced_ledger before insert or update on sandbox."journalEntries"
  for each row when (not new.deleted) execute function public.lf_enforce_balanced_ledger();
create trigger lf_transactions_ledger_integrity before insert or update on sandbox.transactions
  for each row when (not new.deleted) execute function public.lf_transactions_ledger_integrity();
create trigger lf_asset_accounting_guard before insert or update or delete on sandbox.assets
  for each row execute function public.lf_asset_accounting_guard();
create trigger lf_chart_account_client_guard before insert on sandbox."chartAccounts"
  for each row execute function public.lf_chart_account_client_guard();
create trigger lf_documents_kind_guard before insert or update on sandbox.documents
  for each row execute function public.lf_documents_kind_guard();
create trigger lf_inventory_cost_guard before update on sandbox.inventory
  for each row execute function public.lf_inventory_cost_guard();
create trigger lf_rma_guard before insert or update on sandbox.customers
  for each row execute function public.lf_rma_guard();
create trigger lf_warranty_guard before insert or update on sandbox.customers
  for each row execute function public.lf_warranty_guard();
create trigger lf_guard_document_settlement before insert or update on sandbox.invoices
  for each row execute function public.lf_guard_document_settlement();
create trigger lf_guard_document_settlement before insert or update on sandbox.bills
  for each row execute function public.lf_guard_document_settlement();
create trigger lf_document_settlement_guard before insert or update on sandbox.invoices
  for each row execute function public.lf_document_settlement_guard();
create trigger lf_document_settlement_guard before insert or update on sandbox.bills
  for each row execute function public.lf_document_settlement_guard();
create trigger lf_document_settlement_guard before insert or update on sandbox."creditNotes"
  for each row execute function public.lf_document_settlement_guard();
create trigger lf_document_settlement_guard before insert or update on sandbox."vendorCredits"
  for each row execute function public.lf_document_settlement_guard();

-- Use the single existing integrity trigger in both modes. Only its account lookups change.
create or replace function public.lf_transactions_ledger_integrity() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  st text := coalesce(new.data->>'status', '');
  tx_type text := coalesce(new.data->>'type', '');
  ws text := coalesce(new.workspace_id, new.data->>'workspaceId', '');
  ln jsonb;
  acct_id text;
  amt_text text;
  total_cents bigint := 0;
  line_count int;
  has_workspace_chart boolean := false;
begin
  -- Privileged test-only escape hatch for ledger-health / orphan-snapshot tests (never callable from browser roles)
  if not public.lf_is_client() and current_setting('lf.allow_corrupt_fixture', true) = 'on' then
    return new;
  end if;

  -- Non-postable entries (matching isPostable in src/lib/txFilters.ts) do not affect the Trial Balance
  if st in ('draft', 'void', 'failed') then
    return new;
  end if;
  if new.data ? 'deletedAt'
     and new.data->'deletedAt' <> 'null'::jsonb
     and coalesce(new.data->>'deletedAt', '') <> '' then
    return new;
  end if;
  if coalesce((new.data->'metadata'->>'isYearEndClose')::boolean, false) then
    return new;
  end if;
  if coalesce((new.data->'metadata'->>'isGhost')::boolean, false)
     or tx_type = 'forecast'
     or new.id like 'ghost-%'
     or ws in ('simulation', 'ghost-workspace') then
    return new;
  end if;

  if ws = '' then
    raise exception 'Posted transaction % must belong to a workspace', new.id
      using errcode = '23514';
  end if;

  -- Header-only / uncategorized entries with 0 journal lines contribute 0 debit and 0 credit
  if not (new.data ? 'lines') or new.data->'lines' = 'null'::jsonb then
    return new;
  end if;
  if jsonb_typeof(new.data->'lines') is distinct from 'array' then
    raise exception 'Posted transaction % must carry a lines array', new.id
      using errcode = '23514';
  end if;

  line_count := jsonb_array_length(new.data->'lines');
  if line_count = 0 then
    return new;
  end if;
  if line_count < 2 then
    raise exception 'Posted transaction % must have at least 2 journal lines (got %)', new.id, line_count
      using errcode = '23514';
  end if;

  has_workspace_chart := case when tg_table_schema = 'sandbox' then exists (
    select 1 from sandbox_read."chartAccounts" c where c.workspace_id = ws
  ) else exists (
    select 1 from public."chartAccounts" c where c.workspace_id = ws
  ) end;

  for ln in select value from jsonb_array_elements(new.data->'lines') loop
    acct_id := coalesce(ln->>'accountId', '');
    if acct_id = '' then
      raise exception 'Posted transaction % contains a line without accountId', new.id
        using errcode = '23503';
    end if;
    if has_workspace_chart then
      if not (case when tg_table_schema = 'sandbox' then exists (
        select 1 from sandbox_read."chartAccounts" c where c.id = acct_id and c.workspace_id = ws
      ) else exists (
        select 1 from public."chartAccounts" c where c.id = acct_id and c.workspace_id = ws
      ) end) then
        raise exception 'Posted transaction % references unknown or foreign chartAccount "%"', new.id, acct_id
          using errcode = '23503';
      end if;
    end if;

    amt_text := coalesce(ln->>'amountCents', '');
    if amt_text !~ '^-?[0-9]+$' then
      raise exception 'Posted transaction % line on account "%" must have integer amountCents', new.id, acct_id
        using errcode = '23514';
    end if;
    total_cents := total_cents + (amt_text::bigint);
  end loop;

  if total_cents <> 0 then
    raise exception 'Unbalanced transaction %: signed line amounts sum to % cents (must equal 0)', new.id, total_cents
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.lf_transactions_ledger_integrity() from public, anon, authenticated;
