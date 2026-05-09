# Suppliers + PO Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the PO (Purchase Order) workflow that bridges sales orders in the `logistics` lane to actual stock procurement. Coordinator opens a scan modal, sees a supplier-grouped rollup across all logistics-lane orders, generates a PO per supplier with year-prefixed numbering, and gets a printable HTML PO they save as PDF and share manually via WhatsApp/email.

**Architecture:** Three new tables (`suppliers`, `purchase_orders`, `purchase_order_lines`) + 3 columns on `orders` (`po_issued`, `po_issued_at`, `po_issued_by`) + 1 FK on `products` (`supplier_id`). `next_po_number()` PL/pgSQL function generates `PO-YYYY-XXXX` via a `po_sequences` table that resets each year. New API route `/api/purchase-orders` with POST + GET + GET /print (text/html). Lane PATCH gate added: `logistics → ready` requires `po_issued = true`. Backend gets `PoScanModal` component (full port from prototype's `backend-orders.jsx:315-510`) + drawer logistics section becomes read-only PO status display + LaneStepper enforces the gate visually. Print-to-PDF via browser (Variant A) — server returns text/html, coordinator presses Cmd+P. Coordinator-manual share via wa.me + mailto links.

**Tech Stack:** TypeScript strict, React 19 + Vite 6 + React Router 7 (Backend), Hono on CF Workers (API), Drizzle + Supabase Postgres, Vitest, CSS Modules, TanStack Query.

**Spec source:** `docs/superpowers/specs/2026-05-09-suppliers-po-design.md` (committed 8202bf4).

**Total scope:** 17 files (10 new + 7 modify), 17 tasks across 5 phases. Estimated 4-5 days for an experienced executor.

**Spec refinement during planning:**
- `buildPoLinesFromCart` from spec §3.3 is moved to client-side (inlined in `PoScanModal.tsx`) since rollup is a UX concern, not a server validation concern. Server `po.ts` keeps `validatePoLineItems` + `renderPoPrintHtml` only. File count unchanged (10 NEW).

**Red line gates:** Tasks 0.1, 0.2, 0.3 are STOP-points where the executor MUST get explicit "yes" from Loo before applying SQL. No exceptions. (M3 + M4 + M5 are schema changes; M3 also adds `products.supplier_id` FK — touches red line #4 cadence per Sub-project C precedent.)

**No external infra needed:** No new Supabase Storage buckets (PO PDFs are not persisted server-side; coordinator's browser saves them). No new Cloudflare Worker secrets. No new env vars. No new MCP integrations.

**Feature ships dormant:** Until catalog is seeded with products that carry `supplier_id` and orders flow through `logistics`, `PoScanModal` will show "All POs already issued" empty state. Task 4.1 seeds 2 products + 2 test orders to exercise the rollup during acceptance.

---

## Phase 0 — Migrations (RED LINE GATES)

### Task 0.1: Apply M3 — `0014_create_suppliers.sql` (RED LINE GATE)

**Files:**
- Create: `packages/db/migrations/0014_create_suppliers.sql`

- [ ] **Step 1: Write the migration file**

Create `packages/db/migrations/0014_create_suppliers.sql`:

```sql
-- 0014_create_suppliers.sql
-- Phase 4 sub-project D: suppliers table + products.supplier_id FK + 6-supplier seed.
-- whatsapp_number and email are nullable; coordinator populates via Supabase Studio
-- till Settings → Suppliers page is built (deferred per spec §1.2).

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

- [ ] **Step 2: STOP and ask Loo for explicit yes**

Send:
```
要 apply M3 (0014_create_suppliers.sql) 到 Supabase。

SQL 已写入 packages/db/migrations/0014_create_suppliers.sql：

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

效果：
- 创建 suppliers 表（6 个 nullable 字段；whatsapp_number + email 可后期填）
- products 加 supplier_id FK（nullable，因为 catalog 在 MVP 是空）
- 种 6 个 supplier（来自 prototype PO_SUPPLIER：sofa+bedframe 都是 KFA，所以 6 个不重复）
- ON DELETE RESTRICT — supplier 被产品引用时无法删除

Apply 吗？回 "yes" 我才执行 mcp__supabase__apply_migration。
```

- [ ] **Step 3: After yes, apply via MCP**

Use `mcp__supabase__apply_migration` with name `0014_create_suppliers` and the SQL.

- [ ] **Step 4: Verify table + seed**

Use `mcp__supabase__execute_sql`:
```sql
SELECT code, name FROM suppliers ORDER BY code;
```
Expected: 6 rows (AQS, HMG, KFA, KID, OAK, SLP) with their full names.

```sql
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='products' AND column_name='supplier_id';
```
Expected: 1 row (supplier_id, uuid, YES).

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/migrations/0014_create_suppliers.sql
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(db): create suppliers table + 6-supplier seed + products.supplier_id FK — Suppliers+PO"
```

---

### Task 0.2: Apply M4 — `0015_create_purchase_orders.sql` (RED LINE GATE)

**Files:**
- Create: `packages/db/migrations/0015_create_purchase_orders.sql`

- [ ] **Step 1: Write the migration file**

Create `packages/db/migrations/0015_create_purchase_orders.sql`:

```sql
-- 0015_create_purchase_orders.sql
-- Phase 4 sub-project D: purchase_orders + purchase_order_lines + year-prefixed PO sequence.

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

- [ ] **Step 2: STOP and ask Loo for explicit yes**

Send:
```
要 apply M4 (0015_create_purchase_orders.sql) 到 Supabase。

[paste full SQL above]

效果：
- 创建 po_sequences 表（year + current_value，每年自己重置）
- 创建 next_po_number() PL/pgSQL function — 生成 'PO-YYYY-XXXX' 格式 (e.g. PO-2026-0001)
- 创建 purchase_orders（PO header；po_number 默认通过 next_po_number() 自动生成）
- 创建 purchase_order_lines（PO line items；每行 link 回原 sales order via order_id FK）
- 2 indexes 加速查询（按 PO 和按 order）
- ON DELETE CASCADE on lines — 删 PO 时连 lines 一起删（虽然 spec 说不允许删 PO，但 FK 行为还是 explicit）
- ON DELETE RESTRICT on order_id — sales order 被 line 引用时不能删

Apply 吗？回 "yes" 我才执行。
```

- [ ] **Step 3: After yes, apply via MCP**

Use `mcp__supabase__apply_migration` with name `0015_create_purchase_orders`.

- [ ] **Step 4: Verify tables + function**

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema='public' AND table_name IN ('po_sequences', 'purchase_orders', 'purchase_order_lines')
 ORDER BY table_name;
```
Expected: 3 rows.

```sql
SELECT next_po_number();
```
Expected: 'PO-2026-0001' (or 'PO-{current_year}-0001' if running in different year).

Run it again:
```sql
SELECT next_po_number();
```
Expected: 'PO-2026-0002' — sequence advances.

- [ ] **Step 5: Reset sequence to 0 (we just consumed PO-0001 and PO-0002 in test calls)**

```sql
UPDATE po_sequences SET current_value = 0 WHERE year = EXTRACT(YEAR FROM NOW())::INTEGER;
```

Verify:
```sql
SELECT * FROM po_sequences;
```
Expected: 1 row (year, current_value=0).

- [ ] **Step 6: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/migrations/0015_create_purchase_orders.sql
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(db): create purchase_orders + purchase_order_lines + next_po_number() — Suppliers+PO"
```

---

### Task 0.3: Apply M5 — `0016_orders_po_columns.sql` (RED LINE GATE)

**Files:**
- Create: `packages/db/migrations/0016_orders_po_columns.sql`

- [ ] **Step 1: Write the migration file**

Create `packages/db/migrations/0016_orders_po_columns.sql`:

```sql
-- 0016_orders_po_columns.sql
-- Phase 4 sub-project D: orders gains po_issued cached flag + audit cols.
-- po_issued is set by API when first PO line references the order.
-- Step-back from ready→logistics retains the flag (D9 in spec decision log).

ALTER TABLE orders
  ADD COLUMN po_issued BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN po_issued_at TIMESTAMPTZ,
  ADD COLUMN po_issued_by UUID REFERENCES staff(id) ON DELETE RESTRICT;
```

- [ ] **Step 2: STOP and ask Loo for explicit yes**

Send:
```
要 apply M5 (0016_orders_po_columns.sql) 到 Supabase。

ALTER TABLE orders
  ADD COLUMN po_issued BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN po_issued_at TIMESTAMPTZ,
  ADD COLUMN po_issued_by UUID REFERENCES staff(id) ON DELETE RESTRICT;

效果：
- orders 表加 3 个 column
- po_issued: cached flag, API 在创建 PO 时设为 true（per D9 decision: 即使 lane 退回 logistics 也保留）
- po_issued_at: 第一次 PO issue 的时间
- po_issued_by: issue PO 的 coordinator
- DEFAULT FALSE 让现存 orders（SO-9001~9007）保持 backward compatible

Apply 吗？回 "yes" 我才执行。
```

- [ ] **Step 3: After yes, apply via MCP**

Use `mcp__supabase__apply_migration` with name `0016_orders_po_columns`.

- [ ] **Step 4: Verify columns + existing rows have default**

```sql
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='orders'
   AND column_name IN ('po_issued', 'po_issued_at', 'po_issued_by')
 ORDER BY column_name;
```
Expected: 3 rows.

```sql
SELECT id, po_issued FROM orders WHERE id IN ('SO-9006', 'SO-9007') ORDER BY id;
```
Expected: both rows show `po_issued = false` (default applied).

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/migrations/0016_orders_po_columns.sql
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(db): add po_issued + po_issued_at + po_issued_by to orders — Suppliers+PO"
```

---

### Task 0.4: Update Drizzle schema mirror

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Read current schema.ts**

Run: `Read packages/db/src/schema.ts`. Locate:
1. The `products` pgTable definition.
2. The `orders` pgTable definition.
3. The end of the file (where to append new tables `suppliers`, `purchaseOrders`, `purchaseOrderLines`).

- [ ] **Step 2: Add `supplierId` column to `products` pgTable**

Inside the `products` pgTable definition, after the existing columns (e.g. after `name`, `cat`, etc.), append:

```typescript
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
```

(Note: `suppliers` is defined further down — Drizzle handles forward references fine inside an arrow callback.)

- [ ] **Step 3: Add 3 new columns to `orders` pgTable**

Inside the `orders` pgTable definition, after the existing columns, append:

```typescript
  // Phase 4-D PO additions (migration 0016):
  poIssued:    boolean('po_issued').notNull().default(false),
  poIssuedAt:  timestamp('po_issued_at', { withTimezone: true }),
  poIssuedBy:  uuid('po_issued_by').references(() => staff.id, { onDelete: 'restrict' }),
```

- [ ] **Step 4: Append 3 new pgTables at end of file**

Add after the last existing pgTable definition:

```typescript
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
  orderId:          uuid('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
  sku:              text('sku').notNull(),
  name:             text('name').notNull(),
  size:             text('size'),
  colour:           text('colour'),
  qty:              integer('qty').notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 5: Verify imports at top of file include `boolean`, `integer`, `text`, `timestamp`, `uuid`, `pgTable`**

If any are missing from the existing `import { ... } from 'drizzle-orm/pg-core';` statement, add them.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @2990s/db typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/src/schema.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "chore(db): Drizzle schema mirror for suppliers + purchase_orders + orders po cols + products.supplier_id — Suppliers+PO"
```

---

## Phase 1 — API endpoints

### Task 1.1: PO helpers + unit tests (TDD)

**Files:**
- Create: `apps/api/src/lib/po.ts`
- Create: `apps/api/src/lib/po.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/lib/po.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validatePoLineItemsShape, renderPoPrintHtml } from './po';

describe('validatePoLineItemsShape', () => {
  const validItem = { order_id: '00000000-0000-0000-0000-000000000001', sku: 'MAT-001', name: 'Cloud mattress', size: 'queen', colour: null, qty: 2 };

  it('accepts valid array', () => {
    expect(validatePoLineItemsShape([validItem])).toEqual({ ok: true });
  });

  it('rejects empty array', () => {
    expect(validatePoLineItemsShape([])).toEqual({ ok: false, error: 'empty_line_items' });
  });

  it('rejects qty=0', () => {
    expect(validatePoLineItemsShape([{ ...validItem, qty: 0 }])).toEqual({ ok: false, error: 'invalid_qty' });
  });

  it('rejects qty=-1', () => {
    expect(validatePoLineItemsShape([{ ...validItem, qty: -1 }])).toEqual({ ok: false, error: 'invalid_qty' });
  });

  it('rejects missing order_id', () => {
    const bad = { ...validItem, order_id: '' };
    expect(validatePoLineItemsShape([bad])).toEqual({ ok: false, error: 'missing_order_id' });
  });

  it('rejects missing sku', () => {
    const bad = { ...validItem, sku: '' };
    expect(validatePoLineItemsShape([bad])).toEqual({ ok: false, error: 'missing_sku' });
  });

  it('rejects non-array input', () => {
    expect(validatePoLineItemsShape(null as any)).toEqual({ ok: false, error: 'not_an_array' });
    expect(validatePoLineItemsShape({} as any)).toEqual({ ok: false, error: 'not_an_array' });
  });
});

describe('renderPoPrintHtml', () => {
  const sample = {
    po: {
      id: '11111111-1111-1111-1111-111111111111',
      po_number: 'PO-2026-0001',
      created_at: '2026-05-09T08:30:00Z',
    },
    supplier: {
      code: 'SLP',
      name: 'Sleepworks Sdn Bhd',
      whatsapp_number: null,
      email: null,
    },
    lines: [
      { sku: 'MAT-001', name: 'Cloud mattress', size: 'queen', colour: null, qty: 2 },
      { sku: 'PIL-002', name: 'Cloud memory pillow', size: null, colour: null, qty: 4 },
    ],
    coordinator: { name: 'Ada Wong' },
    sourceOrderIds: ['SO-9008', 'SO-9009'],
    showroom: { name: 'Showroom KL', address: 'KL warehouse address' },
  };

  it('includes PO number in output', () => {
    const html = renderPoPrintHtml(sample);
    expect(html).toContain('PO-2026-0001');
  });

  it('includes supplier name', () => {
    const html = renderPoPrintHtml(sample);
    expect(html).toContain('Sleepworks Sdn Bhd');
  });

  it('includes all line items', () => {
    const html = renderPoPrintHtml(sample);
    expect(html).toContain('MAT-001');
    expect(html).toContain('Cloud mattress');
    expect(html).toContain('PIL-002');
    expect(html).toContain('Cloud memory pillow');
  });

  it('includes source order IDs', () => {
    const html = renderPoPrintHtml(sample);
    expect(html).toContain('SO-9008');
    expect(html).toContain('SO-9009');
  });

  it('includes coordinator name', () => {
    const html = renderPoPrintHtml(sample);
    expect(html).toContain('Ada Wong');
  });

  it('includes 2990s tagline footer', () => {
    const html = renderPoPrintHtml(sample);
    expect(html).toContain('Same price. Every piece. Always.');
  });

  it('escapes HTML special chars in supplier name', () => {
    const html = renderPoPrintHtml({
      ...sample,
      supplier: { ...sample.supplier, name: 'Sleepworks <script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `pnpm --filter @2990s/api test po.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement po.ts**

Create `apps/api/src/lib/po.ts`:

```typescript
// PO helpers — pure functions for shape validation + print template rendering.
// Database-touching validation (lane state, !po_issued) lives in the route handler
// since it requires Supabase client. This file is for pure logic + tests.

export interface PoLineItem {
  order_id: string;
  sku: string;
  name: string;
  size: string | null;
  colour: string | null;
  qty: number;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validatePoLineItemsShape(items: unknown): ValidationResult {
  if (!Array.isArray(items)) return { ok: false, error: 'not_an_array' };
  if (items.length === 0) return { ok: false, error: 'empty_line_items' };

  for (const it of items) {
    if (!it || typeof it !== 'object') return { ok: false, error: 'invalid_item' };
    const item = it as Record<string, unknown>;
    if (typeof item.order_id !== 'string' || item.order_id.length === 0) {
      return { ok: false, error: 'missing_order_id' };
    }
    if (typeof item.sku !== 'string' || item.sku.length === 0) {
      return { ok: false, error: 'missing_sku' };
    }
    if (typeof item.name !== 'string' || item.name.length === 0) {
      return { ok: false, error: 'missing_name' };
    }
    if (typeof item.qty !== 'number' || item.qty <= 0 || !Number.isInteger(item.qty)) {
      return { ok: false, error: 'invalid_qty' };
    }
  }
  return { ok: true };
}

// HTML escape for the print template
function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export interface PoPrintInput {
  po: { id: string; po_number: string; created_at: string };
  supplier: { code: string; name: string; whatsapp_number: string | null; email: string | null };
  lines: { sku: string; name: string; size: string | null; colour: string | null; qty: number }[];
  coordinator: { name: string };
  sourceOrderIds: string[];
  showroom: { name: string; address: string };
}

export function renderPoPrintHtml(input: PoPrintInput): string {
  const { po, supplier, lines, coordinator, sourceOrderIds, showroom } = input;
  const issuedDate = fmtDate(po.created_at);

  const linesHtml = lines.map((l) => `
    <tr>
      <td><code>${esc(l.sku)}</code></td>
      <td>${esc(l.name)}</td>
      <td>${esc(l.size) || '—'}</td>
      <td>${esc(l.colour) || '—'}</td>
      <td class="r">×${l.qty}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(po.po_number)} — ${esc(supplier.name)}</title>
<style>
  :root { --c-ink: #221F20; --c-line: #DCD3C4; --c-cream: #FAF6EE; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font: 14px/1.55 'Crimson Text', 'Georgia', serif;
    color: var(--c-ink);
    background: white;
    padding: 40px 48px;
    max-width: 720px;
    margin: 0 auto;
  }
  h1 { font-size: 22px; font-weight: 600; }
  h2 { font-size: 13px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #6B6157; margin-bottom: 6px; }
  .head { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 18px; border-bottom: 1px solid var(--c-line); margin-bottom: 24px; }
  .meta { text-align: right; font-size: 13px; color: #6B6157; }
  .meta strong { display: block; font-size: 16px; color: var(--c-ink); }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 24px; }
  .party p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 13px; }
  th, td { padding: 8px 6px; text-align: left; border-bottom: 1px solid var(--c-line); }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #6B6157; font-weight: 600; }
  .r { text-align: right; }
  code { font: 12px/1 ui-monospace, monospace; background: var(--c-cream); padding: 2px 6px; border-radius: 3px; }
  .sources { font-size: 13px; color: #6B6157; margin: 16px 0; }
  .sig { display: flex; justify-content: space-between; align-items: baseline; margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--c-line); font-size: 13px; }
  .footer { margin-top: 48px; text-align: center; font-size: 12px; color: #6B6157; font-style: italic; }
  @media print {
    body { padding: 24px; max-width: none; }
    @page { size: A4; margin: 18mm; }
  }
</style>
</head>
<body>
  <div class="head">
    <h1>2990&apos;s</h1>
    <div class="meta">
      <strong>${esc(po.po_number)}</strong>
      ${esc(issuedDate)}
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h2>To</h2>
      <p><strong>${esc(supplier.name)}</strong></p>
      <p>Code: ${esc(supplier.code)}</p>
      ${supplier.whatsapp_number ? `<p>WhatsApp: ${esc(supplier.whatsapp_number)}</p>` : ''}
      ${supplier.email ? `<p>Email: ${esc(supplier.email)}</p>` : ''}
    </div>
    <div class="party">
      <h2>From</h2>
      <p><strong>HOUZS Venture Sdn Bhd</strong></p>
      <p>${esc(showroom.name)}</p>
      <p>${esc(showroom.address)}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>SKU</th>
        <th>Item</th>
        <th>Size</th>
        <th>Colour</th>
        <th class="r">Qty</th>
      </tr>
    </thead>
    <tbody>${linesHtml}</tbody>
  </table>

  <div class="sources">Source orders: ${sourceOrderIds.map(esc).join(', ')}</div>

  <div class="sig">
    <span>Coordinator: <strong>${esc(coordinator.name)}</strong></span>
    <span>Issued: ${esc(issuedDate)}</span>
  </div>

  <div class="footer">2990&apos;s — Same price. Every piece. Always.</div>
</body>
</html>`;
}
```

- [ ] **Step 4: Run test → PASS**

Run: `pnpm --filter @2990s/api test po.test`
Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/lib/po.ts apps/api/src/lib/po.test.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): PO helpers — line item shape validation + print template HTML — Suppliers+PO"
```

---

### Task 1.2: Create `routes/purchase-orders.ts` with POST + GET + GET /print

**Files:**
- Create: `apps/api/src/routes/purchase-orders.ts`

- [ ] **Step 1: Read current `routes/orders.ts` to mirror auth + middleware patterns**

Run: `Read apps/api/src/routes/orders.ts`. Note:
1. How auth is loaded (`loadStaffRole(c)`)
2. How `COORDINATOR_ROLES` is defined / imported
3. How Supabase client is obtained (`c.get('supabase')`)
4. How staff id is obtained (`c.get('user').id`)
5. The Hono router export pattern

- [ ] **Step 2: Implement purchase-orders.ts**

Create `apps/api/src/routes/purchase-orders.ts`:

```typescript
import { Hono } from 'hono';
import type { Env } from '../env';
import { loadStaffRole, COORDINATOR_ROLES } from '../middleware/auth';
import { validatePoLineItemsShape, renderPoPrintHtml, type PoLineItem } from '../lib/po';

export const purchaseOrders = new Hono<Env>();

// POST /purchase-orders — create a PO from line items
purchaseOrders.post('/', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const staffId = c.get('user').id;
  const supabase = c.get('supabase');

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const supplierId = body?.supplier_id;
  const lineItems = body?.line_items;

  if (typeof supplierId !== 'string' || supplierId.length === 0) {
    return c.json({ error: 'missing_supplier_id' }, 400);
  }

  // Step 1 — shape validation (pure)
  const shapeRes = validatePoLineItemsShape(lineItems);
  if (!shapeRes.ok) {
    return c.json({ error: shapeRes.error }, 400);
  }
  const items = lineItems as PoLineItem[];

  // Step 2 — verify supplier exists
  const { data: sup, error: supErr } = await supabase
    .from('suppliers')
    .select('id, code, name, whatsapp_number, email')
    .eq('id', supplierId)
    .maybeSingle();
  if (supErr) return c.json({ error: 'db_fetch_failed', detail: supErr.message }, 500);
  if (!sup) return c.json({ error: 'supplier_not_found' }, 400);

  // Step 3 — verify all referenced orders exist + are in logistics + !po_issued
  const orderIds = Array.from(new Set(items.map((i) => i.order_id)));
  const { data: orderRows, error: orderErr } = await supabase
    .from('orders')
    .select('id, lane, po_issued')
    .in('id', orderIds);
  if (orderErr) return c.json({ error: 'db_fetch_failed', detail: orderErr.message }, 500);

  const foundIds = new Set((orderRows ?? []).map((r) => r.id));
  const missingIds = orderIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    return c.json({ error: 'orders_not_found', detail: missingIds }, 400);
  }
  const notInLogistics = (orderRows ?? []).filter((r) => r.lane !== 'logistics').map((r) => r.id);
  if (notInLogistics.length > 0) {
    return c.json({ error: 'order_not_in_logistics', detail: notInLogistics }, 400);
  }
  const alreadyIssued = (orderRows ?? []).filter((r) => r.po_issued).map((r) => r.id);
  if (alreadyIssued.length > 0) {
    return c.json({ error: 'already_issued', detail: alreadyIssued }, 409);
  }

  // Step 4 — insert PO header
  const { data: poRow, error: poErr } = await supabase
    .from('purchase_orders')
    .insert({ supplier_id: supplierId, created_by: staffId })
    .select('id, po_number, supplier_id, created_at, created_by')
    .maybeSingle();
  if (poErr) return c.json({ error: 'db_insert_failed', detail: poErr.message }, 500);
  if (!poRow) return c.json({ error: 'db_insert_returned_null' }, 500);

  // Step 5 — insert PO lines
  const lineRows = items.map((it) => ({
    purchase_order_id: poRow.id,
    order_id: it.order_id,
    sku: it.sku,
    name: it.name,
    size: it.size,
    colour: it.colour,
    qty: it.qty,
  }));
  const { data: insertedLines, error: linesErr } = await supabase
    .from('purchase_order_lines')
    .insert(lineRows)
    .select('id, purchase_order_id, order_id, sku, name, size, colour, qty');
  if (linesErr) {
    // Roll back the PO header by best-effort delete
    await supabase.from('purchase_orders').delete().eq('id', poRow.id);
    return c.json({ error: 'db_insert_lines_failed', detail: linesErr.message }, 500);
  }

  // Step 6 — flip po_issued on referenced orders (cached flag)
  const { error: flagErr } = await supabase
    .from('orders')
    .update({
      po_issued: true,
      po_issued_at: new Date().toISOString(),
      po_issued_by: staffId,
    })
    .in('id', orderIds);
  if (flagErr) {
    // Best-effort cleanup; flag will be inconsistent but PO + lines exist
    return c.json({ error: 'db_flag_update_failed', detail: flagErr.message }, 500);
  }

  // Step 7 — fetch coordinator name for response (can be derived later but cheaper now)
  const { data: coord } = await supabase.from('staff').select('id, name').eq('id', staffId).maybeSingle();

  return c.json({
    id: poRow.id,
    po_number: poRow.po_number,
    supplier: sup,
    created_at: poRow.created_at,
    created_by: { id: staffId, name: coord?.name ?? 'Unknown' },
    lines: insertedLines ?? [],
    referenced_order_ids: orderIds,
  }, 201);
});

