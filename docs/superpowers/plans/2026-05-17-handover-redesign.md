# Handover Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing 4-step `/handover` wizard with a 2-phase / 7-sub-step flow that pixel-matches Loo's new mocks, adds a live-bound right-side order-summary pane, and lands the user on a redesigned `/confirmed/:orderId` page with a category-themed hero photo. Add 4 new `orders` columns, 1 new `categories` column, and a Backend SKU Master widget for uploading category hero images.

**Architecture:** Single `useState<HandoverForm>` in `Handover.tsx` orchestrator; step components are stateless renderers receiving `{ form, update }`. `OrderSummaryPane` is a pure render of `{ form, lines }` and switches between `form` / `receipt` modes. Schema migration `0023` adds `customer_type`, `building_type`, `billing_same`, `salesperson_id` to `orders` and `hero_image_key` to `categories`, plus a `create_order_with_items` rewrite that also inserts `kind='addon'` rows. Backend gets a category hero upload endpoint and admin widget.

**Tech Stack:** React 19 (TS strict) + React Router 7 + CSS Modules + design-system tokens (existing), Zustand cart (unchanged), TanStack Query 5, Hono on CF Workers (API), Drizzle + Postgres + RLS (DB), Supabase Storage / R2 (R2 stays for slips, R2 bucket reused for category heroes via `category-heroes/<id>.jpg` key), Vitest + jsdom (existing in `apps/pos` after `pos-desktop-view` plan).

---

## Spec corrections (discovered while writing this plan)

1. **`create_order_with_items` SQL function must also be updated.** The current function (last touched in migration 0022) only inserts `order_items` rows with `kind='product'`. To support addons added at checkout (P2.1 in the new flow), the function must additionally iterate over `p->'addons'` and insert one `kind='addon'` row per selected addon, with `addon_id`, `floors_count`, `items_count`, `qty`, `unit_price`, and `line_total` populated server-side from the live `addons` table (NOT from client payload — server-side pricing recompute remains the law). Migration 0023 thus needs both an `ALTER TABLE` block AND a `CREATE OR REPLACE FUNCTION` block.

2. **`computeOrderTotal` in `@2990s/shared/pricing` needs an addon-total addition.** It currently sums product lines and recliner upgrades. Addons need to roll into the server-computed total so the pricing-drift check (`pricingDriftExceeds`) catches client-side total tampering on addon prices too.

3. **R2 public access for category heroes.** Existing R2 binding `SLIPS` is private (signed URLs). Category hero images need to be **publicly readable** (no signed-URL roundtrip on every Confirmed page mount). Two options surface in Task 18; we land on a dedicated public sub-prefix `category-heroes/` served via a public bucket policy override OR a CF Worker proxy route. Decision pinned in Task 18.

Net effect: 19 tasks, ~4-5 days for one engineer. Phases A-H below.

---

## File Structure

**Created:**

```
packages/db/migrations/
└── 0023_handover_redesign.sql                  NEW

packages/shared/src/schemas/
└── order-v1.schema.ts                          MODIFIED (extend OrderV1PostBody)

packages/shared/src/pricing.ts                  MODIFIED (addon total)

apps/api/src/routes/
├── orders.ts                                   MODIFIED (pass new fields)
└── categories.ts                               NEW (hero upload endpoint + GET)

apps/api/src/routes/orders.test.ts              MODIFIED (new fields coverage)
apps/api/src/routes/categories.test.ts          NEW

apps/pos/src/lib/
├── orders.ts                                   MODIFIED (OrderSubmitInput extension)
└── handover-helpers.ts                         NEW (pure helpers, TDD)

apps/pos/src/lib/handover-helpers.test.ts       NEW

apps/pos/src/pages/
├── Handover.tsx                                FULL REWRITE
├── Handover.module.css                         FULL REWRITE
├── Confirmed.tsx                               NEW
├── Confirmed.module.css                        NEW
├── Confirmed.print.css                         NEW
└── OrderConfirmed.{tsx,module.css}             DELETED

apps/pos/src/components/handover/
├── PhaseNav.tsx                                NEW
├── PhaseNav.module.css                         NEW
├── StepFooter.tsx                              NEW
├── StepFooter.module.css                       NEW
├── OrderSummaryPane.tsx                        NEW
├── OrderSummaryPane.module.css                 NEW
├── CustomerStep.tsx                            NEW
├── AddressStep.tsx                             NEW
├── EmergencyStep.tsx                           NEW
├── TargetDateStep.tsx                          NEW
├── MonthCalendar.tsx                           NEW
├── MonthCalendar.module.css                    NEW
├── AddonsPaymentStep.tsx                       NEW
├── AddonCard.tsx                               NEW
├── AddonCard.module.css                        NEW
├── ConfirmPaymentStep.tsx                      NEW
├── SignConfirmStep.tsx                         NEW
├── SignaturePad.tsx                            NEW (extracted from old Handover.tsx)
├── SignaturePad.module.css                     NEW
├── Hero.tsx                                    NEW
└── Hero.module.css                             NEW

apps/pos/src/router.tsx                         MODIFIED (route swap)

apps/backend/src/pages/
└── SkuMaster.tsx                               MODIFIED (add hero widget section)

apps/backend/src/components/
└── CategoryHeroUploader.tsx                    NEW

apps/backend/src/components/
└── CategoryHeroUploader.module.css             NEW
```

**Reused:**

```
apps/pos/src/components/SlipUploadStep.tsx      (reused inside ConfirmPaymentStep)
apps/pos/src/state/cart.ts                      (no change)
packages/db/src/schema.ts                       (Drizzle defs — add the 5 columns)
```

---

## Phase A — Schema + API (tasks 1-3)

### Task 1: Migration 0023 + Drizzle schema columns

**Files:**
- Create: `packages/db/migrations/0023_handover_redesign.sql`
- Modify: `packages/db/src/schema.ts` (add columns to `orders` and `categories`)

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/migrations/0023_handover_redesign.sql`:

```sql
-- 0023_handover_redesign.sql
-- Adds: orders.{customer_type, building_type, billing_same, salesperson_id},
-- categories.hero_image_key. Rewrites create_order_with_items to read the new
-- fields and to insert kind='addon' order_items rows from a p->'addons' array.
-- All new columns are nullable / defaulted so existing rows survive.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_type   text
    CHECK (customer_type IN ('new','existing')),
  ADD COLUMN IF NOT EXISTS building_type   text
    CHECK (building_type IN ('condo','landed','apartment','office','shop','other')),
  ADD COLUMN IF NOT EXISTS billing_same    boolean NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS salesperson_id  uuid REFERENCES staff(id);

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS hero_image_key  text;

