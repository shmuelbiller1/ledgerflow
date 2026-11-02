-- CC-09: the workspace's own payment types (`paymentTypes`: [{id, name, method}]), set by owners and
-- accountants under Settings; each sits under one of the five payment methods. Payments are written
-- by the server, which looks the type up here. The guard rejects a workspace document with a field
-- outside allowed_keys, so the field is listed. A name already listed is harmless.

update public.lf_rules
set allowed_keys = allowed_keys || array['paymentTypes']
where table_name = 'workspaces' and not ('paymentTypes' = any(allowed_keys));
