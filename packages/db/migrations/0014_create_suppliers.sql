-- 0014_create_suppliers.sql
-- Phase 4 sub-project D: suppliers table + products.supplier_id FK + 6-supplier seed.
-- whatsapp_number and email are nullable; coordinator populates via Supabase Studio
-- till Settings → Suppliers page is built (deferred per spec §1.2).

CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  whatsapp_number TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE products ADD COLUMN supplier_id UUID REFERENCES suppliers(id) ON DELETE RESTRICT;

INSERT INTO suppliers (code, name) VALUES
  ('SLP', 'Sleepworks Sdn Bhd'),
  ('KFA', 'Kraf Furnitur Asia'),
  ('OAK', 'Oakline Workshop'),
  ('AQS', 'Aquasense Bath Co.'),
  ('KID', 'Pinetop Kids Co.'),
  ('HMG', 'Homegoods Trading');
