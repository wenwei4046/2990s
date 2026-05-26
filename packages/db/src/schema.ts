// 2990's Portal · Database schema (Drizzle)
// ----------------------------------------------------------------------------
// Source of truth for the DB. Run `drizzle-kit generate` to produce migrations.
// Mirrors the design in 2990S-PORTAL-PLAN.md §5.
//
// Conventions:
//  - All money is INTEGER, in whole MYR (e.g. 2990 = RM 2,990).
//    No sen-level pricing in 2990's business model.
//  - Library tables (compartment_library, bundle_library, size_library,
//    categories, series) are seeded once and edited rarely.
//  - Per-product pricing lives in 3 normalised tables, keyed by composite PK.
//  - Order ID is human-readable TEXT ('SO-2045') from a Postgres sequence.
// ----------------------------------------------------------------------------

import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, date, jsonb,
  primaryKey, index, check, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ─────────────────────────── Enums ──────────────────────────────────── */

export const staffRole = pgEnum('staff_role', [
  'sales',          // POS users — PIN login on shared device
  'showroom_lead',  // Senior sales, can override staff
  'coordinator',    // Backend portal — order coordinator (Mei Lin)
  'finance',        // Slip reconciliation, payment approval
  'admin',          // Owner — full SKU + pricing edit
]);

export const compGroup = pgEnum('comp_group', [
  '1-seater', '2-seater', 'Corner', 'L-Shape', 'Accessory',
]);

export const pricingKind = pgEnum('pricing_kind', [
  'size_variants',   // mattress — priced by size
  'sofa_build',      // sofa — priced by compartments + bundles + recliner
  'bedframe_build',  // bedframe — size variant + colour + options (gap/leg/divan/total/specials)
  'flat',            // single fixed price
  'tbc',             // not yet priced (TBC categories)
]);

export const orderLane = pgEnum('order_lane', [
  'received',     // 01 — placed at showroom, awaiting triage
  'proceed',      // 02 — sales pressed Proceed, ready for ops pickup
  'logistics',    // 03 — stock check / re-ordering
  'ready',        // 04 — stock secured, awaiting dispatch slot
  'dispatched',   // 05 — driver assigned, time confirmed
  'delivered',    // 06 — DO signed
]);

export const slipState = pgEnum('slip_state', [
  'none',       // No slip uploaded (e.g. card payment, no transfer)
  'pending',    // Awaiting coordinator check
  'verified',   // Coordinator verified — awaiting Finance reconciliation
  'flagged',    // Coordinator flagged — needs investigation
]);

export const paymentMethod = pgEnum('payment_method', [
  // credit/debit retained for legacy rows only (migrated to 'merchant' by 0037);
  // POS no longer offers them. 'merchant' = card via GHL/HLB/MBB/PBB terminal.
  'credit', 'debit', 'installment', 'transfer', 'merchant', 'cash',
]);

export const addonKind = pgEnum('addon_kind', [
  'qty',           // simple per-piece (RM × qty)
  'floors_items',  // RM × floors × items (lift access)
  'flat',          // one-shot RM
]);

export const orderItemKind = pgEnum('order_item_kind', [
  'product', 'addon',
]);

// Lifecycle for an upload row in `pending_slip_uploads`. Cron reaper cleans
// 'pending' / 'uploaded' rows past expires_at; 'promoted' rows are safe.
export const slipUploadStatus = pgEnum('slip_upload_status', [
  'pending',    // presigned PUT issued; client has not confirmed upload
  'uploaded',   // client confirmed; awaiting POST /orders to promote
  'promoted',   // POST /orders succeeded; row is safe to delete after grace window
  'failed',     // client abandoned or hash mismatch; reaper deletes R2 object too
]);

// Records every monetary movement against an order. orders.paid is the
// denormalised running total; payments is the audit trail (deposit/balance/topup/refund).
export const paymentKind = pgEnum('payment_kind', [
  'deposit', 'balance', 'topup', 'refund', 'adjustment',
]);

/* ─────────────────────────── App config (key/value) ────────────────── */
// Single-row-per-key runtime config that Postgres triggers and CF Workers
// can read directly. Replaces fragile env-var lookups for things like
// OWNER_EMAIL (Postgres triggers cannot read CF/Vite env). Seeded by the
// Phase 0 bootstrap migration; admin can ALTER without redeploy.

export const appConfig = pgTable('app_config', {
  key:         text('key').primaryKey(),    // 'owner_email','pricing_version',...
  value:       text('value').notNull(),
  description: text('description'),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:   uuid('updated_by'),          // references staff.id once staff exists
});

/* ─────────────────────────── Delivery fee config ───────────────────── */
// Singleton (id = 1) holding the two delivery-fee defaults. UPDATEs bump
// app_config.pricing_version via trigger so saved quotes surface drift.
// RLS: read for any authenticated staff; UPDATE for admin/coordinator only.

export const deliveryFeeConfig = pgTable('delivery_fee_config', {
  id:                       integer('id').primaryKey().default(1),     // CHECK (id = 1) at DB
  baseFee:                  integer('base_fee').notNull().default(250),
  crossCategoryFee:         integer('cross_category_fee').notNull().default(175),
  mattressBedframeLeadDays: integer('mattress_bedframe_lead_days').notNull().default(20),
  sofaLeadDays:             integer('sofa_lead_days').notNull().default(30),
  updatedAt:                timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:                uuid('updated_by'),                        // references staff(id)
});

/* ─────────────────────────── Showrooms ──────────────────────────────── */
// Every order is placed AT a specific showroom. Staff have a primary
// affiliation. Coordinators with showroom_id = NULL oversee all showrooms.
// Adding this now (vs retrofitting) saves a painful migration later when
// 2990's opens a 2nd showroom.

export const showrooms = pgTable('showrooms', {
  id:           uuid('id').primaryKey().defaultRandom(),
  showroomCode: text('showroom_code').notNull().unique(),  // 'KL','PJ','PG'
  name:         text('name').notNull(),                    // 'Showroom KL'
  address:      text('address'),
  phone:        text('phone'),
  active:       boolean('active').notNull().default(true),
  sortOrder:    integer('sort_order').notNull().default(0),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ─────────────────────────── Auth / staff ───────────────────────────── */

export const staff = pgTable('staff', {
  id:          uuid('id').primaryKey().notNull(), // = auth.users.id (Supabase)
  staffCode:   text('staff_code').notNull().unique(), // 'AW','JM','ML',...
  name:        text('name').notNull(),
  role:        staffRole('role').notNull(),
  showroomId:  uuid('showroom_id').references(() => showrooms.id),  // NULL = oversees all
  pinHash:     text('pin_hash'),                  // bcrypt; only sales need this
  email:       text('email').unique(),
  phone:       text('phone'),
  initials:    text('initials').notNull(),
  color:       text('color').notNull(),           // hex (avatar tint)
  active:      boolean('active').notNull().default(true),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ─────────────────────────── Library tables ─────────────────────────── */

export const categories = pgTable('categories', {
  id:        text('id').primaryKey(),             // 'mattress','sofa',...
  label:     text('label').notNull(),
  icon:      text('icon').notNull(),              // lucide icon name
  tbc:       boolean('tbc').notNull().default(false),
  heroImageKey: text('hero_image_key'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const series = pgTable('series', {
  id:     text('id').primaryKey(),
  label:  text('label').notNull(),
  active: boolean('active').notNull().default(true),
});

export const compartmentLibrary = pgTable('compartment_library', {
  id:           text('id').primaryKey(),          // '1A-L','1A-R','1NA','2A-L',...
  compGroup:    compGroup('comp_group').notNull(),
  label:        text('label').notNull(),
  widthCm:      integer('width_cm').notNull(),
  depthCm:      integer('depth_cm').notNull(),
  cushions:     integer('cushions').notNull().default(1),
  defaultPrice: integer('default_price').notNull(),
  artFilename:  text('art_filename'),             // e.g. '1A-L.png' for POS configurator
  isAccessory:  boolean('is_accessory').notNull().default(false),
  sortOrder:    integer('sort_order').notNull().default(0),
});

export const bundleLibrary = pgTable('bundle_library', {
  id:           text('id').primaryKey(),          // '1S','2S','3S','2+L','3+L'
  label:        text('label').notNull(),
  sub:          text('sub').notNull(),
  signature:    text('signature').notNull(),      // 'family signature' for auto-detect e.g. '1A+2A'
  baseWidthCm:  integer('base_width_cm').notNull(),
  baseDepthCm:  integer('base_depth_cm').notNull(),
  cushions:     integer('cushions').notNull(),
  defaultPrice: integer('default_price').notNull(),
  artLeft:      text('art_left'),
  artRight:     text('art_right'),
  artBase:      text('art_base'),
  sortOrder:    integer('sort_order').notNull().default(0),
});

export const sizeLibrary = pgTable('size_library', {
  id:        text('id').primaryKey(),             // 'single','super-single','queen','king'
  label:     text('label').notNull(),
  widthCm:   integer('width_cm').notNull(),
  lengthCm:  integer('length_cm').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

/* ─────────────────────────── Products (SKU master) ──────────────────── */

export const products = pgTable('products', {
  id:           uuid('id').primaryKey().defaultRandom(),
  sku:          text('sku').notNull().unique(),       // 'MAT-001','SOF-101'
  categoryId:   text('category_id').notNull().references(() => categories.id),
  seriesId:     text('series_id').references(() => series.id),
  pricingKind:  pricingKind('pricing_kind').notNull().default('tbc'),

  name:        text('name').notNull(),
  // Friendly "real name" shown in catalogue/cart/configurator (e.g. 'Pllao').
  // The technical model code (e.g. 'SF 5130') lives in modelCode and surfaces
  // ONLY on the Sales Order as "<model_code> · <name>". NULL for non-sofas.
  modelCode:   text('model_code'),
  detail:      text('detail'),
  sizeDisplay: text('size_display'),                // free-text 'Queen, 152×190'
  imgKey:      text('img_key'),                     // R2 key for hero image
  thumbKey:    text('thumb_key'),

  stock:       integer('stock').notNull().default(0),
  lowAt:       integer('low_at').notNull().default(5),
  visible:     boolean('visible').notNull().default(true),

  // pricing_kind = 'flat'
  flatPrice:           integer('flat_price'),

  // pricing_kind = 'sofa_build'
  reclinerUpgradePrice: integer('recliner_upgrade_price'),  // 0 = disabled
  // F3 (migration 0039): one named per-seat upgrade per Model. NULL = none.
  seatUpgradeLabel:    text('seat_upgrade_label'),
  seatUpgradeFootrest: boolean('seat_upgrade_footrest').notNull().default(true),
  // F5 (migration 0040): per-Model seat depths — CSV of inches, e.g. '24,30'.
  // NULL = no depth choice. Display + plan-view only, never a pricing dimension.
  depthOptions:        text('depth_options'),

  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:  uuid('updated_by').references(() => staff.id),
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
}, (t) => ({
  visibleIdx:  index('idx_products_visible').on(t.visible).where(sql`${t.visible} = TRUE`),
  categoryIdx: index('idx_products_category').on(t.categoryId),
  pricingConsistency: check('pricing_consistency', sql`
    (${t.pricingKind} = 'flat'         AND ${t.flatPrice} IS NOT NULL) OR
    (${t.pricingKind} = 'sofa_build'   AND ${t.reclinerUpgradePrice} IS NOT NULL) OR
    (${t.pricingKind} IN ('size_variants','bedframe_build','tbc'))
  `),
}));

/* ─────────────────────────── Per-product pricing ────────────────────── */
// Three composite-PK tables. UPSERT-friendly. The SKU Master Pricing Editor
// writes to whichever of these matches the product's pricing_kind.

export const productSizeVariants = pgTable('product_size_variants', {
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  sizeId:    text('size_id').notNull().references(() => sizeLibrary.id),
  active:    boolean('active').notNull().default(true),
  price:     integer('price').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.productId, t.sizeId] }),
}));

export const productCompartments = pgTable('product_compartments', {
  productId:     uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  compartmentId: text('compartment_id').notNull().references(() => compartmentLibrary.id),
  active:        boolean('active').notNull().default(true),
  price:         integer('price').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.productId, t.compartmentId] }),
}));

export const productBundles = pgTable('product_bundles', {
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  bundleId:  text('bundle_id').notNull().references(() => bundleLibrary.id),
  active:    boolean('active').notNull().default(true),
  price:     integer('price').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.productId, t.bundleId] }),
}));

