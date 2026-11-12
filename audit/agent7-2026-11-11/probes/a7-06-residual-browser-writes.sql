-- Agent #7 probe A7-06 (review-only; everything is rolled back).
--
-- Follow-up to audit/claude-2026-11-11 C-1 ("the browser can write ledger tables directly"). C-1's fix list names
-- transactions, journalEntries and payments, and the paid fields of invoices and bills. This probe asks what a signed-in
-- bookkeeper's browser can still write on the OTHER money documents, on `main` and with the C-1 fix applied
-- (PR #640's migration 20261111120000_ledger_server_only_and_balance_check.sql). Same technique as rls.test.sql.
--
-- Run:  node audit/agent7-2026-11-11/probes/run-sql.mjs audit/agent7-2026-11-11/probes/a7-06-residual-browser-writes.sql
begin;

create function pg_temp.as_user(uid text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', uid, 'email', uid || '@test.local')::text, true);
  execute 'set local role authenticated';
end $f$;
create function pg_temp.as_server() returns void language plpgsql as $f$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $f$;
create temp table a7_result (step int, what text, outcome text) on commit drop;
grant all on a7_result to authenticated;
create function pg_temp.try(step int, what text, uid text, stmt text) returns void language plpgsql as $f$
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
end $f$;

select pg_temp.as_server();
insert into workspaces(id, data) values ('a7ws', '{"uid":"a7-owner","name":"A7","currency":"USD","roles":{"a7-book":"bookkeeper"},"members":["a7-owner","a7-book"]}');
-- as the server leaves them: an issued invoice of 500.00, an issued bill of 300.00, a credit note of 40.00 with 40.00 left
insert into invoices(id, data) values ('a7ws_inv1', '{"workspaceId":"a7ws","number":"INV-1","customerId":"c1","status":"sent","date":"2026-08-01","amountCents":50000,"amountPaidCents":0,"currency":"USD"}');
insert into bills(id, data) values ('a7ws_bill1', '{"workspaceId":"a7ws","number":"B-1","vendorId":"v1","status":"approved","date":"2026-08-01","amountCents":30000,"amountPaidCents":0,"currency":"USD"}');
insert into "creditNotes"(id, data) values ('a7ws_cn1', '{"workspaceId":"a7ws","number":"CN-1","customerId":"c1","status":"open","date":"2026-08-02","amountCents":4000,"remainingCents":4000,"currency":"USD"}');

select pg_temp.try(1, 'insert an OPEN customer credit note of 9,000.00 (never issued, no entry)', 'a7-book',
  $q$insert into "creditNotes"(id, data) values ('a7ws_cnX', '{"workspaceId":"a7ws","number":"CN-X","customerId":"c1","status":"open","date":"2026-08-03","amountCents":900000,"remainingCents":900000,"currency":"USD"}')$q$);
select pg_temp.try(2, 'raise what is left on an existing credit note from 40.00 to 4,000.00', 'a7-book',
  $q$update "creditNotes" set data = data || '{"remainingCents":400000}' where id = 'a7ws_cn1'$q$);
select pg_temp.try(3, 'insert an OPEN vendor credit of 7,000.00 (never issued, no entry)', 'a7-book',
  $q$insert into "vendorCredits"(id, data) values ('a7ws_vcX', '{"workspaceId":"a7ws","number":"VC-X","vendorId":"v1","status":"open","date":"2026-08-03","amountCents":700000,"remainingCents":700000,"currency":"USD"}')$q$);
select pg_temp.try(4, 'lower the total of an issued invoice from 500.00 to 5.00 (its entry stays at 500.00)', 'a7-book',
  $q$update invoices set data = data || '{"amountCents":500}' where id = 'a7ws_inv1'$q$);
select pg_temp.try(5, 'set an issued invoice to void (its entry is not reversed)', 'a7-book',
  $q$update invoices set data = data || '{"status":"void"}' where id = 'a7ws_inv1'$q$);
select pg_temp.try(6, 'insert an ISSUED invoice of 12,345.00 with no entry (it will show as owed in the ageing)', 'a7-book',
  $q$insert into invoices(id, data) values ('a7ws_invX', '{"workspaceId":"a7ws","number":"INV-X","customerId":"c1","status":"sent","date":"2026-08-03","amountCents":1234500,"currency":"USD"}')$q$);
select pg_temp.try(7, 'raise the total of an approved bill from 300.00 to 3,000.00 (its entry stays at 300.00)', 'a7-book',
  $q$update bills set data = data || '{"amountCents":300000}' where id = 'a7ws_bill1'$q$);
select pg_temp.try(8, 'set "settled by records" on an invoice (a field the amount due may read)', 'a7-book',
  $q$update invoices set data = data || '{"settledByRecordsCents":50000}' where id = 'a7ws_inv1'$q$);
select pg_temp.try(9, 'set a deposit as applied on an invoice (lowers what is due)', 'a7-book',
  $q$update invoices set data = data || '{"depositCents":50000,"depositAppliedCents":50000}' where id = 'a7ws_inv1'$q$);

select step, what, outcome from a7_result order by step;
rollback;
