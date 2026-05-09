# Suppliers + PO Scanning Design Spec (Phase 4 sub-project D)

| | |
|---|---|
| **Date** | 2026-05-09 |
| **Author** | Claude (with Loo) — brainstormed via `superpowers:brainstorming` |
| **Branch** | `main` |
| **Phase** | Phase 4 sub-project D (continues after Driver+Dispatch+DO, 3630700) |
| **Status** | Design approved, awaiting `writing-plans` skill |
| **Estimated work** | 4-5 days for full implementation + acceptance test |

---

## 1. Goal & Scope

### 1.1 What we're building

The PO (Purchase Order) workflow that bridges sales orders in the `logistics` lane to actual stock procurement from suppliers. Coordinator scans across all logistics-lane orders, sees a supplier-grouped rollup, generates a PO per supplier, and gets a printable PO document to send manually via WhatsApp/email.

1. **Suppliers** — first-class table; 6 suppliers seeded (`SLP / KFA / OAK / AQS / KID / HMG`); products carry `supplier_id` FK
2. **PoScanModal** at lane=logistics — coordinator opens from lane header; sees rollup-by-supplier and detail-by-order tabs
3. **Purchase Orders** as first-class entity — `purchase_orders` (header) + `purchase_order_lines` (line items linking back to source `orders`); year-prefixed `PO-YYYY-XXXX` numbering
4. **Generate PO action** — clicking "Generate PO" on a supplier group: creates the PO record with all line items, marks all referenced orders as `po_issued`, opens the printable HTML view in a new tab
5. **Print + share** — coordinator presses Cmd+P → saves as PDF → opens `wa.me` link with pre-filled greeting → manually attaches PDF; system records the PO was generated, not the actual send
6. **Lane gate** — `logistics → ready` requires `po_issued = true`; `LaneStepper` blocks forward step when PO not issued
7. **Drawer logistics section** — replaces prototype's per-order "Issue PO" button with read-only PO status display (PO number + date if issued, "Awaiting PO scan" placeholder otherwise)

### 1.2 Out of scope (deferred)

