-- #825: lf_rules describes storage, not consent to read a live collection. Only reviewed
-- workspace book collections get live reads. Credential, person and operational tables, and any
-- newly registered collection, get overlay-only views unless explicitly reviewed here.
create or replace function sandbox.has_live_book_read(t text) returns boolean
language sql immutable strict set search_path = '' as $$
  select t = any (array[
    'allocationOperations', 'assets', 'auditLogs', 'autoRules', 'bankLines', 'bills', 'budgets',
    'chartAccounts', 'clientQueries', 'creditNotes', 'customers', 'dimensionNodes', 'documents',
    'employees', 'estimates', 'fixedAssets', 'inventory', 'invoices', 'journalEntries', 'loans',
    'numberingSeries', 'partners', 'payRuns', 'paymentAllocations', 'payments', 'periodBalances',
    'periodClosings', 'periods', 'projects', 'purchaseOrders', 'reconciliations', 'recurring',
    'repostQueue', 'rulePatterns', 'scenarios', 'stockClosings', 'stockMoves', 'taxRates',
    'taxReturns', 'transactions', 'vendorCredits', 'vendors', 'workspaces'
  ]::text[])
$$;
revoke execute on function sandbox.has_live_book_read(text) from public, anon, authenticated, service_role, lf_sandbox;

-- Shared by installation and the upgrade below. The view cannot reference a denied live table,
-- even behind WHERE false: invoker-security views check the privileges of referenced relations.
create or replace procedure sandbox.configure_overlay_reads(t text)
language plpgsql set search_path = '' as $$
declare
  scope_key text := case when t = 'workspaces' then 'id' else 'workspace_id' end;
  live_source text := '';
begin
  if not exists (select from pg_catalog.pg_class where oid = format('public.%I', t)::regclass and relrowsecurity) then
    raise exception 'Enable RLS on public.% before configuring sandbox reads', t;
  end if;
  execute format('drop policy if exists sandbox_read_workspace on public.%I', t);
  execute format('drop policy if exists sandbox_no_live_read on public.%I', t);
  if sandbox.has_live_book_read(t) then
    execute format('grant select on public.%I to lf_sandbox', t);
    execute format($ddl$
      create policy sandbox_read_workspace on public.%1$I for select to lf_sandbox
        using (%2$I = (select sandbox.active_workspace()))$ddl$, t, scope_key);
    -- Explicit scope here is also required when a SECURITY DEFINER trigger reads this view.
    live_source := format($ddl$
      select live.id, live.data, live.workspace_id, live.created_at, live.updated_at
      from public.%1$I live
      where live.%2$I = (select sandbox.active_workspace())
        and not exists (
          select from sandbox.%1$I draft
          where draft.sandbox_id = (select sandbox.active_id()) and draft.id = live.id
        )
      union all
    $ddl$, t, scope_key);
  else
    execute format('revoke select on public.%I from lf_sandbox', t);
    -- Block rows even if a broad grant or permissive policy is added later. A live login
    -- may inherit membership in lf_sandbox; do not deny its own reads before SET ROLE.
    execute format($ddl$
      create policy sandbox_no_live_read on public.%I as restrictive for select to lf_sandbox
        using (current_user <> 'lf_sandbox')$ddl$, t);
  end if;

  execute format($ddl$
    create or replace view sandbox_read.%1$I with (security_invoker = true) as
      %2$s
      select draft.id, draft.data, draft.workspace_id, draft.created_at, draft.updated_at
      from sandbox.%1$I draft
      where draft.sandbox_id = (select sandbox.active_id())
        and (select sandbox.active_workspace()) is not null and not draft.deleted
  $ddl$, t, live_source);
  execute format('revoke all on sandbox_read.%I from public, anon, authenticated, service_role', t);
  execute format('grant select on sandbox_read.%I to lf_sandbox', t);
end $$;
revoke execute on procedure sandbox.configure_overlay_reads(text) from public, anon, authenticated, service_role, lf_sandbox;

create or replace procedure sandbox.install_overlay(t text)
language plpgsql set search_path = '' as $$
declare
  has_workspace_column boolean;
  overlay_scope text;
begin
  if not exists (select from public.lf_rules where table_name = t) then
    raise exception 'Register public.% in lf_rules before installing its sandbox overlay', t;
  end if;
  if not exists (select from pg_catalog.pg_class where oid = format('public.%I', t)::regclass and relrowsecurity) then
    raise exception 'Enable RLS on public.% before installing its sandbox overlay', t;
  end if;

  has_workspace_column := exists (select from pg_catalog.pg_attribute
    where attrelid = format('public.%I', t)::regclass and attname = 'workspace_id' and not attisdropped);
  if sandbox.has_live_book_read(t) and not has_workspace_column then
    raise exception 'Cannot grant sandbox reads on unscoped public.%', t;
  end if;
  overlay_scope := case when t = 'workspaces'
    then 'id = (select sandbox.active_workspace()) and (workspace_id is null or workspace_id = id)'
    else 'workspace_id = (select sandbox.active_workspace())' end;

  -- Keep storage coverage and the original copy-on-write constraints, without granting live access.
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

  call sandbox.configure_overlay_reads(t);

  if exists (select from pg_catalog.pg_trigger
    where tgrelid = format('public.%I', t)::regclass and tgname = 'lf_guard') then
    -- Keep updated_at. Browser-only checks are not the command runner's authorization policy.
    execute format('create trigger lf_guard before insert or update or delete on sandbox.%I
      for each row execute function public.lf_guard()', t);
  end if;
end $$;
revoke execute on procedure sandbox.install_overlay(text) from public, anon, authenticated, service_role, lf_sandbox;

do $$
declare
  t text;
begin
  for t in select table_name from public.lf_rules where not sandbox.has_live_book_read(table_name) order by table_name loop
    call sandbox.configure_overlay_reads(t);
  end loop;
end $$;

-- Keep the same ledger trigger in both paths. Only the test-fixture exception changes.
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
  -- Live test fixtures only. In this SECURITY DEFINER trigger, current_user is the
  -- owner of the function, not the role running the write. Check the target schema.
  if tg_table_schema = 'public' and not public.lf_is_client()
     and current_setting('lf.allow_corrupt_fixture', true) = 'on' then
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
