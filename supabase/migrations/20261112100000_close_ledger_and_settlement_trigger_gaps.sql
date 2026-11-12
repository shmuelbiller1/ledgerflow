-- AF6-011: Close remaining ledger balance & client settlement trigger gaps
-- 1. Enforce balanced non-empty lines on ALL posted rows (including year-end close entries and
--    completed rows with null/empty lines), and compute home-currency line amounts consistently
--    when exchangeRate <> 1.
-- 2. Prevent client writers from flipping documents OUT of settled statuses ('paid','partially_paid',
--    'partial','applied') or mutating refundedCents on creditNotes/vendorCredits.
-- 3. Make recurring.uid immutable for client writers so bookkeepers cannot spoof owner uid to bypass softLockDate.

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
  fx_rate numeric := 1;
begin
  if current_user not in ('anon', 'authenticated')
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

  if (new.data ? 'exchangeRate') and jsonb_typeof(new.data->'exchangeRate') = 'number' then
    fx_rate := coalesce((new.data->>'exchangeRate')::numeric, 1);
  end if;

  lines_val := new.data->'lines';
  if lines_val is null or jsonb_typeof(lines_val) <> 'array' then
    raise exception 'Posted ledger entry requires a JSON lines array';
  end if;

  line_count := jsonb_array_length(lines_val);
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
    elsif fx_rate <> 1 and fx_rate > 0 then
      home_cents := home_cents + round(amt_cents * fx_rate)::bigint;
    else
      home_cents := home_cents + amt_cents;
    end if;
  end loop;

  if net_cents <> 0 then
    raise exception 'Double-entry violation: ledger lines must sum to 0 cents (got %)', net_cents;
  end if;

  if (has_base or fx_rate <> 1) and home_cents <> 0 then
    raise exception 'Double-entry violation: home-currency amounts must sum to 0 cents (got %)', home_cents;
  end if;

  return new;
end;
$$;

revoke execute on function public.lf_enforce_balanced_ledger() from public, anon, authenticated;

create or replace function public.lf_document_settlement_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  new_status text;
  old_status text;
begin
  if not public.lf_is_client() then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    new_status := lower(coalesce(new.data->>'status', 'draft'));
    if new_status in ('paid', 'partially_paid', 'partial', 'applied') then
      raise exception 'Document settlement status "%" can only be recorded by the server ledger', new_status
        using errcode = '42501';
    end if;
    if coalesce((new.data->>'amountPaidCents')::numeric, 0) <> 0
       or coalesce((new.data->>'settledByRecordsCents')::numeric, 0) <> 0
       or coalesce((new.data->>'writtenOffCents')::numeric, 0) <> 0
       or coalesce((new.data->>'refundedCents')::numeric, 0) <> 0
       or coalesce((new.data->>'posted')::boolean, false)
       or new.data ? 'writeOffTransactionId'
       or new.data ? 'writeOffReversalTransactionId'
       or new.data ? 'revenueSchedule'
       or new.data ? 'prepaidSchedule'
       or new.data ? 'paidAt'
       or new.data ? 'paymentDate' then
      raise exception 'Settlement and posting fields on % are written only by the server ledger', tg_table_name
        using errcode = '42501';
    end if;
    if tg_table_name in ('creditNotes', 'vendorCredits')
       and new.data ? 'remainingCents'
       and coalesce((new.data->>'remainingCents')::numeric, 0) <> coalesce((new.data->>'amountCents')::numeric, 0) then
      raise exception 'Credit remaining balance is managed only by the server ledger'
        using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    new_status := lower(coalesce(new.data->>'status', ''));
    old_status := lower(coalesce(old.data->>'status', ''));
    if new_status is distinct from old_status
       and (new_status in ('paid', 'partially_paid', 'partial', 'applied')
            or old_status in ('paid', 'partially_paid', 'partial', 'applied')) then
      raise exception 'Document settlement status transitions ("%s" -> "%s") are managed only by the server ledger', old_status, new_status
        using errcode = '42501';
    end if;
    if (old.data->'amountPaidCents') is distinct from (new.data->'amountPaidCents')
       or (old.data->'settledByRecordsCents') is distinct from (new.data->'settledByRecordsCents')
       or (old.data->'writtenOffCents') is distinct from (new.data->'writtenOffCents')
       or (old.data->'refundedCents') is distinct from (new.data->'refundedCents')
       or (old.data->'writeOffTransactionId') is distinct from (new.data->'writeOffTransactionId')
       or (old.data->'writeOffReversalTransactionId') is distinct from (new.data->'writeOffReversalTransactionId')
       or (old.data->'revenueSchedule') is distinct from (new.data->'revenueSchedule')
       or (old.data->'prepaidSchedule') is distinct from (new.data->'prepaidSchedule')
       or (old.data->'paidAt') is distinct from (new.data->'paidAt')
       or (old.data->'paymentDate') is distinct from (new.data->'paymentDate')
       or (old.data->'posted') is distinct from (new.data->'posted')
       or (old.data->'remainingCents') is distinct from (new.data->'remainingCents') then
      raise exception 'Settlement and posting fields on % are written only by the server ledger', tg_table_name
        using errcode = '42501';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function public.lf_document_settlement_guard() from public, anon, authenticated;

update public.lf_rules
   set immutable_keys = coalesce(immutable_keys, '{}') || array['uid']
 where table_name = 'recurring'
   and not ('uid' = any(coalesce(immutable_keys, '{}')));
