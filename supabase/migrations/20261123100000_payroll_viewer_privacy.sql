-- Employee and pay-run records contain payroll and direct-deposit data. Membership alone must not
-- grant access. Writers retain payroll workflows; a member can read only their explicitly linked
-- employee record, never a row merely because they created it (`uid` is often the creator).
-- Existing restrictive two-step policies continue to apply.
drop policy if exists member_read on public.employees;
drop policy if exists employee_read on public.employees;
create policy employee_read on public.employees for select to authenticated
  using (public.lf_can_write(workspace_id)
    or (public.lf_is_member(workspace_id) and data->>'timeUid' = public.lf_uid()));

drop policy if exists member_read on public."payRuns";
drop policy if exists payrun_read on public."payRuns";
create policy payrun_read on public."payRuns" for select to authenticated
  using (public.lf_can_write(workspace_id));
