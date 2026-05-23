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

export const suppliers = pgTable('suppliers', {
  id:             uuid('id').primaryKey().defaultRandom(),
  code:           text('code').notNull().unique(),
  name:           text('name').notNull(),
  whatsappNumber: text('whatsapp_number'),
  email:          text('email'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrders = pgTable('purchase_orders', {
  id:         uuid('id').primaryKey().defaultRandom(),
  poNumber:   text('po_number').notNull().unique(),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid('created_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
});

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
