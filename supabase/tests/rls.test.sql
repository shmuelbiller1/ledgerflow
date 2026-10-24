-- Row level security tests (replaces the Firestore rules emulator tests).
-- Run against a database with the migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls.test.sql
-- Every check raises an exception when the result is not the expected one, and the
-- whole run is rolled back, so it can run against any database without leaving data.

begin;

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', uid, 'email', uid || '@test.local')::text, true);
  execute 'set local role authenticated';
end $$;

-- expect_ok / expect_denied run one statement as a user inside a savepoint-like block
create function pg_temp.expect_ok(label text, uid text, stmt text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(uid);
  begin
    execute stmt;
  exception when others then
    execute 'reset role';
    raise exception 'FAIL %: expected ok, got: %', label, sqlerrm;
  end;
  execute 'reset role';
end $$;

create function pg_temp.expect_denied(label text, uid text, stmt text) returns void language plpgsql as $$
declare denied boolean := false;
begin
  perform pg_temp.as_user(uid);
  begin
    execute stmt;
  exception when others then
    denied := true;
  end;
  execute 'reset role';
  if not denied then
    raise exception 'FAIL %: expected to be refused, but it succeeded', label;
  end if;
end $$;

create function pg_temp.expect_count(label text, uid text, q text, expected bigint) returns void language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.as_user(uid);
  execute q into n;
  execute 'reset role';
  if n is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, n;
  end if;
end $$;

create function pg_temp.expect_value(label text, q text, expected text) returns void language plpgsql as $$
declare v text;
begin
  execute q into v;
  if v is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, v;
  end if;
end $$;

-- workspace ws1: owner u-owner; accountant u-acct; bookkeeper u-book; viewer u-view. u-out is an outsider.
select pg_temp.expect_ok('owner creates workspace', 'u-owner',
  $$insert into workspaces(id,data) values ('ws1', '{"uid":"u-owner","name":"Acme","roles":{"u-acct":"accountant","u-book":"bookkeeper","u-view":"viewer"}}')$$);
select pg_temp.expect_denied('create a workspace owned by someone else', 'u-out',
  $$insert into workspaces(id,data) values ('ws-x', '{"uid":"u-owner","name":"X"}')$$);
select pg_temp.expect_denied('create a workspace on a paid plan', 'u-out',
  $$insert into workspaces(id,data) values ('ws-y', '{"uid":"u-out","name":"Y","plan":"enterprise"}')$$);

-- documents: members read, writers write, outsiders see nothing
select pg_temp.expect_ok('bookkeeper adds invoice', 'u-book',
  $$insert into invoices(id,data) values ('inv1', '{"workspaceId":"ws1","status":"sent","date":"2026-03-01","amountCents":1000}')$$);
select pg_temp.expect_denied('viewer adds invoice', 'u-view',
  $$insert into invoices(id,data) values ('inv2', '{"workspaceId":"ws1","status":"draft","date":"2026-03-01"}')$$);
select pg_temp.expect_count('viewer reads invoices', 'u-view', 'select count(*) from invoices', 1);
select pg_temp.expect_count('outsider reads invoices', 'u-out', 'select count(*) from invoices', 0);
select pg_temp.expect_denied('outsider writes into ws1', 'u-out',
  $$insert into invoices(id,data) values ('inv3', '{"workspaceId":"ws1","status":"draft"}')$$);
select pg_temp.expect_denied('move a document to another workspace', 'u-book',
  $$select lf_update('invoices','inv1','{"workspaceId":"ws2"}'::jsonb)$$);

-- drafts only may be deleted
select pg_temp.expect_denied('delete a sent invoice', 'u-book', $$select lf_delete('invoices','inv1')$$);
select pg_temp.expect_ok('delete a draft invoice', 'u-book',
  $$insert into invoices(id,data) values ('inv4', '{"workspaceId":"ws1","status":"draft","date":"2026-03-02"}'); select lf_delete('invoices','inv4')$$);

-- lock date
select pg_temp.expect_denied('bookkeeper sets the lock date', 'u-book',
  $$select lf_update('workspaces','ws1','{"lockDate":"2026-01-31"}'::jsonb)$$);
select pg_temp.expect_denied('accountant sets the lock date from the browser (closing goes through the server)', 'u-acct',
  $$select lf_update('workspaces','ws1','{"lockDate":"2026-01-31"}'::jsonb)$$);
do $$ begin
  perform set_config('request.jwt.claims', '', true);
  update workspaces set data = data || '{"lockDate":"2026-01-31"}'::jsonb where id = 'ws1';
end $$;
select pg_temp.expect_denied('transaction in a locked period', 'u-book',
  $$insert into transactions(id,data) values ('tx1', '{"workspaceId":"ws1","date":"2026-01-15","lines":[]}')$$);
select pg_temp.expect_denied('transaction without a date while locked', 'u-book',
  $$insert into transactions(id,data) values ('tx2', '{"workspaceId":"ws1","lines":[]}')$$);
select pg_temp.expect_ok('transaction in an open period', 'u-book',
  $$insert into transactions(id,data) values ('tx3', '{"workspaceId":"ws1","date":"2026-02-01","status":"draft","lines":[]}')$$);
select pg_temp.expect_denied('move a transaction into a locked period', 'u-book',
  $$select lf_update('transactions','tx3','{"date":"2026-01-10"}'::jsonb)$$);

-- soft close (only owners/accountants post) and partial unlock, both set by the server
do $$ begin
  perform set_config('request.jwt.claims', '', true);
  update workspaces set data = data || '{"softLockDate":"2026-02-28","lockException":{"fromDate":"2026-01-10","toDate":"2026-01-20"}}'::jsonb where id = 'ws1';
end $$;
select pg_temp.expect_denied('bookkeeper posts into a soft-closed month', 'u-book',
  $$insert into transactions(id,data) values ('tx-soft-b', '{"workspaceId":"ws1","date":"2026-02-10","lines":[]}')$$);
select pg_temp.expect_ok('accountant posts an adjustment into a soft-closed month', 'u-acct',
  $$insert into transactions(id,data) values ('tx-soft-a', '{"workspaceId":"ws1","date":"2026-02-10","status":"draft","lines":[]}')$$);
select pg_temp.expect_ok('bookkeeper posts inside the partial unlock', 'u-book',
  $$insert into transactions(id,data) values ('tx-unl', '{"workspaceId":"ws1","date":"2026-01-15","status":"draft","lines":[]}')$$);
select pg_temp.expect_denied('bookkeeper posts outside the partial unlock', 'u-book',
  $$insert into transactions(id,data) values ('tx-unl2', '{"workspaceId":"ws1","date":"2026-01-25","lines":[]}')$$);
select pg_temp.expect_denied('owner removes the partial unlock from the browser', 'u-owner',
  $$select lf_update('workspaces','ws1','{}'::jsonb,'{lockException}')$$);
select pg_temp.expect_denied('browser writes a close record', 'u-owner',
  $$insert into periods(id,data) values ('ws1_2026-01', '{"workspaceId":"ws1","periodId":"2026-01","status":"closed"}')$$);
do $$ begin
  perform set_config('request.jwt.claims', '', true);
  delete from transactions where id in ('tx-soft-a', 'tx-unl');
  update workspaces set data = data - 'softLockDate' - 'lockException' where id = 'ws1';
end $$;

-- workspace billing fields can't be changed by users
select pg_temp.expect_denied('owner changes plan', 'u-owner',
  $$select lf_update('workspaces','ws1','{"plan":"enterprise"}'::jsonb)$$);

-- workspace settings owners/accountants save (time zone, fiscal year, CSV maps) vs server-only fields
select pg_temp.expect_ok('owner saves time zone and fiscal year', 'u-owner',
  $$select lf_update('workspaces','ws1','{"timezone":"America/New_York","fiscalYearStartMonth":4,"fiscalYearStartDay":1}'::jsonb)$$);
select pg_temp.expect_ok('accountant saves CSV column maps', 'u-acct',
  $$select lf_update('workspaces','ws1','{"importColumnMaps":{"bank-1":{"date":"Posted"}}}'::jsonb)$$);
select pg_temp.expect_denied('bookkeeper changes workspace settings', 'u-book',
  $$select lf_update('workspaces','ws1','{"timezone":"UTC"}'::jsonb)$$);
select pg_temp.expect_denied('owner sets a server-only field', 'u-owner',
  $$select lf_update('workspaces','ws1','{"creditCostMultiplier":0}'::jsonb)$$);
select pg_temp.expect_denied('create a workspace with a server-only field', 'u-out',
  $$insert into workspaces(id,data) values ('ws-z', '{"uid":"u-out","name":"Z","creditCostMultiplier":0}')$$);
do $$ begin
  -- the server marks a workspace for deletion; the owner can still save settings afterwards
  perform set_config('request.jwt.claims', '', true);
  update workspaces set data = data || '{"scheduledPurgeAt":"2026-12-31"}'::jsonb where id = 'ws1';
end $$;
select pg_temp.expect_ok('owner saves settings on a workspace with server-only fields', 'u-owner',
  $$select lf_update('workspaces','ws1','{"timezone":"Europe/London"}'::jsonb)$$);
select pg_temp.expect_denied('owner clears a server-only field', 'u-owner',
  $$select lf_update('workspaces','ws1','{}'::jsonb,'{scheduledPurgeAt}')$$);

-- allowed fields
select pg_temp.expect_denied('customer with an unknown field', 'u-book',
  $$insert into customers(id,data) values ('c1', '{"workspaceId":"ws1","name":"A","hack":1}')$$);
select pg_temp.expect_ok('customer', 'u-book',
  $$insert into customers(id,data) values ('c2', '{"workspaceId":"ws1","name":"A"}')$$);
select pg_temp.expect_ok('customer form (with status)', 'u-book',
  $$insert into customers(id,data) values ('c3', '{"workspaceId":"ws1","name":"B","email":"b@x.test","phone":"1","status":"active","balanceCents":0,"uid":"u-book","createdAt":"2026-05-01"}')$$);
select pg_temp.expect_ok('customer with people, tags, currency, address and notes (Y-21 Y-22 Y-24 Y-25)', 'u-book',
  $$insert into customers(id,data) values ('c4', '{"workspaceId":"ws1","name":"C","currency":"EUR","tags":["vip"],"address":"1 Main St","contacts":[{"name":"Dana","email":"d@x.test"}],"noteLog":[{"id":"n1","text":"Called","at":"2026-10-03T09:00:00Z"}]}')$$);
select pg_temp.expect_ok('template account with a role (FX rounding)', 'u-acct',
  $$insert into "chartAccounts"(id,data) values ('a-fx', '{"workspaceId":"ws1","name":"FX Rounding","type":"expense","category":"Rounding Differences","subtype":"rounding","role":"fx_rounding","code":"8999"}')$$);

-- stock quantities change only through the server (L-173)
select pg_temp.expect_ok('item with a name and cost', 'u-book',
  $$insert into inventory(id,data) values ('i1', '{"workspaceId":"ws1","name":"Widget","sku":"W1","unitCostCents":400,"quantityAtHand":0}')$$);
select pg_temp.expect_ok('edit an item''s price', 'u-book',
  $$select lf_update('inventory','i1','{"unitPriceCents":900}'::jsonb)$$);
select pg_temp.expect_denied('change an item''s quantity in the browser', 'u-book',
  $$select lf_update('inventory','i1','{"quantityAtHand":50}'::jsonb)$$);

-- the cost of stock on hand changes only through the server's revaluation (ISS-130)
select pg_temp.expect_ok('set the cost of an item with nothing on hand (a template)', 'u-book',
  $$select lf_update('inventory','i1','{"unitCostCents":450}'::jsonb)$$);
-- the server (not a browser role) puts stock on hand, as Adjust stock does
do $$ begin
  perform set_config('request.jwt.claims', '', true);
  update inventory set data = data || '{"quantityAtHand":10}'::jsonb where id = 'i1';
end $$;
select pg_temp.expect_denied('change the cost of stock on hand in the browser', 'u-book',
  $$select lf_update('inventory','i1','{"unitCostCents":1200}'::jsonb)$$);
select pg_temp.expect_denied('owner cannot either: only the revaluation changes it', 'u-owner',
  $$select lf_update('inventory','i1','{"unitCostCents":1200}'::jsonb)$$);
select pg_temp.expect_ok('rename the stocked item in the browser (the cost is untouched)', 'u-book',
  $$select lf_update('inventory','i1','{"name":"Widget L"}'::jsonb)$$);
-- #259 review: stock below zero has no value on the books, so its cost stays editable
do $$ begin
  perform set_config('request.jwt.claims', '', true);
  update inventory set data = data || '{"quantityAtHand":-2}'::jsonb where id = 'i1';
end $$;
select pg_temp.expect_ok('set the cost of an item sold below zero (no value on the books)', 'u-book',
  $$select lf_update('inventory','i1','{"unitCostCents":1250}'::jsonb)$$);

-- only owners and accountants approve or send back an invoice (BE-04, L-191)
select pg_temp.expect_ok('bookkeeper saves an invoice waiting for approval', 'u-book',
  $$insert into invoices(id,data) values ('inv-appr', '{"workspaceId":"ws1","customerId":"c2","amountCents":150000,"status":"pending","date":"2026-10-05","approval":{"state":"awaiting","thresholdCents":100000}}')$$);
select pg_temp.expect_denied('bookkeeper approves it', 'u-book',
  $$select lf_update('invoices','inv-appr','{"approval":{"state":"approved","thresholdCents":100000}}'::jsonb)$$);
select pg_temp.expect_denied('bookkeeper creates an invoice already approved', 'u-book',
  $$insert into invoices(id,data) values ('inv-appr2', '{"workspaceId":"ws1","customerId":"c2","amountCents":150000,"status":"pending","date":"2026-10-05","approval":{"state":"approved","thresholdCents":100000}}')$$);
select pg_temp.expect_ok('bookkeeper edits the invoice, leaving the approval alone', 'u-book',
  $$select lf_update('invoices','inv-appr','{"notes":"PO 77"}'::jsonb)$$);
select pg_temp.expect_ok('accountant approves it', 'u-acct',
  $$select lf_update('invoices','inv-appr','{"approval":{"state":"approved","thresholdCents":100000}}'::jsonb)$$);

-- imported records (server-created with importBatchId) stay editable; the batch id is fixed
do $$ begin
  perform set_config('request.jwt.claims', '', true);
  insert into customers(id,data) values ('c-imp', '{"workspaceId":"ws1","name":"Imported","importBatchId":"imp_0123456789abcdef"}');
end $$;
select pg_temp.expect_ok('edit an imported customer', 'u-book',
  $$select lf_update('customers','c-imp','{"phone":"555"}'::jsonb)$$);
select pg_temp.expect_denied('change an import batch id', 'u-book',
  $$select lf_update('customers','c-imp','{"importBatchId":"imp_ffffffffffffffff"}'::jsonb)$$);

-- chart of accounts
select pg_temp.expect_denied('bookkeeper adds an account', 'u-book',
  $$insert into "chartAccounts"(id,data) values ('a1', '{"workspaceId":"ws1","name":"Cash","type":"asset"}')$$);
select pg_temp.expect_ok('accountant adds a system account', 'u-acct',
  $$insert into "chartAccounts"(id,data) values ('a2', '{"workspaceId":"ws1","name":"Cash","type":"asset","code":"1000","isSystem":true}')$$);
select pg_temp.expect_denied('change a system account code', 'u-acct',
  $$select lf_update('chartAccounts','a2','{"code":"9999"}'::jsonb)$$);
select pg_temp.expect_denied('delete a system account', 'u-acct', $$select lf_delete('chartAccounts','a2')$$);

-- server-only tables
select pg_temp.expect_denied('browser writes a bank line', 'u-owner',
  $$insert into "bankLines"(id,data) values ('b1', '{"workspaceId":"ws1"}')$$);
select pg_temp.expect_denied('browser reads idempotency keys', 'u-owner',
  $$do $d$ begin if (select count(*) from "idempotencyKeys") >= 0 then null; end if; end $d$;
    insert into "idempotencyKeys"(id,data) values ('k1','{}')$$);

-- audit logs: append-only, identity must match
select pg_temp.expect_denied('audit log with a spoofed uid', 'u-book',
  $$insert into "auditLogs"(id,data) values ('l1', '{"workspaceId":"ws1","uid":"u-owner","action":"X"}')$$);
select pg_temp.expect_ok('audit log as yourself', 'u-book',
  $$insert into "auditLogs"(id,data) values ('l2', '{"workspaceId":"ws1","uid":"u-book","email":"u-book@test.local","action":"X","timestamp":"2026-01-01T00:00:00Z"}')$$);
select pg_temp.expect_ok('viewer logs a sign-in', 'u-view',
  $$insert into "auditLogs"(id,data) values ('l3', '{"workspaceId":"ws1","uid":"u-view","action":"USER_LOGIN"}')$$);
select pg_temp.expect_denied('viewer logs another action', 'u-view',
  $$insert into "auditLogs"(id,data) values ('l4', '{"workspaceId":"ws1","uid":"u-view","action":"DELETE_ALL"}')$$);
select pg_temp.expect_denied('edit an audit log', 'u-owner', $$select lf_update('auditLogs','l2','{"action":"Y"}'::jsonb)$$);
select pg_temp.expect_denied('delete an audit log', 'u-owner', $$select lf_delete('auditLogs','l2')$$);

-- user profiles
select pg_temp.expect_denied('make yourself a platform admin', 'u-out',
  $$insert into users(id,data) values ('u-out', '{"uid":"u-out","email":"u-out@test.local","role":"admin"}')$$);
select pg_temp.expect_ok('create your own profile', 'u-out',
  $$insert into users(id,data) values ('u-out', '{"uid":"u-out","email":"u-out@test.local","role":"client"}')$$);
select pg_temp.expect_count('read another user profile', 'u-book', $$select count(*) from users where id='u-out'$$, 0);

-- write helpers keep Firestore semantics
select pg_temp.expect_ok('update with a dotted path', 'u-book',
  $$select lf_update('customers','c2','{"address.city":"Paris","name":"B"}'::jsonb)$$);
select pg_temp.expect_value('dotted path result', $$select data::text from customers where id='c2'$$,
  '{"name": "B", "address": {"city": "Paris"}, "workspaceId": "ws1"}');
select pg_temp.expect_denied('update a missing document', 'u-book',
  $$select lf_update('customers','nope','{"name":"x"}'::jsonb)$$);
select pg_temp.expect_ok('set with merge', 'u-book',
  $$select lf_set('customers','c2','{"address":{"zip":"75001"}}'::jsonb, true)$$);
select pg_temp.expect_value('merge result', $$select data::text from customers where id='c2'$$,
  '{"name": "B", "address": {"zip": "75001", "city": "Paris"}, "workspaceId": "ws1"}');
select pg_temp.expect_ok('unset a field', 'u-book', $$select lf_update('customers','c2','{}'::jsonb, '{address.city}')$$);
select pg_temp.expect_value('unset result', $$select data::text from customers where id='c2'$$,
  '{"name": "B", "address": {"zip": "75001"}, "workspaceId": "ws1"}');
select pg_temp.expect_ok('increment twice', 'u-owner',
  $$select lf_update('invoices','inv1','{}'::jsonb,'{}','{"amountPaidCents":250}'::jsonb);
    select lf_update('invoices','inv1','{}'::jsonb,'{}','{"amountPaidCents":250}'::jsonb)$$);
select pg_temp.expect_value('increment result', $$select data->>'amountPaidCents' from invoices where id='inv1'$$, '500');
select pg_temp.expect_ok('array union then remove', 'u-owner',
  $$select lf_update('workspaces','ws1','{}'::jsonb,'{}','{}'::jsonb,'{"members":["u-a","u-b"]}'::jsonb);
    select lf_update('workspaces','ws1','{}'::jsonb,'{}','{}'::jsonb,'{"members":["u-b","u-c"]}'::jsonb,'{"members":["u-a"]}'::jsonb)$$);
select pg_temp.expect_value('array result', $$select (data->'members')::text from workspaces where id='ws1'$$, '["u-b", "u-c"]');
select pg_temp.expect_denied('batch with one refused write', 'u-book',
  $$select lf_batch('[{"op":"set","table":"vendors","id":"v1","data":{"workspaceId":"ws1","name":"V"}},{"op":"set","table":"bankLines","id":"b9","data":{"workspaceId":"ws1"}}]'::jsonb)$$);
select pg_temp.expect_value('batch is all-or-nothing', $$select count(*)::text from vendors where id='v1'$$, '0');
select pg_temp.expect_denied('batch on a system table', 'u-book',
  $$select lf_batch('[{"op":"delete","table":"pg_authid","id":"x"}]'::jsonb)$$);

-- ===== Table-driven checks (ported from the Firestore rules suite) =====

create function pg_temp.try_as(uid text, stmt text) returns boolean language plpgsql as $$
begin
  perform pg_temp.as_user(uid);
  begin
    execute stmt;
  exception when others then
    execute 'reset role';
    return false;
  end;
  execute 'reset role';
  return true;
end $$;

create function pg_temp.count_rows(uid text, q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.as_user(uid);
  execute q into n;
  execute 'reset role';
  return n;
end $$;

-- Every standard workspace table: writers add, viewers only read, outsiders see and change nothing.
do $$
declare
  t text;
  doc text;
begin
  foreach t in array array[
    'transactions','journalEntries','invoices','payments','bills','creditNotes','vendorCredits',
    'projects','estimates','inventory','recurring','budgets','autoRules','fixedAssets','assets',
    'taxRates','dimensionNodes','vendors','customers','rulePatterns','scenarios','loans',
    'employees','partners','reconciliations','workspaceShards'
  ] loop
    doc := case when t = 'transactions' then '{"workspaceId":"ws1","date":"2026-02-15","status":"draft"}'
                else '{"workspaceId":"ws1"}' end;
    if not pg_temp.try_as('u-book', format('insert into public.%I (id, data) values (%L, %L::jsonb)', t, 'iso-' || t, doc)) then
      raise exception 'FAIL %: bookkeeper could not add a document', t;
    end if;
    if pg_temp.try_as('u-view', format('insert into public.%I (id, data) values (%L, %L::jsonb)', t, 'iso-v-' || t, doc)) then
      raise exception 'FAIL %: viewer added a document', t;
    end if;
    if pg_temp.try_as('u-out', format('insert into public.%I (id, data) values (%L, %L::jsonb)', t, 'iso-o-' || t, doc)) then
      raise exception 'FAIL %: outsider added a document', t;
    end if;
    if pg_temp.count_rows('u-view', format('select count(*) from public.%I where id = %L', t, 'iso-' || t)) <> 1 then
      raise exception 'FAIL %: viewer cannot read', t;
    end if;
    if pg_temp.count_rows('u-out', format('select count(*) from public.%I where id = %L', t, 'iso-' || t)) <> 0 then
      raise exception 'FAIL %: outsider can read', t;
    end if;
    if pg_temp.try_as('u-out', format('select lf_update(%L, %L, %L::jsonb)', t, 'iso-' || t, '{"workspaceId":"ws1"}')) then
      raise exception 'FAIL %: outsider updated a document', t;
    end if;
    if pg_temp.try_as('u-view', format('select lf_update(%L, %L, %L::jsonb)', t, 'iso-' || t, '{"workspaceId":"ws1"}')) then
      raise exception 'FAIL %: viewer updated a document', t;
    end if;
  end loop;
end $$;

-- AUD-09 / AI #6: every standard write family must reject cross-workspace moves by an authorized writer.
do $audit$
declare
  t text;
begin
  foreach t in array array[
    'transactions', 'journalEntries', 'invoices', 'payments', 'bills', 'creditNotes', 'vendorCredits',
    'projects', 'estimates', 'inventory', 'recurring', 'budgets', 'autoRules', 'fixedAssets', 'assets',
    'taxRates', 'dimensionNodes', 'vendors', 'customers', 'rulePatterns', 'scenarios', 'loans',
    'employees', 'partners', 'reconciliations', 'workspaceShards'
  ] loop
    if pg_temp.try_as('u-book', format('select lf_update(%L, %L, %L::jsonb)', t, 'iso-' || t, '{"workspaceId":"ws2"}')) then
      raise exception 'FAIL %: writer moved an existing record into another workspace', t;
    end if;
    -- A refused call is not enough: prove the durable record still belongs to ws1.
    if pg_temp.count_rows('u-view', format(
      'select count(*) from public.%I where id = %L and data->>''workspaceId'' = %L',
      t, 'iso-' || t, 'ws1')) <> 1 then
      raise exception 'FAIL %: cross-workspace move changed the durable workspaceId', t;
    end if;
  end loop;
end $audit$;

-- Every dated table: nothing is posted into, or moved into, a locked period (ws1 is locked to 2026-01-31).
do $$
declare t text;
begin
  for t in select table_name from public.lf_rules where dated order by 1 loop
    if pg_temp.try_as('u-book', format('insert into public.%I (id, data) values (%L, %L::jsonb)', t, 'lock-in-' || t,
        '{"workspaceId":"ws1","date":"2026-01-15","status":"draft"}')) then
      raise exception 'FAIL %: posted into a locked period', t;
    end if;
    if not pg_temp.try_as('u-book', format('insert into public.%I (id, data) values (%L, %L::jsonb)', t, 'lock-out-' || t,
        '{"workspaceId":"ws1","date":"2026-02-15","status":"draft"}')) then
      raise exception 'FAIL %: could not post into an open period', t;
    end if;
    if pg_temp.try_as('u-book', format('select lf_update(%L, %L, %L::jsonb)', t, 'lock-out-' || t, '{"date":"2026-01-10"}')) then
      raise exception 'FAIL %: moved a document into a locked period', t;
    end if;
  end loop;
end $$;

-- Every financial document table: only drafts can be deleted (void instead).
do $$
declare
  t text;
  st text;
begin
  for t in select table_name from public.lf_rules where delete_draft_only order by 1 loop
    foreach st in array array['sent', 'posted', 'paid', 'void'] loop
      perform set_config('request.jwt.claims', '', true);
      execute format('insert into public.%I (id, data) values (%L, %L::jsonb)', t, 'del-' || st || '-' || t,
        json_build_object('workspaceId', 'ws1', 'date', '2026-02-20', 'status', st)::text);
      if pg_temp.try_as('u-owner', format('select lf_delete(%L, %L)', t, 'del-' || st || '-' || t)) then
        raise exception 'FAIL %: deleted a % document', t, st;
      end if;
    end loop;
    if not pg_temp.try_as('u-owner', format('select lf_delete(%L, %L)', t, 'lock-out-' || t)) then
      raise exception 'FAIL %: could not delete a draft', t;
    end if;
  end loop;
end $$;

-- Server-only tables: no browser reads or writes at all.
do $$
declare t text;
begin
  foreach t in array array['stripeProcessedEvents','idempotencyKeys','external_api_cache','jobRuns','loginAudits',
                           'emailEvents','numberingSeries','members','banks','admins'] loop
    perform set_config('request.jwt.claims', '', true);
    execute format('insert into public.%I (id, data) values (%L, %L::jsonb)', t, 'srv-' || t, '{"workspaceId":"ws1","uid":"u-owner"}');
    if pg_temp.count_rows('u-owner', format('select count(*) from public.%I', t)) <> 0 then
      raise exception 'FAIL %: a browser user can read a server-only table', t;
    end if;
    if pg_temp.try_as('u-owner', format('insert into public.%I (id, data) values (%L, %L::jsonb)', t, 'cli-' || t, '{"workspaceId":"ws1"}')) then
      raise exception 'FAIL %: a browser user can write a server-only table', t;
    end if;
  end loop;
end $$;

-- Platform admin comes from app_metadata (set by the server), never from an email address.
do $$
declare n bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', 'u-evil', 'email', 'admin@ledgerflow.app')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from workspaces where id = 'ws1';
  execute 'reset role';
  if n <> 0 then raise exception 'FAIL an admin-looking email reads other workspaces'; end if;

  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', 'u-admin', 'app_metadata', json_build_object('admin', true))::text, true);
  execute 'set local role authenticated';
  select count(*) into n from workspaces where id = 'ws1';
  execute 'reset role';
  if n <> 1 then raise exception 'FAIL a platform admin cannot read workspaces'; end if;
end $$;

-- Profiles and balances the browser may not change
select pg_temp.expect_denied('change your own role', 'u-out', $$select lf_update('users','u-out','{"role":"admin"}'::jsonb)$$);
select pg_temp.expect_denied('profile with someone else''s email', 'u-new',
  $$insert into users(id,data) values ('u-new', '{"uid":"u-new","email":"other@test.local","role":"client"}')$$);
select pg_temp.expect_denied('change an account balance', 'u-acct', $$select lf_update('chartAccounts','a2','{"balanceCents":999}'::jsonb)$$);
select pg_temp.expect_denied('change an opening balance', 'u-acct', $$select lf_update('chartAccounts','a2','{"openingBalanceCents":5}'::jsonb)$$);
select pg_temp.expect_ok('posting without a lock date', 'u-out',
  $$insert into workspaces(id,data) values ('ws-open', '{"uid":"u-out","name":"Open"}');
    insert into transactions(id,data) values ('tx-open', '{"workspaceId":"ws-open","date":"2020-01-01","lines":[]}')$$);

-- Support tickets and messages
select pg_temp.expect_ok('member opens a ticket', 'u-view',
  $$insert into "supportTickets"(id,data) values ('t1', '{"workspaceId":"ws1","uid":"u-view","subject":"Help","status":"open","createdAt":"2026-02-01"}')$$);
select pg_temp.expect_denied('open a ticket for someone else', 'u-view',
  $$insert into "supportTickets"(id,data) values ('t2', '{"workspaceId":"ws1","uid":"u-book","subject":"Help","status":"open"}')$$);
select pg_temp.expect_denied('outsider opens a ticket in ws1', 'u-out',
  $$insert into "supportTickets"(id,data) values ('t3', '{"workspaceId":"ws1","uid":"u-out","subject":"Help","status":"open"}')$$);
select pg_temp.expect_count('outsider reads ws1 tickets', 'u-out', $$select count(*) from "supportTickets" where workspace_id = 'ws1'$$, 0);
select pg_temp.expect_ok('user closes their ticket', 'u-view', $$select lf_update('supportTickets','t1','{"status":"closed"}'::jsonb)$$);
select pg_temp.expect_denied('user reopens a ticket', 'u-view', $$select lf_update('supportTickets','t1','{"status":"open"}'::jsonb)$$);
select pg_temp.expect_ok('member posts a message', 'u-view',
  $$insert into "supportMessages"(id,data) values ('m1', '{"ticketId":"t1","workspaceId":"ws1","authorUid":"u-view","authorRole":"user","body":"Hi"}')$$);
select pg_temp.expect_denied('member poses as support staff', 'u-view',
  $$insert into "supportMessages"(id,data) values ('m2', '{"ticketId":"t1","workspaceId":"ws1","authorUid":"u-view","authorRole":"admin","body":"Hi"}')$$);
select pg_temp.expect_denied('edit a message', 'u-view', $$select lf_update('supportMessages','m1','{"body":"changed"}'::jsonb)$$);

-- filed tax returns: written only by the server; members read; nobody changes them from the browser
select set_config('request.jwt.claims', '', true);
insert into "taxReturns" (id, data) values ('tr1', '{"workspaceId":"ws1","startDate":"2026-07-01","endDate":"2026-09-30","boxes":[]}');
select pg_temp.expect_count('viewer reads filed returns', 'u-view', $$select count(*) from "taxReturns"$$, 1);
select pg_temp.expect_count('outsider reads filed returns', 'u-out', $$select count(*) from "taxReturns"$$, 0);
select pg_temp.expect_denied('owner changes a filed return', 'u-owner', $$select lf_update('taxReturns','tr1','{"boxes":[{"key":"1","cents":0}]}'::jsonb)$$);
select pg_temp.expect_denied('owner files a return from the browser', 'u-owner',
  $$insert into "taxReturns"(id,data) values ('tr2', '{"workspaceId":"ws1","startDate":"2026-01-01","endDate":"2026-03-31"}')$$);

-- recovery codes (L-85): server only; nobody reads or writes them from the browser, not even their owner
select set_config('request.jwt.claims', '', true);
insert into "recoveryCodes" (id, data) values ('u-owner', '{"uid":"u-owner","codes":[]}');
select pg_temp.expect_denied('owner reads their recovery codes', 'u-owner', $$select count(*) from "recoveryCodes"$$);
select pg_temp.expect_denied('owner writes recovery codes', 'u-owner', $$select lf_set('recoveryCodes','u-owner','{"uid":"u-owner","codes":[]}'::jsonb)$$);

-- questions about entries (BD-07): written only by the server; members read; nobody writes them from the browser
select set_config('request.jwt.claims', '', true);
insert into "clientQueries" (id, data) values ('cq1', '{"workspaceId":"ws1","transactionId":"t1","status":"open","messages":[]}');
select pg_temp.expect_count('viewer reads questions', 'u-view', $$select count(*) from "clientQueries"$$, 1);
select pg_temp.expect_count('outsider reads questions', 'u-out', $$select count(*) from "clientQueries"$$, 0);
select pg_temp.expect_denied('owner answers from the browser', 'u-owner', $$select lf_update('clientQueries','cq1','{"status":"answered"}'::jsonb)$$);
select pg_temp.expect_denied('bookkeeper asks from the browser', 'u-book',
  $$insert into "clientQueries"(id,data) values ('cq2', '{"workspaceId":"ws1","transactionId":"t1","status":"open"}')$$);

-- stock moves (W-02): the history of each item's quantity, written only by the server with the change; members read
select set_config('request.jwt.claims', '', true);
insert into "stockMoves" (id, data) values ('sm1', '{"workspaceId":"ws1","itemId":"i1","kind":"sale","quantity":-2,"quantityBefore":5,"quantityAfter":3,"seq":"1"}');
select pg_temp.expect_count('viewer reads the stock history', 'u-view', $$select count(*) from "stockMoves"$$, 1);
select pg_temp.expect_count('outsider reads no stock history', 'u-out', $$select count(*) from "stockMoves"$$, 0);
select pg_temp.expect_denied('owner rewrites the stock history from the browser', 'u-owner', $$select lf_update('stockMoves','sm1','{"quantityAfter":30}'::jsonb)$$);
select pg_temp.expect_denied('bookkeeper adds a stock move from the browser', 'u-book',
  $$insert into "stockMoves"(id,data) values ('sm2', '{"workspaceId":"ws1","itemId":"i1","kind":"adjustment","quantity":5}')$$);

-- pay runs (U-02, U-10): posted, approved and undone only by the server; members read
select set_config('request.jwt.claims', '', true);
insert into "payRuns" (id, data) values ('pr1', '{"workspaceId":"ws1","date":"2026-02-15","status":"awaiting_approval"}');
select pg_temp.expect_count('viewer reads pay runs', 'u-view', $$select count(*) from "payRuns"$$, 1);
select pg_temp.expect_count('outsider reads pay runs', 'u-out', $$select count(*) from "payRuns"$$, 0);
select pg_temp.expect_denied('owner approves a pay run from the browser', 'u-owner', $stmt$select lf_update('payRuns','pr1','{"status":"processed"}'::jsonb)$stmt$);
select pg_temp.expect_denied('owner cannot move a pay run to another workspace', 'u-owner',
  $stmt$select lf_update('payRuns','pr1','{"workspaceId":"ws2"}'::jsonb)$stmt$);
select pg_temp.expect_value('refused pay-run move leaves workspace unchanged',
  $q$select data->>'workspaceId' from "payRuns" where id = 'pr1'$q$, 'ws1');
select pg_temp.expect_denied('bookkeeper adds a pay run from the browser', 'u-book',
  $$insert into "payRuns"(id,data) values ('pr2', '{"workspaceId":"ws1","date":"2026-02-15","status":"processed"}')$$);
select pg_temp.expect_denied('owner deletes a pay run from the browser', 'u-owner', $$delete from "payRuns" where id = 'pr1'$$);

-- S-01 rate-limit counters: server only — no member reads, writes or deletes them from the browser
insert into "rateLimitEntries" (id, data) values ('rl_t1', '{"keyHash":"t1","count":1,"windowStart":0,"workspaceId":"ws1"}');
select pg_temp.expect_denied('owner reads rate-limit counters', 'u-owner', $$select count(*) from "rateLimitEntries"$$);
select pg_temp.expect_denied('owner resets a rate-limit counter', 'u-owner', $$select lf_update('rateLimitEntries','rl_t1','{"count":0}'::jsonb)$$);
select pg_temp.expect_denied('owner writes a rate-limit counter', 'u-owner', $$select lf_set('rateLimitEntries','rl_t2','{"keyHash":"t2","count":0,"windowStart":0,"workspaceId":"ws1"}'::jsonb)$$);
select pg_temp.expect_denied('owner deletes a rate-limit counter', 'u-owner', $$delete from "rateLimitEntries" where id = 'rl_t1'$$);

-- purchase orders: members read; owners, accountants and bookkeepers write
select pg_temp.expect_ok('bookkeeper saves a purchase order', 'u-book',
  $stmt$insert into "purchaseOrders"(id,data) values ('po1', '{"workspaceId":"ws1","poNumber":"PO-2026-001","vendorId":"v1","vendorName":"V","status":"approved","items":[],"totalAmountCents":1000,"receipts":[]}')$stmt$);
select pg_temp.expect_denied('bookkeeper cannot move a purchase order to another workspace',
  'u-book', $stmt$select lf_update('purchaseOrders','po1','{"workspaceId":"ws2"}'::jsonb)$stmt$);
select pg_temp.expect_value('refused purchase-order move leaves workspace unchanged',
  $q$select data->>'workspaceId' from "purchaseOrders" where id = 'po1'$q$, 'ws1');
select pg_temp.expect_count('viewer reads purchase orders', 'u-view', $$select count(*) from "purchaseOrders"$$, 1);
select pg_temp.expect_denied('viewer changes a purchase order', 'u-view', $$select lf_update('purchaseOrders','po1','{"status":"cancelled"}'::jsonb)$$);
select pg_temp.expect_count('outsider reads purchase orders', 'u-out', $$select count(*) from "purchaseOrders"$$, 0);
select pg_temp.expect_denied('purchase order with an unknown field', 'u-book',
  $$insert into "purchaseOrders"(id,data) values ('po2', '{"workspaceId":"ws1","poNumber":"PO-2","hacked":true}')$$);
select pg_temp.expect_ok('accountant records goods received and the bill', 'u-acct',
  $$select lf_update('purchaseOrders','po1','{"status":"billed","billId":"b1","receipts":[{"id":"r1"}]}'::jsonb)$$);

-- notifications: the server writes one row per person; each person sees and marks only their own
select set_config('request.jwt.claims', '', true);
insert into notifications (id, data) values
  ('n-view', '{"workspaceId":"ws1","uid":"u-view","kind":"payment.received","title":"Paid","message":"m","read":false}'),
  ('n-book', '{"workspaceId":"ws1","uid":"u-book","kind":"payment.received","title":"Paid","message":"m","read":false}'),
  ('n-out',  '{"workspaceId":"ws1","uid":"u-out","kind":"member.joined","title":"Old","message":"m","read":false}');
select pg_temp.expect_count('a person sees only their own notifications', 'u-view', 'select count(*) from notifications', 1);
select pg_temp.expect_count('the owner does not see others'' notifications', 'u-owner', 'select count(*) from notifications', 0);
select pg_temp.expect_count('someone no longer in the workspace sees nothing', 'u-out', 'select count(*) from notifications', 0);
select pg_temp.expect_ok('mark own notification read', 'u-view',
  $$select lf_update('notifications','n-view','{"read":true,"readAt":"2026-09-28T10:00:00Z"}'::jsonb)$$);
select pg_temp.expect_denied('change the text of a notification', 'u-view',
  $$select lf_update('notifications','n-view','{"title":"Changed"}'::jsonb)$$);
select pg_temp.expect_denied('mark someone else''s notification read', 'u-view',
  $$select lf_update('notifications','n-book','{"read":true}'::jsonb)$$);
select pg_temp.expect_denied('create a notification from the browser', 'u-owner',
  $$insert into notifications(id,data) values ('n-fake', '{"workspaceId":"ws1","uid":"u-view","kind":"payment.received","title":"Fake","message":"m","read":false}')$$);
select pg_temp.expect_ok('delete own notification', 'u-view', $$select lf_delete('notifications','n-view')$$);
select pg_temp.expect_value('someone else''s notification is untouched',
  $$select (data->>'read') from notifications where id = 'n-book'$$, 'false');
select pg_temp.expect_ok('save own notification choices', 'u-view',
  $$insert into users(id,data) values ('u-view', '{"uid":"u-view","email":"u-view@test.local","role":"client"}'); select lf_update('users','u-view','{"notificationPrefs":{"payment.received":false}}'::jsonb)$$);

-- document ids: browser writes keep firestore.rules isValidId; server writes may be long
select pg_temp.expect_ok('browser id of 127 characters', 'u-book',
  format($f$select lf_set('vendors', %L, '{"workspaceId":"ws1","name":"V"}'::jsonb)$f$, repeat('v', 127)));
select pg_temp.expect_denied('browser id of 128 characters', 'u-book',
  format($f$select lf_set('vendors', %L, '{"workspaceId":"ws1","name":"V"}'::jsonb)$f$, repeat('v', 128)));
select pg_temp.expect_denied('browser id with a space', 'u-book',
  $$select lf_set('vendors', 'has space', '{"workspaceId":"ws1","name":"V"}'::jsonb)$$);
select set_config('request.jwt.claims', '', true);  -- back to a server connection
insert into "idempotencyKeys" (id, data) values (repeat('k', 400), '{"workspaceId":"ws1"}');
select pg_temp.expect_value('server id of 400 characters', $$select count(*)::text from "idempotencyKeys" where id = repeat('k', 400)$$, '1');

-- two-step login: a user with a verified authenticator needs a code-verified (aal2) session
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, email) values ('7a0c5c4e-0000-4000-8000-00000000a001', 'mfa@test.local');
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
  values ('7a0c5c4e-0000-4000-8000-00000000f001', '7a0c5c4e-0000-4000-8000-00000000a001', 'totp', 'verified', now(), now());
insert into workspaces (id, data) values ('ws-mfa', '{"uid":"7a0c5c4e-0000-4000-8000-00000000a001","name":"MFA"}');
create function pg_temp.count_as(uid text, aal text, q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', uid, 'aal', aal)::text, true);
  execute 'set local role authenticated';
  execute q into n;
  execute 'reset role';
  return n;
end $$;
select pg_temp.expect_value('password-only session sees nothing',
  $$select pg_temp.count_as('7a0c5c4e-0000-4000-8000-00000000a001', 'aal1', 'select count(*) from workspaces')::text$$, '0');
select pg_temp.expect_value('code-verified session sees its workspace',
  $$select pg_temp.count_as('7a0c5c4e-0000-4000-8000-00000000a001', 'aal2', 'select count(*) from workspaces')::text$$, '1');
select pg_temp.expect_count('users without an authenticator are unaffected', 'u-owner', $$select count(*) from workspaces where id = 'ws1'$$, 1);
do $$
declare refused boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', '7a0c5c4e-0000-4000-8000-00000000a001', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  begin
    insert into customers (id, data) values ('c-mfa', '{"workspaceId":"ws-mfa","name":"X"}');
  exception when others then refused := true;
  end;
  execute 'reset role';
  if not refused then raise exception 'FAIL password-only session wrote a document'; end if;
end $$;

-- Y-30: a workspace that requires two-step login: its members without an authenticator see nothing
-- until they set one up (a code-verified session); people in other workspaces are unaffected
select set_config('request.jwt.claims', '', true);
insert into workspaces (id, data) values ('ws-2fa', '{"uid":"u-strict","name":"Strict","requireTwoStep":true,"roles":{"u-strict-book":"bookkeeper"}}');
insert into customers (id, data) values ('c-2fa', '{"workspaceId":"ws-2fa","name":"Kept"}');
select pg_temp.expect_value('a member without two-step login sees nothing',
  $$select pg_temp.count_as('u-strict-book', 'aal1', 'select count(*) from customers')::text$$, '0');
select pg_temp.expect_value('the same member, code-verified, sees the books',
  $$select pg_temp.count_as('u-strict-book', 'aal2', 'select count(*) from customers')::text$$, '1');
select pg_temp.expect_value('the owner too',
  $$select pg_temp.count_as('u-strict', 'aal1', 'select count(*) from workspaces')::text$$, '0');
select pg_temp.expect_count('someone in another workspace is unaffected', 'u-owner', $$select count(*) from workspaces where id = 'ws1'$$, 1);
select pg_temp.expect_denied('a member cannot switch the requirement off from the browser', 'u-strict',
  $$select lf_update('workspaces','ws-2fa','{"requireTwoStep":false}'::jsonb)$$);

-- groups of books (DA-01): each person reads only their own; only the server writes them
select set_config('request.jwt.claims', '', true);
insert into "workspaceGroups" (id, data) values ('grp_owner1', '{"ownerUid":"u-owner","name":"Holding","workspaceIds":["ws1"]}');
select pg_temp.expect_count('the owner reads their group', 'u-owner', $$select count(*) from "workspaceGroups"$$, 1);
select pg_temp.expect_count('a member of the same workspace does not', 'u-view', $$select count(*) from "workspaceGroups"$$, 0);
select pg_temp.expect_count('an outsider does not', 'u-out', $$select count(*) from "workspaceGroups"$$, 0);
select pg_temp.expect_denied('the owner renames it from the browser', 'u-owner', $$select lf_update('workspaceGroups','grp_owner1','{"name":"Mine"}'::jsonb)$$);
select pg_temp.expect_denied('someone adds a group from the browser', 'u-out',
  $$insert into "workspaceGroups"(id,data) values ('grp_out1', '{"ownerUid":"u-out","name":"Theirs","workspaceIds":["ws1"]}')$$);

-- return authorizations (RMAs) are written only by the server (ISS-143)
select pg_temp.expect_ok('a bookkeeper still edits a customer', 'u-book',
  $$select lf_update('customers','c2','{"phone":"555-0101"}'::jsonb)$$);
select pg_temp.expect_denied('a bookkeeper writes an RMA into a customer from the browser', 'u-book',
  $$select lf_update('customers','c2','{"metadata.returnAuthorizationsById.rma_x":{"id":"rma_x","status":"approved"}}'::jsonb)$$);
select pg_temp.expect_denied('the owner cannot either: approvals go through the server', 'u-owner',
  $$select lf_update('customers','c2','{"metadata":{"returnAuthorizationsById":{"rma_x":{"id":"rma_x","status":"approved"}}}}'::jsonb)$$);
select pg_temp.expect_denied('a new customer with an RMA already in it', 'u-book',
  $$insert into customers(id,data) values ('c-rma', '{"workspaceId":"ws1","name":"R","metadata":{"returnAuthorizationsById":{"rma_y":{"id":"rma_y","status":"closed"}}}}')$$);
do $$ begin
  perform set_config('request.jwt.claims', '', true);
  update customers set data = jsonb_set(data, '{metadata}', '{"returnAuthorizationsById":{"rma_s":{"id":"rma_s","status":"requested"}}}'::jsonb) where id = 'c2';
end $$;
select pg_temp.expect_value('the server writes it', $$select data->'metadata'->'returnAuthorizationsById'->'rma_s'->>'status' from customers where id='c2'$$, 'requested');
select pg_temp.expect_ok('a browser edit elsewhere on that customer keeps the server''s RMA', 'u-book',
  $$select lf_update('customers','c2','{"phone":"555-0102"}'::jsonb)$$);
select pg_temp.expect_denied('and cannot change its status', 'u-acct',
  $$select lf_update('customers','c2','{"metadata.returnAuthorizationsById.rma_s.status":"approved"}'::jsonb)$$);

-- balance snapshots (L-123): written only by the server; members read; an entry written in a covered date by a
-- member still marks the snapshot stale (the trigger runs as its owner)
select set_config('request.jwt.claims', '', true);
insert into "periodBalances" (id, data) values ('ws1_2026-12-31', '{"workspaceId":"ws1","asOf":"2026-12-31","accounts":{"a1":100},"stale":false}');
select pg_temp.expect_count('viewer reads the balance snapshot', 'u-view', $$select count(*) from "periodBalances"$$, 1);
select pg_temp.expect_count('outsider reads no balance snapshot', 'u-out', $$select count(*) from "periodBalances"$$, 0);
select pg_temp.expect_denied('owner rewrites a balance snapshot from the browser', 'u-owner', $$select lf_update('periodBalances','ws1_2026-12-31','{"accounts":{"a1":999}}'::jsonb)$$);
select pg_temp.expect_denied('owner writes a balance snapshot with lf_set', 'u-owner', $$select lf_set('periodBalances','ws1_2025-12-31','{"workspaceId":"ws1","asOf":"2025-12-31","accounts":{}}'::jsonb)$$);
select pg_temp.expect_denied('bookkeeper adds a balance snapshot from the browser', 'u-book',
  $$insert into "periodBalances"(id,data) values ('ws1_2024-12-31', '{"workspaceId":"ws1","asOf":"2024-12-31","accounts":{}}')$$);
select pg_temp.expect_denied('owner deletes a balance snapshot from the browser', 'u-owner', $$delete from "periodBalances" where id = 'ws1_2026-12-31'$$);
select pg_temp.expect_value('the refused writes left it as it was', $q$select data->'accounts'->>'a1' from "periodBalances" where id = 'ws1_2026-12-31'$q$, '100');
select pg_temp.expect_ok('bookkeeper posts an entry the snapshot covers', 'u-book',
  $$insert into transactions(id,data) values ('tx-l123', '{"workspaceId":"ws1","date":"2026-06-01","lines":[]}')$$);
select pg_temp.expect_value('that entry marked the snapshot stale', $q$select data->>'stale' from "periodBalances" where id = 'ws1_2026-12-31'$q$, 'true');

-- stock closings (EG-7): written only by the server; members read
select set_config('request.jwt.claims', '', true);
insert into "stockClosings" (id, data) values ('ws1_2026-12-31', '{"workspaceId":"ws1","asOf":"2026-12-31","stockValueCents":100,"rows":[]}');
select pg_temp.expect_count('viewer reads the stock closing', 'u-view', $$select count(*) from "stockClosings"$$, 1);
select pg_temp.expect_count('outsider reads no stock closing', 'u-out', $$select count(*) from "stockClosings"$$, 0);
select pg_temp.expect_denied('owner rewrites a stock closing from the browser', 'u-owner', $$select lf_update('stockClosings','ws1_2026-12-31','{"stockValueCents":999}'::jsonb)$$);
select pg_temp.expect_denied('owner writes a stock closing with lf_set', 'u-owner', $$select lf_set('stockClosings','ws1_2025-12-31','{"workspaceId":"ws1","asOf":"2025-12-31","rows":[]}'::jsonb)$$);
select pg_temp.expect_denied('bookkeeper adds a stock closing from the browser', 'u-book',
  $$insert into "stockClosings"(id,data) values ('ws1_2024-12-31', '{"workspaceId":"ws1","asOf":"2024-12-31","rows":[]}')$$);
select pg_temp.expect_denied('owner deletes a stock closing from the browser', 'u-owner', $$delete from "stockClosings" where id = 'ws1_2026-12-31'$$);
select pg_temp.expect_value('the refused writes left the stock closing as it was', $q$select data->>'stockValueCents' from "stockClosings" where id = 'ws1_2026-12-31'$q$, '100');
-- period-closing documents (EG-3): written only by the server; members read; the browser can neither write one nor
-- mark one superseded
select set_config('request.jwt.claims', '', true);
insert into "periodClosings" (id, data) values ('ws1_2026-12-31_v1', '{"workspaceId":"ws1","yearEnd":"2026-12-31","version":1,"status":"current","profitAndLoss":{"netIncome":200000}}');
select pg_temp.expect_count('viewer reads the closing document', 'u-view', $$select count(*) from "periodClosings"$$, 1);
select pg_temp.expect_count('outsider reads no closing document', 'u-out', $$select count(*) from "periodClosings"$$, 0);
select pg_temp.expect_denied('owner marks a closing document superseded from the browser', 'u-owner', $$select lf_update('periodClosings','ws1_2026-12-31_v1','{"status":"superseded"}'::jsonb)$$);
select pg_temp.expect_denied('owner writes a closing document with lf_set', 'u-owner', $$select lf_set('periodClosings','ws1_2026-12-31_v2','{"workspaceId":"ws1","yearEnd":"2026-12-31","version":2}'::jsonb)$$);
select pg_temp.expect_denied('accountant adds a closing document from the browser', 'u-acct',
  $$insert into "periodClosings"(id,data) values ('ws1_2025-12-31_v1', '{"workspaceId":"ws1","yearEnd":"2025-12-31"}')$$);
select pg_temp.expect_denied('owner deletes a closing document from the browser', 'u-owner', $$delete from "periodClosings" where id = 'ws1_2026-12-31_v1'$$);
select pg_temp.expect_value('the refused writes left it as it was', $q$select data->>'status' from "periodClosings" where id = 'ws1_2026-12-31_v1'$q$, 'current');

-- repost queue (EG-1): written only by the server; members read; nobody writes it from the browser
select set_config('request.jwt.claims', '', true);
insert into "repostQueue" (id, data) values ('ws1_stock-cost_i1', '{"workspaceId":"ws1","kind":"stock-cost","key":"i1","fromDate":"2026-01-03","status":"dirty"}');
select pg_temp.expect_count('viewer reads the repost queue', 'u-view', $$select count(*) from "repostQueue"$$, 1);
select pg_temp.expect_count('outsider reads no repost queue', 'u-out', $$select count(*) from "repostQueue"$$, 0);
select pg_temp.expect_denied('owner marks a queue row clean from the browser', 'u-owner', $$select lf_update('repostQueue','ws1_stock-cost_i1','{"status":"clean"}'::jsonb)$$);
select pg_temp.expect_denied('owner writes a queue row with lf_set', 'u-owner', $$select lf_set('repostQueue','ws1_stock-cost_i2','{"workspaceId":"ws1","kind":"stock-cost","key":"i2","status":"dirty"}'::jsonb)$$);
select pg_temp.expect_denied('bookkeeper adds a queue row from the browser', 'u-book',
  $$insert into "repostQueue"(id,data) values ('ws1_stock-cost_i3', '{"workspaceId":"ws1","kind":"stock-cost","key":"i3","status":"dirty"}')$$);
select pg_temp.expect_denied('owner deletes a queue row from the browser', 'u-owner', $$delete from "repostQueue" where id = 'ws1_stock-cost_i1'$$);
select pg_temp.expect_value('the refused writes left it as it was', $q$select data->>'status' from "repostQueue" where id = 'ws1_stock-cost_i1'$q$, 'dirty');

-- payment ledger (EG-2): written only by the server; members read; nobody writes it from the browser
select set_config('request.jwt.claims', '', true);
insert into "paymentAllocations" (id, data) values ('payment-p1-p1-inv1', '{"workspaceId":"ws1","documentId":"inv1","kind":"payment","amountCents":100}');
select pg_temp.expect_count('viewer reads the payment ledger', 'u-view', $$select count(*) from "paymentAllocations"$$, 1);
select pg_temp.expect_count('outsider reads no payment ledger', 'u-out', $$select count(*) from "paymentAllocations"$$, 0);
select pg_temp.expect_denied('owner changes an allocation row from the browser', 'u-owner', $$select lf_update('paymentAllocations','payment-p1-p1-inv1','{"amountCents":999}'::jsonb)$$);
select pg_temp.expect_denied('owner writes an allocation row with lf_set', 'u-owner', $$select lf_set('paymentAllocations','payment-p2-p2-inv1','{"workspaceId":"ws1","documentId":"inv1","amountCents":5}'::jsonb)$$);
select pg_temp.expect_denied('bookkeeper inserts an allocation row from the browser', 'u-book',
  $$insert into "paymentAllocations"(id,data) values ('payment-p3-p3-inv1', '{"workspaceId":"ws1","documentId":"inv1","amountCents":5}')$$);
select pg_temp.expect_denied('owner deletes an allocation row from the browser', 'u-owner', $$delete from "paymentAllocations" where id = 'payment-p1-p1-inv1'$$);
select pg_temp.expect_denied('bookkeeper writes an allocation operation from the browser', 'u-book',
  $$insert into "allocationOperations"(id,data) values ('ws1:op1', '{"workspaceId":"ws1"}')$$);
select pg_temp.expect_value('the refused writes left it as it was', $q$select data->>'amountCents' from "paymentAllocations" where id = 'payment-p1-p1-inv1'$q$, '100');
-- report preferences (D-47): nested records in the existing private profile. Dotted updates for
-- two books are atomic and independent; another member cannot read or change the profile.
select pg_temp.expect_ok('a viewer saves report preferences for the first book', 'u-view',
  $$select lf_update('users','u-view','{"reportPreferences.scope-a":{"uid":"u-view","workspaceId":"ws1","recentReportIds":["pnl"],"pinnedPages":[{"tab":"reports","sub":"pnl"}],"updatedAt":"2026-10-24T10:00:00Z"},"notificationPrefs":{"payment.received":false}}'::jsonb)$$);
select pg_temp.expect_ok('a second book update does not replace the first', 'u-view',
  $$select lf_update('users','u-view','{"reportPreferences.scope-b":{"uid":"u-view","workspaceId":"ws-2fa","recentReportIds":["cash-flow"],"pinnedPages":[],"updatedAt":"2026-10-24T10:01:00Z"}}'::jsonb)$$);
select pg_temp.expect_value('the first book is still present',
  $$select data #>> '{reportPreferences,scope-a,recentReportIds,0}' from users where id = 'u-view'$$, 'pnl');
select pg_temp.expect_value('the second book has its own record',
  $$select data #>> '{reportPreferences,scope-b,recentReportIds,0}' from users where id = 'u-view'$$, 'cash-flow');
select pg_temp.expect_value('the nested updates preserve unrelated notification preferences',
  $$select data #>> '{notificationPrefs,payment.received}' from users where id = 'u-view'$$, 'false');
select pg_temp.expect_count('the workspace owner cannot read a member''s private profile', 'u-owner',
  $$select count(*) from users where id = 'u-view'$$, 0);
select pg_temp.expect_denied('another member changes the private preferences', 'u-book',
  $$select lf_update('users','u-view','{"reportPreferences.scope-a":{"recentReportIds":["group-summary"]}}'::jsonb)$$);
select pg_temp.expect_denied('an outsider changes the private preferences', 'u-out',
  $$select lf_update('users','u-view','{"reportPreferences.scope-a":{"recentReportIds":["group-summary"]}}'::jsonb)$$);
select pg_temp.expect_denied('profile fields remain allowlisted', 'u-view',
  $$select lf_update('users','u-view','{"ledgerTotals":{"assets":1}}'::jsonb)$$);
select pg_temp.expect_value('the refused writes left the first book intact',
  $$select data #>> '{reportPreferences,scope-a,recentReportIds,0}' from users where id = 'u-view'$$, 'pnl');

-- Where the Supabase publication exists, a second device must receive the profile change live.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'users'
     ) then
    raise exception 'FAIL D-47: users is not in supabase_realtime';
  end if;
end $$;

select 'ALL RLS TESTS PASSED' as result;
rollback;
