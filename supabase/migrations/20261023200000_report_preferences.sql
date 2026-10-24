-- D-47: recent reports and pinned pages are private navigation preferences, not ledger data.
-- Keep one independently updated, hash-keyed record per workspace inside the user's existing profile.
-- The existing own-user RLS, personal-data export, and account deletion therefore apply unchanged.
-- Reads normalize every nested value; a user can never affect another user's or the workspace's data.
update public.lf_rules
set allowed_keys = allowed_keys || array['reportPreferences']
where table_name = 'users' and not ('reportPreferences' = any(allowed_keys));

-- The document listener uses postgres_changes for another device's write. Plain PostgreSQL test
-- databases have no Supabase publication; Supabase does. The guard also makes a repeated setup safe.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'users'
     ) then
    alter publication supabase_realtime add table public.users;
  end if;
end $$;
