-- CA-29 (party link): a customer can name the vendor that is the same business (`linkedVendorId`).
-- Vendors have no allowed-field list (see 20261003000000_contact_fields.sql), so only the customer
-- list needs the key. Display only: the link changes no posting.
update public.lf_rules
set allowed_keys = allowed_keys || array['linkedVendorId']
where table_name = 'customers' and not ('linkedVendorId' = any(allowed_keys));

-- One customer per vendor in a workspace, enforced here so two people linking at once cannot both win.
-- An empty value means "not linked".
create unique index if not exists customers_linked_vendor_uniq
  on public.customers (workspace_id, (data->>'linkedVendorId'))
  where coalesce(data->>'linkedVendorId', '') <> '';
