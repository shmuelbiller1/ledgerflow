-- #913 / #916: a support ticket and its messages are visible to the person who filed it, to the
-- workspace's owners and accountants (the roles that triage tickets, `support.status`), and to
-- platform admins. Other members, viewers and bookkeepers included, no longer read someone else's ticket.
-- Ticket status changes go through the server (`support.status`), so the browser update policy is
-- dropped here as well (CMD-1 drops it too; this migration does not depend on CMD-1 being applied).

drop policy if exists ticket_read on public."supportTickets";
create policy ticket_read on public."supportTickets" for select to authenticated
  using (public.lf_is_platform_admin()
         or data->>'uid' = public.lf_uid()
         or public.lf_can_admin(workspace_id));

drop policy if exists ticket_update on public."supportTickets";

drop policy if exists message_read on public."supportMessages";
create policy message_read on public."supportMessages" for select to authenticated
  using (public.lf_is_platform_admin()
         or data->>'authorUid' = public.lf_uid()
         or public.lf_can_admin(workspace_id)
         or exists (
           select 1 from public."supportTickets" t
           where t.id = public."supportMessages".data->>'ticketId'
             and t.data->>'uid' = public.lf_uid()
         ));