// GET /purchase-orders/:id — fetch full PO
purchaseOrders.get('/:id', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const poId = c.req.param('id');
  const supabase = c.get('supabase');

  const { data: po, error: poErr } = await supabase
    .from('purchase_orders')
    .select('id, po_number, supplier_id, created_at, created_by')
    .eq('id', poId)
    .maybeSingle();
  if (poErr) return c.json({ error: 'db_fetch_failed', detail: poErr.message }, 500);
  if (!po) return c.json({ error: 'not_found' }, 404);

  const [{ data: sup }, { data: lines }, { data: coord }] = await Promise.all([
    supabase.from('suppliers').select('id, code, name, whatsapp_number, email').eq('id', po.supplier_id).maybeSingle(),
    supabase.from('purchase_order_lines').select('id, purchase_order_id, order_id, sku, name, size, colour, qty').eq('purchase_order_id', poId),
    supabase.from('staff').select('id, name').eq('id', po.created_by).maybeSingle(),
  ]);

  const referencedOrderIds = Array.from(new Set((lines ?? []).map((l) => l.order_id)));

  return c.json({
    id: po.id,
    po_number: po.po_number,
    supplier: sup ?? null,
    created_at: po.created_at,
    created_by: coord ?? { id: po.created_by, name: 'Unknown' },
    lines: lines ?? [],
    referenced_order_ids: referencedOrderIds,
  });
});

