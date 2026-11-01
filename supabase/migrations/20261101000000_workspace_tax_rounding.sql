-- Y-35: the workspace's tax rounding policy (`taxRounding`: half_up | half_even | down), set by owners
-- and accountants under Settings like the time zone and fiscal year. The guard rejects a workspace
-- document with a field outside allowed_keys, so the field is listed here. A name already listed is
-- harmless (the guard tests `= any`).

update public.lf_rules
set allowed_keys = allowed_keys || array['taxRounding']
where table_name = 'workspaces';
