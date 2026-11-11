begin;
create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',uid,'email',uid||'@t.local')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.try(label text, uid text, stmt text) returns text language plpgsql as $$
declare r text := 'ALLOWED';
begin
  perform pg_temp.as_user(uid);
  begin execute stmt; exception when others then r := 'refused: ' || sqlerrm; end;
  execute 'reset role';
  return label || ' -> ' || r;
end $$;
insert into workspaces(id,data) values ('wsP', '{"uid":"u-owner","name":"P","roles":{"u-book":"bookkeeper","u-view":"viewer"}}');
insert into workspaces(id,data) values ('wsOther', '{"uid":"u-else","name":"O"}');
insert into "chartAccounts"(id,data) values ('a1','{"workspaceId":"wsP","name":"Bank","type":"asset"}');
select pg_temp.try('1 bookkeeper inserts a POSTED UNBALANCED entry (+1,000,000.00 to bank, nothing on the other side)', 'u-book',
 $$insert into transactions(id,data) values ('p1','{"workspaceId":"wsP","date":"2026-03-01","status":"completed","description":"x","lines":[{"accountId":"a1","amountCents":100000000}]}')$$);
select pg_temp.try('2 bookkeeper rewrites the amount of that posted entry', 'u-book',
 $$update transactions set data = jsonb_set(data,'{lines,0,amountCents}','5') where id='p1'$$);
select pg_temp.try('3 bookkeeper inserts a line on an account of ANOTHER workspace / a made-up account', 'u-book',
 $$insert into transactions(id,data) values ('p2','{"workspaceId":"wsP","date":"2026-03-01","status":"completed","lines":[{"accountId":"does-not-exist","amountCents":7},{"accountId":"a1","amountCents":-7}]}')$$);
select pg_temp.try('4 bookkeeper inserts a payment record with no ledger entry', 'u-book',
 $$insert into payments(id,data) values ('pay1','{"workspaceId":"wsP","date":"2026-03-01","amountCents":999900,"invoiceId":"nope","status":"completed"}')$$);
select pg_temp.try('5 bookkeeper marks an invoice paid directly', 'u-book',
 $$insert into invoices(id,data) values ('inv1','{"workspaceId":"wsP","date":"2026-03-01","status":"paid","totalCents":500000,"amountPaidCents":500000}')$$);
select pg_temp.try('6 bookkeeper deletes the posted entry', 'u-book', $$delete from transactions where id='p1'$$);
select pg_temp.try('7a bookkeeper flips the posted entry to draft', 'u-book', $$update transactions set data = data || '{"status":"draft"}' where id='p1'$$);
select pg_temp.try('7b ...then deletes it', 'u-book', $$delete from transactions where id='p1'$$);
select count(*) as p1_rows_left from transactions where id='p1';
select pg_temp.try('8 viewer inserts an entry', 'u-view',
 $$insert into transactions(id,data) values ('p3','{"workspaceId":"wsP","date":"2026-03-01","lines":[]}')$$);
select pg_temp.try('9 bookkeeper writes into another workspace', 'u-book',
 $$insert into transactions(id,data) values ('p4','{"workspaceId":"wsOther","date":"2026-03-01","lines":[]}')$$);
select pg_temp.try('10 bookkeeper writes a bank line', 'u-book',
 $$insert into "bankLines"(id,data) values ('b1','{"workspaceId":"wsP","date":"2026-03-01","amountCents":1}')$$);
select pg_temp.try('11 bookkeeper writes an audit log row for someone else', 'u-book',
 $$insert into "auditLogs"(id,data) values ('al1','{"workspaceId":"wsP","uid":"u-owner","action":"USER_LOGIN","timestamp":"2026-03-01T00:00:00Z"}')$$);
select pg_temp.try('12 bookkeeper deletes audit log rows', 'u-book', $$delete from "auditLogs" where workspace_id='wsP'$$);
select count(*) as audit_rows_left from "auditLogs" where workspace_id='wsP';
select pg_temp.try('13 bookkeeper changes account balance field directly', 'u-book',
 $$update "chartAccounts" set data = data || '{"balanceCents":123456789}' where id='a1'$$);
select pg_temp.try('14 bookkeeper inserts reconciliation marked complete', 'u-book',
 $$insert into reconciliations(id,data) values ('r1','{"workspaceId":"wsP","accountId":"a1","statementBalanceCents":1,"status":"completed","date":"2026-03-01"}')$$);
rollback;
