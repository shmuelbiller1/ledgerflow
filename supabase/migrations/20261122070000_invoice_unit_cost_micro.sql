-- INV-02: an invoice line can carry a cost snapshot at micro-cent precision
-- (`unitCostMicroCents`, when the cost was carried exactly). The client writes it
-- with the line's other cost fields, so it is client-writable like `unitCostCents`.
update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['unitCostMicroCents']
where table_name = 'invoices';

-- The same micro-cent cost snapshot is stored on inventory items (the moving-average
-- cost at micro-cent precision, INV-02), so it is client-writable there as well.
update public.lf_rules
set allowed_keys = coalesce(allowed_keys, '{}') || array['unitCostMicroCents']
where table_name = 'inventory';