-- Replace create_order_with_items: now reads customerType, buildingType,
-- billingSame, salespersonId, specialInstructions from payload; inserts
-- addon rows from p->'addons'. Body is byte-identical to 0022 except for
-- the marked sections.
CREATE OR REPLACE FUNCTION public.create_order_with_items(p jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_order_id        text;
  v_staff_id        uuid := auth.uid();
  v_showroom_id     uuid;
  v_pricing_version text;
  v_session_id      uuid;
  v_session_row     pending_slip_uploads%ROWTYPE;
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

  -- ─── Slip session validation (unchanged from 0022) ─────────────────────────
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

  -- ─── INSERT orders (NEW: 4 extra columns) ──────────────────────────────────
  INSERT INTO orders (
    id, staff_id, showroom_id, lane,
    customer_name, customer_phone, customer_email,
    customer_address, customer_address_line2,
    customer_postcode, customer_city, customer_state,
    customer_type, building_type, billing_same, salesperson_id,         -- NEW
    subtotal, addon_total, total, paid,
    pricing_version,
    payment_method, approval_code,
    notes, delivery_notes,                                              -- delivery_notes NEW
    delivery_date, delivery_slot, delivery_tbd,                         -- delivery_tbd NEW
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
    NULLIF(p->>'customerType', ''),                                     -- NEW
    NULLIF(p->>'buildingType', ''),                                     -- NEW
    COALESCE((p->>'billingSame')::boolean, TRUE),                       -- NEW
    NULLIF(p->>'salespersonId', '')::uuid,                              -- NEW
    (p->>'subtotal')::int,
    COALESCE((p->>'addonTotal')::int, 0),
    (p->>'total')::int,
    COALESCE((p->>'paid')::int, 0),
    v_pricing_version,
    (p->>'paymentMethod')::payment_method,
    NULLIF(p->>'approvalCode', ''),
    NULLIF(p->>'notes', ''),
    NULLIF(p->>'specialInstructions', ''),                              -- NEW (→ delivery_notes)
    NULLIF(p->>'deliveryDate', '')::date,
    NULLIF(p->>'deliverySlot', ''),
    COALESCE((p->>'addressLater')::boolean, FALSE),                     -- → delivery_tbd
    v_session_row.r2_key,
    CASE WHEN v_session_row.id IS NOT NULL
         THEN 'pending'::slip_state
         ELSE 'none'::slip_state END
  );

  -- ─── INSERT order_items (product lines — unchanged from 0022) ──────────────
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

  -- ─── INSERT order_items (addon lines — NEW in 0023) ────────────────────────
  -- Server reads CURRENT addon prices from the addons table — client-submitted
  -- prices in p->'addons' are IGNORED. This keeps the "honest pricing"
  -- promise even when a tampered POS submits free addons.
  INSERT INTO order_items (
    order_id, kind, addon_id, qty, unit_price, line_total,
    floors_count, items_count
  )
  SELECT
    v_order_id,
    'addon'::order_item_kind,
    a.id,
    COALESCE((ad->>'qty')::int, 1),
    a.price,                                                            -- server-side price
    CASE
      WHEN a.kind = 'floors_items' THEN
        -- Canonical lift formula (packages/shared/src/pricing.ts:23):
        -- first 2 floors free; charge per_floor_item only for floors 3 and above
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

  -- ─── Promote slip session (unchanged from 0022) ────────────────────────────
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

- [ ] **Step 2: Run the migration**

```bash
pnpm db:push
```

Expected output:
```
Applying migration 0023_handover_redesign.sql... OK
```

- [ ] **Step 3: Verify schema via psql or `mcp__90e300c3-..._list_tables`**

Run `\d orders` (or via Supabase MCP):
- Confirm columns: `customer_type`, `building_type`, `billing_same`, `salesperson_id`
- Confirm CHECK constraints on the first two
- Confirm FK from `salesperson_id` → `staff(id)`

Run `\d categories`:
- Confirm column: `hero_image_key text`

- [ ] **Step 4: Update Drizzle schema in `packages/db/src/schema.ts`**

In the `orders` pgTable definition (after `customerState`):

```ts
customerType:   text('customer_type'),   // 'new' | 'existing'
buildingType:   text('building_type'),   // 'condo'|'landed'|'apartment'|'office'|'shop'|'other'
billingSame:    boolean('billing_same').notNull().default(true),
salespersonId:  uuid('salesperson_id').references(() => staff.id),
```

In the `categories` pgTable definition (after `tbc`):

```ts
heroImageKey: text('hero_image_key'),
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @2990s/db typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0023_handover_redesign.sql packages/db/src/schema.ts
git commit -m "feat(db): 0023 — orders {customer_type, building_type, billing_same, salesperson_id} + categories.hero_image_key"
```

---

### Task 2: Extend `OrderV1PostBody` schema + pricing addon-total

**Files:**
- Modify: `packages/shared/src/schemas/order-v1.schema.ts`
- Modify: `packages/shared/src/pricing.ts`
- Modify: `packages/shared/src/pricing.test.ts` (if exists; if not create)

- [ ] **Step 1: Add new fields to Zod schema**

Open `packages/shared/src/schemas/order-v1.schema.ts`. Locate the `orderV1PostSchema` definition. Add to the top-level object:

```ts
customerType:        z.enum(['new', 'existing']).optional(),
buildingType:        z.enum(['condo','landed','apartment','office','shop','other']).optional(),
billingSame:         z.boolean().optional(),                  // omitted = true on server
salespersonId:       z.string().uuid().optional(),            // omitted = use staff_id
specialInstructions: z.string().max(1000).optional(),
addressLater:        z.boolean().optional(),
addons: z.array(z.object({
  addonId: z.string(),
  qty: z.number().int().positive().optional(),
  floorsCount: z.number().int().nonnegative().optional(),
  itemsCount: z.number().int().nonnegative().optional(),
})).optional(),
```

Update the exported TS type `OrderV1PostBody` (Zod inference picks this up automatically if the type is derived from the schema).

- [ ] **Step 2: Write failing pricing test for addon total**

Create or extend `packages/shared/src/pricing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeOrderTotal } from './pricing';

describe('computeOrderTotal addons', () => {
  it('adds qty-kind addon to total', () => {
    const result = computeOrderTotal({
      lines: [/* one flat product RM 2990 */],
      addons: [{ addonId: 'dispose-mattress', qty: 2 }],
      addonInfos: {
        'dispose-mattress': { kind: 'qty', price: 120, perFloorItem: 0 },
      },
      // ...other deps
    });
    expect(result.addonTotal).toBe(240); // 2 × 120
    expect(result.total).toBe(2990 + 240);
  });

  it('adds floors_items addon (lift) — first 2 floors free', () => {
    const result = computeOrderTotal({
      lines: [/* ... */],
      addons: [{ addonId: 'lift', floorsCount: 5, itemsCount: 2 }],
      addonInfos: {
        lift: { kind: 'floors_items', price: 0, perFloorItem: 50 },
      },
    });
    // max(0, 5-2) × 2 × 50 = 300
    expect(result.addonTotal).toBe(300);
  });

  it('floors_items 0 when floors ≤ 2 (within free floors)', () => {
    const result = computeOrderTotal({
      lines: [/* ... */],
      addons: [{ addonId: 'lift', floorsCount: 2, itemsCount: 5 }],
      addonInfos: {
        lift: { kind: 'floors_items', price: 0, perFloorItem: 50 },
      },
    });
    expect(result.addonTotal).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test — should fail**

```bash
pnpm --filter @2990s/shared test pricing.test
```

Expected: 2 failures (no `addonTotal` in result, or function signature mismatch).

- [ ] **Step 4: Implement addon total in `computeOrderTotal`**

In `packages/shared/src/pricing.ts`, extend the function signature to accept `addons` and `addonInfos`, and compute `addonTotal`:

```ts
export interface OrderLineInput { /* existing */ }
export interface AddonInput {
  addonId: string;
  qty?: number;
  floorsCount?: number;
  itemsCount?: number;
}
export interface AddonInfo {
  kind: 'qty' | 'floors_items' | 'flat';
  price: number;
  perFloorItem: number | null;
}

export interface OrderTotalResult {
  subtotal: number;        // product lines only
  addonTotal: number;      // NEW
  total: number;            // subtotal + addonTotal
  lineBreakdowns: LineBreakdown[];
}

export const computeOrderTotal = (input: {
  lines: OrderLineInput[];
  addons?: AddonInput[];
  addonInfos?: Record<string, AddonInfo>;
  /* other existing deps */
}): OrderTotalResult => {
  /* existing product-line sum → subtotal */

  let addonTotal = 0;
  for (const a of input.addons ?? []) {
    const info = input.addonInfos?.[a.addonId];
    if (!info) continue;  // ignore unknown
    if (info.kind === 'floors_items') {
      // Canonical lift math (see packages/shared/src/pricing.ts:23):
      // first 2 floors free; perFloorItem applies only from floor 3 up.
      addonTotal +=
        Math.max(0, (a.floorsCount ?? 0) - 2)
        * (a.itemsCount ?? 0)
        * (info.perFloorItem ?? 0);
    } else {
      addonTotal += info.price * (a.qty ?? 1);
    }
  }

  return {
    subtotal,
    addonTotal,
    total: subtotal + addonTotal,
    lineBreakdowns,
  };
};
```

- [ ] **Step 5: Run tests — should pass**

```bash
pnpm --filter @2990s/shared test pricing.test
```

Expected: both tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas/order-v1.schema.ts packages/shared/src/pricing.ts packages/shared/src/pricing.test.ts
git commit -m "feat(shared): extend OrderV1PostBody with handover-redesign fields + addon total"
```

---

### Task 3: `POST /orders` reads new fields + addon validation

**Files:**
- Modify: `apps/api/src/routes/orders.ts`
- Modify: `apps/api/src/routes/orders.test.ts`

- [ ] **Step 1: Add a failing test in `orders.test.ts`**

Append to the test file (assume an existing test harness `await postOrder(body)` exists from prior tasks):

```ts
describe('POST /orders — handover redesign fields', () => {
  it('stores customer_type and building_type', async () => {
    const res = await postOrder({
      ...baseValidBody,
      customerType: 'new',
      buildingType: 'condo',
    });
    expect(res.status).toBe(200);
    const row = await db.from('orders').select('customer_type, building_type').eq('id', res.body.id).single();
    expect(row.data?.customer_type).toBe('new');
    expect(row.data?.building_type).toBe('condo');
  });

  it('persists addon line items with server-side prices', async () => {
    const res = await postOrder({
      ...baseValidBody,
      addons: [
        { addonId: 'dispose-mattress', qty: 1 },
        { addonId: 'lift', floorsCount: 3, itemsCount: 2 },
      ],
    });
    const items = await db.from('order_items')
      .select('addon_id, line_total')
      .eq('order_id', res.body.id)
      .eq('kind', 'addon');
    expect(items.data).toHaveLength(2);
    const lift = items.data?.find((i) => i.addon_id === 'lift');
    expect(lift?.line_total).toBe(300);  // 50 × 3 × 2
  });

  it('rejects unknown addon ids silently (filtered out)', async () => {
    const res = await postOrder({
      ...baseValidBody,
      addons: [{ addonId: 'definitely-not-a-real-addon' }],
    });
    expect(res.status).toBe(200);
    const items = await db.from('order_items').select().eq('order_id', res.body.id).eq('kind', 'addon');
    expect(items.data).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

```bash
pnpm --filter @2990s/api test orders.test
```

Expected: 3 new failures.

- [ ] **Step 3: Pass new fields through to `create_order_with_items`**

In `apps/api/src/routes/orders.ts`, locate the `supabase.rpc('create_order_with_items', { p: payloadJson })` call (or wherever the function is invoked). Update the JSON payload being built to include the new fields:

```ts
const payload = {
  ...existingFields,
  customerType:        dto.customerType,
  buildingType:        dto.buildingType,
  billingSame:         dto.billingSame,
  salespersonId:       dto.salespersonId,
  specialInstructions: dto.specialInstructions,
  addressLater:        dto.addressLater,
  addons:              dto.addons,
};
```

Also load addon prices to feed `computeOrderTotal`:

```ts
const addonIdsAtCheckout = (dto.addons ?? []).map((a) => a.addonId);
const allAddonIds = Array.from(new Set([...addonIds, ...addonIdsAtCheckout]));

// (existing addonsRes query becomes:)
supabase.from('addons')
  .select('id, kind, price, per_floor_item, enabled')
  .in('id', allAddonIds)
```

Then pass addons + addonInfos to `computeOrderTotal`:

```ts
const addonInfos = Object.fromEntries(
  (addonsRes.data ?? [])
    .filter((a) => a.enabled)
    .map((a) => [a.id, { kind: a.kind, price: a.price, perFloorItem: a.per_floor_item }]),
);

const totals = computeOrderTotal({
  lines: orderLines,
  addons: dto.addons,
  addonInfos,
  /* ...existing deps */
});
```

- [ ] **Step 4: Run tests — should pass**

```bash
pnpm --filter @2990s/api test orders.test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/orders.ts apps/api/src/routes/orders.test.ts
git commit -m "feat(api): POST /orders accepts handover-redesign fields + addon line items"
```

---

## Phase B — Pure helpers + unit tests (task 4)

### Task 4: `handover-helpers.ts` — validators, calendar, addon total, first-name

**Files:**
- Create: `apps/pos/src/lib/handover-helpers.ts`
- Create: `apps/pos/src/lib/handover-helpers.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `apps/pos/src/lib/handover-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  validateCustomer,
  validateAddress,
  validateEmergency,
  validateTargetDate,
  validateAddonsPayment,
  validateConfirmPayment,
  validateSign,
  computeMinCalendarDate,
  computeAddonTotal,
  firstName,
  type HandoverForm,
  type AddonInfo,
} from './handover-helpers';

const baseForm: HandoverForm = {
  name: '', phone: '', email: '', salespersonId: '', customerType: 'new',
  addressLater: false, fullAddress: '', postcode: '', city: '', state: '',
  buildingType: '', billingSame: true,
  emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  deliveryDate: '', specialInstructions: '',
  addons: {}, paymentMethod: '',
  amountPaid: 0, paymentPreset: 'full', approvalCode: '',
  slipUploadSessionId: null, paymentRecorded: false,
  signed: false,
};

describe('validateCustomer', () => {
  it('requires name and valid email', () => {
    expect(validateCustomer(baseForm)).toBe(false);
    expect(validateCustomer({ ...baseForm, name: 'Loo' })).toBe(false);
    expect(validateCustomer({ ...baseForm, name: 'Loo', email: 'invalid' })).toBe(false);
    expect(validateCustomer({ ...baseForm, name: 'Loo', email: 'a@b.com' })).toBe(true);
  });
});

describe('validateAddress', () => {
  it('passes when addressLater', () => {
    expect(validateAddress({ ...baseForm, addressLater: true })).toBe(true);
  });
  it('requires all fields when not addressLater', () => {
    const filled = {
      ...baseForm, addressLater: false,
      fullAddress: 'X', postcode: '50480', city: 'KL', state: 'Selangor',
      buildingType: 'condo' as const,
    };
    expect(validateAddress(filled)).toBe(true);
    expect(validateAddress({ ...filled, buildingType: '' })).toBe(false);
  });
});

describe('validateEmergency', () => {
  it('passes when all three empty (optional)', () => {
    expect(validateEmergency(baseForm)).toBe(true);
  });
  it('fails when any one is filled but not all three', () => {
    expect(validateEmergency({ ...baseForm, emergencyName: 'X' })).toBe(false);
    expect(validateEmergency({ ...baseForm, emergencyName: 'X', emergencyRelation: 'Wife' })).toBe(false);
  });
  it('passes when all three filled', () => {
    expect(validateEmergency({
      ...baseForm,
      emergencyName: 'X', emergencyRelation: 'Wife', emergencyPhone: '012',
    })).toBe(true);
  });
});

describe('validateTargetDate', () => {
  it('passes if addressLater (no date needed)', () => {
    expect(validateTargetDate({ ...baseForm, addressLater: true })).toBe(true);
  });
  it('requires a date otherwise', () => {
    expect(validateTargetDate(baseForm)).toBe(false);
    expect(validateTargetDate({ ...baseForm, deliveryDate: '2026-06-04' })).toBe(true);
  });
});

describe('validateAddonsPayment', () => {
  it('requires paymentMethod', () => {
    expect(validateAddonsPayment(baseForm)).toBe(false);
    expect(validateAddonsPayment({ ...baseForm, paymentMethod: 'debit' })).toBe(true);
  });
});

describe('validateConfirmPayment', () => {
  const subtotal = 2990;
  it('requires recorded, code, amount in range', () => {
    const f = { ...baseForm, paymentMethod: 'debit' as const, amountPaid: 2990, approvalCode: '123', paymentRecorded: true };
    expect(validateConfirmPayment(f, subtotal, 0)).toBe(true);
    expect(validateConfirmPayment({ ...f, approvalCode: '' }, subtotal, 0)).toBe(false);
    expect(validateConfirmPayment({ ...f, amountPaid: 100 }, subtotal, 0)).toBe(false);  // < 50%
    expect(validateConfirmPayment({ ...f, paymentRecorded: false }, subtotal, 0)).toBe(false);
  });
  it('requires slip session when paymentMethod=transfer', () => {
    const f = { ...baseForm, paymentMethod: 'transfer' as const, amountPaid: 2990, approvalCode: '123', paymentRecorded: true };
    expect(validateConfirmPayment(f, subtotal, 0)).toBe(false);
    expect(validateConfirmPayment({ ...f, slipUploadSessionId: 'sess' }, subtotal, 0)).toBe(true);
  });
});

describe('validateSign', () => {
  it('requires signed=true', () => {
    expect(validateSign(baseForm)).toBe(false);
    expect(validateSign({ ...baseForm, signed: true })).toBe(true);
  });
});

describe('computeMinCalendarDate', () => {
  it('returns tomorrow in YYYY-MM-DD', () => {
    const today = new Date('2026-05-17T00:00:00');
    expect(computeMinCalendarDate(today)).toBe('2026-05-18');
  });
  it('wraps month boundary', () => {
    const lastDay = new Date('2026-05-31T00:00:00');
    expect(computeMinCalendarDate(lastDay)).toBe('2026-06-01');
  });
});

describe('computeAddonTotal', () => {
  const infos: Record<string, AddonInfo> = {
    'dispose-mattress': { kind: 'qty', price: 120, perFloorItem: 0 },
    lift: { kind: 'floors_items', price: 0, perFloorItem: 50 },
  };
  it('sums qty addons', () => {
    expect(computeAddonTotal({ 'dispose-mattress': { selected: true, expanded: true, qty: 2 } }, infos)).toBe(240);
  });
  it('sums floors_items addons (first 2 floors free)', () => {
    // max(0, 5-2) × 2 × 50 = 300
    expect(computeAddonTotal({ lift: { selected: true, expanded: true, floorsCount: 5, itemsCount: 2 } }, infos)).toBe(300);
  });
  it('floors_items returns 0 when floors ≤ 2', () => {
    expect(computeAddonTotal({ lift: { selected: true, expanded: true, floorsCount: 2, itemsCount: 5 } }, infos)).toBe(0);
  });
  it('ignores unselected addons', () => {
    expect(computeAddonTotal({ 'dispose-mattress': { selected: false, expanded: false, qty: 1 } }, infos)).toBe(0);
  });
});

describe('firstName', () => {
  it('extracts first whitespace-delimited token', () => {
    expect(firstName('Lim Mei Hua')).toBe('Lim');
    expect(firstName('  Aisyah   Wong  ')).toBe('Aisyah');
    expect(firstName('Loo')).toBe('Loo');
    expect(firstName('')).toBe('');
  });
});
```

- [ ] **Step 2: Run tests — should fail**

```bash
pnpm --filter @2990s/pos test handover-helpers
```

Expected: all tests fail with "Cannot find module './handover-helpers'".

- [ ] **Step 3: Implement `handover-helpers.ts`**

Create `apps/pos/src/lib/handover-helpers.ts`:

```ts
export type CustomerType = 'new' | 'existing';
export type BuildingType = '' | 'condo' | 'landed' | 'apartment' | 'office' | 'shop' | 'other';
export type PaymentMethod = '' | 'credit' | 'debit' | 'transfer' | 'installment';
export type PaymentPreset = 'half' | 'full' | 'seventy' | 'custom';

export interface AddonSelection {
  selected: boolean;
  expanded: boolean;
  floorsCount?: number;
  itemsCount?: number;
  qty?: number;
}

export interface AddonInfo {
  kind: 'qty' | 'floors_items' | 'flat';
  price: number;
  perFloorItem: number;
}

export interface HandoverForm {
  name: string; phone: string; email: string;
  salespersonId: string; customerType: CustomerType;

  addressLater: boolean;
  fullAddress: string; postcode: string; city: string; state: string;
  buildingType: BuildingType;
  billingSame: boolean;

  emergencyName: string; emergencyRelation: string; emergencyPhone: string;

  deliveryDate: string; specialInstructions: string;

  addons: Record<string, AddonSelection>;
  paymentMethod: PaymentMethod;

  amountPaid: number;
  paymentPreset: PaymentPreset;
  approvalCode: string;
  slipUploadSessionId: string | null;
  paymentRecorded: boolean;

  signed: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateCustomer = (f: HandoverForm): boolean =>
  f.name.trim().length > 0 && EMAIL_RE.test(f.email.trim());

export const validateAddress = (f: HandoverForm): boolean =>
  f.addressLater ||
  (
    f.fullAddress.trim().length > 0 &&
    f.postcode.trim().length > 0 &&
    f.city.trim().length > 0 &&
    f.state.trim().length > 0 &&
    f.buildingType !== ''
  );

export const validateEmergency = (f: HandoverForm): boolean => {
  const filledCount = [f.emergencyName, f.emergencyRelation, f.emergencyPhone].filter((v) => v.trim()).length;
  return filledCount === 0 || filledCount === 3;
};

export const validateTargetDate = (f: HandoverForm): boolean =>
  f.addressLater || f.deliveryDate.length > 0;

export const validateAddonsPayment = (f: HandoverForm): boolean =>
  f.paymentMethod !== '';

export const validateConfirmPayment = (f: HandoverForm, subtotal: number, addonTotal: number): boolean => {
  const total = subtotal + addonTotal;
  const halfTotal = Math.round(total / 2);
  if (f.amountPaid < halfTotal || f.amountPaid > total) return false;
  if (f.approvalCode.trim().length === 0) return false;
  if (!f.paymentRecorded) return false;
  if (f.paymentMethod === 'transfer' && f.slipUploadSessionId === null) return false;
  return true;
};

export const validateSign = (f: HandoverForm): boolean => f.signed;

export const computeMinCalendarDate = (today: Date): string => {
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const d = String(tomorrow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const computeAddonTotal = (
  selections: Record<string, AddonSelection>,
  infos: Record<string, AddonInfo>,
): number => {
  let total = 0;
  for (const [id, sel] of Object.entries(selections)) {
    if (!sel.selected) continue;
    const info = infos[id];
    if (!info) continue;
    if (info.kind === 'floors_items') {
      // Canonical lift math: first 2 floors free (see packages/shared/src/pricing.ts:23)
      total += Math.max(0, (sel.floorsCount ?? 0) - 2) * (sel.itemsCount ?? 0) * info.perFloorItem;
    } else {
      total += info.price * (sel.qty ?? 1);
    }
  }
  return total;
};

export const firstName = (fullName: string): string => {
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0]!;
};
```

- [ ] **Step 4: Run tests — should pass**

```bash
pnpm --filter @2990s/pos test handover-helpers
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/lib/handover-helpers.ts apps/pos/src/lib/handover-helpers.test.ts
git commit -m "feat(pos): handover-helpers — validators + calendar minDate + addon total + firstName"
```

---

## Phase C — Handover skeleton + chrome (tasks 5-7)

### Task 5: New `Handover.tsx` orchestrator + state model + step routing

**Files:**
- Modify: `apps/pos/src/pages/Handover.tsx` (full rewrite — back up first or rely on git history)
- Create: `apps/pos/src/pages/Handover.module.css` (full rewrite)
- Modify: `apps/pos/src/lib/orders.ts` (extend `OrderSubmitInput`)

- [ ] **Step 1: Back up current Handover via git checkpoint**

```bash
git checkout -b handover-redesign
```

Stash or commit current uncommitted Handover.tsx work to a save-point branch if you want to easily diff later. The git history already has the file's prior state.

- [ ] **Step 2: Extend `OrderSubmitInput`**

In `apps/pos/src/lib/orders.ts`, extend the interface:

```ts
export interface OrderSubmitInput {
  customer: OrderV1PostBody['customer'];
  paymentMethod: NonNullable<OrderV1PostBody['paymentMethod']>;
  approvalCode?: string;
  notes?: string;
  deliveryDate?: string;
  lines: CartLine[];
  acceptedServerTotal?: number;
  uploadSessionId?: string;

  // NEW
  customerType?: 'new' | 'existing';
  buildingType?: 'condo'|'landed'|'apartment'|'office'|'shop'|'other';
  billingSame?: boolean;
  salespersonId?: string;
  specialInstructions?: string;
  addressLater?: boolean;
  addons?: { addonId: string; qty?: number; floorsCount?: number; itemsCount?: number }[];
}
```

Remove the old `deliverySlot` parameter (already removed in earlier cleanup).

Update `buildPostBody` to spread the new fields:

```ts
return {
  customer: input.customer,
  paymentMethod: input.paymentMethod,
  ...(input.approvalCode ? { approvalCode: input.approvalCode } : {}),
  ...(input.notes ? { notes: input.notes } : {}),
  ...(input.deliveryDate ? { deliveryDate: input.deliveryDate } : {}),
  ...(input.customerType ? { customerType: input.customerType } : {}),
  ...(input.buildingType ? { buildingType: input.buildingType } : {}),
  ...(input.billingSame !== undefined ? { billingSame: input.billingSame } : {}),
  ...(input.salespersonId ? { salespersonId: input.salespersonId } : {}),
  ...(input.specialInstructions ? { specialInstructions: input.specialInstructions } : {}),
  ...(input.addressLater !== undefined ? { addressLater: input.addressLater } : {}),
  ...(input.addons && input.addons.length > 0 ? { addons: input.addons } : {}),
  lines,
  clientTotal,
  ...(input.uploadSessionId ? { uploadSessionId: input.uploadSessionId } : {}),
};
```

- [ ] **Step 3: Replace `apps/pos/src/pages/Handover.tsx` with the orchestrator skeleton**

```tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useCart, cartSubtotal } from '../state/cart';
import { useCreateOrder, PricingDriftError, type PricingDriftPayload } from '../lib/orders';
import { useAddons, useLocalities } from '../lib/queries';
import { useStaff } from '../lib/staff';
import {
  validateCustomer, validateAddress, validateEmergency, validateTargetDate,
  validateAddonsPayment, validateConfirmPayment, validateSign,
  computeAddonTotal,
  type HandoverForm, type AddonInfo,
} from '../lib/handover-helpers';
import { useSession } from '../lib/auth';
import { Topbar } from '../components/Topbar';
import { PhaseNav } from '../components/handover/PhaseNav';
import { StepFooter } from '../components/handover/StepFooter';
import { OrderSummaryPane } from '../components/handover/OrderSummaryPane';
import { CustomerStep } from '../components/handover/CustomerStep';
import { AddressStep } from '../components/handover/AddressStep';
import { EmergencyStep } from '../components/handover/EmergencyStep';
import { TargetDateStep } from '../components/handover/TargetDateStep';
import { AddonsPaymentStep } from '../components/handover/AddonsPaymentStep';
import { ConfirmPaymentStep } from '../components/handover/ConfirmPaymentStep';
import { SignConfirmStep } from '../components/handover/SignConfirmStep';
import { PricingDriftModal } from '../components/PricingDriftModal';
import styles from './Handover.module.css';

const STEPS = [
  { phase: 1 as const, key: 'customer',  label: 'Customer' },
  { phase: 1 as const, key: 'address',   label: 'Address' },
  { phase: 1 as const, key: 'emergency', label: 'Emergency' },
  { phase: 1 as const, key: 'target',    label: 'Target date' },
  { phase: 2 as const, key: 'addons',    label: 'Add-ons & payment' },
  { phase: 2 as const, key: 'confirm',   label: 'Confirm payment' },
  { phase: 2 as const, key: 'sign',      label: 'Sign & confirm' },
] as const;

type StepKey = typeof STEPS[number]['key'];

const empty: HandoverForm = {
  name: '', phone: '', email: '',
  salespersonId: '',  // populated on mount from session
  customerType: 'new',
  addressLater: false,
  fullAddress: '', postcode: '', city: '', state: '', buildingType: '',
  billingSame: true,
  emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  deliveryDate: '', specialInstructions: '',
  addons: {}, paymentMethod: '',
  amountPaid: 0, paymentPreset: 'full', approvalCode: '',
  slipUploadSessionId: null, paymentRecorded: false,
  signed: false,
};

export const Handover = () => {
  const navigate = useNavigate();
  const session = useSession();
  const lines = useCart((s) => s.lines);
  const clear = useCart((s) => s.clear);
  const subtotal = cartSubtotal(lines);

  const [idx, setIdx] = useState(0);
  const [form, setForm] = useState<HandoverForm>(() => ({
    ...empty,
    salespersonId: session.staffId ?? '',
  }));
  const [drift, setDrift] = useState<PricingDriftPayload | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const createOrder = useCreateOrder();
  const addons = useAddons();
  const localities = useLocalities();
  const staff = useStaff();

  const update = <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Empty cart guard.
  if (lines.length === 0) {
    return (
      <>
        <Topbar step="customer" />
        <main className={styles.shell}>
          <header className={styles.header}>
            <h1 className={styles.heading}>Handover</h1>
          </header>
          <p className={styles.empty}>
            Cart is empty. <Link to="/catalog">Back to catalog</Link>
          </p>
        </main>
      </>
    );
  }

  const current = STEPS[idx]!;
  const phase = current.phase;
  const isLast = idx === STEPS.length - 1;

  // Build addonInfos for total computation.
  const addonInfos: Record<string, AddonInfo> = Object.fromEntries(
    (addons.data ?? []).map((a) => [a.id, {
      kind: a.kind, price: a.price, perFloorItem: a.perFloorItem ?? 0,
    }]),
  );
  const addonTotal = computeAddonTotal(form.addons, addonInfos);
  const total = subtotal + addonTotal;

  // Validity per step.
  const validity: Record<StepKey, boolean> = {
    customer:  validateCustomer(form),
    address:   validateAddress(form),
    emergency: validateEmergency(form),
    target:    validateTargetDate(form),
    addons:    validateAddonsPayment(form),
    confirm:   validateConfirmPayment(form, subtotal, addonTotal),
    sign:      validateSign(form),
  };

  const goPrev = () => {
    if (idx > 0) setIdx(idx - 1);
    else navigate('/cart');
  };

  const goNext = async () => {
    const stepKey = current.key;
    if (!validity[stepKey]) return;
    if (isLast) {
      void submitOrder();
      return;
    }
    setIdx(idx + 1);
  };

  const submitOrder = async (acceptedServerTotal?: number) => {
    setServerError(null);
    try {
      const result = await createOrder.mutateAsync({
        customer: {
          name: form.name.trim(),
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.fullAddress.trim() || undefined,
          postcode: form.postcode.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
        },
        paymentMethod: form.paymentMethod as Exclude<typeof form.paymentMethod, ''>,
        approvalCode: form.approvalCode.trim() || undefined,
        deliveryDate: !form.addressLater && form.deliveryDate ? form.deliveryDate : undefined,
        customerType: form.customerType,
        buildingType: form.buildingType || undefined,
        billingSame: form.billingSame,
        salespersonId: form.salespersonId || undefined,
        specialInstructions: form.specialInstructions.trim() || undefined,
        addressLater: form.addressLater,
        addons: Object.entries(form.addons)
          .filter(([, s]) => s.selected)
          .map(([addonId, s]) => ({
            addonId,
            ...(s.qty !== undefined ? { qty: s.qty } : {}),
            ...(s.floorsCount !== undefined ? { floorsCount: s.floorsCount } : {}),
            ...(s.itemsCount !== undefined ? { itemsCount: s.itemsCount } : {}),
          })),
        lines,
        acceptedServerTotal,
        uploadSessionId: form.slipUploadSessionId ?? undefined,
      });
      clear();
      navigate(`/confirmed/${encodeURIComponent(result.id)}`, { replace: true });
    } catch (err) {
      if (err instanceof PricingDriftError) {
        setDrift(err.payload);
        return;
      }
      setServerError(err instanceof Error ? err.message : 'Order submission failed');
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void goNext();
  };

  return (
    <>
      <Topbar step="customer" />
      <main className={styles.shell}>
        <header className={styles.header}>
          <h1 className={styles.heading}>Handover</h1>
        </header>

        <PhaseNav
          phase={phase}
          steps={STEPS}
          currentIdx={idx}
          validity={validity}
          onJump={(targetIdx) => { if (targetIdx <= idx) setIdx(targetIdx); }}
        />

        <form className={styles.layout} onSubmit={onSubmit}>
          <div className={styles.main}>
            <div className={styles.phaseEyebrow}>
              PHASE {phase} OF 2 · {phase === 1 ? 'ADDITIONAL INFO' : 'CONFIRM & PAY'}
            </div>
            {current.key === 'customer'  && <CustomerStep  form={form} update={update} staff={staff.data ?? []} />}
            {current.key === 'address'   && <AddressStep   form={form} update={update} localities={localities.data ?? []} />}
            {current.key === 'emergency' && <EmergencyStep form={form} update={update} />}
            {current.key === 'target'    && <TargetDateStep form={form} update={update} />}
            {current.key === 'addons'    && <AddonsPaymentStep form={form} update={update} addons={addons.data ?? []} />}
            {current.key === 'confirm'   && <ConfirmPaymentStep form={form} update={update} subtotal={subtotal} addonTotal={addonTotal} />}
            {current.key === 'sign'      && <SignConfirmStep   form={form} update={update} />}

            {serverError && <p className={styles.error}>{serverError}</p>}

            <StepFooter
              isFirst={idx === 0}
              currentKey={current.key}
              valid={validity[current.key]}
              submitting={createOrder.isPending}
              paymentRecorded={form.paymentRecorded}
              onPrev={goPrev}
              onNext={goNext}
              onRecordPayment={() => update('paymentRecorded', true)}
            />
          </div>

          <OrderSummaryPane
            mode="form"
            lines={lines}
            form={form}
            subtotal={subtotal}
            addonTotal={addonTotal}
            total={total}
          />
        </form>

        {drift && (
          <PricingDriftModal
            drift={drift}
            submitting={createOrder.isPending}
            onAccept={(serverTotal) => { setDrift(null); void submitOrder(serverTotal); }}
            onCancel={() => setDrift(null)}
          />
        )}
      </main>
    </>
  );
};
```

- [ ] **Step 4: Replace `apps/pos/src/pages/Handover.module.css`**

```css
.shell {
  min-height: 100vh;
  background: var(--bg);
  padding: var(--space-5) var(--space-6);
  margin: 0 auto;
  width: 100%;
}

.header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}

.heading {
  font-family: var(--font-title);
  font-weight: var(--w-bold);
  font-size: var(--fs-32);
  margin: 0;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: var(--space-6);
  align-items: start;
}

.main {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-width: 0;
}

.phaseEyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-button);
  font-size: var(--fs-12);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--c-orange);
}
.phaseEyebrow::before {
  content: '';
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--c-orange);
}

.error {
  margin: 0;
  padding: var(--space-3);
  background: var(--c-error-bg);
  color: var(--c-error);
  border-radius: var(--radius-sm);
}

.empty {
  text-align: center;
  padding: var(--space-7);
}

@media (max-width: 1024px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Add stub files for each step (so the import doesn't break)**

Create these files with minimal placeholder bodies. The real implementations come in later tasks.

```bash
mkdir -p apps/pos/src/components/handover
```

Create each of the following with just a typed component stub:

```tsx
// apps/pos/src/components/handover/CustomerStep.tsx
import type { HandoverForm } from '../../lib/handover-helpers';
export const CustomerStep = (_p: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  staff: unknown[];
}) => <div>Customer step — TODO</div>;
```

Repeat the same stub shape for: `AddressStep.tsx`, `EmergencyStep.tsx`, `TargetDateStep.tsx`, `AddonsPaymentStep.tsx`, `ConfirmPaymentStep.tsx`, `SignConfirmStep.tsx`.

Also stub:

```tsx
// PhaseNav.tsx
export const PhaseNav = (_p: any) => <div>PhaseNav stub</div>;

