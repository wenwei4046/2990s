# CLAUDE.md — 2990's Portal

> Project-level instructions for Claude Code. Sits at the repo root.
> Global instructions in `~/.claude/CLAUDE.md` (Karpathy 4 principles + red lines) still apply on top of this.

---

## What this repo is

Started life as a 2990's Home **POS + Backend** for a Malaysian furniture retailer with an "honest pricing" brand (every Model has its own per-Model pricing, no upsells / sales / strikethroughs). It has since grown into a **full ERP** — and is **LIVE in production**. Three apps share one Hono API and one Supabase Postgres:

| App | User | Device | Status |
|---|---|---|---|
| **POS** (`apps/pos`) | Sales staff | Tablet primary (PWA), desktop counter | ✅ live |
| **Backend** (`apps/backend`) | Coordinator, Finance, Owner, warehouse, purchasing | Desktop primary | ✅ live |
| **API** (`apps/api`) | Both apps | CF Workers global edge | ✅ live |

What the ERP now covers, on top of the original retail POS:
- **Order-to-cash**: Sales Order → Delivery Order → Sales Invoice (+ Delivery Returns), AR posting to the GL.
- **Procure-to-pay**: Purchase Order → Goods Received Note → Purchase Invoice (+ Purchase Returns), AP posting to the GL.
- **Inventory / WMS**: FIFO lots + movement ledger, warehouses/racks, stock transfers, stock takes, COGS + valuation.
- **Suppliers + MRP**: supplier master with material bindings; a pure MRP planner (demand vs supply, greedy allocation).
- **Accounting / GL**: chart of accounts, journal entries, balances, AR/AP aging, outstanding rollups.
- **Sofa / bedframe / mattress configurators**, fabric-tier surcharges, Sofa Combos, PWP (换购) vouchers.

