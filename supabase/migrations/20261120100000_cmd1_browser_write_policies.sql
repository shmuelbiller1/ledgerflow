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
    execute format('drop policy writer_insert on public.%I', t);
    execute format('drop policy writer_update on public.%I', t);
    execute format('drop policy writer_delete on public.%I', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

drop policy admin_insert on public."chartAccounts";
drop policy admin_update on public."chartAccounts";
drop policy admin_delete on public."chartAccounts";
drop policy owner_insert on public.workspaces;
drop policy admin_update on public.workspaces;

-- This policy used to cover all four operations. Keep its exact private-read predicate.
drop policy own_all on public."customTemplates";
create policy own_read on public."customTemplates" for select to authenticated
  using (data->>'uid' = public.lf_uid());

drop policy member_insert on public."auditLogs";
drop policy own_insert on public.documents;
drop policy own_update on public.documents;
drop policy error_insert on public."errorLogs";
drop policy own_insert on public."learnedDeltas";
drop policy own_update on public."learnedDeltas";
drop policy own_update on public.notifications;
drop policy own_delete on public.notifications;
drop policy presence_insert on public.presence;
drop policy presence_update on public.presence;
drop policy message_insert on public."supportMessages";
drop policy ticket_insert on public."supportTickets";
drop policy ticket_update on public."supportTickets";
drop policy self_insert on public.users;
drop policy self_update on public.users;

revoke insert, update, delete on public."chartAccounts", public.workspaces, public."customTemplates",
  public."auditLogs", public.documents, public."errorLogs", public."learnedDeltas", public.notifications,
  public.presence, public."supportMessages", public."supportTickets", public.users from anon, authenticated;