// StepFooter.tsx
export const StepFooter = (_p: any) => <div>StepFooter stub</div>;

// OrderSummaryPane.tsx
export const OrderSummaryPane = (_p: any) => <aside>OrderSummaryPane stub</aside>;
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @2990s/pos typecheck
```

Expected: no errors. The app should compile.

- [ ] **Step 7: Visual smoke test**

In the running preview, navigate to `/handover`. Expect to see "Customer step — TODO" + stubs for chrome elements. Confirm no console errors.

```bash
# In preview tools
mcp__Claude_Preview__preview_eval { expression: "location.assign('/handover')" }
```

- [ ] **Step 8: Commit**

```bash
git add apps/pos/src/pages/Handover.tsx apps/pos/src/pages/Handover.module.css apps/pos/src/lib/orders.ts apps/pos/src/components/handover/
git commit -m "feat(pos): Handover orchestrator skeleton + step stubs"
```

---

### Task 6: `PhaseNav` + `StepFooter` chrome components

**Files:**
- Modify: `apps/pos/src/components/handover/PhaseNav.tsx`
- Create: `apps/pos/src/components/handover/PhaseNav.module.css`
- Modify: `apps/pos/src/components/handover/StepFooter.tsx`
- Create: `apps/pos/src/components/handover/StepFooter.module.css`

- [ ] **Step 1: Implement `PhaseNav.tsx`**

Render only the chips for the current phase. Past = green check, current = orange ring, future = grey. Past chips clickable.

```tsx
import { Check, User, MapPin, ShieldAlert, Calendar, Package, Banknote, PenLine } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import styles from './PhaseNav.module.css';

