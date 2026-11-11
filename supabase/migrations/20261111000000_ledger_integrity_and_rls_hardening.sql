-- Ledger integrity, server-only accounting doors & complete lf_rules allowlists (C-1, M-5, F-03, F-09c):
-- 1. C-1: Direct browser writes to ledger, payment, journal, reconciliation, and sharded-counter tables are
--    revoked; workspace members keep SELECT (member_read) so live ledger/report views stay reactive, while all
--    mutations pass through the server ledger door (DoubleEntryValidator, period lock, idempotency, audit trail).
-- 2. C-1: Direct browser writes to document settlement fields (status paid/partially_paid/applied, amountPaidCents,
--    settledByRecordsCents, writtenOffCents, revenue/prepaid schedules) and nonzero chartAccounts balances are
--    refused; auditLogs UPDATE/DELETE privileges are revoked from authenticated; loginAudits gains own_read.
-- 3. M-5: Database trigger on public.transactions enforces postable double-entry balance (sum(amountCents) = 0,
--    >= 2 lines) and chartAccounts workspace referential integrity regardless of caller (server or client).
-- 4. F-03: Every public.lf_rules row carries an explicit allowed_keys allowlist (server-only tables get '{}';
--    client-writable tables get explicit model-backed field lists and immutable workspaceId/server fields).

