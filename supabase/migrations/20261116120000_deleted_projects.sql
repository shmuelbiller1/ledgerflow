-- The row a deleted project leaves behind, so `project.restore` needs only the id.
--
-- `projectUndo` deleted a project and put it back from a snapshot the tab was holding: a reload ended the undo,
-- and a second tab had no way to know the id had been taken again. The server now keeps the deleted row in
-- `deletedProjects` — one row per workspace and project id — and `project.restore` reads it and clears it.
--
-- Written and read only by the server: `project.restore` is the way back, and a screen that lists what is
-- restorable would ask a command rather than read the table. Nothing in it is a book entry — it is a copy of a
-- project row plus who deleted it and when.

create table public."deletedProjects" (
  id text primary key
    check (char_length(id) between 1 and 260 and id !~ '[[:space:][:cntrl:]]'),
  data jsonb not null default '{}'::jsonb,
  workspace_id text generated always as (data->>'workspaceId') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index "deletedProjects_ws_idx" on public."deletedProjects" (workspace_id);
create index "deletedProjects_deletedAt_idx" on public."deletedProjects" (workspace_id, (data->>'deletedAt'));
alter table public."deletedProjects" enable row level security;

-- the row is a copy of a project, and a project may carry fields this table does not know about: the copy must
-- keep them, so the rule bounds the number of keys instead of naming them (the server writes it; lf_guard's key
-- rules only bind browser sessions)
insert into public.lf_rules (table_name, max_keys, immutable_keys) values
  ('deletedProjects', 80, '{id,workspaceId,deletedAt,deletedBy}');

create trigger lf_guard before insert or update or delete on public."deletedProjects"
  for each row execute function public.lf_guard();

-- no read or write policy: only the server reaches this table (like idempotencyKeys). The restrictive
-- two-step policy is still declared on it, because every RLS table carries one (A8-010).
drop policy if exists two_step_login on public."deletedProjects";
create policy two_step_login on public."deletedProjects" as restrictive for all to authenticated
  using ((select private.lf_mfa_ok())) with check ((select private.lf_mfa_ok()));

revoke all on public."deletedProjects" from anon, authenticated;
