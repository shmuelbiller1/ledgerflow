-- SBX-1: provisional ordering for drafted stock moves.
--
-- A live stock move takes `dbSeq` from public."stockMoves_db_seq" in a BEFORE INSERT trigger, and the
-- cost replay orders one item's moves by date, then dbSeq (src/lib/stockMoves.ts compareMoves). The
-- sandbox role may not advance any public sequence, so until now a draft that moved stock was refused.
--
-- A drafted move now gets a provisional dbSeq that sorts exactly where the live replay will put it:
-- after every live move the sandbox can see for this workspace and after every earlier draft move in
-- this sandbox. The number itself is discarded on accept — the live trigger assigns a real one — so it
-- only has to order the draft, never to be unique across sandboxes. No sequence is consumed and no
-- grant changes; the function runs as the caller (lf_sandbox) under its own row policies.
--
-- lf_repost_mark stays off the overlay on purpose: it queues a later cost repost for a backdated move.
-- The draft shows the cost the handler computes at write time, exactly what a live save writes
-- synchronously; the live insert at accept marks the queue as it always did.

create or replace function sandbox.lf_stock_move_provisional_seq() returns trigger
language plpgsql set search_path = '' as $$
declare
  last_live bigint;
  last_draft bigint;
begin
  if new.deleted or jsonb_typeof(new.data->'dbSeq') = 'number' then return new; end if;
  select max((s.data->>'dbSeq')::bigint) into last_live from public."stockMoves" s -- NOSONAR: plsql:QuotedIdentifiersCheck — mixed-case table name
    where s.workspace_id = new.data->>'workspaceId' and jsonb_typeof(s.data->'dbSeq') = 'number'; -- generated columns are not yet computed in a BEFORE trigger
  select max((s.data->>'dbSeq')::bigint) into last_draft from sandbox."stockMoves" s -- NOSONAR: plsql:QuotedIdentifiersCheck — mixed-case table name
    where s.sandbox_id = new.sandbox_id and jsonb_typeof(s.data->'dbSeq') = 'number';
  new.data := new.data || jsonb_build_object('dbSeq', greatest(coalesce(last_live, 0), coalesce(last_draft, 0)) + 1);
  return new;
end;
$$;
revoke execute on function sandbox.lf_stock_move_provisional_seq() from public, anon, authenticated, service_role;
grant execute on function sandbox.lf_stock_move_provisional_seq() to lf_sandbox;

drop trigger if exists lf_stock_move_provisional_seq on sandbox."stockMoves";
create trigger lf_stock_move_provisional_seq before insert on sandbox."stockMoves"
  for each row execute function sandbox.lf_stock_move_provisional_seq();
