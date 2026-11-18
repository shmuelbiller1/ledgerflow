-- #842: pending invites carry their secret, signed token. Every member (viewers included) could read them
-- through the REST API and Realtime, and so take an owner or accountant invitation sent to someone else.
-- Only workspace owners send invites (workspace.invite is owner-only), and the app reads invites through the
-- server, never from the browser, so browser reads are limited to owners and invites leave Realtime.
-- Safe to run twice.
drop policy if exists member_read on public.invites;
drop policy if exists owner_read on public.invites;
create policy owner_read on public.invites for select to authenticated
  using (private.lf_ws_role(workspace_id) = 'owner' or public.lf_is_platform_admin());

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invites') then
    execute 'alter publication supabase_realtime drop table public.invites';
  end if;
end $$;
