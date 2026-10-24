-- EG-7: a stock closing snapshot per workspace and locked period end (id `<workspaceId>_<asOf>`), written only by the
-- server (src/server/services/stockClosingService.ts, POST /api/v1/inventory/stock-closing). Per item and location it
-- holds the quantity, the value, how many moves it sums and a checksum over them; with the stock total, the Inventory
-- account's balance on the same date and the difference. Staleness is found by the checksum (src/lib/stockInvariants.ts),
-- read against the moves, so no trigger is needed.
-- Members read it; nobody writes it from the browser (RLS like periodBalances).

create table public."stockClosings" (
  id text primary key
    check (char_length(id) between 1 and 200 and id !~ '[[:space:][:cntrl:]]'),
  data jsonb not null default '{}'::jsonb,
  workspace_id text generated always as (data->>'workspaceId') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists "stockClosings_ws_idx" on public."stockClosings" (workspace_id, (data->>'asOf'));
alter table public."stockClosings" enable row level security;

-- no browser writes (no insert/update/delete policies); the row exists for the guard trigger
insert into public.lf_rules (table_name) values ('stockClosings') on conflict (table_name) do nothing;
drop trigger if exists lf_guard on public."stockClosings";
create trigger lf_guard before insert or update or delete on public."stockClosings"
  for each row execute function public.lf_guard();

drop policy if exists member_read on public."stockClosings";
create policy member_read on public."stockClosings" for select to authenticated
  using (public.lf_is_member(workspace_id));

grant select on public."stockClosings" to authenticated;
revoke all on public."stockClosings" from anon;
