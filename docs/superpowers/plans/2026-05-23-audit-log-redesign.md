# Payment Audit Log Redesign + Installment Term — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Backend Payment audit log page to the approved target design and capture an installment term (6/12 months) at POS so it can be shown in the audit log's method column.

**Architecture:** One new nullable `orders.installment_months` column flows POS → `create_order_with_items` RPC → `GET /admin/audit-log` → the redesigned page. The page reuses already-stored data (`paid`, `customerPhone`, `approvalCode`) for stat cards, deposit/full badges, and search; only the installment term is newly captured. Server-side pricing recompute is untouched (the term is metadata, 0% installment).

**Tech Stack:** Drizzle + Postgres RPC, Hono on CF Workers, Vite + React 19 + TanStack Query, CSS Modules with `@2990s/design-system` tokens, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-23-audit-log-redesign-design.md`

---

## File Structure

**Create:**
- `packages/db/migrations/0034_add_installment_months.sql` — add column + CHECK + recreate RPC.
- `packages/shared/src/schemas/order-v1.schema.test.ts` — installment refine tests.
- `apps/backend/src/lib/audit-log-view.ts` — pure view logic (badges, quick-range, search, method detail, initials).
- `apps/backend/src/lib/audit-log-view.test.ts` — its tests.
- `apps/backend/src/lib/audit-export.test.ts` — export column tests (create if absent).
- `apps/backend/e2e/audit-log-redesign.spec.ts` — E2E (align to existing e2e harness).

**Modify:**
- `packages/db/src/schema.ts` — `orders` table: add `installmentMonths`.
- `packages/shared/src/schemas/order-v1.schema.ts` — add `installmentMonths` + refine.
- `apps/api/src/routes/orders.ts:289-345` — thread `installmentMonths` into `rpcPayload`.
- `apps/api/src/routes/orders.test.ts` — assert RPC payload carries the term.
- `apps/api/src/routes/audit-log.ts:74-118` — add `paid, customer_phone, installment_months`.
- `apps/api/src/routes/audit-log.test.ts` — assert new fields in response.
- `apps/backend/src/lib/audit-log-queries.ts` — extend `AuditLogRow`, trim `AuditLogFilters`.
- `apps/backend/src/lib/audit-export.ts` — add Paid + Installment columns.
- `apps/pos/src/lib/handover-helpers.ts` — `HandoverForm.installmentMonths` + validation.
- `apps/pos/src/lib/handover-helpers.test.ts` — fixture + new tests.
- `apps/pos/src/components/handover/AddonsPaymentStep.tsx` — 6/12 selector.
- `apps/pos/src/pages/Handover.tsx:56-59,205` — init default + submit wiring.
- `apps/pos/src/lib/orders.ts:39-79,129-151` — `OrderSubmitInput` + `buildPostBody`.
- `apps/backend/src/components/AuditLogFilterBar.tsx` + `.module.css` — rebuild.
- `apps/backend/src/pages/AuditLog.tsx` + `.module.css` — rebuild.

---

### Task 1: DB — `installment_months` column + RPC

**Files:**
- Create: `packages/db/migrations/0034_add_installment_months.sql`
- Modify: `packages/db/src/schema.ts` (orders table, after `approvalCode` ~line 395)

> ⚠️ Do **not** run `pnpm db:generate` — migrations 0032/0033 are hand-authored and applied via Supabase MCP. Generating would create a competing migration + snapshot drift. Hand-write 0034 to match the existing style.

- [ ] **Step 1: Add the column to the Drizzle schema (source of truth)**

In `packages/db/src/schema.ts`, inside `export const orders`, immediately after the `approvalCode: text('approval_code'),` line (~395):

```ts
  // Installment term in months (6 or 12). NULL unless paymentMethod = 'installment'.
  // 0% installment — metadata only, never affects pricing. (Migration 0034)
  installmentMonths: integer('installment_months'),
```

- [ ] **Step 2: Write the migration SQL**

Create `packages/db/migrations/0034_add_installment_months.sql`. It adds the column (nullable, legacy-safe CHECK that permits NULL even for old installment rows), then recreates `create_order_with_items` — body identical to 0032, with `installment_months` added to the INSERT column list + values:

```sql
-- 0034_add_installment_months.sql
-- Capture the installment term (6 or 12 months) on installment orders, shown
-- in the Payment audit log's "Method · details" column. 0% installment —
-- metadata only, never affects pricing. Nullable + legacy-safe CHECK: existing
-- installment rows have NULL term (no backfill), so the constraint must allow
-- NULL for any payment method. "required for installment" is enforced at POS +
-- API for NEW orders only.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS installment_months integer;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_installment_months_check;
ALTER TABLE orders ADD CONSTRAINT orders_installment_months_check
  CHECK (installment_months IS NULL OR installment_months IN (6, 12));

