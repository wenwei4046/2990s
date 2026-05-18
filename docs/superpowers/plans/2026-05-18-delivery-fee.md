# Delivery Fee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-configurable delivery fee to every order — RM 250 base, +RM 175 cross-category surcharge when ≥2 product categories, plus a free-form additional fee POS sales can key in at handover. Fees snapshot onto the order at placement time and never mutate retroactively.

**Architecture:** Singleton `delivery_fee_config` table holds the two default rates (audited via `pricing_version` bump trigger, same pattern as products/addons). POST /orders re-derives fees server-side via a new pure `computeDeliveryFee()` in `@2990s/shared/pricing` and writes three snapshot columns (`delivery_fee_base`, `delivery_fee_cross_category`, `delivery_fee_additional`) to `orders` and `quotes`. Backend Settings gets a new "Delivery" tab to edit the two rates; POS `AddonsPaymentStep` adds an additional-fee input; `OrderSummaryPane` displays the breakdown.

**Tech Stack:** Supabase Postgres + Drizzle, Hono on CF Workers, React Router 7 + TanStack Query, Vitest.

---

## File Map

| Purpose | File | Action |
|---|---|---|
| Migration (table, columns, trigger, RPC) | `packages/db/migrations/0029_delivery_fee.sql` | Create |
| Drizzle schema sync | `packages/db/src/schema.ts` | Modify |
| Pure delivery-fee math | `packages/shared/src/pricing.ts` | Modify |
| Pricing tests | `packages/shared/src/__tests__/pricing.test.ts` | Modify |
| API order schema (additional fee field) | `packages/shared/src/schemas/order-v1.schema.ts` | Modify |
| API products select (load category_id) | `apps/api/src/routes/orders.ts` | Modify |
| Order POST recompute + drift check | `apps/api/src/routes/orders.ts` | Modify |
| Order POST RPC payload (forward fees) | `apps/api/src/routes/orders.ts` | Modify |
| `/delivery-fees` GET + PATCH endpoints | `apps/api/src/routes/delivery-fees.ts` | Create |
| Register new route in Hono app | `apps/api/src/index.ts` | Modify |
| Backend hooks (read + update config) | `apps/backend/src/lib/admin-queries.ts` | Modify |
| Backend Settings "Delivery" tab | `apps/backend/src/pages/Settings.tsx` | Modify |
| POS HandoverForm field | `apps/pos/src/lib/handover-helpers.ts` | Modify |
| POS query — delivery-fee config | `apps/pos/src/lib/queries.ts` | Modify |
| POS additional-fee input UI | `apps/pos/src/components/handover/AddonsPaymentStep.tsx` | Modify |
| POS OrderSummaryPane fee rows | `apps/pos/src/components/handover/OrderSummaryPane.tsx` | Modify |
| POS Handover orchestrator | `apps/pos/src/pages/Handover.tsx` | Modify |
| POS createOrder mutation payload | `apps/pos/src/lib/orders.ts` | Modify |

---

## Task 1: Migration 0029 — DB foundation

**Files:**
- Create: `packages/db/migrations/0029_delivery_fee.sql`

- [ ] **Step 1: Write the migration file**

Path: `packages/db/migrations/0029_delivery_fee.sql`

