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

-- Preserve live and overlay ledger behavior except for the test-fixture switch.
-- In these SECURITY DEFINER triggers, current_user sees the function owner.
-- Restrict the fixture exception using the target schema instead of the role.
create or replace function public.lf_enforce_balanced_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  st text;
  lines_val jsonb;
  settled_lines jsonb := '[]'::jsonb;
  line_count int;
  i int;
  elem jsonb;
  amt_text text;
  base_text text;
  amt_cents bigint;
  base_value bigint;
  net_cents bigint := 0;
  explicit_home_cents bigint := 0;
  home_cents bigint := 0;
  any_base boolean := false;
  all_base boolean := true;
  all_rate_one boolean := true;
  fx_rate numeric := 1;
  line_rate numeric;
  residual bigint;
  largest_index int := 1;
  largest_abs numeric := -1;
  base_values bigint[] := array[]::bigint[];
  foreign_rates numeric[] := array[]::numeric[];
begin
  if tg_table_schema = 'public' and current_user not in ('anon', 'authenticated')
     and current_setting('lf.allow_corrupt_fixture', true) = 'on' then
    return new;
  end if;

  st := lower(coalesce(new.data->>'status', 'completed'));
  if st in ('draft', 'void', 'failed', 'deleted')
     or (new.data->>'deletedAt') is not null
     or coalesce((new.data->'metadata'->>'isGhost')::boolean, false)
     or coalesce(new.data->>'type', '') = 'forecast'
     or new.id like 'ghost-%'
     or coalesce(new.workspace_id, new.data->>'workspaceId', '') in ('simulation', 'ghost-workspace') then
    return new;
  end if;

  if (new.data ? 'totalAmountCents') and jsonb_typeof(new.data->'totalAmountCents') = 'number' then
    if not ((new.data->>'totalAmountCents') ~ '^-?[0-9]+$') then
      raise exception 'Ledger totalAmountCents must be whole cents';
    end if;
  end if;

  if new.data ? 'exchangeRate' and jsonb_typeof(new.data->'exchangeRate') not in ('number', 'null') then
    raise exception 'Ledger exchangeRate must be a number';
  end if;
  if jsonb_typeof(new.data->'exchangeRate') = 'number' then
    fx_rate := coalesce((new.data->>'exchangeRate')::numeric, 1);
  end if;
  if fx_rate <= 0 then
    raise exception 'Ledger exchangeRate must be positive';
  end if;

  lines_val := new.data->'lines';
  if lines_val is null or jsonb_typeof(lines_val) <> 'array' then
    raise exception 'Posted ledger entry requires a JSON lines array';
  end if;

  line_count := jsonb_array_length(lines_val);
  if line_count < 2 then
    raise exception 'Posted ledger entry requires at least two lines (got %)', line_count;
  end if;

  -- Keep this calculation byte-for-byte compatible with settleHomeCurrency in src/lib/txFilters.ts:
  -- line rates override the entry rate, conversion is ordinary Math.round-style whole-cent rounding,
  -- and a small residual at one foreign rate is assigned to the largest converted line.
  for elem in select value from jsonb_array_elements(lines_val) loop
    amt_text := elem->>'amountCents';
    if amt_text is null or not (amt_text ~ '^-?[0-9]+$') then
      raise exception 'Every ledger line requires whole-cent integer amountCents';
    end if;
    amt_cents := amt_text::bigint;
    net_cents := net_cents + amt_cents;

    if elem ? 'baseAmountCents' and jsonb_typeof(elem->'baseAmountCents') <> 'null' then
      base_text := elem->>'baseAmountCents';
      if base_text is null or not (base_text ~ '^-?[0-9]+$') then
        raise exception 'Every ledger line baseAmountCents must be whole cents';
      end if;
      any_base := true;
      explicit_home_cents := explicit_home_cents + base_text::bigint;
    else
      all_base := false;
    end if;

    if elem ? 'exchangeRate' and jsonb_typeof(elem->'exchangeRate') not in ('number', 'null') then
      raise exception 'Every ledger line exchangeRate must be a number';
    end if;
    if jsonb_typeof(elem->'exchangeRate') = 'number' then
      line_rate := coalesce((elem->>'exchangeRate')::numeric, fx_rate);
    else
      line_rate := fx_rate;
    end if;
    if line_rate <= 0 then
      raise exception 'Every ledger line exchangeRate must be positive';
    end if;

    if line_rate <> 1 then
      all_rate_one := false;
      if not (line_rate = any(foreign_rates)) then
        foreign_rates := array_append(foreign_rates, line_rate);
      end if;
    end if;
    base_value := floor(amt_cents::numeric * line_rate + 0.5)::bigint;
    base_values := array_append(base_values, base_value);
    if abs(base_value::numeric) > largest_abs then
      largest_abs := abs(base_value::numeric);
      largest_index := array_length(base_values, 1);
    end if;
  end loop;

  if net_cents <> 0 then
    raise exception 'Double-entry violation: ledger lines must sum to 0 cents (got %)', net_cents;
  end if;

  if any_base and not all_base then
    raise exception 'Ledger baseAmountCents must be present on every line or none';
  end if;

  if all_base then
    if explicit_home_cents <> 0 then
      raise exception 'Double-entry violation: home-currency amounts must sum to 0 cents (got %)', explicit_home_cents;
    end if;
    return new;
  end if;

  if all_rate_one then
    return new;
  end if;

  for i in 1..line_count loop
    home_cents := home_cents + base_values[i];
  end loop;
  if home_cents = 0 then
    return new;
  end if;

  residual := home_cents;
  if cardinality(foreign_rates) > 1 or abs(residual) > line_count then
    raise exception 'Double-entry violation: home-currency amounts must sum to 0 cents (got %); add an exchange-difference line', home_cents;
  end if;

  -- This is the same residual settlement as the application: adjust the largest converted
  -- line, then persist every settled home amount so reports cannot apply FX twice.
  base_values[largest_index] := base_values[largest_index] - residual;
  for i in 1..line_count loop
    settled_lines := settled_lines || jsonb_set(lines_val->(i - 1), '{baseAmountCents}', to_jsonb(base_values[i]), true);
  end loop;
  new.data := jsonb_set(new.data, '{lines}', settled_lines, true);
  return new;
end;
$$;

revoke execute on function public.lf_enforce_balanced_ledger() from public, anon, authenticated;

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