-- Recreate create_order_with_items: body unchanged from 0032, the INSERT
-- picks up one more column + value (installment_months).
CREATE OR REPLACE FUNCTION public.create_order_with_items(p jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    delivery_fee_base, delivery_fee_cross_category, delivery_fee_additional,
    pricing_version,
    payment_method, approval_code, installment_months,
    notes, delivery_notes,
    delivery_date, delivery_slot, delivery_tbd,
    slip_key, slip_state,
    signature_data
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
    COALESCE((p->>'deliveryFeeBase')::int, 0),
    COALESCE((p->>'deliveryFeeCrossCategory')::int, 0),
    COALESCE((p->>'deliveryFeeAdditional')::int, 0),
    v_pricing_version,
    (p->>'paymentMethod')::payment_method,
    NULLIF(p->>'approvalCode', ''),
    NULLIF(p->>'installmentMonths', '')::int,
    NULLIF(p->>'notes', ''),
    NULLIF(p->>'specialInstructions', ''),
    NULLIF(p->>'deliveryDate', '')::date,
    NULLIF(p->>'deliverySlot', ''),
    COALESCE((p->>'addressLater')::boolean, FALSE),
    v_session_row.r2_key,
    CASE WHEN v_session_row.id IS NOT NULL
         THEN 'pending'::slip_state
         ELSE 'none'::slip_state END,
    NULLIF(p->>'signatureData', '')
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
$function$;
```

- [ ] **Step 3: Apply to the live Supabase (Singapore) via MCP**

> Real-DB mutation. Additive + nullable → safe on existing rows.

Use the Supabase MCP `apply_migration` tool: `name = "0034_add_installment_months"`, `query =` the full SQL above.

- [ ] **Step 4: Verify column + constraint exist**

Run via Supabase MCP `execute_sql`:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'installment_months';
```
Expected: one row, `installment_months | integer`.

```sql
INSERT INTO orders_installment_months_check_probe AS x VALUES (1) ON CONFLICT DO NOTHING;
```
(skip — instead) confirm the CHECK rejects bad data:
```sql
DO $$ BEGIN
  PERFORM 1;
  BEGIN
    -- expect failure
    EXECUTE 'UPDATE orders SET installment_months = 7 WHERE id = (SELECT id FROM orders LIMIT 1)';
    RAISE NOTICE 'CHECK did NOT fire (unexpected)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'CHECK fired as expected';
  END;
  ROLLBACK;
END $$;
```
Expected notice: `CHECK fired as expected`.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @2990s/db typecheck` (Expected: passes — `integer` is already imported in schema.ts).

```bash
git add packages/db/migrations/0034_add_installment_months.sql packages/db/src/schema.ts
git commit -m "feat(db): orders.installment_months + RPC (migration 0034)"
```

---

### Task 2: Shared schema — `installmentMonths` + refine

**Files:**
- Modify: `packages/shared/src/schemas/order-v1.schema.ts:73-135`
- Test: `packages/shared/src/schemas/order-v1.schema.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/schemas/order-v1.schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { orderV1PostSchema } from './order-v1.schema';

const base = {
  customer: { name: 'Tan Wei Ming' },
  lines: [{ qty: 1, config: { kind: 'flat' as const, productId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } }],
  clientTotal: 5980,
};

describe('orderV1PostSchema installmentMonths', () => {
  it('accepts an installment order with a 12-month term', () => {
    const r = orderV1PostSchema.safeParse({ ...base, paymentMethod: 'installment', installmentMonths: 12 });
    expect(r.success).toBe(true);
  });

  it('rejects an installment order with no term', () => {
    const r = orderV1PostSchema.safeParse({ ...base, paymentMethod: 'installment' });
    expect(r.success).toBe(false);
  });

  it('rejects an installment term that is not 6 or 12', () => {
    const r = orderV1PostSchema.safeParse({ ...base, paymentMethod: 'installment', installmentMonths: 24 });
    expect(r.success).toBe(false);
  });

  it('rejects a term on a non-installment order', () => {
    const r = orderV1PostSchema.safeParse({ ...base, paymentMethod: 'credit', installmentMonths: 6 });
    expect(r.success).toBe(false);
  });

  it('accepts a credit order with no term (null/omitted)', () => {
    expect(orderV1PostSchema.safeParse({ ...base, paymentMethod: 'credit' }).success).toBe(true);
    expect(orderV1PostSchema.safeParse({ ...base, paymentMethod: 'credit', installmentMonths: null }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @2990s/shared test order-v1.schema`
Expected: FAIL (term currently ignored; rejection cases pass through as success).

- [ ] **Step 3: Add the field + refine**

In `order-v1.schema.ts`, add inside the object (after `approvalCode` ~line 85):

```ts
  // Installment term — 6 or 12 months. Required iff paymentMethod = 'installment'
  // (enforced by the .superRefine below). 0% installment — never affects pricing.
  installmentMonths: z.union([z.literal(6), z.literal(12)]).nullable().optional(),
```

Then change the schema's closing from `});` to a `.superRefine`:

```ts
}).superRefine((v, ctx) => {
  if (v.paymentMethod === 'installment') {
    if (v.installmentMonths !== 6 && v.installmentMonths !== 12) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['installmentMonths'],
        message: 'installment_term_required' });
    }
  } else if (v.installmentMonths !== undefined && v.installmentMonths !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['installmentMonths'],
      message: 'installment_term_only_for_installment' });
  }
});
```

(The `export type OrderV1PostBody = z.infer<typeof orderV1PostSchema>;` line picks up the new field automatically.)

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @2990s/shared test order-v1.schema`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/order-v1.schema.ts packages/shared/src/schemas/order-v1.schema.test.ts
git commit -m "feat(shared): installmentMonths on order-v1 schema with refine"
```

---

### Task 3: API — thread `installmentMonths` into the order RPC

**Files:**
- Modify: `apps/api/src/routes/orders.ts:330-344` (the conditional spreads in `rpcPayload`)
- Test: `apps/api/src/routes/orders.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `orders.test.ts` (it already has `createMockSupabase` with `rpcCapture` and `buildApp`; reuse the existing helpers and the file's product/pricing handlers — copy the closest existing happy-path test in this file and adjust). Append a new `describe`:

```ts
describe('POST /orders installmentMonths', () => {
  it('forwards installmentMonths to the RPC payload for installment orders', async () => {
    const rpcCapture: { last?: { name: string; args: any } } = {};
    const supabase = createMockSupabase({
      staff: () => ({ data: { role: 'sales', active: true }, error: null }),
      products: () => ({ data: [{ id: PRODUCT_ID, category_id: 'sofa', pricing_kind: 'flat', flat_price: 5980, recliner_upgrade_price: 0 }], error: null }),
      product_compartments: () => ({ data: [], error: null }),
      product_bundles: () => ({ data: [], error: null }),
      product_size_variants: () => ({ data: [], error: null }),
      addons: () => ({ data: [], error: null }),
      delivery_fee_config: defaultDeliveryFeeCfg,
    }, rpcCapture, { data: 'SO-2991', error: null });
    const app = buildApp(supabase);

    const res = await app.request('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer: { name: 'Hafiz Rahman' },
        paymentMethod: 'installment',
        installmentMonths: 12,
        approvalCode: 'CONTRACT-1',
        lines: [{ qty: 1, config: { kind: 'flat', productId: PRODUCT_ID } }],
        clientTotal: 5980 + 250, // flat_price + base delivery fee
      }),
    }, baseEnv);

    expect(res.status).toBe(201);
    expect(rpcCapture.last?.args?.p?.installmentMonths).toBe(12);
  });
});
```

> If the chosen `clientTotal` trips a 409 drift, copy the exact total from the nearest passing happy-path test in this file (delivery fee config is 250/175).

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @2990s/api test orders`
Expected: FAIL — `rpcCapture.last.args.p.installmentMonths` is `undefined`.

- [ ] **Step 3: Add the spread to `rpcPayload`**

In `orders.ts`, in the `rpcPayload` object, after the `...(dto.addressLater !== undefined ? ... )` line (~343), add:

```ts
    ...(dto.installmentMonths != null ? { installmentMonths: dto.installmentMonths } : {}),
```

(No change anywhere near `computeOrderTotal` / `finalTotal` — pricing is untouched.)

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @2990s/api test orders`
Expected: PASS (new test + all existing orders tests still green).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/orders.ts apps/api/src/routes/orders.test.ts
git commit -m "feat(api): forward installmentMonths to create_order RPC"
```

---

### Task 4: API — return `paid`, `customerPhone`, `installmentMonths` from audit-log

**Files:**
- Modify: `apps/api/src/routes/audit-log.ts:74-118`
- Test: `apps/api/src/routes/audit-log.test.ts`

- [ ] **Step 1: Write the failing test**

In `audit-log.test.ts`, extend the `FakeRow` type and add a test. Add to `FakeRow` (line 20):

```ts
  paid: number;
  customer_phone: string | null;
  installment_months: number | null;
```

Add a new test inside the `describe`:

```ts
  it('returns paid, customerPhone, installmentMonths', async () => {
    const app = buildApp('coordinator', [{
      id: 'SO-2991', placed_at: '2026-05-21T15:01:00Z',
      customer_name: 'Hafiz Rahman', customer_phone: '+60 11 998 7766',
      total: 6819, paid: 4466,
      payment_method: 'installment', installment_months: 12,
      approval_code: 'CONTRACT-1', slip_key: null,
      showroom_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      salesperson_id: 'sp-1', staff_id: 'staff-1',
    }]);
    const res = await app.request('/admin/audit-log', {}, baseEnv);
    const body = await res.json() as any;
    expect(body.rows[0]).toMatchObject({
      paid: 4466, customerPhone: '+60 11 998 7766', installmentMonths: 12,
    });
  });
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @2990s/api test audit-log`
Expected: FAIL — `paid`/`customerPhone`/`installmentMonths` are `undefined` on the row.

- [ ] **Step 3: Add the columns to the select + mapping**

In `audit-log.ts`, change the `.select(...)` (line 76-78) to:

```ts
    .select(
      'id, placed_at, customer_name, customer_phone, total, paid, payment_method, installment_months, approval_code, slip_key, showroom_id, salesperson_id, staff_id',
    )
```

And the row mapping (line 104-116) — add three fields:

```ts
  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    placedAt: r.placed_at,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    total: r.total,
    paid: r.paid,
    paymentMethod: r.payment_method,
    installmentMonths: r.installment_months,
    approvalCode: r.approval_code,
    slipKey: r.slip_key,
    slipUploaded: r.slip_key !== null,
    showroomId: r.showroom_id,
    salespersonId: r.salesperson_id,
    staffId: r.staff_id,
  }));
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @2990s/api test audit-log`
Expected: PASS (existing `toMatchObject` tests still pass — only additive fields).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/audit-log.ts apps/api/src/routes/audit-log.test.ts
git commit -m "feat(api): audit-log returns paid, customerPhone, installmentMonths"
```

---

### Task 5: Backend queries — extend row type, trim filters

**Files:**
- Modify: `apps/backend/src/lib/audit-log-queries.ts:7-54`

No standalone test (types only — verified by typecheck + downstream tasks).

- [ ] **Step 1: Replace the types + query string builder**

In `audit-log-queries.ts`, delete `export type SlipFilter` (line 7) and replace `AuditLogFilters`, `AuditLogRow`, and `buildQueryString`:

```ts
export interface AuditLogFilters {
  from?: string;
  to?: string;
  salespersonIds?: string[];
  paymentMethods?: string[];
  amountMin?: number;
  amountMax?: number;
}

export interface AuditLogRow {
  id: string;
  placedAt: string;
  customerName: string;
  customerPhone: string | null;
  total: number;
  paid: number;
  paymentMethod: string;
  installmentMonths: number | null;
  approvalCode: string | null;
  slipKey: string | null;
  slipUploaded: boolean;
  showroomId: string;
  salespersonId: string | null;
  staffId: string;
}
```

```ts
function buildQueryString(f: AuditLogFilters): string {
  const params = new URLSearchParams();
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  for (const id of f.salespersonIds ?? []) params.append('salespersonId', id);
  for (const m of f.paymentMethods ?? []) params.append('paymentMethod', m);
  if (f.amountMin !== undefined) params.set('amountMin', String(f.amountMin));
  if (f.amountMax !== undefined) params.set('amountMax', String(f.amountMax));
  const s = params.toString();
  return s ? `?${s}` : '';
}
```

(`useAuditLog` / `useAuditLogRealtime` unchanged. The API still accepts the dropped params; we simply stop sending them.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: errors in `AuditLog.tsx` / `AuditLogFilterBar.tsx` (they reference removed fields). That's expected — Tasks 10/11 rewrite them. Do NOT fix here.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/lib/audit-log-queries.ts
git commit -m "refactor(backend): audit-log row gains paid/phone/term; filters trimmed"
```

---

### Task 6: Backend — pure view logic module

**Files:**
- Create: `apps/backend/src/lib/audit-log-view.ts`
- Test: `apps/backend/src/lib/audit-log-view.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/lib/audit-log-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  rangeForPreset, presetForRange, amountBadge, matchesSearch,
  methodLabel, methodDetail, initials,
} from './audit-log-view';
import type { AuditLogRow } from './audit-log-queries';

const FIXED = new Date('2026-05-23T08:00:00Z'); // a Saturday

const row = (over: Partial<AuditLogRow> = {}): AuditLogRow => ({
  id: 'SO-2057', placedAt: '2026-05-21T15:01:00Z',
  customerName: 'Hafiz Rahman', customerPhone: '+60 11 998 7766',
  total: 6819, paid: 4466, paymentMethod: 'installment', installmentMonths: 12,
  approvalCode: 'CONTRACT-1', slipKey: null, slipUploaded: false,
  showroomId: 'sh', salespersonId: 'sp', staffId: 'st', ...over,
});

describe('rangeForPreset', () => {
  it('today is a single day', () => {
    expect(rangeForPreset('today', FIXED)).toEqual({ from: '2026-05-23', to: '2026-05-23' });
  });
  it('yesterday is the prior single day', () => {
    expect(rangeForPreset('yesterday', FIXED)).toEqual({ from: '2026-05-22', to: '2026-05-22' });
  });
  it('last7 / last30 / last90 span back from today', () => {
    expect(rangeForPreset('last7', FIXED)).toEqual({ from: '2026-05-17', to: '2026-05-23' });
    expect(rangeForPreset('last30', FIXED)).toEqual({ from: '2026-04-23', to: '2026-05-23' });
    expect(rangeForPreset('last90', FIXED)).toEqual({ from: '2026-02-22', to: '2026-05-23' });
  });
});

describe('presetForRange', () => {
  it('round-trips each preset', () => {
    for (const p of ['today','yesterday','last7','last30','last90'] as const) {
      const { from, to } = rangeForPreset(p, FIXED);
      expect(presetForRange(from, to, FIXED)).toBe(p);
    }
  });
  it('returns null for a custom range', () => {
    expect(presetForRange('2026-01-01', '2026-01-15', FIXED)).toBeNull();
  });
});

describe('amountBadge', () => {
  it('full when paid >= total', () => {
    expect(amountBadge(6819, 6819)).toEqual({ kind: 'full' });
    expect(amountBadge(7000, 6819)).toEqual({ kind: 'full' });
  });
  it('deposit with rounded percent otherwise', () => {
    expect(amountBadge(4466, 6819)).toEqual({ kind: 'deposit', pct: 65, total: 6819 });
  });
  it('full when total is zero (no divide-by-zero)', () => {
    expect(amountBadge(0, 0)).toEqual({ kind: 'full' });
  });
});

describe('matchesSearch', () => {
  it('empty query matches everything', () => { expect(matchesSearch(row(), '  ')).toBe(true); });
  it('matches SO#, customer, and approvalCode case-insensitively', () => {
    expect(matchesSearch(row(), 'so-2057')).toBe(true);
    expect(matchesSearch(row(), 'hafiz')).toBe(true);
    expect(matchesSearch(row(), 'contract-1')).toBe(true);
    expect(matchesSearch(row(), 'nope')).toBe(false);
  });
});

describe('methodLabel + methodDetail', () => {
  it('labels each method', () => {
    expect(methodLabel('credit')).toBe('Credit card');
    expect(methodLabel('debit')).toBe('Debit card');
    expect(methodLabel('installment')).toBe('Installment');
    expect(methodLabel('transfer')).toBe('Bank transfer');
  });
  it('shows the term only for installment', () => {
    expect(methodDetail(row({ paymentMethod: 'installment', installmentMonths: 12 }))).toBe('12 months');
    expect(methodDetail(row({ paymentMethod: 'installment', installmentMonths: null }))).toBeNull();
    expect(methodDetail(row({ paymentMethod: 'credit', installmentMonths: null }))).toBeNull();
  });
});