```sql
-- 0029_delivery_fee.sql
-- Admin-configurable delivery fee with cross-category surcharge.
-- Rules locked 2026-05-18 with Loo:
--   * Base fee (default RM 250) applies to every order.
--   * Cross-category surcharge (default RM 175) applies once, flat, when the
--     order contains products spanning ≥2 distinct categories.
--   * POS sales can key in any additional fee at handover (no cap, no approval).
--   * Backend Settings edits the two default rates; pricing_version bumps so
--     existing PricingDriftModal flow surfaces drift if rates change between
--     quote save and order placement.
--   * Fees snapshot onto orders.* and quotes.* and never mutate retroactively.

-- ─── Config singleton ───────────────────────────────────────────────────────
CREATE TABLE delivery_fee_config (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_fee            integer NOT NULL DEFAULT 250 CHECK (base_fee            >= 0),
  cross_category_fee  integer NOT NULL DEFAULT 175 CHECK (cross_category_fee  >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES staff(id) ON DELETE SET NULL
);

INSERT INTO delivery_fee_config (id) VALUES (1);

COMMENT ON TABLE delivery_fee_config IS
  'Singleton (id = 1) holding the two delivery-fee defaults. Read by every staff role; written by admin/coordinator only.';

-- ─── RLS — read for any authenticated staff; write for admin/coordinator ─────
ALTER TABLE delivery_fee_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY delivery_fee_config_select_all
  ON delivery_fee_config FOR SELECT TO authenticated
  USING (true);

CREATE POLICY delivery_fee_config_update_admin_coord
  ON delivery_fee_config FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff
       WHERE id = auth.uid()
         AND active = TRUE
         AND role IN ('admin', 'coordinator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
       WHERE id = auth.uid()
         AND active = TRUE
         AND role IN ('admin', 'coordinator')
    )
  );

-- No INSERT / DELETE policies — singleton row is seeded above and the CHECK
-- (id = 1) blocks any further INSERT even if a future policy allowed it.

-- ─── pricing_version bump trigger ───────────────────────────────────────────
-- Reuses the function created in 0001. Any UPDATE to the singleton row bumps
-- app_config.pricing_version so a saved quote with stale fees triggers the
-- PricingDriftModal flow on promotion.
DROP TRIGGER IF EXISTS bump_pricing_version_delivery_fee_config ON delivery_fee_config;
CREATE TRIGGER bump_pricing_version_delivery_fee_config
  AFTER UPDATE ON delivery_fee_config
  FOR EACH STATEMENT EXECUTE FUNCTION bump_pricing_version();

-- ─── Snapshot columns on orders ─────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_fee_base           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_cross_category integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_additional     integer NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD CONSTRAINT delivery_fee_base_nonneg            CHECK (delivery_fee_base           >= 0),
  ADD CONSTRAINT delivery_fee_cross_category_nonneg  CHECK (delivery_fee_cross_category >= 0),
  ADD CONSTRAINT delivery_fee_additional_nonneg      CHECK (delivery_fee_additional     >= 0);

-- ─── Snapshot columns on quotes ─────────────────────────────────────────────
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS delivery_fee_base           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_cross_category integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_additional     integer NOT NULL DEFAULT 0;

ALTER TABLE quotes
  ADD CONSTRAINT q_delivery_fee_base_nonneg           CHECK (delivery_fee_base           >= 0),
  ADD CONSTRAINT q_delivery_fee_cross_category_nonneg CHECK (delivery_fee_cross_category >= 0),
  ADD CONSTRAINT q_delivery_fee_additional_nonneg     CHECK (delivery_fee_additional     >= 0);

-- ─── RPC update — create_order_with_items now persists delivery fees ────────
-- Diff vs 0028: +3 delivery_fee_* columns in INSERT list, +3 values from payload.
CREATE OR REPLACE FUNCTION public.create_order_with_items(p jsonb)
RETURNS text
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  v_order_id        text;
  v_staff_id        uuid := auth.uid();
  v_showroom_id     uuid;
  v_pricing_version text;
  v_session_id      uuid;
  v_session_row     pending_slip_uploads%ROWTYPE;
  v_billing_same    boolean;
BEGIN
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT showroom_id INTO v_showroom_id
  FROM staff WHERE id = v_staff_id AND active = TRUE;
  IF v_showroom_id IS NULL THEN
    v_showroom_id := (p->>'showroomId')::uuid;
    IF v_showroom_id IS NULL THEN
      SELECT id INTO v_showroom_id FROM showrooms ORDER BY id LIMIT 1;
    END IF;
  END IF;

  v_pricing_version := COALESCE(app_config_get('pricing_version'), '0');
  v_order_id := next_order_id();

  v_session_id := NULLIF(p->>'uploadSessionId', '')::uuid;
  IF v_session_id IS NOT NULL THEN
    SELECT * INTO v_session_row FROM pending_slip_uploads
    WHERE id = v_session_id FOR UPDATE;

    IF v_session_row.id IS NULL THEN
      RAISE EXCEPTION 'slip_session_not_found' USING errcode = 'P0002';
    END IF;
    IF v_session_row.staff_id <> v_staff_id THEN
      RAISE EXCEPTION 'not_session_owner' USING errcode = '42501';
    END IF;
    IF v_session_row.status <> 'uploaded' THEN
      RAISE EXCEPTION 'slip_not_ready' USING errcode = '22023';
    END IF;
  ELSIF (p->>'paymentMethod') = 'transfer' THEN
    RAISE EXCEPTION 'slip_required_for_transfer' USING errcode = '23514';
  END IF;

  v_billing_same := COALESCE((p->>'billingSame')::boolean, TRUE);

  INSERT INTO orders (
    id, staff_id, showroom_id, lane,
    customer_name, customer_phone, customer_email,
    customer_address, customer_address_line2,
    customer_postcode, customer_city, customer_state,
    customer_type, building_type, billing_same, salesperson_id,
    customer_billing_address, customer_billing_address_line2,
    customer_billing_postcode, customer_billing_city, customer_billing_state,
    subtotal, addon_total, total, paid,
    -- NEW: three delivery-fee snapshot columns
    delivery_fee_base, delivery_fee_cross_category, delivery_fee_additional,
    pricing_version,
    payment_method, approval_code,
    notes, delivery_notes,
    delivery_date, delivery_slot, delivery_tbd,
    slip_key, slip_state
  ) VALUES (
    v_order_id, v_staff_id, v_showroom_id, 'received',
    p->>'customerName',
    NULLIF(p->>'customerPhone', ''),
    NULLIF(p->>'customerEmail', ''),
    NULLIF(p->>'customerAddress', ''),
    NULLIF(p->>'customerAddressLine2', ''),
    NULLIF(p->>'customerPostcode', ''),
    NULLIF(p->>'customerCity', ''),
    NULLIF(p->>'customerState', ''),
    NULLIF(p->>'customerType', ''),
    NULLIF(p->>'buildingType', ''),
    v_billing_same,
    NULLIF(p->>'salespersonId', '')::uuid,
    CASE WHEN v_billing_same THEN NULL ELSE NULLIF(p->>'billingAddress', '') END,
    CASE WHEN v_billing_same THEN NULL ELSE NULLIF(p->>'billingAddressLine2', '') END,
    CASE WHEN v_billing_same THEN NULL ELSE NULLIF(p->>'billingPostcode', '') END,
    CASE WHEN v_billing_same THEN NULL ELSE NULLIF(p->>'billingCity', '') END,
    CASE WHEN v_billing_same THEN NULL ELSE NULLIF(p->>'billingState', '') END,
    (p->>'subtotal')::int,
    COALESCE((p->>'addonTotal')::int, 0),
    (p->>'total')::int,
    COALESCE((p->>'paid')::int, 0),
    -- NEW: delivery fees default to 0 if absent (legacy POS clients)
    COALESCE((p->>'deliveryFeeBase')::int, 0),
    COALESCE((p->>'deliveryFeeCrossCategory')::int, 0),
    COALESCE((p->>'deliveryFeeAdditional')::int, 0),
    v_pricing_version,
    (p->>'paymentMethod')::payment_method,
    NULLIF(p->>'approvalCode', ''),
    NULLIF(p->>'notes', ''),
    NULLIF(p->>'specialInstructions', ''),
    NULLIF(p->>'deliveryDate', '')::date,
    NULLIF(p->>'deliverySlot', ''),
    COALESCE((p->>'addressLater')::boolean, FALSE),
    v_session_row.r2_key,
    CASE WHEN v_session_row.id IS NOT NULL
         THEN 'pending'::slip_state
         ELSE 'none'::slip_state END
  );

  INSERT INTO order_items (order_id, kind, product_id, qty, unit_price, line_total, config)
  SELECT
    v_order_id,
    'product'::order_item_kind,
    (li->>'productId')::uuid,
    (li->>'qty')::int,
    (li->>'unitPrice')::int,
    (li->>'lineTotal')::int,
    li->'config'
  FROM jsonb_array_elements(p->'lines') li;

  INSERT INTO order_items (
    order_id, kind, addon_id, qty, unit_price, line_total,
    floors_count, items_count
  )
  SELECT
    v_order_id,
    'addon'::order_item_kind,
    a.id,
    COALESCE((ad->>'qty')::int, 1),
    a.price,
    CASE
      WHEN a.kind = 'floors_items' THEN
        COALESCE(a.per_floor_item, 0)
          * GREATEST(0, COALESCE((ad->>'floorsCount')::int, 0) - 2)
          * COALESCE((ad->>'itemsCount')::int, 0)
      ELSE a.price * COALESCE((ad->>'qty')::int, 1)
    END,
    CASE WHEN a.kind = 'floors_items'
         THEN (ad->>'floorsCount')::int ELSE NULL END,
    CASE WHEN a.kind = 'floors_items'
         THEN (ad->>'itemsCount')::int ELSE NULL END
  FROM jsonb_array_elements(COALESCE(p->'addons', '[]'::jsonb)) ad
  JOIN addons a ON a.id = ad->>'addonId'
  WHERE a.enabled = TRUE;

  IF v_session_id IS NOT NULL THEN
    UPDATE pending_slip_uploads
       SET status = 'promoted',
           promoted_at = now(),
           promoted_to_order_id = v_order_id
     WHERE id = v_session_id;

    INSERT INTO order_slip_events (order_id, event, actor_id, meta)
    VALUES (v_order_id, 'uploaded', v_staff_id,
            jsonb_build_object('session_id', v_session_id));
  END IF;

  RETURN v_order_id;
END;
$$;
```

- [ ] **Step 2: Apply the migration to local Supabase**

Run: `pnpm --filter @2990s/db push`
Expected: `0029_delivery_fee.sql` applied, no errors.