/* ─────────────────────────── Sofa fabric & colour ───────────────────── */
// Global fabric library + nested colours, plus a per-Model opt-in/surcharge
// table. Mirrors compartment_library/product_compartments. Fabric tiers add a
// transparent surcharge (whole MYR); colour is free. (Spec 2026-05-24, G1–G3.)

export const fabricLibrary = pgTable('fabric_library', {
  id:               text('id').primaryKey(),                     // 'linen','velvet','leather-pu'
  label:            text('label').notNull(),                     // 'Linen'
  tier:             text('tier').notNull().default('standard'),  // 'standard' | 'premium' (display)
  defaultSurcharge: integer('default_surcharge').notNull().default(0), // seed default add-on
  swatchKey:        text('swatch_key'),                          // optional R2 texture; else hex chip
  active:           boolean('active').notNull().default(true),
  sortOrder:        integer('sort_order').notNull().default(0),
});

export const fabricColours = pgTable('fabric_colours', {
  fabricId:  text('fabric_id').notNull().references(() => fabricLibrary.id, { onDelete: 'cascade' }),
  colourId:  text('colour_id').notNull(),                        // 'sand','charcoal'
  label:     text('label').notNull(),                            // 'Sand'
  swatchHex: text('swatch_hex'),                                 // '#D8C7A8' chip
  swatchKey: text('swatch_key'),                                 // optional R2 image
  active:    boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.fabricId, t.colourId] }),
}));

export const productFabrics = pgTable('product_fabrics', {
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  fabricId:  text('fabric_id').notNull().references(() => fabricLibrary.id),
  active:    boolean('active').notNull().default(true),          // the per-Model "勾选"
  surcharge: integer('surcharge').notNull().default(0),          // seeded from default_surcharge
}, (t) => ({
  pk: primaryKey({ columns: [t.productId, t.fabricId] }),
}));

/* ─────────────────────────── Bedframe configurator ──────────────────── */
// Bedframe (pricing_kind='bedframe_build'): size variant (reuse product_size_
// variants) + a global colour library + POS-owned option choice-lists snapshot
// (gap/leg/divan/total/specials, Decision B — decoupled from maintenance_config).
// All POS pricing SKU-Master-owned; surcharges start 0. (Spec 2026-05-25.)

export const bedframeColours = pgTable('bedframe_colours', {
  id:        text('id').primaryKey(),                 // 'sand','charcoal'
  label:     text('label').notNull(),
  swatchHex: text('swatch_hex'),
  surcharge: integer('surcharge').notNull().default(0),
  active:    boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const productBedframeColours = pgTable('product_bedframe_colours', {
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  colourId:  text('colour_id').notNull().references(() => bedframeColours.id),
  active:    boolean('active').notNull().default(true),   // the per-Model "勾选"
}, (t) => ({
  pk: primaryKey({ columns: [t.productId, t.colourId] }),
}));

export const bedframeOptions = pgTable('bedframe_options', {
  id:        text('id').primaryKey(),                 // 'gap-6','leg-7','special-left-drawer'
  kind:      text('kind').notNull(),                  // 'gap'|'leg_height'|'divan_height'|'total_height'|'special'
  value:     text('value').notNull(),                 // '6"','7"','Left Drawer'
  surcharge: integer('surcharge').notNull().default(0),
  active:    boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  kindIdx: index('idx_bedframe_options_kind').on(t.kind),
}));

/* ─────────────────────────── Add-ons ────────────────────────────────── */

export const addons = pgTable('addons', {
  id:           text('id').primaryKey(),          // 'dispose-mattress','lift'
  label:        text('label').notNull(),
  description:  text('description'),
  icon:         text('icon').notNull(),           // lucide icon name
  kind:         addonKind('kind').notNull(),
  price:        integer('price').notNull(),
  perFloorItem: integer('per_floor_item'),        // only for kind='floors_items'
  unit:         text('unit'),                     // 'piece','floor·item','set'
  defaultQty:   integer('default_qty').notNull().default(1),
  stock:        integer('stock'),                 // NULL = unlimited
  enabled:      boolean('enabled').notNull().default(true),
  sortOrder:    integer('sort_order').notNull().default(0),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ─────────────────────────── Drivers + Customers ────────────────────── */

export const drivers = pgTable('drivers', {
  id:         uuid('id').primaryKey().defaultRandom(),
  driverCode: text('driver_code').notNull().unique(),  // 'DRV-01'
  name:       text('name').notNull(),
  phone:      text('phone').notNull(),
  icNumber:   text('ic_number'),
  vehicle:    text('vehicle'),
  active:     boolean('active').notNull().default(true),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customers = pgTable('customers', {
  id:           uuid('id').primaryKey().defaultRandom(),
  name:         text('name').notNull(),
  phone:        text('phone'),                    // normalized intl format
  email:        text('email'),
  address:      text('address'),
  addressLine2: text('address_line2'),
  postcode:     text('postcode'),
  city:         text('city'),
  state:        text('state'),
  notes:        text('notes'),
  firstSeenAt:  timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt:   timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  phoneIdx: index('idx_customers_phone').on(t.phone),
}));

/* ─────────────────────────── My-Localities (postcode cascade) ───────── */
// Seed source: vetted public dataset (Pos Malaysia or yusufusoff/malaysia-postcodes).
// One row per (postcode, city). Postcode is NOT unique — multiple cities
// share prefixes. State + city together make a row unique.
// Used by §10 Decision 3 cascading state→city→postcode dropdowns.

export const myLocalities = pgTable('my_localities', {
  id:        uuid('id').primaryKey().defaultRandom(),
  postcode:  text('postcode').notNull(),
  city:      text('city').notNull(),
  state:     text('state').notNull(),       // 'Selangor','Kuala Lumpur',...
  stateCode: text('state_code').notNull(),  // 'SGR','KUL','PNG',...
}, (t) => ({
  postcodeIdx: index('idx_my_localities_postcode').on(t.postcode),
  stateIdx:    index('idx_my_localities_state').on(t.state),
}));

/* ─────────────────────────── Orders ─────────────────────────────────── */

// orders.id is generated by `next_order_id()` — see migrations for the
// CREATE SEQUENCE / FUNCTION in raw SQL. Drizzle can't model that, so we
// declare it as TEXT here without a default; the API supplies it via SQL
// or the DB function is set as the column default in the migration.
export const orders = pgTable('orders', {
  id:        text('id').primaryKey(),                    // 'SO-2045'
  placedAt:  timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
  staffId:   uuid('staff_id').notNull().references(() => staff.id),
  showroomId: uuid('showroom_id').notNull().references(() => showrooms.id),

  lane:      orderLane('lane').notNull().default('received'),

  // Customer snapshot (denormalised on purpose — orders survive customer edits)
  customerName:     text('customer_name').notNull(),
  customerPhone:    text('customer_phone'),
  customerEmail:    text('customer_email'),
  customerAddress:  text('customer_address'),
  customerAddressLine2: text('customer_address_line2'),
  customerPostcode: text('customer_postcode'),
  customerCity:     text('customer_city'),
  customerState:    text('customer_state'),

  customerType:   text('customer_type'),   // 'new' | 'existing'
  buildingType:   text('building_type'),   // 'condo'|'landed'|'apartment'|'office'|'shop'|'other'
  billingSame:    boolean('billing_same').notNull().default(true),
  salespersonId:  uuid('salesperson_id').references(() => staff.id),

  emergencyName:     text('emergency_name'),
  emergencyPhone:    text('emergency_phone'),
  emergencyRelation: text('emergency_relation'),

  customerId: uuid('customer_id').references(() => customers.id),

  // Money (whole RM)
  subtotal:   integer('subtotal').notNull(),
  addonTotal: integer('addon_total').notNull().default(0),
  total:      integer('total').notNull(),
  paid:       integer('paid').notNull().default(0),

  // Delivery fee snapshot (migration 0029). All three columns are NOT NULL
  // DEFAULT 0 so legacy rows backfill cleanly. Reconstructed from
  // delivery_fee_config + cart at order time; never mutated by config edits.
  deliveryFeeBase:           integer('delivery_fee_base').notNull().default(0),
  deliveryFeeCrossCategory:  integer('delivery_fee_cross_category').notNull().default(0),
  deliveryFeeAdditional:     integer('delivery_fee_additional').notNull().default(0),

  // Pricing version snapshot at order placement (Codex P2.5).
  // Server stamps from `app_config.pricing_version` (bumped by trigger on any
  // products/pricing UPDATE). Lets us reconstruct WHY a posted order's total
  // differs from what staff saw 60s earlier. NOT NULL: every order has a version.
  pricingVersion: text('pricing_version').notNull(),

  // Payment
  paymentMethod: paymentMethod('payment_method').notNull(),
  approvalCode:  text('approval_code'),
  // Installment term in months (6 or 12). NULL unless paymentMethod = 'installment'.
  // 0% installment — metadata only, never affects pricing. (Migration 0034)
  installmentMonths: integer('installment_months'),
  // Merchant acquirer / terminal (GHL/HLB/MBB/PBB). NULL unless paymentMethod =
  // 'merchant'. Replaces the old credit/debit split. (Migration 0037)
  merchantProvider: text('merchant_provider'),

  // Slip
  slipState:        slipState('slip_state').notNull().default('none'),
  slipKey:          text('slip_key'),                 // R2 key
  slipVerifiedBy:   uuid('slip_verified_by').references(() => staff.id),
  slipVerifiedAt:   timestamp('slip_verified_at', { withTimezone: true }),
  slipFlagReason:   text('slip_flag_reason'),

  // Delivery
  deliveryDate:  date('delivery_date'),
  deliverySlot:  text('delivery_slot'),               // '09:00 – 12:00'
  deliveryTbd:   boolean('delivery_tbd').notNull().default(false),
  deliveryNotes: text('delivery_notes'),
  // Phase 4-C dispatch additions (migration 0012):
  confirmedDeliveryDate: date('confirmed_delivery_date'),  // coordinator-confirmed actual date

  // Dispatch
  driverId:      uuid('driver_id').references(() => drivers.id),
  confirmedWith: text('confirmed_with'),               // 'WhatsApp · 4 May 11:20'
  dispatchedAt:  timestamp('dispatched_at', { withTimezone: true }),
  deliveredAt:   timestamp('delivered_at', { withTimezone: true }),
  doSigned:      boolean('do_signed').notNull().default(false),
  doKey:         text('do_key'),                       // Supabase Storage path (bucket 'dos')
  signatureData: text('signature_data'),               // base64 PNG of customer e-sign captured at handover

  notes:     text('notes'),
  stockNote: text('stock_note'),

  // Phase 4-D PO additions (migration 0016):
  poIssued:    boolean('po_issued').notNull().default(false),
  poIssuedAt:  timestamp('po_issued_at', { withTimezone: true }),
  poIssuedBy:  uuid('po_issued_by').references(() => staff.id, { onDelete: 'restrict' }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  laneIdx:      index('idx_orders_lane').on(t.lane),
  showroomIdx:  index('idx_orders_showroom').on(t.showroomId),
  slipStateIdx: index('idx_orders_slip_state').on(t.slipState).where(sql`${t.slipState} IN ('pending','flagged')`),
  placedAtIdx:  index('idx_orders_placed_at').on(t.placedAt.desc()),
}));

export const orderItems = pgTable('order_items', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orderId:   text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  kind:      orderItemKind('kind').notNull(),

  productId: uuid('product_id').references(() => products.id),     // when kind='product'
  addonId:   text('addon_id').references(() => addons.id),         // when kind='addon'

  qty:       integer('qty').notNull().default(1),
  unitPrice: integer('unit_price').notNull(),                       // snapshot
  lineTotal: integer('line_total').notNull(),                       // snapshot

  // Per-item config JSONB. Shape varies by product category. Server recompute
  // depends on this being COMPLETE — for sofa custom builds the cell geometry
  // (x, y) is required to derive groups, closure and arm collisions.
  // Canonical Zod schema: packages/shared/src/schemas/order.schema.ts
  // Sofa: { depth: '24'|'28', mode: 'preset'|'custom',
  //         presetId?, quickFlip?: 'L'|'R',
  //         customCells: [{moduleId, x, y, rot, recliners?: [{seatIdx, open}]}] }
  // Mattress: { sizeId, freePillows?, extraPillows? }
  // Bedframe: { sizeId, colourId?, gapId?, gapOther? }
  config:    jsonb('config'),

  // Addon extras
  floorsCount: integer('floors_count'),                             // for lift access
  itemsCount:  integer('items_count'),                              // for lift access

  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orderIdx: index('idx_order_items_order').on(t.orderId),
  productOrAddon: check('product_or_addon', sql`
    (${t.kind} = 'product' AND ${t.productId} IS NOT NULL AND ${t.addonId} IS NULL) OR
    (${t.kind} = 'addon'   AND ${t.addonId}   IS NOT NULL AND ${t.productId} IS NULL)
  `),
}));

/* ─────────────────────────── Quotes (saved carts) ───────────────────── */
// §10 Decision 1: saved quotes go to Supabase, not localStorage. Sales staff
// builds a quote → saves → recovers later. Promoted to an order via the
// promotedToOrderId reference. RLS: created_by = auth.uid() for sales,
// admin bypass. (See §11.1 Issue 7 / Phase 0 RLS.)

export const quotes = pgTable('quotes', {
  id:          text('id').primaryKey(),                // 'Q-XXXX' from sequence
  showroomId:  uuid('showroom_id').notNull().references(() => showrooms.id),
  createdBy:   uuid('created_by').notNull().references(() => staff.id),

  // Customer snapshot at quote time
  customerName:  text('customer_name').notNull(),
  customerPhone: text('customer_phone'),
  customerEmail: text('customer_email'),

  // Cart payload (same shape as the order POST body's `cart` field — see §5.1).
  cart:        jsonb('cart').notNull(),
  addons:      jsonb('addons'),                        // optional addon list

  // Snapshot totals (server-recomputed on save, not trusted from client)
  subtotal:    integer('subtotal').notNull(),
  addonTotal:  integer('addon_total').notNull().default(0),
  total:       integer('total').notNull(),
  deliveryFeeBase:           integer('delivery_fee_base').notNull().default(0),
  deliveryFeeCrossCategory:  integer('delivery_fee_cross_category').notNull().default(0),
  deliveryFeeAdditional:     integer('delivery_fee_additional').notNull().default(0),
  // Pricing version snapshot when the quote was saved — when the quote is later
  // promoted to an order, server compares this against current pricing_version
  // and surfaces a PricingDriftModal if drift detected (see §5.2.1).
  pricingVersion: text('pricing_version').notNull(),

  expiresAt:   timestamp('expires_at', { withTimezone: true }),
  promotedToOrderId: text('promoted_to_order_id').references(() => orders.id),

  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  createdByIdx: index('idx_quotes_created_by').on(t.createdBy),
  showroomIdx:  index('idx_quotes_showroom').on(t.showroomId),
}));

/* ─────────────────────────── Payments (audit trail) ─────────────────── */
// §11 Codex P1.7: orders.paid is a single integer; cannot record multiple
// deposits, balance payments, slip replacements, or refunds. payments is
// the source of truth for who paid what when; orders.paid stays as the
// denormalised running total maintained in the same transaction.

export const payments = pgTable('payments', {
  id:           uuid('id').primaryKey().defaultRandom(),
  orderId:      text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),

  kind:         paymentKind('kind').notNull(),
  amount:       integer('amount').notNull(),           // negative for refund
  method:       paymentMethod('method').notNull(),
  approvalCode: text('approval_code'),

  // Payment-specific slip (separate from order's primary slip — e.g. balance payment slip)
  slipKey:      text('slip_key'),                      // R2 key
  slipState:    slipState('slip_state').notNull().default('none'),

  recordedBy:   uuid('recorded_by').notNull().references(() => staff.id),
  recordedAt:   timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

  notes:        text('notes'),
}, (t) => ({
  orderIdx: index('idx_payments_order').on(t.orderId, t.recordedAt.desc()),
}));

