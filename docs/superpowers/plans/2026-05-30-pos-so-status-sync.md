# POS ↔ Sales Order Status Sync (unify on `mfg_sales_orders`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Backend **Sales Order** (`mfg_sales_orders`) the single system of record for a POS order, retire the legacy 6-lane backend Orders board, and wire the POS 3-status board (Order Placed / Proceed / Delivered) to the Sales Order lifecycle.

**Architecture:** The POS already creates a Sales Order on checkout via `usePosHandoffToSo` → `POST /mfg-sales-orders` (today gated OFF by `VITE_HANDOVER_MODE`). We flip that to the default flow, re-point the POS "My orders" board to read `mfg_sales_orders`, route the "Proceed" action through `PATCH /mfg-sales-orders/:docNo/status` (which stamps a new `proceeded_at` column), and add a server-side hook so creating a Delivery Order that fully covers a Sales Order flips that SO to `DELIVERED` — which the POS board reflects live via a Supabase realtime subscription. The legacy `orders` table/board is removed for POS; Dashboard + Customers migrate to SO data.

**Tech Stack:** Vite + React 19 + React Router 7 + TanStack Query + Zustand (apps/pos, apps/backend); Hono on Cloudflare Workers (apps/api); Drizzle + Supabase Postgres (packages/db); Supabase Realtime.

---

## Status-model mapping (the contract)

POS 3 columns ⇄ `mfg_so_status` (enum: CONFIRMED, IN_PRODUCTION, READY_TO_SHIP, SHIPPED, DELIVERED, INVOICED, CLOSED, ON_HOLD, CANCELLED):

