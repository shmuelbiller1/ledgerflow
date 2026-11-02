-- CC-09: the workspace's own payment types (`paymentTypes`: [{id, name, method}]), each under one of
-- the five payment methods. Only the server writes them (POST /api/v1/workspaces/:id/payment-types,
-- one change at a time in a serializable transaction), like the other server-kept lists, so the field
-- is allowed (it does not block user saves) and immutable for users. Payments are written by the
-- server, which looks the type up here. A name already listed is harmless (the guard tests `= any`).

update public.lf_rules
set allowed_keys = allowed_keys || array['paymentTypes']
where table_name = 'workspaces' and not ('paymentTypes' = any(allowed_keys));

update public.lf_rules
set immutable_keys = immutable_keys || array['paymentTypes']
where table_name = 'workspaces' and not ('paymentTypes' = any(immutable_keys));