// GET /purchase-orders/:id/print — text/html for browser print-to-PDF
purchaseOrders.get('/:id/print', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.text('Not authorized', 403);
  }

  const poId = c.req.param('id');
  const supabase = c.get('supabase');

  const { data: po, error: poErr } = await supabase
    .from('purchase_orders')
    .select('id, po_number, supplier_id, created_at, created_by')
    .eq('id', poId)
    .maybeSingle();
  if (poErr) return c.text('DB error', 500);
  if (!po) return c.text('Not found', 404);

  const [{ data: sup }, { data: lines }, { data: coord }] = await Promise.all([
    supabase.from('suppliers').select('code, name, whatsapp_number, email').eq('id', po.supplier_id).maybeSingle(),
    supabase.from('purchase_order_lines').select('order_id, sku, name, size, colour, qty').eq('purchase_order_id', poId),
    supabase.from('staff').select('name').eq('id', po.created_by).maybeSingle(),
  ]);

  // For showroom, hardcode the warehouse address until showrooms.address ships;
  // single-showroom MVP per CLAUDE.md.
  const showroom = { name: 'Showroom KL', address: 'Warehouse address — to be confirmed' };

  const sourceOrderIds = Array.from(new Set((lines ?? []).map((l) => l.order_id)));

  const html = renderPoPrintHtml({
    po: { id: po.id, po_number: po.po_number, created_at: po.created_at },
    supplier: sup ?? { code: '?', name: 'Unknown supplier', whatsapp_number: null, email: null },
    lines: (lines ?? []).map((l) => ({ sku: l.sku, name: l.name, size: l.size, colour: l.colour, qty: l.qty })),
    coordinator: { name: coord?.name ?? 'Unknown' },
    sourceOrderIds,
    showroom,
  });

  return c.body(html, 200, { 'content-type': 'text/html; charset=utf-8' });
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/routes/purchase-orders.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): purchase-orders route — POST + GET + GET /print — Suppliers+PO"
```

---

### Task 1.3: Modify lane PATCH gate + register route

**Files:**
- Modify: `apps/api/src/routes/orders.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Read lane PATCH handler in `routes/orders.ts`**

