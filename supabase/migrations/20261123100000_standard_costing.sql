-- M-21: the workspace's standard-costing setting (`standardCosting`: {enabled, varianceAccountId}),
-- written by workspace.standardcosting. Once the server stores it, a user save of the workspace would
-- be refused if the field were not allowed (the guard checks every field), so it goes on the allowlist
-- and, being server-written, the immutable list. A name already listed is harmless (the guard tests `= any`).

update public.lf_rules
set allowed_keys = allowed_keys || array['standardCosting']
where table_name = 'workspaces' and not ('standardCosting' = any(allowed_keys));

update public.lf_rules
set immutable_keys = immutable_keys || array['standardCosting']
where table_name = 'workspaces' and not ('standardCosting' = any(immutable_keys));