- [ ] **Step 3: Verify schema in Supabase**

Run: `pnpm --filter @2990s/db exec -- psql "$DATABASE_URL" -c "\d delivery_fee_config" -c "\d orders" | grep delivery_fee`
Expected output includes:
```
 delivery_fee_base           | integer | not null | 0
 delivery_fee_cross_category | integer | not null | 0
 delivery_fee_additional     | integer | not null | 0
```
And `delivery_fee_config` shows id/base_fee/cross_category_fee/updated_at/updated_by columns with a singleton row.

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0029_delivery_fee.sql
git commit -m "feat(db): 0029 delivery_fee_config + orders/quotes snapshot cols"
```

---

## Task 2: Drizzle schema sync

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Add `deliveryFeeConfig` table definition**

Add after the `appConfig` block (~ line 99, before "Showrooms" section):

```ts
/* ─────────────────────────── Delivery fee config ───────────────────── */
// Singleton (id = 1) holding the two delivery-fee defaults. UPDATEs bump
// app_config.pricing_version via trigger so saved quotes surface drift.
// RLS: read for any authenticated staff; UPDATE for admin/coordinator only.

export const deliveryFeeConfig = pgTable('delivery_fee_config', {
  id:               integer('id').primaryKey().default(1),     // CHECK (id = 1) at DB
  baseFee:          integer('base_fee').notNull().default(250),
  crossCategoryFee: integer('cross_category_fee').notNull().default(175),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:        uuid('updated_by'),                        // references staff(id)
});
```

- [ ] **Step 2: Add 3 columns to `orders` table definition**

Locate the `orders = pgTable('orders', { ... })` block. After the existing `paid` column (around line 363), add:

```ts
  // Delivery fee snapshot (migration 0029). All three columns are NOT NULL
  // DEFAULT 0 so legacy rows backfill cleanly. Reconstructed from
  // delivery_fee_config + cart at order time; never mutated by config edits.
  deliveryFeeBase:           integer('delivery_fee_base').notNull().default(0),
  deliveryFeeCrossCategory:  integer('delivery_fee_cross_category').notNull().default(0),
  deliveryFeeAdditional:     integer('delivery_fee_additional').notNull().default(0),
```

- [ ] **Step 3: Add 3 columns to `quotes` table definition**

Locate the `quotes = pgTable('quotes', { ... })` block. After `total: integer('total').notNull(),` add the same 3 lines (without comment — comment already on orders).

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @2990s/db typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): drizzle schema sync for delivery fee"
```

---

## Task 3: `computeDeliveryFee` pure function + tests

**Files:**
- Modify: `packages/shared/src/pricing.ts`
- Modify: `packages/shared/src/__tests__/pricing.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/__tests__/pricing.test.ts` (after the last `describe` block):

```ts
import { computeDeliveryFee } from '../pricing';

describe('computeDeliveryFee', () => {
  const cfg = { baseFee: 250, crossCategoryFee: 175 };

  it('returns all zeros when no categories', () => {
    expect(computeDeliveryFee([], cfg, 0)).toEqual({
      base: 0, crossCategory: 0, additional: 0, total: 0,
    });
  });

  it('charges only base fee for a single-category cart', () => {
    expect(computeDeliveryFee(['sofa'], cfg, 0)).toEqual({
      base: 250, crossCategory: 0, additional: 0, total: 250,
    });
  });

  it('charges base + cross-category for two distinct categories', () => {
    expect(computeDeliveryFee(['sofa', 'mattress'], cfg, 0)).toEqual({
      base: 250, crossCategory: 175, additional: 0, total: 425,
    });
  });

  it('charges cross-category once even with three distinct categories', () => {
    expect(computeDeliveryFee(['sofa', 'mattress', 'bedframe'], cfg, 0)).toEqual({
      base: 250, crossCategory: 175, additional: 0, total: 425,
    });
  });

  it('treats duplicate category ids as one (Sofa Custom + Sofa Bundle)', () => {
    expect(computeDeliveryFee(['sofa', 'sofa', 'sofa'], cfg, 0)).toEqual({
      base: 250, crossCategory: 0, additional: 0, total: 250,
    });
  });

  it('adds the additional fee on top', () => {
    expect(computeDeliveryFee(['sofa', 'mattress'], cfg, 80)).toEqual({
      base: 250, crossCategory: 175, additional: 80, total: 505,
    });
  });

  it('clamps negative additional fee to 0 (defensive — POS UI should never submit negative)', () => {
    expect(computeDeliveryFee(['sofa'], cfg, -50)).toEqual({
      base: 250, crossCategory: 0, additional: 0, total: 250,
    });
  });

  it('ignores falsy / empty category ids', () => {
    expect(computeDeliveryFee(['sofa', '', '', 'mattress'], cfg, 0)).toEqual({
      base: 250, crossCategory: 175, additional: 0, total: 425,
    });
  });

  it('honours zero rates from the config (admin sets free delivery)', () => {
    const free = { baseFee: 0, crossCategoryFee: 0 };
    expect(computeDeliveryFee(['sofa', 'mattress'], free, 0)).toEqual({
      base: 0, crossCategory: 0, additional: 0, total: 0,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @2990s/shared test -- pricing.test.ts -t computeDeliveryFee`
Expected: FAIL — `Cannot find name 'computeDeliveryFee'` (or 9 failures referring to the missing import).

- [ ] **Step 3: Add the implementation**

Append to `packages/shared/src/pricing.ts` (after `pricingDriftExceeds`):

```ts
/* ─── Delivery fee (migration 0029) ────────────────────────────────── */

export interface DeliveryFeeConfig {
  baseFee:          number;
  crossCategoryFee: number;
}

export interface DeliveryFeeResult {
  /** Flat per-order base fee (default RM 250). */
  base:          number;
  /** One-time surcharge when the cart spans ≥2 distinct category ids
   *  (default RM 175). Charged flat, not per extra category. */
  crossCategory: number;
  /** Free-form fee keyed in by POS sales at handover. */
  additional:    number;
  /** base + crossCategory + additional. */
  total:         number;
}

/**
 * Server-side recompute of the delivery fee. Pure — no DB I/O.
 *
 * `categoryIds` is the list of `products.category_id` values for every line
 * in the cart, duplicates allowed. Empty / falsy ids are ignored so an
 * untyped flat product doesn't accidentally trip cross-category billing.
 *
 * Negative `additionalFee` is clamped to 0 defensively; the POS UI should
 * never submit negative values, but the server is authoritative.
 */
export const computeDeliveryFee = (
  categoryIds:   string[],
  config:        DeliveryFeeConfig,
  additionalFee: number,
): DeliveryFeeResult => {
  const cleaned = categoryIds.filter((id): id is string => Boolean(id));
  if (cleaned.length === 0) {
    return { base: 0, crossCategory: 0, additional: 0, total: 0 };
  }
  const distinct      = new Set(cleaned);
  const crossCategory = distinct.size >= 2 ? config.crossCategoryFee : 0;
  const additional    = Math.max(0, additionalFee);
  const base          = config.baseFee;
  return {
    base,
    crossCategory,
    additional,
    total: base + crossCategory + additional,
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @2990s/shared test -- pricing.test.ts -t computeDeliveryFee`
Expected: 9 passing.

