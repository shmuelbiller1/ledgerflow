-- SBX-1: an accepted step whose recorded inverse has been run as a normal command is marked
-- "undone" so the review list can say so. Server-only; no grant changes (lf_sandbox already has
-- row-scoped access to its own steps, browsers have none).
alter table sandbox."sandboxSteps" drop constraint if exists "sandboxSteps_state_check";
alter table sandbox."sandboxSteps" add constraint "sandboxSteps_state_check"
  check (state in ('pending', 'accepted', 'rejected', 'needs-recheck', 'failed', 'undone'));