Find the `orders.patch('/:id/lane', ...)` handler. Locate the gate validation block (after the `isValidLaneTransition` check from Sub-project C).

- [ ] **Step 2: Add `logistics → ready` PO gate**

Inside the gate validation block, BEFORE the existing `dispatched` and `delivered` gates from Sub-project C, add:

```typescript
  // Sub-project D gate: logistics → ready requires po_issued
  if (isForward && lane === 'ready' && row.lane === 'logistics' && !row.po_issued) {
    return c.json({ error: 'po_required', message: 'Issue PO via Scan first' }, 400);
  }
```

Also extend the `.select(...)` clause used to fetch the order earlier in the handler — ensure `po_issued` is included in the column list:

```typescript
  const { data: row, error: fetchErr } = await supabase
    .from('orders')
    .select('lane, driver_id, confirmed_delivery_date, do_key, dispatched_at, delivered_at, po_issued')
    .eq('id', orderId)
    .maybeSingle();
```

(Add `po_issued` to the existing select string.)

- [ ] **Step 3: Register `/purchase-orders` route in `index.ts`**

Read `apps/api/src/index.ts`. Find where existing routes are registered (e.g. `app.route('/orders', orders);`). Add the import and registration:

At the top with other route imports:
```typescript
import { purchaseOrders } from './routes/purchase-orders';
```

Where other routes are mounted:
```typescript
app.route('/purchase-orders', purchaseOrders);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/routes/orders.ts apps/api/src/index.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): lane PATCH gate logistics→ready requires po_issued + register /purchase-orders route — Suppliers+PO"
```

---

### Task 1.4: Integration tests for purchase-orders route + lane gate

**Files:**
- Create: `apps/api/src/routes/purchase-orders.test.ts`

- [ ] **Step 1: Read existing test patterns**

Run: `Read apps/api/src/routes/slips.test.ts` to understand:
1. How tests bootstrap a Hono app instance with mocked Supabase
2. How auth is faked
3. How a request is invoked

Mirror those patterns. If there's no centralized fixture, follow the inline-mock pattern.

- [ ] **Step 2: Write tests**

Create `apps/api/src/routes/purchase-orders.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { purchaseOrders } from './purchase-orders';

// Helper to create a mocked Supabase client. Each test sets which queries return what.
function createMockSupabase(handlers: Record<string, (op: any) => any>) {
  return {
    from(table: string) {
      const builder: any = {
        _table: table,
        _op: { kind: 'select', table },
        select(cols: string) { this._op = { ...this._op, kind: 'select', cols }; return this; },
        insert(row: any) { this._op = { ...this._op, kind: 'insert', row }; return this; },
        update(row: any) { this._op = { ...this._op, kind: 'update', row }; return this; },
        delete() { this._op = { ...this._op, kind: 'delete' }; return this; },
        eq(col: string, val: any) { this._op = { ...this._op, eq: { col, val } }; return this; },
        in(col: string, vals: any[]) { this._op = { ...this._op, in: { col, vals } }; return this; },
        maybeSingle() { return Promise.resolve(handlers[table]?.(this._op) ?? { data: null, error: null }); },
        then(resolve: any) { return Promise.resolve(handlers[table]?.(this._op) ?? { data: [], error: null }).then(resolve); },
      };
      return builder;
    },
  };
}

function buildApp(opts: {
  role?: string;
  staffId?: string;
  supabase: any;
}) {
  const app = new Hono();
  // Inject the test middleware setup
  app.use('*', async (c, next) => {
    c.set('user', { id: opts.staffId ?? 'staff-001' });
    c.set('supabase', opts.supabase);
    c.set('staffRole', opts.role ?? 'coordinator');
    await next();
  });
  app.route('/purchase-orders', purchaseOrders);
  return app;
}

// Mock the auth helper. In real code loadStaffRole reads from Supabase; here we shortcut.
vi.mock('../middleware/auth', () => ({
  loadStaffRole: async (c: any) => c.get('staffRole'),
  COORDINATOR_ROLES: new Set(['coordinator', 'finance', 'owner']),
}));

const supplierRow = { id: 'sup-slp', code: 'SLP', name: 'Sleepworks Sdn Bhd', whatsapp_number: null, email: null };

describe('POST /purchase-orders', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects without coordinator role', async () => {
    const app = buildApp({ role: 'sales', supabase: createMockSupabase({}) });
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ supplier_id: 'sup-slp', line_items: [] }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('not_authorized_role');
  });

  it('rejects empty line_items', async () => {
    const app = buildApp({ supabase: createMockSupabase({}) });
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ supplier_id: 'sup-slp', line_items: [] }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('empty_line_items');
  });

  it('rejects qty <= 0', async () => {
    const app = buildApp({ supabase: createMockSupabase({}) });
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplier_id: 'sup-slp',
        line_items: [{ order_id: 'o1', sku: 'X', name: 'X', size: null, colour: null, qty: 0 }],
      }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_qty');
  });

  it('rejects when supplier not found', async () => {
    const app = buildApp({
      supabase: createMockSupabase({
        suppliers: () => ({ data: null, error: null }),
      }),
    });
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplier_id: 'sup-x',
        line_items: [{ order_id: 'o1', sku: 'X', name: 'X', size: null, colour: null, qty: 1 }],
      }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('supplier_not_found');
  });

  it('rejects when order is not in logistics lane', async () => {
    const app = buildApp({
      supabase: createMockSupabase({
        suppliers: () => ({ data: supplierRow, error: null }),
        orders: (op: any) => {
          if (op.kind === 'select') return { data: [{ id: 'o1', lane: 'received', po_issued: false }], error: null };
          return { data: null, error: null };
        },
      }),
    });
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplier_id: 'sup-slp',
        line_items: [{ order_id: 'o1', sku: 'X', name: 'X', size: null, colour: null, qty: 1 }],
      }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('order_not_in_logistics');
    expect(json.detail).toEqual(['o1']);
  });

  it('rejects when order is already PO-issued', async () => {
    const app = buildApp({
      supabase: createMockSupabase({
        suppliers: () => ({ data: supplierRow, error: null }),
        orders: (op: any) => {
          if (op.kind === 'select') return { data: [{ id: 'o1', lane: 'logistics', po_issued: true }], error: null };
          return { data: null, error: null };
        },
      }),
    });
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplier_id: 'sup-slp',
        line_items: [{ order_id: 'o1', sku: 'X', name: 'X', size: null, colour: null, qty: 1 }],
      }),
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('already_issued');
    expect(json.detail).toEqual(['o1']);
  });

  it('happy path: creates PO + lines + flips po_issued', async () => {
    let inserted = { po: null as any, lines: null as any, flagUpdate: null as any };
    const app = buildApp({
      supabase: createMockSupabase({
        suppliers: () => ({ data: supplierRow, error: null }),
        orders: (op: any) => {
          if (op.kind === 'select') return { data: [{ id: 'o1', lane: 'logistics', po_issued: false }], error: null };
          if (op.kind === 'update') { inserted.flagUpdate = op.row; return { data: null, error: null }; }
          return { data: null, error: null };
        },
        purchase_orders: (op: any) => {
          if (op.kind === 'insert') {
            inserted.po = op.row;
            return { data: { id: 'po-1', po_number: 'PO-2026-0001', supplier_id: 'sup-slp', created_at: '2026-05-09T08:30:00Z', created_by: 'staff-001' }, error: null };
          }
          return { data: null, error: null };
        },
        purchase_order_lines: (op: any) => {
          if (op.kind === 'insert') {
            inserted.lines = op.row;
            return { data: [{ id: 'line-1', purchase_order_id: 'po-1', order_id: 'o1', sku: 'X', name: 'X', size: null, colour: null, qty: 1 }], error: null };
          }
          return { data: [], error: null };
        },
        staff: () => ({ data: { id: 'staff-001', name: 'Test Coordinator' }, error: null }),
      }),
    });
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplier_id: 'sup-slp',
        line_items: [{ order_id: 'o1', sku: 'X', name: 'X', size: null, colour: null, qty: 1 }],
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.po_number).toBe('PO-2026-0001');
    expect(json.supplier.code).toBe('SLP');
    expect(json.referenced_order_ids).toEqual(['o1']);
    expect(inserted.flagUpdate.po_issued).toBe(true);
  });
});

describe('GET /purchase-orders/:id', () => {
  it('returns 404 when PO not found', async () => {
    const app = buildApp({
      supabase: createMockSupabase({ purchase_orders: () => ({ data: null, error: null }) }),
    });
    const res = await app.request('/purchase-orders/po-x');
    expect(res.status).toBe(404);
  });

  it('returns full PO + supplier + lines on 200', async () => {
    const app = buildApp({
      supabase: createMockSupabase({
        purchase_orders: () => ({
          data: { id: 'po-1', po_number: 'PO-2026-0001', supplier_id: 'sup-slp', created_at: '2026-05-09T08:30:00Z', created_by: 'staff-001' },
          error: null,
        }),
        suppliers: () => ({ data: supplierRow, error: null }),
        purchase_order_lines: () => ({ data: [{ id: 'line-1', purchase_order_id: 'po-1', order_id: 'o1', sku: 'X', name: 'X', size: null, colour: null, qty: 1 }], error: null }),
        staff: () => ({ data: { id: 'staff-001', name: 'Test Coordinator' }, error: null }),
      }),
    });
    const res = await app.request('/purchase-orders/po-1');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.po_number).toBe('PO-2026-0001');
    expect(json.lines).toHaveLength(1);
    expect(json.referenced_order_ids).toEqual(['o1']);
  });
});

describe('GET /purchase-orders/:id/print', () => {
  it('returns text/html with PO number visible', async () => {
    const app = buildApp({
      supabase: createMockSupabase({
        purchase_orders: () => ({
          data: { id: 'po-1', po_number: 'PO-2026-0001', supplier_id: 'sup-slp', created_at: '2026-05-09T08:30:00Z', created_by: 'staff-001' },
          error: null,
        }),
        suppliers: () => ({ data: supplierRow, error: null }),
        purchase_order_lines: () => ({ data: [{ order_id: 'o1', sku: 'MAT-001', name: 'Cloud mattress', size: 'queen', colour: null, qty: 2 }], error: null }),
        staff: () => ({ data: { name: 'Test Coordinator' }, error: null }),
      }),
    });
    const res = await app.request('/purchase-orders/po-1/print');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('PO-2026-0001');
    expect(html).toContain('Sleepworks Sdn Bhd');
    expect(html).toContain('MAT-001');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @2990s/api test purchase-orders.test`