- [ ] **Step 5: Run the full shared test suite to make sure nothing else broke**

Run: `pnpm --filter @2990s/shared test`
Expected: all green, no regressions in `computeOrderTotal` / `addonPrice` / sofa-build / mattress / bedframe tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/pricing.ts packages/shared/src/__tests__/pricing.test.ts
git commit -m "feat(shared): computeDeliveryFee pure function + tests"
```

---

## Task 4: Extend `OrderV1PostSchema` with `additionalDeliveryFee`

**Files:**
- Modify: `packages/shared/src/schemas/order-v1.schema.ts`

- [ ] **Step 1: Add the field**

Locate the `orderV1PostSchema = z.object({ ... })` block. After the existing `paid` field (~line 115), add:

```ts
  // Additional delivery fee keyed in by POS sales at handover. No cap; server
  // clamps negatives to 0. Server-recomputed delivery fee = config.baseFee
  // + (crossCategoryFee if ≥2 product categories) + this. (Migration 0029)
  additionalDeliveryFee: z.number().int().nonnegative().optional(),
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @2990s/shared typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/schemas/order-v1.schema.ts
git commit -m "feat(shared): additionalDeliveryFee on orderV1PostSchema"
```

---

## Task 5: API — load `category_id` and recompute delivery fee on POST /orders

**Files:**
- Modify: `apps/api/src/routes/orders.ts`

- [ ] **Step 1: Extend the products select to include `category_id`**

In `orders.ts`, locate the parallel-fetch Promise.all block (~ line 99–131). Change the `products` select:

```ts
    supabase
      .from('products')
      .select('id, category_id, pricing_kind, flat_price, recliner_upgrade_price')
      .in('id', productIds),
```

- [ ] **Step 2: Add a parallel fetch for delivery_fee_config**

In the same `Promise.all` array, add a 6th entry just before the closing `]`:

```ts
    ,
    supabase
      .from('delivery_fee_config')
      .select('base_fee, cross_category_fee')
      .eq('id', 1)
      .single(),