/* ─────────────────────────── Audit tables ───────────────────────────── */

export const orderLaneHistory = pgTable('order_lane_history', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orderId:   text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  fromLane:  orderLane('from_lane'),
  toLane:    orderLane('to_lane').notNull(),
  changedBy: uuid('changed_by').notNull().references(() => staff.id),
  reason:    text('reason'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orderIdx: index('idx_order_lane_history_order').on(t.orderId, t.changedAt.desc()),
}));

export const orderSlipEvents = pgTable('order_slip_events', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orderId:   text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  event:     text('event').notNull(),                               // 'uploaded','verified','flagged','replaced'
  actorId:   uuid('actor_id').references(() => staff.id),
  meta:      jsonb('meta'),                                         // { reason: '...' } etc
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ─────────────────────────── Pending slip uploads (orphan reaper) ───── */
// §11.1 Issue 3 + Codex P1.6: presigned PUT issues a row here BEFORE the
// client uploads. POST /orders promotes the row (status='promoted') in the
// same transaction. Cron Worker (every 10 min) leases unpromoted rows past
// expires_at — claimedBy + leaseExpiresAt prevent two reapers racing —
// and deletes the R2 object atomically.
//
// content_hash + content_size are validated by the API on confirm-upload
// (client computes sha256 of bytes, server HEADs R2 and matches).

export const pendingSlipUploads = pgTable('pending_slip_uploads', {
  id:                uuid('id').primaryKey().defaultRandom(),
  uploadSessionId:   text('upload_session_id').notNull().unique(),  // client-generated nonce; idempotency key

  staffId:           uuid('staff_id').notNull().references(() => staff.id),
  showroomId:        uuid('showroom_id').notNull().references(() => showrooms.id),
  orderDraftId:      text('order_draft_id'),     // optional client-side draft ref

  r2Key:             text('r2_key').notNull(),
  contentType:       text('content_type'),       // 'image/jpeg','application/pdf'
  contentHash:       text('content_hash'),       // sha256 hex; client supplies, server verifies on HEAD
  contentSize:       integer('content_size'),    // bytes; cap enforcement

  status:            slipUploadStatus('status').notNull().default('pending'),
  retryCount:        integer('retry_count').notNull().default(0),
  errorMsg:          text('error_msg'),

  // Reaper lease — prevents two reaper instances from racing on the same row
  claimedBy:         text('claimed_by'),
  leaseExpiresAt:    timestamp('lease_expires_at', { withTimezone: true }),

  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt:         timestamp('expires_at', { withTimezone: true }).notNull(),  // upload TTL (1h default)
  promotedAt:        timestamp('promoted_at', { withTimezone: true }),
  promotedToOrderId: text('promoted_to_order_id').references(() => orders.id),
}, (t) => ({
  reaperIdx:  index('idx_pending_slip_reaper').on(t.status, t.expiresAt)
                .where(sql`${t.status} IN ('pending','uploaded')`),
  staffIdx:   index('idx_pending_slip_staff').on(t.staffId),
  sessionIdx: index('idx_pending_slip_session').on(t.uploadSessionId),
}));

// ────────────────────────────────────────────────────────────────────
// Phase 4-D · Suppliers + Purchase Orders (migrations 0014, 0015)
// ────────────────────────────────────────────────────────────────────

export const supplierStatus = pgEnum('supplier_status', ['ACTIVE', 'INACTIVE', 'BLOCKED']);

export const currencyCode = pgEnum('currency_code', ['MYR', 'RMB', 'USD', 'SGD']);

export const poStatus = pgEnum('po_status', [
  'DRAFT',                // editable, not sent
  'SUBMITTED',            // sent to supplier, awaiting acknowledgement
  'PARTIALLY_RECEIVED',   // some GRN posted
  'RECEIVED',             // all items GRN'd
  'CANCELLED',
]);

export const suppliers = pgTable('suppliers', {
  id:             uuid('id').primaryKey().defaultRandom(),
  code:           text('code').notNull().unique(),                          // Credit Account ('400-B002')
  name:           text('name').notNull(),                                   // Company Name
  whatsappNumber: text('whatsapp_number'),
  email:          text('email'),
  // HOOKKA-port fields (migration 0041): full master record for purchasing.
  contactPerson:  text('contact_person'),
  phone:          text('phone'),
  address:        text('address'),                                          // Billing Address (multiline)
  state:          text('state'),
  /* PR #47 — country drives State cascade from my_localities */
  country:        text('country').notNull().default('Malaysia'),
  paymentTerms:   text('payment_terms'),                                    // dropdown: 'COD' | 'NET 7' | 'NET 30' | etc
  status:         supplierStatus('status').notNull().default('ACTIVE'),
  rating:         integer('rating').notNull().default(0),                   // 0-5 scale
  notes:          text('notes'),
  /* PR #40 — Commander 2026-05-26 AutoCount parity (migration 0055) */
  supplierType:   text('supplier_type'),                                    // 'Matrix', 'Distributor', 'Maker', ...
  category:       text('category'),                                         // 'Bedframe', 'Fabric', 'Hardware', ...
  tinNumber:      text('tin_number'),
  businessRegNo: text('business_reg_no'),
  postcode:       text('postcode'),
  area:           text('area'),
  mobile:         text('mobile'),
  fax:            text('fax'),
  website:        text('website'),
  attention:      text('attention'),
  businessNature: text('business_nature'),
  currency:       text('currency').notNull().default('MYR'),
  statementType:  text('statement_type').notNull().default('OPEN_ITEM'),    // OPEN_ITEM | BALANCE_FORWARD | NO_STATEMENT
  agingBasis:     text('aging_basis').notNull().default('INVOICE_DATE'),    // INVOICE_DATE | DUE_DATE
  creditLimitSen: integer('credit_limit_sen').notNull().default(0),         // 0 = unlimited
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ───── supplier_material_bindings — the "two-code mapping" table ─────
   The crux of the HOOKKA port: maps our internal `material_code`
   (e.g. mfg_products.code '1003-(K)' or fabrics.code 'AVANI 01')
   to the supplier's own SKU + price + lead time + currency.
   One material can have N suppliers; exactly one per material is
   `is_main_supplier=true` (enforced at app layer, not DB constraint).

   `material_kind` lets one binding row reference either a finished
   SKU (mfg_product) or a fabric — extend with more values when raw
   materials get ported.
   ─────────────────────────────────────────────────────────────────── */

export const materialKind = pgEnum('material_kind', ['mfg_product', 'fabric', 'raw']);

export const supplierMaterialBindings = pgTable('supplier_material_bindings', {
  id:                uuid('id').primaryKey().defaultRandom(),
  supplierId:        uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'cascade' }),
  materialKind:      materialKind('material_kind').notNull(),
  materialCode:      text('material_code').notNull(),    // OUR internal code ('1003-(K)','AVANI 01')
  materialName:      text('material_name').notNull(),    // snapshot for the binding row
  supplierSku:       text('supplier_sku').notNull(),     // SUPPLIER's own SKU
  unitPriceCenti:    integer('unit_price_centi').notNull().default(0),  // × 100; works for both MYR + RMB
  currency:          currencyCode('currency').notNull().default('MYR'),
  leadTimeDays:      integer('lead_time_days').notNull().default(0),
  paymentTermsOverride: text('payment_terms_override'),  // overrides supplier.payment_terms if set
  moq:               integer('moq').notNull().default(0),                // min order quantity
  priceValidFrom:    date('price_valid_from'),
  priceValidTo:      date('price_valid_to'),
  isMainSupplier:    boolean('is_main_supplier').notNull().default(false),
  notes:             text('notes'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxSupplier:        index('idx_smb_supplier').on(t.supplierId),
  idxMaterial:        index('idx_smb_material').on(t.materialKind, t.materialCode),
  idxMain:            index('idx_smb_main_per_material')
                        .on(t.materialKind, t.materialCode)
                        .where(sql`${t.isMainSupplier} = true`),
}));

export const purchaseOrders = pgTable('purchase_orders', {
  id:          uuid('id').primaryKey().defaultRandom(),
  poNumber:    text('po_number').notNull().unique(),       // 'PO-2026-001'
  supplierId:  uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  // Extended fields (migration 0041)
  status:      poStatus('status').notNull().default('DRAFT'),
  poDate:      date('po_date').notNull().defaultNow(),
  expectedAt:  date('expected_at'),                        // delivery ETA
  // PR #77 — Default ship-to warehouse for every line on this PO (mirrors
  // AutoCount's header "Purchase Location"). Per-line warehouse_id on the
  // items table overrides when commander wants split delivery.
  purchaseLocationId: uuid('purchase_location_id').references(() => warehouses.id, { onDelete: 'set null' }),
  currency:    currencyCode('currency').notNull().default('MYR'),
  subtotalCenti: integer('subtotal_centi').notNull().default(0),
  taxCenti:    integer('tax_centi').notNull().default(0),
  totalCenti:  integer('total_centi').notNull().default(0),
  notes:       text('notes'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  receivedAt:  timestamp('received_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid('created_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxSupplier: index('idx_po_supplier').on(t.supplierId),
  idxStatus:   index('idx_po_status').on(t.status),
}));

/* PO items — what we're ordering FROM a supplier (vs purchase_order_lines
   which links a retail-order SKU to a supplier-PO for the existing retail
   /purchase-orders skeleton). */
export const purchaseOrderItems = pgTable('purchase_order_items', {
  id:               uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId:  uuid('purchase_order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  // Optional FK to the binding row that priced this line — gives us
  // traceability when supplier prices change later.
  bindingId:        uuid('binding_id').references(() => supplierMaterialBindings.id, { onDelete: 'set null' }),
  materialKind:     materialKind('material_kind').notNull(),
  materialCode:     text('material_code').notNull(),
  materialName:     text('material_name').notNull(),
  supplierSku:      text('supplier_sku'),                  // snapshot at PO time
  qty:              integer('qty').notNull(),
  unitPriceCenti:   integer('unit_price_centi').notNull(),
  lineTotalCenti:   integer('line_total_centi').notNull(),
  receivedQty:      integer('received_qty').notNull().default(0), // updated by GRN (when ported)
  notes:            text('notes'),
  /* PR #41 — Variant fields (migration 0056). Mirrors mfg_sales_order_items
     so SO→PO and PO→GRN conversions preserve sofa color / bedframe D1 etc. */
  gapInches:               integer('gap_inches'),
  divanHeightInches:       integer('divan_height_inches'),
  divanPriceSen:           integer('divan_price_sen').notNull().default(0),
  legHeightInches:         integer('leg_height_inches'),
  legPriceSen:             integer('leg_price_sen').notNull().default(0),
  customSpecials:          jsonb('custom_specials'),
  lineSuffix:              text('line_suffix'),
  specialOrderPriceSen:    integer('special_order_price_sen').notNull().default(0),
  variants:                jsonb('variants'),               // { fabricColor, seatHeight, ... }
  itemGroup:               text('item_group'),              // 'sofa'|'bedframe'|'mattress'|'accessory'|'service'
  description:             text('description'),
  description2:            text('description2'),
  uom:                     text('uom').notNull().default('UNIT'),
  discountCenti:           integer('discount_centi').notNull().default(0),
  unitCostCenti:           integer('unit_cost_centi').notNull().default(0),
  // PR #77 — per-line delivery date + ship-to warehouse. Both nullable;
  // empty = inherit from PO header (expected_at + purchase_location_id).
  deliveryDate:            date('delivery_date'),
  warehouseId:             uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxPo:        index('idx_po_items_po').on(t.purchaseOrderId),
  idxWarehouse: index('idx_po_items_warehouse').on(t.warehouseId),
}));

export const purchaseOrderLines = pgTable('purchase_order_lines', {
  id:               uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId:  uuid('purchase_order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  orderId:          text('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
  sku:              text('sku').notNull(),
  name:             text('name').notNull(),
  size:             text('size'),
  colour:           text('colour'),
  qty:              integer('qty').notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ════════════════════════════════════════════════════════════════════════
   GRN + Purchase Invoice — complete the procurement pipeline (PO → GRN → PI)
   Migration 0042.
   ════════════════════════════════════════════════════════════════════════ */

export const grnStatus = pgEnum('grn_status', ['DRAFT', 'POSTED', 'CLOSED']);

export const purchaseInvoiceStatus = pgEnum('purchase_invoice_status', [
  'DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED',
]);

export const grns = pgTable('grns', {
  id:                uuid('id').primaryKey().defaultRandom(),
  grnNumber:         text('grn_number').notNull().unique(),         // 'GRN-2605-001'
  purchaseOrderId:   uuid('purchase_order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'restrict' }),
  supplierId:        uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  receivedAt:        date('received_at').notNull().defaultNow(),
  deliveryNoteRef:   text('delivery_note_ref'),                     // supplier's DO number
  status:            grnStatus('status').notNull().default('DRAFT'),
  notes:             text('notes'),
  postedAt:          timestamp('posted_at', { withTimezone: true }),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid('created_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxPo:       index('idx_grn_po').on(t.purchaseOrderId),
  idxSupplier: index('idx_grn_supplier').on(t.supplierId),
  idxStatus:   index('idx_grn_status').on(t.status),
}));

export const grnItems = pgTable('grn_items', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  grnId:                 uuid('grn_id').notNull().references(() => grns.id, { onDelete: 'cascade' }),
  purchaseOrderItemId:   uuid('purchase_order_item_id').references(() => purchaseOrderItems.id, { onDelete: 'set null' }),
  materialKind:          materialKind('material_kind').notNull(),
  materialCode:          text('material_code').notNull(),
  materialName:          text('material_name').notNull(),
  qtyReceived:           integer('qty_received').notNull(),
  qtyAccepted:           integer('qty_accepted').notNull(),
  qtyRejected:           integer('qty_rejected').notNull().default(0),
  rejectionReason:       text('rejection_reason'),
  unitPriceCenti:        integer('unit_price_centi').notNull(),     // snapshot from PO line
  notes:                 text('notes'),
  /* PR #42 — variant fields (migration 0057) */
  gapInches:             integer('gap_inches'),
  divanHeightInches:     integer('divan_height_inches'),
  divanPriceSen:         integer('divan_price_sen').notNull().default(0),
  legHeightInches:       integer('leg_height_inches'),
  legPriceSen:           integer('leg_price_sen').notNull().default(0),
  customSpecials:        jsonb('custom_specials'),
  lineSuffix:            text('line_suffix'),
  specialOrderPriceSen:  integer('special_order_price_sen').notNull().default(0),
  variants:              jsonb('variants'),
  itemGroup:             text('item_group'),
  description:           text('description'),
  description2:          text('description2'),
  uom:                   text('uom').notNull().default('UNIT'),
  discountCenti:         integer('discount_centi').notNull().default(0),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxGrn: index('idx_grn_items_grn').on(t.grnId),
}));

export const purchaseInvoices = pgTable('purchase_invoices', {
  id:                uuid('id').primaryKey().defaultRandom(),
  invoiceNumber:     text('invoice_number').notNull().unique(),     // 'PI-2605-001' (ours)
  supplierInvoiceRef: text('supplier_invoice_ref'),                 // supplier's invoice number
  supplierId:        uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  purchaseOrderId:   uuid('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
  grnId:             uuid('grn_id').references(() => grns.id, { onDelete: 'set null' }),
  invoiceDate:       date('invoice_date').notNull().defaultNow(),
  dueDate:           date('due_date'),
  currency:          currencyCode('currency').notNull().default('MYR'),
  subtotalCenti:     integer('subtotal_centi').notNull().default(0),
  taxCenti:          integer('tax_centi').notNull().default(0),
  totalCenti:        integer('total_centi').notNull().default(0),
  paidCenti:         integer('paid_centi').notNull().default(0),
  status:            purchaseInvoiceStatus('status').notNull().default('DRAFT'),
  notes:             text('notes'),
  postedAt:          timestamp('posted_at', { withTimezone: true }),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid('created_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxSupplier: index('idx_pi_supplier').on(t.supplierId),
  idxPo:       index('idx_pi_po').on(t.purchaseOrderId),
  idxStatus:   index('idx_pi_status').on(t.status),
}));

export const purchaseInvoiceItems = pgTable('purchase_invoice_items', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  purchaseInvoiceId:   uuid('purchase_invoice_id').notNull().references(() => purchaseInvoices.id, { onDelete: 'cascade' }),
  grnItemId:           uuid('grn_item_id').references(() => grnItems.id, { onDelete: 'set null' }),
  materialKind:        materialKind('material_kind').notNull(),
  materialCode:        text('material_code').notNull(),
  materialName:        text('material_name').notNull(),
  qty:                 integer('qty').notNull(),
  unitPriceCenti:      integer('unit_price_centi').notNull(),
  lineTotalCenti:      integer('line_total_centi').notNull(),
  notes:               text('notes'),
  /* PR #42 — variant fields (migration 0057) */
  gapInches:             integer('gap_inches'),
  divanHeightInches:     integer('divan_height_inches'),
  divanPriceSen:         integer('divan_price_sen').notNull().default(0),
  legHeightInches:       integer('leg_height_inches'),
  legPriceSen:           integer('leg_price_sen').notNull().default(0),
  customSpecials:        jsonb('custom_specials'),
  lineSuffix:            text('line_suffix'),
  specialOrderPriceSen:  integer('special_order_price_sen').notNull().default(0),
  variants:              jsonb('variants'),
  itemGroup:             text('item_group'),
  description:           text('description'),
  description2:          text('description2'),
  uom:                   text('uom').notNull().default('UNIT'),
  discountCenti:         integer('discount_centi').notNull().default(0),
  unitCostCenti:         integer('unit_cost_centi').notNull().default(0),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxPi: index('idx_pi_items_pi').on(t.purchaseInvoiceId),
}));

/* ════════════════════════════════════════════════════════════════════════
   B2B Sales: SO → DO → Sales Invoice
   HOUZS ERP风格 — separate from retail `orders` (which is POS-style).
   `mfg_sales_orders` because we have two coexisting "sales order" concepts:
   - retail `orders.id` = 'SO-2045' (POS, 6-lane flow)
   - mfg `mfg_sales_orders.doc_no` = 'SO-009559' (B2B contract, HOUZS pattern)
   Migration 0042 (same migration as GRN+PI for atomic deploy).
   ════════════════════════════════════════════════════════════════════════ */

export const mfgSoStatus = pgEnum('mfg_so_status', [
  'DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED',
  'DELIVERED', 'INVOICED', 'CLOSED', 'ON_HOLD', 'CANCELLED',
]);

export const doStatus = pgEnum('do_status', [
  'DRAFT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'SIGNED',
  'DELIVERED', 'INVOICED', 'CANCELLED',
]);

export const salesInvoiceStatus = pgEnum('sales_invoice_status', [
  'DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED',
]);

export const mfgSalesOrders = pgTable('mfg_sales_orders', {
  // Mirrors HOUZS so_headers (doc_no PK as TEXT — human-readable like 'SO-009559')
  docNo:             text('doc_no').primaryKey(),
  transferTo:        text('transfer_to'),
  soDate:            date('so_date').notNull().defaultNow(),
  branding:          text('branding'),
  debtorCode:        text('debtor_code'),
  debtorName:        text('debtor_name').notNull(),
  agent:             text('agent'),
  salesLocation:     text('sales_location'),
  ref:               text('ref'),
  poDocNo:           text('po_doc_no'),                            // customer's PO
  venue:             text('venue'),

  // Address fields (HOUZS pattern — 4 address lines + phone)
  address1:          text('address1'),
  address2:          text('address2'),
  address3:          text('address3'),
  address4:          text('address4'),
  phone:             text('phone'),

  // Money breakdown by category (HOUZS pattern, denormalized for fast filter)
  mattressSofaCenti: integer('mattress_sofa_centi').notNull().default(0),
  bedframeCenti:     integer('bedframe_centi').notNull().default(0),
  accessoriesCenti:  integer('accessories_centi').notNull().default(0),
  othersCenti:       integer('others_centi').notNull().default(0),
  localTotalCenti:   integer('local_total_centi').notNull().default(0),
  balanceCenti:      integer('balance_centi').notNull().default(0),

  totalCostCenti:    integer('total_cost_centi').notNull().default(0),
  totalRevenueCenti: integer('total_revenue_centi').notNull().default(0),
  totalMarginCenti:  integer('total_margin_centi').notNull().default(0),
  marginPctBasis:    integer('margin_pct_basis').notNull().default(0), // × 100 (e.g. 23.50% = 2350)
  lineCount:         integer('line_count').notNull().default(0),

  currency:          currencyCode('currency').notNull().default('MYR'),
  status:            mfgSoStatus('status').notNull().default('DRAFT'),
  remark2:           text('remark2'),
  remark3:           text('remark3'),
  remark4:           text('remark4'),
  note:              text('note'),
  processingDate:    date('processing_date'),
  salesExemptionExpiry: date('sales_exemption_expiry'),

  // ── Additions from PR #35 (HOOKKA-aligned + ERPNext-style naming) ────
  // Customer master link (existing customers table; we still keep debtor_name
  // as a denormalised snapshot for display speed)
  customerId:        uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  customerState:     text('customer_state'),
  // Customer PO — 3 structured fields + optional scanned image base64
  customerPo:        text('customer_po'),
  customerPoId:      text('customer_po_id'),
  customerPoDate:    date('customer_po_date'),
  customerPoImageB64: text('customer_po_image_b64'),
  // PR #121 — customer's own SO number from their ERP. Different concept
  // from their PO (buy-side ref) and from our `ref` (free-text). Used
  // when AKEMI/HOUZS cross-reference our SOs against their own.
  customerSoNo:      text('customer_so_no'),
  // Multi-branch customer (HOOKKA uses delivery_hubs FK; we keep nullable
  // uuid + snapshot text so 2990s isn't forced to mirror delivery_hubs yet)
  hubId:             uuid('hub_id'),
  hubName:           text('hub_name'),
  // Delivery date granularity
  customerDeliveryDate: date('customer_delivery_date'),
  internalExpectedDd: date('internal_expected_dd'),
  linkedDoDocNo:     text('linked_do_doc_no'),
  // Multi-address (in addition to legacy address1-4)
  shipToAddress:     text('ship_to_address'),
  billToAddress:     text('bill_to_address'),
  installToAddress:  text('install_to_address'),
  // Money + overdue
  subtotalSen:       integer('subtotal_sen'),
  overdue:           text('overdue'),                       // 'PENDING' | 'DUE' | 'OVERDUE' | null

  /* PR #46 — POS handover alignment (migration 0060). Commander 2026-05-26:
     SO 不是 B2B 的, 就是顾客的. POS Customer/Address/Emergency/Target Date
     phases now round-trip to mfg_sales_orders. */
  email:                          text('email'),
  customerType:                   text('customer_type'),              // 'NEW' | 'EXISTING'
  salespersonId:                  uuid('salesperson_id').references(() => staff.id, { onDelete: 'set null' }),
  city:                           text('city'),
  postcode:                       text('postcode'),
  buildingType:                   text('building_type'),              // Condo / Landed / Apartment / Office / Shop / Other
  emergencyContactName:           text('emergency_contact_name'),
  emergencyContactPhone:          text('emergency_contact_phone'),
  emergencyContactRelationship:   text('emergency_contact_relationship'),
  targetDate:                     date('target_date'),

  /* PR #143 — Payment fields mirrored from POS handover (migration 0068).
     Commander 2026-05-26: "你把 POS system 的 payment 那个地方也放进来 Sales
     Order 里面". Tracks how the customer is paying + deposit / running paid
     totals. Strict enum on POS side (`payment_method` pgEnum); free text
     here so a B2B SO that doesn't go through POS can still carry the same
     concept. */
  /* PR #150 — Installment is a sub-type of MERCHANT (not its own
     top-level method). Commander: "event installment 也是 under
     merchant 的". approval_code added for the bank auth slip number. */
  paymentMethod:        text('payment_method'),       // cash | transfer | merchant
  installmentMonths:    integer('installment_months'), // 6 | 12 — NULL = normal swipe; only valid when method='merchant'
  merchantProvider:     text('merchant_provider'),    // GHL | HLB | MBB | PBB
  approvalCode:         text('approval_code'),        // auth code (merchant) / slip ref (transfer) / receipt no (cash)
  /* PR #157 — payment_date captures the day funds were actually received
     (Commander: "需要一个日期填写收钱的日期"). Independent of so_date. */
  paymentDate:          date('payment_date'),
  depositCenti:         integer('deposit_centi').notNull().default(0),
  paidCenti:            integer('paid_centi').notNull().default(0),

  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxDate:     index('idx_mso_date').on(t.soDate),
  idxDebtor:   index('idx_mso_debtor').on(t.debtorCode),
  idxStatus:   index('idx_mso_status').on(t.status),
  idxBranding: index('idx_mso_branding').on(t.branding),
  idxCustomer: index('idx_mso_customer').on(t.customerId),
}));

export const mfgSalesOrderItems = pgTable('mfg_sales_order_items', {
  // Mirrors HOUZS so_lines
  id:                uuid('id').primaryKey().defaultRandom(),
  docNo:             text('doc_no').notNull().references(() => mfgSalesOrders.docNo, { onDelete: 'cascade' }),
  lineDate:          date('line_date').notNull().defaultNow(),
  debtorCode:        text('debtor_code'),
  debtorName:        text('debtor_name'),
  agent:             text('agent'),
  itemGroup:         text('item_group').notNull(),                 // bedframe/sofa/mattress/accessory/others
  itemCode:          text('item_code').notNull(),
  description:       text('description'),
  description2:      text('description2'),
  uom:               text('uom').notNull().default('UNIT'),
  location:          text('location'),
  qty:               integer('qty').notNull().default(1),
  unitPriceCenti:    integer('unit_price_centi').notNull().default(0),
  discountCenti:     integer('discount_centi').notNull().default(0),
  totalCenti:        integer('total_centi').notNull().default(0),
  taxCenti:          integer('tax_centi').notNull().default(0),
  totalIncCenti:     integer('total_inc_centi').notNull().default(0),
  balanceCenti:      integer('balance_centi').notNull().default(0),
  paymentStatus:     text('payment_status').notNull().default('Unchecked'),
  venue:             text('venue'),
  branding:          text('branding'),
  remark:            text('remark'),
  cancelled:         boolean('cancelled').notNull().default(false),
  variants:          jsonb('variants'),                             // {fabric, gap, divanHeight, legHeight, ...}
  unitCostCenti:     integer('unit_cost_centi').notNull().default(0),
  lineCostCenti:     integer('line_cost_centi').notNull().default(0),
  lineMarginCenti:   integer('line_margin_centi').notNull().default(0),

  // ── PR #35 additions — bedframe variant pricing + sofa line suffix +
  // free-text "custom specials" (mix of predefined + user-typed surcharges)
  gapInches:         integer('gap_inches'),
  divanHeightInches: integer('divan_height_inches'),
  divanPriceSen:     integer('divan_price_sen').notNull().default(0),
  legHeightInches:   integer('leg_height_inches'),
  legPriceSen:       integer('leg_price_sen').notNull().default(0),
  customSpecials:    jsonb('custom_specials'),               // [{ description, surchargeSen }]
  lineSuffix:        text('line_suffix'),                    // '-01', '-02' for sofa modules
  specialOrderPriceSen: integer('special_order_price_sen').notNull().default(0),

  // PR — Commander 2026-05-26: SO → PO multi-select + partial proceed.
  // Tracks how much of this line has already been emitted to one or
  // more POs (cumulative). Remaining convertible = qty - po_qty_picked.
  poQtyPicked:       integer('po_qty_picked').notNull().default(0),

  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxDoc:       index('idx_mso_items_doc').on(t.docNo),
  idxItemCode:  index('idx_mso_items_item').on(t.itemCode),
  idxItemGroup: index('idx_mso_items_group').on(t.itemGroup),
}));

/* ─────────────────────────── SO audit trails ──────────────────────────
   Two append-only tables driving the Sales Order detail page audit panels.
   - mfgSoStatusChanges: every transition with actor + notes + auto-actions
   - mfgSoPriceOverrides: every line-price override with approver + reason
   ──────────────────────────────────────────────────────────────────────── */

export const mfgSoStatusChanges = pgTable('mfg_so_status_changes', {
  id:           uuid('id').primaryKey().defaultRandom(),
  docNo:        text('doc_no').notNull().references(() => mfgSalesOrders.docNo, { onDelete: 'cascade' }),
  fromStatus:   text('from_status'),
  toStatus:     text('to_status').notNull(),
  changedBy:    uuid('changed_by').references(() => staff.id, { onDelete: 'set null' }),
  notes:        text('notes'),
  autoActions:  jsonb('auto_actions'),                       // string[] e.g. ['createProductionOrders']
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxDoc: index('idx_so_status_changes_doc').on(t.docNo),
  idxAt:  index('idx_so_status_changes_at').on(t.createdAt),
}));

