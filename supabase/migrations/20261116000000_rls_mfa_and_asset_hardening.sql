-- Agent #8 security & accounting hardening (2026-11-16):
-- 1. A8-010: Enforce the restrictive two_step_login (private.lf_mfa_ok()) MFA policy on all 13
--    user-accessible tables added after 20260924220000_two_step_login.sql.
-- 2. A8-009: Prevent direct browser INSERT/UPDATE of server-managed `kind`-tagged records or
--    privileged fields (stageSets, recordStage, journal-template, task, timeEntry, paidRunId,
--    sets, lines, assignee) in public.documents while keeping plain Vault/attachment uploads intact.
-- 3. A7N-06 / A8-012: Protect server-managed fixed-asset accounting fields on public.assets
--    (depreciation totals, disposal/transfer/placed-in-service transaction links) against direct
--    browser writes and deletion of depreciated/disposed assets.

-- 1. Restrictive two_step_login policy on all 13 tables missing MFA enforcement
do $$
declare
  t text;
  missing_tables text[] := array[
    'allocationOperations',
    'clientQueries',
    'loans',
    'notifications',
    'paymentAllocations',
    'periodBalances',
    'periodClosings',
    'purchaseOrders',
    'repostQueue',
    'stockClosings',
    'stockMoves',
    'taxReturns',
    'workspaceGroups'
  ];
begin
  foreach t in array missing_tables loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('drop policy if exists two_step_login on public.%I', t);
      execute format(
        'create policy two_step_login on public.%I as restrictive for all to authenticated '
        'using ((select private.lf_mfa_ok())) with check ((select private.lf_mfa_ok()))',
        t
      );
    end if;
  end loop;
end $$;

-- 2. Protect server-managed records in public.documents from direct browser forgery (A8-009)
create or replace function public.lf_documents_kind_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  forbidden_keys text[] := array[
    'kind', 'sets', 'record', 'stage', 'lines', 'assignee', 'dueDate',
    'paidRunId', 'hours', 'minutes', 'person', 'billable', 'invoiceId',
    'employeeId', 'rateCents', 'status'
  ];
  k text;
begin
  if public.lf_is_client() then
    if tg_op = 'UPDATE' and coalesce(old.data->>'kind', '') <> '' then
      raise exception 'Server-managed document records (%) can only be changed through the server', old.data->>'kind'
        using errcode = '42501';
    end if;
    if coalesce(new.data->>'kind', '') <> '' then
      raise exception 'Server-managed document records (%) can only be created through the server', new.data->>'kind'
        using errcode = '42501';
    end if;
    foreach k in array forbidden_keys loop
      if tg_op = 'INSERT' and (new.data ? k) and new.data->k is not null then
        raise exception 'Field "%" on documents is managed by the server', k
          using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and (new.data->k is distinct from old.data->k) then
        raise exception 'Field "%" on documents is managed by the server', k
          using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists lf_documents_kind_guard on public.documents;
create trigger lf_documents_kind_guard
  before insert or update on public.documents
  for each row execute function public.lf_documents_kind_guard();

-- 3. Protect server-managed fixed-asset accounting state on public.assets (A7N-06 / A8-012)
create or replace function public.lf_asset_accounting_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  protected_keys text[] := array[
    'depreciatedThrough',
    'lastDepreciationTransactionId',
    'disposedOn',
    'disposalProceedsCents',
    'disposalGainLossCents',
    'disposalTransactionId',
    'partialDisposals',
    'transfers',
    'placedInService'
  ];
  k text;
begin
  if public.lf_is_client() then
    if tg_op = 'DELETE' then
      if coalesce((old.data->>'accumulatedDepreciationCents')::bigint, 0) > 0
         or coalesce(old.data->>'depreciatedThrough', '') <> ''
         or coalesce(old.data->>'status', '') = 'disposed'
         or coalesce(old.data->>'disposalTransactionId', '') <> ''
         or jsonb_array_length(coalesce(old.data->'partialDisposals', '[]'::jsonb)) > 0
         or jsonb_array_length(coalesce(old.data->'transfers', '[]'::jsonb)) > 0
         or (old.data ? 'placedInService' and old.data->'placedInService' is not null) then
        raise exception 'Assets with posted depreciation, disposals, transfers, or placed-in-service entries cannot be deleted directly'
          using errcode = '42501';
      end if;
      return old;
    end if;

    if tg_op = 'INSERT' then
      if coalesce(new.data->>'status', '') = 'disposed' then
        raise exception 'Assets cannot be created as disposed directly from the browser'
          using errcode = '42501';
      end if;
      if (new.data ? 'accumulatedDepreciationCents')
         and coalesce((new.data->>'accumulatedDepreciationCents')::bigint, 0) <> 0 then
        raise exception 'accumulatedDepreciationCents must start at 0 for browser-created assets'
          using errcode = '42501';
      end if;
      foreach k in array protected_keys loop
        if (new.data ? k) and new.data->k is not null and new.data->k <> '[]'::jsonb then
          raise exception 'Asset accounting field "%" is managed by the server', k
            using errcode = '42501';
        end if;
      end loop;
    elsif tg_op = 'UPDATE' then
      if (new.data->'accumulatedDepreciationCents') is distinct from (old.data->'accumulatedDepreciationCents') then
        raise exception 'accumulatedDepreciationCents is managed by the server'
          using errcode = '42501';
      end if;
      if (new.data->>'status') is distinct from (old.data->>'status')
         and (coalesce(new.data->>'status', '') = 'disposed'
              or coalesce(old.data->>'status', '') = 'disposed'
              or coalesce(old.data->>'status', '') = 'in_progress') then
        raise exception 'Asset lifecycle status transitions must go through the server'
          using errcode = '42501';
      end if;
      foreach k in array protected_keys loop
        if (new.data->k) is distinct from (old.data->k) then
          raise exception 'Asset accounting field "%" is managed by the server', k
            using errcode = '42501';
        end if;
      end loop;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lf_asset_accounting_guard on public.assets;
create trigger lf_asset_accounting_guard
  before insert or update or delete on public.assets
  for each row execute function public.lf_asset_accounting_guard();