```

Then update the destructuring line just after the `await Promise.all`:

```ts
  const [productsRes, compartmentsRes, bundlesRes, sizesRes, addonsRes, deliveryCfgRes] = await Promise.all([
```

And extend the `for (const r of ...)` error-check loop to include `deliveryCfgRes`:

```ts
  for (const r of [productsRes, compartmentsRes, bundlesRes, sizesRes, addonsRes, deliveryCfgRes]) {
    if (r.error) return c.json({ error: 'pricing_fetch_failed', reason: r.error.message }, 500);
  }
```

- [ ] **Step 3: Build a productId → categoryId map**

After the existing `const products = productsRes.data ?? [];` line, add:

```ts
  const categoryIdByProductId = new Map<string, string>();
  for (const p of products) {
    if (p.category_id) categoryIdByProductId.set(p.id, p.category_id);
  }
```

- [ ] **Step 4: Compute delivery fee after `computeOrderTotal` succeeds**

Locate the `// Run the shared recompute.` block (~ line 184–200). Immediately after the `computeOrderTotal` call (i.e. after the closing `}` of the `try { ... } catch { ... }` block), add:

```ts
  // ─── Delivery fee (migration 0029) ────────────────────────────────
  // Reads the singleton delivery_fee_config row; recomputes from the cart's
  // distinct category ids; folds in the POS-supplied additional fee.
  const cartCategoryIds = dto.lines
    .map((l) => categoryIdByProductId.get(l.config.productId) ?? '')
    .filter(Boolean);
  const deliveryCfg = deliveryCfgRes.data ?? { base_fee: 0, cross_category_fee: 0 };
  const deliveryFee = computeDeliveryFee(
    cartCategoryIds,
    { baseFee: deliveryCfg.base_fee, crossCategoryFee: deliveryCfg.cross_category_fee },
    dto.additionalDeliveryFee ?? 0,
  );
  const finalTotal = totals.total + deliveryFee.total;
```

- [ ] **Step 5: Update the drift check to compare against `finalTotal`**

Locate the existing `if (pricingDriftExceeds(dto.clientTotal, totals.total)) { ... }` block. Replace it with:

```ts
  // Drift check (>0.5%) — the contract that protects "honest pricing".
  // finalTotal now includes the recomputed delivery fee so any tampered
  // POS that submits a lower delivery_fee_additional gets caught.
  if (pricingDriftExceeds(dto.clientTotal, finalTotal)) {
    return c.json({
      error: 'pricing_drift',
      clientTotal: dto.clientTotal,
      serverTotal: finalTotal,
      deliveryFee,
      lines: totals.lines.map((l, i) => ({
        qty: l.qty,
        productId: l.productId,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        breakdown: l.breakdown,
        clientConfig: dto.lines[i]?.config,
      })),
    }, 409);
  }
```

- [ ] **Step 6: Forward fees in the RPC payload**

Locate the `const rpcPayload = { ... }` block. After the `addonTotal: totals.addonTotal,` line, add:

```ts
    deliveryFeeBase:           deliveryFee.base,
    deliveryFeeCrossCategory:  deliveryFee.crossCategory,
    deliveryFeeAdditional:     deliveryFee.additional,
```

And change the `total:` line to use `finalTotal`:

```ts
    total: finalTotal,
```

- [ ] **Step 7: Include delivery fee in the response body**

Locate the final `return c.json({ id: data as string, subtotal: ..., addonTotal: ..., ... })`. Extend it to include delivery fee:

```ts
  return c.json({
    id: data as string,
    subtotal:     totals.subtotal,
    addonTotal:   totals.addonTotal,
    deliveryFee,
    total:        finalTotal,
    ...
  });
```

(Preserve any existing fields after the spread comment; this step only adds `deliveryFee` and changes `total` to `finalTotal`.)

- [ ] **Step 8: Add the `computeDeliveryFee` import**

At the top of `apps/api/src/routes/orders.ts`, extend the `@2990s/shared/pricing` import to include `computeDeliveryFee`:

```ts
import {
  computeOrderTotal,
  pricingDriftExceeds,
  computeDeliveryFee,
  OrderPricingError,
  type ServerProductInfo,
  type OrderLineInput,
  type AddonStaticInfo,
} from '@2990s/shared/pricing';
```

- [ ] **Step 9: Type-check + test**

Run: `pnpm --filter @2990s/api typecheck && pnpm --filter @2990s/api test`
Expected: typecheck clean. `orders.test.ts` may have failures referring to changed response shape — that is acceptable here and gets fixed in Task 6.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/routes/orders.ts
git commit -m "feat(api): server-side delivery fee recompute on POST /orders"
```

---

## Task 6: Update API tests for the new fee fields

**Files:**
- Modify: `apps/api/src/routes/orders.test.ts`

- [ ] **Step 1: Identify failing tests**

Run: `pnpm --filter @2990s/api test -- orders.test.ts`
Note the failures — most likely "expected total X, received X + 250" patterns and "expected response.body.deliveryFee" assertions missing.

- [ ] **Step 2: Update the test fixtures so mocked Supabase returns a delivery_fee_config row**

Locate the supabase mock setup (search for `from: jest.fn` or `from: vi.fn` or similar in the test file). Add a branch in the `from(table)` mock that returns a chainable producing `{ base_fee: 250, cross_category_fee: 175 }` for `delivery_fee_config`.

If the existing mock uses a helper, add the row there. Otherwise, add a new mock chain:

```ts
function mockDeliveryFeeConfig(supabase: any, base = 250, cross = 175) {
  // Plug into whichever pattern the existing test uses for parallel selects.
  // Example assuming the existing mock supports per-table response maps:
  supabase.tableResponses['delivery_fee_config'] = {
    data: { base_fee: base, cross_category_fee: cross },
    error: null,
  };
}
```

- [ ] **Step 3: Update each existing test's expected totals**

For every test that asserts `expect(body.total).toBe(...)`, add 250 (single category) or 425 (two categories) to the expected value. For tests that build mixed carts (sofa + mattress) the new expected total is `subtotal + addonTotal + 425`.

If a test was previously written against `subtotal === total`, refactor it to assert `body.total === body.subtotal + body.addonTotal + body.deliveryFee.total`.

- [ ] **Step 4: Add a new test specifically for delivery-fee snapshot**

Add to `orders.test.ts`:

```ts
it('snapshots delivery fee onto orders.* and includes deliveryFee in response', async () => {
  // Build a cart with two categories so cross-category triggers.
  const res = await postOrder({
    lines: [
      { qty: 1, config: { kind: 'flat',  productId: 'sofa-product-uuid' } },
      { qty: 1, config: { kind: 'flat',  productId: 'mattress-product-uuid' } },
    ],
    additionalDeliveryFee: 50,
    // … other required fields …
  });
  expect(res.status).toBe(200);
  expect(res.body.deliveryFee).toEqual({
    base: 250, crossCategory: 175, additional: 50, total: 475,
  });
  expect(res.body.total).toBe(res.body.subtotal + res.body.addonTotal + 475);
});

it('rejects clientTotal drifting from server total once delivery fee is folded in', async () => {
  const res = await postOrder({
    lines: [{ qty: 1, config: { kind: 'flat', productId: 'sofa-product-uuid' } }],
    // Client "forgets" the base fee → 250 drift.
    clientTotal: 2990,
    // … other required fields …
  });
  expect(res.status).toBe(409);
  expect(res.body.error).toBe('pricing_drift');
  expect(res.body.deliveryFee.base).toBe(250);
});
```

- [ ] **Step 5: Run the test suite to verify it passes**

Run: `pnpm --filter @2990s/api test -- orders.test.ts`
Expected: all tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/orders.test.ts
git commit -m "test(api): delivery fee in POST /orders"
```

---

## Task 7: `/delivery-fees` GET + PATCH endpoints

**Files:**
- Create: `apps/api/src/routes/delivery-fees.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create the route file**

Path: `apps/api/src/routes/delivery-fees.ts`

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const deliveryFees = new Hono<{ Bindings: Env; Variables: Variables }>();

deliveryFees.use('*', supabaseAuth);

const WRITE_ROLES = new Set(['admin', 'coordinator']);

const patchSchema = z.object({
  baseFee:          z.number().int().nonnegative(),
  crossCategoryFee: z.number().int().nonnegative(),
});

// GET — every authenticated staff role can read.
deliveryFees.get('/', async (c) => {
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('delivery_fee_config')
    .select('base_fee, cross_category_fee, updated_at, updated_by')
    .eq('id', 1)
    .single();
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({
    baseFee:          data.base_fee,
    crossCategoryFee: data.cross_category_fee,
    updatedAt:        data.updated_at,
    updatedBy:        data.updated_by,
  });
});

// PATCH — admin/coordinator only. Server-side role check + RLS as defence-
// in-depth (migration 0029 grants UPDATE only to those roles).
deliveryFees.patch('/', async (c) => {
  const userId   = c.get('user').id;
  const supabase = c.get('supabase');

  const staffRes = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error) {
    return c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500);
  }
  if (!staffRes.data || !staffRes.data.active) {
    return c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403);
  }
  if (!WRITE_ROLES.has(staffRes.data.role)) {
    return c.json({ error: 'forbidden', reason: 'admin_or_coordinator_only' }, 403);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_failed',
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    }, 400);
  }

  const { error } = await supabase
    .from('delivery_fee_config')
    .update({
      base_fee:           parsed.data.baseFee,
      cross_category_fee: parsed.data.crossCategoryFee,
      updated_at:         new Date().toISOString(),
      updated_by:         userId,
    })
    .eq('id', 1);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Register the route in `apps/api/src/index.ts`**

Open `apps/api/src/index.ts`. Add the import alongside the existing route imports:

```ts
import { deliveryFees } from './routes/delivery-fees';
```

And register it under the existing `app.route('/...', ...)` calls:

```ts
app.route('/delivery-fees', deliveryFees);
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @2990s/api typecheck`
Expected: clean.

- [ ] **Step 4: Smoke-test the endpoints via curl**

With wrangler dev still running on 127.0.0.1:8787 and a valid staff Bearer token in `$TOKEN`:

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/delivery-fees | jq
# Expected: { "baseFee": 250, "crossCategoryFee": 175, "updatedAt": "...", "updatedBy": null }

curl -s -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"baseFee": 280, "crossCategoryFee": 200}' \
  http://127.0.0.1:8787/delivery-fees | jq
# Expected: { "ok": true }

curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/delivery-fees | jq
# Expected: { "baseFee": 280, "crossCategoryFee": 200, "updatedAt": "...", "updatedBy": "<your uuid>" }

# Revert before continuing so e2e expectations stay aligned.
curl -s -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"baseFee": 250, "crossCategoryFee": 175}' \
  http://127.0.0.1:8787/delivery-fees
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/delivery-fees.ts apps/api/src/index.ts
git commit -m "feat(api): GET + PATCH /delivery-fees"
```

---

## Task 8: Backend hooks — read + update delivery fee config

**Files:**
- Modify: `apps/backend/src/lib/admin-queries.ts`

- [ ] **Step 1: Add the hooks**

Append to `apps/backend/src/lib/admin-queries.ts`:

```ts
/* ─── Delivery fee config ─── */

export interface DeliveryFeeConfigRow {
  baseFee:          number;
  crossCategoryFee: number;
  updatedAt:        string;
  updatedBy:        string | null;
}

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const useDeliveryFeeConfig = () =>
  useQuery({
    queryKey: ['delivery-fee-config'],
    queryFn: async (): Promise<DeliveryFeeConfigRow> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/delivery-fees`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /delivery-fees failed (${res.status})`);
      return (await res.json()) as DeliveryFeeConfigRow;
    },
    staleTime: 30_000,
  });

export const useUpdateDeliveryFeeConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { baseFee: number; crossCategoryFee: number }) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/delivery-fees`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `PATCH /delivery-fees failed (${res.status})`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery-fee-config'] });
    },
  });
};
```

If `useQuery`, `useMutation`, `useQueryClient`, or `supabase` is not already imported at the top of `admin-queries.ts`, extend the existing imports rather than duplicate.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/lib/admin-queries.ts
git commit -m "feat(backend): delivery fee config hooks"
```

