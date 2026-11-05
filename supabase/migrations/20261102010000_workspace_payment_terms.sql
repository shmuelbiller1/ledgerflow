-- CC-08: the workspace's own payment terms (`paymentTermDays`: whole days, Net N), set by owners and
-- accountants under Settings and offered on invoices next to the standard terms. The guard rejects a
-- workspace document with a field outside allowed_keys, so the field is listed here. A name already
-- listed is harmless (the guard tests `= any`).

update public.lf_rules
set allowed_keys = allowed_keys || array['paymentTermDays']
where table_name = 'workspaces' and not ('paymentTermDays' = any(allowed_keys));
