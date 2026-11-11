begin;
create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',uid)::text, true); execute 'set local role authenticated'; end $$;
insert into workspaces(id,data) values ('wsP', '{"uid":"u-owner","name":"P","roles":{"u-book":"bookkeeper"}}');
insert into "chartAccounts"(id,data) values ('a1','{"workspaceId":"wsP","name":"Bank","type":"asset","balanceCents":0}');
insert into "auditLogs"(id,data) values ('al0','{"workspaceId":"wsP","uid":"u-owner","action":"X","timestamp":"2026-03-01T00:00:00Z"}');
insert into transactions(id,data) values ('s1','{"workspaceId":"wsP","date":"2026-03-01","status":"completed","lines":[{"accountId":"a1","amountCents":100},{"accountId":"a1","amountCents":-100}]}');
select pg_temp.as_user('u-book');
update transactions set data = jsonb_set(data,'{lines,0,amountCents}','999999') where id='s1';
update "chartAccounts" set data = data || '{"balanceCents":123456789}' where id='a1';
delete from "auditLogs" where workspace_id='wsP';
update "auditLogs" set data = data || '{"action":"EDITED"}' where id='al0';
reset role; select set_config('request.jwt.claims','',true);
select 'posted entry line 0 after bookkeeper update: ' || (data->'lines'->0->>'amountCents') from transactions where id='s1';
select 'account balanceCents after bookkeeper update: ' || (data->>'balanceCents') from "chartAccounts" where id='a1';
select 'audit rows left: ' || count(*) || ', action=' || max(data->>'action') from "auditLogs" where workspace_id='wsP';
rollback;