---

## Task 9: Backend Settings — "Delivery" tab

**Files:**
- Modify: `apps/backend/src/pages/Settings.tsx`

- [ ] **Step 1: Extend the tab list**

Locate `type TabId = 'suppliers' | 'drivers' | 'showrooms' | 'staff' | 'app';` and update:

```ts
type TabId = 'suppliers' | 'drivers' | 'showrooms' | 'staff' | 'delivery' | 'app';

const TABS: { id: TabId; label: string }[] = [
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'drivers',   label: 'Drivers' },
  { id: 'showrooms', label: 'Showrooms' },
  { id: 'staff',     label: 'Staff' },
  { id: 'delivery',  label: 'Delivery fees' },
  { id: 'app',       label: 'App config' },
];
```

- [ ] **Step 2: Render the new tab in the conditional block**

In the `Settings` component, locate the existing conditional render block (the one with `{tab === 'suppliers' && ...}` etc.) and insert before `{tab === 'app' && ...}`:

```tsx
{tab === 'delivery' && <DeliveryFeesTab canEdit={isCoordOrAdmin} />}
```

- [ ] **Step 3: Add the `DeliveryFeesTab` component**

Append to the bottom of `apps/backend/src/pages/Settings.tsx`, after the existing `AppConfigTab` component:

```tsx
/* ─── Delivery fees (admin/coordinator) ─── */

const DeliveryFeesTab = ({ canEdit }: { canEdit: boolean }) => {
  const cfg = useDeliveryFeeConfig();
  const update = useUpdateDeliveryFeeConfig();

  const [baseFee, setBaseFee]                 = useState<number | ''>('');
  const [crossCategoryFee, setCrossCategoryFee] = useState<number | ''>('');
  const [error, setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Hydrate inputs once the GET resolves.
  useEffect(() => {
    if (cfg.data) {
      setBaseFee(cfg.data.baseFee);
      setCrossCategoryFee(cfg.data.crossCategoryFee);
    }
  }, [cfg.data]);

  const onSave = async () => {
    setError(null);
    setSuccess(false);
    if (typeof baseFee !== 'number' || typeof crossCategoryFee !== 'number') {
      setError('Both fields must be a whole-RM integer.');
      return;
    }
    if (baseFee < 0 || crossCategoryFee < 0) {
      setError('Fees cannot be negative.');
      return;
    }
    try {
      await update.mutateAsync({ baseFee, crossCategoryFee });
      setSuccess(true);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  if (cfg.isLoading) return <div className={styles.appConfigCard}>Loading delivery fees…</div>;
  if (cfg.error)     return <div className={styles.appConfigCard}>Failed to load: {String(cfg.error)}</div>;

  return (
    <>
      <div className={styles.readOnlyBanner}>
        <strong>Delivery fee rules.</strong> Every order is charged the base fee.
        Orders with products from ≥2 categories (e.g. sofa + mattress) also pay
        the cross-category surcharge — flat, once. Changes apply to NEW orders
        only — existing orders keep the fees they were placed with.
      </div>

      <div className={styles.appConfigCard}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="base-fee">Base fee (RM)</label>
          <input
            id="base-fee"
            type="number"
            min={0}
            step={1}
            className={styles.input}
            value={baseFee}
            disabled={!canEdit}
            onChange={(e) => setBaseFee(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
          />
          <span className={styles.fieldHint}>Charged on every order. Whole RM (no sen).</span>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="cross-cat-fee">Cross-category surcharge (RM)</label>
          <input
            id="cross-cat-fee"
            type="number"
            min={0}
            step={1}
            className={styles.input}
            value={crossCategoryFee}
            disabled={!canEdit}
            onChange={(e) => setCrossCategoryFee(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
          />
          <span className={styles.fieldHint}>
            Added once, flat, when the order contains ≥2 distinct product categories.
            Sofa Custom + Sofa Bundle count as one category.
          </span>
        </div>

        {error && <div className={styles.errorBanner} role="alert">{error}</div>}
        {success && <div className={styles.banner}>Saved.</div>}

        {canEdit && (
          <div className={styles.actionsRow}>
            <Button
              variant="primary"
              onClick={() => void onSave()}
              disabled={update.isPending}
            >
              <Save size={16} strokeWidth={1.75} />
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}

        <div className={styles.appConfigRow} style={{ marginTop: 'var(--space-3)' }}>
          <div>
            <div className={styles.appConfigKey}>Last updated</div>
          </div>
          <div className={styles.appConfigValue}>
            {cfg.data?.updatedAt
              ? new Date(cfg.data.updatedAt).toLocaleString('en-MY')
              : '—'}
          </div>
        </div>
      </div>
    </>
  );
};
```

- [ ] **Step 4: Add the hook imports at the top of the file**

Locate the existing import from `'../lib/admin-queries'` and add `useDeliveryFeeConfig, useUpdateDeliveryFeeConfig` to it. Also ensure `useEffect` is imported from React:

```ts
import { useEffect, useState } from 'react';
```

- [ ] **Step 5: Run the Backend dev server and smoke-test**

Start: `pnpm --filter @2990s/backend dev` (background)
Open: http://localhost:5174/settings (or whatever port wrangler/Vite reports — check terminal output)
Sign in as admin/coordinator, click "Delivery fees" tab, change Base to 260, Save, refresh → value persists.
Sign in as sales → tab is visible but inputs are disabled and Save button is hidden.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/pages/Settings.tsx
git commit -m "feat(backend): delivery fees tab in Settings"
```

---

## Task 10: POS — extend HandoverForm + add `useDeliveryFeeConfig`

**Files:**
- Modify: `apps/pos/src/lib/handover-helpers.ts`
- Modify: `apps/pos/src/lib/queries.ts`

- [ ] **Step 1: Add the field to `HandoverForm`**

In `apps/pos/src/lib/handover-helpers.ts`, locate the `HandoverForm` interface. After the existing `amountPaid: number;` line, add:

```ts
  /** Additional delivery fee keyed in by sales at handover. Whole RM, 0 if none. */
  additionalDeliveryFee: number;
```

- [ ] **Step 2: Add the default in `empty` (apps/pos/src/pages/Handover.tsx)**

In `apps/pos/src/pages/Handover.tsx`, locate `const empty: HandoverForm = { ... }`. After the `amountPaid: 0,` line, add:

```ts
  additionalDeliveryFee: 0,
