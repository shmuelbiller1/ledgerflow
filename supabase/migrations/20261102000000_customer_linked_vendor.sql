-- CA-29 (party link): a customer can name the vendor that is the same business (`linkedVendorId`).
-- Vendors have no allowed-field list (see 20261003000000_contact_fields.sql), so only the customer
-- list needs the key. Display only: the link changes no posting.
update public.lf_rules
set allowed_keys = allowed_keys || array['linkedVendorId']
where table_name = 'customers' and not ('linkedVendorId' = any(allowed_keys));