-- ============================================================================
-- 1. Server-only write enforcement on ledger & settlement tables (C-1)
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['transactions', 'journalEntries', 'payments', 'reconciliations', 'workspaceShards'] loop
    execute format('drop policy if exists writer_insert on public.%I', t);
    execute format('drop policy if exists writer_update on public.%I', t);
    execute format('drop policy if exists writer_delete on public.%I', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

update public.lf_rules
   set dated = false,
       date_required = false,
       delete_draft_only = false
 where table_name in ('transactions', 'journalEntries', 'payments');

-- Append-only auditLogs: revoke table-level UPDATE/DELETE so client DELETE raises 42501 instead of 0 rows
revoke update, delete on public."auditLogs" from authenticated;

-- F-09c: Allow authenticated users to inspect their own server-recorded sign-in audit rows
revoke insert, update, delete on public."loginAudits" from authenticated;
grant select on public."loginAudits" to authenticated;
drop policy if exists own_read on public."loginAudits";
create policy own_read on public."loginAudits" for select to authenticated
  using (data->>'uid' = public.lf_uid());

-- ============================================================================
-- 2. Client settlement & account-balance guards (C-1)
-- ============================================================================
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
    new_status := coalesce(new.data->>'status', 'draft');
    if new_status in ('paid', 'partially_paid', 'partial', 'applied') then
      raise exception 'Document settlement status "%" can only be recorded by the server ledger', new_status
        using errcode = '42501';
    end if;
    if coalesce((new.data->>'amountPaidCents')::numeric, 0) <> 0
       or coalesce((new.data->>'settledByRecordsCents')::numeric, 0) <> 0
       or coalesce((new.data->>'writtenOffCents')::numeric, 0) <> 0
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
    new_status := coalesce(new.data->>'status', '');
    old_status := coalesce(old.data->>'status', '');
    if new_status is distinct from old_status
       and new_status in ('paid', 'partially_paid', 'partial', 'applied') then
      raise exception 'Document settlement status "%" can only be recorded by the server ledger', new_status
        using errcode = '42501';
    end if;
    if (old.data->'amountPaidCents') is distinct from (new.data->'amountPaidCents')
       or (old.data->'settledByRecordsCents') is distinct from (new.data->'settledByRecordsCents')
       or (old.data->'writtenOffCents') is distinct from (new.data->'writtenOffCents')
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

drop trigger if exists lf_document_settlement_guard on public.invoices;
create trigger lf_document_settlement_guard before insert or update on public.invoices
  for each row execute function public.lf_document_settlement_guard();

drop trigger if exists lf_document_settlement_guard on public.bills;
create trigger lf_document_settlement_guard before insert or update on public.bills
  for each row execute function public.lf_document_settlement_guard();

drop trigger if exists lf_document_settlement_guard on public."creditNotes";
create trigger lf_document_settlement_guard before insert or update on public."creditNotes"
  for each row execute function public.lf_document_settlement_guard();

drop trigger if exists lf_document_settlement_guard on public."vendorCredits";
create trigger lf_document_settlement_guard before insert or update on public."vendorCredits"
  for each row execute function public.lf_document_settlement_guard();

create or replace function public.lf_chart_account_client_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not public.lf_is_client() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce((new.data->>'balanceCents')::numeric, 0) <> 0
       or coalesce((new.data->>'openingBalanceCents')::numeric, 0) <> 0 then
      raise exception 'Account balances must start at zero and be established via balanced ledger entries'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.lf_chart_account_client_guard() from public, anon, authenticated;

drop trigger if exists lf_chart_account_client_guard on public."chartAccounts";
create trigger lf_chart_account_client_guard before insert on public."chartAccounts"
  for each row execute function public.lf_chart_account_client_guard();

drop policy if exists admin_update on public."chartAccounts";
create policy admin_update on public."chartAccounts" for update to authenticated
  using (public.lf_is_member(workspace_id))
  with check (public.lf_can_admin(workspace_id));

-- ============================================================================
-- 3. Database-level double-entry & chartAccounts integrity trigger (M-5)
-- ============================================================================
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

  has_workspace_chart := exists (
    select 1 from public."chartAccounts" c where c.workspace_id = ws
  );

  for ln in select value from jsonb_array_elements(new.data->'lines') loop
    acct_id := coalesce(ln->>'accountId', '');
    if acct_id = '' then
      raise exception 'Posted transaction % contains a line without accountId', new.id
        using errcode = '23503';
    end if;
    if has_workspace_chart and not exists (
      select 1 from public."chartAccounts" c
       where c.id = acct_id
         and c.workspace_id = ws
    ) then
      raise exception 'Posted transaction % references unknown or foreign chartAccount "%"', new.id, acct_id
        using errcode = '23503';
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

drop trigger if exists lf_transactions_ledger_integrity on public.transactions;
create trigger lf_transactions_ledger_integrity before insert or update on public.transactions
  for each row execute function public.lf_transactions_ledger_integrity();

-- ============================================================================
-- 4. Complete lf_rules field allowlists across all 47 remaining tables (F-03)
-- ============================================================================

-- 4a. Server-only write tables: empty allowlist '{}' blocks all fields if ever reached by a client
update public.lf_rules set allowed_keys = '{}' where table_name = 'admins';
update public.lf_rules set allowed_keys = '{}' where table_name = 'allocationOperations';
update public.lf_rules set allowed_keys = '{}' where table_name = 'apiKeys';
update public.lf_rules set allowed_keys = '{}' where table_name = 'bankLines';
update public.lf_rules set allowed_keys = '{}' where table_name = 'banks';
update public.lf_rules set allowed_keys = '{}' where table_name = 'billingLedgerTraces';
update public.lf_rules set allowed_keys = '{}' where table_name = 'clientQueries';
update public.lf_rules set allowed_keys = '{}' where table_name = 'deepAuditJobs';
update public.lf_rules set allowed_keys = '{}' where table_name = 'emailEvents';
update public.lf_rules set allowed_keys = '{}' where table_name = 'external_api_cache';
update public.lf_rules set allowed_keys = '{}' where table_name = 'idempotencyKeys';
update public.lf_rules set allowed_keys = '{}' where table_name = 'invites';
update public.lf_rules set allowed_keys = '{}' where table_name = 'jobRuns';
update public.lf_rules set allowed_keys = '{}' where table_name = 'journalEntries';
update public.lf_rules set allowed_keys = '{}' where table_name = 'loginAudits';
update public.lf_rules set allowed_keys = '{}' where table_name = 'members';
update public.lf_rules set allowed_keys = '{}' where table_name = 'numberingSeries';
update public.lf_rules set allowed_keys = '{}' where table_name = 'payRuns';
update public.lf_rules set allowed_keys = '{}' where table_name = 'paymentAllocations';
update public.lf_rules set allowed_keys = '{}' where table_name = 'payments';
update public.lf_rules set allowed_keys = '{}' where table_name = 'periodBalances';
update public.lf_rules set allowed_keys = '{}' where table_name = 'periodClosings';
update public.lf_rules set allowed_keys = '{}' where table_name = 'reconciliations';
update public.lf_rules set allowed_keys = '{}' where table_name = 'recoveryCodes';
update public.lf_rules set allowed_keys = '{}' where table_name = 'repostQueue';
update public.lf_rules set allowed_keys = '{}' where table_name = 'stockClosings';
update public.lf_rules set allowed_keys = '{}' where table_name = 'stockMoves';
update public.lf_rules set allowed_keys = '{}' where table_name = 'stripeProcessedEvents';
update public.lf_rules set allowed_keys = '{}' where table_name = 'taxReturns';
update public.lf_rules set allowed_keys = '{}' where table_name = 'transactions';
update public.lf_rules set allowed_keys = '{}' where table_name = 'workspaceGroups';
update public.lf_rules set allowed_keys = '{}' where table_name = 'workspaceShards';

-- 4b. Client-writable workspace tables: model-backed allowlists (kept <600 chars per UPDATE)
update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','customerId','customerName','vendorId','number','amountCents','amountPaidCents','settledByRecordsCents','writtenOffCents','writeOffTransactionId','writeOffReason','writtenOffAt','writeOffReversalTransactionId','revenueSchedule','exchangeRate','taxAmountCents','taxRate','taxCents','salesTaxCents','date','dueDate','tags','metadata','status','type','recurringInterval','paymentTerms']
where table_name = 'invoices';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['items','lines','notes','progressPercentage','approval','discountCents','retainageCents','depositCents','taxInclusive','taxVersion','lineSumCents','taxCodeId','taxTreatment','taxBreakdown','pricesIncludeTax','posted','currency','paymentDate','paidAt','milestone','isLocked','lockedAt','paymentToken','reversalEventId','createdAt','updatedAt','viewedAt','lastViewedAt','viewCount']
where table_name = 'invoices';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','vendorId','vendorName','number','amountCents','currency','exchangeRate','taxAmountCents','taxRate','taxCents','salesTaxCents','receiptUrl','tags','metadata','splits','lines','notes','projectId','issueDate','date','dueDate','status','amountPaidCents','settledByRecordsCents','paymentDate','paidAt','reversalEventId','prepaidSchedule']
where table_name = 'bills';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['isLocked','lockedAt','paymentToken','discountCents','retainageCents','depositCents','taxInclusive','taxVersion','lineSumCents','taxCodeId','taxTreatment','taxBreakdown','pricesIncludeTax','selfAssessedTaxCents','posted','createdAt','updatedAt']
where table_name = 'bills';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','customerId','customerName','number','amountCents','currency','exchangeRate','date','expiryDate','status','convertedInvoiceId','orderedAt','orderedBy','customerReference','signToken','signTokenAt','signature','milestones','lines','items','metadata','notes','tags','taxRate','taxAmountCents','discountCents','createdAt','updatedAt'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['workspaceId']
where table_name = 'estimates';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','name','sku','binLocations','description','unitPriceCents','unitCostCents','standardCostCents','quantityAtHand','reorderPoint','locationLevels','measurementUnit','unitsPerPackage','consignment','category','itemType','defaultTaxCodeId','productTaxCategory','bundleParts','assembleOnDemand']
where table_name = 'inventory';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['cogsAccountId','inventoryAccountId','incomeAccountId','image','tags','status','metadata','createdAt','updatedAt','importBatchId'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['importBatchId']
where table_name = 'inventory';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','name','description','amountCents','currency','exchangeRate','frequency','cron','startDate','endDate','nextOccurrence','anchorDay','isActive','status','lastOccurrence','payee','customerId','vendorId','type','lines','template','invoiceTemplate','metadata','createdAt','updatedAt','generatedAt','generatedCount','lastErrorCode','lastErrorAt','cursorVersion'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['workspaceId']
where table_name = 'recurring';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','name','targetId','targetType','period','startDate','endDate','amountCents','currency','exchangeRate','notes','metadata','createdAt','updatedAt'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['workspaceId']
where table_name = 'budgets';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','name','groupName','groupIsActive','condition','action','confidence','isHardened','priority','isActive','stopProcessingOnMatch','hitCount','lastTriggeredAt','createdBy','metadata','createdAt','updatedAt'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['workspaceId']
where table_name = 'autoRules';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','name','description','category','purchaseDate','purchasePriceCents','salvageValueCents','usefulLifeYears','depreciationMethod','accumulatedDepreciationCents','status','createdAt','updatedAt','assetAccountId','expenseAccountId','accumulatedAccountId','depreciatedThrough','lastDepreciationTransactionId','disposedOn','disposalProceedsCents','disposalGainLossCents','disposalTransactionId']
where table_name = 'fixedAssets';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['costAdditions','placedInService','assetTag','location','transfers','warrantyExpires','insuranceRenews','maintenance','nextServiceDue','partialDisposals','sourceBillId','sourceBillLine','notes','tags','metadata'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['workspaceId']
where table_name = 'fixedAssets';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','name','description','category','purchaseDate','purchasePriceCents','salvageValueCents','usefulLifeYears','depreciationMethod','accumulatedDepreciationCents','status','createdAt','updatedAt','assetAccountId','expenseAccountId','accumulatedAccountId','depreciatedThrough','lastDepreciationTransactionId','disposedOn','disposalProceedsCents','disposalGainLossCents','disposalTransactionId']
where table_name = 'assets';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['costAdditions','placedInService','assetTag','location','transfers','warrantyExpires','insuranceRenews','maintenance','nextServiceDue','partialDisposals','sourceBillId','sourceBillLine','notes','tags','metadata'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['workspaceId']
where table_name = 'assets';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','name','code','rate','type','treatment','components','appliesTo','timeSeries','jurisdiction','country','region','isActive','status','description','metadata','createdAt','updatedAt'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['workspaceId']
where table_name = 'taxRates';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','dimensionId','name','value','description','aliases','status','parentId','color','metadata','createdAt','updatedAt'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['workspaceId']
where table_name = 'dimensionNodes';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','name','category','email','phone','website','taxId','taxNumber','paymentTerms','terms','billsExpected','type','status','pipelineStage','is1099','isForeign','rating','tags','metadata','balanceCents','address','currency','deliveryMethod','contacts','noteLog','notes','importBatchId','bankDetails','linkedVendorId','createdAt','updatedAt'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['workspaceId','importBatchId']
where table_name = 'vendors';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','name','email','phone','role','salaryCents','payFrequency','status','department','state','filingStatus','preTaxDeductionsCents','allowances','lastPayDate','createdAt','updatedAt','workerType','ptoHoursPerYear','ptoOpeningHours','ptoTaken','deductions','bankRouting','bankAccount','bankAccountType','payType','hourlyRateCents','timeUid','notes','metadata'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['workspaceId']
where table_name = 'employees';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','name','email','role','share','initialCapitalCents','balanceCents','status','notes','metadata','createdAt','updatedAt'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['workspaceId']
where table_name = 'partners';

update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['id','uid','workspaceId','kind','name','title','description','fileUrl','mimeType','sizeBytes','tags','linkedCollection','linkedId','linkedLabel','linkedTransactionId','status','assignee','dueDate','priority','notes','metadata','sets','lines','paidRunId','hours','date','employeeId','rateCents','createdAt','updatedAt'],
    immutable_keys = coalesce(immutable_keys, '{}') || array['workspaceId']
where table_name = 'documents';