export const mfgSoPriceOverrides = pgTable('mfg_so_price_overrides', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  docNo:              text('doc_no').notNull().references(() => mfgSalesOrders.docNo, { onDelete: 'cascade' }),
  itemId:             uuid('item_id').notNull().references(() => mfgSalesOrderItems.id, { onDelete: 'cascade' }),
  itemCode:           text('item_code').notNull(),
  originalPriceSen:   integer('original_price_sen').notNull(),
  overridePriceSen:   integer('override_price_sen').notNull(),
  reason:             text('reason'),
  approvedBy:         uuid('approved_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxDoc:  index('idx_so_overrides_doc').on(t.docNo),
  idxItem: index('idx_so_overrides_item').on(t.itemId),
}));

/* DO — delivery orders (we → customer) */
export const deliveryOrders = pgTable('delivery_orders', {
  id:                uuid('id').primaryKey().defaultRandom(),
  doNumber:          text('do_number').notNull().unique(),         // 'DO-2605-001'
  soDocNo:           text('so_doc_no').references(() => mfgSalesOrders.docNo, { onDelete: 'set null' }),
  debtorCode:        text('debtor_code'),
  debtorName:        text('debtor_name').notNull(),
  doDate:            date('do_date').notNull().defaultNow(),
  expectedDeliveryAt: date('expected_delivery_at'),
  signedAt:          timestamp('signed_at', { withTimezone: true }),
  deliveredAt:       timestamp('delivered_at', { withTimezone: true }),
  dispatchedAt:      timestamp('dispatched_at', { withTimezone: true }),

  driverId:          uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
  driverName:        text('driver_name'),                          // snapshot
  vehicle:           text('vehicle'),
  m3Total:           integer('m3_total_milli').notNull().default(0),  // × 1000

  // Address snapshot
  address1:          text('address1'),
  address2:          text('address2'),
  city:              text('city'),
  state:             text('state'),
  postcode:          text('postcode'),
  phone:             text('phone'),

  podR2Key:          text('pod_r2_key'),                           // proof of delivery photo
  signatureData:     text('signature_data'),                       // base64 png
  status:            doStatus('status').notNull().default('DRAFT'),
  notes:             text('notes'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid('created_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxSo:     index('idx_do_so').on(t.soDocNo),
  idxStatus: index('idx_do_status').on(t.status),
  idxDate:   index('idx_do_date').on(t.doDate),
}));

export const deliveryOrderItems = pgTable('delivery_order_items', {
  id:                uuid('id').primaryKey().defaultRandom(),
  deliveryOrderId:   uuid('delivery_order_id').notNull().references(() => deliveryOrders.id, { onDelete: 'cascade' }),
  soItemId:          uuid('so_item_id').references(() => mfgSalesOrderItems.id, { onDelete: 'set null' }),
  itemCode:          text('item_code').notNull(),
  description:       text('description'),
  qty:               integer('qty').notNull(),
  m3Milli:           integer('m3_milli').notNull().default(0),
  unitPriceCenti:    integer('unit_price_centi').notNull().default(0),
  notes:             text('notes'),
  /* PR #43 — variant fields (migration 0058) */
  gapInches:             integer('gap_inches'),
  divanHeightInches:     integer('divan_height_inches'),
  divanPriceSen:         integer('divan_price_sen').notNull().default(0),
  legHeightInches:       integer('leg_height_inches'),
  legPriceSen:           integer('leg_price_sen').notNull().default(0),
  customSpecials:        jsonb('custom_specials'),
  lineSuffix:            text('line_suffix'),
  specialOrderPriceSen:  integer('special_order_price_sen').notNull().default(0),
  variants:              jsonb('variants'),
  itemGroup:             text('item_group'),
  description2:          text('description2'),
  uom:                   text('uom').notNull().default('UNIT'),
  discountCenti:         integer('discount_centi').notNull().default(0),
  lineTotalCenti:        integer('line_total_centi').notNull().default(0),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxDo: index('idx_do_items_do').on(t.deliveryOrderId),
}));