Expected: all 9+ tests pass.

- [ ] **Step 4: Run all api tests to ensure nothing else broke**

Run: `pnpm --filter @2990s/api test`
Expected: all pass (existing C tests + new D tests).

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/routes/purchase-orders.test.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "test(api): purchase-orders integration tests — POST + GET + GET /print — Suppliers+PO"
```

---

## Phase 2 — Backend lib + queries

### Task 2.1: Extend OrderDetail + add useSuppliers / usePurchaseOrders hooks

**Files:**
- Modify: `apps/backend/src/lib/queries.ts`

- [ ] **Step 1: Read current queries.ts**

Find:
1. `OrderDetail` interface
2. `useOrderDetail` query function (its `.select(...)` clause and return mapping)
3. The end of the file (where to append new hooks)

- [ ] **Step 2: Extend OrderDetail interface with PO fields**

Find `export interface OrderDetail {` and add to the interface body:

```typescript
  poIssued: boolean;
  poIssuedAt: string | null;     // ISO timestamp or null
  poIssuedBy: string | null;     // staff id or null
```

- [ ] **Step 3: Extend select clause + mapping in `useOrderDetail`**

Find the `useOrderDetail` query. In the `.select(...)` argument string, append:
```
', po_issued, po_issued_at, po_issued_by'
```

(So if existing was `'driver_id, confirmed_delivery_date, ...'` it becomes `'driver_id, confirmed_delivery_date, ..., po_issued, po_issued_at, po_issued_by'`.)

In the return mapping, add:
```typescript
        poIssued: r.po_issued,
        poIssuedAt: r.po_issued_at,
        poIssuedBy: r.po_issued_by,
```

- [ ] **Step 4: Add Supplier + PurchaseOrder types**

Append near the top of the file (with other type exports):

```typescript
export interface Supplier {
  id: string;
  code: string;
  name: string;
  whatsappNumber: string | null;
  email: string | null;
}

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  orderId: string;
  sku: string;
  name: string;
  size: string | null;
  colour: string | null;
  qty: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplier: Supplier;
  createdAt: string;
  createdBy: { id: string; name: string };
  lines: PurchaseOrderLine[];
  referencedOrderIds: string[];
}
```

- [ ] **Step 5: Add useSuppliers hook**

Append to queries.ts (near useDrivers):

```typescript
export const useSuppliers = () =>
  useQuery({
    queryKey: ['suppliers'],
    queryFn: async (): Promise<Supplier[]> => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, code, name, whatsapp_number, email')
        .order('code');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        whatsappNumber: r.whatsapp_number,
        email: r.email,
      }));
    },
    staleTime: 60_000,
  });
```

- [ ] **Step 6: Add usePurchaseOrders hook (returns POs that reference an order, for drawer)**

Append:

```typescript
export const usePurchaseOrders = (orderId: string | null) =>
  useQuery({
    queryKey: ['purchase-orders', 'by-order', orderId],
    enabled: !!orderId,
    queryFn: async (): Promise<{ id: string; poNumber: string; createdAt: string }[]> => {
      if (!orderId) return [];
      // Fetch via purchase_order_lines → purchase_orders join
      const { data, error } = await supabase
        .from('purchase_order_lines')
        .select('purchase_orders ( id, po_number, created_at )')
        .eq('order_id', orderId);
      if (error) throw error;
      const seen = new Set<string>();
      const result: { id: string; poNumber: string; createdAt: string }[] = [];
      for (const row of data ?? []) {
        const po = (row as any).purchase_orders;
        if (po && !seen.has(po.id)) {
          seen.add(po.id);
          result.push({ id: po.id, poNumber: po.po_number, createdAt: po.created_at });
        }
      }
      return result;
    },
    staleTime: 30_000,
  });
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/lib/queries.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): extend OrderDetail with po fields + useSuppliers + usePurchaseOrders hooks — Suppliers+PO"
```

---

### Task 2.2: Create `lib/purchase-orders.ts` client lib

**Files:**
- Create: `apps/backend/src/lib/purchase-orders.ts`

- [ ] **Step 1: Implement client lib**

Create `apps/backend/src/lib/purchase-orders.ts`:

```typescript
import { supabase } from './supabase';
import type { PurchaseOrder } from './queries';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return token;
}

export interface CreatePoInput {
  supplierId: string;
  lineItems: {
    orderId: string;
    sku: string;
    name: string;
    size: string | null;
    colour: string | null;
    qty: number;
  }[];
}

export async function createPO(input: CreatePoInput): Promise<PurchaseOrder> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await getToken();
  const body = {
    supplier_id: input.supplierId,
    line_items: input.lineItems.map((it) => ({
      order_id: it.orderId,
      sku: it.sku,
      name: it.name,
      size: it.size,
      colour: it.colour,
      qty: it.qty,
    })),
  };
  const res = await fetch(`${API_URL}/purchase-orders`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`createPO failed (${res.status}): ${text}`);
  }
  const json: any = await res.json();
  return {
    id: json.id,
    poNumber: json.po_number,
    supplier: {
      id: json.supplier.id,
      code: json.supplier.code,
      name: json.supplier.name,
      whatsappNumber: json.supplier.whatsapp_number,
      email: json.supplier.email,
    },
    createdAt: json.created_at,
    createdBy: { id: json.created_by.id, name: json.created_by.name },
    lines: (json.lines ?? []).map((l: any) => ({
      id: l.id,
      purchaseOrderId: l.purchase_order_id,
      orderId: l.order_id,
      sku: l.sku,
      name: l.name,
      size: l.size,
      colour: l.colour,
      qty: l.qty,
    })),
    referencedOrderIds: json.referenced_order_ids ?? [],
  };
}

/** URL of the printable HTML view. Caller passes this to window.open. */
export function getPrintUrl(poId: string): string {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  return `${API_URL}/purchase-orders/${encodeURIComponent(poId)}/print`;
}

/** Open the print view in a new tab. Returns the WindowProxy or null if blocked by popup blocker. */
export function openPrintWindow(poId: string): Window | null {
  return window.open(getPrintUrl(poId), '_blank');
}

/** Build a wa.me share URL with a pre-filled greeting. Coordinator manually attaches the PDF. */
export function buildWhatsAppShareUrl(supplierName: string, whatsappNumber: string, poNumber: string): string {
  const cleanedNumber = whatsappNumber.replace(/[^\d]/g, '');
  const text = encodeURIComponent(
    `Hi ${supplierName}, here is our purchase order ${poNumber}. Please confirm receipt and expected delivery. Thanks — 2990's`
  );
  return `https://wa.me/${cleanedNumber}?text=${text}`;
}

