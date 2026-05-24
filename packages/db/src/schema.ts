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
  primaryKey, index, check,
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
  'size_variants',  // mattress, bedframe — priced by size
  'sofa_build',     // sofa — priced by compartments + bundles + recliner
  'flat',           // single fixed price
  'tbc',            // not yet priced (TBC categories)
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
    (${t.pricingKind} IN ('size_variants','tbc'))
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
  code:           text('code').notNull().unique(),
  name:           text('name').notNull(),
  whatsappNumber: text('whatsapp_number'),
  email:          text('email'),
  // HOOKKA-port fields (migration 0041): full master record for purchasing.
  contactPerson:  text('contact_person'),
  phone:          text('phone'),
  address:        text('address'),
  state:          text('state'),
  paymentTerms:   text('payment_terms'),                  // free-form 'NET 30', 'COD'
  status:         supplierStatus('status').notNull().default('ACTIVE'),
  rating:         integer('rating').notNull().default(0), // 0-5 scale
  notes:          text('notes'),
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
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxPo: index('idx_po_items_po').on(t.purchaseOrderId),
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
  'SOFA', 'BEDFRAME', 'ACCESSORY',
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
  pieces:                 jsonb('pieces'),                        // { count, names: string[] }
  seatHeightPrices:       jsonb('seat_height_prices'),            // [{height,priceSen}]
  defaultVariants:        jsonb('default_variants'),              // {fabricCode,divanHeight,legHeight,gap,specials}
  retailProductId:        uuid('retail_product_id').references(() => products.id, { onDelete: 'set null' }),
  createdAt:              timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:              timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxCode:     index('idx_mfg_products_code').on(t.code),
  idxCategory: index('idx_mfg_products_category').on(t.category),
  idxBase:     index('idx_mfg_products_base_model').on(t.baseModel),
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
  leadTimeDays:         integer('lead_time_days').notNull().default(0),
}, (t) => ({
  idxCode: index('idx_fabric_trackings_code').on(t.fabricCode),
  idxTier: index('idx_fabric_trackings_tier').on(t.priceTier),
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