/* Sales Invoice — we billing the customer */
export const salesInvoices = pgTable('sales_invoices', {
  id:                uuid('id').primaryKey().defaultRandom(),
  invoiceNumber:     text('invoice_number').notNull().unique(),    // 'SI-2605-001'
  soDocNo:           text('so_doc_no').references(() => mfgSalesOrders.docNo, { onDelete: 'set null' }),
  deliveryOrderId:   uuid('delivery_order_id').references(() => deliveryOrders.id, { onDelete: 'set null' }),
  debtorCode:        text('debtor_code'),
  debtorName:        text('debtor_name').notNull(),
  invoiceDate:       date('invoice_date').notNull().defaultNow(),
  dueDate:           date('due_date'),
  currency:          currencyCode('currency').notNull().default('MYR'),
  subtotalCenti:     integer('subtotal_centi').notNull().default(0),
  discountCenti:     integer('discount_centi').notNull().default(0),
  taxCenti:          integer('tax_centi').notNull().default(0),
  totalCenti:        integer('total_centi').notNull().default(0),
  paidCenti:         integer('paid_centi').notNull().default(0),
  status:            salesInvoiceStatus('status').notNull().default('DRAFT'),
  notes:             text('notes'),
  sentAt:            timestamp('sent_at', { withTimezone: true }),
  paidAt:            timestamp('paid_at', { withTimezone: true }),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid('created_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxSo:      index('idx_si_so').on(t.soDocNo),
  idxDebtor:  index('idx_si_debtor').on(t.debtorCode),
  idxStatus:  index('idx_si_status').on(t.status),
  idxDueDate: index('idx_si_due_date').on(t.dueDate),
}));

