# 2990's Portal — Production Build Plan

> 从 Claude Design prototype 升级到 production stack
> Vite + RR7 + Hono on Cloudflare + Supabase + R2

**Status:** Plan v1 · Pre-build review
**Stack pattern:** Same as Carres Portal V2 (pnpm monorepo, apps/web, apps/api, packages/shared)
**Region:** Cloudflare global edge · Supabase Singapore (matches Venture Portal `gixpptmfuryskbwkmiwz`)

---

## 1. Executive summary

Two consumer-facing apps + one shared API, single Supabase database. Key architectural choice: **POS and Backend are SEPARATE deployments** sharing the same API and design system. Different bundle, different domain, different security profile, but identical brand.

| App | Audience | Device | URL (proposed) | Bundle |
|---|---|---|---|---|
| **POS** | Sales staff (4 roles: AW, JM, RL, SN) | Tablet primary, desktop counter, phone for home visits | `pos.2990s.com.my` | ~250KB gzip |
| **Backend** | Order Coordinator (Mei Lin) + future Finance/Owner | Desktop primary, tablet OK | `admin.2990s.com.my` | ~300KB gzip |
| **API** | Both apps | CF Workers global edge | `api.2990s.com.my` | ~50KB Worker |

**Three core data flows** the schema must support:
1. **Catalog**: Backend writes pricing → POS reads (with per-Model sofa pricing + size variants)
2. **Order**: POS creates → Backend receives via Supabase Realtime → Backend transitions through 6 lanes
3. **Slip**: POS uploads to R2 → Backend Coordinator verifies → Finance approves later (Phase 4)

---

## 2. Architecture

```
┌─────────────────────┐    ┌─────────────────────┐
│   POS app (Vite)    │    │  Backend app (Vite) │
│  Salesperson tool   │    │  Coordinator portal │
│   CF Pages          │    │   CF Pages          │
└──────────┬──────────┘    └──────────┬──────────┘
           │                          │
           │      JWT (Supabase Auth) │
           └────────────┬─────────────┘
                        │
                        ▼
           ┌─────────────────────────┐
           │   API (Hono on Workers) │
           │   apps/api              │
           │   Cloudflare global     │
           └────────┬────────────────┘
                    │
        ┌───────────┼───────────────┐
        ▼           ▼               ▼
  ┌─────────┐  ┌─────────┐    ┌─────────┐
  │Supabase │  │   R2    │    │Supabase │
  │Postgres │  │  (slips,│    │Realtime │
  │         │  │  photos)│    │ (orders)│
  └─────────┘  └─────────┘    └─────────┘
```

**Why split POS and Backend into 2 apps:**
- Different security profiles (sales staff PIN auth vs Coordinator email auth)
- Different bundle sizes (POS doesn't need SKU Master code; Backend doesn't need configurator)
- Different update cycles (POS is hands-on critical, Backend can be patched freely)
- Different domains for clean security boundary

