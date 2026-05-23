-- ====================================================================
-- hookka-products-import.sql
-- 
-- Auto-generated from HOOKKA scripts/seed.sql.
-- Regenerate with: node packages/db/scripts/import-from-hookka-seed.mjs \
--   ../../../hookka-erp-readonly/scripts/seed.sql > seeds/hookka-products-import.sql
-- 
-- Targets: mfg_products, product_dept_configs, fabrics, fabric_trackings
-- ====================================================================

BEGIN;

INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-1', '1003-(K)', 'HILTON BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'hilton bedframe king 6ft (183x190cm)', '1003', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 68000, NULL, 80, '[]'::jsonb, 'HL10-KHB-HIL03', 'FG66151-1', '{"count":3,"names":["HB","Divan","Legs"]}'::jsonb, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-2', '1003-(Q)', 'HILTON BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'hilton bedframe queen 5ft (152x190cm)', '1003', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 56000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-3', '1003-(S)', 'HILTON BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'hilton bedframe single 3ft (90x190cm)', '1003', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 50000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-4', '1003-(SS)', 'HILTON BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'hilton bedframe super single 3.5ft (107x190cm)', '1003', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 53000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-5', '1003(A)-(K)', 'HILTON(A) BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'hilton(a) bedframe king 6ft (183x190cm)', '1003(A)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 68000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-6', '1003(A)-(Q)', 'HILTON(A) BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'hilton(a) bedframe queen 5ft (152x190cm)', '1003(A)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 56000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-7', '1003(A)-(S)', 'HILTON(A) BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'hilton(a) bedframe single 3ft (90x190cm)', '1003(A)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 50000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-8', '1003(A)-(SS)', 'HILTON(A) BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'hilton(a) bedframe super single 3.5ft (107x190cm)', '1003(A)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 53000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-9', '1003(A)-(SK)', 'HILTON(A) BEDFRAME (200X200CM)', 'BEDFRAME'::mfg_product_category, 'hilton(a) bedframe super king 200x200cm', '1003(A)', 'SK', '200CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 112000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-10', '1003(A)-(SP)', 'HILTON(A) BEDFRAME (220X220CM)', 'BEDFRAME'::mfg_product_category, 'hilton(a) bedframe super plus 220x220cm', '1003(A)', 'SP', '220CMX220CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 123200, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-11', '1003(A)(HF)(W)-(K)', 'HILTON(A) BEDFRAME (HF)(W) (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'hilton(a) bedframe (hf)(w) king 6ft (183x190cm)', '1003(A)(HF)(W)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 68000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-12', '1003(A)(HF)(W)-(Q)', 'HILTON(A) BEDFRAME (HF)(W) (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'hilton(a) bedframe (hf)(w) queen 5ft (152x190cm)', '1003(A)(HF)(W)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 56000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-13', '1003(A)(HF)(W)-(S)', 'HILTON(A) BEDFRAME (HF)(W) (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'hilton(a) bedframe (hf)(w) single 3ft (90x190cm)', '1003(A)(HF)(W)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 50000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-14', '1003(A)(HF)(W)-(SS)', 'HILTON(A) BEDFRAME (HF)(W) (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'hilton(a) bedframe (hf)(w) super single 3.5ft (107x190cm)', '1003(A)(HF)(W)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 53000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-15', '1005-(K)', 'FENRIR BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'fenrir bedframe king 6ft (183x190cm)', '1005', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 52000, 46000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-16', '1005-(Q)', 'FENRIR BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'fenrir bedframe queen 5ft (152x190cm)', '1005', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 40000, 34000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-17', '1005-(S)', 'FENRIR BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'fenrir bedframe single 3ft (90x190cm)', '1005', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 38000, 32000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-18', '1005-(SK)', 'FENRIR BEDFRAME (200X200CM)', 'BEDFRAME'::mfg_product_category, 'fenrir bedframe super king 200x200cm', '1005', 'SK', '200CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 104000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-19', '1005-(SS)', 'FENRIR BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'fenrir bedframe super single 3.5ft (107x190cm)', '1005', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 39000, 33000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-20', '1007-(K)', 'CODY BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'cody bedframe king 6ft (183x190cm)', '1007', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 52000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-21', '1007-(Q)', 'CODY BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'cody bedframe queen 5ft (152x190cm)', '1007', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 40000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-22', '1007-(S)', 'CODY BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'cody bedframe single 3ft (90x190cm)', '1007', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 38000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-23', '1007-(SS)', 'CODY BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'cody bedframe super single 3.5ft (107x190cm)', '1007', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 39000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-24', '1007-(152X200)', 'CODY BEDFRAME (152X200CM)', 'BEDFRAME'::mfg_product_category, 'cody bedframe 152x200cm', '1007', '152X200', '152CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 80000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-25', '1007-(183X200)', 'CODY BEDFRAME (183X200CM)', 'BEDFRAME'::mfg_product_category, 'cody bedframe 183x200cm', '1007', '183X200', '183CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 80000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-26', '1007-(200X200)', 'CODY BEDFRAME (200X200CM)', 'BEDFRAME'::mfg_product_category, 'cody bedframe 200x200cm', '1007', '200X200', '200CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 104000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-27', '1007(HF)(W)-(K)', 'CODY BEDFRAME (HF)(W) (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'cody bedframe (hf)(w) king 6ft (183x190cm)', '1007(HF)(W)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 52000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-28', '1007(HF)(W)-(Q)', 'CODY BEDFRAME (HF)(W) (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'cody bedframe (hf)(w) queen 5ft (152x190cm)', '1007(HF)(W)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 40000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-29', '1007(HF)(W)-(S)', 'CODY BEDFRAME (HF)(W) (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'cody bedframe (hf)(w) single 3ft (90x190cm)', '1007(HF)(W)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 38000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-30', '1007(HF)(W)-(SS)', 'CODY BEDFRAME (HF)(W) (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'cody bedframe (hf)(w) super single 3.5ft (107x190cm)', '1007(HF)(W)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 39000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-31', '1008-(K)', 'RICARDO BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'ricardo bedframe king 6ft (183x190cm)', '1008', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 50800, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-32', '1008-(Q)', 'RICARDO BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'ricardo bedframe queen 5ft (152x190cm)', '1008', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 37800, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-33', '1008-(S)', 'RICARDO BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'ricardo bedframe single 3ft (90x190cm)', '1008', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 32400, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-34', '1008-(SS)', 'RICARDO BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'ricardo bedframe super single 3.5ft (107x190cm)', '1008', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 33500, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-35', '1009(A)-(K)', 'VALKRIE(A) BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'valkrie(a) bedframe king 6ft (183x190cm)', '1009(A)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 50800, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-36', '1009(A)-(Q)', 'VALKRIE(A) BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'valkrie(a) bedframe queen 5ft (152x190cm)', '1009(A)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 37800, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-37', '1009(A)-(S)', 'VALKRIE(A) BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'valkrie(a) bedframe single 3ft (90x190cm)', '1009(A)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 38000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-38', '1009(A)-(SS)', 'VALKRIE(A) BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'valkrie(a) bedframe super single 3.5ft (107x190cm)', '1009(A)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 39000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-39', '1013-(K)', 'JAGER BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'jager bedframe king 6ft (183x190cm)', '1013', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 40000, 32000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-40', '1013-(Q)', 'JAGER BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'jager bedframe queen 5ft (152x190cm)', '1013', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 28000, 20000, 80, '[]'::jsonb, 'JG13-QHB-JAG02', 'FG66152-3', '{"count":3,"names":["HB","Divan","Legs"]}'::jsonb, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-41', '1013-(S)', 'JAGER BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'jager bedframe single 3ft (90x190cm)', '1013', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 26000, 18000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-42', '1013-(SS)', 'JAGER BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'jager bedframe super single 3.5ft (107x190cm)', '1013', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 27000, 19000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-43', '1013-(SK)', 'JAGER BEDFRAME (200X200CM)', 'BEDFRAME'::mfg_product_category, 'jager bedframe super king 200x200cm', '1013', 'SK', '200CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 80000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-44', '1019(A)-(K)', 'ARIZONA BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'arizona bedframe king 6ft (183x190cm)', '1019(A)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 63000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-45', '1019(A)-(Q)', 'ARIZONA BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'arizona bedframe queen 5ft (152x190cm)', '1019(A)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 51000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-46', '1019(A)-(S)', 'ARIZONA BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'arizona bedframe single 3ft (90x190cm)', '1019(A)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 43000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-47', '1019(A)-(SS)', 'ARIZONA BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'arizona bedframe super single 3.5ft (107x190cm)', '1019(A)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 48000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-48', '1019(A)(HF)(W)-(K)', 'ARIZONA BEDFRAME (HF)(W) (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'arizona bedframe (hf)(w) king 6ft (183x190cm)', '1019(A)(HF)(W)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 67000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-49', '1019(A)(HF)(W)-(Q)', 'ARIZONA BEDFRAME (HF)(W) (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'arizona bedframe (hf)(w) queen 5ft (152x190cm)', '1019(A)(HF)(W)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 55000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-50', '1019(A)(HF)(W)-(S)', 'ARIZONA BEDFRAME (HF)(W) (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'arizona bedframe (hf)(w) single 3ft (90x190cm)', '1019(A)(HF)(W)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 47000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-51', '1019(A)(HF)(W)-(SS)', 'ARIZONA BEDFRAME (HF)(W) (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'arizona bedframe (hf)(w) super single 3.5ft (107x190cm)', '1019(A)(HF)(W)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 52000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-52', '1041-(K)', 'VICTORIA BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'victoria bedframe king 6ft (183x190cm)', '1041', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 49500, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-53', '1041-(Q)', 'VICTORIA BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'victoria bedframe queen 5ft (152x190cm)', '1041', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 37500, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-54', '1041-(S)', 'VICTORIA BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'victoria bedframe single 3ft (90x190cm)', '1041', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 35500, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-55', '1041-(SS)', 'VICTORIA BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'victoria bedframe super single 3.5ft (107x190cm)', '1041', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 36500, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-56', '1041-(SP)', 'VICTORIA BEDFRAME (107X200CM)', 'BEDFRAME'::mfg_product_category, 'victoria bedframe 107x200cm', '1041', 'SP', '107CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 73000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-57', '1023-(K)', 'COTY BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'coty bedframe king 6ft (183x190cm)', '1023', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 52000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-58', '1023-(Q)', 'COTY BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'coty bedframe queen 5ft (152x190cm)', '1023', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 40000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-59', '1023-(S)', 'COTY BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'coty bedframe single 3ft (90x190cm)', '1023', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 38000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-60', '1023-(SS)', 'COTY BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'coty bedframe super single 3.5ft (107x190cm)', '1023', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 39000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-61', '1023(HF)(W)-(K)', 'COTY BEDFRAME (HF)(W) (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'coty bedframe (hf)(w) king 6ft (183x190cm)', '1023(HF)(W)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 52000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-62', '1023(HF)(W)-(Q)', 'COTY BEDFRAME (HF)(W) (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'coty bedframe (hf)(w) queen 5ft (152x190cm)', '1023(HF)(W)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 39000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-63', '1023(HF)(W)-(S)', 'COTY BEDFRAME (HF)(W) (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'coty bedframe (hf)(w) single 3ft (90x190cm)', '1023(HF)(W)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 38000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-64', '1023(HF)(W)-(SS)', 'COTY BEDFRAME (HF)(W) (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'coty bedframe (hf)(w) super single 3.5ft (107x190cm)', '1023(HF)(W)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 39000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-65', '1030-(K)', 'TIFANNY BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'tifanny bedframe king 6ft (183x190cm)', '1030', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 52000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-66', '1030-(Q)', 'TIFANNY BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'tifanny bedframe queen 5ft (152x190cm)', '1030', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 40000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-67', '1030-(S)', 'TIFANNY BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'tifanny bedframe single 3ft (90x190cm)', '1030', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 38000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-68', '1030-(SS)', 'TIFANNY BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'tifanny bedframe super single 3.5ft (107x190cm)', '1030', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 39000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-69', '1030(HF)(W)-(Q)', 'TIFANNY BEDFRAME (HF)(W) (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'tifanny bedframe (hf)(w) queen 5ft (152x190cm)', '1030(HF)(W)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 40000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-70', '1030(HF)(W)-(K)', 'TIFANNY BEDFRAME (HF)(W) (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'tifanny bedframe (hf)(w) king 6ft (183x190cm)', '1030(HF)(W)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 52000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-71', '2003-(K)', 'ELEPHANE BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'elephane bedframe king 6ft (183x190cm)', '2003', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 90000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-72', '2003-(Q)', 'ELEPHANE BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'elephane bedframe queen 5ft (152x190cm)', '2003', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 80000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-73', '2003-(S)', 'ELEPHANE BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'elephane bedframe single 3ft (90x190cm)', '2003', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 72000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-74', '2003-(SS)', 'ELEPHANE BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'elephane bedframe super single 3.5ft (107x190cm)', '2003', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 75000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-75', '2003-(SP)', 'ELEPHANE BEDFRAME (183X200CM)', 'BEDFRAME'::mfg_product_category, 'elephane bedframe 183x200cm', '2003', 'SP', '183CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 180000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-76', '2006-(K)', 'REGAL BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'regal bedframe king 6ft (183x190cm)', '2006', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 67000, 62000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-77', '2006-(Q)', 'REGAL BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'regal bedframe queen 5ft (152x190cm)', '2006', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 55000, 50000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-78', '2006-(S)', 'REGAL BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'regal bedframe single 3ft (90x190cm)', '2006', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 47000, 42000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-79', '2006-(SS)', 'REGAL BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'regal bedframe super single 3.5ft (107x190cm)', '2006', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 52000, 47000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-80', '2006(A)-(K)', 'REGAL(A) BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'regal(a) bedframe king 6ft (183x190cm)', '2006(A)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 67000, 62000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-81', '2006(A)-(Q)', 'REGAL(A) BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'regal(a) bedframe queen 5ft (152x190cm)', '2006(A)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 55000, 50000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-82', '2006(A)-(S)', 'REGAL(A) BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'regal(a) bedframe single 3ft (90x190cm)', '2006(A)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 47000, 42000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-83', '2006(A)-(SS)', 'REGAL(A) BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'regal(a) bedframe super single 3.5ft (107x190cm)', '2006(A)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 52000, 47000, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-84', '2006(A)-(SK)', 'REGAL(A) BEDFRAME (200X200CM)', 'BEDFRAME'::mfg_product_category, 'regal(a) bedframe super king 200x200cm', '2006(A)', 'SK', '200CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 160000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-85', '2008-(K)', 'TRION (HB STRAIGHT) BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'trion (hb straight) bedframe king 6ft (183x190cm)', '2008', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 80000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-86', '2008-(Q)', 'TRION (HB STRAIGHT) BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'trion (hb straight) bedframe queen 5ft (152x190cm)', '2008', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 70000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-87', '2008-(S)', 'TRION (HB STRAIGHT) BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'trion (hb straight) bedframe single 3ft (90x190cm)', '2008', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 64000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-88', '2008-(SS)', 'TRION (HB STRAIGHT) BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'trion (hb straight) bedframe super single 3.5ft (107x190cm)', '2008', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 67000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-89', '2008(A)-(K)', 'TRION(A) (HB STRAIGHT) BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) (hb straight) bedframe king 6ft (183x190cm)', '2008(A)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 80000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-90', '2008(A)-(Q)', 'TRION(A) (HB STRAIGHT) BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) (hb straight) bedframe queen 5ft (152x190cm)', '2008(A)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 70000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-91', '2008(A)-(S)', 'TRION(A) (HB STRAIGHT) BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) (hb straight) bedframe single 3ft (90x190cm)', '2008(A)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 64000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-92', '2008(A)-(SS)', 'TRION(A) (HB STRAIGHT) BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) (hb straight) bedframe super single 3.5ft (107x190cm)', '2008(A)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 67000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-93', '2008(A)-(SP)', 'TRION(A) (HB STRAIGHT) BEDFRAME (183X200CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) (hb straight) bedframe 183x200cm', '2008(A)', 'SP', '183CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 160000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-94', '2008(A)-(SK)', 'TRION(A) (HB STRAIGHT) BEDFRAME (200X200CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) (hb straight) bedframe super king 200x200cm', '2008(A)', 'SK', '200CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 160000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-95', '2008(A)-(152X200)', 'TRION(A) (HB STRAIGHT) BEDFRAME (152X200CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) (hb straight) bedframe 152x200cm', '2008(A)', '152X200', '152CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 140000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-96', '2009-(K)', 'TRION BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'trion bedframe king 6ft (183x190cm)', '2009', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 80000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-97', '2009-(Q)', 'TRION BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'trion bedframe queen 5ft (152x190cm)', '2009', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 70000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-98', '2009-(S)', 'TRION BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'trion bedframe single 3ft (90x190cm)', '2009', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 64000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-99', '2009-(SS)', 'TRION BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'trion bedframe super single 3.5ft (107x190cm)', '2009', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 67000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-100', '2009(A)-(K)', 'TRION(A) BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) bedframe king 6ft (183x190cm)', '2009(A)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 80000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-101', '2009(A)-(Q)', 'TRION(A) BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) bedframe queen 5ft (152x190cm)', '2009(A)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 70000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-102', '2009(A)-(S)', 'TRION(A) BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) bedframe single 3ft (90x190cm)', '2009(A)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 64000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-103', '2009(A)-(SS)', 'TRION(A) BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) bedframe super single 3.5ft (107x190cm)', '2009(A)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 67000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-104', '2009(A)-(SP)', 'TRION(A) BEDFRAME (210X210CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) bedframe 210x210cm', '2009(A)', 'SP', '210CMX210CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 160000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-105', '2009(A)-(SK)', 'TRION(A) BEDFRAME (200X200CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) bedframe super king 200x200cm', '2009(A)', 'SK', '200CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 160000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-106', '2009(A)-(152X200)', 'TRION(A) BEDFRAME (152X200CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) bedframe 152x200cm', '2009(A)', '152X200', '152CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 140000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-107', '2010(A)-(K)', 'TRION(A) WITHOUT PIPING BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) without piping bedframe king 6ft (183x190cm)', '2010(A)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 80000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-108', '2010(A)-(Q)', 'TRION(A) WITHOUT PIPING BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) without piping bedframe queen 5ft (152x190cm)', '2010(A)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 70000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-109', '2010(A)-(S)', 'TRION(A) WITHOUT PIPING BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) without piping bedframe single 3ft (90x190cm)', '2010(A)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 64000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-110', '2010(A)-(SS)', 'TRION(A) WITHOUT PIPING BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) without piping bedframe super single 3.5ft (107x190cm)', '2010(A)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 67000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-111', '2011(A)-(K)', 'TRION(A) W/O PIPING (HB STRAIGHT) BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) w/o piping (hb straight) bedframe king 6ft (183x190cm)', '2011(A)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 80000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-112', '2011(A)-(Q)', 'TRION(A) W/O PIPING (HB STRAIGHT) BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) w/o piping (hb straight) bedframe queen 5ft (152x190cm)', '2011(A)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 70000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-113', '2011(A)-(S)', 'TRION(A) W/O PIPING (HB STRAIGHT) BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) w/o piping (hb straight) bedframe single 3ft (90x190cm)', '2011(A)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 64000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-114', '2011(A)-(SS)', 'TRION(A) W/O PIPING (HB STRAIGHT) BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) w/o piping (hb straight) bedframe super single 3.5ft (107x190cm)', '2011(A)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 67000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-115', '2011(A)-(SK)', 'TRION(A) W/O PIPING (HB STRAIGHT) BEDFRAME (200X200CM)', 'BEDFRAME'::mfg_product_category, 'trion(a) w/o piping (hb straight) bedframe super king 200x200cm', '2011(A)', 'SK', '200CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 160000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-116', '2023-(K)', 'ADJUSTABLE BEDFRAME (6FT)', 'BEDFRAME'::mfg_product_category, 'adjustable bedframe king 6ft', '2023', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 70000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-117', '2023(HF)(W)-(K)', 'ADJUSTABLE BEDFRAME (HF)(W) (6FT)', 'BEDFRAME'::mfg_product_category, 'adjustable bedframe (hf)(w) king 6ft', '2023(HF)(W)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 70000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-118', '2023(HF)(W)-(S)', 'ADJUSTABLE BEDFRAME (HF)(W) (3FT)', 'BEDFRAME'::mfg_product_category, 'adjustable bedframe (hf)(w) single 3ft', '2023(HF)(W)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 56000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-119', '2027-(K)', 'NINA BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'nina bedframe king 6ft (183x190cm)', '2027', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 80000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-120', '2027-(Q)', 'NINA BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'nina bedframe queen 5ft (152x190cm)', '2027', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 70000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-121', '2027-(S)', 'NINA BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'nina bedframe single 3ft (90x190cm)', '2027', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 64000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-122', '2027-(SS)', 'NINA BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'nina bedframe super single 3.5ft (107x190cm)', '2027', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 67000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-123', '2038(A)-(K)', 'CELENE(A) BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'celene(a) bedframe king 6ft (183x190cm)', '2038(A)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 68000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-124', '2038(A)-(Q)', 'CELENE(A) BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'celene(a) bedframe queen 5ft (152x190cm)', '2038(A)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 56000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-125', '2038(A)-(S)', 'CELENE(A) BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'celene(a) bedframe single 3ft (90x190cm)', '2038(A)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 50000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-126', '2038(A)-(SS)', 'CELENE(A) BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'celene(a) bedframe super single 3.5ft (107x190cm)', '2038(A)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 53000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-127', '2038(A)(HF)(W)-(K)', 'CELENE(A) BEDFRAME (HF)(W) (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'celene(a) bedframe (hf)(w) king 6ft (183x190cm)', '2038(A)(HF)(W)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 68000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-128', '2038(A)(HF)(W)-(Q)', 'CELENE(A) BEDFRAME (HF)(W) (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'celene(a) bedframe (hf)(w) queen 5ft (152x190cm)', '2038(A)(HF)(W)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 56000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-129', '2041(A)-(K)', 'ELEGANT(A) BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'elegant(a) bedframe king 6ft (183x190cm)', '2041(A)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 68000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-130', '2041(A)-(Q)', 'ELEGANT(A) BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'elegant(a) bedframe queen 5ft (152x190cm)', '2041(A)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 56000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-131', '2041(A)-(SS)', 'ELEGANT(A) BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'elegant(a) bedframe super single 3.5ft (107x190cm)', '2041(A)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 53000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-132', '2041(A)-(S)', 'ELEGANT(A) BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'elegant(a) bedframe single 3ft (90x190cm)', '2041(A)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 50000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-133', '2033-(K)', 'JACOB BEDFRAME (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'jacob bedframe king 6ft (183x190cm)', '2033', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 82000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-134', '2033-(Q)', 'JACOB BEDFRAME (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'jacob bedframe queen 5ft (152x190cm)', '2033', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 70000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-135', '2033-(S)', 'JACOB BEDFRAME (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'jacob bedframe single 3ft (90x190cm)', '2033', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 64000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-136', '2033-(SS)', 'JACOB BEDFRAME (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'jacob bedframe super single 3.5ft (107x190cm)', '2033', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 67000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-137', '2033(HF)(W)-(K)', 'JACOB BEDFRAME (HF)(W) (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'jacob bedframe (hf)(w) king 6ft (183x190cm)', '2033(HF)(W)', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 70000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-138', '2033(HF)(W)-(Q)', 'JACOB BEDFRAME (HF)(W) (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'jacob bedframe (hf)(w) queen 5ft (152x190cm)', '2033(HF)(W)', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 70000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-139', '2033(HF)(W)-(S)', 'JACOB BEDFRAME (HF)(W) (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'jacob bedframe (hf)(w) single 3ft (90x190cm)', '2033(HF)(W)', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 64000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-140', '2033(HF)(W)-(SS)', 'JACOB BEDFRAME (HF)(W) (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'jacob bedframe (hf)(w) super single 3.5ft (107x190cm)', '2033(HF)(W)', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 67000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-141', 'DIVAN-(210)', 'DIVAN ONLY (210X210CM)', 'BEDFRAME'::mfg_product_category, 'divan only 210x210cm', 'DIVAN', '210', '210CMX210CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 88200, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-142', 'DIVAN-(200)', 'DIVAN ONLY (200X200CM)', 'BEDFRAME'::mfg_product_category, 'divan only 200x200cm', 'DIVAN', '200', '200CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 82000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-143', 'DIVAN-(210X200)', 'DIVAN ONLY (210X200CM)', 'BEDFRAME'::mfg_product_category, 'divan only 210x200cm', 'DIVAN', '210X200', '210CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 82000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-144', 'DIVAN-(170)', 'DIVAN ONLY (170X200CM)', 'BEDFRAME'::mfg_product_category, 'divan only 170x200cm', 'DIVAN', '170', '170CMX200CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 71400, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-145', 'DIVAN-(153)', 'DIVAN ONLY (153X210CM)', 'BEDFRAME'::mfg_product_category, 'divan only 153x210cm', 'DIVAN', '153', '153CMX210CM', 400, 950, 'ACTIVE'::mfg_product_status, 0, 60000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-146', 'DIVAN-(K)', 'DIVAN ONLY (6FT) (183X190CM)', 'BEDFRAME'::mfg_product_category, 'divan only king 6ft (183x190cm)', 'DIVAN', 'K', '6FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 42000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-147', 'DIVAN-(Q)', 'DIVAN ONLY (5FT) (152X190CM)', 'BEDFRAME'::mfg_product_category, 'divan only queen 5ft (152x190cm)', 'DIVAN', 'Q', '5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 30000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-148', 'DIVAN-(S)', 'DIVAN ONLY (3FT) (90X190CM)', 'BEDFRAME'::mfg_product_category, 'divan only single 3ft (90x190cm)', 'DIVAN', 'S', '3FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 28000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-149', 'DIVAN-(SS)', 'DIVAN ONLY (3.5FT) (107X190CM)', 'BEDFRAME'::mfg_product_category, 'divan only super single 3.5ft (107x190cm)', 'DIVAN', 'SS', '3.5FT', 400, 950, 'ACTIVE'::mfg_product_status, 0, 29000, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, NULL) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-150', '5530-1NA', 'SOFA 5530 1NA', 'SOFA'::mfg_product_category, 'sofa 5530 module 1NA', '5530', '1NA', '1NA', 400, 690, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":51700},{"height":"28","priceSen":57200},{"height":"30","priceSen":57200},{"height":"32","priceSen":77200},{"height":"35","priceSen":77200}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-151', '5530-2NA', 'SOFA 5530 2NA', 'SOFA'::mfg_product_category, 'sofa 5530 module 2NA', '5530', '2NA', '2NA', 400, 1350, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":102900},{"height":"28","priceSen":107800},{"height":"30","priceSen":113300},{"height":"32","priceSen":133300},{"height":"35","priceSen":133300}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-152', '5530-1A(LHF)', 'SOFA 5530 1A(LHF)', 'SOFA'::mfg_product_category, 'sofa 5530 module 1A(LHF)', '5530', '1A(LHF)', '1A(LHF)', 400, 990, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":55000},{"height":"28","priceSen":64900},{"height":"30","priceSen":64900},{"height":"32","priceSen":84900},{"height":"35","priceSen":84900}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-153', '5530-1A(RHF)', 'SOFA 5530 1A(RHF)', 'SOFA'::mfg_product_category, 'sofa 5530 module 1A(RHF)', '5530', '1A(RHF)', '1A(RHF)', 400, 990, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":55000},{"height":"28","priceSen":64900},{"height":"30","priceSen":64900},{"height":"32","priceSen":84900},{"height":"35","priceSen":84900}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-154', '5530-2A(LHF)', 'SOFA 5530 2A(LHF)', 'SOFA'::mfg_product_category, 'sofa 5530 module 2A(LHF)', '5530', '2A(LHF)', '2A(LHF)', 400, 1660, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":104500},{"height":"28","priceSen":110000},{"height":"30","priceSen":114400},{"height":"32","priceSen":134400},{"height":"35","priceSen":134400}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-155', '5530-2A(RHF)', 'SOFA 5530 2A(RHF)', 'SOFA'::mfg_product_category, 'sofa 5530 module 2A(RHF)', '5530', '2A(RHF)', '2A(RHF)', 400, 1660, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":104500},{"height":"28","priceSen":110000},{"height":"30","priceSen":114400},{"height":"32","priceSen":134400},{"height":"35","priceSen":134400}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-156', '5530-L(LHF)', 'SOFA 5530 L(LHF)', 'SOFA'::mfg_product_category, 'sofa 5530 module L(LHF)', '5530', 'L(LHF)', 'L(LHF)', 400, 1940, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":110000},{"height":"28","priceSen":115500},{"height":"30","priceSen":120500},{"height":"32","priceSen":140500},{"height":"35","priceSen":140500}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-157', '5530-L(RHF)', 'SOFA 5530 L(RHF)', 'SOFA'::mfg_product_category, 'sofa 5530 module L(RHF)', '5530', 'L(RHF)', 'L(RHF)', 400, 1940, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":110000},{"height":"28","priceSen":115500},{"height":"30","priceSen":120500},{"height":"32","priceSen":140500},{"height":"35","priceSen":140500}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-158', '5530-CNR', 'SOFA 5530 CNR', 'SOFA'::mfg_product_category, 'sofa 5530 module CNR', '5530', 'CNR', 'CNR', 400, 2080, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":90200},{"height":"28","priceSen":90200},{"height":"30","priceSen":90200},{"height":"32","priceSen":110200},{"height":"35","priceSen":110200}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-159', '5530-3S', 'SOFA 5530 3S', 'SOFA'::mfg_product_category, 'sofa 5530 module 3S', '5530', '3S', '3S', 400, 2600, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, 'OS30-3S-OSL01', 'FG66170-2', '{"count":5,"names":["Frame","Back Cushion L","Back Cushion R","Seat Cushion","Armrest Pair"]}'::jsonb, '[{"height":"24","priceSen":157300},{"height":"28","priceSen":162100},{"height":"30","priceSen":174900},{"height":"32","priceSen":194900},{"height":"35","priceSen":194900}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-160', '5530-2S', 'SOFA 5530 2S', 'SOFA'::mfg_product_category, 'sofa 5530 module 2S', '5530', '2S', '2S', 400, 1960, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, 'OS30-2S-OSL01', 'FG66170-2', '{"count":4,"names":["Frame","Back Cushion","Seat Cushion","Armrest Pair"]}'::jsonb, '[{"height":"24","priceSen":118000},{"height":"28","priceSen":121700},{"height":"30","priceSen":132000},{"height":"32","priceSen":152000},{"height":"35","priceSen":152000}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-161', '5530-1S', 'SOFA 5530 1S', 'SOFA'::mfg_product_category, 'sofa 5530 module 1S', '5530', '1S', '1S', 400, 970, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":82200},{"height":"28","priceSen":84700},{"height":"30","priceSen":91900},{"height":"32","priceSen":111900},{"height":"35","priceSen":111900}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-162', '5531-1NA', 'SOFA 5531 1NA', 'SOFA'::mfg_product_category, 'sofa 5531 module 1NA', '5531', '1NA', '1NA', 400, 690, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":52000},{"height":"28","priceSen":52000},{"height":"30","priceSen":52000},{"height":"32","priceSen":72000},{"height":"35","priceSen":72000}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-163', '5531-2NA', 'SOFA 5531 2NA', 'SOFA'::mfg_product_category, 'sofa 5531 module 2NA', '5531', '2NA', '2NA', 400, 1350, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":93600},{"height":"28","priceSen":93600},{"height":"30","priceSen":93600},{"height":"32","priceSen":113600},{"height":"35","priceSen":113600}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-164', '5531-1A(LHF)', 'SOFA 5531 1A(LHF)', 'SOFA'::mfg_product_category, 'sofa 5531 module 1A(LHF)', '5531', '1A(LHF)', '1A(LHF)', 400, 990, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":69000},{"height":"28","priceSen":73800},{"height":"30","priceSen":73800},{"height":"32","priceSen":93800},{"height":"35","priceSen":93800}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-165', '5531-1A(RHF)', 'SOFA 5531 1A(RHF)', 'SOFA'::mfg_product_category, 'sofa 5531 module 1A(RHF)', '5531', '1A(RHF)', '1A(RHF)', 400, 990, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":69000},{"height":"28","priceSen":73800},{"height":"30","priceSen":73800},{"height":"32","priceSen":93800},{"height":"35","priceSen":93800}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-166', '5531-2A(LHF)', 'SOFA 5531 2A(LHF)', 'SOFA'::mfg_product_category, 'sofa 5531 module 2A(LHF)', '5531', '2A(LHF)', '2A(LHF)', 400, 1660, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":102400},{"height":"28","priceSen":109100},{"height":"30","priceSen":109100},{"height":"32","priceSen":129100},{"height":"35","priceSen":129100}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-167', '5531-2A(RHF)', 'SOFA 5531 2A(RHF)', 'SOFA'::mfg_product_category, 'sofa 5531 module 2A(RHF)', '5531', '2A(RHF)', '2A(RHF)', 400, 1660, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":102400},{"height":"28","priceSen":109100},{"height":"30","priceSen":109100},{"height":"32","priceSen":129100},{"height":"35","priceSen":129100}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-168', '5531-L(LHF)', 'SOFA 5531 L(LHF)', 'SOFA'::mfg_product_category, 'sofa 5531 module L(LHF)', '5531', 'L(LHF)', 'L(LHF)', 400, 1940, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":95100},{"height":"28","priceSen":98800},{"height":"30","priceSen":98800},{"height":"32","priceSen":118800},{"height":"35","priceSen":118800}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-169', '5531-L(RHF)', 'SOFA 5531 L(RHF)', 'SOFA'::mfg_product_category, 'sofa 5531 module L(RHF)', '5531', 'L(RHF)', 'L(RHF)', 400, 1940, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":95100},{"height":"28","priceSen":98800},{"height":"30","priceSen":98800},{"height":"32","priceSen":118800},{"height":"35","priceSen":118800}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-170', '5531-CNR', 'SOFA 5531 CNR', 'SOFA'::mfg_product_category, 'sofa 5531 module CNR', '5531', 'CNR', 'CNR', 400, 2080, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":83200},{"height":"28","priceSen":83200},{"height":"30","priceSen":83200},{"height":"32","priceSen":103200},{"height":"35","priceSen":103200}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-171', '5531-3S', 'SOFA 5531 3S', 'SOFA'::mfg_product_category, 'sofa 5531 module 3S', '5531', '3S', '3S', 400, 2600, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":146400},{"height":"28","priceSen":155500},{"height":"30","priceSen":155500},{"height":"32","priceSen":175500},{"height":"35","priceSen":175500}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-172', '5531-2S', 'SOFA 5531 2S', 'SOFA'::mfg_product_category, 'sofa 5531 module 2S', '5531', '2S', '2S', 400, 1960, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":109800},{"height":"28","priceSen":116600},{"height":"30","priceSen":116600},{"height":"32","priceSen":136600},{"height":"35","priceSen":136600}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-173', '5531-1S', 'SOFA 5531 1S', 'SOFA'::mfg_product_category, 'sofa 5531 module 1S', '5531', '1S', '1S', 400, 970, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":76500},{"height":"28","priceSen":81300},{"height":"30","priceSen":81300},{"height":"32","priceSen":101300},{"height":"35","priceSen":101300}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-174', '5535-1NA', 'SOFA 5535 1NA', 'SOFA'::mfg_product_category, 'sofa 5535 module 1NA', '5535', '1NA', '1NA', 400, 690, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":58300},{"height":"28","priceSen":58300},{"height":"30","priceSen":58300},{"height":"32","priceSen":78300},{"height":"35","priceSen":78300}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-175', '5535-2NA', 'SOFA 5535 2NA', 'SOFA'::mfg_product_category, 'sofa 5535 module 2NA', '5535', '2NA', '2NA', 400, 1350, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":94500},{"height":"28","priceSen":94500},{"height":"30","priceSen":94500},{"height":"32","priceSen":114500},{"height":"35","priceSen":114500}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-176', '5535-1A(LHF)', 'SOFA 5535 1A(LHF)', 'SOFA'::mfg_product_category, 'sofa 5535 module 1A(LHF)', '5535', '1A(LHF)', '1A(LHF)', 400, 990, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":61200},{"height":"28","priceSen":66000},{"height":"30","priceSen":66000},{"height":"32","priceSen":86000},{"height":"35","priceSen":86000}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-177', '5535-1A(RHF)', 'SOFA 5535 1A(RHF)', 'SOFA'::mfg_product_category, 'sofa 5535 module 1A(RHF)', '5535', '1A(RHF)', '1A(RHF)', 400, 990, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":61200},{"height":"28","priceSen":66000},{"height":"30","priceSen":66000},{"height":"32","priceSen":86000},{"height":"35","priceSen":86000}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-178', '5535-2A(LHF)', 'SOFA 5535 2A(LHF)', 'SOFA'::mfg_product_category, 'sofa 5535 module 2A(LHF)', '5535', '2A(LHF)', '2A(LHF)', 400, 1660, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":55000},{"height":"28","priceSen":64900},{"height":"30","priceSen":64900},{"height":"32","priceSen":84900},{"height":"35","priceSen":84900}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-179', '5535-2A(RHF)', 'SOFA 5535 2A(RHF)', 'SOFA'::mfg_product_category, 'sofa 5535 module 2A(RHF)', '5535', '2A(RHF)', '2A(RHF)', 400, 1660, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":55000},{"height":"28","priceSen":64900},{"height":"30","priceSen":64900},{"height":"32","priceSen":84900},{"height":"35","priceSen":84900}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-180', '5535-L(LHF)', 'SOFA 5535 L(LHF)', 'SOFA'::mfg_product_category, 'sofa 5535 module L(LHF)', '5535', 'L(LHF)', 'L(LHF)', 400, 1940, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":104500},{"height":"28","priceSen":110000},{"height":"30","priceSen":114400},{"height":"32","priceSen":134400},{"height":"35","priceSen":134400}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-181', '5535-L(RHF)', 'SOFA 5535 L(RHF)', 'SOFA'::mfg_product_category, 'sofa 5535 module L(RHF)', '5535', 'L(RHF)', 'L(RHF)', 400, 1940, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":104500},{"height":"28","priceSen":110000},{"height":"30","priceSen":114400},{"height":"32","priceSen":134400},{"height":"35","priceSen":134400}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-182', '5535-CNR', 'SOFA 5535 CNR', 'SOFA'::mfg_product_category, 'sofa 5535 module CNR', '5535', 'CNR', 'CNR', 400, 2080, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":83200},{"height":"28","priceSen":83200},{"height":"30","priceSen":83200},{"height":"32","priceSen":103200},{"height":"35","priceSen":103200}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-183', '5535-3S', 'SOFA 5535 3S', 'SOFA'::mfg_product_category, 'sofa 5535 module 3S', '5535', '3S', '3S', 400, 2600, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":155400},{"height":"28","priceSen":164500},{"height":"30","priceSen":164500},{"height":"32","priceSen":184500},{"height":"35","priceSen":184500}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-184', '5535-2S', 'SOFA 5535 2S', 'SOFA'::mfg_product_category, 'sofa 5535 module 2S', '5535', '2S', '2S', 400, 1960, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":116600},{"height":"28","priceSen":123400},{"height":"30","priceSen":123400},{"height":"32","priceSen":143400},{"height":"35","priceSen":143400}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-185', '5535-1S', 'SOFA 5535 1S', 'SOFA'::mfg_product_category, 'sofa 5535 module 1S', '5535', '1S', '1S', 400, 970, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":81200},{"height":"28","priceSen":86000},{"height":"30","priceSen":86000},{"height":"32","priceSen":106000},{"height":"35","priceSen":106000}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-186', '5536-1NA', 'SOFA 5536 1NA', 'SOFA'::mfg_product_category, 'sofa 5536 module 1NA', '5536', '1NA', '1NA', 400, 690, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":51700},{"height":"28","priceSen":53900},{"height":"30","priceSen":53900},{"height":"32","priceSen":73900},{"height":"35","priceSen":73900}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-187', '5536-2NA', 'SOFA 5536 2NA', 'SOFA'::mfg_product_category, 'sofa 5536 module 2NA', '5536', '2NA', '2NA', 400, 1350, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":103400},{"height":"28","priceSen":107800},{"height":"30","priceSen":107800},{"height":"32","priceSen":127800},{"height":"35","priceSen":127800}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-188', '5536-1A(LHF)', 'SOFA 5536 1A(LHF)', 'SOFA'::mfg_product_category, 'sofa 5536 module 1A(LHF)', '5536', '1A(LHF)', '1A(LHF)', 400, 990, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":60500},{"height":"28","priceSen":62700},{"height":"30","priceSen":62700},{"height":"32","priceSen":82700},{"height":"35","priceSen":82700}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-189', '5536-1A(RHF)', 'SOFA 5536 1A(RHF)', 'SOFA'::mfg_product_category, 'sofa 5536 module 1A(RHF)', '5536', '1A(RHF)', '1A(RHF)', 400, 990, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":60500},{"height":"28","priceSen":62700},{"height":"30","priceSen":62700},{"height":"32","priceSen":82700},{"height":"35","priceSen":82700}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-190', '5536-2A(LHF)', 'SOFA 5536 2A(LHF)', 'SOFA'::mfg_product_category, 'sofa 5536 module 2A(LHF)', '5536', '2A(LHF)', '2A(LHF)', 400, 1660, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":108900},{"height":"28","priceSen":114400},{"height":"30","priceSen":114400},{"height":"32","priceSen":134400},{"height":"35","priceSen":134400}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-191', '5536-2A(RHF)', 'SOFA 5536 2A(RHF)', 'SOFA'::mfg_product_category, 'sofa 5536 module 2A(RHF)', '5536', '2A(RHF)', '2A(RHF)', 400, 1660, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":108900},{"height":"28","priceSen":114400},{"height":"30","priceSen":114400},{"height":"32","priceSen":134400},{"height":"35","priceSen":134400}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-192', '5536-L(LHF)', 'SOFA 5536 L(LHF)', 'SOFA'::mfg_product_category, 'sofa 5536 module L(LHF)', '5536', 'L(LHF)', 'L(LHF)', 400, 1940, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":115500},{"height":"28","priceSen":121000},{"height":"30","priceSen":121000},{"height":"32","priceSen":141000},{"height":"35","priceSen":141000}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-193', '5536-L(RHF)', 'SOFA 5536 L(RHF)', 'SOFA'::mfg_product_category, 'sofa 5536 module L(RHF)', '5536', 'L(RHF)', 'L(RHF)', 400, 1940, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":115500},{"height":"28","priceSen":121000},{"height":"30","priceSen":121000},{"height":"32","priceSen":141000},{"height":"35","priceSen":141000}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-194', '5536-CNR', 'SOFA 5536 CNR', 'SOFA'::mfg_product_category, 'sofa 5536 module CNR', '5536', 'CNR', 'CNR', 400, 2080, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":89100},{"height":"28","priceSen":89100},{"height":"30","priceSen":89100},{"height":"32","priceSen":109100},{"height":"35","priceSen":109100}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-195', '5536-CSL', 'SOFA 5536 CSL', 'SOFA'::mfg_product_category, 'sofa 5536 module CSL', '5536', 'CSL', 'CSL', 400, 340, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":32000},{"height":"28","priceSen":32000},{"height":"30","priceSen":32000},{"height":"32","priceSen":32000},{"height":"35","priceSen":32000}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-196', '5536-3S', 'SOFA 5536 3S', 'SOFA'::mfg_product_category, 'sofa 5536 module 3S', '5536', '3S', '3S', 400, 2600, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":169400},{"height":"28","priceSen":169400},{"height":"30","priceSen":169400},{"height":"32","priceSen":189400},{"height":"35","priceSen":189400}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-197', '5536-2S', 'SOFA 5536 2S', 'SOFA'::mfg_product_category, 'sofa 5536 module 2S', '5536', '2S', '2S', 400, 1960, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":129500},{"height":"28","priceSen":129500},{"height":"30","priceSen":129500},{"height":"32","priceSen":149500},{"height":"35","priceSen":149500}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-198', '5536-1S', 'SOFA 5536 1S', 'SOFA'::mfg_product_category, 'sofa 5536 module 1S', '5536', '1S', '1S', 400, 970, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":90800},{"height":"28","priceSen":90800},{"height":"30","priceSen":90800},{"height":"32","priceSen":110800},{"height":"35","priceSen":110800}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-199', '5537-1NA', 'SOFA 5537 1NA', 'SOFA'::mfg_product_category, 'sofa 5537 module 1NA', '5537', '1NA', '1NA', 400, 690, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":59400},{"height":"28","priceSen":59400},{"height":"30","priceSen":59400},{"height":"32","priceSen":80300},{"height":"35","priceSen":80300}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-200', '5537-2NA', 'SOFA 5537 2NA', 'SOFA'::mfg_product_category, 'sofa 5537 module 2NA', '5537', '2NA', '2NA', 400, 1350, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":118800},{"height":"28","priceSen":118800},{"height":"30","priceSen":118800},{"height":"32","priceSen":160600},{"height":"35","priceSen":160600}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-201', '5537-1A(LHF)', 'SOFA 5537 1A(LHF)', 'SOFA'::mfg_product_category, 'sofa 5537 module 1A(LHF)', '5537', '1A(LHF)', '1A(LHF)', 400, 990, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":75600},{"height":"28","priceSen":77800},{"height":"30","priceSen":77800},{"height":"32","priceSen":106400},{"height":"35","priceSen":106400}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-202', '5537-1A(RHF)', 'SOFA 5537 1A(RHF)', 'SOFA'::mfg_product_category, 'sofa 5537 module 1A(RHF)', '5537', '1A(RHF)', '1A(RHF)', 400, 990, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":75600},{"height":"28","priceSen":77800},{"height":"30","priceSen":77800},{"height":"32","priceSen":106400},{"height":"35","priceSen":106400}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-203', '5537-2A(LHF)', 'SOFA 5537 2A(LHF)', 'SOFA'::mfg_product_category, 'sofa 5537 module 2A(LHF)', '5537', '2A(LHF)', '2A(LHF)', 400, 1660, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":112100},{"height":"28","priceSen":117600},{"height":"30","priceSen":117600},{"height":"32","priceSen":158600},{"height":"35","priceSen":158600}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-204', '5537-2A(RHF)', 'SOFA 5537 2A(RHF)', 'SOFA'::mfg_product_category, 'sofa 5537 module 2A(RHF)', '5537', '2A(RHF)', '2A(RHF)', 400, 1660, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":112100},{"height":"28","priceSen":117600},{"height":"30","priceSen":117600},{"height":"32","priceSen":158600},{"height":"35","priceSen":158600}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-205', '5537-L(LHF)', 'SOFA 5537 L(LHF)', 'SOFA'::mfg_product_category, 'sofa 5537 module L(LHF)', '5537', 'L(LHF)', 'L(LHF)', 400, 1940, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":104500},{"height":"28","priceSen":110000},{"height":"30","priceSen":110000},{"height":"32","priceSen":116600},{"height":"35","priceSen":116600}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-206', '5537-L(RHF)', 'SOFA 5537 L(RHF)', 'SOFA'::mfg_product_category, 'sofa 5537 module L(RHF)', '5537', 'L(RHF)', 'L(RHF)', 400, 1940, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":104500},{"height":"28","priceSen":110000},{"height":"30","priceSen":110000},{"height":"32","priceSen":116600},{"height":"35","priceSen":116600}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-207', '5537-STOOL', 'SOFA 5537 STOOL', 'SOFA'::mfg_product_category, 'sofa 5537 module STOOL', '5537', 'STOOL', 'STOOL', 400, 690, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":50000},{"height":"28","priceSen":50000},{"height":"30","priceSen":50000},{"height":"32","priceSen":50000},{"height":"35","priceSen":50000}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-208', '5537-CNR', 'SOFA 5537 CNR', 'SOFA'::mfg_product_category, 'sofa 5537 module CNR', '5537', 'CNR', 'CNR', 400, 2080, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":108900},{"height":"28","priceSen":108900},{"height":"30","priceSen":108900},{"height":"32","priceSen":108900},{"height":"35","priceSen":108900}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-209', '5537-3S', 'SOFA 5537 3S', 'SOFA'::mfg_product_category, 'sofa 5537 module 3S', '5537', '3S', '3S', 400, 2600, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":175200},{"height":"28","priceSen":175200},{"height":"30","priceSen":175200},{"height":"32","priceSen":172800},{"height":"35","priceSen":172800}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-210', '5537-2S', 'SOFA 5537 2S', 'SOFA'::mfg_product_category, 'sofa 5537 module 2S', '5537', '2S', '2S', 400, 1960, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":131500},{"height":"28","priceSen":131500},{"height":"30","priceSen":131500},{"height":"32","priceSen":172500},{"height":"35","priceSen":172500}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO mfg_products (id, code, name, category, description, base_model, size_code, size_label, fabric_usage_centi, unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, production_time_minutes, sub_assemblies, sku_code, fabric_color, pieces, seat_height_prices) VALUES ('prod-211', '5537-1S', 'SOFA 5537 1S', 'SOFA'::mfg_product_category, 'sofa 5537 module 1S', '5537', '1S', '1S', 400, 970, 'ACTIVE'::mfg_product_status, 0, NULL, NULL, 80, '[]'::jsonb, NULL, NULL, NULL, '[{"height":"24","priceSen":91600},{"height":"28","priceSen":91600},{"height":"30","priceSen":91600},{"height":"32","priceSen":120200},{"height":"35","priceSen":120200}]'::jsonb) ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now();
INSERT INTO product_dept_configs (product_code, unit_m3_milli, fabric_usage_centi, price2_sen, fab_cut_category, fab_cut_minutes, fab_sew_category, fab_sew_minutes, wood_cut_category, wood_cut_minutes, foam_category, foam_minutes, framing_category, framing_minutes, upholstery_category, upholstery_minutes, packing_category, packing_minutes, sub_assemblies, heights_sub_assemblies) VALUES ('1009(A)', 850, 1200, 195000, 'CAT 3', 35, 'CAT 2', 120, NULL, NULL, 'CAT 2', 20, 'CAT 3', 35, 'CAT 3', 35, 'CAT 2', 15, '[{"code":"DV-STD-K","name":"Divan Heights6FT","quantity":2}]'::jsonb, '[{"code":"1009(A)-H","name":"1009(A) heights","quantity":1}]'::jsonb) ON CONFLICT (product_code) DO NOTHING;
INSERT INTO product_dept_configs (product_code, unit_m3_milli, fabric_usage_centi, price2_sen, fab_cut_category, fab_cut_minutes, fab_sew_category, fab_sew_minutes, wood_cut_category, wood_cut_minutes, foam_category, foam_minutes, framing_category, framing_minutes, upholstery_category, upholstery_minutes, packing_category, packing_minutes, sub_assemblies, heights_sub_assemblies) VALUES ('1003(A)', 953, 400, 230000, 'CAT 4', 40, 'CAT 2', 150, NULL, NULL, 'CAT 3', 25, 'CAT 4', 40, 'CAT 4', 40, 'CAT 2', 15, '[{"code":"DV-STD-K","name":"Divan Heights6FT","quantity":2}]'::jsonb, '[{"code":"1003(A)-H","name":"1003(A) heights","quantity":1}]'::jsonb) ON CONFLICT (product_code) DO NOTHING;
INSERT INTO product_dept_configs (product_code, unit_m3_milli, fabric_usage_centi, price2_sen, fab_cut_category, fab_cut_minutes, fab_sew_category, fab_sew_minutes, wood_cut_category, wood_cut_minutes, foam_category, foam_minutes, framing_category, framing_minutes, upholstery_category, upholstery_minutes, packing_category, packing_minutes, sub_assemblies, heights_sub_assemblies) VALUES ('1013', 800, 1100, 205000, 'CAT 3', 30, 'CAT 2', 110, NULL, NULL, 'CAT 2', 20, 'CAT 3', 35, 'CAT 3', 30, 'CAT 2', 15, '[{"code":"DV-STD-K","name":"Divan Heights6FT","quantity":2}]'::jsonb, '[{"code":"1013-H","name":"1013 heights","quantity":1}]'::jsonb) ON CONFLICT (product_code) DO NOTHING;
INSERT INTO product_dept_configs (product_code, unit_m3_milli, fabric_usage_centi, price2_sen, fab_cut_category, fab_cut_minutes, fab_sew_category, fab_sew_minutes, wood_cut_category, wood_cut_minutes, foam_category, foam_minutes, framing_category, framing_minutes, upholstery_category, upholstery_minutes, packing_category, packing_minutes, sub_assemblies, heights_sub_assemblies) VALUES ('2038(A)', 1050, 1600, 340000, 'CAT 5', 50, 'CAT 3', 180, NULL, NULL, 'CAT 3', 30, 'CAT 5', 50, 'CAT 5', 55, 'CAT 3', 20, '[{"code":"DV-STD-K","name":"Divan Heights6FT","quantity":2}]'::jsonb, '[{"code":"2038(A)-H","name":"2038(A) heights","quantity":1}]'::jsonb) ON CONFLICT (product_code) DO NOTHING;
INSERT INTO product_dept_configs (product_code, unit_m3_milli, fabric_usage_centi, price2_sen, fab_cut_category, fab_cut_minutes, fab_sew_category, fab_sew_minutes, wood_cut_category, wood_cut_minutes, foam_category, foam_minutes, framing_category, framing_minutes, upholstery_category, upholstery_minutes, packing_category, packing_minutes, sub_assemblies, heights_sub_assemblies) VALUES ('5535-2A', 1800, 2200, 330000, 'CAT 4', 55, 'CAT 3', 160, NULL, NULL, 'CAT 3', 35, 'CAT 4', 45, 'CAT 5', 60, 'CAT 3', 25, '[{"code":"5535-ARM-L","name":"Left Arm Module","quantity":1},{"code":"5535-ARM-R","name":"Right Arm Module","quantity":1}]'::jsonb, '[]'::jsonb) ON CONFLICT (product_code) DO NOTHING;
INSERT INTO product_dept_configs (product_code, unit_m3_milli, fabric_usage_centi, price2_sen, fab_cut_category, fab_cut_minutes, fab_sew_category, fab_sew_minutes, wood_cut_category, wood_cut_minutes, foam_category, foam_minutes, framing_category, framing_minutes, upholstery_category, upholstery_minutes, packing_category, packing_minutes, sub_assemblies, heights_sub_assemblies) VALUES ('5535-1NA', 1400, 1600, 260000, 'CAT 3', 45, 'CAT 2', 130, NULL, NULL, 'CAT 2', 28, 'CAT 3', 38, 'CAT 4', 50, 'CAT 2', 20, '[{"code":"5535-ARM-L","name":"Left Arm Module","quantity":1},{"code":"5535-ARM-R","name":"Right Arm Module","quantity":1}]'::jsonb, '[]'::jsonb) ON CONFLICT (product_code) DO NOTHING;
INSERT INTO product_dept_configs (product_code, unit_m3_milli, fabric_usage_centi, price2_sen, fab_cut_category, fab_cut_minutes, fab_sew_category, fab_sew_minutes, wood_cut_category, wood_cut_minutes, foam_category, foam_minutes, framing_category, framing_minutes, upholstery_category, upholstery_minutes, packing_category, packing_minutes, sub_assemblies, heights_sub_assemblies) VALUES ('5535-CNR', 1200, 1400, 195000, 'CAT 3', 40, 'CAT 2', 110, NULL, NULL, 'CAT 2', 22, 'CAT 3', 32, 'CAT 3', 42, 'CAT 2', 18, '[]'::jsonb, '[]'::jsonb) ON CONFLICT (product_code) DO NOTHING;
INSERT INTO product_dept_configs (product_code, unit_m3_milli, fabric_usage_centi, price2_sen, fab_cut_category, fab_cut_minutes, fab_sew_category, fab_sew_minutes, wood_cut_category, wood_cut_minutes, foam_category, foam_minutes, framing_category, framing_minutes, upholstery_category, upholstery_minutes, packing_category, packing_minutes, sub_assemblies, heights_sub_assemblies) VALUES ('DV-STD', 450, 600, 60000, 'CAT 1', 15, 'CAT 1', 20, NULL, NULL, 'CAT 1', 12, 'CAT 2', 25, 'CAT 2', 30, 'CAT 1', 12, '[]'::jsonb, '[]'::jsonb) ON CONFLICT (product_code) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-1', 'AVANI 01', 'AVANI 01', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-2', 'AVANI 02', 'AVANI 02', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-3', 'AVANI 03', 'AVANI 03', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-4', 'AVANI 04', 'AVANI 04', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-5', 'AVANI 05', 'AVANI 05', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-6', 'AVANI 06', 'AVANI 06', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-7', 'AVANI 07', 'AVANI 07', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-8', 'AVANI 08', 'AVANI 08', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-9', 'AVANI 09', 'AVANI 09', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-10', 'AVANI 10', 'AVANI 10', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-11', 'AVANI 11', 'AVANI 11', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-12', 'AVANI 12', 'AVANI 12', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-13', 'AVANI 13', 'AVANI 13', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-14', 'AVANI 14', 'AVANI 14', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-15', 'AVANI 15', 'AVANI 15', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-16', 'AVANI 16', 'AVANI 16', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-17', 'AVANI 17', 'AVANI 17', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-18', 'AVANI 18', 'AVANI 18', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-19', 'BN125-4', 'BN125-4', 'SM_FABRIC', 3000, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-20', 'BO315-1', 'BO315-1', 'SM_FABRIC', 3000, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-21', 'BO315-2', 'BO315-2', 'SM_FABRIC', 3000, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-22', 'BO315-3', 'BO315-3', 'S_FABRIC', 3000, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-23', 'BO315-4', 'BO315-4', 'S_FABRIC', 3000, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-24', 'CH141-1', 'CH141-1', 'SM_FABRIC', 3200, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-25', 'CH141-2', 'CH141-2', 'SM_FABRIC', 3200, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-26', 'CH141-3', 'CH141-3', 'SM_FABRIC', 3200, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-27', 'CH141-4', 'CH141-4', 'SM_FABRIC', 3200, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-28', 'CH141-5', 'CH141-5', 'SM_FABRIC', 3200, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-29', 'FG66151-01', 'FG66151-01', 'BM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-30', 'FG66151-02', 'FG66151-02', 'BM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-31', 'FG66151-03', 'FG66151-03', 'BM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-32', 'FG66151-04', 'FG66151-04', 'BM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-33', 'FG66151-05', 'FG66151-05', 'BM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-34', 'FG6876-01', 'FG6876-01', 'BM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-35', 'KN390-1', 'KN390-1 KOONA VELVET', 'SM_FABRIC', 3200, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-36', 'KN390-2', 'KN390-2 KOONA VELVET', 'SM_FABRIC', 3200, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-37', 'KN390-3', 'KN390-3 KOONA VELVET', 'SM_FABRIC', 3200, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-38', 'KN390-4', 'KN390-4 KOONA VELVET', 'SM_FABRIC', 3200, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-39', 'KN390-5', 'KN390-5 KOONA VELVET', 'SM_FABRIC', 3200, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-40', 'KN390-6', 'KN390-6 KOONA VELVET', 'SM_FABRIC', 3200, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-41', 'KS-01', 'KS-01', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-42', 'KS-02', 'KS-02', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-43', 'KS-03', 'KS-03', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-44', 'KS-04', 'KS-04', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-45', 'KS-05', 'KS-05', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-46', 'KS-06', 'KS-06', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-47', 'KS-07', 'KS-07', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-48', 'KS-08', 'KS-08', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-49', 'KS-09', 'KS-09', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-50', 'KS-10', 'KS-10', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-51', 'KS-11', 'KS-11', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-52', 'KS-12', 'KS-12', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-53', 'KS-13', 'KS-13', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-54', 'KS-14', 'KS-14', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-55', 'KS-15', 'KS-15', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-56', 'KS-16', 'KS-16', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-57', 'KS-17', 'KS-17', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-58', 'KS-18', 'KS-18', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-59', 'KS-19', 'KS-19', 'BM_FABRIC', 2600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-60', 'M2402-01', 'M2402-01', 'SM_FABRIC', 3000, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-61', 'M2402-02', 'M2402-02', 'SM_FABRIC', 3000, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-62', 'M2402-03', 'M2402-03', 'SM_FABRIC', 3000, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-63', 'M2402-04', 'M2402-04', 'SM_FABRIC', 3000, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-64', 'M2402-05', 'M2402-05', 'SM_FABRIC', 3000, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-65', 'NINJA 01', 'NINJA 01', 'SM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-66', 'NINJA 02', 'NINJA 02', 'SM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-67', 'NINJA 03', 'NINJA 03', 'SM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-68', 'NINJA 04', 'NINJA 04', 'SM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-69', 'NINJA 05', 'NINJA 05', 'SM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-70', 'NINJA 06', 'NINJA 06', 'SM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-71', 'NINJA 07', 'NINJA 07', 'SM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-72', 'NINJA 08', 'NINJA 08', 'SM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-73', 'PC151-01', 'PC151-01', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-74', 'PC151-02', 'PC151-02', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-75', 'PC151-03', 'PC151-03', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-76', 'PC151-04', 'PC151-04', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-77', 'PC151-05', 'PC151-05', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-78', 'PC151-06', 'PC151-06', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-79', 'PC151-07', 'PC151-07', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-80', 'PC151-08', 'PC151-08', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-81', 'PC151-09', 'PC151-09', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-82', 'PC151-10', 'PC151-10', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-83', 'PC151-11', 'PC151-11', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-84', 'PC151-12', 'PC151-12', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-85', 'PC151-13', 'PC151-13', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-86', 'PC151-14', 'PC151-14', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-87', 'PC151-15', 'PC151-15', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-88', 'PC151-16', 'PC151-16', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-89', 'PC151-17', 'PC151-17', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-90', 'PC151-18', 'PC151-18', 'BM_FABRIC', 2500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-91', 'SOFA 5535', 'SOFA 5535', 'BM_FABRIC', 2800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-92', 'LC5', 'LC5', 'S_FABRIC', 1500, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-93', 'NW', 'NW Non-Woven', 'S_FABRIC', 800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-94', 'POLY', 'POLY Polyester', 'S_FABRIC', 1200, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-95', 'FELT', 'FELT', 'S_FABRIC', 1000, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-96', 'CANVAS', 'CANVAS', 'S_FABRIC', 1800, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-97', 'LINING', 'LINING', 'S_FABRIC', 600, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-98', 'PIPING', 'PIPING', 'S_FABRIC', 900, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabrics (id, code, name, category, price_sen, soh_meters_centi, reorder_level_centi) VALUES ('fab-99', 'VELCRO', 'VELCRO', 'S_FABRIC', 700, 0, 10000) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-01', 'AVANI 01', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-02', 'AVANI 02', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-03', 'AVANI 03', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-04', 'AVANI 04', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-05', 'AVANI 05', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-06', 'AVANI 06', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-07', 'AVANI 07', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-08', 'AVANI 08', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-09', 'AVANI 09', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-10', 'AVANI 10', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-11', 'AVANI 11', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-12', 'AVANI 12', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-13', 'AVANI 13', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-14', 'AVANI 14', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-15', 'AVANI 15', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-16', 'AVANI 16', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-17', 'AVANI 17', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-18', 'AVANI 18', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-19', 'BN125-4', 'FOSSIL', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-20', 'BO315-22', 'FEATHER', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-21', 'BO315-1', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-22', 'BO315-21', 'PEARL', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-23', 'BO315-23', 'BEIGE', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-24', 'BO315-25', 'FOSSIL', 'S-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-25', 'BO315-3', 'BEIGE', 'S-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-26', 'BO315-32', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-27', 'BO315-4', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-28', 'BO315-11', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-29', 'BO315-2', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-30', 'BO315-12', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-31', 'BO315-24', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-32', 'BO315-5', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-33', 'ORION-1', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-34', 'CH141-1', 'CREAM', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-35', 'CH141-11', 'SILVER', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-36', 'CH141-3', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-37', 'CH141-8', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-38', 'CH141-14', 'CHARCOAL', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-39', 'GARFIELD-2 CHERVRON', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-40', 'CH141-5', 'PEARL', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-41', 'CASSNYE 07', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-42', 'CH141-2', 'BEIGE', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-43', 'HR923-1', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-44', 'GD8371-02', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-45', 'AH-1', 'IVORY', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-46', 'BO315-31', 'METAL', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-47', 'BO315-7', 'PEACH', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-48', 'FG66151-02', 'PICCO FG66151-02 (FABRIC)', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-49', 'FG66151-10', 'PICCO FG66151-10 (FABRIC)', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-50', 'FG66151-15', 'PICCO FG66151-15 (FABRIC)', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-51', 'FG6876-01', 'FG6876-01 (FABRIC)', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-52', 'KN390-1', 'SOFA FABRIC KOONA VELVET PEARL', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 1000, 1000, 1000, -1000, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-53', 'KN390-13', 'SOFA FABRIC KOONA VELVET SILVER', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-54', 'KN390-14', 'SOFA FABRIC KOONA METAL', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-55', 'KN390-15', 'SOFA FABRIC KOONA DEEP GREY', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-56', 'KN390-2', 'SOFA FABRIC KOONA VELVET SAND', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 200, 200, 900, -900, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-57', 'KN390-3', 'SOFA FABRIC KOONA VELVET FOSSIL', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-58', 'KN390-5', 'SOFA FABRIC KOONA VELVET TAN', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-59', 'AM275-1', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-60', 'AM275-2', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-61', 'ZL-3', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-62', 'KS-01 BABY WHITE', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-63', 'KS-02 BUTTER CREAM', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-64', 'KS-03 YELLOW PEPPER', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-65', 'KS-04 LEATHER TAN', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-66', 'KS-05 MID COFFEE', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-67', 'KS-06 TUMERIC BROWN', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-68', 'KS-07 WONDER GRAY', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-69', 'KS-08 SEA PINK', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-70', 'KS-09 ROMANCE ROSE', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-71', 'KS-10 SOFT LAVENDAR', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-72', 'KS-11 MAXI PURPLE', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-73', 'KS-12 CLASSIC DENIM', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-74', 'KS-13 TENDER TURQOISE', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-75', 'KS-14 RICH JADE', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-76', 'KS-15 COOL SILVER', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 400, 0, 0, 0, -400, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-77', 'KS-16 ICE STEEL', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-78', 'KS-17 ROCK GRANITE', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-79', 'KS-18 GRAPHITE STONE', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-80', 'KS-19 MORNING DAWN', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-81', 'M2402-1', 'PEARL', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-82', 'M2402-13', 'FOREST', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-83', 'M2402-17', 'SILVER', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-84', 'M2402-18', 'LIGHT GREY', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-85', 'M2402-4', 'SAND', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-86', 'M2402-5', 'LIGHT BROWN', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-87', 'M2402-6', 'FOSSIL', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-88', 'M2402-7', 'DARK BROWN', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-89', 'NINJA 01', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-90', 'NINJA 02', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-91', 'NINJA 03', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-92', 'NINJA 08', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-93', 'NV-1WP', 'BEIGE', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-94', 'ORION-5', 'ORION-5', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-95', 'PC151-01', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 1000, 22600, 600, 4450, 5700, -27600, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-96', 'PC151-02', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 5450, 1000, 1400, 1400, -6850, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-97', 'PC151-03', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 400, 0, 0, 0, -400, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-98', 'PC151-04', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-99', 'PC151-05', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-100', 'PC151-06', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-101', 'PC151-07', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-102', 'PC151-08', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 400, 0, 0, 0, -400, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-103', 'PC151-09', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 500, 0, 0, 0, -500, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-104', 'PC151-10', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 1000, 0, 0, 0, -1000, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-105', 'PC151-11', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 200, 0, 200, 200, -400, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-106', 'PC151-12', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 200, 200, -200, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-107', 'PC151-13', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 800, 0, 0, 0, -800, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-108', 'PC151-14', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 1600, 0, 0, 0, -1600, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-109', 'PC151-15', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 600, 0, 0, 0, -600, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-110', 'PC151-16', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-111', 'PC151-17', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 800, 0, 0, 1200, -2600, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-112', 'PC151-18', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 1800, 0, 0, 0, -2400, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-113', 'HR805-10', 'FABRIC', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-114', 'PESTO-PT004', 'PESTO - OLIVE PT004-3', 'S.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-115', 'STAR 01', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_1'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-116', 'STAR 02', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_1'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-117', 'STAR 05', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_1'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-118', 'STAR 07', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_1'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-119', 'STAR 08', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_1'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-120', 'STAR 11', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_1'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-121', 'STAR 12', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_1'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fabric_trackings (id, fabric_code, fabric_description, fabric_category, price_tier, price_centi, soh_centi, po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, two_weeks_usage_centi, one_month_usage_centi, shortage_centi, reorder_point_centi, supplier, lead_time_days) VALUES ('ft-122', 'SF-AT-15', 'FABRIC', 'B.M-FABR'::fabric_category, 'PRICE_1'::fabric_price_tier, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0) ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ── Summary ─────────────────────────────────────────────────────────
-- products → mfg_products: 211 rows
-- product_dept_configs → product_dept_configs: 8 rows
-- fabrics → fabrics: 99 rows
-- fabric_trackings → fabric_trackings: 122 rows
-- TOTAL: 440 INSERT statements
— Import summary —
  products                 → mfg_products             211 rows
  product_dept_configs     → product_dept_configs     8 rows
  fabrics                  → fabrics                  99 rows
  fabric_trackings         → fabric_trackings         122 rows
