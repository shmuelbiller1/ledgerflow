-- Agent #7 probe A7-05 (review-only; everything is rolled back).
--
-- Question: the server keeps "one door to the ledger" (src/server/services/ledgerDoor.ts, AU-6): every entry it
-- writes must balance. Does the DATABASE hold the same line against a signed-in browser? The browser talks to the
-- database directly (Supabase PostgREST) with the user's own token; the only guards there are the row level security
-- policies and the lf_guard trigger (supabase/migrations/20260924190000_init.sql).
--
-- Method: exactly the technique of supabase/tests/rls.test.sql — act as a signed-in member by setting the request
-- claims and the `authenticated` role, then run the statement the Supabase client would send.
--
-- Run:  node audit/agent7-2026-11-11/probes/run-sql.mjs audit/agent7-2026-11-11/probes/a7-05-browser-writes-ledger.sql
begin;

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', uid, 'email', uid || '@test.local')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_server() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
create temp table a7_result (step int, what text, outcome text) on commit drop;
grant all on a7_result to authenticated;
create function pg_temp.try(step int, what text, uid text, stmt text) returns void language plpgsql as $$
declare outcome text := 'ACCEPTED';
begin
  perform pg_temp.as_user(uid);
  begin
    execute stmt;
  exception when others then
    outcome := 'refused: ' || sqlerrm;
  end;
  perform pg_temp.as_server();
  insert into a7_result values (step, what, outcome);
end $$;

-- the books, written as the server writes them: a workspace, two accounts, one balanced posted entry, a paid invoice
select pg_temp.as_server();
insert into workspaces(id, data) values ('a7ws', '{"uid":"a7-owner","name":"A7","currency":"USD","roles":{"a7-book":"bookkeeper","a7-view":"viewer"},"members":["a7-owner","a7-book","a7-view"]}');
insert into "chartAccounts"(id, data) values
  ('a7ws_bank',  '{"workspaceId":"a7ws","name":"Bank","type":"asset","category":"Cash"}'),
  ('a7ws_sales', '{"workspaceId":"a7ws","name":"Sales","type":"income"}');
insert into transactions(id, data) values ('a7ws_e1', '{"workspaceId":"a7ws","uid":"a7-owner","date":"2026-08-01","status":"completed","type":"journal","description":"Sale","totalAmountCents":10000,"lines":[{"accountId":"a7ws_bank","amountCents":10000},{"accountId":"a7ws_sales","amountCents":-10000}]}');
insert into invoices(id, data) values ('a7ws_inv1', '{"workspaceId":"a7ws","number":"INV-1","status":"sent","date":"2026-08-01","amountCents":50000,"amountPaidCents":0}');

-- 1. a bookkeeper inserts a POSTED entry that does not balance (one line, 9,999.99 to the bank, no other side)
select pg_temp.try(1, 'bookkeeper inserts a posted one-sided entry of 9,999.99 straight into the ledger table', 'a7-book',
  $$insert into transactions(id, data) values ('a7ws_bad1', '{"workspaceId":"a7ws","uid":"a7-book","date":"2026-08-02","status":"completed","type":"journal","description":"one-sided","totalAmountCents":999999,"lines":[{"accountId":"a7ws_bank","amountCents":999999}]}')$$);

-- 2. a bookkeeper rewrites the lines of the server's balanced entry so that it no longer balances
select pg_temp.try(2, 'bookkeeper rewrites the lines of an existing posted entry (10,000 / -10,000 becomes 10,000 / -1)', 'a7-book',
  $$update transactions set data = jsonb_set(data, '{lines}', '[{"accountId":"a7ws_bank","amountCents":10000},{"accountId":"a7ws_sales","amountCents":-1}]') where id = 'a7ws_e1'$$);

-- 3. a bookkeeper marks an invoice paid without any payment or entry
select pg_temp.try(3, 'bookkeeper sets an invoice to paid (amountPaidCents = amountCents) with no payment and no entry', 'a7-book',
  $$update invoices set data = data || '{"status":"paid","amountPaidCents":50000}' where id = 'a7ws_inv1'$$);

-- 4. a bookkeeper inserts a "posted" payment record with no entry
select pg_temp.try(4, 'bookkeeper inserts a posted payment record of 500.00 with no ledger entry', 'a7-book',
  $$insert into payments(id, data) values ('a7ws_pay1', '{"workspaceId":"a7ws","status":"posted","date":"2026-08-03","amountCents":50000,"direction":"received"}')$$);

-- 5. a posted entry cannot be deleted by the browser (drafts only) ...
select pg_temp.try(5, 'bookkeeper deletes a posted entry', 'a7-book', $$select lf_delete('transactions', 'a7ws_e1')$$);
-- 6. ... unless it is first set back to draft, which the same browser may do
select pg_temp.try(6, 'bookkeeper sets the posted entry back to draft, then deletes it', 'a7-book',
  $$update transactions set data = data || '{"status":"draft"}' where id = 'a7ws_e1'; select lf_delete('transactions', 'a7ws_e1')$$);

-- controls: a viewer and an outsider are refused, so the policies themselves work
select pg_temp.try(7, 'control: a viewer inserts an entry', 'a7-view',
  $$insert into transactions(id, data) values ('a7ws_v1', '{"workspaceId":"a7ws","date":"2026-08-02","status":"completed","lines":[]}')$$);
select pg_temp.try(8, 'control: an outsider inserts an entry', 'a7-out',
  $$insert into transactions(id, data) values ('a7ws_o1', '{"workspaceId":"a7ws","date":"2026-08-02","status":"completed","lines":[]}')$$);

select step, what, outcome from a7_result order by step;

-- what is in the ledger table now (as the server reads it): the sum of every posted line. A ledger that balances reads 0.
select pg_temp.as_server();
select coalesce(sum((l->>'amountCents')::bigint), 0) as "sum of all posted lines (cents); 0 = the ledger balances",
       count(distinct t.id) as "posted entries"
from transactions t, jsonb_array_elements(t.data->'lines') l
where t.workspace_id = 'a7ws' and t.data->>'status' not in ('draft', 'void', 'failed');
select id, data->>'status' as status, data->>'amountPaidCents' as paid from invoices where workspace_id = 'a7ws';

rollback;
