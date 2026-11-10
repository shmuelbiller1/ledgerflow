-- R-4: a short note per report and period on the workspace (`reportNotes`: { "<report>|<start>|<end>": text }),
-- written by the members who can change workspace settings, shown above the report and in its print / PDF.
-- At most 500 notes, each a string of at most 500 characters under a key of at most 120 characters.
update public.lf_rules
set allowed_keys = allowed_keys || array['reportNotes']
where table_name = 'workspaces' and not ('reportNotes' = any(allowed_keys));

create or replace function public.lf_valid_report_notes(v jsonb) returns boolean
language sql immutable
set search_path = ''
as $$
  select v is null or jsonb_typeof(v) = 'null' or (
    jsonb_typeof(v) = 'object'
    and (select count(*) from jsonb_object_keys(v)) <= 500
    and not exists (
      select 1 from jsonb_each(v) e
      where char_length(e.key) not between 1 and 120
         or jsonb_typeof(e.value) <> 'string'
         or char_length(e.value #>> '{}') not between 1 and 500
    )
  )
$$;

alter table public.workspaces drop constraint if exists workspaces_report_notes_shape;
alter table public.workspaces add constraint workspaces_report_notes_shape
  check (public.lf_valid_report_notes(data->'reportNotes')) not valid;