**Why Hono on CF Workers (not direct Supabase from frontend):**
- Server-side validation of pricing math (POS can't be trusted to compute totals)
- R2 signed URL generation (slip uploads)
- Webhook target for future integrations (payment terminals, WhatsApp)
- Rate limiting / audit logging hub

---

## 3. Tech stack

| Layer | Choice | Why this not the alternative |
|---|---|---|
| Frontend framework | **Vite 6 + React 19 + RR7** | Same as Carres Portal V2. CF Pages first-class support. |
| Language | **TypeScript strict** | Catches the per-model pricing structure mismatches early |
| Styling | **CSS Modules + design tokens** | Matches existing `colors_and_type.css`. Avoid Tailwind here — the brand tokens are richer than Tailwind's defaults |
| Icons | **Lucide React** | Brand spec mandates Lucide rounded; 1.75 stroke is built-in |
| State | **Zustand** for app state, **TanStack Query** for server state | Matches Carres pattern; no Redux overkill |
| Forms | **React Hook Form + Zod** | Schema-first validation, shared with API |
| Backend framework | **Hono** on CF Workers | Same as Carres Portal V2. ~14KB runtime |
| Database | **Supabase Postgres** (Singapore) | Same provider/region as Venture Portal |
| ORM | **Drizzle** | Same as Carres Portal V2. SQL-first, edge-runtime safe |
| Auth | **Supabase Auth** (email + magic link) | For staff. POS adds PIN layer on top for fast counter switching |
| File storage | **Cloudflare R2** | ~5–10× cheaper than Supabase Storage for photos + slips |
| Realtime | **Supabase Realtime** | Replaces the prototype's localStorage bridge |
| Monorepo | **pnpm workspace + Turborepo** | Same as Carres |
| Deploy | CF Pages (apps) + CF Workers (api) + GitHub Actions | Same as Carres |
| Testing | **Vitest** unit, **Playwright** for the order flow | E2E coverage on the critical path (POS order → Backend received) is non-negotiable |

⚠️ **One thing NOT chosen and why:** Next.js. Same reasoning as Carres Portal V2 — Vite + CF is ~5–10× cheaper for predictable internal traffic, and we don't need Next's SSR for POS/admin tools.

---

## 4. Repository structure

```
2990s-portal/
├── apps/
│   ├── pos/                        # Salesperson POS (Vite SPA)
│   │   ├── src/
│   │   │   ├── routes/             # RR7 file-based
│   │   │   │   ├── _index.tsx     # Login (PIN pad)
│   │   │   │   ├── pos._index.tsx # Catalog
│   │   │   │   ├── pos.config.$productId.tsx  # Configurator
│   │   │   │   ├── pos.cart.tsx
│   │   │   │   ├── pos.customer.tsx
│   │   │   │   ├── pos.payment.tsx
│   │   │   │   └── pos.confirmed.$orderId.tsx
│   │   │   ├── components/
│   │   │   │   ├── catalog/
│   │   │   │   ├── configurator/   # SofaConfigurator, MattressPicker, BedframePicker
│   │   │   │   └── checkout/
│   │   │   ├── lib/
│   │   │   │   ├── api.ts          # TanStack Query hooks
│   │   │   │   ├── auth.ts
│   │   │   │   └── pricing.ts      # Client-side pricing math (mirrors API)
│   │   │   └── main.tsx
│   │   ├── public/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── wrangler.toml           # CF Pages
│   │   └── package.json
│   │
│   ├── backend/                    # Order Coordinator portal
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── _index.tsx      # Login
│   │   │   │   ├── be._index.tsx   # Dashboard
│   │   │   │   ├── be.orders.tsx
│   │   │   │   ├── be.orders.$id.tsx  # Drawer detail
│   │   │   │   ├── be.verify.tsx
│   │   │   │   ├── be.skus._index.tsx  # SKU Master
│   │   │   │   ├── be.skus.$id.tsx     # SKU edit drawer
│   │   │   │   ├── be.addons.tsx
│   │   │   │   ├── be.customers.tsx
│   │   │   │   └── be.settings.tsx
│   │   │   ├── components/
│   │   │   │   ├── orders/         # OrdersBoard, OrderDrawer, LaneTransition
│   │   │   │   ├── sku/            # SkuTable, SkuDrawer, PricingEditor
│   │   │   │   └── verify/
│   │   │   ├── lib/
│   │   │   │   ├── api.ts
│   │   │   │   ├── realtime.ts     # Supabase Realtime subscriber
│   │   │   │   └── auth.ts
│   │   │   └── main.tsx
│   │   └── (same structure)
│   │
│   └── api/                        # Hono on CF Workers
│       ├── src/
│       │   ├── routes/
│       │   │   ├── products.ts     # GET/POST/PATCH/DELETE
│       │   │   ├── orders.ts       # POS posts here, Backend reads
│       │   │   ├── addons.ts
│       │   │   ├── staff.ts
│       │   │   ├── drivers.ts
│       │   │   ├── customers.ts
│       │   │   └── uploads.ts      # R2 signed URLs
│       │   ├── middleware/
│       │   │   ├── auth.ts         # Verify Supabase JWT
│       │   │   ├── rls.ts          # Set Postgres role for RLS
│       │   │   └── audit.ts
│       │   ├── lib/
│       │   │   ├── db.ts           # Drizzle client
│       │   │   ├── r2.ts           # R2 binding helpers
│       │   │   └── pricing.ts      # SERVER-SIDE source-of-truth pricing math
│       │   └── index.ts
│       ├── wrangler.toml
│       └── package.json
│
├── packages/
│   ├── shared/                     # Cross-app types & constants
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── product.ts      # Product, Pricing types
│   │   │   │   ├── order.ts        # Order, OrderItem, Lane types
│   │   │   │   └── index.ts
│   │   │   ├── schemas/            # Zod validators (forms + API)
│   │   │   │   ├── product.schema.ts
│   │   │   │   ├── order.schema.ts
│   │   │   │   └── index.ts
│   │   │   ├── constants/
│   │   │   │   ├── lanes.ts        # 6 lanes definition
│   │   │   │   ├── compartments.ts # 13 sofa compartments library
│   │   │   │   ├── bundles.ts      # 5 sofa bundles library
│   │   │   │   ├── sizes.ts        # 4 mattress/bedframe sizes
│   │   │   │   └── categories.ts
│   │   │   └── pricing.ts          # PURE pricing math, mirrored client + server
│   │   └── package.json
│   │
│   ├── design-system/              # Brand tokens + UI primitives
│   │   ├── src/
│   │   │   ├── tokens.css          # = colors_and_type.css from brand zip
│   │   │   ├── globals.css
│   │   │   ├── components/
│   │   │   │   ├── Button/         # btn--primary, btn--ghost, btn--text
│   │   │   │   ├── Chip/           # chip--ink, chip--ghost, chip--burnt
│   │   │   │   ├── Drawer/
│   │   │   │   ├── FormField/      # Field, PriceInput, Toggle
│   │   │   │   ├── PriceTag/       # the brand's hero element
│   │   │   │   ├── Wordmark/
│   │   │   │   ├── DataTable/
│   │   │   │   └── Banner/
│   │   │   ├── icons.tsx           # Lucide wrappers w/ brand stroke
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── db/                         # Drizzle schema + migrations
│       ├── src/
│       │   ├── schema/
│       │   │   ├── auth.ts         # users, staff, sessions
│       │   │   ├── catalog.ts      # categories, series, products, library tables
│       │   │   ├── pricing.ts      # product_size_variants, _compartments, _bundles
│       │   │   ├── orders.ts       # orders, order_items, lane history
│       │   │   ├── operations.ts   # drivers, addons
│       │   │   └── index.ts
│       │   ├── migrations/         # numbered, never altered after deploy
│       │   ├── seed.ts             # seed staff + libraries
│       │   └── client.ts
│       └── package.json
│
├── .github/workflows/              # CI: lint, test, deploy on main
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
└── README.md
```

---

## 5. Database schema

Core principle: **the catalog tables are normalized so the SKU Master can edit one variant atomically**, without rewriting an entire JSONB blob and risking lost-update races.

### 5.1 ER overview

```
                 ┌─────────────────┐
                 │  staff (auth)   │
                 └────────┬────────┘
                          │
            ┌─────────────┼─────────────────┐
            │             │                 │
            ▼             ▼                 ▼
   ┌──────────────┐  ┌──────────┐   ┌─────────────┐
   │   products   │  │  orders  │   │   drivers   │
   │              │  └────┬─────┘   └─────────────┘
   └──────┬───────┘       │
          │ pricing_kind:  │ has many
   ┌──────┴───────┬──────┐ │
   │              │      │ ▼
   ▼              ▼      ▼ ┌───────────────┐
┌──────────┐ ┌────────┐ ┌──────────┐│ order_items   │
│ sofa     │ │ sofa   │ │ size     ││ (cart + addon)│
│ bundles  │ │ comps  │ │ variants │└───────────────┘
└────┬─────┘ └───┬────┘ └────┬─────┘
     │           │           │
     ▼           ▼           ▼
┌────────────┐┌──────────┐┌──────────┐
│ bundle_lib ││ comp_lib ││ size_lib │  ← seeded global libraries
└────────────┘└──────────┘└──────────┘

   ┌──────────────┐
   │  customers   │  ← optional (Phase 4); orders snapshot most fields
   └──────────────┘
```

### 5.2 Table-by-table

#### `staff` — sales + coordinators + admins

```sql
CREATE TYPE staff_role AS ENUM ('sales','showroom_lead','coordinator','finance','admin');

CREATE TABLE staff (
  id           UUID PRIMARY KEY,             -- = auth.users.id (Supabase)
  staff_code   TEXT UNIQUE NOT NULL,         -- 'AW', 'JM', 'ML', etc.
  name         TEXT NOT NULL,
  role         staff_role NOT NULL,
  pin_hash     TEXT,                         -- bcrypt; only sales need this
  email        TEXT UNIQUE,
  phone        TEXT,
  initials     TEXT NOT NULL,
  color        TEXT NOT NULL,                -- hex (avatar tint)
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Why PIN is on staff (not auth.users): Supabase Auth doesn't have a PIN concept; this is for fast counter switching where a sales staff hands the tablet to another. Coordinators and above use full email+magic-link.

#### Library tables — seeded once, edited rarely

```sql
-- Sofa compartments — the 13-row global library
CREATE TYPE comp_group AS ENUM ('1-seater','2-seater','Corner','L-Shape','Accessory');

CREATE TABLE compartment_library (
  id              TEXT PRIMARY KEY,           -- '1A-L', '1A-R', '1NA', etc
  comp_group      comp_group NOT NULL,
  label           TEXT NOT NULL,
  width_cm        INTEGER NOT NULL,
  depth_cm        INTEGER NOT NULL,
  cushions        INTEGER NOT NULL DEFAULT 1,
  default_price   INTEGER NOT NULL,           -- whole RM
  art_filename    TEXT,                       -- for POS configurator art lookup
  is_accessory    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

-- Sofa bundles — the 5-row global library
CREATE TABLE bundle_library (
  id              TEXT PRIMARY KEY,           -- '1S','2S','3S','2+L','3+L'
  label           TEXT NOT NULL,
  sub             TEXT NOT NULL,
  signature       TEXT NOT NULL,              -- 'family signature' for auto-detect (e.g. '1A+2A')
  base_width_cm   INTEGER NOT NULL,
  base_depth_cm   INTEGER NOT NULL,
  cushions        INTEGER NOT NULL,
  default_price   INTEGER NOT NULL,
  art_left        TEXT,                       -- for L-variant
  art_right       TEXT,
  art_base        TEXT,                       -- for non-L bundles
  sort_order      INTEGER NOT NULL DEFAULT 0
);

-- Mattress / bedframe sizes — the 4-row global library
CREATE TABLE size_library (
  id              TEXT PRIMARY KEY,           -- 'single','super-single','queen','king'
  label           TEXT NOT NULL,
  width_cm        INTEGER NOT NULL,
  length_cm       INTEGER NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id              TEXT PRIMARY KEY,           -- 'mattress','sofa','bedframe',...
  label           TEXT NOT NULL,
  icon            TEXT NOT NULL,              -- lucide icon name
  tbc             BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE series (
  id              TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT TRUE
);
```

#### `products` — the SKU master

```sql
CREATE TYPE pricing_kind AS ENUM ('size_variants','sofa_build','flat','tbc');

CREATE TABLE products (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                      TEXT UNIQUE NOT NULL,        -- 'MAT-001','SOF-101'
  category_id              TEXT NOT NULL REFERENCES categories(id),
  series_id                TEXT REFERENCES series(id),
  pricing_kind             pricing_kind NOT NULL DEFAULT 'tbc',

  name                     TEXT NOT NULL,
  detail                   TEXT,
  size_display             TEXT,                        -- free-text e.g. 'Queen, 152×190'
  img_key                  TEXT,                        -- R2 key for hero image
  thumb_key                TEXT,                        -- thumbnail variant

  stock                    INTEGER NOT NULL DEFAULT 0,
  low_at                   INTEGER NOT NULL DEFAULT 5,
  visible                  BOOLEAN NOT NULL DEFAULT TRUE,

  -- pricing_kind = 'flat' uses this single price column
  flat_price               INTEGER,

  -- pricing_kind = 'sofa_build' uses these
  recliner_upgrade_price   INTEGER,                     -- 0 = disabled

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               UUID REFERENCES staff(id),

  -- constraint: pricing_kind must match what's filled in
  CONSTRAINT pricing_consistency CHECK (
    (pricing_kind = 'flat'         AND flat_price IS NOT NULL) OR
    (pricing_kind = 'sofa_build'   AND recliner_upgrade_price IS NOT NULL) OR
    (pricing_kind IN ('size_variants','tbc'))
  )
);

CREATE INDEX idx_products_visible ON products(visible) WHERE visible = TRUE;
CREATE INDEX idx_products_category ON products(category_id);
```

#### Per-product pricing tables — the heart of the per-Model design

```sql
-- For pricing_kind = 'size_variants' (mattresses, bedframes)
CREATE TABLE product_size_variants (
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size_id      TEXT NOT NULL REFERENCES size_library(id),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  price        INTEGER NOT NULL,                       -- whole RM
  PRIMARY KEY (product_id, size_id)
);

-- For pricing_kind = 'sofa_build' (sofa Models)
CREATE TABLE product_compartments (
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  compartment_id    TEXT NOT NULL REFERENCES compartment_library(id),
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  price             INTEGER NOT NULL,
  PRIMARY KEY (product_id, compartment_id)
);

-- For pricing_kind = 'sofa_build' (sofa Models)
CREATE TABLE product_bundles (
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  bundle_id    TEXT NOT NULL REFERENCES bundle_library(id),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  price        INTEGER NOT NULL,
  PRIMARY KEY (product_id, bundle_id)
);
```

**Why composite PK instead of surrogate id:** `(product_id, size_id)` is the natural key; surrogate id adds nothing here and `ON CONFLICT (product_id, size_id) DO UPDATE` makes UPSERT clean.

#### `addons` — disposal, lift, assembly, etc

```sql
CREATE TYPE addon_kind AS ENUM ('qty','floors_items','flat');

CREATE TABLE addons (
  id              TEXT PRIMARY KEY,                    -- 'dispose-mattress','lift'
  label           TEXT NOT NULL,
  description     TEXT,
  icon            TEXT NOT NULL,
  kind            addon_kind NOT NULL,
  price           INTEGER NOT NULL,                    -- whole RM
  per_floor_item  INTEGER,                             -- only for kind='floors_items'
  unit            TEXT,                                -- 'piece','floor·item','set'
  default_qty     INTEGER NOT NULL DEFAULT 1,
  stock           INTEGER,                             -- NULL = unlimited
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Orders — the 6-lane workflow

```sql
CREATE TYPE order_lane AS ENUM ('received','proceed','logistics','ready','dispatched','delivered');
CREATE TYPE slip_state AS ENUM ('none','pending','verified','flagged');
CREATE TYPE payment_method AS ENUM ('credit','debit','installment','transfer');

CREATE TABLE orders (
  id                   TEXT PRIMARY KEY,                -- 'SO-2045' — human-readable
  placed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  staff_id             UUID NOT NULL REFERENCES staff(id),

  lane                 order_lane NOT NULL DEFAULT 'received',

  -- Customer snapshot (denormalised on purpose — orders survive customer edits)
  customer_name        TEXT NOT NULL,
  customer_phone       TEXT,
  customer_email       TEXT,
  customer_address     TEXT,
  customer_postcode    TEXT,
  customer_city        TEXT,
  customer_state       TEXT,

  emergency_name       TEXT,
  emergency_phone      TEXT,
  emergency_relation   TEXT,

  customer_id          UUID REFERENCES customers(id),   -- nullable, optional Phase 4

  -- Money (whole RM)
  subtotal             INTEGER NOT NULL,
  addon_total          INTEGER NOT NULL DEFAULT 0,
  total                INTEGER NOT NULL,                -- subtotal + addon_total
  paid                 INTEGER NOT NULL DEFAULT 0,

  -- Payment
  payment_method       payment_method NOT NULL,
  approval_code        TEXT,

  -- Slip
  slip_state           slip_state NOT NULL DEFAULT 'none',
  slip_key             TEXT,                            -- R2 key
  slip_verified_by     UUID REFERENCES staff(id),
  slip_verified_at     TIMESTAMPTZ,
  slip_flag_reason     TEXT,

  -- Delivery
  delivery_date        DATE,
  delivery_slot        TEXT,                            -- '09:00 – 12:00'
  delivery_tbd         BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_notes       TEXT,

  -- Dispatch
  driver_id            UUID REFERENCES drivers(id),
  confirmed_with       TEXT,                            -- 'WhatsApp · 4 May 11:20'
  dispatched_at        TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  do_signed            BOOLEAN NOT NULL DEFAULT FALSE,

  notes                TEXT,
  stock_note           TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_lane ON orders(lane);
CREATE INDEX idx_orders_slip_state ON orders(slip_state) WHERE slip_state IN ('pending','flagged');
CREATE INDEX idx_orders_placed_at ON orders(placed_at DESC);
```

**Why `id TEXT` not UUID:** "SO-2045" is human-readable, used in WhatsApp confirmations, signs, etc. Uniqueness is enforced by a Postgres sequence-backed function (see `seed.ts`). Trade-off: not globally unique, only per-tenant.

#### `order_items` — cart contents

```sql
CREATE TYPE order_item_kind AS ENUM ('product','addon');

CREATE TABLE order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind          order_item_kind NOT NULL,

  product_id    UUID REFERENCES products(id),          -- when kind='product'
  addon_id      TEXT REFERENCES addons(id),            -- when kind='addon'

  qty           INTEGER NOT NULL DEFAULT 1,
  unit_price    INTEGER NOT NULL,                      -- snapshot, in case price changes later
  line_total    INTEGER NOT NULL,                      -- snapshot

  -- Sofa configuration JSONB (only when product is a sofa Model)
  -- Shape: { depth: '24'|'28', mode: 'preset'|'custom',
  --          presetId?, modules: [{id, rot, recliners}], orientation? }
  config        JSONB,

  -- Addon-specific extras
  floors_count  INTEGER,                               -- for lift access
  items_count   INTEGER,                               -- for lift access

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT product_or_addon CHECK (
    (kind = 'product' AND product_id IS NOT NULL AND addon_id IS NULL) OR
    (kind = 'addon'   AND addon_id   IS NOT NULL AND product_id IS NULL)
  )
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
```

#### `order_lane_history` — audit trail for lane transitions

```sql
CREATE TABLE order_lane_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_lane    order_lane,
  to_lane      order_lane NOT NULL,
  changed_by   UUID NOT NULL REFERENCES staff(id),
  reason       TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_lane_history_order ON order_lane_history(order_id, changed_at DESC);
```

#### `drivers` & `customers` & `slip_events`

```sql
CREATE TABLE drivers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_code   TEXT UNIQUE NOT NULL,                  -- 'DRV-01'
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  ic_number     TEXT,
  vehicle       TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  phone         TEXT,                                  -- normalized international format
  email         TEXT,
  address       TEXT,
  postcode      TEXT,
  city          TEXT,
  state         TEXT,
  notes         TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_phone ON customers(phone);

CREATE TABLE order_slip_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event         TEXT NOT NULL,                         -- 'uploaded','verified','flagged','replaced'
  actor_id      UUID REFERENCES staff(id),
  meta          JSONB,                                 -- e.g. { reason: '...' }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.3 Row-Level Security (RLS) policies

| Role | products | orders | order_items | addons |
|---|---|---|---|---|
| `sales` (POS) | SELECT visible=TRUE | INSERT (own staff_id), SELECT (last 30 days, own) | INSERT, SELECT (via own orders) | SELECT enabled=TRUE |
| `coordinator` (BE) | SELECT all, UPDATE non-pricing | SELECT all, UPDATE lane/slip/dispatch | SELECT all | SELECT all |
| `finance` | SELECT all | SELECT all, UPDATE slip approval | SELECT all | SELECT all |
| `admin` (Owner) | ALL | ALL | ALL | ALL |

⚠️ **Pricing edits (UPDATE on `product_size_variants`/`_compartments`/`_bundles`) are admin-only by default**, NOT coordinator. Why: the SKU Master in the prototype is shown to the coordinator, but in production, pricing changes are an Owner / Finance call. The Backend UI can SHOW the editor to coordinators in **read-only mode** until pricing-edit role is assigned.

### 5.4 Order ID generation (the SO-2045 pattern)

```sql
CREATE SEQUENCE order_seq START WITH 2050;

CREATE OR REPLACE FUNCTION next_order_id() RETURNS TEXT
  LANGUAGE sql VOLATILE AS
  $$ SELECT 'SO-' || nextval('order_seq')::text $$;

ALTER TABLE orders ALTER COLUMN id SET DEFAULT next_order_id();
```

---

## 6. API design

All routes are REST-ish, JSON in/out, JWT-authed, scoped by RLS. Hono's middleware chain handles auth + RLS context.

### 6.1 Catalog

| Method | Path | Used by | Notes |
|---|---|---|---|
| GET | `/products` | POS, BE | Query: `?category=sofa&visible=true&search=noor`. Returns lightweight rows |
| GET | `/products/:id` | POS, BE | Returns product **with full pricing structure** (joined size_variants OR compartments+bundles) |
| POST | `/products` | BE (admin) | Create new SKU; default pricing seeded from libraries |
| PATCH | `/products/:id` | BE (coordinator: stock/visibility/detail; admin: pricing too) | Partial update |
| PATCH | `/products/:id/pricing` | BE (admin) | Atomic UPSERT of all variants for this product. Body: `{ kind: 'sofa_build', compartments: [{id, active, price}, ...], bundles: [...], reclinerUpgradePrice: 990 }` |
| DELETE | `/products/:id` | BE (admin) | Soft delete (sets `visible=false` instead of true delete) |

### 6.2 Orders

| Method | Path | Used by | Notes |
|---|---|---|---|
| POST | `/orders` | POS | Body: full cart + customer + payment. Server validates pricing, generates SO-id |
| GET | `/orders` | BE | Filters: `?lane=received&slip=pending&search=...&from=...&to=...` |
| GET | `/orders/:id` | BE, POS (own) | Full detail incl. line history |
| PATCH | `/orders/:id/lane` | BE | Body: `{ to: 'proceed', reason?: '...' }`. Writes to `order_lane_history` |
| PATCH | `/orders/:id/slip` | BE | Body: `{ state: 'verified' \| 'flagged', reason?: '...' }`. Writes to `order_slip_events` |
| POST | `/orders/:id/dispatch` | BE | Body: `{ driverId, confirmedWith }`. Sets dispatched_at |
| POST | `/orders/:id/delivered` | BE | Body: `{ doSigned: true, photoKey?: '...' }`. Sets delivered_at |

### 6.3 Uploads (R2)

| Method | Path | Used by | Notes |
|---|---|---|---|
| POST | `/uploads/slip-url` | POS | Returns presigned PUT URL + final key. POS uploads to R2 directly |
| POST | `/uploads/product-image-url` | BE (admin) | Same pattern, scoped to product images |

Why presigned URLs not multipart-through-API: keeps Worker bundle small, R2 handles the bytes directly.

### 6.4 Staff / Drivers / Addons / Customers

Standard CRUD, admin-only for writes. Coordinator can read.

### 6.5 Realtime

POS doesn't subscribe. Backend subscribes via Supabase Realtime client:

```ts
// apps/backend/src/lib/realtime.ts
supabase
  .channel('orders-changes')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' },
      (payload) => onNewOrder(payload.new))
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' },
      (payload) => onOrderUpdated(payload.new))
  .subscribe();
```

This replaces the prototype's `localStorage` bridge. Latency: ~200ms on Supabase Realtime over websocket.

---

## 7. POS ↔ Backend data flow — the 3 critical paths

### 7.1 Catalog: Backend writes pricing → POS reads

```
Coordinator opens BE
  → GET /products?category=sofa
  → Sees Tanah Modular Sofa, opens drawer
  → Clicks Compartment "1NA", changes price 990 → 1190
  → Saves
  → PATCH /products/:tanah-id/pricing
        body: { compartments: [...full list with new price...] }
  → API validates RBAC (admin only) and writes UPSERT in transaction
  → Postgres NOTIFY fires (Supabase Realtime publishes to subscribers)

[Salesperson in POS, idle on catalog]
  → Realtime push notifies POS app
  → React Query invalidates [products] cache key
  → Catalog re-fetches → new prices reflected
  → No page reload. ~300ms end-to-end.
```

⚠️ **Edge case the prototype doesn't handle:** salesperson is mid-configuration when prices change. **Resolution:** show a non-blocking toast "Pricing updated — your current quote uses the new prices on Save." Quote re-computes from latest pricing at server side on order POST.

### 7.2 Order placement: POS → API → Backend

```
Salesperson finishes order in POS (cart + customer + payment)
  → Builds payload (cart with sofa configs, addons, totals)
  → POST /orders
        body: { staffId, customer, items[{productId, qty, config}], addons[],
                paymentMethod, approvalCode, slipKey?, delivery,
                clientSubtotal, clientAddonTotal, clientTotal }

  API:
    → Verify JWT, set RLS to sales role
    → For each item, RECOMPUTE price from current pricing tables
        - Sofa: sum compartments per config + recliner per seat (or bundle if signature matches)
        - Mattress/Bedframe: lookup variant price by size_id
        - Addons: from addons table (lift = floors × items × per_floor_item)
    → If server total differs from client total > 0.5%, REJECT (400) with diff details
    → Otherwise INSERT INTO orders + INSERT INTO order_items in TRANSACTION
    → Order id 'SO-XXXX' generated by sequence

  → Returns: { id: 'SO-2046', total: 5980, ... }

[Coordinator in Backend, on Dashboard]
  → Realtime INSERT event fires
  → Toast "New order from showroom · SO-2046"
  → Dashboard counter increments
  → Click toast → opens drawer
```

**The pricing validation is non-negotiable.** Without it, a tampered POS bundle could submit `total: 0`. The whole "Every piece is RM2,990" brand promise breaks if a sales staff can fat-finger the wrong price.

### 7.3 Slip verify flow

```
POS (after payment): salesperson uploads slip image
  → POST /uploads/slip-url → { uploadUrl, key }
  → PUT directly to R2 (uploadUrl)
  → POST /orders body includes slipKey
  → orders.slip_state = 'pending'

Coordinator opens VerifySlips queue
  → Sees Awaiting check (4)
  → Clicks one → drawer shows slip thumbnail (signed GET URL via R2)
  → Cross-checks amount, name, reference
  → Clicks Verified
  → PATCH /orders/:id/slip { state: 'verified' }
  → orders.slip_state = 'verified'
  → Insert into order_slip_events
  → Coordinator's name + timestamp recorded

  Final approval (Phase 4) is Finance:
    → Pulls bank statement
    → Reconciles to verified slips
    → PATCH /orders/:id/slip { state: 'reconciled' } ← future enum value
```

---

## 8. UI design system integration — non-negotiables from the brand zip

Pull `colors_and_type.css` 1:1 into `packages/design-system/src/tokens.css`. Build all primitives on top.

### 8.1 The 8 brand commandments (from SKILL.md), enforced by Storybook + ESLint rules

1. **Pricing voice.** No "sale", "discount", strikethrough. The price is the brand. Lint rule: ban substrings "discount", "% off", "was/now" in JSX text content.
2. **Orange is an accent.** 6:3:1 ratio (60% neutral / 30% secondary / 10% orange). One primary CTA per screen, max.
3. **Rounded always.** All `border-radius` must use a token (`--radius-md/-lg/-xl/-pill`); literal px values rejected by Stylelint rule.
4. **Generous whitespace.** Section gaps in marketing surfaces ≥ `--space-9` (96px). Admin pages can use `--space-6/-7`.
5. **No emoji.** Lucide icons only. ESLint plugin to flag `🔥` etc in JSX/TS.
6. **Body type `#221F20`** (`--c-ink`) — never pure black.
7. **No gradients on UI surfaces.** Photography is the texture.
8. **Bilingual.** EN-first, 中文 alongside (use `.t-cn` class). Currently POS is EN-only — add a lang toggle in Phase 2.

### 8.2 Component library to build first (`packages/design-system`)

| Component | Use | Brand spec |
|---|---|---|
| `<Button variant="primary\|ghost\|text" size="sm\|md\|lg">` | All actions | `.btn` family from `ui_kits/web/styles.css` |
| `<Chip variant="ink\|ghost\|burnt">` | Filters, tags, status | `.chip` family |
| `<PriceTag amount={2990} size="sm\|md\|lg">` | The brand hero element | `.t-price` + `.hero__price-num` styles |
| `<Wordmark size>` | "2990®" lockup | `Header.jsx` lockup |
| `<Eyebrow>` | Section labels | `.t-eyebrow` |
| `<Drawer side="right">` | SKU edit, Order detail | New (not in marketing kit) |
| `<DataTable>` | Orders table, SKU table | New |
| `<FormField label hint error>` | Forms | New |
| `<PriceInput>` | The pricing editor | New (from our prototype work) |
| `<Toggle>` | Active/inactive switches | New |
| `<StatusPill tone>` | Lane status, slip state | New |
| `<SamePriceStrip>` | Optional reassurance band | Direct port from `ui_kits/web/SamePriceStrip.jsx` |

POS-specific (mobile-first):
- `<BottomBar>` — sticky cart total + cancel + CTA
- `<StaffPin>` — 4-digit PIN pad
- `<SignaturePad>` — for customer DO sign-off
- `<Configurator>` — sofa module canvas (port from `pos-sofa-config.jsx`)

Backend-specific (desktop-first):
- `<Sidebar>` — left rail nav (port from `backend-shell.jsx`)
- `<Topbar>` — title + search + actions
- `<OrdersBoard>` — kanban view for the 6 lanes (port from `backend-orders.jsx`)
- `<PricingEditor>` — per-Model sofa pricing (port from our recent work)

### 8.3 Visual handover from prototype to production

Two surfaces have minor brand drift that should be corrected during port:

1. **Backend uses `theme="cream"` from a Tweaks panel** — drop the dynamic theme switcher. Brand has one canonical `--c-cream` background; theming is for prototyping, not production.
2. **POS lock banner ("Every piece is RM2,990. Always.")** — still applies in spirit, but the table now shows ranges (RM 590 – 4,290 for Tanah). Update copy to: "Every Model · honest pricing. No markups, no surprises." The brand voice survives even when the price isn't literally 2,990 anymore.

Pricing-strip on the marketing site stays as-is — that's the brand surface.

---

## 9. Phased rollout

| Phase | Scope | Duration | Exit criteria |
|---|---|---|---|
| **0 · Scaffold** | pnpm workspace, 3 apps, design-system package, Drizzle schema, Supabase project, GitHub Actions CI, Wrangler bindings | 3-4 days | `pnpm dev` runs all 3 apps; deploy to staging works |
| **1 · Catalog (BE write, POS read)** | SKU Master pricing editor (port our prototype work), product list endpoint, POS catalog page reads from API | 1 week | Coordinator can edit Tanah's compartments; POS catalog reflects within 5s |
| **2 · Order placement** | POS configurator → cart → customer → payment → confirm. Order POST endpoint with server-side pricing validation. Realtime to BE | 1.5 weeks | E2E test passes: place order from POS, see in BE within 1s |
| **3 · Order lifecycle** | 6-lane board in BE, drawer with full detail, lane transitions, history audit | 1 week | Coordinator can move all 6 lanes, history records every transition |
| **4 · Slip + dispatch + delivery** | R2 upload pipeline, slip verify queue, driver assignment, delivery confirmation | 1 week | Sales uploads slip, Coordinator verifies in <30s, dispatch + delivery flow complete |
| **5 · Hardening** | RLS audit, rate limiting, error tracking (Sentry), monitoring (CF Analytics), bilingual switcher in POS, customer directory | 1 week | Full RLS test pass; error tracking live; bilingual EN+中文 in POS |
| **6 · Pilot** | One showroom, 4 staff, 2 weeks shadow run alongside Google Sheet workflow | 2 weeks | <5 critical bugs; staff prefer the new tool over the sheet |

**Total to pilot: ~7-8 weeks.** Faster if Phase 1-2 are run in parallel by 2 devs.

---

## 10. Locked decisions — answered before Phase 0

These were the open questions from plan v0. All answered by Loo on 6 May 2026.

| # | Question | Decision |
|---|---|---|
| 1 | Supabase project | ✅ **NEW** project (separate from Venture's `gixpptmfuryskbwkmiwz`). Singapore region. |
| 2 | Domain | ✅ Confirmed — production domain to be uploaded when going live. Stage on `*.2990s.dev` or CF Pages preview URLs until then. |
| 3 | Finance role timing | Deferred — not part of pilot. `finance` enum value is in `staff_role` but no staff seeded with that role yet. |
| 4 | Bilingual scope at pilot | English-only for pilot. 中文 toggle exists in code (`lang` prop) but defaults to EN. Reactivate after pilot. |
| 5 | Multi-showroom support | ✅ **Add `showrooms` table + `showroom_id` NOW** (cheaper than retrofit). Seeded with one row "Showroom KL" at MVP. New rows added when 2990's expands. |
| 6 | Customer accounts/login | ✅ **Internal-only directory.** Customers do NOT log in. No customer-facing tracking page. |
| 7 | Google Sheet data migration | ✅ **No data migration needed** — Google Sheet has no historical orders. Hard cutover from day 1. |
| 8 | Owner pricing approval workflow | ✅ **Direct edit, no approval.** Admin role edits pricing tables directly. No `pricing_proposals` table. |

### Schema impact of these answers

- **§5 added:** `showrooms` table (id, showroom_code, name, address, phone, active). Seed inserts "Showroom KL".
- **§5 modified:** `staff` got `showroom_id` (nullable; coordinators with NULL oversee all). `orders` got `showroom_id` (NOT NULL; every order placed at exactly one showroom). New `idx_orders_showroom` index for per-showroom dashboards.
- **No table needed for:** customer accounts, pricing proposals, finance role.

### UI impact

The prototype `pos-screens.jsx` topbar already shows "POS · Showroom KL" — that breadcrumb will become dynamic once a 2nd showroom exists. No UI rework needed at MVP.

---

## Appendix A — files in this delivery

```
2990s-portal-plan/
├── 2990S-PORTAL-PLAN.md            ← this document
├── UI_REFERENCE.md                 ← contract for Claude Code: follow prototype 100%
├── db/
│   ├── schema.ts                   ← Drizzle schema (TS, source of truth)
│   └── seed-libraries.sql          ← seed data: showrooms, categories, libraries, staff
└── prototype/                      ← actual prototype files (THE UI/motion/function spec)
    ├── index.html                  ← open this in browser to see the POS
    ├── backend.html                ← open this for the Backend portal
    ├── pos-*.jsx, pos-styles.css   ← POS source
    ├── backend-*.jsx, backend-styles.css ← Backend source
    ├── order-bridge.jsx            ← shared order data shape
    └── assets/
        ├── colors_and_type.css     ← brand tokens (cream/orange/burnt/ink + Merriweather/Poppins/Raleway)
        ├── imagery/                ← product photos
        ├── logo/                   ← 2990's wordmark + circular mark
        └── sofa-modules/png/       ← 22 plan-view sofa module illustrations
```

**Reading order for review:**
1. This doc (you are here)
2. `UI_REFERENCE.md` — the rules for production implementation
3. `db/schema.ts` — verify the 18 tables (1 showrooms + 5 library + 1 product + 3 pricing + 1 addon + 2 ops + 5 order/audit) match your mental model
4. Open `prototype/index.html` in a browser; click around POS catalog → configurator → cart → customer → confirmed
5. Open `prototype/backend.html`; click through Dashboard → Orders → SKU Master (with per-Model pricing editor) → Add-ons

---

*Generated by Claude · 6 May 2026 · Plan v1*
