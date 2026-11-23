-- BK-01: restoring a backup re-inserts stock moves, and the two insert triggers re-derived what the
-- backup already carried:
--   * lf_stock_move_db_seq assigned a fresh sequence value in restore (export) write order — the export
--     is ID-sorted, so same-day moves came back in ID order, scrambling the chronological order the
--     dbSeq existed to preserve (compareMoves: date, then dbSeq);
--   * lf_repost_mark re-dirtied the item's repostQueue row even though the backup was taken after a
--     clean repost (the restore clears the derived caches first, then the inserts dirtied them again).
-- A restore-only marker makes both triggers keep the restored rows exactly as the backup had them
-- (the sequence is advanced past every restored dbSeq, so later inserts still sort after them):
-- the restore transaction creates the temporary table pg_temp.lf_restore_stock_moves_active (dropped
-- at commit), the triggers check for it, and nothing else changes. Temporary tables are session-
-- scoped, so the marker is visible only to the restoring transaction itself.

create or replace function public.lf_stock_move_db_seq() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  restored bigint;
  current_value bigint;
  called boolean;
begin
  -- restoring a backup: the row carries its own dbSeq; keep the backup's same-day order, and move the
  -- sequence past it, so a move written after the restore (onto a rebuilt database whose sequence is
  -- behind the backup) still sorts after the restored moves of its day (compareMoves: date, then dbSeq).
  -- setval only ever moves the sequence forward here; a row from an older backup without a dbSeq gets
  -- a fresh one, as any insert does.
  if to_regclass('pg_temp.lf_restore_stock_moves_active') is not null then
    if coalesce(new.data->>'dbSeq', '') ~ '^[0-9]{1,18}$' then
      restored := (new.data->>'dbSeq')::bigint;
      select last_value, is_called into current_value, called from public."stockMoves_db_seq"; -- NOSONAR: plsql:QuotedIdentifiersCheck — quoted identifier matches mixed-case schema sequence name
      if restored > current_value or (restored = current_value and not called) then
        perform setval('public."stockMoves_db_seq"', restored, true);
      end if;
      return new;
    end if;
  end if;
  new.data := new.data || jsonb_build_object('dbSeq', nextval('public."stockMoves_db_seq"'));
  return new;
end;
$$;
revoke execute on function public.lf_stock_move_db_seq() from public, anon, authenticated;

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
  -- restoring a backup: the books are written back as they were at export time (already reposted),
  -- so the derived repost queue stays clean
  if to_regclass('pg_temp.lf_restore_stock_moves_active') is not null then return null; end if;
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