| POS column | id | matches `mfg_so_status` | trigger |
|---|---|---|---|
| **Order Placed** | `place` | `CONFIRMED` | POS checkout → `POST /mfg-sales-orders` (status defaults CONFIRMED) |
| **Proceed** | `proceed` | `IN_PRODUCTION`, `READY_TO_SHIP`, `SHIPPED` | POS "Move to Proceed" → `PATCH /:docNo/status` → IN_PRODUCTION (+ stamp `proceeded_at`) |
| **Delivered** | `delivered` | `DELIVERED`, `INVOICED`, `CLOSED` | DO created that fully covers the SO → SO auto → DELIVERED |
| _(hidden)_ | — | `ON_HOLD`, `CANCELLED` | excluded from the board (mirrors today's `cancelled` exclusion) |

---

## Decisions & assumptions (confirm before/early in execution)

1. **System of record = `mfg_sales_orders`** (Loo chose "统一到 Sales Order", 2026-05-30).
2. **Process Date = a NEW `proceeded_at timestamptz` column**, auto-stamped server-side on the first transition to `IN_PRODUCTION`. We do NOT reuse `internal_expected_dd` (that's the future production-ready date that drives MRP — overwriting it corrupts scheduling) and we do NOT reuse the dead `processing_date` column (its name collides with the UI's "Processing Date" = `internal_expected_dd`). Displayed in SO Detail as **"Proceed Date"**.
3. **"Upload a DO" = "create a Delivery Order".** The mfg DO module has no file-upload/confirm step — a DO is born `DISPATCHED` on creation. So sync #3 triggers on DO creation (both `POST /` and `POST /from-sos`) and on `PATCH /:id/status → DELIVERED`.
4. **Partial-delivery guard:** an SO flips to `DELIVERED` only when EVERY non-cancelled SO line is fully covered by DOs (`soDeliverableRemaining` all ≤ 0). One DO covering part of a multi-line SO does NOT mark the whole order delivered. (Confirm: Loo may prefer "first DO = delivered" for the simple single-delivery case — default is the safe full-coverage check.)
5. **Default the handoff in CODE, not `.env`:** change the gate to `useMfgSoFlow = handoverMode !== 'retail'` so we never touch `.env` (red line) and the change is reversible.
6. **POS reads its own SOs via a new API endpoint** `GET /mfg-sales-orders/mine` (filtered by `salesperson_id` = caller), NOT direct Supabase — this sidesteps needing a new RLS policy (red line). ⚠️ RISK to verify at execution: confirm the api `supabaseAuth` client can read `mfg_sales_orders` for a POS-role JWT; if RLS blocks it, escalate (do NOT change RLS without Loo's explicit OK).
7. **Keep, don't delete:** `orders` table + `order_lane` enum, `lib/queries.ts` order hooks, `lib/lanes.ts`, `OrderDrawer.tsx` (AuditLog uses it). Only the board UI + its nav are removed.

---

## File structure

**Create**
- `packages/db/migrations/01XX_so_proceeded_at.sql` — add `proceeded_at timestamptz` to `mfg_sales_orders`.
- `apps/api/src/lib/so-delivery-sync.ts` — `syncSoDeliveredFromDo(sb, soDocNos, actorId)` helper (full-coverage check → flip SO to DELIVERED + audit).
- `apps/api/src/routes/mfg-sales-orders.mine.test.ts` and `apps/api/src/routes/delivery-orders-mfg.so-sync.test.ts` — API tests.

**Modify (core logic)**
- `packages/db/src/schema.ts:1146` area — add `proceededAt` column to `mfgSalesOrders`.
- `apps/api/src/routes/mfg-sales-orders.ts` — (a) status PATCH (~1031) stamps `proceeded_at` on IN_PRODUCTION; (b) add `GET /mine`; (c) add `proceeded_at` to the detail HEADER select.
- `apps/api/src/routes/delivery-orders-mfg.ts` — call `syncSoDeliveredFromDo` after DO create (`:442`, `:685`) and in status PATCH DELIVERED branch (`:927`).
- `apps/pos/src/pages/OrderStatus.tsx` — `useMyOrders` reads `/mine`; status→column map; `onProceed` → API; add realtime subscription.
- `apps/pos/src/pages/Handover.tsx:103` — flip default to mfg-so.
- `apps/backend/src/pages/SalesOrderDetail.tsx` — show "Proceed Date" (read-only) in the inline Order-Info card.

**Modify (delete legacy board + migrate consumers)** — Phase C
- Delete: `apps/backend/src/pages/Orders.tsx`, `components/OrdersBoard.tsx` (+`.module.css`), `components/OrderCard.tsx`, `components/PoScanModal.tsx`.
- Edit nav: `lib/nav-items.ts:18`, `components/Sidebar.tsx:104` (+orphan `Inbox` import), `components/Layout.tsx:24-28`, `router.tsx:44,141`.
- Migrate to SO data: `pages/Dashboard.tsx` (lane tiles + `/orders` deep-links), `pages/Customers.tsx` (lane pill + `/orders?orderId` link).

---

## Phase A — DB + API foundation (no UI-visible change)

### Task A1: Add `proceeded_at` column

**Files:**
- Modify: `packages/db/src/schema.ts` (in `mfgSalesOrders`, next to `processingDate` ~line 1146)
- Create: `packages/db/migrations/01XX_so_proceeded_at.sql`

- [ ] **Step 1: Add the Drizzle column** (schema.ts is source of truth)

```ts
  processingDate:    date('processing_date'),
  // POS "Proceed" stamp — auto-set server-side on first transition to
  // IN_PRODUCTION (see PATCH /mfg-sales-orders/:docNo/status). Distinct from
  // internal_expected_dd (future production-ready date) and the dead
  // processing_date column. Shown as "Proceed Date" on the SO detail page.
  proceededAt:       timestamp('proceeded_at', { withTimezone: true }),
```

- [ ] **Step 2: Determine next migration number**

Run: `ls packages/db/migrations | Sort-Object | Select-Object -Last 3`
Use the next integer (e.g. if last is `0108_*`, create `0109_so_proceeded_at.sql`). NOTE: local `feat/cost-sell-split` already uses `0109_mfg_sell_price`; pick a number that won't collide on merge — coordinate, use the next free on this branch's base.

- [ ] **Step 3: Write the migration**

```sql
-- 01XX_so_proceeded_at.sql
-- POS "Proceed" timestamp on the Sales Order. Auto-stamped when the SO first
-- moves to IN_PRODUCTION (the POS "Proceed" action). Additive + nullable —
-- safe, no backfill.
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS proceeded_at timestamptz;
```

- [ ] **Step 4: Apply + verify** — `pnpm --filter @2990s/db db:push` (or the repo's apply step); confirm column exists.
- [ ] **Step 5: Commit** — `feat(db): add mfg_sales_orders.proceeded_at for POS Proceed stamp`

### Task A2: Stamp `proceeded_at` on IN_PRODUCTION in the status PATCH

**Files:** Modify `apps/api/src/routes/mfg-sales-orders.ts` (handler at ~1022-1057)

- [ ] **Step 1: Write failing test** — `apps/api/src/routes/mfg-sales-orders.proceed.test.ts`

```ts
// PATCH /:docNo/status to IN_PRODUCTION sets proceeded_at (once); a later
// transition to IN_PRODUCTION does NOT overwrite the original stamp.
// (Mirror the supabase-mock pattern already used in orders.test.ts.)
```

- [ ] **Step 2: Implement** — in the status PATCH, build the update with a conditional stamp:

```ts
  const patch: Record<string, unknown> = { status: body.status, updated_at: new Date().toISOString() };
  // POS "Proceed" stamp — set once on the first move into IN_PRODUCTION.
  if (body.status === 'IN_PRODUCTION') {
    const { data: cur } = await sb.from('mfg_sales_orders').select('proceeded_at').eq('doc_no', docNo).maybeSingle();
    if (!(cur as { proceeded_at?: string } | null)?.proceeded_at) {
      patch.proceeded_at = new Date().toISOString();
    }
  }
  const { data, error } = await sb.from('mfg_sales_orders').update(patch).eq('doc_no', docNo).select('doc_no, status, proceeded_at').single();
```

(Audit rows — `mfg_so_status_changes` + `recordSoAudit` — already fire; leave them. The existing `notes`/`source` plumbing stays.)

- [ ] **Step 3: Run test → PASS.** Run: `pnpm --filter @2990s/api test mfg-sales-orders.proceed`
- [ ] **Step 4: Add `proceeded_at` to the detail GET HEADER select** so SO Detail can show it. Locate the `GET /:docNo` select string and append `, proceeded_at`.
- [ ] **Step 5: Commit** — `feat(api): stamp proceeded_at when SO enters IN_PRODUCTION`

### Task A3: Auto-flip SO → DELIVERED when a DO fully covers it

**Files:**
- Create: `apps/api/src/lib/so-delivery-sync.ts`
- Modify: `apps/api/src/routes/delivery-orders-mfg.ts` (after `:442`, after `:685`, in status PATCH `:927`)

- [ ] **Step 1: Write failing test** — `apps/api/src/routes/delivery-orders-mfg.so-sync.test.ts`: creating a DO that covers ALL remaining SO qty flips SO→DELIVERED; a partial DO leaves SO status unchanged.

- [ ] **Step 2: Implement the helper** (`so-delivery-sync.ts`):

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordSoAudit } from './so-audit';

const DELIVERED_FROM = ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED'];

/** Best-effort, idempotent. For each SO doc no, if every non-cancelled SO line
 *  is now fully covered by delivery_order_items (sum(do qty) >= so qty), and
 *  the SO is in a pre-delivery status, flip it to DELIVERED + audit. A DO
 *  failure must NEVER roll this back — wrap callers in try/catch. */
export async function syncSoDeliveredFromDo(
  sb: SupabaseClient,
  soDocNos: Array<string | null | undefined>,
  actorId?: string | null,
): Promise<void> {
  const docs = [...new Set(soDocNos.filter((d): d is string => !!d))];
  for (const docNo of docs) {
    try {
      const { data: so } = await sb.from('mfg_sales_orders').select('status').eq('doc_no', docNo).maybeSingle();
      const status = (so as { status?: string } | null)?.status;
      if (!status || !DELIVERED_FROM.includes(status)) continue; // already delivered/closed/cancelled

      const { data: soItems } = await sb.from('mfg_sales_order_items')
        .select('id, qty').eq('doc_no', docNo).eq('cancelled', false);
      const lines = (soItems ?? []) as Array<{ id: string; qty: number }>;
      if (lines.length === 0) continue;

      const ids = lines.map((l) => l.id);
      const { data: doItems } = await sb.from('delivery_order_items')
        .select('so_item_id, qty').in('so_item_id', ids);
      const deliveredByLine = new Map<string, number>();
      for (const di of (doItems ?? []) as Array<{ so_item_id: string | null; qty: number }>) {
        if (!di.so_item_id) continue;
        deliveredByLine.set(di.so_item_id, (deliveredByLine.get(di.so_item_id) ?? 0) + (di.qty ?? 0));
      }
      const fullyCovered = lines.every((l) => (deliveredByLine.get(l.id) ?? 0) >= l.qty);
      if (!fullyCovered) continue;

      await sb.from('mfg_sales_orders').update({ status: 'DELIVERED', updated_at: new Date().toISOString() }).eq('doc_no', docNo);
      await sb.from('mfg_so_status_changes').insert({ doc_no: docNo, from_status: status, to_status: 'DELIVERED', changed_by: actorId ?? null, notes: 'Auto: DO fully delivered' });
      await recordSoAudit(sb, {
        docNo, action: 'UPDATE_STATUS', actorId: actorId ?? null,
        fieldChanges: [{ field: 'status', from: status, to: 'DELIVERED' }],
        statusSnapshot: 'DELIVERED', source: 'automation', note: 'DO fully covers SO',
      });
    } catch { /* best-effort — never block the DO */ }
  }
}
```

- [ ] **Step 3: Wire it** in `delivery-orders-mfg.ts` (best-effort, after stock deduction):
  - After `await deductInventoryForDo(sb, h.id, user.id);` (POST `/`, ~:442): `await syncSoDeliveredFromDo(sb, [(body.soDocNo as string) ?? null], user.id);`
  - After `await deductInventoryForDo(sb, dh.id, user.id);` (POST `/from-sos`, ~:685): `await syncSoDeliveredFromDo(sb, [...docNos], user.id);`
  - In status PATCH, after the DELIVERED update (~:929): if `body.status === 'DELIVERED'`, look up the DO's `so_doc_no` and call the helper.
  - Add the import at top.

- [ ] **Step 4: Run test → PASS.** `pnpm --filter @2990s/api test delivery-orders-mfg.so-sync`
- [ ] **Step 5: Commit** — `feat(api): DO that fully covers an SO auto-marks it DELIVERED`

### Task A4: `GET /mfg-sales-orders/mine` for the POS board

**Files:** Modify `apps/api/src/routes/mfg-sales-orders.ts` (add route near the other GETs)

- [ ] **Step 1: Write failing test** — returns only SOs where `salesperson_id` = caller; newest first; excludes CANCELLED/ON_HOLD.
- [ ] **Step 2: Implement**

```ts
// POS "My orders" board — the salesperson's own SOs, lightweight columns for
// the 3-status board. Filtered by salesperson_id = caller so a POS tablet only
// sees its own orders without relying on an RLS SELECT policy.
mfgSalesOrders.get('/mine', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  const { data, error } = await sb.from('mfg_sales_orders')
    .select('doc_no, debtor_name, phone, status, so_date, proceeded_at, customer_delivery_date, total_revenue_centi, paid_centi, deposit_centi, created_at')
    .eq('salesperson_id', user.id)
    .not('status', 'in', '("CANCELLED","ON_HOLD")')
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ salesOrders: data ?? [] });
});
```

⚠️ Register `/mine` BEFORE any `/:docNo` route so it isn't captured as a docNo param.
- [ ] **Step 3: Run test → PASS.**
- [ ] **Step 4: Commit** — `feat(api): GET /mfg-sales-orders/mine for the POS status board`

**PHASE A GATE:** `pnpm --filter @2990s/api test` green; `pnpm typecheck` green. No UI change yet.

---

## Phase B — POS unifies onto the Sales Order

### Task B1: Default the handover to mfg-so

**Files:** Modify `apps/pos/src/pages/Handover.tsx:102-103`

- [ ] **Step 1:** Flip the gate (reversible, no `.env` touch):

```ts
  // Default to the Sales Order handoff (unified order system). Set
  // VITE_HANDOVER_MODE=retail to fall back to the legacy /orders receipt.
  const handoverMode = import.meta.env.VITE_HANDOVER_MODE as string | undefined;
  const useMfgSoFlow = handoverMode !== 'retail';