export const salesInvoiceItems = pgTable('sales_invoice_items', {
  id:                uuid('id').primaryKey().defaultRandom(),
  salesInvoiceId:    uuid('sales_invoice_id').notNull().references(() => salesInvoices.id, { onDelete: 'cascade' }),
  soItemId:          uuid('so_item_id').references(() => mfgSalesOrderItems.id, { onDelete: 'set null' }),
  itemCode:          text('item_code').notNull(),
  description:       text('description'),
  qty:               integer('qty').notNull(),
  unitPriceCenti:    integer('unit_price_centi').notNull().default(0),
  discountCenti:     integer('discount_centi').notNull().default(0),
  taxCenti:          integer('tax_centi').notNull().default(0),
  lineTotalCenti:    integer('line_total_centi').notNull().default(0),
  notes:             text('notes'),
  /* PR #43 — variant fields (migration 0058) */
  gapInches:             integer('gap_inches'),
  divanHeightInches:     integer('divan_height_inches'),
  divanPriceSen:         integer('divan_price_sen').notNull().default(0),
  legHeightInches:       integer('leg_height_inches'),
  legPriceSen:           integer('leg_price_sen').notNull().default(0),
  customSpecials:        jsonb('custom_specials'),
  lineSuffix:            text('line_suffix'),
  specialOrderPriceSen:  integer('special_order_price_sen').notNull().default(0),
  variants:              jsonb('variants'),
  itemGroup:             text('item_group'),
  description2:          text('description2'),
  uom:                   text('uom').notNull().default('UNIT'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxSi: index('idx_si_items_si').on(t.salesInvoiceId),
}));

/* ════════════════════════════════════════════════════════════════════════
   Consignment (stock at customer branch) + Delivery Return
   Migration 0042 (same).
   ════════════════════════════════════════════════════════════════════════ */

export const consignmentStatus = pgEnum('consignment_status', [
  'AT_BRANCH',  // stock physically at customer's place, ours
  'SOLD',       // customer reports sold, we invoice
  'RETURNED',   // pulled back, restocked
  'DAMAGED',    // written off
]);

export const consignmentNoteType = pgEnum('consignment_note_type', ['OUT', 'RETURN']);

export const deliveryReturnStatus = pgEnum('delivery_return_status', [
  'PENDING',      // customer flagged, not yet picked up
  'RECEIVED',     // back in warehouse
  'INSPECTED',    // QC done
  'REFUNDED',     // money back
  'CREDIT_NOTED', // credit note issued instead of cash refund
  'REJECTED',     // return denied
]);

/* Consignment orders — stock placed at a customer branch */
export const consignmentOrders = pgTable('consignment_orders', {
  id:                uuid('id').primaryKey().defaultRandom(),
  consignmentNumber: text('consignment_number').notNull().unique(),  // 'CO-2605-001'
  debtorCode:        text('debtor_code'),
  debtorName:        text('debtor_name').notNull(),
  branchLocation:    text('branch_location'),                        // physical site
  placedAt:          date('placed_at').notNull().defaultNow(),
  notes:             text('notes'),
  status:            consignmentStatus('status').notNull().default('AT_BRANCH'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid('created_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxDebtor: index('idx_co_debtor').on(t.debtorCode),
  idxStatus: index('idx_co_status').on(t.status),
}));

export const consignmentOrderItems = pgTable('consignment_order_items', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  consignmentOrderId:  uuid('consignment_order_id').notNull().references(() => consignmentOrders.id, { onDelete: 'cascade' }),
  itemCode:            text('item_code').notNull(),
  description:         text('description'),
  qtyPlaced:           integer('qty_placed').notNull(),
  qtySold:             integer('qty_sold').notNull().default(0),
  qtyReturned:         integer('qty_returned').notNull().default(0),
  qtyDamaged:          integer('qty_damaged').notNull().default(0),
  unitPriceCenti:      integer('unit_price_centi').notNull().default(0),
  /* PR #43 — variant fields (migration 0058) */
  gapInches:             integer('gap_inches'),
  divanHeightInches:     integer('divan_height_inches'),
  divanPriceSen:         integer('divan_price_sen').notNull().default(0),
  legHeightInches:       integer('leg_height_inches'),
  legPriceSen:           integer('leg_price_sen').notNull().default(0),
  customSpecials:        jsonb('custom_specials'),
  lineSuffix:            text('line_suffix'),
  specialOrderPriceSen:  integer('special_order_price_sen').notNull().default(0),
  variants:              jsonb('variants'),
  itemGroup:             text('item_group'),
  uom:                   text('uom').notNull().default('UNIT'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxCo: index('idx_co_items_co').on(t.consignmentOrderId),
}));

/* Consignment notes — movement receipts (OUT when placed, RETURN when pulled) */
export const consignmentNotes = pgTable('consignment_notes', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  noteNumber:          text('note_number').notNull().unique(),       // 'CN-2605-001'
  consignmentOrderId:  uuid('consignment_order_id').notNull().references(() => consignmentOrders.id, { onDelete: 'restrict' }),
  noteType:            consignmentNoteType('note_type').notNull(),
  noteDate:            date('note_date').notNull().defaultNow(),
  driverId:            uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
  driverName:          text('driver_name'),
  vehicle:             text('vehicle'),
  signedAt:            timestamp('signed_at', { withTimezone: true }),
  signatureData:       text('signature_data'),
  notes:               text('notes'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid('created_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
}, (t) => ({
  idxCo:   index('idx_cn_co').on(t.consignmentOrderId),
  idxType: index('idx_cn_type').on(t.noteType),
}));

export const consignmentNoteItems = pgTable('consignment_note_items', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  consignmentNoteId:   uuid('consignment_note_id').notNull().references(() => consignmentNotes.id, { onDelete: 'cascade' }),
  consignmentItemId:   uuid('consignment_item_id').references(() => consignmentOrderItems.id, { onDelete: 'set null' }),
  itemCode:            text('item_code').notNull(),
  description:         text('description'),
  qty:                 integer('qty').notNull(),
  notes:               text('notes'),
  /* PR #43 — variant fields (migration 0058) */
  variants:            jsonb('variants'),
  itemGroup:           text('item_group'),
  uom:                 text('uom').notNull().default('UNIT'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxCn: index('idx_cn_items_cn').on(t.consignmentNoteId),
}));

/* Delivery Return — customer returning previously-delivered goods */
export const deliveryReturns = pgTable('delivery_returns', {
  id:                uuid('id').primaryKey().defaultRandom(),
  returnNumber:      text('return_number').notNull().unique(),       // 'DR-2605-001'
  deliveryOrderId:   uuid('delivery_order_id').references(() => deliveryOrders.id, { onDelete: 'set null' }),
  salesInvoiceId:    uuid('sales_invoice_id').references(() => salesInvoices.id, { onDelete: 'set null' }),
  debtorCode:        text('debtor_code'),
  debtorName:        text('debtor_name').notNull(),
  returnDate:        date('return_date').notNull().defaultNow(),
  reason:            text('reason'),
  status:            deliveryReturnStatus('status').notNull().default('PENDING'),
  receivedAt:        timestamp('received_at', { withTimezone: true }),
  inspectedAt:       timestamp('inspected_at', { withTimezone: true }),
  refundedAt:        timestamp('refunded_at', { withTimezone: true }),
  refundCenti:       integer('refund_centi').notNull().default(0),
  inspectionNotes:   text('inspection_notes'),
  notes:             text('notes'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid('created_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxDo:     index('idx_dr_do').on(t.deliveryOrderId),
  idxStatus: index('idx_dr_status').on(t.status),
  idxDebtor: index('idx_dr_debtor').on(t.debtorCode),
}));

export const deliveryReturnItems = pgTable('delivery_return_items', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  deliveryReturnId:    uuid('delivery_return_id').notNull().references(() => deliveryReturns.id, { onDelete: 'cascade' }),
  doItemId:            uuid('do_item_id').references(() => deliveryOrderItems.id, { onDelete: 'set null' }),
  itemCode:            text('item_code').notNull(),
  description:         text('description'),
  qtyReturned:         integer('qty_returned').notNull(),
  condition:           text('condition'),                            // 'NEW', 'DAMAGED', 'DEFECT'
  unitPriceCenti:      integer('unit_price_centi').notNull().default(0),
  refundCenti:         integer('refund_centi').notNull().default(0),
  notes:               text('notes'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxDr: index('idx_dr_items_dr').on(t.deliveryReturnId),
}));

/* ════════════════════════════════════════════════════════════════════════
   Purchase Returns — we return purchased goods back to the supplier.
   Mirrors the GRN flow in reverse. Linked to PO + (optional) GRN so the
   audit trail closes: PO → GRN → (defects discovered) → PurchaseReturn.
   ──────────────────────────────────────────────────────────────────────── */

export const purchaseReturnStatus = pgEnum('purchase_return_status', [
  'DRAFT',       // builder is still adding items
  'POSTED',      // sent to supplier, awaiting confirmation
  'COMPLETED',   // supplier confirmed refund / credit-note
  'CANCELLED',   // returned items kept after all
]);

export const purchaseReturns = pgTable('purchase_returns', {
  id:                uuid('id').primaryKey().defaultRandom(),
  returnNumber:      text('return_number').notNull().unique(),       // 'PRT-2605-001'
  purchaseOrderId:   uuid('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
  grnId:             uuid('grn_id').references(() => grns.id, { onDelete: 'set null' }),
  supplierId:        uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  returnDate:        date('return_date').notNull().defaultNow(),
  reason:            text('reason'),                                 // 'DEFECT'|'WRONG_ITEM'|'OVERSUPPLY'|free text
  status:            purchaseReturnStatus('status').notNull().default('DRAFT'),
  postedAt:          timestamp('posted_at', { withTimezone: true }),
  completedAt:       timestamp('completed_at', { withTimezone: true }),
  creditNoteRef:     text('credit_note_ref'),                        // supplier's CN# once issued
  refundCenti:       integer('refund_centi').notNull().default(0),
  notes:             text('notes'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid('created_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxPo:       index('idx_pr_po').on(t.purchaseOrderId),
  idxSupplier: index('idx_pr_supplier').on(t.supplierId),
  idxStatus:   index('idx_pr_status').on(t.status),
}));

export const purchaseReturnItems = pgTable('purchase_return_items', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  purchaseReturnId:      uuid('purchase_return_id').notNull().references(() => purchaseReturns.id, { onDelete: 'cascade' }),
  grnItemId:             uuid('grn_item_id').references(() => grnItems.id, { onDelete: 'set null' }),
  materialKind:          materialKind('material_kind').notNull(),
  materialCode:          text('material_code').notNull(),
  materialName:          text('material_name').notNull(),
  qtyReturned:           integer('qty_returned').notNull(),
  unitPriceCenti:        integer('unit_price_centi').notNull().default(0),
  lineRefundCenti:       integer('line_refund_centi').notNull().default(0),
  reason:                text('reason'),                             // per-line reason if mixed
  notes:                 text('notes'),
  /* PR #42 — variant fields (migration 0057) */
  gapInches:             integer('gap_inches'),
  divanHeightInches:     integer('divan_height_inches'),
  divanPriceSen:         integer('divan_price_sen').notNull().default(0),
  legHeightInches:       integer('leg_height_inches'),
  legPriceSen:           integer('leg_price_sen').notNull().default(0),
  customSpecials:        jsonb('custom_specials'),
  lineSuffix:            text('line_suffix'),
  specialOrderPriceSen:  integer('special_order_price_sen').notNull().default(0),
  variants:              jsonb('variants'),
  itemGroup:             text('item_group'),
  description:           text('description'),
  description2:          text('description2'),
  uom:                   text('uom').notNull().default('UNIT'),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxPr: index('idx_pr_items_pr').on(t.purchaseReturnId),
}));

