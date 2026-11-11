-- Audit C-1 & C-2 (Prerequisite to Strategy 5 "Sell Proof"):
-- 1. Close direct browser writes on core ledger tables (`transactions`, `journalEntries`,
--    `payments`, `reconciliations`). Members still read their workspace's rows (`member_read`
--    stays in place), while every write goes through the validated server API.
-- 2. Prevent browser writers on `invoices` and `bills` from forging paid status, paid totals,
--    or write-offs without a server payment/credit posting, while keeping non-settlement edits
--    (such as notes) working.
-- 3. Enforce balanced whole-cent double-entry lines at the PostgreSQL trigger layer on posted
--    `transactions` and `journalEntries` for ALL callers (server and any future role alike).

do $$
declare
  t text;
begin
  foreach t in array array['transactions', 'journalEntries', 'payments', 'reconciliations'] loop
    execute format('drop policy if exists writer_insert on public.%I', t);
    execute format('drop policy if exists writer_update on public.%I', t);
    execute format('drop policy if exists writer_delete on public.%I', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

update public.lf_rules
   set dated = false,
       delete_draft_only = false
 where table_name in ('transactions', 'journalEntries', 'payments', 'reconciliations');

-- C-1b: Browser writers cannot forge paid/partially_paid status, amountPaidCents, or writtenOffCents
-- on invoices or bills; settlement state is updated only by server payment/credit-note routes.
create or replace function public.lf_guard_document_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_status text := lower(coalesce(new.data->>'status', 'draft'));
  old_status text := case when tg_op = 'UPDATE' then lower(coalesce(old.data->>'status', 'draft')) else '' end;
begin
  if not public.lf_is_client() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new_status in ('paid', 'partially_paid')
       or coalesce(new.data->>'amountPaidCents', '0') <> '0'
       or coalesce(new.data->>'writtenOffCents', '0') <> '0' then
      raise exception 'Document settlement status and paid totals are recorded through the server payment endpoints'
        using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if (new_status is distinct from old_status and new_status in ('paid', 'partially_paid'))
       or ((new.data->'amountPaidCents') is distinct from (old.data->'amountPaidCents')
           and coalesce(new.data->>'amountPaidCents', '0') <> '0')
       or ((new.data->'writtenOffCents') is distinct from (old.data->'writtenOffCents')
           and coalesce(new.data->>'writtenOffCents', '0') <> '0') then
      raise exception 'Document settlement status and paid totals are recorded through the server payment endpoints'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.lf_guard_document_settlement() from public, anon, authenticated;

drop trigger if exists lf_guard_document_settlement on public."invoices";
create trigger lf_guard_document_settlement
  before insert or update on public."invoices"
  for each row execute function public.lf_guard_document_settlement();

drop trigger if exists lf_guard_document_settlement on public."bills";
create trigger lf_guard_document_settlement
  before insert or update on public."bills"
  for each row execute function public.lf_guard_document_settlement();

-- C-2: Database-level double-entry balance & whole-cent enforcement for ALL callers.
create or replace function public.lf_enforce_balanced_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  st text;
  lines_val jsonb;
  line_count int;
  elem jsonb;
  amt_text text;
  base_text text;
  amt_cents bigint;
  net_cents bigint := 0;
  home_cents bigint := 0;
  has_base boolean := false;
begin
  if current_user not in ('anon', 'authenticated')
     and current_setting('lf.allow_corrupt_fixture', true) = 'on' then
    return new;
  end if;

  st := lower(coalesce(new.data->>'status', 'completed'));
  if st in ('draft', 'void', 'failed', 'deleted')
     or (new.data->>'deletedAt') is not null
     or coalesce((new.data->'metadata'->>'isYearEndClose')::boolean, false)
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

  lines_val := new.data->'lines';
  if lines_val is null or jsonb_typeof(lines_val) = 'null' then
    return new;
  end if;

  if jsonb_typeof(lines_val) <> 'array' then
    raise exception 'Ledger lines must be a JSON array';
  end if;

  line_count := jsonb_array_length(lines_val);
  if line_count = 0 then
    return new;
  end if;

  if line_count < 2 then
    raise exception 'Posted ledger entry requires at least two lines (got %)', line_count;
  end if;

  for elem in select value from jsonb_array_elements(lines_val) loop
    amt_text := elem->>'amountCents';
    if amt_text is null or not (amt_text ~ '^-?[0-9]+$') then
      raise exception 'Every ledger line requires whole-cent integer amountCents';
    end if;
    amt_cents := amt_text::bigint;
    net_cents := net_cents + amt_cents;

    if (elem ? 'baseAmountCents') and jsonb_typeof(elem->'baseAmountCents') <> 'null' then
      base_text := elem->>'baseAmountCents';
      if base_text is null or not (base_text ~ '^-?[0-9]+$') then
        raise exception 'Every ledger line baseAmountCents must be whole cents';
      end if;
      has_base := true;
      home_cents := home_cents + base_text::bigint;
    else
      home_cents := home_cents + amt_cents;
    end if;
  end loop;

  if net_cents <> 0 then
    raise exception 'Double-entry violation: ledger lines must sum to 0 cents (got %)', net_cents;
  end if;

  if has_base and home_cents <> 0 then
    raise exception 'Double-entry violation: home-currency baseAmountCents must sum to 0 cents (got %)', home_cents;
  end if;

  return new;
end;
$$;

revoke execute on function public.lf_enforce_balanced_ledger() from public, anon, authenticated;

drop trigger if exists lf_balanced_ledger on public."transactions";
create trigger lf_balanced_ledger
  before insert or update on public."transactions"
  for each row execute function public.lf_enforce_balanced_ledger();

drop trigger if exists lf_balanced_ledger on public."journalEntries";
create trigger lf_balanced_ledger
  before insert or update on public."journalEntries"
  for each row execute function public.lf_enforce_balanced_ledger();
