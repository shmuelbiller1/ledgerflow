-- CMD-1: apply only after the command-backed UI (including inline label creation) is deployed.
-- This is the browser door only. Do not change SELECT, Realtime, Storage, the MFA restriction,
-- or privileges for the server and the sandbox overlay.

do $$
declare
  t text;
begin
  foreach t in array array[
    'assets', 'budgets', 'customers', 'dimensionNodes', 'employees', 'estimates', 'fixedAssets',
    'inventory', 'loans', 'partners', 'projects', 'purchaseOrders', 'recurring', 'rulePatterns',
    'scenarios', 'taxRates', 'vendors'
  ] loop
    execute format('drop policy if exists writer_insert on public.%I', t);
    execute format('drop policy if exists writer_update on public.%I', t);
    execute format('drop policy if exists writer_delete on public.%I', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

drop policy if exists admin_insert on public."chartAccounts";
drop policy if exists admin_update on public."chartAccounts";
drop policy if exists admin_delete on public."chartAccounts";
drop policy if exists owner_insert on public.workspaces;
drop policy if exists admin_update on public.workspaces;

-- This policy used to cover all four operations. Keep its exact private-read predicate.
drop policy if exists own_all on public."customTemplates";
drop policy if exists own_read on public."customTemplates";
create policy own_read on public."customTemplates" for select to authenticated
  using (data->>'uid' = public.lf_uid());

drop policy if exists member_insert on public."auditLogs";
drop policy if exists own_insert on public.documents;
drop policy if exists own_update on public.documents;
drop policy if exists error_insert on public."errorLogs";
drop policy if exists own_insert on public."learnedDeltas";
drop policy if exists own_update on public."learnedDeltas";
drop policy if exists own_update on public.notifications;
drop policy if exists own_delete on public.notifications;
drop policy if exists presence_insert on public.presence;
drop policy if exists presence_update on public.presence;
drop policy if exists message_insert on public."supportMessages";
drop policy if exists ticket_insert on public."supportTickets";
drop policy if exists ticket_update on public."supportTickets";
drop policy if exists self_insert on public.users;
drop policy if exists self_update on public.users;

revoke insert, update, delete on public."chartAccounts", public.workspaces, public."customTemplates",
  public."auditLogs", public.documents, public."errorLogs", public."learnedDeltas", public.notifications,
  public.presence, public."supportMessages", public."supportTickets", public.users from anon, authenticated;
