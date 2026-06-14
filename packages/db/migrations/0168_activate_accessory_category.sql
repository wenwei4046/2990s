-- 0168_activate_accessory_category.sql
-- Activate the POS "Accessories" category: flip its TBC ("Soon") gate off so it
-- renders as a live, selectable category. The 7 ACCESSORY SKUs are already
-- pos_active and read by the POS catalog (useMfgCatalog) — only the categories
-- table's tbc flag was hiding them. Loo 2026-06-13.
UPDATE categories SET tbc = false WHERE id = 'accessory';