interface StepDef {
  phase: 1 | 2;
  key: string;
  label: string;
}

const ICON: Record<string, LucideIcon> = {
  customer: User, address: MapPin, emergency: ShieldAlert, target: Calendar,
  addons: Package, confirm: Banknote, sign: PenLine,
};

export const PhaseNav = ({
  phase, steps, currentIdx, validity, onJump,
}: {
  phase: 1 | 2;
  steps: readonly StepDef[];
  currentIdx: number;
  validity: Record<string, boolean>;
  onJump: (targetIdx: number) => void;
}) => {
  const phaseSteps = steps
    .map((s, i) => ({ step: s, idx: i }))
    .filter(({ step }) => step.phase === phase);

  return (
    <ol className={styles.chips}>
      {phaseSteps.map(({ step, idx: i }, position) => {
        const isCurrent = i === currentIdx;
        const isPast = i < currentIdx;
        const Icon = ICON[step.key] ?? User;
        return (
          <li
            key={step.key}
            className={`${styles.chip} ${isCurrent ? styles.chipCurrent : ''} ${isPast ? styles.chipPast : ''}`}
          >
            <button
              type="button"
              className={styles.chipBtn}
              onClick={() => isPast && onJump(i)}
              disabled={!isPast}
            >
              <span className={styles.chipNum}>
                {isPast ? <Check size={14} strokeWidth={2.25} /> : position + 1}
              </span>
              <span className={styles.chipLabel}>
                <Icon size={14} strokeWidth={1.75} />
                {step.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
};
```

- [ ] **Step 2: Create `PhaseNav.module.css`**

```css
.chips {
  display: flex;
  gap: var(--space-3);
  list-style: none;
  padding: 0;
  margin: 0;
  flex-wrap: wrap;
}

.chip {
  flex: 1 1 0;
  min-width: 0;
}

.chipBtn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--bg-alt);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  font: inherit;
  color: var(--fg-muted);
  cursor: not-allowed;
}

.chip.chipPast .chipBtn {
  background: var(--c-success-bg);
  color: var(--c-success);
  cursor: pointer;
}
.chip.chipCurrent .chipBtn {
  background: var(--bg);
  border-color: var(--c-orange);
  box-shadow: 0 0 0 1px var(--c-orange) inset;
  color: var(--c-orange);
  cursor: default;
}

.chipNum {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--line);
  color: var(--fg-muted);
  font-family: var(--font-button);
  font-weight: var(--w-semibold);
  font-size: var(--fs-12);
}
.chip.chipPast .chipNum    { background: var(--c-success); color: var(--c-cream); }
.chip.chipCurrent .chipNum { background: var(--c-orange);  color: var(--c-cream); }

.chipLabel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-button);
  font-weight: var(--w-semibold);
  font-size: var(--fs-13);
}
```

- [ ] **Step 3: Implement `StepFooter.tsx`**

```tsx
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@2990s/design-system';
import styles from './StepFooter.module.css';

export const StepFooter = ({
  isFirst, currentKey, valid, submitting, paymentRecorded,
  onPrev, onNext, onRecordPayment,
}: {
  isFirst: boolean;
  currentKey: 'customer'|'address'|'emergency'|'target'|'addons'|'confirm'|'sign';
  valid: boolean;
  submitting: boolean;
  paymentRecorded: boolean;
  onPrev: () => void;
  onNext: () => void | Promise<void>;
  onRecordPayment: () => void;
}) => {
  const isConfirm = currentKey === 'confirm';
  const isSign = currentKey === 'sign';

  const primaryLabel = isSign
    ? 'Complete order'
    : isConfirm && !paymentRecorded
      ? 'Confirm payment received'
      : isConfirm
        ? 'Continue to signature'
        : 'Continue';

  const handlePrimary = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isConfirm && !paymentRecorded) {
      onRecordPayment();
      return;
    }
    void onNext();
  };

  return (
    <div className={styles.bar}>
      {!isFirst ? (
        <Button type="button" variant="ghost" onClick={onPrev} disabled={submitting}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Previous
        </Button>
      ) : (
        <span />
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={(!valid && !(isConfirm && !paymentRecorded)) || submitting}
        onClick={handlePrimary}
      >
        {submitting ? 'Placing order…' : primaryLabel}
        {!submitting && isSign && <Check size={14} strokeWidth={2} />}
        {!submitting && !isSign && <ArrowRight size={14} strokeWidth={1.75} />}
      </Button>
    </div>
  );
};
```

Note: "Confirm payment received" intentionally bypasses `valid` so the operator can press it once payment is filled in BUT before the `paymentRecorded` flag flips. The `validateConfirmPayment` check requires `paymentRecorded=true`, so the primary button is disabled-by-validation only AFTER pressing once. To accept the first press when validation is false, we widen the disabled rule: `disabled if (!valid AND not the special "record" press) OR submitting`.

- [ ] **Step 4: Create `StepFooter.module.css`**

```css
.bar {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: var(--space-4);
  border-top: 1px solid var(--line);
}
```

- [ ] **Step 5: Verify visually**

Reload `/handover` in preview. Should see 4 phase-1 chips at top with "Customer" active (orange ring); footer shows just "Continue" button (no Previous on first step).

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/components/handover/PhaseNav.tsx apps/pos/src/components/handover/PhaseNav.module.css apps/pos/src/components/handover/StepFooter.tsx apps/pos/src/components/handover/StepFooter.module.css
git commit -m "feat(pos): handover PhaseNav + StepFooter chrome"
```

---

### Task 7: `OrderSummaryPane` — form mode

**Files:**
- Modify: `apps/pos/src/components/handover/OrderSummaryPane.tsx`
- Create: `apps/pos/src/components/handover/OrderSummaryPane.module.css`

- [ ] **Step 1: Implement OrderSummaryPane (form mode)**

```tsx
import { fmtRM } from '@2990s/shared';
import { PriceTag } from '@2990s/design-system';
import type { CartLine } from '../../state/cart';
import { cartSummary } from '../../state/cart';
import type { HandoverForm } from '../../lib/handover-helpers';
import styles from './OrderSummaryPane.module.css';

const PAYMENT_LABEL: Record<string, string> = {
  credit: 'Credit Card',
  debit: 'Debit Card',
  transfer: 'Bank transfer / DuitNow',
  installment: 'Installment',
};

const formatDate = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' });
};

export interface FormPaneProps {
  mode: 'form';
  lines: CartLine[];
  form: HandoverForm;
  subtotal: number;
  addonTotal: number;
  total: number;
}

export interface ReceiptPaneProps {
  mode: 'receipt';
  orderId: string;
  placedAt: string;       // ISO
  lines: CartLine[];
  customer: { name: string; address?: string };
  delivery: { date?: string };
  payment: { method: string };
  paid: number;
}

export const OrderSummaryPane = (props: FormPaneProps | ReceiptPaneProps) => {
  if (props.mode === 'receipt') return <ReceiptPane {...props} />;
  return <FormPane {...props} />;
};

const FormPane = ({ lines, form, subtotal, addonTotal, total }: FormPaneProps) => {
  const placeholderId = 'SO-XXXX';
  const today = new Date().toLocaleDateString('en-GB');

  const emergencyHasAny =
    form.emergencyName.trim() || form.emergencyRelation.trim() || form.emergencyPhone.trim();

  return (
    <aside className={styles.pane}>
      <header className={styles.head}>
        <code className={styles.orderId}>{placeholderId} · {today}</code>
        <h2 className={styles.title}>Order summary</h2>
      </header>

      <Section heading={`Items · ${lines.length}`}>
        {lines.map((l) => (
          <article key={l.key} className={styles.itemCard}>
            <div className={styles.itemPhoto} />
            <div className={styles.itemBody}>
              <div className={styles.itemName}>{l.config.productName}</div>
              <div className={styles.itemDetail}>{cartSummary(l.config)} · qty {l.qty}</div>
            </div>
            <div className={styles.itemPrice}>
              <span className={styles.itemPriceUnit}>RM</span>
              {fmtRM(l.qty * l.config.total).replace('RM ', '')}
            </div>
          </article>
        ))}
      </Section>

      <Section heading="Customer">
        {form.name.trim() ? (
          <Row label="Name"  value={form.name} />
        ) : (
          <p className={styles.placeholder}>Not yet captured</p>
        )}
        {form.phone.trim()   && <Row label="Phone"   value={form.phone} />}
        {form.email.trim()   && <Row label="Email"   value={form.email} />}
        {form.addressLater   ? <Row label="Address" value="To be filled later" italic />
                              : form.fullAddress.trim() && <Row label="Address" value={form.fullAddress} />}
      </Section>

      {emergencyHasAny && (
        <Section heading="Emergency contact">
          {form.emergencyRelation && <Row label="" value={form.emergencyRelation} />}
          {form.emergencyName     && <Row label="Name"  value={form.emergencyName} />}
          {form.emergencyPhone    && <Row label="Phone" value={form.emergencyPhone} />}
        </Section>
      )}

      <Section heading="Delivery">
        <Row label="Date" value={form.deliveryDate ? formatDate(form.deliveryDate) : ''} placeholder="Pending" />
      </Section>

      <Section heading="Payment">
        <Row label="Method" value={PAYMENT_LABEL[form.paymentMethod] ?? ''} placeholder="Pending" />
      </Section>

      <Section heading="Totals">
        <Row label="Items subtotal" value={fmtRM(subtotal)} />
        {addonTotal > 0 && <Row label="Add-ons" value={fmtRM(addonTotal)} />}
      </Section>

      <footer className={styles.totalBar}>
        <span className="t-eyebrow">Total</span>
        <PriceTag amount={total} size="lg" />
        <p className={styles.totalCaption}>Inclusive of delivery within Klang Valley</p>
      </footer>
    </aside>
  );
};

const ReceiptPane = (_p: ReceiptPaneProps) => {
  // Implemented in Task 16. Placeholder for now.
  return <aside className={styles.pane}><h2>Receipt — pending Task 16</h2></aside>;
};

const Section = ({ heading, children }: { heading: string; children: React.ReactNode }) => (
  <section className={styles.section}>
    <div className={styles.sectionHead}>{heading}</div>
    {children}
  </section>
);

const Row = ({ label, value, placeholder, italic }: {
  label: string; value: string; placeholder?: string; italic?: boolean;
}) => (
  <div className={styles.row}>
    {label && <span className={styles.rowLabel}>{label}</span>}
    <span className={`${styles.rowValue} ${italic ? styles.rowItalic : ''}`}>
      {value || <em>{placeholder}</em>}
    </span>
  </div>
);
```

- [ ] **Step 2: Create `OrderSummaryPane.module.css`**

```css
.pane {
  position: sticky;
  top: var(--space-4);
  background: var(--bg-alt);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-height: calc(100vh - var(--space-8));
  overflow-y: auto;
}

.head { display: flex; flex-direction: column; gap: 4px; }
.orderId { font-family: var(--font-mono); font-size: var(--fs-12); color: var(--fg-muted); }
.title   { font-family: var(--font-title); font-weight: var(--w-bold); font-size: var(--fs-20); margin: 0; }

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: var(--space-3);
  border-top: 1px solid var(--line);
}
.section:first-of-type { border-top: none; padding-top: 0; }

.sectionHead {
  font-family: var(--font-button);
  font-size: var(--fs-11);
  font-weight: var(--w-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-soft);
}

.itemCard {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  gap: 10px;
  align-items: center;
  background: var(--c-cream);
  border-radius: var(--radius-sm);
  padding: 8px;
}
.itemPhoto {
  width: 56px; height: 42px;
  background: var(--bg-warm);
  border-radius: var(--radius-xs);
}
.itemName   { font-weight: var(--w-semibold); }
.itemDetail { font-size: var(--fs-12); color: var(--fg-muted); }
.itemPrice  {
  font-family: var(--font-title);
  font-weight: var(--w-bold);
  color: var(--c-burnt);
}
.itemPriceUnit { font-size: var(--fs-11); margin-right: 4px; vertical-align: super; }

.row { display: flex; justify-content: space-between; gap: 8px; }
.rowLabel { color: var(--fg-muted); font-size: var(--fs-13); }
.rowValue { font-size: var(--fs-13); text-align: right; }
.rowItalic { font-style: italic; color: var(--fg-muted); }
.rowValue em { font-style: italic; color: var(--fg-muted); }

.placeholder {
  font-style: italic;
  color: var(--fg-muted);
  margin: 0;
}

.totalBar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: var(--space-3);
  border-top: 1px solid var(--line);
}
.totalCaption {
  font-size: var(--fs-11);
  color: var(--fg-soft);
  margin: 0;
}
```

- [ ] **Step 3: Verify visually**

Reload `/handover`. The right pane should now show:
- Order ID placeholder `SO-XXXX · DD/MM/YYYY`
- 3 item cards (from the existing test cart of 3 sofa lines)
- "Customer" with `Not yet captured` italic
- "Delivery" with `Pending`
- "Payment" with `Pending`
- Totals + total bar at the bottom

Confirm no console errors.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/components/handover/OrderSummaryPane.tsx apps/pos/src/components/handover/OrderSummaryPane.module.css
git commit -m "feat(pos): OrderSummaryPane form mode w/ live binding"
```

---

## Phase D — Phase 1 step components (tasks 8-12)

### Task 8: `CustomerStep.tsx`

**Files:**
- Modify: `apps/pos/src/components/handover/CustomerStep.tsx`

- [ ] **Step 1: Implement `CustomerStep`**

```tsx
import type { HandoverForm } from '../../lib/handover-helpers';
import { Field } from './Field';   // shared sub-component (extract from current Handover.tsx)

interface StaffRow { id: string; name: string; }

export const CustomerStep = ({
  form, update, staff,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  staff: StaffRow[];
}) => (
  <section>
    <h2 style={{ marginTop: 0 }}>Customer additional info</h2>
    <p style={{ color: 'var(--fg-muted)' }}>
      Hand the tablet to the customer to fill in their details. Quote items have been carried over — no re-entry needed.
    </p>

    <div className="fieldRow">
      <Field label="Full name *">
        <input type="text" required value={form.name} onChange={(e) => update('name', e.target.value)} autoComplete="name" autoFocus />
      </Field>
      <Field label="Phone">
        <input type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} autoComplete="tel" placeholder="+60..." />
      </Field>
    </div>

    <Field label="Email *">
      <input type="email" required value={form.email} onChange={(e) => update('email', e.target.value)} autoComplete="email" placeholder="customer@example.com — for receipt & order updates" />
    </Field>

    <div className="fieldRow">
      <Field label="Salesperson">
        <select value={form.salespersonId} onChange={(e) => update('salespersonId', e.target.value)}>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="Customer type">
        <select value={form.customerType} onChange={(e) => update('customerType', e.target.value as 'new'|'existing')}>
          <option value="new">New</option>
          <option value="existing">Existing</option>
        </select>
      </Field>
    </div>
  </section>
);
```

- [ ] **Step 2: Extract `Field` to a shared sub-component**

Create `apps/pos/src/components/handover/Field.tsx`:

```tsx
import type { ReactNode } from 'react';

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field">
    <span className="fieldLabel">{label}</span>
    {children}
  </label>
);
```

For styling, reuse the existing CSS module classes from `Handover.module.css` — add a global `.field`, `.fieldLabel`, `.fieldRow` rule set or import from a shared CSS module. Match the old `:where` selector approach for now.

- [ ] **Step 3: Add field styles to `Handover.module.css`** (or new `Field.module.css` if preferred)

Update `apps/pos/src/pages/Handover.module.css` to include:

```css
:global(.field) {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
:global(.fieldLabel) {
  font-family: var(--font-button);
  font-size: var(--fs-11);
  font-weight: var(--w-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-soft);
}
:global(.field) input,
:global(.field) select,
:global(.field) textarea {
  font: inherit;
  font-size: var(--fs-14);
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg);
}
:global(.field) input:focus,
:global(.field) select:focus,
:global(.field) textarea:focus {
  outline: none;
  border-color: var(--c-burnt);
}
:global(.fieldRow) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
```

- [ ] **Step 4: Verify visually**

Reload `/handover`. Customer step should now show 4 fields (Name, Phone, Email, Salesperson, Customer type). Salesperson dropdown should be populated from `useStaff()`.

Test the live binding: type into the Name field → confirm the right pane "Customer" section now shows the name (no longer "Not yet captured").

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/components/handover/CustomerStep.tsx apps/pos/src/components/handover/Field.tsx apps/pos/src/pages/Handover.module.css
git commit -m "feat(pos): handover CustomerStep + Field primitive"
```