describe('initials', () => {
  it('first+last initial', () => { expect(initials('Hafiz Rahman')).toBe('HR'); });
  it('single name → first two chars', () => { expect(initials('Cher')).toBe('CH'); });
  it('blank → ?', () => { expect(initials('   ')).toBe('?'); });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @2990s/backend test audit-log-view`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `apps/backend/src/lib/audit-log-view.ts`:

```ts
import type { AuditLogRow } from './audit-log-queries';

export type QuickRange = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90';

/** Format a Date as YYYY-MM-DD in UTC (mirrors the existing audit-log date math). */
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (base: Date, n: number): Date => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

export function rangeForPreset(preset: QuickRange, now: Date = new Date()): { from: string; to: string } {
  const today = ymd(now);
  switch (preset) {
    case 'today':     return { from: today, to: today };
    case 'yesterday': { const y = ymd(addDays(now, -1)); return { from: y, to: y }; }
    case 'last7':     return { from: ymd(addDays(now, -6)),  to: today };
    case 'last30':    return { from: ymd(addDays(now, -29)), to: today };
    case 'last90':    return { from: ymd(addDays(now, -89)), to: today };
  }
}

export function presetForRange(
  from: string | undefined, to: string | undefined, now: Date = new Date(),
): QuickRange | null {
  if (!from || !to) return null;
  for (const p of ['today', 'yesterday', 'last7', 'last30', 'last90'] as const) {
    const r = rangeForPreset(p, now);
    if (r.from === from && r.to === to) return p;
  }
  return null;
}

export type AmountBadge = { kind: 'full' } | { kind: 'deposit'; pct: number; total: number };

export function amountBadge(paid: number, total: number): AmountBadge {
  if (total <= 0 || paid >= total) return { kind: 'full' };
  return { kind: 'deposit', pct: Math.round((paid / total) * 100), total };
}

export function matchesSearch(row: AuditLogRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return row.id.toLowerCase().includes(needle)
    || row.customerName.toLowerCase().includes(needle)
    || (row.approvalCode?.toLowerCase().includes(needle) ?? false);
}

const METHOD_LABELS: Record<string, string> = {
  credit: 'Credit card', debit: 'Debit card',
  installment: 'Installment', transfer: 'Bank transfer',
};
export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

export function methodDetail(row: AuditLogRow): string | null {
  if (row.paymentMethod === 'installment' && row.installmentMonths) {
    return `${row.installmentMonths} months`;
  }
  return null;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @2990s/backend test audit-log-view`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/audit-log-view.ts apps/backend/src/lib/audit-log-view.test.ts
git commit -m "feat(backend): audit-log pure view logic (badges, ranges, search, method)"
```

---

### Task 7: Backend export — add Paid + Installment columns

**Files:**
- Modify: `apps/backend/src/lib/audit-export.ts`
- Test: `apps/backend/src/lib/audit-export.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/extend `apps/backend/src/lib/audit-export.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { exportCsv, type AuditExportRow } from './audit-export';

const row: AuditExportRow = {
  id: 'SO-2057', placedAt: '2026-05-21T15:01:00Z', showroomName: 'Showroom KL',
  customerName: 'Hafiz Rahman', total: 6819, paid: 4466,
  paymentMethod: 'installment', installmentMonths: 12, approvalCode: 'CONTRACT-1',
  salespersonName: 'Rafiq Lim', keyedByName: 'Mei Lin Chua', slipUploaded: false,
};

describe('exportCsv', () => {
  it('includes Paid (RM) and Installment (months) headers', () => {
    const header = exportCsv([]).replace(/^﻿/, '').split('\n')[0]!;
    expect(header).toContain('Paid (RM)');
    expect(header).toContain('Installment (months)');
  });
  it('writes the paid amount and term in the data row', () => {
    const line = exportCsv([row]).split('\n')[1]!;
    expect(line).toContain('4466');
    expect(line).toContain('12');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @2990s/backend test audit-export`
Expected: FAIL — `paid`/`installmentMonths` not on `AuditExportRow`; headers missing.

- [ ] **Step 3: Add the columns**

In `audit-export.ts`:

Extend the interface:
```ts
export interface AuditExportRow {
  id: string;
  placedAt: string;
  showroomName: string;
  customerName: string;
  total: number;
  paid: number;
  paymentMethod: string;
  installmentMonths: number | null;
  approvalCode: string | null;
  salespersonName: string;
  keyedByName: string;
  slipUploaded: boolean;
}
```

Update `HEADERS` (insert `Paid (RM)` after `Amount (RM)`, `Installment (months)` after `Method`):
```ts
const HEADERS = [
  'SO#', 'Date', 'Showroom', 'Customer',
  'Amount (RM)', 'Paid (RM)', 'Method', 'Installment (months)',
  'Approval code', 'Salesperson', 'Keyed by', 'Slip uploaded',
] as const;
```

In `exportCsv`, the per-row array becomes (same order as HEADERS):
```ts
    lines.push([
      csvEscape(r.id),
      csvEscape(fmtDate(r.placedAt)),
      csvEscape(r.showroomName),
      csvEscape(r.customerName),
      csvEscape(r.total),
      csvEscape(r.paid),
      csvEscape(r.paymentMethod),
      csvEscape(r.installmentMonths ?? ''),
      csvEscape(r.approvalCode),
      csvEscape(r.salespersonName),
      csvEscape(r.keyedByName),
      csvEscape(r.slipUploaded ? 'Yes' : 'No'),
    ].join(','));
```

In `exportXlsx`, the per-row push:
```ts
    data.push([
      r.id, fmtDate(r.placedAt), r.showroomName, r.customerName,
      r.total, r.paid, r.paymentMethod, r.installmentMonths ?? '',
      r.approvalCode ?? '', r.salespersonName, r.keyedByName,
      r.slipUploaded ? 'Yes' : 'No',
    ]);
```

And the `!cols` widths array — 12 entries now:
```ts
  (ws as any)['!cols'] = [
    { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 22 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 },
    { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 14 },
  ];
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @2990s/backend test audit-export`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/audit-export.ts apps/backend/src/lib/audit-export.test.ts
git commit -m "feat(backend): export Paid (RM) + Installment (months) columns"
```

---

### Task 8: POS — installment term in the form model + validation

**Files:**
- Modify: `apps/pos/src/lib/handover-helpers.ts:20-51` (type), `:88-89` + `:149-152` (validation)
- Test: `apps/pos/src/lib/handover-helpers.test.ts:17-32` (fixture) + new cases

- [ ] **Step 1: Write the failing test**

In `handover-helpers.test.ts`, add `installmentMonths: null` to the `baseForm` fixture (after `slipUploadSessionId: null, paymentRecorded: false,`), then add:

```ts
describe('validateAddonsPayment + installment term', () => {
  it('non-installment methods need no term', () => {
    expect(validateAddonsPayment({ ...baseForm, paymentMethod: 'credit' })).toBe(true);
  });
  it('installment requires a 6/12 term', () => {
    expect(validateAddonsPayment({ ...baseForm, paymentMethod: 'installment', installmentMonths: null })).toBe(false);
    expect(validateAddonsPayment({ ...baseForm, paymentMethod: 'installment', installmentMonths: 12 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @2990s/pos test handover-helpers`
Expected: FAIL — fixture lacks `installmentMonths` (type error) and/or installment-without-term returns `true`.

- [ ] **Step 3: Add the field + validation**

In `handover-helpers.ts`, add to `HandoverForm` (after `paymentMethod: PaymentMethod;` ~line 40):
```ts
  /** Installment term in months. Required when paymentMethod === 'installment'. */
  installmentMonths: 6 | 12 | null;
```

Replace `validateAddonsPayment` (line 88-89):
```ts
export const validateAddonsPayment = (f: HandoverForm): boolean => {
  if (f.paymentMethod === '') return false;
  if (f.paymentMethod === 'installment' && f.installmentMonths == null) return false;
  return true;
};
```

Replace `addonsPaymentBlockers` (line 149-152):
```ts
const addonsPaymentBlockers = (f: HandoverForm): string[] => {
  if (!f.paymentMethod) return ['Pick a payment method'];
  if (f.paymentMethod === 'installment' && f.installmentMonths == null) {
    return ['Pick the installment term (6 or 12 months)'];
  }
  return [];
};
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @2990s/pos test handover-helpers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/lib/handover-helpers.ts apps/pos/src/lib/handover-helpers.test.ts
git commit -m "feat(pos): installment term on HandoverForm + step validation"
```

---

### Task 9: POS — 6/12 selector UI + submit wiring

**Files:**
- Modify: `apps/pos/src/components/handover/AddonsPaymentStep.tsx:100-117`
- Modify: `apps/pos/src/pages/Handover.tsx:56-59` (init) + `:205` (submit)
- Modify: `apps/pos/src/lib/orders.ts:52-79` (type) + `:140-145` (buildPostBody)

No new unit test (UI + wiring; covered by Task 12 E2E + typecheck).

- [ ] **Step 1: Add `installmentMonths` to `OrderSubmitInput` + `buildPostBody`**

In `orders.ts`, add to `OrderSubmitInput` (after `paid?: number;` ~line 66):
```ts
  /** Installment term (6 or 12 months); only set when paymentMethod==='installment'. */
  installmentMonths?: 6 | 12 | null;
```

In `buildPostBody`, in the returned object after the `paid` spread (~line 142):
```ts
    ...(input.installmentMonths != null ? { installmentMonths: input.installmentMonths } : {}),
```

- [ ] **Step 2: Render the 6/12 selector in `AddonsPaymentStep`**

In `AddonsPaymentStep.tsx`, replace the second `fieldRow` block (the one containing the Installment `MethodButton`, lines 100-115) so the selector appears under the Installment button when active. Replace lines 100-115 with:

```tsx
      <div className="fieldRow">
        <MethodButton
          active={form.paymentMethod === 'transfer'}
          icon={Banknote}
          label="Bank transfer / DuitNow"
          hint="Slip required"
          onClick={() => update('paymentMethod', 'transfer')}
        />
        <MethodButton
          active={form.paymentMethod === 'installment'}
          icon={Clock}
          label="Installment"
          hint="Agreement / contract no."
          onClick={() => update('paymentMethod', 'installment')}
        />
      </div>
      {form.paymentMethod === 'installment' && (
        <div className={styles.installmentTerm} role="group" aria-label="Installment term">
          <span className={styles.installmentTermLabel}>Term</span>
          {([6, 12] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`${styles.termChip} ${form.installmentMonths === m ? styles.termChipActive : ''}`}
              aria-pressed={form.installmentMonths === m}
              onClick={() => update('installmentMonths', m)}
            >
              {m} months
            </button>
          ))}
        </div>
      )}
```

Also make switching *away* from installment clear the term. Change the other three `MethodButton` `onClick`s to also reset, e.g. for credit:
```tsx
          onClick={() => { update('paymentMethod', 'credit'); update('installmentMonths', null); }}
```
Apply the same `update('installmentMonths', null)` to the debit and transfer buttons. (The installment button keeps just `update('paymentMethod', 'installment')`.)

- [ ] **Step 3: Add the matching styles**

Append to `apps/pos/src/pages/Handover.module.css`:

```css
.installmentTerm {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.installmentTermLabel {
  font-family: var(--font-button);
  font-size: var(--fs-12);
  font-weight: var(--w-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-muted);
}
.termChip {
  padding: 8px 18px;
  min-height: 44px;
  border: 1px solid var(--c-line);
  border-radius: var(--radius-pill);
  background: var(--bg);
  color: var(--c-ink);
  font: inherit;
  font-weight: var(--w-semibold);
  cursor: pointer;
}
.termChipActive {
  background: var(--c-burnt);
  border-color: var(--c-burnt);
  color: var(--c-cream);
}
```

- [ ] **Step 4: Initialise + submit the field in `Handover.tsx`**

In the form-defaults object (`Handover.tsx` ~line 56-59, where `paymentMethod: ''`, `amountPaid: 0`, `paymentPreset: 'full'` are set), add:
```ts
  installmentMonths: null,
```

In the submit-input object passed to the create-order mutation (~line 205, where `paid: form.amountPaid,` is), add:
```ts
        installmentMonths: form.installmentMonths,
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/components/handover/AddonsPaymentStep.tsx apps/pos/src/pages/Handover.tsx apps/pos/src/pages/Handover.module.css apps/pos/src/lib/orders.ts
git commit -m "feat(pos): 6/12 installment term selector wired through to POST /orders"
```

---

### Task 10: Backend — rebuild the filter panel

**Files:**
- Modify: `apps/backend/src/components/AuditLogFilterBar.tsx` (full rewrite)
- Modify: `apps/backend/src/components/AuditLogFilterBar.module.css` (full rewrite)

The bar is now the **collapsible detailed panel only**: Period, Payment method chips, Salesperson dropdown, Amount, Search, the match counter, and Reset. (Quick-range chips + stat cards live in the page — Task 11.)

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `AuditLogFilterBar.tsx`:

```tsx
import { useMemo } from 'react';
import { CreditCard, CalendarClock, QrCode, Search } from 'lucide-react';
import type { AuditLogFilters } from '../lib/audit-log-queries';
import { useStaff } from '../lib/admin-queries';
import styles from './AuditLogFilterBar.module.css';

const METHODS = [
  { value: 'credit',      label: 'Credit card',   Icon: CreditCard },
  { value: 'debit',       label: 'Debit card',    Icon: CreditCard },
  { value: 'installment', label: 'Installment',   Icon: CalendarClock },
  { value: 'transfer',    label: 'Bank transfer', Icon: QrCode },
] as const;

interface Props {
  filters: AuditLogFilters;
  onChange: (next: AuditLogFilters) => void;
  onReset: () => void;
  search: string;
  onSearchChange: (q: string) => void;
  matchCount: number;
  totalCount: number;
}

export function AuditLogFilterBar({
  filters, onChange, onReset, search, onSearchChange, matchCount, totalCount,
}: Props) {
  const staff = useStaff();
  const salespeople = useMemo(
    () => (staff.data ?? []).filter((s) => s.role === 'sales' && s.active),
    [staff.data],
  );

  const methods = filters.paymentMethods ?? [];
  const toggleMethod = (m: string) => {
    const next = methods.includes(m) ? methods.filter((x) => x !== m) : [...methods, m];
    onChange({ ...filters, paymentMethods: next.length ? next : undefined });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.grid}>
        <div className={styles.block}>
          <span className={styles.legend}>Period</span>
          <div className={styles.periodRow}>
            <label className={styles.field}>
              <span className={styles.subLabel}>From</span>
              <input type="date" className={styles.input} value={filters.from ?? ''}
                onChange={(e) => onChange({ ...filters, from: e.target.value || undefined })} />
            </label>
            <span className={styles.arrow} aria-hidden="true">→</span>
            <label className={styles.field}>
              <span className={styles.subLabel}>To</span>
              <input type="date" className={styles.input} value={filters.to ?? ''}
                onChange={(e) => onChange({ ...filters, to: e.target.value || undefined })} />
            </label>
          </div>
        </div>

        <div className={styles.block}>
          <span className={styles.legend}>Payment method</span>
          <div className={styles.methodChips}>
            {METHODS.map(({ value, label, Icon }) => (
              <button key={value} type="button"
                className={`${styles.methodChip} ${methods.includes(value) ? styles.methodChipActive : ''}`}
                aria-pressed={methods.includes(value)}
                onClick={() => toggleMethod(value)}>
                <Icon size={16} strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.block}>
          <span className={styles.legend}>Salesperson <em className={styles.hint}>(who made the sale)</em></span>
          <select className={styles.input}
            value={filters.salespersonIds?.[0] ?? ''}
            onChange={(e) => onChange({ ...filters, salespersonIds: e.target.value ? [e.target.value] : undefined })}>
            <option value="">All salespeople</option>
            {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className={styles.block}>
          <span className={styles.legend}>Amount (RM)</span>
          <div className={styles.amountRow}>
            <input type="number" min={0} placeholder="min" className={styles.input}
              value={filters.amountMin ?? ''}
              onChange={(e) => onChange({ ...filters, amountMin: e.target.value ? Number(e.target.value) : undefined })} />
            <span className={styles.dash} aria-hidden="true">–</span>
            <input type="number" min={0} placeholder="max" className={styles.input}
              value={filters.amountMax ?? ''}
              onChange={(e) => onChange({ ...filters, amountMax: e.target.value ? Number(e.target.value) : undefined })} />
          </div>
        </div>

        <div className={`${styles.block} ${styles.searchBlock}`}>
          <span className={styles.legend}>Search</span>
          <div className={styles.searchWrap}>
            <Search size={18} strokeWidth={1.75} className={styles.searchIcon} />
            <input type="search" className={styles.searchInput} placeholder="SO#, customer, bank ref…"
              value={search} onChange={(e) => onSearchChange(e.target.value)} />
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.matchCount}>
          <strong>{matchCount}</strong> of {totalCount} payments match
        </span>
        <button type="button" className={styles.reset} onClick={onReset}>Reset filters</button>
      </div>
    </div>
  );
}
```

> Verify the `useStaff` import path: it is `../lib/admin-queries` (same as the old bar). If your tree exposes it elsewhere, match the old file's import.

- [ ] **Step 2: Rewrite the styles**

Replace the entire contents of `AuditLogFilterBar.module.css`:

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  background: var(--bg);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-1);
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-5);
}
.block { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.searchBlock { grid-column: 1 / -1; }
.legend {
  font-family: var(--font-button);
  font-size: var(--fs-12);
  font-weight: var(--w-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-muted);
}
.hint { font-style: normal; text-transform: none; color: var(--fg-soft); font-weight: var(--w-regular); }
.subLabel { font-size: var(--fs-12); color: var(--fg-soft); }
.field { display: flex; flex-direction: column; gap: 4px; }
.periodRow, .amountRow { display: flex; align-items: flex-end; gap: var(--space-3); }
.arrow, .dash { color: var(--fg-soft); padding-bottom: 8px; }
.input {
  padding: 10px 12px;
  font: inherit;
  color: var(--c-ink);
  background: var(--bg-alt);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-sm);
}
.input:focus { outline: 2px solid var(--c-orange); outline-offset: 1px; }
.methodChips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.methodChip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: 1px solid var(--c-line);
  border-radius: var(--radius-pill);
  background: var(--bg-alt);
  color: var(--c-ink);
  font: inherit;
  font-weight: var(--w-medium);
  cursor: pointer;
  transition: background var(--duration-fast), border-color var(--duration-fast);
}
.methodChip:hover { border-color: var(--line-strong); }
.methodChipActive {
  background: var(--c-burnt);
  border-color: var(--c-burnt);
  color: var(--c-cream);
}
.searchWrap { position: relative; display: flex; align-items: center; }
.searchIcon { position: absolute; left: 14px; color: var(--fg-soft); pointer-events: none; }
.searchInput {
  width: 100%;
  padding: 12px 14px 12px 42px;
  font: inherit;
  color: var(--c-ink);
  background: var(--bg-alt);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-pill);
}
.searchInput:focus { outline: 2px solid var(--c-orange); outline-offset: 1px; }
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--c-line);
  padding-top: var(--space-4);
}
.matchCount { color: var(--fg-muted); font-size: var(--fs-14); }
.matchCount strong { color: var(--c-burnt); }
.reset {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 18px;
  background: var(--bg);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-pill);
  color: var(--fg-muted);
  cursor: pointer;
  font-family: var(--font-button);
  font-weight: var(--w-semibold);
}
.reset:hover { color: var(--c-ink); border-color: var(--line-strong); }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: remaining errors only in `AuditLog.tsx` (rewritten next).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/components/AuditLogFilterBar.tsx apps/backend/src/components/AuditLogFilterBar.module.css
git commit -m "feat(backend): rebuild audit-log filter panel (chips, search, match count)"
```

---

### Task 11: Backend — rebuild the audit-log page

**Files:**
- Modify: `apps/backend/src/pages/AuditLog.tsx` (full rewrite)
- Modify: `apps/backend/src/pages/AuditLog.module.css` (full rewrite)

Page owns: hero card + Export menu, stat cards, quick-range chips + Hide/Show toggle, the (collapsible) filter panel, the table (checkboxes, badges, method, avatar, row→drawer), and the OrderDrawer.

- [ ] **Step 1: Rewrite the page component**

Replace the entire contents of `AuditLog.tsx`:

```tsx
import { useMemo, useState } from 'react';
import {
  Receipt, Download, FileSpreadsheet, ChevronsDown, ChevronsUp,
  ChevronRight, CreditCard, CalendarClock, QrCode,
} from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import {
  useAuditLog, useAuditLogRealtime,
  type AuditLogFilters, type AuditLogRow,
} from '../lib/audit-log-queries';
import {
  rangeForPreset, presetForRange, amountBadge, matchesSearch,
  methodLabel, methodDetail, initials, type QuickRange,
} from '../lib/audit-log-view';
import { useShowrooms, useStaff } from '../lib/admin-queries';
import { AuditLogFilterBar } from '../components/AuditLogFilterBar';
import { OrderDrawer } from '../components/OrderDrawer';
import {
  exportCsv, exportXlsx, downloadBlob, type AuditExportRow,
} from '../lib/audit-export';
import styles from './AuditLog.module.css';

