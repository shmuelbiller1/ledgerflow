-- R-3: a scheduled report may also be the report pack ('report-pack': profit and loss, balance sheet and
-- receivables aging in one email). The rest of the schedule's shape is unchanged from 20261011000000.
create or replace function public.lf_valid_report_schedules(v jsonb) returns boolean
language sql immutable
set search_path = ''
as $$
  select v is null or jsonb_typeof(v) = 'null' or (
    jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= 10
    and not exists (
      select 1 from jsonb_array_elements(v) s
      where jsonb_typeof(s) <> 'object'
         or s - array['id', 'report', 'frequency', 'recipients'] <> '{}'::jsonb
         or jsonb_typeof(s->'id') <> 'string' or char_length(s->>'id') not between 1 and 64
         or coalesce(s->>'report', '') not in ('profit-and-loss', 'balance-sheet', 'receivables-aging', 'report-pack')
         or coalesce(s->>'frequency', '') not in ('weekly', 'monthly')
         or jsonb_typeof(s->'recipients') <> 'array'
         or jsonb_array_length(s->'recipients') not between 1 and 10
         or exists (select 1 from jsonb_array_elements(s->'recipients') r
                    where jsonb_typeof(r) <> 'string' or char_length(r #>> '{}') > 254
                       or (r #>> '{}') !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$')
    )
  )
$$;