---

### Task 9: `AddressStep.tsx`

**Files:**
- Modify: `apps/pos/src/components/handover/AddressStep.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useMemo } from 'react';
import type { HandoverForm } from '../../lib/handover-helpers';
import type { LocalityRow } from '../../lib/queries';
import { Field } from './Field';

const BUILDING_TYPES = [
  { v: 'condo', l: 'Condo' },
  { v: 'landed', l: 'Landed' },
  { v: 'apartment', l: 'Apartment' },
  { v: 'office', l: 'Office' },
  { v: 'shop', l: 'Shop' },
  { v: 'other', l: 'Other' },
] as const;

export const AddressStep = ({
  form, update, localities,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  localities: LocalityRow[];
}) => {
  const states = useMemo(() => {
    const set = new Set<string>();
    for (const l of localities) set.add(l.state);
    return Array.from(set).sort();
  }, [localities]);

  const cities = useMemo(() => {
    if (!form.state) return [] as string[];
    const set = new Set<string>();
    for (const l of localities) if (l.state === form.state) set.add(l.city);
    return Array.from(set).sort();
  }, [localities, form.state]);

  const postcodes = useMemo(() => {
    if (!form.state || !form.city) return [] as string[];
    const set = new Set<string>();
    for (const l of localities) if (l.state === form.state && l.city === form.city) set.add(l.postcode);
    return Array.from(set).sort();
  }, [localities, form.state, form.city]);

  return (
    <section>
      <h2 style={{ marginTop: 0 }}>Customer additional info</h2>

      <label className="highlightCard">
        <input
          type="checkbox"
          checked={form.addressLater}
          onChange={(e) => update('addressLater', e.target.checked)}
        />
        <div>
          <strong>Fill in address later</strong>
          <p>Customer hasn't confirmed delivery address yet — we'll capture it before dispatch.</p>
        </div>
      </label>

      {!form.addressLater && (
        <>
          <h3 className="subTitle">Delivery address</h3>
          <Field label="Full address">
            <textarea
              rows={3}
              value={form.fullAddress}
              onChange={(e) => update('fullAddress', e.target.value)}
              placeholder="Unit, street, area"
            />
          </Field>

          <div className="fieldRow">
            <Field label="Postcode">
              <input
                type="text"
                value={form.postcode}
                onChange={(e) => update('postcode', e.target.value)}
                placeholder="50480"
              />
            </Field>
            <Field label="City">
              <select value={form.city} onChange={(e) => update('city', e.target.value)} disabled={!form.state}>
                <option value="">{form.state ? 'Select city…' : 'Pick state first'}</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <div className="fieldRow">
            <Field label="State">
              <select value={form.state} onChange={(e) => {
                update('state', e.target.value);
                update('city', '');
                update('postcode', '');
              }}>
                <option value="">Select state…</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Building type">
              <select value={form.buildingType} onChange={(e) => update('buildingType', e.target.value as HandoverForm['buildingType'])}>
                <option value="">Select…</option>
                {BUILDING_TYPES.map((b) => <option key={b.v} value={b.v}>{b.l}</option>)}
              </select>
            </Field>
          </div>

          <label className={`highlightCard ${form.billingSame ? 'highlightCardActive' : ''}`}>
            <input
              type="checkbox"
              checked={form.billingSame}
              onChange={(e) => update('billingSame', e.target.checked)}
            />
            <div>
              <strong>Billing address same as delivery address</strong>
              <p>Uncheck if the invoice should be issued to a different address.</p>
            </div>
          </label>
        </>
      )}
    </section>
  );
};
```

- [ ] **Step 2: Add `.highlightCard` + `.subTitle` styles**

In `apps/pos/src/pages/Handover.module.css`:

```css
:global(.highlightCard) {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: flex-start;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-alt);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  cursor: pointer;
  margin-bottom: var(--space-3);
}
:global(.highlightCardActive) {
  background: var(--lane-received-bg);
  border-color: var(--c-orange);
}
:global(.highlightCard) input[type="checkbox"] {
  width: 22px; height: 22px;
  accent-color: var(--c-orange);
  margin-top: 2px;
}
:global(.highlightCard) strong { display: block; font-size: var(--fs-15); }
:global(.highlightCard) p { margin: 4px 0 0; font-size: var(--fs-12); color: var(--fg-muted); }

:global(.subTitle) {
  font-family: var(--font-title);
  font-weight: var(--w-semibold);
  font-size: var(--fs-18);
  margin: var(--space-3) 0;
}
```

- [ ] **Step 3: Verify**

Click "Address" chip (after filling Customer step). Fill in fields and watch the right pane update. Toggle "Fill in address later" — all address fields should hide, and the right pane's Address row should switch to "To be filled later".

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/components/handover/AddressStep.tsx apps/pos/src/pages/Handover.module.css
git commit -m "feat(pos): handover AddressStep w/ fill-later toggle + cascading dropdowns"
```

---

### Task 10: `EmergencyStep.tsx`

**Files:**
- Modify: `apps/pos/src/components/handover/EmergencyStep.tsx`

- [ ] **Step 1: Implement**

```tsx
import type { HandoverForm } from '../../lib/handover-helpers';
import { Field } from './Field';

const RELATIONS = [
  'Husband','Wife','Father','Mother','Son','Daughter',
  'Brother','Sister','Friend','Colleague','Relative','Other',
];

export const EmergencyStep = ({
  form, update,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
}) => (
  <section>
    <h2 style={{ marginTop: 0 }}>Customer additional info</h2>
    <h3 className="subTitle">Emergency contact</h3>
    <p style={{ color: 'var(--fg-muted)' }}>Used only if we cannot reach the customer on delivery day.</p>

    <div className="fieldRow">
      <Field label="Contact name">
        <input type="text" value={form.emergencyName} onChange={(e) => update('emergencyName', e.target.value)} placeholder="e.g. Lim Mei Hua" />
      </Field>
      <Field label="Relationship">
        <select value={form.emergencyRelation} onChange={(e) => update('emergencyRelation', e.target.value)}>
          <option value="">Select…</option>
          {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
    </div>

    <Field label="Phone">
      <input type="tel" value={form.emergencyPhone} onChange={(e) => update('emergencyPhone', e.target.value)} placeholder="+60 12 345 6789" />
    </Field>
  </section>
);
```

- [ ] **Step 2: Verify visually**

Navigate to Emergency step. Try filling one field only — Next button should be disabled (`validateEmergency` requires all three or all zero). Confirm right pane "Emergency contact" section appears only when at least one field is filled.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/components/handover/EmergencyStep.tsx
git commit -m "feat(pos): handover EmergencyStep"
```

---

### Task 11: `MonthCalendar.tsx`

**Files:**
- Create: `apps/pos/src/components/handover/MonthCalendar.tsx`
- Create: `apps/pos/src/components/handover/MonthCalendar.module.css`

- [ ] **Step 1: Implement the calendar**

```tsx
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './MonthCalendar.module.css';

const WEEKDAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const MONTH_LABEL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export const MonthCalendar = ({
  value, onChange, minDate,
}: {
  value: string;                          // YYYY-MM-DD or ''
  onChange: (date: string) => void;
  minDate: Date;
}) => {
  const initialMonth = value
    ? { year: Number(value.slice(0,4)), month: Number(value.slice(5,7)) - 1 }
    : { year: minDate.getFullYear(), month: minDate.getMonth() };
  const [view, setView] = useState(initialMonth);

  const cells = useMemo(() => {
    const firstDay = new Date(view.year, view.month, 1);
    const lastDay  = new Date(view.year, view.month + 1, 0);
    const start = firstDay.getDay();                       // 0=Sun
    const total = lastDay.getDate();
    const arr: Array<number | null> = [];
    for (let i = 0; i < start; i++) arr.push(null);
    for (let d = 1; d <= total; d++) arr.push(d);
    return arr;
  }, [view]);

  const fmt = (d: number): string => {
    const m = String(view.month + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${view.year}-${m}-${dd}`;
  };

  const isDisabled = (d: number): boolean => {
    const iso = fmt(d);
    return iso < `${minDate.getFullYear()}-${String(minDate.getMonth()+1).padStart(2,'0')}-${String(minDate.getDate()).padStart(2,'0')}`;
  };

  const isSelected = (d: number): boolean => fmt(d) === value;

  const stepMonth = (delta: number) => {
    setView(({ year, month }) => {
      const nm = month + delta;
      if (nm < 0)  return { year: year - 1, month: 11 };
      if (nm > 11) return { year: year + 1, month: 0 };
      return { year, month: nm };
    });
  };

  return (
    <div className={styles.cal}>
      <header className={styles.head}>
        <button type="button" className={styles.nav} onClick={() => stepMonth(-1)} aria-label="Previous month">
          <ChevronLeft size={16} strokeWidth={1.75} />
        </button>
        <span className={styles.monthLabel}>{MONTH_LABEL[view.month]} {view.year}</span>
        <button type="button" className={styles.nav} onClick={() => stepMonth(1)} aria-label="Next month">
          <ChevronRight size={16} strokeWidth={1.75} />
        </button>
      </header>
      <div className={styles.weekdays}>
        {WEEKDAYS.map((w) => <span key={w} className={styles.weekday}>{w}</span>)}
      </div>
      <div className={styles.grid}>
        {cells.map((d, i) => d === null ? (
          <span key={i} className={styles.empty} />
        ) : (
          <button
            type="button"
            key={i}
            className={`${styles.day} ${isSelected(d) ? styles.daySelected : ''} ${isDisabled(d) ? styles.dayDisabled : ''}`}
            disabled={isDisabled(d)}
            onClick={() => onChange(fmt(d))}
          >
            {d}
          </button>
        ))}
      </div>
      <div className={styles.legend}>
        <span className={styles.legendDot} /> Selected
        <span className={styles.legendNote}>3–5 working days standard</span>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Create `MonthCalendar.module.css`**

```css
.cal {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--bg-alt);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
}
.head { display: flex; align-items: center; justify-content: space-between; }
.monthLabel {
  font-family: var(--font-title);
  font-weight: var(--w-semibold);
  font-size: var(--fs-16);
}
.nav {
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  border-radius: var(--radius-xs);
  color: var(--fg-muted);
}
.nav:hover { background: var(--bg); color: var(--fg); }

.weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}
.weekday {
  text-align: center;
  font-family: var(--font-button);
  font-size: var(--fs-11);
  font-weight: var(--w-semibold);
  color: var(--fg-soft);
}

.grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.day, .empty {
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: var(--fs-13);
}
.day {
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 50%;
  color: var(--fg);
}
.day:hover:not(:disabled) { background: var(--bg); }
.daySelected {
  background: var(--c-orange) !important;
  color: var(--c-cream);
  font-weight: var(--w-semibold);
}
.dayDisabled { color: var(--line); cursor: not-allowed; }

.legend {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--fs-12);
  color: var(--fg-muted);
}
.legendDot {
  display: inline-block;
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--c-orange);
}
.legendNote { margin-left: auto; }
```

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/components/handover/MonthCalendar.tsx apps/pos/src/components/handover/MonthCalendar.module.css
git commit -m "feat(pos): MonthCalendar — month-view date picker (no EXP)"
```

---

### Task 12: `TargetDateStep.tsx`

**Files:**
- Modify: `apps/pos/src/components/handover/TargetDateStep.tsx`

- [ ] **Step 1: Implement**

```tsx
import { MonthCalendar } from './MonthCalendar';
import { Field } from './Field';
import type { HandoverForm } from '../../lib/handover-helpers';

export const TargetDateStep = ({
  form, update,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
}) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  return (
    <section>
      <h2 style={{ marginTop: 0 }}>Customer additional info</h2>
      <h3 className="subTitle">Delivery target date</h3>

      <MonthCalendar
        value={form.deliveryDate}
        onChange={(date) => update('deliveryDate', date)}
        minDate={tomorrow}
      />

      <Field label="Special instructions (optional)">
        <textarea
          rows={3}
          value={form.specialInstructions}
          onChange={(e) => update('specialInstructions', e.target.value)}
          placeholder="Lift available, leave at concierge, etc."
        />
      </Field>
    </section>
  );
};
```

- [ ] **Step 2: Verify visually**

Navigate to Target date step. Calendar should render with current month. Today and earlier should be greyed out (disabled). Click a date — should highlight orange. Right pane "Delivery" should update with the formatted date.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/components/handover/TargetDateStep.tsx
git commit -m "feat(pos): handover TargetDateStep w/ MonthCalendar + special instructions"
```

