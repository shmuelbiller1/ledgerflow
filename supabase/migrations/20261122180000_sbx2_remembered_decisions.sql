-- SBX-2 Part 3: remembered decisions. One row per (workspace, command, subject, field): how many
-- resolved steps were seen and how often each choice was accepted. Only ids/codes and a normalised
-- payee/vendor key; no amounts or book text. Written by the server's own role inside the
-- accept/reject transaction; the assistant's lf_sandbox role and the PostgREST roles get nothing.
-- Its own schema: the sandbox schema holds only sandboxes, steps and overlay tables (housekeeping
-- clears every other table there by sandbox_id). Not exposed to PostgREST.
create schema if not exists assistant;
revoke all on schema assistant from public, anon, authenticated, service_role;

create table if not exists assistant."rememberedDecisions" (
  workspace_id text not null,
  command_name text not null,
  subject text not null check (length(subject) <= 260),
  field text not null check (length(field) <= 60),
  cases integer not null check (cases > 0),
  choices jsonb not null default '{}' check (jsonb_typeof(choices) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, command_name, subject, field)
);
revoke all on assistant."rememberedDecisions" from public, anon, authenticated, service_role, lf_sandbox;
alter table assistant."rememberedDecisions" enable row level security;