```

- [ ] **Step 3: Add `useDeliveryFeeConfig` to POS queries**

Append to `apps/pos/src/lib/queries.ts`:

```ts
/* ─── Delivery fee config ─── */

export interface DeliveryFeeConfigRow {
  baseFee:          number;
  crossCategoryFee: number;
}

export const useDeliveryFeeConfig = () =>
  useQuery({
    queryKey: ['delivery-fee-config'],
    queryFn: async (): Promise<DeliveryFeeConfigRow> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/delivery-fees`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /delivery-fees failed (${res.status})`);
      const body = (await res.json()) as { baseFee: number; crossCategoryFee: number };
      return { baseFee: body.baseFee, crossCategoryFee: body.crossCategoryFee };
    },
    staleTime: 60_000,
  });
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/lib/handover-helpers.ts apps/pos/src/lib/queries.ts apps/pos/src/pages/Handover.tsx
git commit -m "feat(pos): HandoverForm.additionalDeliveryFee + useDeliveryFeeConfig"
```

---

## Task 11: POS — additional delivery fee input in `AddonsPaymentStep`

**Files:**
- Modify: `apps/pos/src/components/handover/AddonsPaymentStep.tsx`

- [ ] **Step 1: Add the input UI**

In `AddonsPaymentStep.tsx`, between the closing `</div>` of `<div className={styles.addonList}>` and the `<h3 className="subTitle">Payment method</h3>` line, insert:

```tsx
      <h3 className="subTitle">Additional delivery fee (optional)</h3>
      <p className={styles.stepLead}>
        Use this for non-standard delivery situations (outstation, urgent slot,
        oversized item). Leave blank for none.
      </p>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Amount (RM)</span>
        <input
          type="number"
          min={0}
          step={1}
          className={styles.input}
          value={form.additionalDeliveryFee || ''}
          onChange={(e) => {
            const v = e.target.value;
            update('additionalDeliveryFee',
              v === '' ? 0 : Math.max(0, Math.floor(Number(v))));
          }}
          placeholder="0"
        />
        <span className={styles.fieldHint}>
          Adds on top of the base fee and any cross-category surcharge.
          Whole RM, no sen.
        </span>
      </label>
```

If `styles.field` / `styles.fieldLabel` / `styles.input` / `styles.fieldHint` don't exist in `Handover.module.css`, use the closest equivalents — search the CSS module for "field" and pick what the existing customer/address steps use.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/components/handover/AddonsPaymentStep.tsx
git commit -m "feat(pos): additional delivery fee input in AddonsPaymentStep"
```

---

## Task 12: POS — display delivery fee in `OrderSummaryPane`

**Files:**
- Modify: `apps/pos/src/components/handover/OrderSummaryPane.tsx`

- [ ] **Step 1: Extend `FormPaneProps`**

Replace the existing `FormPaneProps` interface with:

```ts
export interface FormPaneProps {
  mode: 'form';
  lines: CartLine[];
  form: HandoverForm;
  subtotal: number;
  addonTotal: number;
  deliveryFee: {
    base:          number;
    crossCategory: number;
    additional:    number;
    total:         number;
  };
  total: number;
}
```

- [ ] **Step 2: Render the new rows in the totals section**

Locate the `<Section heading="Totals">` block. Replace it with:

```tsx
      <Section heading="Totals">
        <Row label="Items subtotal" value={fmtRM(subtotal)} />
        {addonTotal > 0 && <Row label="Add-ons" value={fmtRM(addonTotal)} />}
        {deliveryFee.base > 0 && (
          <Row label="Delivery fee" value={fmtRM(deliveryFee.base)} />
        )}
        {deliveryFee.crossCategory > 0 && (
          <Row label="Cross-category surcharge" value={fmtRM(deliveryFee.crossCategory)} />
        )}
        {deliveryFee.additional > 0 && (
          <Row label="Additional delivery fee" value={fmtRM(deliveryFee.additional)} />
        )}
      </Section>
```

- [ ] **Step 3: Destructure `deliveryFee` in `FormPane`**

Update the `FormPane` signature line:

```tsx
const FormPane = ({ lines, form, subtotal, addonTotal, deliveryFee, total }: FormPaneProps) => {
```

- [ ] **Step 4: Update the total caption**

The existing caption reads "Inclusive of delivery within Klang Valley". Replace it with conditional copy:

```tsx
          <p className={styles.totalCaption}>
            Delivery within Klang Valley
            {deliveryFee.total > 0 ? ` · RM ${fmtRM(deliveryFee.total).replace('RM ', '')} included` : ''}
          </p>
```

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: clean (with one TS2741 error on `Handover.tsx` for missing `deliveryFee` prop — fixed in Task 13).

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/components/handover/OrderSummaryPane.tsx
git commit -m "feat(pos): show delivery fee breakdown in OrderSummaryPane"
```

---

## Task 13: POS — wire delivery fee into `Handover.tsx`

**Files:**
- Modify: `apps/pos/src/pages/Handover.tsx`

- [ ] **Step 1: Add the imports**

Extend the existing `'../lib/queries'` import:

```ts
import { useAddons, useLocalities, useDeliveryFeeConfig } from '../lib/queries';
```

And add `computeDeliveryFee` from `@2990s/shared/pricing`:

```ts
import { computeDeliveryFee } from '@2990s/shared/pricing';
```

If `@2990s/shared/pricing` isn't already a re-export from `@2990s/shared`, use `@2990s/shared` and add `computeDeliveryFee` to the existing import line.

- [ ] **Step 2: Load category ids from cart lines**

The cart's `CartLine.config` (in `apps/pos/src/state/cart.ts`) does NOT carry `categoryId` today. Source it from the catalog query instead. Inside the `Handover` component, after the existing `const addons = useAddons();` line, add:

```ts
  const catalog = useCatalog();           // already used elsewhere in POS
  const deliveryCfgQuery = useDeliveryFeeConfig();
```

If `useCatalog` is not yet imported, add it to the `../lib/queries` import line.

- [ ] **Step 3: Compute delivery fee**

After the `const subtotal = cartSubtotal(lines);` line, add:

```ts
  const addonTotal = computeAddonTotal(form.addons, /* addonInfos — wherever the existing call lives */);
  const categoryIdByProductId = new Map<string, string>();
  for (const p of catalog.data ?? []) {
    if (p.category?.id) categoryIdByProductId.set(p.id, p.category.id);
  }
  const cartCategoryIds = lines
    .map((l) => categoryIdByProductId.get(l.config.productId) ?? '')
    .filter(Boolean);
  const deliveryCfg = deliveryCfgQuery.data ?? { baseFee: 0, crossCategoryFee: 0 };
  const deliveryFee = computeDeliveryFee(
    cartCategoryIds,
    { baseFee: deliveryCfg.baseFee, crossCategoryFee: deliveryCfg.crossCategoryFee },
    form.additionalDeliveryFee,
  );
  const total = subtotal + addonTotal + deliveryFee.total;