/* ════════════════════════════════════════════════════════════════════════
   Manufacturing modules — ported from HOOKKA ERP (2026-05-24)
   ────────────────────────────────────────────────────────────────────────
   Coexists with retail `products` table:
   - `products`     — retail catalogue (sofa per-Model pricing, size variants)
   - `mfg_products` — manufacturer SKUs (BOM hierarchy, dept working times)
   Bridge: `mfg_products.retail_product_id` (nullable) links a mfg SKU to
   the retail listing when both exist.
   Money in this section uses INTEGER `_sen` (1 sen = RM 0.01) to match
   HOOKKA conventions and preserve precision on multi-component pricing.
   ════════════════════════════════════════════════════════════════════════ */

export const mfgProductCategory = pgEnum('mfg_product_category', [
  'SOFA', 'BEDFRAME', 'ACCESSORY', 'MATTRESS', 'SERVICE',
]);

export const mfgProductStatus = pgEnum('mfg_product_status', [
  'ACTIVE', 'INACTIVE',
]);

export const fabricCategory = pgEnum('fabric_category', [
  'B.M-FABR', 'S-FABR', 'S.M-FABR', 'LINING', 'WEBBING',
]);

export const fabricPriceTier = pgEnum('fabric_price_tier', [
  'PRICE_1', 'PRICE_2', 'PRICE_3',
]);

export const maintenanceConfigScope = pgEnum('maintenance_config_scope', [
  'master',     // company-wide baseline
  'customer',   // per-customer override (key is 'customer:<uuid>' in code)
]);

/* ─────────────────────────── mfg_products ──────────────────────────────
   Manufacturer SKU master. One row per (model × size) variant — e.g.
   HILTON bedframe has 5 size rows (K/Q/S/SS/SK) and HILTON(A) is another
   model with its own 5 size rows. `base_model = '1003'` groups them.

   Pricing scheme: two-tier price1/price2 driven by fabric.priceTier.
   Surcharges from Maintenance config (divan/leg/gap/specials) stack on top.
   ──────────────────────────────────────────────────────────────────────── */

export const mfgProducts = pgTable('mfg_products', {
  id:                     text('id').primaryKey(),
  code:                   text('code').notNull(),                 // '1003-(K)', '1003(A)-(Q)'
  name:                   text('name').notNull(),                 // 'HILTON BEDFRAME (6FT)'
  category:               mfgProductCategory('category').notNull(),
  description:            text('description'),
  baseModel:              text('base_model'),                     // '1003' — groups size variants
  sizeCode:               text('size_code'),                      // 'K','Q','S','SS','SK','SP'
  sizeLabel:              text('size_label'),                     // '6FT','5FT','200CMX200CM'
  fabricUsage:            integer('fabric_usage_centi').notNull().default(0), // meters × 100 (e.g. 4.5m = 450)
  unitM3:                 integer('unit_m3_milli').notNull().default(0),      // m³ × 1000 (e.g. 0.953 = 953)
  status:                 mfgProductStatus('status').notNull().default('ACTIVE'),
  costPriceSen:           integer('cost_price_sen').notNull().default(0),
  basePriceSen:           integer('base_price_sen'),              // PRICE 2 (default)
  price1Sen:              integer('price1_sen'),                  // PRICE 1 (cheaper tier)
  productionTimeMinutes:  integer('production_time_minutes').notNull().default(0),
  subAssemblies:          jsonb('sub_assemblies'),                // string[] e.g. ['Divan','Headboard']
  skuCode:                text('sku_code'),
  fabricColor:            text('fabric_color'),
  // Free-text brand label — used mainly for MATTRESS SKUs (Sealy / King Koil /
  // Dunlopillo / etc.). Shown as a dedicated column on the Mattress filter
  // view; available for other categories too if useful.
  branding:               text('branding'),
  pieces:                 jsonb('pieces'),                        // { count, names: string[] }
  seatHeightPrices:       jsonb('seat_height_prices'),            // [{height,priceSen}]
  defaultVariants:        jsonb('default_variants'),              // {fabricCode,divanHeight,legHeight,gap,specials}
  retailProductId:        uuid('retail_product_id').references(() => products.id, { onDelete: 'set null' }),
  // PR #49 — FK to product_models (the "template" second layer that owns
  // allowed-options per Model). `base_model` text stays as a denormalized
  // mirror so existing Model-filter chips keep working without joining.
  modelId:                uuid('model_id').references(() => productModels.id, { onDelete: 'set null' }),
  createdAt:              timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:              timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxCode:     index('idx_mfg_products_code').on(t.code),
  idxCategory: index('idx_mfg_products_category').on(t.category),
  idxBase:     index('idx_mfg_products_base_model').on(t.baseModel),
  idxModelId:  index('idx_mfg_products_model_id').on(t.modelId),
}));

/* ─────────────────────────── product_models ─────────────────────────────
   PR #49 — Template / second-layer entity that owns the allowed-options
   pool per Model. Each SKU on mfg_products keeps its own row (separate
   code, stock, cost, pricing) — Model only carries the shared template.

   allowed_options JSONB shape is category-specific (see migration 0062
   header for the per-category schema). Empty `{}` = no restriction yet
   (UI falls back to global maintenance_config pool).
   ────────────────────────────────────────────────────────────────────────── */
export const productModels = pgTable('product_models', {
  id:             uuid('id').primaryKey().defaultRandom(),
  // PR #65 — Branding required at the Model level (Commander 2026-05-26).
  // Drives the SKU-name template: "HILTON BEDFRAME (6FT)" uses branding=HILTON,
  // category=BEDFRAME, size_label=6FT. UI enforces non-empty before create.
  branding:       text('branding'),
  modelCode:      text('model_code').notNull(),
  name:           text('name').notNull(),
  category:       mfgProductCategory('category').notNull(),
  description:    text('description'),
  photoUrl:       text('photo_url'),
  allowedOptions: jsonb('allowed_options').notNull().default({}),
  active:         boolean('active').notNull().default(true),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqCodeCategory: uniqueIndex('product_models_code_category_unique').on(t.modelCode, t.category),
  idxCategory:      index('idx_product_models_category').on(t.category),
}));

/* ─────────────────────────── product_dept_configs ──────────────────────
   Per-product working time defaults across the 8-department production
   flow. Sourced from HOOKKA's Production Sheet; one row per SKU code.
   ──────────────────────────────────────────────────────────────────────── */

export const productDeptConfigs = pgTable('product_dept_configs', {
  productCode:           text('product_code').primaryKey(),
  unitM3Milli:           integer('unit_m3_milli').notNull().default(0),
  fabricUsageCenti:      integer('fabric_usage_centi').notNull().default(0),
  price2Sen:             integer('price2_sen').notNull().default(0),
  fabCutCategory:        text('fab_cut_category'),
  fabCutMinutes:         integer('fab_cut_minutes'),
  fabSewCategory:        text('fab_sew_category'),
  fabSewMinutes:         integer('fab_sew_minutes'),
  woodCutCategory:       text('wood_cut_category'),
  woodCutMinutes:        integer('wood_cut_minutes'),
  foamCategory:          text('foam_category'),
  foamMinutes:           integer('foam_minutes'),
  framingCategory:       text('framing_category'),
  framingMinutes:        integer('framing_minutes'),
  upholsteryCategory:    text('upholstery_category'),
  upholsteryMinutes:     integer('upholstery_minutes'),
  packingCategory:       text('packing_category'),
  packingMinutes:        integer('packing_minutes'),
  subAssemblies:         jsonb('sub_assemblies'),
  heightsSubAssemblies:  jsonb('heights_sub_assemblies'),
});

/* ─────────────────────────── fabrics ───────────────────────────────────
   Simple fabric master. fabric_trackings is the richer analytics layer
   with price tier + stock metrics.
   ──────────────────────────────────────────────────────────────────────── */

export const fabrics = pgTable('fabrics', {
  id:            text('id').primaryKey(),
  code:          text('code').notNull().unique(),
  name:          text('name').notNull(),
  category:      text('category'),
  priceSen:      integer('price_sen').notNull().default(0),
  sohMeters:     integer('soh_meters_centi').notNull().default(0),    // meters × 100
  reorderLevel:  integer('reorder_level_centi').notNull().default(0), // meters × 100
});

export const fabricTrackings = pgTable('fabric_trackings', {
  id:                   text('id').primaryKey(),
  fabricCode:           text('fabric_code').notNull(),
  fabricDescription:    text('fabric_description'),
  fabricCategory:       fabricCategory('fabric_category'),
  // Legacy single tier — kept for back-compat. New code reads the split
  // columns below and falls back to this when both are NULL.
  priceTier:            fabricPriceTier('price_tier'),
  // Per-context tiers (migration 0040). sofa_price_tier covers SOFA AND
  // ACCESSORY contexts; bedframe_price_tier covers BEDFRAME only.
  sofaPriceTier:        fabricPriceTier('sofa_price_tier'),
  bedframePriceTier:    fabricPriceTier('bedframe_price_tier'),
  priceCenti:           integer('price_centi').notNull().default(0),       // RM × 100
  sohCenti:             integer('soh_centi').notNull().default(0),
  poOutstandingCenti:   integer('po_outstanding_centi').notNull().default(0),
  lastMonthUsageCenti:  integer('last_month_usage_centi').notNull().default(0),
  oneWeekUsageCenti:    integer('one_week_usage_centi').notNull().default(0),
  twoWeeksUsageCenti:   integer('two_weeks_usage_centi').notNull().default(0),
  oneMonthUsageCenti:   integer('one_month_usage_centi').notNull().default(0),
  shortageCenti:        integer('shortage_centi').notNull().default(0),
  reorderPointCenti:    integer('reorder_point_centi').notNull().default(0),
  supplier:             text('supplier'),
  // Supplier's own SKU/code for this fabric. Used when we send a PO to the
  // supplier — the printed line item shows THEIR code, not our internal
  // fabric_code (HOOKKA's two-code mapping pattern). Single supplier per
  // fabric; multi-supplier needs supplier_material_bindings.
  supplierCode:         text('supplier_code'),
  leadTimeDays:         integer('lead_time_days').notNull().default(0),
  // Migration 0063 — collection name (free text, e.g. "KOONA VELVET H2O").
  series:               text('series'),
}, (t) => ({
  idxCode:   index('idx_fabric_trackings_code').on(t.fabricCode),
  idxTier:   index('idx_fabric_trackings_tier').on(t.priceTier),
  idxSeries: index('idx_fabric_trackings_series').on(t.series).where(sql`${t.series} IS NOT NULL`),
}));

/* ─────────────────────────── maintenance_config_history ────────────────
   Variant config (Divan/Total/Gap/Leg/Specials for Bedframe; Sizes/Leg/
   Specials for Sofa; Fabrics for Common) stored as JSONB with
   effective-date versioning. Append-only — edits are new rows.

   scope encoding:
     'master'           — company-wide baseline
     'customer:<uuid>'  — per-customer override (encoded as TEXT for
                          flexibility; resolver uses LIKE 'customer:%')
   ──────────────────────────────────────────────────────────────────────── */

