-- C-86: a scheduled report may name the day it is sent (`sendDay`). The rest of the shape is unchanged from
-- 20261110000000_report_pack_schedule.sql.
create or replace function public.lf_valid_report_schedules(v jsonb) returns boolean
language sql immutable
set search_path = ''
as $$
  select v is null or jsonb_typeof(v) = 'null' or (
    jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= 10
    and not exists (
      select 1 from jsonb_array_elements(v) s
      where jsonb_typeof(s) <> 'object'
         or s - array['id', 'report', 'frequency', 'recipients', 'sendDay'] <> '{}'::jsonb
         or jsonb_typeof(s->'id') <> 'string' or char_length(s->>'id') not between 1 and 64
         or coalesce(s->>'report', '') not in ('profit-and-loss', 'balance-sheet', 'receivables-aging', 'report-pack')
         or coalesce(s->>'frequency', '') not in ('weekly', 'monthly')
         -- C-86: an optional whole day, 1–7 for weekly (Monday–Sunday), 1–28 for monthly
         or (s ? 'sendDay' and case
              when jsonb_typeof(s->'sendDay') = 'number' and (s->>'sendDay') ~ '^[0-9]{1,2}$'
                then (s->>'sendDay')::int not between 1 and (case when s->>'frequency' = 'weekly' then 7 else 28 end)
              else true end)
         or jsonb_typeof(s->'recipients') <> 'array'
         or jsonb_array_length(s->'recipients') not between 1 and 10
         or exists (select 1 from jsonb_array_elements(s->'recipients') r
                    where jsonb_typeof(r) <> 'string' or char_length(r #>> '{}') > 254
                       or (r #>> '{}') !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$')
    )
  )
$$;
