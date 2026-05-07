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
  'credit', 'debit', 'installment', 'transfer',
]);

export const addonKind = pgEnum('addon_kind', [
  'qty',           // simple per-piece (RM × qty)
  'floors_items',  // RM × floors × items (lift access)
  'flat',          // one-shot RM
]);

export const orderItemKind = pgEnum('order_item_kind', [
  'product', 'addon',
]);

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
  postcode:     text('postcode'),
  city:         text('city'),
  state:        text('state'),
  notes:        text('notes'),
  firstSeenAt:  timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt:   timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  phoneIdx: index('idx_customers_phone').on(t.phone),
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
  customerPostcode: text('customer_postcode'),
  customerCity:     text('customer_city'),
  customerState:    text('customer_state'),

  emergencyName:     text('emergency_name'),
  emergencyPhone:    text('emergency_phone'),
  emergencyRelation: text('emergency_relation'),

  customerId: uuid('customer_id').references(() => customers.id),

  // Money (whole RM)
  subtotal:   integer('subtotal').notNull(),
  addonTotal: integer('addon_total').notNull().default(0),
  total:      integer('total').notNull(),
  paid:       integer('paid').notNull().default(0),

  // Payment
  paymentMethod: paymentMethod('payment_method').notNull(),
  approvalCode:  text('approval_code'),

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

  // Dispatch
  driverId:      uuid('driver_id').references(() => drivers.id),
  confirmedWith: text('confirmed_with'),               // 'WhatsApp · 4 May 11:20'
  dispatchedAt:  timestamp('dispatched_at', { withTimezone: true }),
  deliveredAt:   timestamp('delivered_at', { withTimezone: true }),
  doSigned:      boolean('do_signed').notNull().default(false),

  notes:     text('notes'),
  stockNote: text('stock_note'),

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

  // Sofa configuration JSONB (only when product is a sofa Model)
  // Shape: { depth: '24'|'28', mode: 'preset'|'custom',
  //          presetId?, modules: [{id, rot, recliners}], orientation? }
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
export type OrderLane         = (typeof orderLane.enumValues)[number];
export type SlipState         = (typeof slipState.enumValues)[number];
export type PricingKind       = (typeof pricingKind.enumValues)[number];
export type StaffRole         = (typeof staffRole.enumValues)[number];