export const maintenanceConfigHistory = pgTable('maintenance_config_history', {
  id:             text('id').primaryKey(),                       // 'mch-<12hex>'
  scope:          text('scope').notNull(),                       // 'master' | 'customer:<uuid>'
  config:         jsonb('config').notNull(),                     // MaintenanceConfig shape
  effectiveFrom:  date('effective_from').notNull(),
  notes:          text('notes'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
}, (t) => ({
  idxScopeEff: index('idx_mch_scope_eff').on(t.scope, t.effectiveFrom),
}));

/* ─────────────────────────── master_price_history ──────────────────────
   Per-SKU price change audit (base/price1/cost). Driven by the History
   icon in the SKU Master table.
   ──────────────────────────────────────────────────────────────────────── */

export const masterPriceHistory = pgTable('master_price_history', {
  id:           uuid('id').primaryKey().defaultRandom(),
  productCode:  text('product_code').notNull(),
  field:        text('field').notNull(),         // 'base_price_sen' | 'price1_sen' | 'cost_price_sen'
  oldValueSen:  integer('old_value_sen'),
  newValueSen:  integer('new_value_sen'),
  reason:       text('reason'),
  changedAt:    timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  changedBy:    uuid('changed_by').references(() => staff.id, { onDelete: 'set null' }),
}, (t) => ({
  idxCode: index('idx_mph_code').on(t.productCode),
}));

/* ─────────────────────────── Type helpers ───────────────────────────── */

export type Staff             = typeof staff.$inferSelect;
export type NewStaff          = typeof staff.$inferInsert;
export type Showroom          = typeof showrooms.$inferSelect;
export type NewShowroom       = typeof showrooms.$inferInsert;
export type Product           = typeof products.$inferSelect;
export type NewProduct        = typeof products.$inferInsert;
export type Order             = typeof orders.$inferSelect;
export type NewOrder          = typeof orders.$inferInsert;
export type OrderItem         = typeof orderItems.$inferSelect;
export type NewOrderItem      = typeof orderItems.$inferInsert;
export type Quote             = typeof quotes.$inferSelect;
export type NewQuote          = typeof quotes.$inferInsert;
export type Payment           = typeof payments.$inferSelect;
export type NewPayment        = typeof payments.$inferInsert;
export type PendingSlipUpload = typeof pendingSlipUploads.$inferSelect;
export type NewPendingSlipUpload = typeof pendingSlipUploads.$inferInsert;
export type MyLocality        = typeof myLocalities.$inferSelect;
export type AppConfig         = typeof appConfig.$inferSelect;
export type OrderLane         = (typeof orderLane.enumValues)[number];
export type SlipState         = (typeof slipState.enumValues)[number];
export type SlipUploadStatus  = (typeof slipUploadStatus.enumValues)[number];
export type PaymentKind       = (typeof paymentKind.enumValues)[number];
export type PricingKind       = (typeof pricingKind.enumValues)[number];
export type StaffRole         = (typeof staffRole.enumValues)[number];

/* Sofa fabric & colour (spec 2026-05-24) */
export type FabricLibraryRow    = typeof fabricLibrary.$inferSelect;
export type NewFabricLibraryRow = typeof fabricLibrary.$inferInsert;
export type FabricColourRow     = typeof fabricColours.$inferSelect;
export type NewFabricColourRow  = typeof fabricColours.$inferInsert;
export type ProductFabricRow    = typeof productFabrics.$inferSelect;
export type NewProductFabricRow = typeof productFabrics.$inferInsert;

/* Manufacturing module types (HOOKKA port) */
export type MfgProduct               = typeof mfgProducts.$inferSelect;
export type NewMfgProduct            = typeof mfgProducts.$inferInsert;
export type ProductDeptConfig        = typeof productDeptConfigs.$inferSelect;
export type NewProductDeptConfig     = typeof productDeptConfigs.$inferInsert;
export type Fabric                   = typeof fabrics.$inferSelect;
export type NewFabric                = typeof fabrics.$inferInsert;
export type FabricTracking           = typeof fabricTrackings.$inferSelect;
export type NewFabricTracking        = typeof fabricTrackings.$inferInsert;
export type MaintenanceConfigRow     = typeof maintenanceConfigHistory.$inferSelect;
export type NewMaintenanceConfigRow  = typeof maintenanceConfigHistory.$inferInsert;
export type MasterPriceHistoryRow    = typeof masterPriceHistory.$inferSelect;
export type NewMasterPriceHistoryRow = typeof masterPriceHistory.$inferInsert;

/* ════════════════════════════════════════════════════════════════════════
   Inventory — trading-company model (commander 2026-05-25)
   2 warehouses (KL + 2990 PJ). GRN-post / Consignment-RETURN = IN.
   DO-dispatch / Purchase-Return / Consignment-OUT = OUT.
   Balance per (warehouse, product) = SUM(movements) — exposed via the
   inventory_balances VIEW (defined in 0050 migration; not in Drizzle).
   ════════════════════════════════════════════════════════════════════════ */

export const inventoryMovementType = pgEnum('inventory_movement_type', [
  'IN', 'OUT', 'ADJUSTMENT', 'TRANSFER',
]);

export const warehouses = pgTable('warehouses', {
  id:         uuid('id').primaryKey().defaultRandom(),
  code:       text('code').notNull().unique(),    // 'KL', 'PJ'
  name:       text('name').notNull(),
  location:   text('location'),
  isActive:   boolean('is_active').notNull().default(true),
  isDefault:  boolean('is_default').notNull().default(false),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxActive: index('idx_warehouses_active').on(t.isActive),
}));

/* PR #158 — Migration 0071. Commander 2026-05-27: "什么 State 对应哪个
   Warehouse 也需要设置清楚". One row per Malaysian state mapping to the
   warehouse that handles dispatch for that region. Used by SO routing +
   DO hub picking. */
export const stateWarehouseMappings = pgTable('state_warehouse_mappings', {
  id:          uuid('id').primaryKey().defaultRandom(),
  state:       text('state').notNull().unique(),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),
  notes:       text('notes'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryMovements = pgTable('inventory_movements', {
  id:             uuid('id').primaryKey().defaultRandom(),
  movementType:   inventoryMovementType('movement_type').notNull(),
  warehouseId:    uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }),
  productCode:    text('product_code').notNull(),
  productName:    text('product_name'),
  qty:            integer('qty').notNull(),
  /* PR #37 — per-unit cost in sen. IN: provided by caller (from GRN/PI).
     OUT: computed by the FIFO trigger from consumed lots. */
  unitCostSen:    integer('unit_cost_sen').default(0),
  totalCostSen:   integer('total_cost_sen').default(0),
  sourceDocType:  text('source_doc_type'),  // 'GRN' | 'DO' | 'CONSIGNMENT_NOTE' | 'PURCHASE_RETURN' | 'ADJUSTMENT'
  sourceDocId:    uuid('source_doc_id'),
  sourceDocNo:    text('source_doc_no'),
  notes:          text('notes'),
  performedBy:    uuid('performed_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxWarehouseProduct: index('idx_inv_mov_warehouse_product').on(t.warehouseId, t.productCode),
  idxDoc:              index('idx_inv_mov_doc').on(t.sourceDocType, t.sourceDocId),
  idxCreated:          index('idx_inv_mov_created').on(t.createdAt),
}));

/* PR #37 — FIFO lots (one row per IN) + consumptions (FIFO consumes per OUT).
   The DB-side trigger fn_inventory_movement_fifo() maintains these. */
export const inventoryLots = pgTable('inventory_lots', {
  id:             uuid('id').primaryKey().defaultRandom(),
  warehouseId:    uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }),
  productCode:    text('product_code').notNull(),
  productName:    text('product_name'),
  qtyReceived:    integer('qty_received').notNull(),
  qtyRemaining:   integer('qty_remaining').notNull(),
  unitCostSen:    integer('unit_cost_sen').notNull().default(0),
  receivedAt:     timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  sourceDocType:  text('source_doc_type'),
  sourceDocId:    uuid('source_doc_id'),
  sourceDocNo:    text('source_doc_no'),
  movementId:     uuid('movement_id'),
  notes:          text('notes'),
  createdBy:      uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxWhProduct: index('idx_inv_lots_wh_product').on(t.warehouseId, t.productCode, t.receivedAt),
}));

export const inventoryLotConsumptions = pgTable('inventory_lot_consumptions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  lotId:          uuid('lot_id').notNull().references(() => inventoryLots.id, { onDelete: 'cascade' }),
  warehouseId:    uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }),
  productCode:    text('product_code').notNull(),
  qtyConsumed:    integer('qty_consumed').notNull(),
  unitCostSen:    integer('unit_cost_sen').notNull(),
  totalCostSen:   integer('total_cost_sen').notNull(),
  consumedAt:     timestamp('consumed_at', { withTimezone: true }).notNull().defaultNow(),
  sourceDocType:  text('source_doc_type'),
  sourceDocId:    uuid('source_doc_id'),
  sourceDocNo:    text('source_doc_no'),
  movementId:     uuid('movement_id'),
  createdBy:      uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
}, (t) => ({
  idxLot:      index('idx_inv_cons_lot').on(t.lotId),
  idxDoc:      index('idx_inv_cons_doc').on(t.sourceDocType, t.sourceDocId),
  idxConsumed: index('idx_inv_cons_consumed').on(t.consumedAt),
}));

/* MaintenanceConfig — the JSON blob shape stored in maintenanceConfigHistory.config */
export type PricedOption = { value: string; priceSen: number };
export type MaintenanceConfig = {
  divanHeights:   PricedOption[];   // Bedframe
  legHeights:     PricedOption[];   // Bedframe
  totalHeights:   PricedOption[];   // Bedframe (Divan + Gap + Leg)
  gaps:           string[];         // Bedframe — no surcharge
  specials:       PricedOption[];   // Bedframe
  sofaLegHeights: PricedOption[];   // Sofa
  sofaSpecials:   PricedOption[];   // Sofa
  sofaSizes:      string[];         // Sofa — no surcharge
};

/* ════════════════════════════════════════════════════════════════════════
   Accounting — simple double-entry layer
   Migration 0052. Five concepts:
     - accounts (chart of accounts)
     - journal_entries (header)
     - journal_entry_lines (Dr/Cr lines)
     - v_gl_entries (view, flat GL stream)
     - v_account_balances / v_ar_aging / v_ap_aging (views, not modeled here)

   Posting model:
     SI confirm   → Dr AR,        Cr Sales Revenue
     SI payment   → Dr Cash/Bank, Cr AR
     PI confirm   → Dr Inventory, Cr AP
     PI payment   → Dr AP,        Cr Cash/Bank

   PR #36 (Commander "OK A" 2026-05-25) — ERPNext is the conceptual
   reference, not the codebase. Odoo is NOT used (AGPL).
   ════════════════════════════════════════════════════════════════════════ */

export const accounts = pgTable('accounts', {
  id:           uuid('id').primaryKey().defaultRandom(),
  accountCode:  text('account_code').notNull().unique(),
  accountName:  text('account_name').notNull(),
  accountType:  text('account_type').notNull(),     // 'ASSET'|'LIABILITY'|'EQUITY'|'INCOME'|'EXPENSE'
  parentCode:   text('parent_code'),
  isActive:     boolean('is_active').notNull().default(true),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxType: index('idx_accounts_type').on(t.accountType),
}));

export const journalEntries = pgTable('journal_entries', {
  id:             uuid('id').primaryKey().defaultRandom(),
  jeNo:           text('je_no').notNull().unique(),
  entryDate:      date('entry_date').notNull().defaultNow(),
  sourceType:     text('source_type').notNull(),       // 'SI'|'PI'|'SI_PAYMENT'|'PI_PAYMENT'|'MANUAL'
  sourceDocNo:    text('source_doc_no'),
  narration:      text('narration'),
  totalDebitSen:  integer('total_debit_sen').notNull().default(0),
  totalCreditSen: integer('total_credit_sen').notNull().default(0),
  posted:         boolean('posted').notNull().default(false),
  postedAt:       timestamp('posted_at', { withTimezone: true }),
  postedBy:       uuid('posted_by').references(() => staff.id, { onDelete: 'set null' }),
  reversed:       boolean('reversed').notNull().default(false),
  reversedByJe:   uuid('reversed_by_je'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
}, (t) => ({
  idxDate:   index('idx_je_date').on(t.entryDate),
  idxSource: index('idx_je_source').on(t.sourceType, t.sourceDocNo),
  idxPosted: index('idx_je_posted').on(t.posted),
}));

export const journalEntryLines = pgTable('journal_entry_lines', {
  id:              uuid('id').primaryKey().defaultRandom(),
  journalEntryId:  uuid('journal_entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  lineNo:          integer('line_no').notNull(),
  accountCode:     text('account_code').notNull().references(() => accounts.accountCode, { onDelete: 'restrict' }),
  debitSen:        integer('debit_sen').notNull().default(0),
  creditSen:       integer('credit_sen').notNull().default(0),
  partyType:       text('party_type'),       // 'CUSTOMER'|'SUPPLIER'
  partyCode:       text('party_code'),
  partyName:       text('party_name'),
  notes:           text('notes'),
}, (t) => ({
  idxJe:      index('idx_jel_je').on(t.journalEntryId),
  idxAccount: index('idx_jel_account').on(t.accountCode),
  idxParty:   index('idx_jel_party').on(t.partyType, t.partyCode),
}));