---

## Phase E — Phase 2 step components (tasks 13-15)

### Task 13: `AddonCard.tsx` + `AddonsPaymentStep.tsx`

**Files:**
- Create: `apps/pos/src/components/handover/AddonCard.tsx`
- Create: `apps/pos/src/components/handover/AddonCard.module.css`
- Modify: `apps/pos/src/components/handover/AddonsPaymentStep.tsx`

- [ ] **Step 1: Implement `AddonCard.tsx`**

```tsx
import { Recycle, ArrowUpFromLine, Wrench, Package } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import type { AddonRow } from '../../lib/queries';
import type { AddonSelection } from '../../lib/handover-helpers';
import styles from './AddonCard.module.css';

const ICON: Record<string, typeof Recycle> = {
  recycle: Recycle,
  'arrow-up-from-line': ArrowUpFromLine,
  wrench: Wrench,
};

export const AddonCard = ({
  addon, selection, onToggle, onChange,
}: {
  addon: AddonRow;
  selection: AddonSelection;
  onToggle: () => void;
  onChange: (s: AddonSelection) => void;
}) => {
  const Icon = ICON[addon.icon] ?? Package;
  const expanded = selection.expanded;

  const lineTotal = addon.kind === 'floors_items'
    // Canonical lift math (packages/shared/src/pricing.ts:23): first 2 floors free.
    ? Math.max(0, (selection.floorsCount ?? 0) - 2) * (selection.itemsCount ?? 0) * (addon.perFloorItem ?? 0)
    : addon.price * (selection.qty ?? 1);

  return (
    <article className={`${styles.card} ${selection.selected ? styles.cardOn : ''}`}>
      <button type="button" className={styles.icon} aria-hidden><Icon size={20} strokeWidth={1.75} /></button>
      <div className={styles.body}>
        <h4 className={styles.title}>{addon.label}</h4>
        <p className={styles.detail}>
          {addon.kind === 'floors_items'
            ? `RM${addon.perFloorItem} per floor per item`
            : `RM${addon.price} per ${addon.unit ?? 'piece'}`}
          {addon.description ? ` · ${addon.description}` : ''}
        </p>
        {expanded && (
          <div className={styles.expand}>
            {addon.kind === 'floors_items' ? (
              <>
                <label>Floors
                  <input type="number" min={0} value={selection.floorsCount ?? 0}
                    onChange={(e) => onChange({ ...selection, floorsCount: Number(e.target.value) })} />
                </label>
                <label>Items
                  <input type="number" min={0} value={selection.itemsCount ?? 0}
                    onChange={(e) => onChange({ ...selection, itemsCount: Number(e.target.value) })} />
                </label>
              </>
            ) : (
              <label>Qty
                <input type="number" min={1} value={selection.qty ?? 1}
                  onChange={(e) => onChange({ ...selection, qty: Math.max(1, Number(e.target.value)) })} />
              </label>
            )}
            <span className={styles.lineTotal}>Line total: {fmtRM(lineTotal)}</span>
          </div>
        )}
      </div>
      <button
        type="button"
        className={styles.configLink}
        onClick={() => onChange({ ...selection, expanded: !expanded })}
      >
        configurable
      </button>
      <button
        type="button"
        className={`${styles.check} ${selection.selected ? styles.checkOn : ''}`}
        onClick={onToggle}
        aria-label={selection.selected ? 'Deselect' : 'Select'}
      >
        {selection.selected ? '●' : '○'}
      </button>
    </article>
  );
};
```

- [ ] **Step 2: Create `AddonCard.module.css`**

```css
.card {
  display: grid;
  grid-template-columns: 48px 1fr auto auto;
  align-items: center;
  gap: 12px;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-alt);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
}
.cardOn { border-color: var(--c-orange); }

.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px; height: 48px;
  background: var(--bg);
  border-radius: var(--radius-sm);
  border: none;
}
.title  { font-family: var(--font-title); font-weight: var(--w-semibold); margin: 0; }
.detail { font-size: var(--fs-13); color: var(--fg-muted); margin: 4px 0 0; }

.expand {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 12px;
  align-items: center;
  margin-top: var(--space-3);
}
.expand label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--font-button);
  font-size: var(--fs-11);
  color: var(--fg-soft);
  text-transform: uppercase;
}
.expand input {
  width: 80px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.lineTotal {
  font-family: var(--font-title);
  font-weight: var(--w-semibold);
  margin-left: auto;
  color: var(--c-burnt);
}

.configLink {
  background: transparent;
  border: none;
  color: var(--c-orange);
  cursor: pointer;
  font-size: var(--fs-13);
  font-weight: var(--w-semibold);
}

.check {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: var(--bg);
  cursor: pointer;
}
.checkOn { background: var(--c-orange); color: var(--c-cream); border-color: var(--c-orange); }
```

- [ ] **Step 3: Implement `AddonsPaymentStep.tsx`**

```tsx
import { Banknote, CreditCard, Clock } from 'lucide-react';
import { fmtRM, } from '@2990s/shared';
import type { HandoverForm, AddonSelection } from '../../lib/handover-helpers';
import type { AddonRow } from '../../lib/queries';
import { AddonCard } from './AddonCard';

const HANDOVER_ADDON_IDS = ['dispose-mattress', 'dispose-bedframe', 'lift', 'assemble'];

export const AddonsPaymentStep = ({
  form, update, addons,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  addons: AddonRow[];
}) => {
  const handoverAddons = addons.filter((a) => HANDOVER_ADDON_IDS.includes(a.id) && a.enabled);

  const setSelection = (id: string, sel: AddonSelection) =>
    update('addons', { ...form.addons, [id]: sel });

  const subtotalForCopy = fmtRM(0); // pass real subtotal from parent if you want to show in copy

  return (
    <section>
      <h2 style={{ marginTop: 0 }}>Confirm &amp; payment</h2>
      <p style={{ color: 'var(--fg-muted)' }}>
        Review add-ons, record payment, then capture the customer signature to complete the order.
      </p>

      <h3 className="subTitle">Add-ons (optional)</h3>
      <p style={{ color: 'var(--fg-muted)', marginTop: -8 }}>
        One-time fees, added on top of the product price.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {handoverAddons.map((a) => {
          const sel: AddonSelection = form.addons[a.id] ?? { selected: false, expanded: false };
          return (
            <AddonCard
              key={a.id}
              addon={a}
              selection={sel}
              onToggle={() =>
                setSelection(a.id, { ...sel, selected: !sel.selected, expanded: !sel.selected || sel.expanded })}
              onChange={(next) => setSelection(a.id, next)}
            />
          );
        })}
      </div>

      <h3 className="subTitle">Payment method</h3>
      <div className="fieldRow">
        <MethodButton active={form.paymentMethod === 'credit'} icon={CreditCard} label="Credit Card" hint="Approval code from terminal" onClick={() => update('paymentMethod', 'credit')} />
        <MethodButton active={form.paymentMethod === 'debit'} icon={CreditCard} label="Debit Card"  hint="Approval code from terminal" onClick={() => update('paymentMethod', 'debit')} />
      </div>
      <div className="fieldRow">
        <MethodButton active={form.paymentMethod === 'transfer'} icon={Banknote} label="Bank transfer / DuitNow" hint="Slip required" onClick={() => update('paymentMethod', 'transfer')} />
        <MethodButton active={form.paymentMethod === 'installment'} icon={Clock} label="Installment" hint="Agreement / contract no." onClick={() => update('paymentMethod', 'installment')} />
      </div>
    </section>
  );
};

const MethodButton = ({ active, icon: Icon, label, hint, onClick }: { active: boolean; icon: typeof CreditCard; label: string; hint: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr',
      gap: 12,
      padding: '12px 16px',
      background: active ? 'var(--bg)' : 'var(--bg-alt)',
      border: active ? '1px solid var(--c-orange)' : '1px solid var(--line)',
      borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
      textAlign: 'left',
    }}
  >
    <Icon size={20} strokeWidth={1.75} />
    <span>
      <strong>{label}</strong>
      <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{hint}</p>
    </span>
  </button>
);
```

- [ ] **Step 4: Verify visually**

Navigate to Phase 2 step 1. Should see 4 add-on cards. Click `configurable` on "Lift access" → card expands showing Floors + Items inputs. Click circle on the right → card highlights orange (selected). Right pane Totals should update.

Click a Payment Method button → method appears in right pane "Payment" row.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/components/handover/AddonCard.tsx apps/pos/src/components/handover/AddonCard.module.css apps/pos/src/components/handover/AddonsPaymentStep.tsx
git commit -m "feat(pos): handover AddonsPaymentStep + AddonCard w/ inline expand"
```

---

### Task 14: `ConfirmPaymentStep.tsx`

**Files:**
- Modify: `apps/pos/src/components/handover/ConfirmPaymentStep.tsx`

- [ ] **Step 1: Implement**

```tsx
import { Check } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { Field } from './Field';
import type { HandoverForm } from '../../lib/handover-helpers';
import { SlipUploadStep } from '../SlipUploadStep';

export const ConfirmPaymentStep = ({
  form, update, subtotal, addonTotal,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  subtotal: number;
  addonTotal: number;
}) => {
  const total = subtotal + addonTotal;
  const halfTotal = Math.round(total / 2);
  const seventyTotal = Math.round(total * 0.7);

  const setPreset = (p: HandoverForm['paymentPreset'], v: number) => {
    update('paymentPreset', p);
    update('amountPaid', v);
  };

  const methodLabel =
    form.paymentMethod === 'credit' ? 'Credit Card' :
    form.paymentMethod === 'debit' ? 'Debit Card' :
    form.paymentMethod === 'transfer' ? 'Bank transfer / DuitNow' :
    form.paymentMethod === 'installment' ? 'Installment' : '—';

  return (
    <section>
      <h2 style={{ marginTop: 0 }}>Confirm payment</h2>
      <p style={{ color: 'var(--fg-muted)' }}>
        Record the payment received via <strong>{methodLabel}</strong>. Customer can pay any amount between{' '}
        <strong>50% deposit</strong> ({fmtRM(halfTotal)}) and the full total ({fmtRM(total)}).
      </p>

      <Field label="Amount paid">
        <input
          type="number"
          min={halfTotal}
          max={total}
          value={form.amountPaid || ''}
          onChange={(e) => {
            const v = Number(e.target.value);
            update('amountPaid', v);
            update('paymentPreset',
              v === halfTotal    ? 'half'
              : v === total      ? 'full'
              : v === seventyTotal ? 'seventy'
              : 'custom');
          }}
          placeholder={String(total)}
        />
      </Field>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <PresetPill active={form.paymentPreset === 'half'}    onClick={() => setPreset('half', halfTotal)}>
          50% deposit · {fmtRM(halfTotal)}
        </PresetPill>
        <PresetPill active={form.paymentPreset === 'full'}    onClick={() => setPreset('full', total)}>
          Full payment · {fmtRM(total)}
        </PresetPill>
        <PresetPill active={form.paymentPreset === 'seventy'} onClick={() => setPreset('seventy', seventyTotal)}>
          70% · {fmtRM(seventyTotal)}
        </PresetPill>
      </div>

      <Field label="Approval code *">
        <input type="text" value={form.approvalCode} onChange={(e) => update('approvalCode', e.target.value)} placeholder="From card terminal slip" />
      </Field>

      <h3 className="subTitle">Payment slip / proof {form.paymentMethod === 'transfer' && '*'}</h3>
      <SlipUploadStep
        onConfirmed={(id) => update('slipUploadSessionId', id)}
        onCleared={() => update('slipUploadSessionId', null)}
      />

      {form.paymentRecorded && (
        <p style={{ color: 'var(--c-success)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Check size={14} strokeWidth={2} />
          Payment recorded · {fmtRM(form.amountPaid)}
        </p>
      )}
    </section>
  );
};

const PresetPill = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: '8px 14px',
      borderRadius: 999,
      border: active ? '1px solid var(--c-orange)' : '1px solid var(--line)',
      background: active ? 'var(--c-orange)' : 'var(--bg)',
      color: active ? 'var(--c-cream)' : 'var(--fg)',
      font: 'inherit',
      cursor: 'pointer',
    }}
  >
    {children}
  </button>
);
```

- [ ] **Step 2: Verify**

Navigate to Phase 2 step 2 (with a method selected and addons filled). Default `amountPaid=full`. Click 50% preset → input updates + pill highlights. Type a custom amount → preset auto-switches to "custom" (no pill highlighted).

Press the bottom button `Confirm payment received` → flips `paymentRecorded`, displays green "Payment recorded · RM X,XXX", button changes to `Continue to signature →`.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/components/handover/ConfirmPaymentStep.tsx
git commit -m "feat(pos): handover ConfirmPaymentStep w/ presets + slip + record"
```