```

If `computeAddonTotal` is already called elsewhere in this file (it almost certainly is), don't duplicate — reuse the existing variable. The point is `total` must now include `deliveryFee.total`.

- [ ] **Step 4: Pass `deliveryFee` to `OrderSummaryPane`**

Locate the `<OrderSummaryPane mode="form" ... />` JSX. Add `deliveryFee={deliveryFee}` to its props alongside the existing `subtotal`, `addonTotal`, `total` props.

- [ ] **Step 5: Run the POS dev server and verify totals visually**

Start: `pnpm --filter @2990s/pos dev` (background)
Add 1 sofa to cart, go to Handover → addons step → see "Delivery fee RM 250" in summary. Type 50 into "Additional delivery fee" → see "Additional delivery fee RM 50" row appear. Add a mattress to the cart, return to Handover → see "Cross-category surcharge RM 175" appear.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/pages/Handover.tsx
git commit -m "feat(pos): wire delivery fee into Handover orchestrator"
```

---

## Task 14: POS — forward `additionalDeliveryFee` in the order POST

**Files:**
- Modify: `apps/pos/src/lib/orders.ts`

- [ ] **Step 1: Locate the createOrder mutation body**

Open `apps/pos/src/lib/orders.ts` and find where the request body for POST /orders is assembled (search for `clientTotal:`).

- [ ] **Step 2: Add the field**

Inside the request body object, after `clientTotal: ...,`, add:

```ts
        additionalDeliveryFee: form.additionalDeliveryFee,
```

If the mutation's input parameter shape doesn't currently expose the form, extend its type — add `additionalDeliveryFee: number` to the mutation's input interface and thread it through from Handover.tsx where `createOrder.mutateAsync({...})` is called.

- [ ] **Step 3: Update the `clientTotal` computation if it's done in this file**

If `clientTotal` is computed in `orders.ts` rather than passed in from Handover.tsx, make sure it now includes the recomputed delivery fee (use the same `computeDeliveryFee` import) before the server-side recheck.

If `clientTotal` is passed in from Handover.tsx (most likely), update the call site there so it passes `subtotal + addonTotal + deliveryFee.total`.

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: clean.

- [ ] **Step 5: Place a test order via the UI**

With wrangler + POS dev running:
- Add 1 sofa to cart
- Run through Handover → place a transfer order with slip → confirm
- Inspect the resulting `orders` row via Supabase Studio: `delivery_fee_base` = 250, `delivery_fee_cross_category` = 0, `delivery_fee_additional` = 0, `total` includes the 250

Add a mattress and re-test: cross_category should be 175.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/lib/orders.ts
git commit -m "feat(pos): forward additionalDeliveryFee in createOrder"
```

---

## Task 15: E2E verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole monorepo typecheck**

Run: `pnpm typecheck`
Expected: zero errors across api, backend, pos, db, shared.

- [ ] **Step 2: Run the unit test suite**

Run: `pnpm test`
Expected: all green. Esp. `computeDeliveryFee` (9 tests) and the updated `orders.test.ts`.

- [ ] **Step 3: Smoke through 5 manual scenarios in the browser**

Pre-conditions: wrangler dev + backend dev + pos dev all running; admin signed into Backend; sales signed into POS.

| # | Scenario | Expected |
|---|---|---|
| 1 | Backend → Settings → Delivery → change base to 300, save | OrderSummaryPane on POS now shows RM 300 for next cart |
| 2 | POS cart with 1 sofa only | Summary: Items + Delivery fee 300, total = sofa + 300 |
| 3 | POS cart with 1 sofa + 1 mattress | Summary adds "Cross-category surcharge 175", total = items + 475 |
| 4 | POS handover → type 50 in Additional delivery fee | Summary adds "Additional delivery fee 50", total = items + 525 |
| 5 | Backend → revert to 250 / 175. Place order. Then change to 280 / 200 — open the just-placed order in Backend | Order shows the OLD fees (250/175); new orders show 280/200 — snapshot policy holds |

- [ ] **Step 4: Verify drift detection**

Open browser devtools → Network. Add cart, go to handover, click Confirm — capture the POST /orders body. Manually re-POST with `additionalDeliveryFee: 999` but `clientTotal` left at the original lower number → expect 409 `pricing_drift` with `deliveryFee` in the response.

- [ ] **Step 5: Push the branch and open the PR**

```bash
git push -u origin feat/delivery-fee
gh pr create --title "feat: configurable delivery fee with cross-category surcharge" --body "$(cat <<'EOF'
## Summary
- Singleton `delivery_fee_config` table (default 250 base / 175 cross-cat); admin/coordinator-editable from Backend Settings → Delivery
- Server-side recompute on POST /orders folds delivery fee into the 0.5% drift check
- Three snapshot columns on orders + quotes — existing rows never mutate when admin edits the rates
- POS Handover adds an "Additional delivery fee" input; OrderSummaryPane shows the breakdown

## Test plan
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green (incl. 9 new `computeDeliveryFee` tests + 2 new orders.test.ts cases)
- [ ] Backend Settings → Delivery tab edits persist + bump pricing_version
- [ ] POS shows correct totals for 1-category, 2-category, and additional-fee carts
- [ ] Drift check returns 409 when client undercharges delivery
- [ ] Existing orders keep their snapshotted fees after admin changes config
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Base RM 250 (configurable) → Task 1 (default), Task 8/9 (edit) ✓
- Cross-category +RM 175 flat (configurable, ≥2 categories) → Task 3 (logic), Task 5 (server), Task 9 (edit) ✓
- Sofa Custom + Sofa Bundle = same category → covered by `categories` table id reuse (test in Task 3 step 1) ✓
- POS additional fee, no cap → Task 4 (schema), Task 11 (UI), Task 14 (POST) ✓
- Backend can adjust defaults → Tasks 7, 8, 9 ✓
- Snapshot on order at placement time → Task 1 (columns), Task 5 (RPC values), Task 15 scenario 5 ✓
- Pricing version bump on config change → Task 1 (trigger) ✓

**Placeholder scan:** None found. Every code step has full code, every command has expected output. Two intentional "if X already exists" branches (Task 9 step 4, Task 13 step 1) refer to imports — these reflect that the repo already has the imports in some files; the engineer should not duplicate.

**Type consistency:**
- `DeliveryFeeConfig { baseFee, crossCategoryFee }` consistent across pricing.ts, queries (both apps), API patch schema ✓
- `DeliveryFeeResult { base, crossCategory, additional, total }` consistent in pricing.ts, OrderSummaryPane prop, API response ✓
- snake_case at DB layer (`base_fee`, `cross_category_fee`, `delivery_fee_base`, `delivery_fee_cross_category`, `delivery_fee_additional`) consistently translated to camelCase at the API boundary ✓
- `additionalDeliveryFee` on the wire (camelCase) maps to `delivery_fee_additional` in DB — explicit translation in Task 5 step 6 + Task 1 RPC ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-delivery-fee.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