- ❌ **Settings → Suppliers CRUD** — placeholder seed of 7 suppliers, contact info entered via Supabase Studio till settings page built (mirrors C's "Drivers CRUD deferral")
- ❌ **Server-side PDF generation** — print-to-PDF via browser (Variant A from brainstorm); no PDF lib in Worker
- ❌ **Server auto-send (email/WhatsApp API)** — coordinator sends manually via OS-native WhatsApp/email; no SendGrid/Resend/Twilio integration
- ❌ **Drawer's per-order "Issue PO" button** — dropped; modal is the only PO creation path
- ❌ **Stock arrival → automatic `ready` lane progression** — coordinator manually drags order forward once stock arrives at warehouse
- ❌ **Edit/un-issue PO** — append-only; once a PO is created, it stays. `purchase_orders` rows are immutable.
- ❌ **Cost tracking on PO lines** — no `unit_cost` column; 2990's is "honest pricing" retail, not procurement
- ❌ **Delivery deadline field on PO** — no `required_by` date; supplier and coordinator coordinate verbally
- ❌ **Multi-supplier "bulk-issue all" button** — coordinator clicks Generate PO once per supplier group; no single-click "issue all 7 POs"
- ❌ **Supplier address on PDF** — PO ships TO us (Showroom KL warehouse); supplier's own address rarely needed

### 1.3 Why now (after Sub-project C)

- Drawer + lane stepper + lane PATCH gate infrastructure exists from Sub-projects A, B, C — major reuse
- Sub-project C established the pattern: spec → plan → migrations (with red-line confirmation) → API → backend UI → seed test data
- Catalog is empty at MVP per `CLAUDE.md` PORT_DESIGN §10 Decision 10 — `products.supplier_id` lands as nullable, enforced by app layer when seeding new SKUs; no retroactive migration needed
- Acceptance test reuses Sub-project C's pattern (seed test order in `logistics`, walk through lane progression)
- ⚠️ **Feature ships dormant** — until catalog is seeded and orders flow through, `PoScanModal` will show "All POs already issued" empty state. Acceptance test must seed a product + supplier_id + test order to exercise the rollup logic.

---

## 2. Architecture

### 2.1 Layer diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  Backend (apps/backend)                                          │
│  ─ Orders.tsx (MODIFY) — adds "Scan PO" button in logistics lane │
│      header; mounts PoScanModal when active                      │
│  ─ PoScanModal.tsx (NEW) — rollup + detail tabs; calls API       │
│      ─ Roll-up by supplier (default tab)                         │
│      ─ Detail by order (drilldown)                               │
│      ─ "Generate PO" button per supplier group                   │
│      ─ Opens print view (window.open with /print URL)            │
│      ─ Renders wa.me + mailto: links if supplier has contact     │
│  ─ OrderDrawer.tsx (MODIFY) — logistics section becomes          │
│      read-only PO status display (PO# + date, or placeholder)    │
│  ─ LaneStepper.tsx (MODIFY) — block forward step in logistics    │
│      when !po_issued; tooltip "Issue PO via Scan first"          │
│  ─ lib/queries.ts (MODIFY) — add useSuppliers, usePurchaseOrders │
│  ─ lib/purchase-orders.ts (NEW) — client lib: createPO, openPrint│
└──────────────────────────────────────────────────────────────────┘
                            │            │
                ┌───────────┘            └────────────┐
                ▼                                     ▼
┌─────────────────────────────────┐  ┌────────────────────────────┐
│  API (apps/api on CF Workers)   │  │  Supabase Postgres         │
│  ─ routes/purchase-orders.ts    │  │  ─ suppliers (NEW)         │
│      POST  /purchase-orders     │  │  ─ purchase_orders (NEW)   │
│      GET   /purchase-orders/:id │  │  ─ purchase_order_lines(NEW)│
│      GET   /purchase-orders/:id/print → text/html                │
│  ─ routes/orders.ts (MODIFY)    │  │  ─ products + supplier_id  │
│      lane PATCH gate logistics→ │  │  ─ orders + 3 po_* cols    │
│      ready requires po_issued   │  │  ─ next_po_number() func   │
│  ─ lib/po.ts (NEW)              │  │  ─ po_sequences table      │
│      validators, builders,      │  │                            │
│      print template HTML        │  └────────────────────────────┘
│  ─ lib/po.test.ts (NEW)         │
│  ─ index.ts (MODIFY) — register │
└─────────────────────────────────┘
```

### 2.2 Key design decisions

**D1 — Single sub-project D, scope = "in vs out" not "decompose"**
Mirrors Sub-project C's pattern. Suppliers + PO data + UI ship together because shipping any subset delivers no end-to-end coordinator value.

**D2 — Full PO entity (`purchase_orders` + `purchase_order_lines`), not just `po_issued` flag**
Modal's "bulk-mark by supplier" requires a real PO record per supplier per scan. Each PO references multiple source `orders` via lines. `orders.po_issued` becomes a cached flag set by the API when any line references that order.

**D3 — Year-prefixed PO numbers (`PO-YYYY-XXXX`)**
Cleaner audit trail across years. Implemented via `po_sequences` table + `next_po_number()` PL/pgSQL function (analogous to `next_order_id()` for SO numbers). Resets sequence on first PO of each new year via `INSERT ... ON CONFLICT DO UPDATE`.

**D4 — Print-to-PDF via browser, not server-side PDF library**
Server returns text/html at `/purchase-orders/:id/print`; coordinator presses Cmd+P. Mirrors prototype's `backend-drawer.jsx:598` `generatePDF` pattern. Zero new infra. Zero PDF library in CF Worker. Audit trail comes from the `purchase_orders` row itself; PDF is regenerable on demand by re-rendering the print view.

**D5 — Coordinator-manual share, not auto-send**
After clicking Generate PO, modal shows wa.me link (if supplier has whatsapp_number) and mailto: link (if supplier has email). Coordinator clicks → opens WhatsApp Web / mail client → manually attaches the PDF they just saved. System records that the PO was created, not that it was sent.

**D6 — Drop drawer's "Issue PO" button**
Modal becomes the only PO creation surface. Drawer logistics section becomes read-only status display. Forces coordinator to use the rollup workflow, which is the whole point of Sub-project D.

**D7 — Suppliers seeded, CRUD deferred**
7 suppliers from prototype's `PO_SUPPLIER` map seeded with `code + name` only. `whatsapp_number` and `email` are nullable; Loo populates via Supabase Studio till Settings → Suppliers page is built (sub-project E or later).

**D8 — `products.supplier_id` is nullable but enforced at app layer**
Catalog is empty at MVP (Decision 10 from PORT_DESIGN), so no retroactive migration. SKU Master Pricing Editor will require supplier selection when creating new products. Existing prototype mocks (4 sofas + mattresses) are testimony only and never seeded.

**D9 — `po_issued` retained on lane step-back**
If coordinator drags order from `ready` back to `logistics`, the `po_issued` flag stays true. The PO was issued in real-world terms; going backward in lanes doesn't undo the supplier call. Mirrors Sub-project C's "step-back state retention" decision (D6 of C's spec).

**D10 — PO append-only, no edit / no delete**
Once `POST /purchase-orders` succeeds, the PO is immutable. No PATCH endpoint. No DELETE. Edit-PO and un-issue requires admin-only future work. Mirrors C's "DO key DELETE restriction" decision.

---

## 3. Components

### 3.1 `packages/db/migrations/` (3 new — needs per-migration confirmation)

- **`0014_create_suppliers.sql`** — creates `suppliers` table, seeds 6 rows (`SLP / KFA / OAK / AQS / KID / HMG` — note: prototype's `PO_SUPPLIER` maps 7 product categories but `sofa` and `bedframe` both point to KFA, so 6 distinct suppliers), adds nullable `supplier_id` FK on `products`
- **`0015_create_purchase_orders.sql`** — creates `po_sequences` table, `next_po_number()` PL/pgSQL function, `purchase_orders` table, `purchase_order_lines` table, indexes
- **`0016_orders_po_columns.sql`** — adds `po_issued boolean`, `po_issued_at timestamptz`, `po_issued_by uuid` columns on `orders`

### 3.2 `packages/db/src/schema.ts` (1 modify)

Mirror Drizzle definitions for new tables:
- `suppliers` pgTable
- `purchaseOrders` pgTable (note: keep table name `purchase_orders` in DB; Drizzle var name `purchaseOrders`)
- `purchaseOrderLines` pgTable
- Add `supplierId` column to existing `products` pgTable
- Add `poIssued`, `poIssuedAt`, `poIssuedBy` columns to existing `orders` pgTable

### 3.3 `apps/api/`

**NEW**
- `src/routes/purchase-orders.ts` — Hono router with 3 endpoints (POST + GET + GET /print)
- `src/routes/purchase-orders.test.ts` — integration tests (POST happy path, 400/409 errors, GET, GET /print, lane gate `logistics → ready` blocked when !po_issued)
- `src/lib/po.ts` — pure helpers:
  - `validatePoLineItems(items)` — non-empty, all qty > 0, all order_ids exist + are in logistics lane + are not already po_issued
  - `buildPoLinesFromCart(order)` — server-side equivalent of prototype's `buildPoLines`; expands sofa SKUs to compartments, pairs mattress SKUs with pillows; reads catalog from DB
  - `renderPoPrintHtml(po, supplier, lines, coordinator)` — HTML template function returning string with inline CSS for the printable PO
- `src/lib/po.test.ts` — unit tests covering validators, line builders, print template rendering

**MODIFY**
- `src/routes/orders.ts` — extend lane PATCH handler: `logistics → ready` transition rejects with 400 + `{error: 'po_required'}` when target lane is `ready` AND `!po_issued`. Other lane transitions unaffected.
- `src/index.ts` — register `purchase-orders` route at `/api/purchase-orders`

### 3.4 `apps/backend/`

**NEW**
- `src/components/PoScanModal.tsx` — full port of prototype's `PoScanModal` from `prototype/backend-orders.jsx:315-510`:
  - Two tabs: "Roll-up by supplier" (default) and "Detail by order"
  - Stats header: `N orders · M unique SKUs · P units · Q suppliers`
  - Per supplier group: code + name + "Generate PO" button + line items table
  - Line items table columns: SKU, Item, Size, Colour, Qty, From orders (pills)
  - Empty state: "All POs already issued — nothing to scan"
  - On "Generate PO" click → calls `createPO(supplierId, lineItems)` → opens print URL in new tab → shows post-issue state with wa.me + mailto: links
- `src/components/PoScanModal.module.css` — styles matching `be-po-modal*` classes from `prototype/backend-styles.css`
- `src/lib/purchase-orders.ts` — client lib:
  - `createPO(input): Promise<PurchaseOrder>` — POST to API
  - `getPrintUrl(poId): string` — returns full URL to `/api/purchase-orders/:id/print`
  - `openPrintWindow(poId): void` — `window.open(url, '_blank')`
  - TypeScript types mirroring `apps/api/src/lib/po.ts`

**MODIFY**
- `src/lib/queries.ts` — add:
  - `useSuppliers()` — TanStack Query for `GET /api/suppliers` (note: read-only list endpoint; piggyback off existing patterns or add tiny `GET /suppliers` to API if needed)
  - `usePurchaseOrders(orderId)` — fetch POs that reference a given order (for drawer status display)
- `src/components/OrderDrawer.tsx` — logistics section: replace existing "Issue PO" button + status text with read-only display:
  ```
  PO status: {po_issued ? `${po_number} · issued ${formatDate(po_issued_at)}` : 'Awaiting PO scan'}
  ```
- `src/components/LaneStepper.tsx` — extend gate matrix: when current lane is `logistics` and target lane is `ready`, block forward step if `!po_issued`; tooltip reads "Issue PO via Scan first"
- `src/pages/Orders.tsx` — add "Scan PO" button in `logistics` lane header (next to count badge); conditionally renders only when lane is logistics; on click opens `PoScanModal` (mounted at page level, controlled via `useState`)

### 3.5 Tests

**Auto** — `apps/api/src/lib/po.test.ts`:
- `validatePoLineItems`: empty array rejected, qty=0 rejected, qty<0 rejected, valid array passes
- `buildPoLinesFromCart`: simple SKU passes through, sofa expansion works (mock catalog), mattress with paired pillow handled
- `renderPoPrintHtml`: snapshot test of the HTML output for a sample PO

**Manual acceptance** (covered in Section 8.2)

### 3.6 Test data

Seed migration to add at end of implementation (similar to Sub-project C's `0018_test_orders_for_logistics.sql` precedent):
- 1 product with `supplier_id = SLP` (Sleepworks mattress)
- 1 product with `supplier_id = KFA` (Kraf Furnitur sofa)
- `SO-9008` — placed, in `logistics` lane, cart = the SLP mattress + the KFA sofa
- `SO-9009` — placed, in `logistics` lane, cart = the SLP mattress (different colour? n/a — mattress has size, not colour)

This exercises both the rollup (SLP appears twice across orders) and the supplier-split (one order has items from 2 suppliers).

---

## 4. Data Flow

### 4.1 State machine (this iteration completes the logistics gate)

```
received → proceed → logistics → ready → dispatched → delivered
                         │           ▲
                         │           │
                       PoScanModal   │
                         │           │
                         ▼           │
                   Generate PO ──────┘ (po_issued=true unblocks step)
```

### 4.2 Flow A · Coordinator opens scan modal

1. Coordinator views Orders board, sees `logistics` lane has N orders with `!po_issued` badge
2. Clicks "Scan PO" button in lane header (next to count: "Awaiting logistics · 3")
3. `Orders.tsx` sets `poScanOpen = true`, mounts `<PoScanModal orders={lanesLogistics.filter(o => !o.poIssued)} />`
4. Modal fetches catalog data (already in cache via `useProducts()`) + suppliers (via new `useSuppliers()`)
5. Computes rollup client-side (same logic as prototype's `buildPoLines` + aggregation):
   - For each order, expand cart items: sofa → compartments + fabric, mattress → +paired pillow, simple → as-is
   - Group by `supplier_id`
   - Deduplicate within supplier by `sku + colour` key, summing qty
   - Track contributing `orderIds` per dedup key
6. Renders rollup tab with N supplier groups + summary stats

### 4.3 Flow B · Generate PO

1. Coordinator clicks "Generate PO" on Sleepworks (SLP) group — modal disables button (loading state)
2. Frontend calls `createPO({ supplier_id: SLP_uuid, line_items: [{order_id, sku, name, size, colour, qty}, ...] })`
3. API `POST /purchase-orders` handler (`apps/api/src/routes/purchase-orders.ts`):
   - Auth check: requires `coordinator | finance | owner` role
   - `validatePoLineItems(line_items)` — rejects empty, rejects bad qty, verifies all order_ids exist + lane = logistics + !po_issued
   - DB transaction:
     - `INSERT INTO purchase_orders (supplier_id, created_by) VALUES (...)` — `po_number` defaults via `next_po_number()`
     - `INSERT INTO purchase_order_lines` (one row per line_item)
     - `UPDATE orders SET po_issued = true, po_issued_at = NOW(), po_issued_by = $created_by WHERE id IN (distinct order_ids)`
   - Returns 201 with PO + supplier + lines + referenced_order_ids
4. Frontend receives PO response — replaces SLP group's content with post-issue state:
   - "PO-2026-0001 issued · 5 items · 3 source orders"
   - "[Open print view]" button (opens new tab to `/api/purchase-orders/:id/print`)
   - "[WhatsApp]" link (if supplier has whatsapp_number; format: `https://wa.me/<number>?text=Hi%20<supplier>%2C...`)
   - "[Email]" link (if supplier has email; format: `mailto:<email>?subject=...&body=...`)
5. Coordinator clicks "Open print view" → new tab loads HTML PO → presses Cmd+P → saves PDF
6. Coordinator clicks WhatsApp link → opens WhatsApp Web / app → pastes greeting → manually attaches the PDF they just saved → sends

### 4.4 Flow C · Lane progression after PO issued

1. Order SO-9008's `po_issued = true` after step 3 of Flow B
2. Coordinator opens drawer for SO-9008 — logistics section now reads: "PO status: PO-2026-0001 · issued 09 May"
3. `LaneStepper` no longer blocks forward step (gate satisfied)
4. Coordinator clicks "Move to ready" — lane PATCH succeeds, order moves to `ready`
5. Stock arrives at warehouse (out-of-system) — coordinator manually drags order forward to `dispatched` once driver assigned (Sub-project C territory)

### 4.5 Edge cases

- **Order spans multiple suppliers** — modal shows it under each relevant supplier group; coordinator generates separate POs per supplier; each PO marks the order as `po_issued`. After first PO, the second supplier's group still shows the order's items because `po_issued` is set by *any* PO line. Resolution: filter modal input by `!po_issued` at the order level (existing prototype behavior); after first PO, the order disappears entirely from the modal until coordinator re-opens it. **Decision**: matches prototype, keeps simple. Coordinator runs the modal multiple times for cross-supplier orders. ⚠️ Documented as known limitation; future "split-PO" feature can address.
- **Concurrent generation** — two coordinators click "Generate PO" simultaneously for the same supplier with overlapping orders. Second request fails 409 because line validators detect orders with `po_issued = true` from first request's transaction. Frontend re-fetches modal state and re-renders.
- **Empty supplier group** — never rendered; supplier groups only show if they have at least one line item with referenced orders.
- **Supplier with no contact** — wa.me/mailto links omitted; coordinator gets PO number + print view only. Manual lookup of supplier contact via Supabase Studio till Settings → Suppliers ships.
- **Step-back retains PO state** — coordinator drags order back from `ready` → `logistics`. `po_issued` stays true (D9). Modal won't show this order again (`!po_issued` filter excludes it). Drawer continues showing PO status. To re-issue, admin would need to flip flag in Studio.
- **Sofa SKU has no compartments mapped** — falls back to single line item with the parent SKU + qty 1. Mirrors prototype's behavior at `buildPoLines:283`.
- **Mattress without paired pillow mapping** — falls back to mattress-only line. No pillow auto-attach.

---

## 5. API Contracts

### 5.1 `POST /api/purchase-orders` (NEW)

**Request:**
```json
{
  "supplier_id": "uuid",
  "line_items": [
    {
      "order_id": "uuid",
      "sku": "MAT-001",
      "name": "Cloud mattress",
      "size": "queen",
      "colour": null,
      "qty": 2
    }
  ]
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "po_number": "PO-2026-0001",
  "supplier": {
    "id": "uuid",
    "code": "SLP",
    "name": "Sleepworks Sdn Bhd",
    "whatsapp_number": null,
    "email": null
  },
  "created_at": "2026-05-09T08:30:00Z",
  "created_by": {
    "id": "uuid",
    "name": "Coordinator Name"
  },
  "lines": [/* echoed line_items + line ids */],
  "referenced_order_ids": ["uuid", "uuid"]
}
```

**Errors:**
- `400 invalid_request` — empty line_items, qty <= 0, missing supplier_id
- `400 supplier_not_found` — supplier_id doesn't exist
- `400 order_not_in_logistics` — any order_id is not in logistics lane (includes order_id list in error.details)
- `409 already_issued` — any order_id already has po_issued=true (includes order_id list)
- `500 db_error` — transaction failure

### 5.2 `GET /api/purchase-orders/:id` (NEW)

Returns same shape as POST 201. Used by drawer status display + post-issue modal state if user closes and reopens.

**Errors:**
- `404 not_found` — PO doesn't exist

### 5.3 `GET /api/purchase-orders/:id/print` (NEW)

Returns `text/html` (NOT JSON). Used by coordinator's browser via `window.open()` for print-to-PDF.

**Response 200 (Content-Type: text/html):**
- Standard PO layout per Section 5.5 below
- Inline CSS in `<style>` tag (no external sheet — single-file print)
- `@media print` rules to hide buttons / use full A4 page
- Auto-print: `<script>window.print()</script>` (optional — coordinator can skip and review first)

**Errors:**
- `404 not_found` — same as 5.2

### 5.4 `PATCH /api/orders/:id/lane` (MODIFY)

Existing endpoint extended with one gate:

```ts
if (currentLane === 'logistics' && targetLane === 'ready' && !order.po_issued) {
  return c.json({ error: 'po_required', message: 'Issue PO via Scan first' }, 400);
}
```

All other transitions (incl. step-backs, dispatched/delivered gates from Sub-project C) unchanged.

### 5.5 PDF print view content (Standard scope)

```
┌─────────────────────────────────────────────────────────────┐
│  [2990's wordmark]                          PO-2026-0001    │
│                                             09 May 2026     │
│                                                             │
│  TO                              FROM                       │
│  Sleepworks Sdn Bhd              HOUZS Venture Sdn Bhd      │
│  Code: SLP                       Showroom KL                │
│  [whatsapp_number if set]        [warehouse address]        │
│  [email if set]                                             │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  SKU         Item                  Size      Colour    Qty  │
│  MAT-001     Cloud mattress        queen     —          2   │
│  MAT-001     Cloud mattress        king      —          1   │
│  PIL-002     Cloud memory pillow   —         —          6   │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Source orders: SO-9008, SO-9009, SO-9012                   │
│                                                             │
│  Coordinator: [name]                  Issued: 09 May 2026   │
│                                                             │
│  2990's — Same price. Every piece. Always.                  │
└─────────────────────────────────────────────────────────────┘
```

Style: serif body type (`var(--c-ink)` `#221F20`), warm cream background or white for print, single-column, A4 portrait. Reuse tokens from `prototype/assets/colors_and_type.css`.

### 5.6 Auth matrix

| Endpoint | owner | finance | coordinator | sales | unauthenticated |
|---|---|---|---|---|---|
| POST /purchase-orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| GET /purchase-orders/:id | ✅ | ✅ | ✅ | ❌ | ❌ |
| GET /purchase-orders/:id/print | ✅ | ✅ | ✅ | ❌ | ❌ |
| PATCH /orders/:id/lane (existing) | ✅ | ✅ | ✅ | ❌ | ❌ |

---

## 6. Schema + Storage Migrations (touches red line — needs per-migration yes)

### 6.1 M3 · `0014_create_suppliers.sql`

```sql
-- Sub-project D · suppliers table + products.supplier_id FK + 7-supplier seed
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  whatsapp_number TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE products ADD COLUMN supplier_id UUID REFERENCES suppliers(id) ON DELETE RESTRICT;

INSERT INTO suppliers (code, name) VALUES
  ('SLP', 'Sleepworks Sdn Bhd'),
  ('KFA', 'Kraf Furnitur Asia'),
  ('OAK', 'Oakline Workshop'),
  ('AQS', 'Aquasense Bath Co.'),
  ('KID', 'Pinetop Kids Co.'),
  ('HMG', 'Homegoods Trading');
```

(Note: prototype's `PO_SUPPLIER` map has `mattress + sofa + bedframe + dining + bathroom + kids + accessory` → 7 categories, but `sofa` and `bedframe` both map to KFA, so there are only 6 distinct suppliers. Final seed = 6 rows.)

### 6.2 M4 · `0015_create_purchase_orders.sql`

```sql
-- Sub-project D · purchase_orders + purchase_order_lines + year-prefixed sequence

CREATE TABLE po_sequences (
  year INTEGER PRIMARY KEY,
  current_value INTEGER NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_po_number() RETURNS TEXT AS $$
DECLARE
  cur_year INTEGER := EXTRACT(YEAR FROM NOW())::INTEGER;
  next_seq INTEGER;
BEGIN
  INSERT INTO po_sequences (year, current_value)
  VALUES (cur_year, 1)
  ON CONFLICT (year) DO UPDATE SET current_value = po_sequences.current_value + 1
  RETURNING current_value INTO next_seq;
  RETURN 'PO-' || cur_year || '-' || LPAD(next_seq::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT UNIQUE NOT NULL DEFAULT next_po_number(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT
);

CREATE TABLE purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  size TEXT,
  colour TEXT,
  qty INTEGER NOT NULL CHECK (qty > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pol_purchase_order ON purchase_order_lines(purchase_order_id);
CREATE INDEX idx_pol_order ON purchase_order_lines(order_id);
```

### 6.3 M5 · `0016_orders_po_columns.sql`

```sql
-- Sub-project D · orders table gains po_issued cached flag + audit cols
ALTER TABLE orders
  ADD COLUMN po_issued BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN po_issued_at TIMESTAMPTZ,
  ADD COLUMN po_issued_by UUID REFERENCES staff(id) ON DELETE RESTRICT;
```

### 6.4 Apply order

1. M3 first (suppliers must exist before products.supplier_id FK)
2. M4 second (depends on suppliers, staff, orders — all exist)
3. M5 third (independent of M3/M4 strictly speaking, but logically follows)

Each migration applied via Supabase MCP `apply_migration`, awaiting Loo's "yes" per global red line #4 (RLS policies — these don't touch RLS but we follow the same per-migration confirmation cadence as Sub-project C).

### 6.5 Append-only

Per `CLAUDE.md` "Migrations are append-only after deploy. Even pre-deploy, don't squash without explicit OK." Each migration ships as its own file. No combining.

### 6.6 RLS

Tables created in this sub-project inherit project-default RLS:
- Reads gated by staff role (coordinator / finance / owner can read all)
- Writes gated by staff role (same)
- No customer-facing access (POS app does not query these endpoints)

⚠️ **Red line #4** (Supabase RLS policies) — if explicit policies are needed beyond defaults, requires its own confirmation. For MVP the default project policies should suffice.

---

## 7. Error Handling

### 7.1 Coordinator UI errors

- **Generate PO succeeds but print window blocked by browser** — toast: "Print window blocked. Click [Open print view] to retry."
- **Generate PO fails 400 order_not_in_logistics** — modal toast: "Some orders moved out of logistics during scan. Refreshing..." + auto-refresh modal data
- **Generate PO fails 409 already_issued** — modal toast: "Another coordinator just issued this PO. Refreshing..." + auto-refresh
- **Generate PO fails 500** — modal toast: "Something went wrong. Try again or contact support." Button re-enabled.
- **Lane stepper blocked by `po_required`** — tooltip on hover: "Issue PO via Scan first"; click ignored

### 7.2 Audit

- `purchase_orders.created_at` + `created_by` is the audit trail for PO issuance
- `purchase_order_lines.created_at` mirrors PO creation (no separate edit flow)
- `orders.po_issued_at` + `po_issued_by` cache the first PO that referenced the order (for fast drawer display without joining `purchase_order_lines`)
- No separate `po_events` table — append-only `purchase_orders` + `purchase_order_lines` is the audit log

---

## 8. Testing Plan

### 8.1 Auto tests

**Unit (`apps/api/src/lib/po.test.ts`):**
- `validatePoLineItems`:
  - rejects empty array
  - rejects qty=0 / qty=-1
  - accepts valid array
- `buildPoLinesFromCart`:
  - simple SKU: returns single line
  - sofa with compartments: returns N lines per compartment with fabric/colour metadata
  - mattress with paired pillow: returns 2 lines (mattress + pillow)
  - sofa without compartment mapping: falls back to single line
- `renderPoPrintHtml`:
  - snapshot test: standard PO with 3 lines, supplier with both contact methods
  - snapshot test: PO with supplier missing contact (no wa.me/mailto)

**Integration (`apps/api/src/routes/purchase-orders.test.ts`):**
- POST happy path: creates PO + lines + flips po_issued on referenced orders
- POST 400 empty line_items / qty <= 0
- POST 400 order_not_in_logistics (seed an order in `received` lane, attempt to issue)
- POST 409 already_issued (run twice with same orders)
- GET /:id returns full PO + supplier + lines
- GET /:id/print returns text/html containing PO number + supplier name
- Lane gate: `PATCH /orders/:id/lane` from logistics → ready blocked when !po_issued (400 po_required)
- Lane gate: `PATCH /orders/:id/lane` from logistics → ready succeeds after PO issued

### 8.2 Manual acceptance tests

After implementation + test data seed, run with Playwright MCP (currently blocked on auth — see Sub-project C Task 62):

1. Login as coordinator
2. Navigate to Orders board
3. Verify `logistics` lane has 2 orders (SO-9008, SO-9009) with "Awaiting PO scan" badge
4. Click "Scan PO" button in lane header
5. Modal opens — verify rollup tab shows 2 supplier groups (SLP + KFA) with line items
6. Click "Generate PO" on SLP
7. Verify new tab opens with `/print` URL showing standard PO layout
8. Press Cmd+P → save as PDF (manual step; not Playwright-automated)
9. Close print tab, return to modal — verify SLP group shows post-issue state
10. Click "Generate PO" on KFA → repeat
11. Close modal — verify lane no longer shows "Awaiting PO scan" badge on either order
12. Open SO-9008 drawer — verify logistics section shows "PO status: PO-2026-0001 · issued 09 May" (or similar for KFA)
13. Click "Move to ready" in LaneStepper — verify transition succeeds
14. Drag SO-9008 back to logistics — verify `po_issued` stays true (drawer still shows PO status)
15. Reopen scan modal — verify SO-9008 does NOT appear (already PO issued)

### 8.3 Test data

Seed migration `0017_test_orders_for_po.sql` (created at end of implementation, similar to C's pattern):
- 1 product with `supplier_id = SLP`
- 1 product with `supplier_id = KFA`
- SO-9008 in `logistics` lane with cart spanning both
- SO-9009 in `logistics` lane with SLP product only

---

## 9. Implementation Prerequisites

### 9.1 Per-migration confirmation protocol

Mirrors Sub-project C: pause before each `apply_migration` call, show the SQL to Loo, ask for "yes / go ahead" per global red line. Three gates: M3 / M4 / M5.

### 9.2 No external infra needed

- No new env vars
- No new Supabase Storage buckets (PO PDFs are not persisted server-side; coordinator's browser saves them)
- No new Cloudflare Worker secrets
- No new MCP integrations

### 9.3 Catalog dependency

`PoScanModal` requires:
- At least one supplier seeded ✅ (handled by M3)
- At least one product with `supplier_id` set
- At least one order in `logistics` lane referencing that product

Without these, the feature ships dormant (modal shows "All POs already issued"). Test data seed in Section 8.3 satisfies this for acceptance testing only.

---

## 10. Decision Log

| ID | Decision | Rationale | Source |
|---|---|---|---|
| D1 | Single sub-project D, scope = "in vs out" | Mirror C's pattern; all pieces ship together for E2E value | Task 65 AskUserQuestion |
| D2 | Full PO entity, not just `po_issued` flag | Bulk-mark by supplier requires real PO records | Task 65 AskUserQuestion + brainstorm |
| D3 | Year-prefixed PO numbers (`PO-YYYY-XXXX`) | Cleaner audit trail across years | Task 67 AskUserQuestion |
| D4 | Print-to-PDF via browser, not server-side | Zero new infra, mirrors prototype's existing print pattern | Task 65 AskUserQuestion |
| D5 | Coordinator-manual share (wa.me + mailto), not auto-send | Avoids SendGrid/Twilio infra; 1-coordinator MVP scale | Task 65 AskUserQuestion |
| D6 | Drop drawer's per-order "Issue PO" button | Modal becomes only PO creation surface | Task 65 AskUserQuestion |
| D7 | Suppliers seeded, CRUD deferred (placeholder) | Mirrors C's "Drivers CRUD deferral" pattern | Task 67 AskUserQuestion |
| D8 | `products.supplier_id` nullable, app-enforced | Catalog empty at MVP; SKU Master enforces on create | PORT_DESIGN §10 Decision 10 |
| D9 | `po_issued` retained on lane step-back | Real-world supplier call doesn't undo with lane | Mirrors C's D6 (step-back state retention) |
| D10 | PO append-only, no edit / no delete | Audit trail integrity; admin-only future work | Mirrors C's DO key DELETE restriction (D7) |

---

## Appendix A — Files reference

**NEW (10 files):**

| Path | Purpose |
|---|---|
| `packages/db/migrations/0014_create_suppliers.sql` | suppliers table + 6-supplier seed + products.supplier_id FK |
| `packages/db/migrations/0015_create_purchase_orders.sql` | po_sequences + next_po_number() + purchase_orders + purchase_order_lines |
| `packages/db/migrations/0016_orders_po_columns.sql` | orders.po_issued + po_issued_at + po_issued_by |
| `apps/api/src/routes/purchase-orders.ts` | POST + GET + GET /print endpoints |
| `apps/api/src/routes/purchase-orders.test.ts` | integration tests + lane gate tests |
| `apps/api/src/lib/po.ts` | validators, line builders, print template |
| `apps/api/src/lib/po.test.ts` | unit tests for po.ts |
| `apps/backend/src/lib/purchase-orders.ts` | client lib (createPO, openPrintWindow) |
| `apps/backend/src/components/PoScanModal.tsx` | rollup + detail tabs |
| `apps/backend/src/components/PoScanModal.module.css` | be-po-modal* styles ported from prototype |

**MODIFY (7 files):**

| Path | Change |
|---|---|
| `packages/db/src/schema.ts` | add 3 tables + columns on orders + supplier_id on products |
| `apps/api/src/routes/orders.ts` | lane PATCH gate: logistics → ready requires po_issued |
| `apps/api/src/index.ts` | register `/purchase-orders` route |
| `apps/backend/src/lib/queries.ts` | add useSuppliers, usePurchaseOrders |
| `apps/backend/src/components/OrderDrawer.tsx` | logistics section: read-only PO status display |
| `apps/backend/src/components/LaneStepper.tsx` | block forward step in logistics if !po_issued |
| `apps/backend/src/pages/Orders.tsx` | add "Scan PO" button in logistics lane header |

**Total: 17 files (10 NEW + 7 MODIFY) + 1 test data seed migration written at end of implementation.**

---

## Appendix B — References

- Sub-project C spec: `docs/superpowers/specs/2026-05-09-driver-dispatch-do-design.md`
- Sub-project C plan: `docs/superpowers/plans/2026-05-09-driver-dispatch-do.md`
- Slip MVP spec: `docs/superpowers/specs/2026-05-09-slip-workflow-mvp-design.md`
- Prototype PO UI: `prototype/backend-orders.jsx:205-510` (PoScanModal + buildPoLines + PO_SUPPLIER + SOFA_COMPARTMENTS + SOFA_FABRIC + MATTRESS_PILLOWS)
- Prototype drawer logistics section: `prototype/backend-drawer.jsx:483-500` (Issue PO button — being dropped)
- Prototype print pattern: `prototype/backend-drawer.jsx:69-107` (window.print template)
- Project plan: `2990S-PORTAL-PLAN.md` Phase 4
- Project conventions: `CLAUDE.md` (PORT_DESIGN §10 Decision 10 — empty catalog at MVP)