```

- [ ] **Step 2: Verify** — placing an order in POS lands on `/handover-confirmed/:docNo` and a row appears via `GET /mfg-sales-orders/mine`.
- [ ] **Step 3: Commit** — `feat(pos): default checkout to the Sales Order handoff`

### Task B2: Re-point the POS board to the Sales Order

**Files:** Modify `apps/pos/src/pages/OrderStatus.tsx` (`useMyOrders` 77-143; `Lane`/`MyOrderRow` types 40-75; `LANES` 364-389; grouping 407-422; `LANE_LABEL` 637-645; `OrderDetail` editable/onProceed 657/784-792; footer 1105-1109)

- [ ] **Step 1:** Replace `useMyOrders` to fetch `GET /mfg-sales-orders/mine` (token from `supabase.auth.getSession()`, mirror `pos-handover-so.ts:submitHandoff`). Map to a `MySoRow` (docNo, debtorName, phone, status, soDate, proceededAt, deliveryDate, total, paid). Keep `staleTime: 10_000`.
- [ ] **Step 2:** Replace the status model:

```ts
type SoStatus = 'CONFIRMED' | 'IN_PRODUCTION' | 'READY_TO_SHIP' | 'SHIPPED' | 'DELIVERED' | 'INVOICED' | 'CLOSED' | 'ON_HOLD' | 'CANCELLED';

