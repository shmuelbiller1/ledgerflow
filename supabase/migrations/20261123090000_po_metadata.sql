-- W-08: the drop-ship purchase order the server creates from an accepted quote carries a
-- `metadata` link (estimateId, estimateNumber, dropShip). The field is written only by the server,
-- so it goes on the allowlist (it does not block user saves) and the immutable list. A name already
-- listed is harmless (the guard tests `= any`).

update public.lf_rules
set allowed_keys = allowed_keys || array['metadata']
where table_name = 'purchaseOrders' and not ('metadata' = any(allowed_keys));

update public.lf_rules
set immutable_keys = immutable_keys || array['metadata']
where table_name = 'purchaseOrders' and not ('metadata' = any(immutable_keys));