/** Build a mailto: link with pre-filled subject + body. */
export function buildMailtoUrl(email: string, supplierName: string, poNumber: string): string {
  const subject = encodeURIComponent(`Purchase Order ${poNumber} from 2990's`);
  const body = encodeURIComponent(
    `Hi ${supplierName},\n\nPlease find our purchase order ${poNumber} attached. Please confirm receipt and expected delivery date.\n\nThanks,\n2990's`
  );
  return `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/lib/purchase-orders.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): purchase-orders client lib — createPO + print URL + wa.me + mailto helpers — Suppliers+PO"
```

---

## Phase 3 — Backend components

### Task 3.1: PoScanModal component

**Files:**
- Create: `apps/backend/src/components/PoScanModal.tsx`
- Create: `apps/backend/src/components/PoScanModal.module.css`

- [ ] **Step 1: Implement PoScanModal.tsx**

Create `apps/backend/src/components/PoScanModal.tsx`:

```typescript
import { useEffect, useMemo, useState } from 'react';
import { useSuppliers, type Supplier } from '../lib/queries';
import {
  createPO,
  openPrintWindow,
  buildWhatsAppShareUrl,
  buildMailtoUrl,
  type CreatePoInput,
} from '../lib/purchase-orders';
import styles from './PoScanModal.module.css';

interface OrderForScan {
  id: string;            // SO-9008
  customerName: string;
  cart: CartItem[];      // shape depends on existing OrderListItem; adapt as needed
}

interface CartItem {
  productId: string;
  productName: string;
  productCat: string;    // mattress | sofa | bedframe | dining | bathroom | kids | accessory
  supplierId: string | null;  // joined from products table; null falls to "uncategorized"
  sku: string;
  size: string | null;
  colour: string | null;
  qty: number;
}

interface RollupLine {
  sku: string;
  name: string;
  size: string | null;
  colour: string | null;
  qty: number;
  orderIds: Set<string>;
}

interface SupplierGroup {
  supplier: Supplier;
  items: Map<string, RollupLine>;  // dedup key: sku|colour
}

interface PostIssueState {
  poNumber: string;
  poId: string;
  lineCount: number;
  sourceOrderCount: number;
}

interface Props {
  orders: OrderForScan[];
  onClose: () => void;
  onIssued?: (orderIds: string[]) => void;  // notify parent so it refreshes lane
}

export function PoScanModal({ orders, onClose, onIssued }: Props) {
  const suppliersQuery = useSuppliers();
  const suppliersById = useMemo(() => {
    const map = new Map<string, Supplier>();
    (suppliersQuery.data ?? []).forEach((s) => map.set(s.id, s));
    return map;
  }, [suppliersQuery.data]);

  // Per-supplier post-issue state — set after a successful Generate PO call
  const [postIssue, setPostIssue] = useState<Record<string, PostIssueState>>({});
  const [loadingSupplier, setLoadingSupplier] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [view, setView] = useState<'rollup' | 'by-order'>('rollup');

  // Compute rollup-by-supplier (port of prototype's buildPoLines + aggregation logic)
  const rollup = useMemo<SupplierGroup[]>(() => {
    const map = new Map<string, SupplierGroup>();
    for (const order of orders) {
      for (const item of order.cart) {
        if (!item.supplierId) continue;
        const supplier = suppliersById.get(item.supplierId);
        if (!supplier) continue;
        let group = map.get(supplier.id);
        if (!group) {
          group = { supplier, items: new Map() };
          map.set(supplier.id, group);
        }
        const dedupKey = `${item.sku}|${item.colour ?? ''}`;
        const existing = group.items.get(dedupKey);
        if (existing) {
          existing.qty += item.qty;
          existing.orderIds.add(order.id);
        } else {
          group.items.set(dedupKey, {
            sku: item.sku,
            name: item.productName,
            size: item.size,
            colour: item.colour,
            qty: item.qty,
            orderIds: new Set([order.id]),
          });
        }
      }
    }
    return Array.from(map.values());
  }, [orders, suppliersById]);

  const stats = useMemo(() => {
    const supplierCount = rollup.length;
    let totalSkus = 0;
    let totalUnits = 0;
    for (const g of rollup) {
      totalSkus += g.items.size;
      for (const item of g.items.values()) totalUnits += item.qty;
    }
    return { orderCount: orders.length, totalSkus, totalUnits, supplierCount };
  }, [rollup, orders.length]);

  const handleGenerate = async (group: SupplierGroup) => {
    setLoadingSupplier(group.supplier.id);
    setErrors((e) => ({ ...e, [group.supplier.id]: '' }));
    try {
      const lineItems: CreatePoInput['lineItems'] = [];
      const sourceOrderIds = new Set<string>();
      for (const item of group.items.values()) {
        // For each rollup line, emit one line_item per source order_id
        for (const orderId of item.orderIds) {
          // Find the original cart item to get the per-order qty (instead of summed)
          const order = orders.find((o) => o.id === orderId);
          const cartItem = order?.cart.find(
            (c) => c.sku === item.sku && (c.colour ?? '') === (item.colour ?? ''),
          );
          if (!cartItem) continue;
          lineItems.push({
            orderId,
            sku: cartItem.sku,
            name: cartItem.productName,
            size: cartItem.size,
            colour: cartItem.colour,
            qty: cartItem.qty,
          });
          sourceOrderIds.add(orderId);
        }
      }

      const po = await createPO({ supplierId: group.supplier.id, lineItems });
      setPostIssue((prev) => ({
        ...prev,
        [group.supplier.id]: {
          poNumber: po.poNumber,
          poId: po.id,
          lineCount: lineItems.length,
          sourceOrderCount: sourceOrderIds.size,
        },
      }));
      // Open print view in new tab immediately
      const win = openPrintWindow(po.id);
      if (!win) {
        setErrors((e) => ({
          ...e,
          [group.supplier.id]: 'Print window blocked. Click "Open print view" below.',
        }));
      }
      onIssued?.(Array.from(sourceOrderIds));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generate PO failed';
      setErrors((e) => ({ ...e, [group.supplier.id]: msg }));
    } finally {
      setLoadingSupplier(null);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.modal} onClick={handleBackdropClick}>
      <div className={styles.panel}>
        <div className={styles.head}>
          <div>
            <span className={styles.eyebrow}>Awaiting logistics · PO scan</span>
            <h2 className={styles.title}>Issue Purchase Orders</h2>
            <div className={styles.sub}>
              {stats.orderCount} orders · {stats.totalSkus} unique SKUs · {stats.totalUnits} units · {stats.supplierCount} suppliers
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${view === 'rollup' ? styles.tabActive : ''}`}
            onClick={() => setView('rollup')}
          >
            Roll-up by supplier
          </button>
          <button
            className={`${styles.tab} ${view === 'by-order' ? styles.tabActive : ''}`}
            onClick={() => setView('by-order')}
          >
            Detail by order
          </button>
        </div>

        <div className={styles.body}>
          {suppliersQuery.isLoading && <div className={styles.muted}>Loading suppliers…</div>}

          {!suppliersQuery.isLoading && view === 'rollup' && rollup.length === 0 && (
            <div className={styles.empty}>
              All POs already issued — nothing to scan.
            </div>
          )}

          {!suppliersQuery.isLoading && view === 'rollup' && rollup.map((group) => {
            const issued = postIssue[group.supplier.id];
            const error = errors[group.supplier.id];
            const loading = loadingSupplier === group.supplier.id;
            return (
              <div key={group.supplier.id} className={styles.supplier}>
                <div className={styles.supplierHead}>
                  <div className={styles.supplierName}>
                    <span className={styles.supplierCode}>{group.supplier.code}</span>
                    {group.supplier.name}
                  </div>
                  {!issued && (
                    <button
                      className={styles.generateBtn}
                      onClick={() => handleGenerate(group)}
                      disabled={loading}
                    >
                      {loading ? 'Generating…' : 'Generate PO'}
                    </button>
                  )}
                </div>

                {issued && (
                  <div className={styles.issued}>
                    <div className={styles.issuedRow}>
                      <strong>{issued.poNumber}</strong> issued · {issued.lineCount} items · {issued.sourceOrderCount} source order{issued.sourceOrderCount !== 1 ? 's' : ''}
                    </div>
                    <div className={styles.issuedActions}>
                      <button
                        className={styles.actionBtn}
                        onClick={() => openPrintWindow(issued.poId)}
                      >
                        Open print view
                      </button>
                      {group.supplier.whatsappNumber && (
                        <a
                          className={styles.actionBtn}
                          href={buildWhatsAppShareUrl(group.supplier.name, group.supplier.whatsappNumber, issued.poNumber)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          WhatsApp
                        </a>
                      )}
                      {group.supplier.email && (
                        <a
                          className={styles.actionBtn}
                          href={buildMailtoUrl(group.supplier.email, group.supplier.name, issued.poNumber)}
                        >
                          Email
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {error && <p className={styles.error}>{error}</p>}

                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Item</th>
                      <th>Size</th>
                      <th>Colour</th>
                      <th className={styles.colRight}>Qty</th>
                      <th>From orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(group.items.values()).map((it) => (
                      <tr key={it.sku + '|' + (it.colour ?? '')}>
                        <td><code>{it.sku}</code></td>
                        <td>{it.name}</td>
                        <td>{it.size ?? '—'}</td>
                        <td>{it.colour ?? '—'}</td>
                        <td className={styles.colRight}><strong>×{it.qty}</strong></td>
                        <td>
                          <span className={styles.orderPills}>
                            {Array.from(it.orderIds).slice(0, 2).map((id) => (
                              <span key={id} className={styles.orderPill}>{id}</span>
                            ))}
                            {it.orderIds.size > 2 && (
                              <span className={styles.orderPill}>+{it.orderIds.size - 2}</span>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

          {!suppliersQuery.isLoading && view === 'by-order' && orders.length === 0 && (
            <div className={styles.empty}>
              No orders awaiting PO scan.
            </div>
          )}

          {!suppliersQuery.isLoading && view === 'by-order' && orders.map((order) => (
            <div key={order.id} className={styles.orderBlock}>
              <div className={styles.orderHead}>
                <span className={styles.orderId}>{order.id}</span>
                <span>{order.customerName}</span>
              </div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Item</th>
                    <th>Supplier</th>
                    <th>Size</th>
                    <th>Colour</th>
                    <th className={styles.colRight}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {order.cart.map((it, idx) => {
                    const sup = it.supplierId ? suppliersById.get(it.supplierId) : null;
                    return (
                      <tr key={idx}>
                        <td><code>{it.sku}</code></td>
                        <td>{it.productName}</td>
                        <td>{sup ? `${sup.code} · ${sup.name}` : '—'}</td>
                        <td>{it.size ?? '—'}</td>
                        <td>{it.colour ?? '—'}</td>
                        <td className={styles.colRight}>×{it.qty}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create CSS module**

Create `apps/backend/src/components/PoScanModal.module.css`:

```css
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 60px 20px;
  z-index: 1000;
}
.panel {
  background: white;
  width: 100%;
  max-width: 980px;
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 20px 24px;
  border-bottom: 1px solid var(--c-line);
  gap: 16px;
}
.eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--c-burnt, #B87800);
}
.title { margin: 4px 0 6px; font-size: 22px; font-weight: 600; color: var(--c-ink); }
.sub { font-size: 13px; color: var(--fg-muted); }
.closeBtn {
  background: transparent;
  border: 0;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
  color: var(--fg-muted);
  padding: 4px 12px;
}
.tabs { display: flex; padding: 0 24px; border-bottom: 1px solid var(--c-line); gap: 16px; }
.tab {
  background: transparent;
  border: 0;
  padding: 12px 0;
  font: inherit;
  color: var(--fg-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tabActive { color: var(--c-ink); border-bottom-color: var(--c-ink); font-weight: 600; }
.body { overflow-y: auto; padding: 16px 24px 24px; flex: 1; }
.muted { color: var(--fg-muted); padding: 24px; text-align: center; }
.empty {
  padding: 48px 24px;
  text-align: center;
  color: var(--fg-muted);
  background: var(--c-cream);
  border-radius: 6px;
  margin-top: 16px;
}
.supplier {
  border: 1px solid var(--c-line);
  border-radius: 6px;
  margin-bottom: 16px;
  overflow: hidden;
}
.supplierHead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--c-cream);
  border-bottom: 1px solid var(--c-line);
}
.supplierName { font-size: 15px; font-weight: 600; color: var(--c-ink); display: flex; align-items: center; gap: 12px; }
.supplierCode {
  font: 11px/1 ui-monospace, monospace;
  background: white;
  padding: 4px 8px;
  border-radius: 3px;
  border: 1px solid var(--c-line);
  letter-spacing: 0.04em;
}
.generateBtn {
  background: var(--c-ink);
  color: white;
  border: 0;
  padding: 8px 16px;
  border-radius: 4px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.generateBtn:disabled { opacity: 0.6; cursor: not-allowed; }
.issued {
  padding: 12px 16px;
  background: rgba(47, 93, 79, 0.05);
  border-bottom: 1px solid var(--c-line);
}
.issuedRow { font-size: 14px; color: var(--c-ink); margin-bottom: 8px; }
.issuedActions { display: flex; gap: 8px; flex-wrap: wrap; }
.actionBtn {
  background: white;
  border: 1px solid var(--c-line);
  padding: 6px 14px;
  border-radius: 4px;
  font: inherit;
  font-size: 12px;
  color: var(--c-ink);
  cursor: pointer;
  text-decoration: none;
  display: inline-block;
}
.actionBtn:hover { border-color: var(--c-ink); }
.error { color: #B33; padding: 8px 16px; margin: 0; font-size: 13px; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th, .table td {
  padding: 8px 12px;
  text-align: left;
  border-top: 1px solid var(--c-line);
}
.table th {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-muted);
  background: white;
}
.colRight { text-align: right; }
.table code {
  font: 12px/1 ui-monospace, monospace;
  background: var(--c-cream);
  padding: 2px 6px;
  border-radius: 3px;
}
.orderPills { display: flex; gap: 4px; flex-wrap: wrap; }
.orderPill {
  font-size: 11px;
  background: var(--c-cream);
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid var(--c-line);
}
.orderBlock {
  border: 1px solid var(--c-line);
  border-radius: 6px;
  margin-bottom: 16px;
  overflow: hidden;
}
.orderHead {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 10px 16px;
  background: var(--c-cream);
  border-bottom: 1px solid var(--c-line);
  font-size: 13px;
}
.orderId { font-weight: 600; color: var(--c-ink); }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/components/PoScanModal.tsx apps/backend/src/components/PoScanModal.module.css
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): PoScanModal — rollup + by-order tabs + Generate PO flow — Suppliers+PO"
```

---

### Task 3.2: Modify OrderDrawer to show PO status in logistics section

**Files:**
- Modify: `apps/backend/src/components/OrderDrawer.tsx`

- [ ] **Step 1: Read current OrderDrawer.tsx**

Find the section that renders when `order.lane === 'logistics'`. If a logistics-specific section doesn't exist yet (Sub-project C only added dispatched/delivered sections), add it now.

- [ ] **Step 2: Import the usePurchaseOrders hook**

At the top with other imports:
```typescript
import { usePurchaseOrders } from '../lib/queries';
```

- [ ] **Step 3: Add logistics section conditional render**

Inside the `{order && (...)}` block, add this AFTER the `<SlipSection ... />` render and BEFORE the `<DriverPickerSection>` block (so order is: slip → po → driver → dispatch):

```tsx
            {order.lane === 'logistics' && (
              <PoStatusSection
                orderId={orderId}
                poIssued={order.poIssued}
                poIssuedAt={order.poIssuedAt}
              />
            )}
```

- [ ] **Step 4: Define `PoStatusSection` inline at the bottom of the file (or extract later)**

Append this component definition at the end of OrderDrawer.tsx (after the main component):

```tsx
function PoStatusSection({
  orderId,
  poIssued,
  poIssuedAt,
}: {
  orderId: string;
  poIssued: boolean;
  poIssuedAt: string | null;
}) {
  const pos = usePurchaseOrders(orderId);
  const firstPo = pos.data?.[0];

  const formattedDate = poIssuedAt
    ? new Date(poIssuedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    : null;

  return (
    <section style={{ padding: 16, borderTop: '1px solid var(--c-line)' }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--c-ink)' }}>
        Purchase order
      </h3>
      <div style={{ marginTop: 8, fontSize: 14, color: 'var(--c-ink)' }}>
        {poIssued && firstPo
          ? <><strong>{firstPo.poNumber}</strong> · issued {formattedDate ?? '—'}</>
          : poIssued
            ? <>PO issued {formattedDate ? `on ${formattedDate}` : ''}</>
            : <span style={{ color: 'var(--fg-muted)' }}>Awaiting PO scan</span>}
      </div>
      {!poIssued && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-muted)' }}>
          Open the &quot;Scan PO&quot; modal from the logistics lane to issue this order&apos;s PO.
        </div>
      )}
    </section>
  );
}
```

(Inline styles are pragmatic for a small section; extract to a CSS module in a follow-up if it grows.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/components/OrderDrawer.tsx
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): OrderDrawer renders PO status section in logistics lane — Suppliers+PO"
```

---

### Task 3.3: Modify LaneStepper to block logistics → ready when no PO

**Files:**
- Modify: `apps/backend/src/components/LaneStepper.tsx`

- [ ] **Step 1: Read current LaneStepper props**

Find the props interface — it likely receives the order or at least the lane + relevant gate fields (driver_id, do_key from Sub-project C).

- [ ] **Step 2: Add `poIssued` to props**

If the component takes individual prop fields:
```typescript
interface Props {
  // existing props
  poIssued: boolean;
}
```

If it takes the whole order, no prop change needed (order already has `poIssued` after Task 2.1).

- [ ] **Step 3: Add gate logic**

Find the JSX where each lane button is rendered and the forward-step click is wired. The gate logic should:
- When current lane is `logistics` and target lane is `ready` and `!poIssued`, disable the next-step button and show a tooltip.

Wherever the click handler decides whether to allow forward step, add:

```typescript
  // Sub-project D gate: logistics → ready requires poIssued
  if (currentLane === 'logistics' && targetLaneId === 'ready' && !poIssued) {
    return { disabled: true, tooltip: 'Issue PO via Scan first' };
  }
```

(The exact integration depends on how Sub-project C structured gate state — mirror its driver/do gate pattern.)

- [ ] **Step 4: Pass `poIssued` from OrderDrawer to LaneStepper if needed**

In OrderDrawer.tsx, find where `<LaneStepper ... />` is rendered and add the prop if your interface change requires it:

```tsx
<LaneStepper
  // ...existing props
  poIssued={order.poIssued}
/>
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/components/LaneStepper.tsx apps/backend/src/components/OrderDrawer.tsx
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): LaneStepper blocks logistics→ready when !poIssued — Suppliers+PO"
```

---

### Task 3.4: Add "Scan PO" button + mount PoScanModal in Orders page

**Files:**
- Modify: `apps/backend/src/pages/Orders.tsx`

- [ ] **Step 1: Read current Orders.tsx**

Find:
1. Where lane data is fetched (likely `useOrdersByLane()` or similar)
2. Where each lane's column header is rendered
3. The page-level state declarations (e.g. selected order for drawer)

- [ ] **Step 2: Add state + import for the modal**

At the top with other imports:
```typescript
import { useState } from 'react';
import { PoScanModal } from '../components/PoScanModal';
```

Inside the page component, near other useState calls:
```typescript
const [poScanOpen, setPoScanOpen] = useState(false);
```

- [ ] **Step 3: Build the orders-for-scan list**

Find the `logistics` lane data. The PoScanModal expects `orders: OrderForScan[]` where each order has `id`, `customerName`, and `cart: CartItem[]` with supplier_id joined.

If the existing query doesn't include cart + supplier_id join, extend the query OR fetch separately. Simplest path: extend `useOrdersByLane` (or equivalent) to include cart items joined to products with supplier_id.

For now, derive the modal-input list inline:

```typescript
// Filter logistics orders that don't have po_issued yet
const logisticsOrdersForScan = useMemo(() => {
  const list = (lanesData?.logistics ?? []).filter((o) => !o.poIssued);
  return list.map((o) => ({
    id: o.id,
    customerName: o.customerName ?? '—',
    cart: o.cart ?? [],  // Assumes cart is already on OrderListItem; if not, fetch via separate hook
  }));
}, [lanesData]);
```

(Assumption: the orders-by-lane query returns `cart` with each item joined to `products.supplier_id`. If not, this becomes Step 3a where you extend the query.)

- [ ] **Step 4: Add "Scan PO" button in logistics lane header**

Find the lane header rendering (something like `<LaneColumn lane="logistics" ...>`). Inside or next to the count badge, add a conditional button:

```tsx
{lane === 'logistics' && logisticsOrdersForScan.length > 0 && (
  <button
    type="button"
    onClick={() => setPoScanOpen(true)}
    style={{
      background: 'var(--c-burnt, #B87800)',
      color: 'white',
      border: 0,
      padding: '4px 10px',
      borderRadius: 4,
      fontSize: 12,
      cursor: 'pointer',
      marginLeft: 8,
    }}
  >
    Scan PO ({logisticsOrdersForScan.length})
  </button>
)}
```

- [ ] **Step 5: Mount the modal at page level**

At the bottom of the page's JSX (before the closing tag), add:

```tsx
{poScanOpen && (
  <PoScanModal
    orders={logisticsOrdersForScan}
    onClose={() => setPoScanOpen(false)}
    onIssued={() => {
      // Refresh lane data after issuing
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    }}
  />
)}
```

(`queryClient` from TanStack — import `useQueryClient` if not already.)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: no errors. If `cart` or `supplierId` aren't on the lane query results, fix the type mismatch by extending the query.

- [ ] **Step 7: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/pages/Orders.tsx
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): Orders page mounts PoScanModal + Scan PO button in logistics lane — Suppliers+PO"
```

---

## Phase 4 — Acceptance + cleanup

### Task 4.1: Seed test data — 2 products with supplier_id + SO-9008 + SO-9009

**Files:**
- Modify: `packages/db/seeds/test-orders.sql`
- Or Create: `packages/db/seeds/test-po-orders.sql`

- [ ] **Step 1: Read existing seed file structure**

Run: `Read packages/db/seeds/test-orders.sql`. Note the cart structure — find how SO-9006/9007 stored their cart (JSONB column? separate `order_items` table?).

- [ ] **Step 2: Decide append vs new file**

If the existing test-orders.sql uses a single `DO $$ DECLARE ... END $$;` block with all seeds, append to it. Otherwise create `test-po-orders.sql`. For consistency with C, **append** to test-orders.sql.

- [ ] **Step 3: Append products + orders**

Inside the existing `DO $$ DECLARE ... ` block, before `END $$;`, add:

```sql
  -- Sub-project D test data: 2 products with supplier FKs + SO-9008 + SO-9009

  -- Look up supplier UUIDs (seeded in 0014)
  DECLARE
    v_sup_slp UUID;
    v_sup_kfa UUID;
  BEGIN
    SELECT id INTO v_sup_slp FROM suppliers WHERE code = 'SLP';
    SELECT id INTO v_sup_kfa FROM suppliers WHERE code = 'KFA';

    -- Test product 1: SLP mattress (cat=mattress)
    INSERT INTO products (id, sku, name, cat, active, supplier_id)
    VALUES ('p-test-mat-cloud', 'MAT-CLOUD', 'Cloud mattress (test)', 'mattress', true, v_sup_slp)
    ON CONFLICT (id) DO UPDATE SET supplier_id = EXCLUDED.supplier_id;

    -- Test product 2: KFA sofa (cat=sofa)
    INSERT INTO products (id, sku, name, cat, active, supplier_id)
    VALUES ('p-test-sof-noor', 'SOF-NOOR', 'Noor sofa (test)', 'sofa', true, v_sup_kfa)
    ON CONFLICT (id) DO UPDATE SET supplier_id = EXCLUDED.supplier_id;
  END;

  -- Order 8: in logistics, cart = SLP mattress + KFA sofa (cross-supplier)
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state)
  VALUES ('SO-9008', v_staff_s01, v_showroom, 'logistics',
    'Test Customer 8 (cross-supplier)', '+60123456008',
    5980, 0, 5980, 5980, '0', 'transfer', 'verified')
  ON CONFLICT (id) DO NOTHING;

  -- Order 9: in logistics, cart = SLP mattress only
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state)
  VALUES ('SO-9009', v_staff_s01, v_showroom, 'logistics',
    'Test Customer 9 (single-supplier)', '+60123456009',
    2990, 0, 2990, 2990, '0', 'transfer', 'verified')
  ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 4: Add cart line items if `order_items` table exists**

Read `packages/db/src/schema.ts` to confirm. If there's an `orderItems` pgTable separate from `orders.cart` JSONB, add INSERT statements for SO-9008 and SO-9009 line items:

```sql
  -- SO-9008 cart: SLP mattress + KFA sofa
  INSERT INTO order_items (order_id, product_id, sku, qty, unit_price, line_subtotal)
  VALUES
    ('SO-9008', 'p-test-mat-cloud', 'MAT-CLOUD', 1, 2990, 2990),
    ('SO-9008', 'p-test-sof-noor', 'SOF-NOOR', 1, 2990, 2990)
  ON CONFLICT DO NOTHING;

  -- SO-9009 cart: SLP mattress only
  INSERT INTO order_items (order_id, product_id, sku, qty, unit_price, line_subtotal)
  VALUES ('SO-9009', 'p-test-mat-cloud', 'MAT-CLOUD', 1, 2990, 2990)
  ON CONFLICT DO NOTHING;
```

(Adjust column names to match the actual schema.)

If cart is JSONB on the orders table, modify the orders INSERTs to include the cart column.

- [ ] **Step 5: Apply via mcp__supabase__execute_sql**

Run the entire updated DO block (or just the new statements wrapped in their own DO block).

- [ ] **Step 6: Verify**

```sql
SELECT id, lane, po_issued FROM orders WHERE id IN ('SO-9008', 'SO-9009') ORDER BY id;
```
Expected: SO-9008 (logistics, false), SO-9009 (logistics, false).

```sql
SELECT p.sku, p.name, s.code AS supplier_code FROM products p
LEFT JOIN suppliers s ON s.id = p.supplier_id
WHERE p.id IN ('p-test-mat-cloud', 'p-test-sof-noor') ORDER BY p.id;
```
Expected: 2 rows with supplier codes (SLP, KFA).

- [ ] **Step 7: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/seeds/test-orders.sql
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "chore(db): seed SO-9008 + SO-9009 with supplier-tagged products — Suppliers+PO"
```

---

### Task 4.2: Run Loo's manual acceptance test (15 steps from spec §8.2)

**Files:** none (testing)

- [ ] **Step 1: Verify all dependencies in place**

Checklist:
- [ ] Migrations 0014, 0015, 0016 applied (verify with `mcp__supabase__list_migrations`)
- [ ] suppliers table has 6 rows
- [ ] products table has 2 test rows with supplier_id set
- [ ] SO-9008 + SO-9009 in logistics lane with cart populated
- [ ] Backend typecheck passes
- [ ] API typecheck passes
- [ ] All API tests pass
- [ ] `pnpm dev` starts all 3 apps without error

- [ ] **Step 2: Send Loo the 15-step acceptance test**

Quote spec §8.2 verbatim. Run them in order via Playwright MCP if available; otherwise Loo runs manually in browser.

**⚠️ KNOWN BLOCKER:** Sub-project C Task 62 acceptance test was blocked on Supabase Auth credentials (HTTP 400 "Invalid login credentials" for owner account). This blocker carries over to Sub-project D's acceptance test. Before running, confirm with Loo whether the auth issue has been resolved (valid coordinator credentials provided). If not resolved, Sub-project D ships with unit + integration tests passing but no end-to-end Playwright walkthrough — call this out explicitly to Loo at completion.

- [ ] **Step 3: Address any failures**

If any step fails: investigate root cause, fix, commit fix, re-run that step.

Common failure modes to watch for:
- Cart structure mismatch (PoScanModal expects `supplierId` on each cart item)
- Print window blocked by browser → test "Open print view" button as backup path
- Lane gate not firing → verify `po_issued` column exists in API's lane PATCH `.select(...)` clause (Task 1.3 Step 2)

- [ ] **Step 4: Loo confirms ship-ready**

After all 15 tests pass (or auth-blocked steps documented): "Suppliers+PO acceptance test {pass | partially-blocked} — ready to ship?"

---

### Task 4.3: Final cleanup + push

**Files:** various

- [ ] **Step 1: Full monorepo typecheck + test**

```bash
pnpm typecheck
pnpm test
```

Both should pass. (Existing C tests + new D tests.)

- [ ] **Step 2: Verify clean tree**

```bash
git status
```

Should be clean (no untracked except `.mcp.json` which is pre-existing).

- [ ] **Step 3: Push all commits**

```bash
git push origin main
```

- [ ] **Step 4: Notify Loo**

"Suppliers+PO shipped. N commits. {Acceptance tests pass | Acceptance test deferred pending auth fix}. PO scanning workflow now connects logistics lane to supplier procurement. Next: Sub-project E (Backend stub pages — Settings → Suppliers admin, Settings → Drivers admin) when ready, OR address Sub-project C Task 62 auth blocker, OR something else."

---

## Self-Review Checklist (executor reads before claiming done)

- [ ] Spec coverage: every section/decision in `2026-05-09-suppliers-po-design.md` has a corresponding task here.
  - §1 Goal & Scope (1.1 + 1.2) → covered by all tasks combined
  - §2 Architecture (D1-D10) → D1 single-subproject (whole plan), D2 PO entity (M4), D3 year-prefixed (M4 next_po_number), D4 print-to-PDF (renderPoPrintHtml + GET /print), D5 manual share (buildWhatsAppShareUrl + buildMailtoUrl), D6 drop drawer button (Task 3.2 logistics section is read-only), D7 suppliers seed (M3), D8 supplier_id nullable (M3), D9 step-back retains po_issued (M5 default false + no auto-clear), D10 append-only (no PATCH/DELETE on PO routes)
  - §3 Components → all 17 files listed with create/modify and exact paths
  - §4 Data flow → covered by Phase 3 components + Phase 1 API
  - §5 API contracts → POST + GET + GET /print all in Task 1.2
  - §6 Migrations → M3/M4/M5 in Tasks 0.1/0.2/0.3 with red-line gates
  - §7 Error handling → covered by Task 3.1 PoScanModal error states + API 400/409 responses
  - §8 Testing plan → unit tests in Task 1.1, integration in Task 1.4, manual acceptance in Task 4.2
- [ ] All 3 RLS-cadence migrations have explicit STOP gates with the exact wording for asking Loo.
- [ ] Every task ends with a commit using `git -c user.name=... -c user.email=...` (git config not modified per global red line).
- [ ] No "TBD" / "TODO" / "implement appropriately" placeholders.
- [ ] Type names consistent across tasks:
  - `poIssued`, `poIssuedAt`, `poIssuedBy` — same in OrderDetail interface, schema.ts, API select strings, component props
  - `Supplier`, `PurchaseOrder`, `PurchaseOrderLine` — same in queries.ts and lib/purchase-orders.ts
  - `createPO`, `openPrintWindow`, `getPrintUrl`, `buildWhatsAppShareUrl`, `buildMailtoUrl` — same in lib/purchase-orders.ts and PoScanModal.tsx imports
- [ ] CSS module files have actual class names, not `// styles here` placeholders.
- [ ] Cart structure assumption flagged in Task 3.4 Step 3 — executor confirms before writing modal-input mapping.

---

*End of plan. Total: 17 tasks across 5 phases. Estimated 4-5 days of focused execution.*