const LANES = [
  { id: 'place',     num: '01', title: 'Order placed', sub: 'Just placed · may need detail tweaks', Icon: Inbox,        matches: ['CONFIRMED'] },
  { id: 'proceed',   num: '02', title: 'Proceed',      sub: 'In production · coordinator handling',  Icon: Send,         matches: ['IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED'] },
  { id: 'delivered', num: '03', title: 'Delivered',    sub: 'Closed · signed off',                   Icon: CheckCircle2, matches: ['DELIVERED', 'INVOICED', 'CLOSED'] },
] as const;
```

Grouping logic is unchanged (bucket by first lane whose `matches` includes the SO status).
- [ ] **Step 3:** `onProceed` → API instead of direct supabase:

```ts
  // "Move to Proceed" → SO IN_PRODUCTION (server stamps proceeded_at).
  const onProceed = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`${API_URL}/mfg-sales-orders/${encodeURIComponent(order.docNo)}/status`, {
      method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'IN_PRODUCTION', notes: 'Proceed from POS' }),
    });
    if (res.ok) { queryClient.invalidateQueries({ queryKey: ['my-orders'] }); onClose(); }
  };
```

`editable` = `order.status === 'CONFIRMED'`. The drawer's detail-edit (customer/address) for CONFIRMED SOs can PATCH `/:docNo` (header) — or keep read-only for MVP and only expose Proceed; confirm with Loo. Footer for non-editable: "Delivered · managed in backend" when DELIVERED, else "Locked · coordinator handling".
- [ ] **Step 4: Commit** — `feat(pos): My-orders board reads Sales Orders + Proceed via API`

### Task B3: Realtime so Delivered shows up automatically

**Files:** Modify `apps/pos/src/pages/OrderStatus.tsx` (add a hook mirroring `queries.ts:useCatalogRealtime`)

- [ ] **Step 1:** Add + call inside `OrderBoard`:

```ts
const useMyOrdersRealtime = () => {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('my-sales-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mfg_sales_orders' },
        () => { void qc.invalidateQueries({ queryKey: ['my-orders'] }); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc]);
};
```

⚠️ Verify `mfg_sales_orders` is in the `supabase_realtime` publication; if not, add it in the same migration as A1 (`ALTER PUBLICATION supabase_realtime ADD TABLE mfg_sales_orders;`). This is publication membership, NOT an RLS change.
- [ ] **Step 2: Verify** — backend creates a fully-covering DO → POS board moves the tile to "Delivered" within ~1s without refresh.
- [ ] **Step 3: Commit** — `feat(pos): realtime SO updates on the My-orders board`

### Task B4: Show "Proceed Date" on the SO Detail page

**Files:** Modify `apps/backend/src/pages/SalesOrderDetail.tsx` (inline Order-Info/Customer card, ~1610 where "Processing Date" lives)

- [ ] **Step 1:** Add a read-only "Proceed Date" row that renders `proceeded_at` (date part), placed near Processing/Delivery Date. Thread `proceeded_at` from the SO header fetch into the page's header type.
- [ ] **Step 2: Verify** — clicking Proceed in POS then opening the SO in backend shows the stamped date.
- [ ] **Step 3: Commit** — `feat(backend): show Proceed Date on Sales Order detail`

**PHASE B GATE (end-to-end demo, evidence required):** POS place → SO appears under "Order placed" + status CONFIRMED in backend list; POS Proceed → SO IN_PRODUCTION + Proceed Date stamped + visible in backend; backend create DO covering the SO → POS auto shows "Delivered". Capture screenshots/recording.

---

## Phase C — Retire the legacy board + migrate consumers

### Task C1: Delete the legacy Orders board UI + nav

**Files:** delete `pages/Orders.tsx`, `components/OrdersBoard.tsx`(+css), `components/OrderCard.tsx`, `components/PoScanModal.tsx`; edit `lib/nav-items.ts:18`, `components/Sidebar.tsx:104`(+orphan `Inbox`), `components/Layout.tsx:24-28`, `router.tsx:44,141`.

- [ ] **Step 1:** Remove the 4 files. **Step 2:** Remove the nav entries at the cited lines. **Step 3:** Re-grep to confirm zero remaining importers of the deleted files. **Step 4:** KEEP `orders` table, `lib/queries.ts` hooks, `lib/lanes.ts`, `OrderDrawer.tsx`.
- [ ] **Step 5: Verify** — `pnpm --filter @2990s/backend typecheck` + build green; AuditLog (which uses OrderDrawer) still renders.
- [ ] **Step 6: Commit** — `refactor(backend): remove legacy 6-lane Orders board + nav`

### Task C2: Migrate Dashboard + Customers off legacy `orders`

**Files:** Modify `apps/backend/src/pages/Dashboard.tsx` (lane tiles + `goToLane`/`goToBoard` → `/orders`), `apps/backend/src/pages/Customers.tsx` (lane pill + `Customers.tsx:292` `/orders?orderId` link).

- [ ] **Step 1:** Dashboard — replace the legacy-orders lane-count tiles with `mfg_sales_orders` status counts (Placed / Proceed / Delivered buckets per the mapping), and re-point tile clicks to `/mfg-sales-orders?status=...`. **Step 2:** Customers — replace the `orders.lane` pill + LTV with the SO equivalent, and re-point the per-order link to `/mfg-sales-orders/:docNo`.
- [ ] **Step 3: Verify** — Dashboard + Customers show SO-based data; no dead `/orders` links remain (`grep "/orders"` in apps/backend returns only intentional matches).
- [ ] **Step 4: Commit** — `refactor(backend): Dashboard + Customers read Sales Orders`

**PHASE C GATE:** backend build + typecheck green; no remaining route/link to `/orders`; AuditLog intact; Dashboard/Customers show SO data.

---

## Self-review notes
- **Spec coverage:** #1 Order Placed→SO = B1 (default handoff) + B2 (board reads SO). #2 Proceed→Process Date = A1+A2 (column+stamp) + B2 (Proceed→API) + B4 (display). #3 DO→Delivered = A3 (auto-flip) + B3 (realtime). Delete board = C1. Keep POS 3 statuses = B2 mapping. Migrate consumers = C2.
- **RLS / .env / migration red lines:** no `.env` edits (flag flipped in code, B1); no RLS policy changes (POS reads via `/mine`, assumption #6 — escalate if blocked); one additive migration (A1) — needs Loo's OK before apply.
- **Open confirm:** assumption #4 (full-coverage vs first-DO) and whether the POS drawer keeps customer-detail editing on CONFIRMED SOs (B2 Step 3).
