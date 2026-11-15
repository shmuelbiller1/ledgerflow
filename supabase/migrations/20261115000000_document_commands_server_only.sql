-- AF-12: Documents are posted by the registered server commands, not direct browser writes.
-- The command pipeline preserves the existing document/posting transaction, period-lock,
-- approval, credit-limit, audit, and idempotency safeguards. Clients retain workspace reads,
-- while all document inserts, edits, and deletes go through that pipeline.

do $$
declare
  t text;
begin
  foreach t in array array['invoices', 'bills', 'creditNotes', 'vendorCredits'] loop
    execute format('drop policy if exists writer_insert on public.%I', t);
    execute format('drop policy if exists writer_update on public.%I', t);
    execute format('drop policy if exists writer_delete on public.%I', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- These field/date/delete rules govern browser writes. The server authenticates and checks
-- each command itself; an empty allowlist makes the server-only boundary explicit in lf_rules.
update public.lf_rules
   set allowed_keys = '{}',
       dated = false,
       date_required = false,
       delete_draft_only = false
 where table_name in ('invoices', 'bills', 'creditNotes', 'vendorCredits');

-- Warranty history is now changed through warranty.update so the server can revalidate the issued
-- invoice serial and append an actor-stamped change log atomically. As with the RMA guard, browser
-- clients may continue editing other customer fields but cannot write or replace warranty metadata.
create or replace function public.lf_warranty_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not public.lf_is_client() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.data->'metadata'->'warrantiesById', '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Warranty history is changed through the server (Warehouse → Warranty register)'
        using errcode = '42501';
    end if;
  elsif (old.data->'metadata'->'warrantiesById') is distinct from (new.data->'metadata'->'warrantiesById') then
    raise exception 'Warranty history is changed through the server (Warehouse → Warranty register)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists lf_warranty_guard on public.customers;
create trigger lf_warranty_guard before insert or update on public.customers
  for each row execute function public.lf_warranty_guard();

-- Automation rules are now created, changed, and removed through the command registry so the
-- server can enforce workspace membership and role for every rule operation.
drop policy if exists writer_insert on public."autoRules";
drop policy if exists writer_update on public."autoRules";
drop policy if exists writer_delete on public."autoRules";
revoke insert, update, delete on public."autoRules" from authenticated;

update public.lf_rules
   set allowed_keys = '{}',
       dated = false,
       date_required = false,
       delete_draft_only = false
 where table_name = 'autoRules';