Single Supabase Postgres (project in **Singapore** — **NOT** Venture's `gixpptmfuryskbwkmiwz`).

---

## Stack — non-negotiable

- **Monorepo**: pnpm workspace (`pnpm@10.33`) + Turborepo (`turbo@2.3`). Node `>=24`. TypeScript `5.7` strict, everywhere.
- **Frontend**: Vite 6 + React 19 + React Router 7 + TypeScript strict. POS is a PWA (`vite-plugin-pwa` + Workbox).
- **API**: Hono 4 on Cloudflare Workers (Wrangler 4). `bcryptjs` for PIN hashing.
- **DB**: Supabase Postgres (Singapore).
- **ORM**: Drizzle (`drizzle-orm` 0.36 / `drizzle-kit` 0.30). **`packages/db/src/schema.ts` is the source of truth.**
- **Storage**: Cloudflare R2 (slips, product photos).
- **Auth**: Supabase Auth (email + magic link for staff; bcrypt **PIN** layer on top for POS counter switching).
- **Realtime**: Supabase Realtime (POS ↔ Backend sync via channels that invalidate TanStack queries, ~300ms).
- **Styling**: CSS Modules + brand tokens from `packages/design-system` (originating in `prototype/assets/colors_and_type.css`).
- **Icons**: Lucide React (rounded, stroke 1.75).
- **State**: Zustand 5 (app) + TanStack Query 5 (server).
- **Forms**: React Hook Form 7 + Zod 3 (schemas live in `packages/shared/src/schemas/`).
- **Docs/export**: `jspdf` (printable docs) + `xlsx` (Finance exports) in the Backend app.
- **Deploy**: CF Pages (the two SPAs) + CF Workers (api) + GitHub Actions.

**Don't substitute** any of the above without an explicit deviation approval (see `UI_REFERENCE.md`). In particular: no Next.js, no Tailwind, no shadcn/ui, no react-dnd.

---

## Read these BEFORE writing any code

1. **`UI_REFERENCE.md`** — the UI/motion/function contract. Prototype is canonical for look + feel. Read the "What NOT to do" section twice.
2. **`PORT_DESIGN.md`** — the master technical port/design reference (decisions, schema rationale, eng review folds). Read first for Phase 0+ work.
3. **`2990S-PORTAL-PLAN.md`** — original architecture + phased rollout + locked decisions (historical, but still the source for the locked-decisions list).
4. **`packages/db/src/schema.ts`** — Drizzle schema, **~87 tables / ~27 enums**. Generate migrations from this, never the other way around.
5. **`prototype/index.html`** + **`prototype/backend.html`** — the original UI spec. The production apps are built; the prototype remains the design reference, not legacy code to refactor.

You don't need to read them top-to-bottom every session, but `UI_REFERENCE.md` MUST be in context before any UI work.

---

## What's in this repo

```
/
├── CLAUDE.md                       ← you're here
├── UI_REFERENCE.md                 ← UI/motion/function contract
├── PORT_DESIGN.md                  ← master technical port/design reference
├── 2990S-PORTAL-PLAN.md            ← original architecture + roadmap (historical)
├── prototype/                      ← original UI spec. Don't refactor; reference from.
│   ├── index.html / backend.html
│   ├── pos-*.jsx + pos-styles.css
│   ├── backend-*.jsx + backend-styles.css
│   └── assets/                     ← colors_and_type.css, imagery, sofa module PNGs (22)
├── apps/
│   ├── pos/                        ← Vite SPA (PWA) → pos.{domain}  — @2990s/pos
│   ├── backend/                    ← Vite SPA → admin.{domain}      — @2990s/backend
│   └── api/                        ← Hono on CF Workers → api.{domain} — @2990s/api
│       └── src/
│           ├── index.ts            ← route mounting
│           ├── routes/             ← ~56 route modules (orders, mfg-sales-orders,
│           │                          delivery-orders-mfg, sales-invoices, grns,
│           │                          purchase-invoices, inventory, accounting,
│           │                          suppliers, mrp, outstanding, document-flow, …)
│           ├── middleware/auth.ts  ← Supabase JWT verification
│           └── lib/                ← po-pricing, mfg-pricing-recompute, post-si-revenue, …
├── packages/
│   ├── shared/                     ← @2990s/shared — pure functions + Zod schemas
│   │   └── src/                       pricing, mfg-pricing, sofa-build, sofa-combo-pricing,
│   │                                  fabric-tier-addon, pwp, order-rules, format, phone, schemas
│   ├── design-system/              ← @2990s/design-system — tokens.css, primitives, Lucide wrappers
│   └── db/                         ← @2990s/db
│       ├── src/schema.ts           ← Drizzle schema (source of truth)
│       ├── migrations/             ← ~161 SQL files, 0000–0147 (see "Migrations" below)
│       └── seeds/                  ← seed-libraries.sql + catalog/library seeds (12 files)
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

`apps/backend` has ~71 page components; `apps/api` has ~56 route modules. Both are real, production code — no placeholders.

---

## Project conventions

### Money
- **Retail / POS catalog prices**: `INTEGER` representing **whole MYR** (e.g. `2990` = RM 2,990). No sen-level pricing in the retail model — don't introduce a `numeric(10,2)` column there.
- **ERP / manufacturing / accounting layer**: uses integer **`*_centi`** columns (e.g. `unit_price_centi`, `outstanding_centi`) for cost, GL, and document totals where sen precision is required. These are still integers (cents), never floats. Match the existing column's unit — don't mix whole-MYR and centi in the same calc.

### Order & document IDs
- Sales Order: `SO-XXXX`, 4-digit number from Postgres sequence `order_seq`, via `next_order_id()` (`seeds/seed-libraries.sql`). Sequence was bumped to **2990** in migration `0033` (2026-05-22); pre-pilot test orders are SO-2050..SO-2065.
- ERP docs each carry their own human-readable number field (DO / SI / PO / GRN / PI etc.) — TEXT, generated server-side. Keep them human-readable; they appear on WhatsApp confirmations, printed docs, and customer-facing surfaces.

### Brand voice (in any new copy)
- Warm, sincere, calm. No hype. No urgency. No "Limited time!". No emoji.
- Sentence case for everything. Title Case only for tagline-style headlines.
- Body type uses `#221F20` (`--c-ink`), never pure black.
- Bilingual: EN-only at pilot. 中文 toggle (`lang === 'cn'`) wired but defaults off — don't remove the wiring.

### Icons
- Lucide React only. Stroke 1.75. Sizes: 16 / 20 / 24 / 32 / 40px. Never emoji, never another icon set, never mix.

### Showroom
- `showrooms` table; primary seed "Showroom KL" — UUID `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`, address `51, Jln Utara, Pjs 12, 46200 Petaling Jaya, Selangor`.
- `staff.showroom_id` is nullable — coordinators with NULL oversee all showrooms.
- `orders.showroom_id` is NOT NULL — every order is placed at exactly one showroom.
- POS topbar reads the showroom from `staff.showroomId`, not hardcoded — it goes dynamic when a 2nd showroom opens.

### Staff roles
- 10 roles in the `staffRole` enum (`schema.ts`): `sales`, `showroom_lead`, `coordinator`, `finance`, `admin`, `sales_executive`, `outlet_manager`, `sales_director`, `super_admin`, `master_account`.
- `staff.id` = `auth.users.id` (UUID). API verifies the Supabase JWT via GoTrue (`middleware/auth.ts`); RLS uses `SECURITY DEFINER` role helpers (`is_admin`, `is_coordinator_or_above`, `is_finance_or_admin`, `current_staff_role`).

### File scoping
- Files under `apps/pos/*` and `apps/backend/*` must never directly import each other.
- Shared types, Zod schemas, pure pricing/order math → `packages/shared/` (exports: `pricing`, `mfg-pricing`, `sofa-build`, `sofa-combo-pricing`, `fabric-tier-addon`, `pwp`, `order-rules`, `format`, `phone`, `schemas`).
- Brand tokens + design primitives → `packages/design-system/`.
- Drizzle schema + migrations + seeds → `packages/db/`.

---

## ERP document flows

The ERP is SAP-Business-One-style: documents reference upstream documents, and `/document-flow/:type/:id` returns the relationship graph (nodes + edges; edge kinds: `full` / `partial` / `value` / `payment`) across SO/DO/SI/Payment/PO/GRN/PI/DR/PR.

- **Sales (order-to-cash)**: `mfg_sales_orders` (SO) → DO via `PATCH /mfg-sales-orders/:id/do-from-so` → `delivery_orders` → `sales_invoices` (SI) → AR posting `POST /accounting/post/si/:invoiceNumber` (idempotent). `delivery_returns` hang off a DO and resolve upstream to the SO.
- **Purchase (procure-to-pay)**: `purchase_orders` (PO) → `grns` (GRN POST creates an inventory IN movement with `batch_no` from the source PO) → `purchase_invoices` (PI) → AP posting `POST /accounting/post/pi/:invoiceNumber`. `purchase_returns` hang off a GRN or PO.
- **Inventory (FIFO)**: `inventory_movements` (balance ledger), `inventory_lots` (FIFO), batches by warehouse+batch, `/inventory/cogs`, `/inventory/value`, `/inventory/adjustments`. Plus `warehouses` / `warehouse_racks`, `stock_transfers`, `stock_takes`.
- **Suppliers + MRP**: `suppliers` + `supplier_material_bindings`; `/mrp` is a pure calculator (demand = SO lines, supply = stock + PO lines, greedy allocation by delivery date, per warehouse+variant, **no persistence**).
- **Accounting/GL**: `/accounts`, `/journal-entries`, `/gl`, `/balances`, `/ar-aging`, `/ap-aging`.
- **Outstanding**: `/outstanding/{po,grn,pi,pr,so,do,si}` backed by `v_*_outstanding` views (`is_outstanding` flag + `outstanding_centi` rollup).

---

## Server-side pricing recompute — NON-NEGOTIABLE

`POST /orders` (`apps/api/src/routes/orders.ts`) MUST re-derive the total from current pricing tables before persisting, using the **shared** pricing code:
- `computeOrderTotal` — line recompute. Sofa lines: sum compartments per `config.modules`, add recliner upgrades per seat, OR substitute bundle price if `detectBundle` matches AND bundle is cheaper. Mattress/bedframe lines: lookup `product_size_variants(product_id, size_id).price`. Addons from `addons`; fabric tiers + Sofa Combos + PWP applied per the shared helpers.
- `computeDeliveryFee` — category-aware base + cross-category (special-model overrides).
- `pricingDriftExceeds` — if the client total differs from the server total by **> 0.5%**, **REJECT** with HTTP 400 and the diff. Don't trust the POS bundle. The "honest pricing" promise breaks the moment a tampered POS submits `total: 0`.

The pure functions live in `packages/shared/src/pricing.ts` (+ `sofa-build.ts`, `sofa-combo-pricing.ts`, `fabric-tier-addon.ts`, `mfg-pricing.ts`) so client and server run the same code. The manufacturing SO path uses `mfg-pricing` (`computeMfgLinePrice` / `computeMfgLineCost`, MaintenanceConfig per scope).

---

## Migrations & DB ops

- **Drizzle schema is the source of truth** (`packages/db/src/schema.ts`). Generate migrations from it; never hand-edit the schema to match a stray migration.
- **Migrations are append-only after deploy.** Don't squash without explicit OK.
- ⚠️ **The migration ledger ≠ the files on disk.** There are ~161 files on disk (0000–0147) but fewer rows in the Supabase migration ledger, and **~17 duplicate-numbered migrations** (e.g. 0040–0046, 0060, 0069, 0072/0073, 0109–0118, 0122; 0110/0111 are triples) plus a few gaps — the result of parallel branches landing on `main`. **Don't trust `list_migrations`**; verify the actual DB objects (columns/tables/views) before assuming a migration ran.
- **Apply migrations via the Supabase MCP** (`apply_migration` / `execute_sql`). The "Apply DB migration" GitHub workflow fails because the `DATABASE_URL` repo secret is unset — that's known and harmless; don't try to "fix" it without being asked.
- Seeds live in `packages/db/seeds/`. Library tables seed; the live catalog (sofas / mattresses / bedframes) has since been seeded in prod via the Backend SKU Master.

---

## Status

The original Phase 0–6 plan is effectively **complete and shipped** — the app then expanded into the full ERP described above. Treat the table below as historical context, not a to-do list:

| Phase | Scope | Status |
|---|---|---|
| 0 · Scaffold | pnpm workspace, 3 apps, design-system, Supabase, Wrangler, GH Actions | ✅ done |
| 1 · Catalog | SKU Master pricing editor, POS catalog reads from API | ✅ done |
| 1.5 · Sofa config per-Model | `modulePriceFor` / `bundlePriceFor` / `reclinerPriceFor` from product pricing | ✅ done |
| 2 · Order placement | configurator → cart → handover → confirm; `POST /orders` recompute; realtime | ✅ done |
| 3 · Order lifecycle | order board, drawer, lane transitions, history audit | ✅ done |
| 4 · Slip + dispatch + delivery | R2 upload, dispatch, driver assignment | ✅ done |
| 5 · Hardening | RLS, customer directory, audit log | ✅ done |
| 6 · Pilot | Showroom KL go-live | ✅ live in prod |
| ERP expansion | SO→DO→SI, PO→GRN→PI, FIFO inventory/WMS, suppliers/MRP, accounting/GL, returns, outstanding, document-flow graph | ✅ live (data is real; some GL/SI volume still ramping) |

---

## Locked decisions (from plan §10)

- ✅ NEW Supabase project (Singapore region).
- ✅ Multi-showroom support via `showrooms` + `showroom_id` (built in, not retrofit).
- ✅ Customers do NOT log in — internal directory only.
- ✅ No data migration from the old Google Sheet (no historical data existed).
- ✅ Pricing edits are direct admin action — no `pricing_proposals` approval table.
- Bilingual: EN-only at pilot; 中文 toggle reactivates post-pilot (wiring stays).

---

## Project red lines (in addition to global)

1. **Don't modify the prototype** to "fix" something unless explicitly asked. It's the canonical design spec. Approved deviations go through the `UI_REFERENCE.md` protocol.
2. **Don't redesign the sofa configurator UI.** Loo finalised it through multiple design reviews. The 22 plan-view PNGs and the snap math are not negotiable.
3. **Don't substitute the stack** (§Stack). Tailwind, shadcn, react-dnd, Next.js — all rejected with reasons. Use the existing CSS classes + design-system tokens.
4. **Don't skip server-side pricing recompute** on `POST /orders`. The whole brand promise depends on it.
5. **Real SKUs are seeded via the Backend SKU Master**, not invented in code. The catalog is now seeded in prod (sofas / mattresses / bedframes); the Models in `prototype/pos-data.jsx` remain reference/test data only. Don't re-seed or overwrite prod catalog without an explicit ask.
6. **Don't expose the Backend portal to non-staff.** RLS is restrictive by default; verify before any change that could widen access.

---

## Workflow

- Use the `gstack` skill pack for routine work (loaded by default).
- Always check `UI_REFERENCE.md` "Approved deviations" before diverging from the prototype. If your change isn't on the list, ask first.
- `main` advances via parallel sessions (Loo + Wei Siang) — `git pull --ff-only` before branching.
- Loo wants fixes **pushed and deployed** (not just local dev) and verifies on live CF; remind about PWA hard-refresh after a POS deploy.
- When referencing a prototype `.jsx`: treat it as a design doc, not legacy code to refactor. The patterns, class names, and tuned pure functions are intentional.

---

## Quick command reference

```bash
# Dev (all apps, via turbo)
pnpm dev

# Dev (single app)
pnpm --filter @2990s/pos dev
pnpm --filter @2990s/backend dev
pnpm --filter @2990s/api dev

# Quality gates
pnpm typecheck
pnpm test            # vitest
pnpm lint
pnpm format          # prettier

# DB (drizzle-kit + seed)
pnpm db:generate     # generate migration from packages/db/src/schema.ts
pnpm db:push         # apply to local Supabase
pnpm db:seed         # run seeds
# In practice, apply migrations to prod via the Supabase MCP (apply_migration / execute_sql).

# Build / deploy
pnpm build                              # turbo build (all)
wrangler deploy                         # apps/api → CF Workers
# the two SPAs deploy to CF Pages (CI handles main)
```

---

When in doubt about a design or product decision, ask Loo before guessing. He prefers a 30-second clarification over a 2-hour rebuild.
