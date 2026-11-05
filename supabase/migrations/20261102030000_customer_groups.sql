-- CC-11: customer groups. The workspace keeps its groups and their defaults (`customerGroups`:
-- [{id, name, paymentTerms?}]); only the server writes them (POST /api/v1/workspaces/:id/customer-groups,
-- one change at a time in a serializable transaction), so the field is allowed (it does not block
-- user saves) and immutable for users. A customer names its group by id (`groupId`), which people
-- set on the customer. A name already listed is harmless (the guard tests `= any`).

update public.lf_rules
set allowed_keys = allowed_keys || array['customerGroups']
where table_name = 'workspaces' and not ('customerGroups' = any(allowed_keys));

update public.lf_rules
set immutable_keys = immutable_keys || array['customerGroups']
where table_name = 'workspaces' and not ('customerGroups' = any(immutable_keys));

update public.lf_rules
set allowed_keys = allowed_keys || array['groupId']
where table_name = 'customers' and not ('groupId' = any(allowed_keys));
