-- Audit C-1 & C-2 (Prerequisite to Strategy 5 "Sell Proof"):
-- 1. Close direct browser writes on core ledger tables (`transactions`, `journalEntries`,
--    `payments`, `reconciliations`). Members still read their workspace's rows (`member_select`
--    stays in place), while every write goes through the validated server API.
-- 2. Prevent browser writers on `invoices` and `bills` from forging paid status, paid totals,
--    or write-offs without a server payment/credit posting.
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

-- Restrict browser writes on invoices & bills so paid status / paid amounts cannot be forged client-side.
drop policy if exists writer_insert on public."invoices";
create policy writer_insert on public."invoices" for insert to authenticated
  with check (
    public.lf_is_writer(workspace_id)
    and coalesce(data->>'status', 'draft') not in ('paid', 'partially_paid')
    and coalesce((data->>'amountPaidCents')::bigint, 0) = 0
    and coalesce((data->>'writtenOffCents')::bigint, 0) = 0
  );

drop policy if exists writer_update on public."invoices";
create policy writer_update on public."invoices" for update to authenticated
  using (public.lf_is_writer(workspace_id))
  with check (
    public.lf_is_writer(workspace_id)
    and coalesce(data->>'status', 'draft') not in ('paid', 'partially_paid')
    and coalesce((data->>'amountPaidCents')::bigint, 0) = 0
    and coalesce((data->>'writtenOffCents')::bigint, 0) = 0
  );

drop policy if exists writer_insert on public."bills";
create policy writer_insert on public."bills" for insert to authenticated
  with check (
    public.lf_is_writer(workspace_id)
    and coalesce(data->>'status', 'draft') not in ('paid', 'partially_paid')
    and coalesce((data->>'amountPaidCents')::bigint, 0) = 0
  );

drop policy if exists writer_update on public."bills";
create policy writer_update on public."bills" for update to authenticated
  using (public.lf_is_writer(workspace_id))
  with check (
    public.lf_is_writer(workspace_id)
    and coalesce(data->>'status', 'draft') not in ('paid', 'partially_paid')
    and coalesce((data->>'amountPaidCents')::bigint, 0) = 0
  );

-- C-2: Database-level double-entry balance & whole-cent enforcement for ALL callers.
create or replace function public.lf_enforce_balanced_ledger()
returns trigger
language plpgsql
as $$
declare
  st text;
  lines_val jsonb;
  line_count int;
  elem jsonb;
  amt_text text;
  net_cents bigint := 0;
  hdr_total bigint := 0;
begin
  st := lower(coalesce(new.data->>'status', 'completed'));
  if st in ('draft', 'void', 'failed', 'deleted') or (new.data->>'deletedAt') is not null then
    return new;
  end if;

  if (new.data ? 'totalAmountCents') and jsonb_typeof(new.data->'totalAmountCents') = 'number' then
    if not ((new.data->>'totalAmountCents') ~ '^-?[0-9]+$') then
      raise exception 'Ledger totalAmountCents must be whole cents';
    end if;
    hdr_total := (new.data->>'totalAmountCents')::bigint;
  end if;

  lines_val := new.data->'lines';
  if lines_val is null or jsonb_typeof(lines_val) = 'null' then
    if hdr_total <> 0 then
      raise exception 'Posted ledger entry with a non-zero total requires balanced lines';
    end if;
    return new;
  end if;

  if jsonb_typeof(lines_val) <> 'array' then
    raise exception 'Ledger lines must be a JSON array';
  end if;

  line_count := jsonb_array_length(lines_val);
  if line_count = 0 then
    if hdr_total <> 0 then
      raise exception 'Posted ledger entry with a non-zero total requires balanced lines';
    end if;
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
    net_cents := net_cents + amt_text::bigint;
  end loop;

  if net_cents <> 0 then
    raise exception 'Double-entry violation: ledger lines must sum to 0 cents (got %)', net_cents;
  end if;

  return new;
end;
$$;

drop trigger if exists lf_balanced_ledger on public."transactions";
create trigger lf_balanced_ledger
  before insert or update on public."transactions"
  for each row execute function public.lf_enforce_balanced_ledger();

drop trigger if exists lf_balanced_ledger on public."journalEntries";
create trigger lf_balanced_ledger
  before insert or update on public."journalEntries"
  for each row execute function public.lf_enforce_balanced_ledger();
