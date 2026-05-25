-- packages/db/seeds/bedframe-options.sql
-- Decision B: one-time SNAPSHOT of the current maintenance_config values into the
-- POS-owned bedframe_options table, then decoupled. Values only — ALL surcharge 0
-- (POS pricing is SKU-Master-owned; the maintenance sen prices are intentionally
-- NOT carried over). Loo sets any future surcharges here, in Backend. Idempotent.
-- Snapshot taken 2026-05-25 from maintenance_config_history (scope='master').
INSERT INTO bedframe_options (id, kind, value, surcharge, active, sort_order) VALUES
  -- mattress gap
  ('gap-4','gap','4"',0,true,1),('gap-5','gap','5"',0,true,2),('gap-6','gap','6"',0,true,3),
  ('gap-7','gap','7"',0,true,4),('gap-8','gap','8"',0,true,5),('gap-9','gap','9"',0,true,6),
  ('gap-10','gap','10"',0,true,7),('gap-14','gap','14"',0,true,8),('gap-16','gap','16"',0,true,9),
  -- leg height
  ('leg-noleg','leg_height','No Leg',0,true,1),('leg-1','leg_height','1"',0,true,2),
  ('leg-2','leg_height','2"',0,true,3),('leg-4','leg_height','4"',0,true,4),
  ('leg-6','leg_height','6"',0,true,5),('leg-7','leg_height','7"',0,true,6),
  -- divan height
  ('divan-4','divan_height','4"',0,true,1),('divan-5','divan_height','5"',0,true,2),
  ('divan-6','divan_height','6"',0,true,3),('divan-8','divan_height','8"',0,true,4),
  ('divan-10','divan_height','10"',0,true,5),('divan-11','divan_height','11"',0,true,6),
  ('divan-12','divan_height','12"',0,true,7),('divan-13','divan_height','13"',0,true,8),
  ('divan-14','divan_height','14"',0,true,9),('divan-16','divan_height','16"',0,true,10),
  -- total height
  ('total-10','total_height','10"',0,true,1),('total-12','total_height','12"',0,true,2),
  ('total-14','total_height','14"',0,true,3),('total-16','total_height','16"',0,true,4),
  ('total-18','total_height','18"',0,true,5),('total-20','total_height','20"',0,true,6),
  ('total-22','total_height','22"',0,true,7),('total-24','total_height','24"',0,true,8),
  ('total-26','total_height','26"',0,true,9),('total-28','total_height','28"',0,true,10),
  -- specials
  ('special-hb-fully-cover','special','HB Fully Cover',0,true,1),
  ('special-divan-top-fully-cover','special','Divan Top Fully Cover',0,true,2),
  ('special-divan-full-cover','special','Divan Full Cover',0,true,3),
  ('special-left-drawer','special','Left Drawer',0,true,4),
  ('special-right-drawer','special','Right Drawer',0,true,5),
  ('special-front-drawer','special','Front Drawer',0,true,6),
  ('special-hb-straight','special','HB Straight',0,true,7),
  ('special-divan-top-w','special','Divan Top(W)',0,true,8),
  ('special-1-piece-divan','special','1 Piece Divan',0,true,9),
  ('special-divan-curve','special','Divan Curve',0,true,10),
  ('special-no-side-panel','special','No Side Panel',0,true,11),
  ('special-headboard-only','special','Headboard Only',0,true,12),
  ('special-nylon-fabric','special','Nylon Fabric',0,true,13),
  ('special-5537-backrest','special','5537 Backrest',0,true,14),
  ('special-add-1-infront-l','special','Add 1" Infront L',0,true,15),
  ('special-separate-backrest-packing','special','Separate Backrest Packing',0,true,16),
  ('special-divan-a11','special','Divan A11',0,true,17),
  ('special-seat-add-on-4','special','Seat Add On 4"',0,true,18)
ON CONFLICT (id) DO UPDATE SET
  kind=EXCLUDED.kind, value=EXCLUDED.value, surcharge=EXCLUDED.surcharge,
  active=EXCLUDED.active, sort_order=EXCLUDED.sort_order;