const defaultFilters = (): AuditLogFilters => ({ ...rangeForPreset('last30') });

const QUICK_RANGES: { key: QuickRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last90', label: 'Last 90 days' },
];

const RANGE_SUBTITLE: Record<QuickRange, string> = {
  today: 'today', yesterday: 'yesterday',
  last7: 'last 7 days', last30: 'last 30 days', last90: 'last 90 days',
};

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
};
const fmtClock = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const METHOD_ICON: Record<string, typeof CreditCard> = {
  credit: CreditCard, debit: CreditCard, installment: CalendarClock, transfer: QrCode,
};
const METHOD_TILE: Record<string, string> = {
  credit: styles.tileCredit, debit: styles.tileDebit,
  installment: styles.tileInstallment, transfer: styles.tileTransfer,
};

export const AuditLog = () => {
  const [filters, setFilters] = useState<AuditLogFilters>(defaultFilters);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null);

  const query = useAuditLog(filters);
  useAuditLogRealtime();
  const showrooms = useShowrooms();
  const staff = useStaff();

  const showroomName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of showrooms.data ?? []) m.set(s.id, s.name);
    return (id: string) => m.get(id) ?? '—';
  }, [showrooms.data]);
  const staffName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staff.data ?? []) m.set(s.id, s.name);
    return (id: string | null) => (id ? m.get(id) ?? '—' : '—');
  }, [staff.data]);

  const serverRows = query.data?.rows ?? [];
  const rows = useMemo(
    () => serverRows.filter((r) => matchesSearch(r, search)),
    [serverRows, search],
  );

  const totalPaid = useMemo(() => rows.reduce((s, r) => s + r.paid, 0), [rows]);
  const activePreset = presetForRange(filters.from, filters.to);
  const rangeSubtitle = activePreset ? RANGE_SUBTITLE[activePreset] : 'custom range';

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const setPreset = (key: QuickRange) => setFilters({ ...filters, ...rangeForPreset(key) });

  const toExportRows = (input: AuditLogRow[]): AuditExportRow[] =>
    input.map((r) => ({
      id: r.id, placedAt: r.placedAt, showroomName: showroomName(r.showroomId),
      customerName: r.customerName, total: r.total, paid: r.paid,
      paymentMethod: r.paymentMethod, installmentMonths: r.installmentMonths,
      approvalCode: r.approvalCode, salespersonName: staffName(r.salespersonId),
      keyedByName: staffName(r.staffId), slipUploaded: r.slipUploaded,
    }));

  const rowsToExport = () =>
    selected.size > 0 ? rows.filter((r) => selected.has(r.id)) : rows;
  const today = new Date().toISOString().slice(0, 10);

  const onExportXlsx = async () => {
    setExportOpen(false);
    const bytes = await exportXlsx(toExportRows(rowsToExport()));
    downloadBlob(bytes, `2990s-audit-log-${today}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  const onExportCsv = () => {
    setExportOpen(false);
    downloadBlob(exportCsv(toExportRows(rowsToExport())),
      `2990s-audit-log-${today}.csv`, 'text/csv;charset=utf-8');
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.heroIcon}><Receipt size={24} strokeWidth={1.75} /></span>
        <div className={styles.heroText}>
          <h2 className={styles.heroTitle}>Payment audit log</h2>
          <p className={styles.heroLede}>
            Every recorded payment, with full audit trail. Filter, search, and export
            to .xlsx or .csv for bank-statement reconciliation.
          </p>
        </div>
        <div className={styles.exportWrap}>
          <button type="button" className={styles.exportBtn} disabled={rows.length === 0}
            onClick={() => setExportOpen((v) => !v)}>
            <Download size={18} strokeWidth={1.75} /> Export &amp; tools
            <ChevronsDown size={16} strokeWidth={1.75} />
          </button>
          {exportOpen && (
            <div className={styles.exportMenu} role="menu">
              <button type="button" role="menuitem" onClick={() => void onExportXlsx()}>
                <FileSpreadsheet size={16} strokeWidth={1.75} /> Export .xlsx
              </button>
              <button type="button" role="menuitem" onClick={onExportCsv}>
                <Download size={16} strokeWidth={1.75} /> Export .csv
              </button>
              <span className={styles.exportHint}>
                {selected.size > 0 ? `${selected.size} selected` : `all ${rows.length} shown`}
              </span>
            </div>
          )}
        </div>
      </section>

      <div className={styles.stats}>
        <div className={`${styles.statCard} ${styles.statTotal}`}>
          <span className={styles.statLabel}>Total recorded</span>
          <span className={styles.statValue}><sup>RM</sup>{totalPaid.toLocaleString('en-MY')}</span>
          <span className={styles.statSub}>{rangeSubtitle}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statHash}>#</span>
          <span className={styles.statCount}>{rows.length}</span>
          <span className={styles.statLabel}>Payments</span>
        </div>
      </div>

      <div className={styles.quickRow}>
        <span className={styles.quickLabel}>Quick range</span>
        <div className={styles.quickChips}>
          {QUICK_RANGES.map(({ key, label }) => (
            <button key={key} type="button"
              className={`${styles.quickChip} ${activePreset === key ? styles.quickChipActive : ''}`}
              onClick={() => setPreset(key)}>{label}</button>
          ))}
        </div>
        <button type="button" className={styles.toggleBtn} onClick={() => setFiltersOpen((v) => !v)}>
          {filtersOpen
            ? <><ChevronsUp size={18} strokeWidth={1.75} /> Hide filters</>
            : <><ChevronsDown size={18} strokeWidth={1.75} /> Show filters</>}
        </button>
      </div>

      {filtersOpen && (
        <AuditLogFilterBar
          filters={filters}
          onChange={setFilters}
          onReset={() => { setFilters(defaultFilters()); setSearch(''); }}
          search={search}
          onSearchChange={setSearch}
          matchCount={rows.length}
          totalCount={serverRows.length}
        />
      )}

      <div className={styles.tableWrap}>
        {query.isLoading && <div className={styles.empty}>Loading…</div>}
        {query.error && <div className={styles.empty}>Failed to load: {String(query.error)}</div>}
        {!query.isLoading && !query.error && rows.length === 0 && (
          <div className={styles.empty}>
            No payments match these filters. Try widening the date range, clearing a
            filter, or changing your search.
          </div>
        )}
        {!query.isLoading && !query.error && rows.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.checkCol}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    aria-label="Select all" />
                </th>
                <th>Date / time</th>
                <th>SO#</th>
                <th>Customer</th>
                <th className={styles.numCol}>Amount</th>
                <th>Method · details</th>
                <th>Salesperson</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const badge = amountBadge(r.paid, r.total);
                const Icon = METHOD_ICON[r.paymentMethod] ?? CreditCard;
                const detail = methodDetail(r);
                return (
                  <tr key={r.id} className={selected.has(r.id) ? styles.rowSelected : ''}>
                    <td className={styles.checkCol}>
                      <input type="checkbox" checked={selected.has(r.id)}
                        onChange={() => toggleOne(r.id)} aria-label={`Select ${r.id}`} />
                    </td>
                    <td><div className={styles.day}>{fmtDay(r.placedAt)}</div>
                        <div className={styles.clock}>{fmtClock(r.placedAt)}</div></td>
                    <td><span className={styles.soPill}>{r.id}</span></td>
                    <td><div className={styles.custName}>{r.customerName}</div>
                        {r.customerPhone && <div className={styles.custPhone}>{r.customerPhone}</div>}</td>
                    <td className={styles.numCol}>
                      <div className={styles.amount}><sup>RM</sup>{fmtRM(r.paid).replace(/^RM\s?/, '')}</div>
                      {badge.kind === 'full'
                        ? <span className={`${styles.badge} ${styles.badgeFull}`}>Full payment</span>
                        : <span className={`${styles.badge} ${styles.badgeDeposit}`}>
                            Deposit · {badge.pct}% of {badge.total.toLocaleString('en-MY')}
                          </span>}
                    </td>
                    <td>
                      <div className={styles.method}>
                        <span className={`${styles.tile} ${METHOD_TILE[r.paymentMethod] ?? ''}`}>
                          <Icon size={18} strokeWidth={1.75} />
                        </span>
                        <span>
                          <strong className={styles.methodName}>{methodLabel(r.paymentMethod)}</strong>
                          {detail && <span className={styles.methodDetail}>{detail}</span>}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={styles.sp}>
                        <span className={styles.avatar}>{initials(staffName(r.salespersonId))}</span>
                        {staffName(r.salespersonId)}
                      </span>
                    </td>
                    <td>
                      <button type="button" className={styles.openBtn}
                        onClick={() => setDrawerOrderId(r.id)} aria-label={`Open ${r.id}`}>
                        <ChevronRight size={18} strokeWidth={1.75} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <OrderDrawer orderId={drawerOrderId} onClose={() => setDrawerOrderId(null)} />
    </div>
  );
};
```

> `fmtRM` returns e.g. `"RM 6,819"`; the table renders its own `RM` superscript, so we strip the prefix with `.replace(/^RM\s?/, '')`. If `fmtRM` in `@2990s/shared` has a different format, adjust the strip or use `r.paid.toLocaleString('en-MY')` directly.

- [ ] **Step 2: Rewrite the styles**

Replace the entire contents of `AuditLog.module.css`:

```css
.page {
  display: flex; flex-direction: column; gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
  max-width: 1400px; margin: 0 auto;
}

/* Hero */
.hero {
  display: flex; align-items: flex-start; gap: var(--space-4);
  padding: var(--space-5);
  background: linear-gradient(120deg, rgba(166,71,30,0.06), var(--bg));
  border: 1px solid var(--c-line); border-radius: var(--radius-md);
}
.heroIcon {
  display: grid; place-items: center; width: 56px; height: 56px;
  background: var(--c-orange); color: var(--c-cream); border-radius: var(--radius-md);
  flex: none;
}
.heroText { flex: 1; }
.heroTitle { font-family: var(--font-title); font-weight: var(--w-bold); font-size: var(--fs-24); margin: 0 0 4px; color: var(--c-ink); }
.heroLede { margin: 0; max-width: 640px; color: var(--fg-muted); }
.exportWrap { position: relative; flex: none; }
.exportBtn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 12px 20px; background: var(--c-orange); color: var(--c-cream);
  border: none; border-radius: var(--radius-pill); cursor: pointer;
  font-family: var(--font-button); font-weight: var(--w-semibold);
}
.exportBtn:disabled { opacity: 0.5; cursor: not-allowed; }
.exportMenu {
  position: absolute; right: 0; top: calc(100% + 8px); z-index: 10;
  display: flex; flex-direction: column; min-width: 200px;
  background: var(--bg); border: 1px solid var(--c-line);
  border-radius: var(--radius-sm); box-shadow: var(--shadow-3); overflow: hidden;
}
.exportMenu button {
  display: flex; align-items: center; gap: 8px; padding: 12px 16px;
  background: none; border: none; cursor: pointer; font: inherit; color: var(--c-ink); text-align: left;
}
.exportMenu button:hover { background: var(--bg-alt); }
.exportHint { padding: 8px 16px; font-size: var(--fs-12); color: var(--fg-soft); border-top: 1px solid var(--c-line); }

/* Stat cards */
.stats { display: grid; grid-template-columns: 2fr 1fr; gap: var(--space-4); }
.statCard {
  display: flex; flex-direction: column; gap: 4px;
  padding: var(--space-5); border: 1px solid var(--c-line); border-radius: var(--radius-md); background: var(--bg);
}
.statTotal { background: linear-gradient(120deg, rgba(166,71,30,0.07), var(--bg)); }
.statLabel { font-family: var(--font-button); font-size: var(--fs-12); font-weight: var(--w-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--fg-muted); }
.statValue { font-family: var(--font-title); font-weight: var(--w-bold); font-size: var(--fs-40); color: var(--c-burnt); line-height: 1.1; }
.statValue sup { font-size: var(--fs-18); margin-right: 4px; }
.statSub { color: var(--fg-soft); font-size: var(--fs-14); }
.statHash { display: grid; place-items: center; width: 40px; height: 40px; background: var(--bg-warm); color: var(--c-burnt); border-radius: var(--radius-sm); font-weight: var(--w-bold); }
.statCount { font-family: var(--font-title); font-weight: var(--w-bold); font-size: var(--fs-32); color: var(--c-ink); }

/* Quick range row */
.quickRow { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
.quickLabel { font-family: var(--font-button); font-size: var(--fs-12); font-weight: var(--w-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--fg-muted); }
.quickChips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.quickChip {
  padding: 10px 18px; border: 1px solid var(--c-line); border-radius: var(--radius-pill);
  background: var(--bg); color: var(--c-ink); font: inherit; font-weight: var(--w-medium); cursor: pointer;
}
.quickChip:hover { border-color: var(--line-strong); }
.quickChipActive { background: var(--c-burnt); border-color: var(--c-burnt); color: var(--c-cream); }
.toggleBtn {
  display: inline-flex; align-items: center; gap: 8px; margin-left: auto;
  padding: 10px 18px; background: var(--bg); border: 1px solid var(--c-line);
  border-radius: var(--radius-pill); color: var(--c-ink); font-family: var(--font-button);
  font-weight: var(--w-semibold); cursor: pointer;
}
.toggleBtn:hover { border-color: var(--line-strong); }

/* Table */
.tableWrap { border: 1px solid var(--c-line); border-radius: var(--radius-md); overflow: hidden; background: var(--bg); }
.empty { padding: var(--space-7) var(--space-5); text-align: center; color: var(--fg-muted); }
.table { width: 100%; border-collapse: collapse; font-size: var(--fs-14); }
.table thead th {
  text-align: left; padding: 14px 16px; background: var(--bg-warm);
  border-bottom: 1px solid var(--c-line); font-family: var(--font-button);
  font-size: var(--fs-12); font-weight: var(--w-semibold); text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--fg-muted); white-space: nowrap;
}
.table tbody td { padding: 14px 16px; border-bottom: 1px solid var(--c-line); color: var(--c-ink); vertical-align: middle; }
.table tbody tr:last-child td { border-bottom: none; }
.table tbody tr:hover { background: var(--bg-alt); }
.rowSelected { background: rgba(166,71,30,0.05); }
.checkCol { width: 44px; text-align: center; }
.numCol { text-align: right; }

.day { font-weight: var(--w-semibold); }
.clock { color: var(--fg-soft); font-size: var(--fs-13); }
.soPill {
  display: inline-block; padding: 4px 12px; border: 1px solid rgba(166,71,30,0.3);
  border-radius: var(--radius-pill); color: var(--c-burnt); font-weight: var(--w-semibold);
  font-variant-numeric: tabular-nums; background: rgba(166,71,30,0.04);
}
.custName { font-weight: var(--w-semibold); }
.custPhone { color: var(--fg-soft); font-size: var(--fs-13); }
.amount { font-weight: var(--w-bold); font-size: var(--fs-18); font-variant-numeric: tabular-nums; }
.amount sup { font-size: var(--fs-12); color: var(--fg-muted); margin-right: 2px; }
.badge { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: var(--radius-pill); font-size: var(--fs-12); font-weight: var(--w-semibold); }
.badgeFull { background: var(--c-success-bg); color: var(--c-success); }
.badgeDeposit { background: var(--c-warn-bg); color: var(--c-warn); }

.method { display: flex; align-items: center; gap: var(--space-3); }
.tile { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--radius-sm); color: var(--c-cream); flex: none; }
.tileCredit { background: var(--c-orange); }
.tileDebit { background: var(--c-secondary-a); }
.tileInstallment { background: var(--c-secondary-b); }
.tileTransfer { background: var(--c-burnt); }
.methodName { display: block; }
.methodDetail { display: block; color: var(--fg-soft); font-size: var(--fs-13); }

.sp { display: inline-flex; align-items: center; gap: var(--space-2); }
.avatar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-pill); background: var(--bg-warm); color: var(--c-burnt); font-size: var(--fs-12); font-weight: var(--w-bold); flex: none; }
.openBtn { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--radius-pill); border: 1px solid var(--c-line); background: var(--bg); color: var(--c-ink); cursor: pointer; }
.openBtn:hover { background: var(--c-burnt); border-color: var(--c-burnt); color: var(--c-cream); }

@media (max-width: 900px) { .stats { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Typecheck + build the backend**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: PASS (no remaining references to removed filter fields).

Run: `pnpm --filter @2990s/backend build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/pages/AuditLog.tsx apps/backend/src/pages/AuditLog.module.css
git commit -m "feat(backend): redesign Payment audit log page (hero, stats, chips, table)"
```

---

### Task 12: End-to-end verification

**Files:**
- Create: `apps/backend/e2e/audit-log-redesign.spec.ts` (align to the existing Playwright config + login helper used by other `*.spec.ts` in the repo)

- [ ] **Step 1: Confirm the e2e harness location + login helper**

Run: `pnpm -w exec playwright test --list` (or inspect existing `*.spec.ts` for the login helper import).
Expected: lists existing specs; note the coordinator-login helper + `baseURL`.

- [ ] **Step 2: Write the E2E spec**

Create `apps/backend/e2e/audit-log-redesign.spec.ts` (adapt `loginAsCoordinator` / `gotoApp` to the repo's existing helpers seen in step 1):

```ts
import { test, expect } from '@playwright/test';
// import { loginAsCoordinator } from './helpers';  // ← use the repo's existing helper

test.describe('Payment audit log redesign', () => {
  test('toggles filters, searches, selects, and exports', async ({ page }) => {
    // await loginAsCoordinator(page);
    await page.goto('/audit-log');

    // Hide/Show filters
    await expect(page.getByRole('button', { name: /Hide filters/i })).toBeVisible();
    await page.getByRole('button', { name: /Hide filters/i }).click();
    await expect(page.getByRole('button', { name: /Show filters/i })).toBeVisible();
    await page.getByRole('button', { name: /Show filters/i }).click();

    // Search narrows the match count
    await page.getByPlaceholder('SO#, customer, bank ref…').fill('SO-2057');
    await expect(page.getByText(/payments match/i)).toContainText('1 of');

    // Export menu opens
    await page.getByRole('button', { name: /Export & tools/i }).click();
    await expect(page.getByRole('menuitem', { name: /Export .xlsx/i })).toBeVisible();
  });
});
```

> If the repo runs E2E only in CI or against a seeded DB, gate this behind the same fixture the other specs use. The assertions reference the data-visible behaviours added in Tasks 10/11.

- [ ] **Step 3: Run the full test + typecheck gate across touched packages**

Run:
```bash
pnpm --filter @2990s/shared test
pnpm --filter @2990s/api test
pnpm --filter @2990s/pos test
pnpm --filter @2990s/backend test
pnpm typecheck
```
Expected: all PASS.

- [ ] **Step 4: Manual smoke (real apps)**

- POS: place an installment order → pick **12 months** → confirm it submits (201).
- Backend `/audit-log`: that order shows `Installment` + `12 months`, a deposit/full badge, customer phone, the SO# pill, and the row arrow opens the OrderDrawer. Toggle Hide/Show filters. Select 2 rows → Export .xlsx → file downloads with `Paid (RM)` + `Installment (months)` columns.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/e2e/audit-log-redesign.spec.ts
git commit -m "test(backend): e2e for audit-log redesign + installment flow"
```

---

## Self-Review

**Spec coverage:**
- Hero card + Export & tools dropdown → Task 11. ✓
- Stat cards (sum of paid, count) → Task 11. ✓
- Quick-range chips + Hide/Show toggle → Tasks 6 (logic) + 11 (UI). ✓
- Filter panel (Period, method chips, salesperson, amount, search, match count) → Task 10. ✓
- Dropped filters (Keyed by, Showroom, Slip) → Task 5 trims `AuditLogFilters`; Task 10 omits them. ✓
- Table (checkboxes, two-line date, SO# pill, customer+phone, amount+badge, method+icon+installment detail, salesperson avatar, row→OrderDrawer) → Task 11. ✓
- Installment term capture (POS 6/12, schema, RPC, API POST, API GET) → Tasks 1,2,3,4,8,9. ✓
- Export selected-or-all + new columns → Tasks 7 + 11. ✓
- Hero copy rewrite → Task 11 (no verify/flag/sign-off). ✓
- Pricing recompute untouched → Task 3 (Step 3 note; no change near `computeOrderTotal`). ✓
- Default filters expanded → Task 11 (`filtersOpen = true`). ✓

**Placeholder scan:** No "TBD"/"implement later". Two guidance notes (fmtRM strip, e2e login helper) point at real, named anti-fragilities, not missing content. Migration apply + e2e helper are explicit steps.

**Type consistency:** `AuditLogRow` (Task 5) gains `customerPhone/paid/installmentMonths`; consumed identically in audit-log-view (6), AuditLog page (11), export mapping (11). `AuditExportRow` (7) adds `paid/installmentMonths`; `toExportRows` (11) supplies them. `AuditLogFilters` (5) = `{from,to,salespersonIds,paymentMethods,amountMin,amountMax}`; FilterBar (10) + page (11) use exactly these. `installmentMonths` literal type `6|12|null` consistent across HandoverForm (8), OrderSubmitInput (9), order-v1 schema (2). RPC key `installmentMonths` matches `dto.installmentMonths` (3) and SQL `p->>'installmentMonths'` (1). ✓

**Scope:** Single cohesive feature, ordered data→UI; one PR. No split needed (UI depends on the captured term).
