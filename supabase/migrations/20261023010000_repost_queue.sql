-- EG-1 step 1: the repost queue (docs/design/EG-1-repost-engine.md). One document per workspace, kind and key
-- (id `<workspaceId>_<kind>_<key>`), e.g. `stock-cost` + an item id: what must be recomputed after a change
-- dated before later entries that depend on it, and from which date (`fromDate` only ever moves earlier).
-- Written only by the server: the trigger below marks it in the same transaction as the stock move that makes
-- it dirty (every path that writes stockMoves: postings through commitLedgerBulk, stock adjustments, manual cost
-- of goods, revaluations), and the repost run (src/server/services/repostService.ts) sets it clean or blocked. Members read it; nobody writes it from the
-- browser (RLS like stockMoves and periodBalances).

create table public."repostQueue" (
  id text primary key
    check (char_length(id) between 1 and 400 and id !~ '[[:space:][:cntrl:]]'),
  data jsonb not null default '{}'::jsonb,
  workspace_id text generated always as (data->>'workspaceId') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists "repostQueue_ws_idx" on public."repostQueue" (workspace_id, (data->>'kind'), (data->>'status'));
alter table public."repostQueue" enable row level security;

-- no browser writes (no insert/update/delete policies); the row exists for the guard trigger
insert into public.lf_rules (table_name) values ('repostQueue') on conflict (table_name) do nothing;
drop trigger if exists lf_guard on public."repostQueue";
create trigger lf_guard before insert or update or delete on public."repostQueue"
  for each row execute function public.lf_guard();

drop policy if exists member_read on public."repostQueue";
create policy member_read on public."repostQueue" for select to authenticated
  using (public.lf_is_member(workspace_id));

grant select on public."repostQueue" to authenticated;
revoke all on public."repostQueue" from anon;

-- The dirty mark (EG-1 review): any stock move dated before a move already in the item's history (a purchase,
-- a sale, a return, an adjustment, a revaluation: anything but the repost's own cost-repost rows) marks the
-- item's stock-cost row from that date. A move on the same day as later-written ones is replayed after them
-- (ties go in the order written), so it changes nothing and marks nothing. `fromDate` is the earliest among the
-- causes still outstanding: a clean row dirtied again starts from the new cause alone. Security definer: the
-- browser cannot write the queue, yet every server path that moves stock must mark it.
create or replace function public.lf_repost_mark() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  d text := left(coalesce(new.data->>'date', ''), 10);
  k text := new.data->>'itemId';
  qid text;
  now_text text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  cause text := coalesce(new.data->>'transactionId', new.id);
begin
  if new.workspace_id is null or coalesce(k, '') = '' or d = '' or coalesce(new.data->>'kind', '') = 'cost-repost' then return null; end if; -- NOSONAR: plsql:NullComparison — already uses IS NULL; no direct NULL comparisons
  if not exists (
    select 1 from public."stockMoves" s -- NOSONAR: plsql:QuotedIdentifiersCheck — quoted identifier matches mixed-case schema table name
     where s.workspace_id = new.workspace_id and s.data->>'itemId' = k and s.id <> new.id and left(s.data->>'date', 10) > d
  ) then return null; end if;
  qid := new.workspace_id || '_stock-cost_' || k;
  insert into public."repostQueue" (id, data) values (qid, jsonb_build_object(
    'workspaceId', new.workspace_id, 'kind', 'stock-cost', 'key', k, 'fromDate', d, 'cause', jsonb_build_array(cause),
    'status', 'dirty', 'blockedBy', null, 'markedAt', now_text))
  on conflict (id) do update set
    data = case when coalesce(public."repostQueue".data->>'status', '') = 'clean' then excluded.data || jsonb_build_object(
                  'runId', public."repostQueue".data->'runId', 'lastRunAt', public."repostQueue".data->'lastRunAt')
           else public."repostQueue".data || jsonb_build_object(
             'fromDate', least(coalesce(public."repostQueue".data->>'fromDate', d), d),
             'status', 'dirty', 'blockedBy', null, 'markedAt', now_text,
             'cause', (select coalesce(jsonb_agg(c order by n), '[]'::jsonb) from (
                select c, n from jsonb_array_elements(coalesce(public."repostQueue".data->'cause', '[]'::jsonb) || jsonb_build_array(cause)) with ordinality as x(c, n)
                order by n desc limit 50) last50))
           end,
    updated_at = now();
  return null;
end;
$$;
revoke execute on function public.lf_repost_mark() from public, anon, authenticated;

drop trigger if exists lf_repost_mark on public."stockMoves";
create trigger lf_repost_mark after insert on public."stockMoves"
  for each row execute function public.lf_repost_mark();

-- The lookup above, by workspace, item and day (review: without it each stock move scans the workspace's history).
create index if not exists "stockMoves_item_date_idx" on public."stockMoves" (workspace_id, (data->>'itemId'), (left(data->>'date', 10)));

-- A total order for moves written on the same day (review): `seq` comes from the writing process's clock, which
-- two servers (or two writes in one millisecond) do not order reliably. Each new move gets `dbSeq` from a database
-- sequence as it is inserted; the replay orders by date, then dbSeq (moves from before this migration have none and
-- come first), then seq, then id (src/lib/stockMoves.ts compareMoves).
create sequence if not exists public."stockMoves_db_seq";
revoke all on sequence public."stockMoves_db_seq" from public, anon, authenticated;
create or replace function public.lf_stock_move_db_seq() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.data := new.data || jsonb_build_object('dbSeq', nextval('public."stockMoves_db_seq"'));
  return new;
end;
$$;
revoke execute on function public.lf_stock_move_db_seq() from public, anon, authenticated;
drop trigger if exists lf_stock_move_db_seq on public."stockMoves";
create trigger lf_stock_move_db_seq before insert on public."stockMoves"
  for each row execute function public.lf_stock_move_db_seq();