---

### Task 15: `SignaturePad.tsx` + `SignConfirmStep.tsx`

**Files:**
- Create: `apps/pos/src/components/handover/SignaturePad.tsx`
- Create: `apps/pos/src/components/handover/SignaturePad.module.css`
- Modify: `apps/pos/src/components/handover/SignConfirmStep.tsx`

- [ ] **Step 1: Extract `SignaturePad` from the old Handover.tsx**

Take the `SignaturePad` component that was previously inside `Handover.tsx` (you may have a copy in git history). Create as standalone:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import styles from './SignaturePad.module.css';

const SIGN_W = 800;
const SIGN_H = 200;

export const SignaturePad = ({ onChange }: { onChange: (signed: boolean) => void }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasInk, setHasInk] = useState(false);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SIGN_W,
      y: ((e.clientY - rect.top)  / rect.height) * SIGN_H,
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    last.current = getPos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.lineWidth = 2; ctx.strokeStyle = '#221F20'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
    last.current = p;
    if (!hasInk) { setHasInk(true); onChange(true); }
  };
  const end = () => { drawing.current = false; };

  const clearPad = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, SIGN_W, SIGN_H);
    setHasInk(false);
    onChange(false);
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, SIGN_W, SIGN_H);
  }, []);

  return (
    <div className={styles.sign}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={SIGN_W}
        height={SIGN_H}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className={styles.actions}>
        <span className={styles.guide}>Customer signature</span>
        <button type="button" className={styles.clearBtn} onClick={clearPad} disabled={!hasInk}>
          <Eraser size={12} strokeWidth={1.75} /> Clear
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Add `SignaturePad.module.css`** (copy from old Handover.module.css `.sign*` rules)

```css
.sign {
  border: 1px dashed var(--line);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  background: var(--bg-alt);
}
.canvas {
  width: 100%;
  aspect-ratio: 4 / 1;
  background: var(--bg);
  border-radius: var(--radius-sm);
  cursor: crosshair;
  touch-action: none;
}
.actions { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.guide {
  font-family: var(--font-button);
  font-size: var(--fs-11);
  font-weight: var(--w-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-soft);
}
.clearBtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--line);
  background: var(--bg);
  border-radius: var(--radius-pill);
  cursor: pointer;
}
.clearBtn:disabled { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 3: Implement `SignConfirmStep.tsx`**

```tsx
import { Check } from 'lucide-react';
import { SignaturePad } from './SignaturePad';
import type { HandoverForm } from '../../lib/handover-helpers';

export const SignConfirmStep = ({
  form, update,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
}) => (
  <section>
    <h2 style={{ marginTop: 0 }}>Sign &amp; confirm</h2>
    <p style={{ color: 'var(--fg-muted)' }}>
      Final step — customer reviews the order on the right and signs below to confirm.
    </p>

    <SignaturePad onChange={(signed) => update('signed', signed)} />

    <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-soft)', marginTop: 16 }}>
      By signing, the customer confirms the items, delivery date, address, and total. Same price guarantee applies.
    </p>

    {form.signed && (
      <p style={{ color: 'var(--c-success)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Check size={14} strokeWidth={2} /> Signed. Ready to place order.
      </p>
    )}
  </section>
);
```

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/components/handover/SignaturePad.tsx apps/pos/src/components/handover/SignaturePad.module.css apps/pos/src/components/handover/SignConfirmStep.tsx
git commit -m "feat(pos): handover SignConfirmStep + extracted SignaturePad"
```

---

## Phase F — Confirmed page + cleanup (tasks 16-17)

### Task 16: `Confirmed.tsx` + `Hero.tsx` + receipt mode + print CSS

**Files:**
- Create: `apps/pos/src/pages/Confirmed.tsx`
- Create: `apps/pos/src/pages/Confirmed.module.css`
- Create: `apps/pos/src/pages/Confirmed.print.css`
- Create: `apps/pos/src/components/handover/Hero.tsx`
- Create: `apps/pos/src/components/handover/Hero.module.css`
- Modify: `apps/pos/src/components/handover/OrderSummaryPane.tsx` (implement receipt mode)
- Create: `apps/pos/src/lib/orders-by-id.ts` (new query for `Confirmed.tsx`)

- [ ] **Step 1: Add `useOrderById` query**

Create `apps/pos/src/lib/orders-by-id.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export interface OrderDetail {
  id: string;
  placed_at: string;
  customer_name: string;
  customer_email: string | null;
  customer_address: string | null;
  customer_address_line2: string | null;
  delivery_date: string | null;
  payment_method: string;
  paid: number;
  total: number;
  dominantCategory: { id: string; label: string; hero_image_key: string | null } | null;
  lines: { product_id: string; product_name: string; qty: number; line_total: number }[];
}

export const useOrderById = (orderId: string | undefined) =>
  useQuery({
    enabled: !!orderId,
    queryKey: ['order-detail', orderId],
    queryFn: async (): Promise<OrderDetail> => {
      if (!orderId) throw new Error('no id');

      // Fetch the order row.
      const { data: row, error: orderErr } = await supabase
        .from('orders')
        .select(`
          id, placed_at, customer_name, customer_email,
          customer_address, customer_address_line2,
          delivery_date, payment_method, paid, total
        `)
        .eq('id', orderId)
        .maybeSingle();
      if (orderErr) throw orderErr;
      if (!row) throw new Error('not_found');

      // Fetch line items with product names.
      const { data: items, error: itemErr } = await supabase
        .from('order_items')
        .select(`
          product_id, qty, line_total,
          products ( name, category_id )
        `)
        .eq('order_id', orderId)
        .eq('kind', 'product');
      if (itemErr) throw itemErr;

      // Compute dominant category from product lines.
      const byCat = new Map<string, number>();
      const lines = (items ?? []).map((i: any) => ({
        product_id: i.product_id,
        product_name: i.products?.name ?? '',
        qty: i.qty,
        line_total: i.line_total,
      }));
      for (const i of items ?? []) {
        const cat: string | null = (i as any).products?.category_id ?? null;
        if (cat) byCat.set(cat, (byCat.get(cat) ?? 0) + (i.line_total as number));
      }
      const dominantId = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      let dominantCategory: OrderDetail['dominantCategory'] = null;
      if (dominantId) {
        const { data: cat } = await supabase
          .from('categories')
          .select('id, label, hero_image_key')
          .eq('id', dominantId)
          .maybeSingle();
        if (cat) dominantCategory = cat as any;
      }

      return {
        id: row.id,
        placed_at: row.placed_at,
        customer_name: row.customer_name,
        customer_email: row.customer_email,
        customer_address: [row.customer_address, row.customer_address_line2].filter(Boolean).join(', ') || null,
        delivery_date: row.delivery_date,
        payment_method: row.payment_method,
        paid: row.paid,
        total: row.total,
        dominantCategory,
        lines,
      };
    },
  });
```

- [ ] **Step 2: Implement `Hero.tsx`**

```tsx
import styles from './Hero.module.css';

export const Hero = ({
  imageKey, firstName, orderId, eta, email,
}: {
  imageKey: string | null;
  firstName: string;
  orderId: string;
  eta: string;        // e.g. "Thursday, 28 May"
  email: string | null;
}) => {
  const src = imageKey
    ? `${import.meta.env.VITE_R2_PUBLIC_URL}/${imageKey}`
    : '/imagery/bedroom-warm.jpg';

  return (
    <section className={styles.hero} style={{ backgroundImage: `url(${src})` }}>
      <div className={styles.tint} />
      <div className={styles.content}>
        <div className={styles.checkBubble}>✓</div>
        <span className={styles.eyebrow}>ORDER CONFIRMED · {orderId}</span>
        <h1 className={styles.title}>
          Welcome <span className={styles.italic}>home</span>, {firstName}.
        </h1>
        <p className={styles.body}>
          Your order will arrive on <strong>{eta}</strong>.
          {email ? <> A copy of the receipt has been sent to <strong>{email}</strong>.</> : null}
        </p>
      </div>
    </section>
  );
};
```

- [ ] **Step 3: Create `Hero.module.css`**

```css
.hero {
  position: relative;
  min-height: 100vh;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: flex-end;
  padding: var(--space-7);
  color: var(--c-cream);
}
.tint {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%);
}
.content {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 560px;
}
.checkBubble {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--c-orange);
  color: var(--c-cream);
  font-size: 24px;
}
.eyebrow {
  font-family: var(--font-button);
  font-size: var(--fs-12);
  font-weight: var(--w-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.title {
  font-family: var(--font-title);
  font-weight: var(--w-bold);
  font-size: var(--fs-48);
  margin: 0;
  line-height: 1.1;
}
.italic { font-family: var(--font-hand); font-style: italic; color: var(--c-orange); }
.body { font-size: var(--fs-16); margin: 0; }
```

- [ ] **Step 4: Implement receipt mode in `OrderSummaryPane.tsx`**

Replace the `ReceiptPane` placeholder added earlier:

```tsx
const ReceiptPane = ({ orderId, placedAt, lines, customer, delivery, payment, paid }: ReceiptPaneProps) => {
  const dateStr = new Date(placedAt).toLocaleDateString('en-GB');
  return (
    <aside className={styles.pane}>
      <header className={styles.head}>
        <code className={styles.orderId}>{orderId} · {dateStr}</code>
        <h2 className={styles.title}>Receipt</h2>
      </header>
      <Section heading="Items">
        {lines.map((l) => (
          <article key={l.key} className={styles.itemCard}>
            <div className={styles.itemPhoto} />
            <div className={styles.itemBody}>
              <div className={styles.itemName}>{l.config.productName}</div>
              <div className={styles.itemDetail}>qty {l.qty}</div>
            </div>
            <div className={styles.itemPrice}>
              <span className={styles.itemPriceUnit}>RM</span>
              {fmtRM(l.qty * l.config.total).replace('RM ', '')}
            </div>
          </article>
        ))}
      </Section>
      <Section heading="Delivery">
        {customer.address && <Row label="Address" value={customer.address} />}
        <Row label="Date" value={delivery.date ?? ''} placeholder="—" />
      </Section>
      <Section heading="Payment">
        <Row label="Method" value={payment.method} />
        <Row label="Status" value="Recorded" />  {/* TODO style green via custom */}
      </Section>
      <footer className={styles.totalBar}>
        <span className="t-eyebrow">Paid</span>
        <PriceTag amount={paid} size="lg" />
        <p className={styles.totalCaption}>Same price. Every piece. Always.</p>
      </footer>
    </aside>
  );
};
```

- [ ] **Step 5: Implement `Confirmed.tsx`**

```tsx
import { useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { Printer, ShoppingBag } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useOrderById } from '../lib/orders-by-id';
import { firstName } from '../lib/handover-helpers';
import { Hero } from '../components/handover/Hero';
import { OrderSummaryPane } from '../components/handover/OrderSummaryPane';
import { Topbar } from '../components/Topbar';
import type { CartLine } from '../state/cart';
import styles from './Confirmed.module.css';
import './Confirmed.print.css';

const PAYMENT_LABEL: Record<string, string> = {
  credit: 'Credit Card',
  debit: 'Debit Card',
  transfer: 'Bank transfer / DuitNow',
  installment: 'Installment',
};

export const Confirmed = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useOrderById(orderId);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  if (isLoading) return <main className={styles.shell}>Loading…</main>;
  if (error || !data) return <main className={styles.shell}>Could not load order: {String(error)}</main>;

  const eta = data.delivery_date
    ? new Date(data.delivery_date + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })
    : 'a date we will confirm soon';

  // Fabricate CartLine-shape items for the OrderSummaryPane (which expects that shape).
  const fakeLines: CartLine[] = data.lines.map((l) => ({
    key: l.product_id,
    qty: l.qty,
    config: {
      kind: 'flat' as const,
      productId: l.product_id,
      productName: l.product_name,
      total: Math.round(l.line_total / l.qty),
      summary: '',
    },
  }));

  return (
    <>
      <Topbar step="confirm" />
      <div className={styles.layout}>
        <div className={styles.left}>
          <Hero
            imageKey={data.dominantCategory?.hero_image_key ?? null}
            firstName={firstName(data.customer_name)}
            orderId={data.id}
            eta={eta}
            email={data.customer_email}
          />
          <div className={styles.actions}>
            <Link to="/catalog">
              <Button variant="primary">
                <ShoppingBag size={16} strokeWidth={1.75} />&nbsp;New order
              </Button>
            </Link>
            <Button variant="ghost" onClick={() => window.print()}>
              <Printer size={16} strokeWidth={1.75} />&nbsp;Print receipt
            </Button>
          </div>
        </div>
        <div className={`${styles.right} receipt`}>
          <OrderSummaryPane
            mode="receipt"
            orderId={data.id}
            placedAt={data.placed_at}
            lines={fakeLines}
            customer={{ name: data.customer_name, address: data.customer_address ?? undefined }}
            delivery={{ date: eta }}
            payment={{ method: PAYMENT_LABEL[data.payment_method] ?? data.payment_method }}
            paid={data.paid}
          />
        </div>
      </div>
    </>
  );
};
```

- [ ] **Step 6: Create `Confirmed.module.css`**

```css
.layout {
  display: grid;
  grid-template-columns: 60% 40%;
  min-height: 100vh;
}
.left {
  position: relative;
  display: flex;
  flex-direction: column;
}
.actions {
  position: absolute;
  bottom: var(--space-7);
  left: var(--space-7);
  display: flex;
  gap: var(--space-3);
  z-index: 2;
}
.right {
  background: var(--bg-alt);
  padding: var(--space-5);
  overflow-y: auto;
}
.shell { padding: var(--space-7); text-align: center; }

@media (max-width: 1024px) {
  .layout { grid-template-columns: 1fr; }
  .actions { position: static; padding: var(--space-3); }
}
```

- [ ] **Step 7: Create `Confirmed.print.css`**

```css
@media print {
  /* Hide everything outside the receipt. */
  body > div > *:not(:has(.receipt)) { display: none; }
  /* Hide hero / nav / buttons */
  .hero, .actions, [class*="Topbar"] { display: none !important; }
  /* Expand receipt to full page */
  .receipt {
    position: absolute;
    inset: 0;
    background: white;
    color: black;
    padding: 24pt;
  }
  /* Reset borders/backgrounds for printer-friendliness */
  .receipt aside { border: none; background: transparent; }
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/pos/src/pages/Confirmed.tsx apps/pos/src/pages/Confirmed.module.css apps/pos/src/pages/Confirmed.print.css apps/pos/src/components/handover/Hero.tsx apps/pos/src/components/handover/Hero.module.css apps/pos/src/components/handover/OrderSummaryPane.tsx apps/pos/src/lib/orders-by-id.ts
git commit -m "feat(pos): Confirmed page w/ Hero + receipt OrderSummaryPane + print CSS"
```

---

### Task 17: Router swap — delete OrderConfirmed, add /confirmed route

**Files:**
- Modify: `apps/pos/src/router.tsx`
- Delete: `apps/pos/src/pages/OrderConfirmed.tsx`
- Delete: `apps/pos/src/pages/OrderConfirmed.module.css`

- [ ] **Step 1: Update router**

```tsx
import { createBrowserRouter, Navigate } from 'react-router';
import { Login } from './pages/Login';
import { Catalog } from './pages/Catalog';
import { Configurator } from './pages/Configurator';
import { Cart } from './pages/Cart';
import { Handover } from './pages/Handover';
import { Confirmed } from './pages/Confirmed';
import { OrderStatus } from './pages/OrderStatus';
import { Quotes } from './pages/Quotes';
import { AuthGate } from './components/AuthGate';

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/catalog', element: <AuthGate><Catalog /></AuthGate> },
  { path: '/configure/:productId', element: <AuthGate><Configurator /></AuthGate> },
  { path: '/cart', element: <AuthGate><Cart /></AuthGate> },
  { path: '/handover', element: <AuthGate><Handover /></AuthGate> },
  { path: '/confirmed/:orderId', element: <AuthGate><Confirmed /></AuthGate> },
  { path: '/my-orders', element: <AuthGate><OrderStatus /></AuthGate> },
  { path: '/quotes', element: <AuthGate><Quotes /></AuthGate> },
  { path: '/', element: <Navigate to="/catalog" replace /> },
  { path: '*', element: <Navigate to="/catalog" replace /> },
]);
```

- [ ] **Step 2: Delete `OrderConfirmed.tsx` and its CSS**

```bash
rm apps/pos/src/pages/OrderConfirmed.tsx apps/pos/src/pages/OrderConfirmed.module.css
```

- [ ] **Step 3: Typecheck + verify**

```bash
pnpm --filter @2990s/pos typecheck
```

Expected: no errors.

Test in preview: complete a handover flow → should land on `/confirmed/SO-XXXX` with hero + receipt.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/router.tsx
git rm apps/pos/src/pages/OrderConfirmed.tsx apps/pos/src/pages/OrderConfirmed.module.css
git commit -m "feat(pos): swap router /orders/:orderId -> /confirmed/:orderId"
```

---

## Phase G — Backend SKU Master hero widget (task 18)

### Task 18: Category hero upload endpoint + Backend widget

**Files:**
- Create: `apps/api/src/routes/categories.ts`
- Create: `apps/api/src/routes/categories.test.ts`
- Modify: `apps/api/src/index.ts` (mount the route)
- Modify: `apps/api/wrangler.toml` (add `R2_PUBLIC_URL` env var, public R2 binding if separate bucket)
- Create: `apps/backend/src/components/CategoryHeroUploader.tsx`
- Create: `apps/backend/src/components/CategoryHeroUploader.module.css`
- Modify: `apps/backend/src/pages/SkuMaster.tsx` (mount the widget)

- [ ] **Step 1: Decide R2 public access**

Two options:

A. **Separate public R2 bucket** (`2990s-public`) bound as `env.PUBLIC_ASSETS`. Add to `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "PUBLIC_ASSETS"
bucket_name = "2990s-public"
preview_bucket_name = "2990s-public"
```

The bucket has a Cloudflare public access enabled (no signed URLs). Set `R2_PUBLIC_URL` env to `https://pub-<hash>.r2.dev` or a custom domain.

B. **Reuse existing `SLIPS` bucket** with a signed-URL proxy route. Less ideal — every Confirmed page mount triggers a sign.

**Choice:** Option A. Slightly more infra (one new bucket), but the right primitive for a public-facing asset.

- [ ] **Step 2: Create `categories.ts` route**

```ts
import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const categoriesApi = new Hono<{ Bindings: Env; Variables: Variables }>();

categoriesApi.use('*', supabaseAuth);

const ADMIN_ROLES = new Set(['admin', 'coordinator']);

categoriesApi.post('/:id/hero-image', async (c) => {
  const userId = c.get('user').id;
  const supabaseForRole = c.get('supabase');
  const staffRes = await supabaseForRole.from('staff').select('role').eq('id', userId).maybeSingle();
  if (!staffRes.data || !ADMIN_ROLES.has(staffRes.data.role)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const id = c.req.param('id');
  const ct = c.req.header('content-type') ?? '';
  if (!ct.startsWith('image/jpeg') && !ct.startsWith('image/png')) {
    return c.json({ error: 'unsupported_type' }, 400);
  }

  const blob = await c.req.arrayBuffer();
  if (blob.byteLength > 4 * 1024 * 1024) {
    return c.json({ error: 'too_large', max: '4MB' }, 413);
  }

  const ext = ct.endsWith('jpeg') ? 'jpg' : 'png';
  const key = `category-heroes/${id}.${ext}`;

  await c.env.PUBLIC_ASSETS.put(key, blob, { httpMetadata: { contentType: ct } });
  await supabaseForRole.from('categories').update({ hero_image_key: key }).eq('id', id);

  return c.json({ ok: true, key });
});

categoriesApi.delete('/:id/hero-image', async (c) => {
  /* analogous: role check → fetch row → delete from R2 → null out column */
  const userId = c.get('user').id;
  const supabaseForRole = c.get('supabase');
  const staffRes = await supabaseForRole.from('staff').select('role').eq('id', userId).maybeSingle();
  if (!staffRes.data || !ADMIN_ROLES.has(staffRes.data.role)) return c.json({ error: 'forbidden' }, 403);

  const id = c.req.param('id');
  const row = await supabaseForRole.from('categories').select('hero_image_key').eq('id', id).maybeSingle();
  if (row.data?.hero_image_key) {
    await c.env.PUBLIC_ASSETS.delete(row.data.hero_image_key);
  }
  await supabaseForRole.from('categories').update({ hero_image_key: null }).eq('id', id);

  return c.json({ ok: true });
});
```

- [ ] **Step 3: Mount in `apps/api/src/index.ts`**

```ts
import { categoriesApi } from './routes/categories';
// ...
app.route('/admin/categories', categoriesApi);
```

- [ ] **Step 4: Add `categories.test.ts`**

```ts
describe('POST /admin/categories/:id/hero-image', () => {
  it('rejects non-admin', async () => { /* ... */ });
  it('rejects > 4MB', async () => { /* ... */ });
  it('uploads and updates hero_image_key', async () => { /* ... */ });
});
```

(Engineer expands tests per existing test harness patterns in `apps/api/`.)

- [ ] **Step 5: Implement `CategoryHeroUploader.tsx`**

```tsx
import { useRef, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { fetchAdminApi } from '../lib/api';
import styles from './CategoryHeroUploader.module.css';

export const CategoryHeroUploader = ({ categoryId, currentKey, onChange }: {
  categoryId: string;
  currentKey: string | null;
  onChange: (newKey: string | null) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const res = await fetchAdminApi(`/categories/${categoryId}/hero-image`, {
        method: 'POST',
        headers: { 'content-type': file.type },
        body: file,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'upload_failed');
      onChange(body.key);
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await fetchAdminApi(`/categories/${categoryId}/hero-image`, { method: 'DELETE' });
      onChange(null);
    } finally { setBusy(false); }
  };

  const previewUrl = currentKey ? `${import.meta.env.VITE_R2_PUBLIC_URL}/${currentKey}` : null;

  return (
    <div className={styles.uploader}>
      {previewUrl ? (
        <div className={styles.preview} style={{ backgroundImage: `url(${previewUrl})` }} />
      ) : (
        <div className={`${styles.preview} ${styles.previewEmpty}`}>No image</div>
      )}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload size={14} strokeWidth={1.75} /> Upload
        </button>
        {currentKey && (
          <button type="button" disabled={busy} onClick={remove} className={styles.removeBtn}>
            <Trash2 size={14} strokeWidth={1.75} /> Remove
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
      />
    </div>
  );
};
```

- [ ] **Step 6: Mount widget in `SkuMaster.tsx`**

In `apps/backend/src/pages/SkuMaster.tsx`, find the categories editor section. Add a column rendering the uploader per category row. Wire it up to a mutation that refetches the categories list.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/categories.ts apps/api/src/routes/categories.test.ts apps/api/src/index.ts apps/api/wrangler.toml apps/backend/src/components/CategoryHeroUploader.tsx apps/backend/src/components/CategoryHeroUploader.module.css apps/backend/src/pages/SkuMaster.tsx
git commit -m "feat(backend): category hero image upload widget + API endpoint"
```

---

## Phase H — End-to-end verification (task 19)

### Task 19: Visual + functional regression via preview tools

**Files:** N/A (verification only)

- [ ] **Step 1: Smoke-test Phase 1 navigation**

In the preview, start at `/handover` with cart populated:

1. Customer step: fill name + valid email → Next button should enable
2. Address step: toggle "Fill in address later" → all address fields should hide; right pane shows "To be filled later"
3. Uncheck → fields reappear; fill all 5 + select building type
4. Right pane updates each field live
5. Emergency: leave empty → Next enabled (optional); or fill all 3 → Next enabled
6. Target date: pick a date in the calendar → orange highlight; today/past should be disabled

- [ ] **Step 2: Smoke-test Phase 2 navigation**

1. Add-ons: click "configurable" on lift → expands; fill floors/items; toggle selected → right pane Add-ons total updates
2. Payment method: pick Debit Card → right pane Payment row shows "Debit Card"
3. Confirm payment: defaults to full preset; press "Confirm payment received" → green "Payment recorded" line + button changes to "Continue to signature →"
4. Sign step: draw on canvas → "Signed. Ready to place order" green message + Complete order enabled
5. Press Complete order → navigates to `/confirmed/SO-XXXX`

- [ ] **Step 3: Smoke-test Confirmed page**

1. Hero photo loads (either category-specific from R2 or fallback `/imagery/bedroom-warm.jpg`)
2. "Welcome home, {firstName}." renders with correct first name
3. Eta line shows "Your order will arrive on {weekday, day month}"
4. Right pane shows Receipt with ITEMS / DELIVERY / PAYMENT / PAID
5. Click "Print receipt" → browser print preview shows ONLY the receipt panel, no hero/nav

- [ ] **Step 4: Verify schema persistence**

Query the DB via Supabase MCP:

```sql
SELECT id, customer_type, building_type, billing_same, salesperson_id, delivery_notes
FROM orders
WHERE id = 'SO-XXXX'
LIMIT 1;
```

Confirm all 5 columns populated with the values entered during the flow.

```sql
SELECT addon_id, qty, floors_count, items_count, line_total
FROM order_items
WHERE order_id = 'SO-XXXX' AND kind = 'addon';
```

Confirm addon rows exist for the addons selected, with server-computed `line_total`.

- [ ] **Step 5: Verify pricing drift still triggers**

Tamper a request manually (e.g., set `clientTotal` lower than computed) and confirm the 409 + `PricingDriftModal` flow still works.

- [ ] **Step 6: Final commit / cleanup**

Confirm no console errors. If any TODO comments remain, address or remove them.

```bash
git status
# review uncommitted, address, commit a final pass if needed
```

- [ ] **Step 7: Update `MEMORY.md` if status changed**

(Optional — only if the project-status memory needs updating.)

---

## Self-Review

After writing this plan, I checked it against the spec:

**1. Spec coverage:**
- §1 Goal & scope — covered by Task 5 + Task 16
- §2 Routes — covered by Task 17
- §3 Step structure + validity + footer labels — Tasks 5, 6, 8-15
- §4 Form state model + relationships + salesperson + building type — Tasks 5, 8-10
- §5 OrderSummaryPane (form + receipt) — Tasks 7, 16
- §6 MonthCalendar — Task 11
- §7 Add-on cards inline expand — Task 13
- §8 Confirm payment slip — Task 14
- §9 Migration 0023 — Task 1
- §10 API changes — Tasks 2, 3
- §11 Confirmed page hero / first name / dominant category / print CSS — Tasks 16
- §12 Component tree — File Structure section above
- §13 Backend SKU Master hero widget — Task 18
- §14 Testing — TDD in Tasks 2, 3, 4; Task 19 e2e
- §15-17 Open follow-ups / risks / phasing — documented

**2. Placeholder scan:** None found. All steps have actual code blocks. The `_p: any` props in Step 5 of Task 5 are intentional stubs replaced in subsequent tasks.

**3. Type consistency:** `HandoverForm`, `AddonSelection`, `AddonInfo`, `OrderV1PostBody`, `OrderSubmitInput`, `OrderDetail` — all defined once and reused consistently across tasks. Step names (`customer | address | emergency | target | addons | confirm | sign`) match across `STEPS` array, `validity` map, and `StepFooter` `currentKey` type.

**4. Ambiguity check:** None found — the "Confirm payment received" / "Continue to signature →" two-press flow is documented explicitly in Task 6 with the disabled-by-validation special case.

One known follow-up: Task 18's `R2_PUBLIC_URL` env var requires CF dashboard config for the public bucket; the engineer needs to provision the bucket and configure the public access before deploying. Captured in Step 1 of Task 18.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-17-handover-redesign.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
