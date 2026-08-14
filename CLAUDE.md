# CLAUDE.md — 2990's Portal

> Project-level instructions for Claude Code. Sits at the repo root.
> Global instructions in `~/.claude/CLAUDE.md` (Karpathy 4 principles + red lines) still apply on top of this.

---

## ⚠️ READ FIRST — this system has been superseded by HouzsERP

**As of the 2026-07-21 POS cutover, this repo is the OLD system.** Nothing below
this box is wrong, but all of it describes a system that new sales work no longer
flows through. Verified 2026-08-03:

- **`.github/workflows/deploy.yml` builds the POS pointing at Houzs**, not at this
  repo's API: `VITE_BACKEND_TARGET: houzs`, `VITE_HOUZS_API_URL:
  https://erp.houzscentury.com/api/scm`, `VITE_HOUZS_COMPANY_ID: '2'`.
  `apps/pos/src/lib/apiClient.ts` reads that flag and swaps the whole data layer.
  **Rollback:** delete those three lines from the workflow and redeploy.
- **So `pos.2990shome.com` and `erp.2990shome.com` no longer share a database.**
  The POS writes Sales Orders into Houzs (company 2). The Backend still reads and
  writes this repo's Supabase. A POS order does not appear in the Backend.
- **PR #754 (`4c45f434`, 2026-07-24) built a reversible read-only freeze** for
  exactly this situation — `apps/api/src/middleware/read-only.ts`, gated on
  `READ_ONLY_MODE` in `wrangler.toml [vars]`. When `"true"`, GET/HEAD/OPTIONS and
  the three login endpoints still work; every other write returns 403 `read_only`
  with a "use HouzsERP" message.
- **The freeze is OFF, and that is a DELIBERATE STANDING DECISION — do not
  "fix" it.** `GET https://api.2990shome.com/health` returned `{"readOnly":false}`
  on 2026-08-03, ten days after PR #754 landed. Reviewed and decided on
  2026-08-03: **leave it off** while the system's future scope is still open,
  since freezing forecloses options that may still be wanted. Re-raise only if
  the owner asks, or if the scope question is settled.

  Consequences to keep in mind while it stays off (these are accepted, not
  outstanding bugs):
  - The two databases keep diverging. Whoever eventually reconciles them will
    need a rule for which side is authoritative per record.
  - Flipping the freeze would affect **only `erp.2990shome.com` (office staff)**.
    It cannot affect the POS: the deployed POS bundle does not contain the string
    `api.2990shome.com` at all (verified 2026-08-03 by reading the live JS on
    `pos.2990shome.com` — only `erp.houzscentury.com` is present). So sales staff
    are unaffected either way.
  - There is **no sync in either direction**. `apps/api` contains zero code that
    contacts Houzs (every "Houzs" mention there is a comment about a ported
    pattern), and nothing writes Houzs data back into this Supabase.

All three surfaces are still deployed and serving (`api.2990shome.com`,
`pos.2990shome.com`, `erp.2990shome.com`).

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
- **Realtime**: ⚠️ **there is none, in either app.** Verified 2026-08-06: `grep -rn '\.channel(' apps/pos/src apps/backend/src` returns **zero** subscriptions. Don't reintroduce one without checking this first.
  - The POS **used to** run 6 `postgres_changes` channels (`catalog-products`, `mfg-catalog`, `sofa-customizer-${leadSkuId}`, `product-pricing-${productId}`, `sofa-quick-picks`, `my-orders-so`) that invalidated TanStack queries. The 2026-07-21 cutover pointed the POS at HouzsERP, **which has no realtime**, so every channel was replaced by `refetchInterval: 30_000` — see `apps/pos/src/lib/queries.ts:122`, `:145`, `:417`, `:436`, `:556`, `:597` and the no-op invalidator kept as a seam at `:128-132`. So catalog and pricing edits land in the POS within ~30s, not instantly.
  - The **Backend** has never subscribed to a Supabase channel. Its only channel is a browser `BroadcastChannel` (`apps/backend/src/lib/cross-tab-sync.ts`) syncing *tabs of the same browser*. A POS write does NOT live-refresh a Backend screen — and since the cutover it doesn't even reach the same database.
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
4. **`packages/db/src/schema.ts`** — Drizzle schema, **107 tables / 32 enums** (counted 2026-08-06). Generate migrations from this, never the other way around.
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
│           ├── routes/             ← 68 route modules (mfg-sales-orders,
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
│       ├── migrations/             ← 231 SQL files, 0000–0211 (see "Migrations" below)
│       └── seeds/                  ← seed-libraries.sql + catalog/library seeds (12 files)
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

`apps/backend` has 105 page components; `apps/api` has 68 route modules (counted 2026-08-06). Both are real, production code — no placeholders.

> Every count in this file is a snapshot with a date attached. They drift fast — this repo grew from "~87 tables / ~55 routes" to "107 / 68" in about ten weeks. Re-count before relying on one; don't quote it forward.

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

## Campaign Promos — the one POS feature that talks to 2990, not Houzs

⚠️ **Read this before touching anything under `campaign-promos`.** Added 2026-08-12 (migration `0212`). It breaks the rule that "the POS talks to Houzs", deliberately, and the reasons are not obvious.

**What it is:** fixed-value vouchers — "RM 500 Home Voucher". Admin surface is tab 9 of `pos.2990shome.com/products` (`components/products/CampaignPromosTab.tsx`).

**Why it is not part of `PWP & Promo`:** every other promo mechanism in this schema is a **swap** (reprice a line to `pwp_price_sen`) or a **freebie** (reprice to 0) — `pwp_rules`, `free_item_campaigns`, `model_default_free_gifts`. **None of them carries a money value**; there was no `value_centi` anywhere in the promo stack before 0212. A flat deduction shares no data model and no rules with PWP.

**Where the pieces live, and why they're split:**

| Piece | Home | Why |
|---|---|---|
| Campaign definitions, stock, T&C, redemption ledger | **2990's Supabase** (`campaign_promos`, `campaign_promo_redemptions`) | we can't write to Houzs |
| Admin UI | this repo — ships in the POS bundle | ✅ |
| The money | Houzs, as per-line `discount_centi` | the order lives there |

**The trick that makes it work with zero Houzs changes:** Houzs's drift gate compares **unit price only** (`mfg-pricing-recompute.ts:211`), so a client-authored `discountCenti` passes it, bounded server-side at `0 <= discount <= qty * unit` per line. So a voucher arrives **already apportioned** across the lines — `@2990s/shared/voucher-split` does the proportional split, and `apps/pos/src/lib/voucher-apply.ts` decides whether it may be applied at all.

**Four things that will bite you:**
- 🔑 **A cancelled order does NOT return its voucher to the pool, and no code on
  this side can make it.** The SO cancel runs in Houzs (that's where
  `pwpVoucherReleased` lives, `mfg-sales-orders.ts:7001`), and Houzs cannot reach
  `campaign_promo_redemptions` — no sync, either direction. So the row stays
  `APPLIED` and the stock stays spent until a human clicks **Release** in the
  admin ledger. This is structural; don't "fix" it with a POS-side hook that only
  fires when the POS happens to be doing the cancelling.
- 🔑 **`apps/api/src/routes/campaign-promos.ts` is Origin-gated, NOT authenticated.** In houzs mode the POS holds only a Houzs token, and 2990's `supabaseAuth` validates against 2990's own GoTrue — a Houzs bearer gets a flat 401. The route runs on the **service-role client**, so `toWire()` is the only thing between that table and the internet. Read the file header before extending it.
- 🔑 **`campaign-promo-queries.ts` must NOT use `authedFetch`.** It resolves to the Houzs base, and it stamps `X-Company-Id`, which is not in 2990's CORS `allowHeaders` — the **preflight** fails and the browser reports a generic network error. It uses a bare `fetch` at `VITE_API_URL` on purpose.
- 🔑 **`VITE_API_URL` is no longer unused on the houzs path.** It was a placeholder (`https://unused-on-houzs.invalid`) until this landed. Local dev points it at `http://localhost:8787`; production needs the real base or the tab ships broken.

**Cross-database consequences, all deliberate:** `so_doc_no` has **no FK** (that row is in Houzs), `redeemed_by` is **text not a uuid FK** (Houzs `scm.staff` ids don't exist in 2990's `auth.users`), and customer/staff names are **snapshotted** because there is nothing to join to. `claim_campaign_promo()` is atomic *within Postgres* — two salespeople can't both take the last voucher — but that atomicity cannot span the Houzs order insert, which is why claims go `RESERVED → APPLIED → RELEASED`. **A row stuck at `RESERVED` is a claim whose order never landed; sweep those, don't assume they were spent.**

---

## Unpriced sofa modules — why some Models quote low or quote RM 0

**The problem.** Verified 2026-08-13: **62 sofa module SKUs** come back from
`GET /pos-pools/mfg-catalog` (Houzs) with `sell_price_sen: null` AND
`seat_height_prices: null`. The POS prices a build as Σ its modules, so an
unpriced module contributes RM 0 and the tablet quotes low. Two outcomes,
depending on whether Houzs can price what we can't:

- **Houzs prices it and we don't → the order is REFUSED.** `UBORR
  L(LHF)+STOOL+L(RHF)` → tablet RM 990, server RM 1,980, `pricing_drift` 400.
  "Refresh and try again" never helps — the tablet recomputes the same figure
  every time.
- **Neither side prices it → the order is ACCEPTED at RM 0.** A client price of
  0 means "not provided", so the drift gate is carved out and the server keeps
  its own (also zero) recompute. A custom-shape Telluc has really booked two
  sofas at RM 0 + delivery. Pllao / Telluc / MAKOTO have **zero** priced modules;
  Pllao's SKUs are also deactivated in the catalogue.

Only **Blatt** has every module priced. Most other Models are missing just their
`3S` and `STOOL` — which look deliberate, as though those price as combos rather
than as modules. Escalated to the owner 2026-08-14; the fix is Houzs-side.

**Why it can't be fixed at source by us:** the Houzs price editor wouldn't
persist a value (tried 2026-08-13 — the schedule row saved, the catalogue kept
serving null), and there is no Houzs repo access.

**What handles it now:** the **drift-fix offer** at handover. On a
`pricing_drift` 400 the POS offers to adopt the server's own figure
(`cart.adoptServerPrice`), voids the signature and returns to Confirm payment.
Narrow on purpose: only when the server's price is HIGHER — a lower one would be
an unauthorised discount. The customer therefore sees the corrected figure at
handover, not on the catalogue card.

⚠️ **A 2990-side override table (`sofa_module_price_overrides`, migration `0213`)
briefly filled those nulls and was removed on 2026-08-14** — one day later,
before it could accumulate rows. It worked, but it was a second hand-maintained
price source that nobody would remember to clear once Houzs's catalogue is
fixed, and a stale row would then contradict live data. `0214` dropped the
table (**applied 2026-08-14**). Its only row was `UBORR-L(RHF)` = 99000 sen,
derived from a drift rejection (server 1,980 − L(LHF) 990 − STOOL 0) — kept
here because the derivation is the only thing that makes the figure
trustworthy. Don't rebuild the table without deciding who owns retiring it.

⚠️ **ACCEPTED DEFECT (2026-08-14): a custom-shape build on a Model with no
module prices books at RM 0.** A client price of 0 means "not provided", so the
drift gate is carved out and the server keeps its own (also zero) recompute —
nothing refuses the order. A custom Telluc has really booked two sofas at RM 0
plus delivery. The accepted control is that Telluc and Pllao offer no
custom-build entry point in the POS, so a salesperson does not reach it in
normal use. That control is **behavioural, not enforced** — the code path is
still live. If sofas ever start selling at RM 0, this is why.

⚠️ **We still don't know WHY Houzs values those builds higher.** 2990's own
`loadModelSofaModulePrices` (`mfg-pricing-recompute.ts:651`) reads the *same*
fields the catalogue serves at the *same* `PRICE_1` tier, so on this code the
server would also total RM 990. Houzs's port differs, or a sofa combo is
repricing the build. Read-back of a real order shows Houzs holding
`UBORR-L(LHF)` at RM 1,980 and `L(RHF)` at 0 — a doubled module, not a mirrored
price.

---

## Server-side pricing recompute — NON-NEGOTIABLE

`POST /mfg-sales-orders` (`apps/api/src/routes/mfg-sales-orders.ts`) MUST re-derive every line price from current pricing tables before persisting, using the **shared** pricing code:
- `computeMfgLinePrice` / `computeMfgLineCost` (`mfg-pricing.ts`) — per-line recompute from (product, fabric, variants) against the MaintenanceConfig; sofa cells, combos, fabric-tier Δ, PWP and extras all resolve server-side.
- `computeSoDeliveryFee` (`pricing.ts`) — delivery fee: base + special-model overrides + cross-category (sofa × mattress/bedframe only; mattress + bedframe = one category) + cross-order follow-up link.
- **the drift gate** — if the client price differs from the server's recompute by **> 0.5%**, **REJECT** with the diff. Don't trust the POS bundle. The "honest pricing" promise breaks the moment a tampered POS submits `total: 0`. **Read the two paragraphs below before touching this** — the obvious function is not the one that runs.

⚠️ **The drift gate is NOT in `packages/shared`.** This section used to name `mfgPricingDriftExceeds` (`packages/shared/src/mfg-pricing.ts:654`). That function has **zero production call sites** — only its own tests and comments that mention it by name. The gate that actually runs is **`driftThresholdExceeded`**, a *private* function in **`apps/api/src/lib/mfg-pricing-recompute.ts:211`**, called at `:556` and `:571`; the rejects live in `apps/api/src/routes/mfg-sales-orders.ts` (create `:2496`, add-line `:5027`, sofa swap `:6711`). ⚠️ Line numbers drift as the file grows — re-verify with `grep -n driftThresholdExceeded` / `grep -n posTablet` rather than trusting these. (Last re-verified 2026-08-03; the previously documented `:2441 / :4966 / :6645` were already stale.)

The two have also **diverged**: on `client 0, server > 0` the shared one returns `true` (its test at `mfg-pricing.test.ts:432` literally says `// tampered`) while the live one returns **`false`** on purpose — a client `unitPriceCenti` of 0 means "not provided", so the server trusts its own recompute (Commander 2026-05-29, `mfg-pricing-recompute.ts:213-217`). So porting `packages/shared` to another system hands you the **wrong** function, with **green tests** that hide it. Whoever retires this API owns porting `mfg-pricing-recompute.ts` and its 55-case test file, not just the shared math.

⚠️ **The gate is role-conditional, not a global invariant.** Every reject is wrapped in `if (posTablet)` — only `POS_TABLET_ROLES` (`apps/api/src/routes/mfg-sales-orders.ts:232` — `sales`, `sales_executive`, `outlet_manager`) are drift-checked. Office roles (`admin`, `super_admin`, `sales_director`, `coordinator`) author the selling price freely and are **never** rejected (Owner 2026-05-31, trust-boundary comment at `:220-231`). Free-item lines, PWP reward swaps and unpriced sofas are carved out too. Reproducing this asymmetry is mandatory: drop it and you either reject legitimate office orders or stop protecting the POS.

The pure MATH lives in `packages/shared/src/` (`mfg-pricing.ts`, `pricing.ts`, `sofa-build.ts`, `sofa-combo-pricing.ts`, `fabric-tier-addon.ts`) so client and server compute the same numbers — but the ORCHESTRATION that makes them correct (loading the module→price map at the exact (depth, P1) the POS used, the sofa-vs-catalog branch, the fabric-tier Δ fold, and the "can't price → trust the operator, never false-reject" escape hatches) is `apps/api/src/lib/mfg-pricing-recompute.ts`. `computeSoDeliveryFee` (`pricing.ts`) is the one pricing path that is genuinely shared end-to-end. (The original retail `POST /orders` recompute chain — `computeOrderTotal` / `computeDeliveryFee` / `pricingDriftExceeds` — was deleted with the legacy `/orders` route on 2026-06-12; the rule lives on unchanged on the mfg path.)

---

## Migrations & DB ops

- **Drizzle schema is the source of truth** (`packages/db/src/schema.ts`). Generate migrations from it; never hand-edit the schema to match a stray migration.
- **Migrations are append-only after deploy.** Don't squash without explicit OK.
- ⚠️ **The migration ledger ≠ the files on disk.** Counted 2026-08-06: **231 `.sql` files on disk, numbered 0000–0211**, but fewer rows in the Supabase migration ledger, and **25 duplicate numbers** (e.g. 0040–0046, 0060, 0069, 0072/0073, 0109–0118, 0122, 0185, 0186; 0110/0111 are triples) plus a few gaps — the result of parallel branches landing on `main`. So **a filename tells you neither the apply order nor whether it ran**, and "migration 0185" is ambiguous on its own. **Don't trust `list_migrations`**; verify the actual DB objects (columns/tables/views) before assuming a migration ran.
- ⚠️ **`drizzle-kit` cannot tell you what is applied.** `packages/db/migrations/meta/_journal.json` has **1 entry for those 231 files** (`0000_long_starbolt.sql`) — the rest were written by hand and never journalled. Re-baselining it is an open task; until then, treat drizzle-kit's applied/pending view as meaningless.
- To check whether a specific migration actually ran, generate a read-only probe instead of guessing:
  ```bash
  node scripts/check-migrations-applied.mjs > migration-check.sql   # duplicates only
  node scripts/check-migrations-applied.mjs --all                   # every migration
  node scripts/check-migrations-applied.mjs 0185 0186               # specific numbers
  ```
  It emits SELECT-only SQL to paste into the Supabase SQL Editor; `present = false` means that migration did not run.
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
| 2 · Order placement | configurator → cart → handover → confirm; server recompute (legacy `POST /orders`, since removed — live path is `POST /mfg-sales-orders`); realtime | ✅ done |
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
4. **Don't skip server-side pricing recompute** on `POST /mfg-sales-orders`. The whole brand promise depends on it.
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

⚠️ **Env files live at the MONOREPO ROOT, not in the app folder.** Both SPAs set
`envDir: '../../'` in their `vite.config.ts`, so Vite reads `.env` / `.env.<mode>`
from the repo root and never from `apps/pos/` or `apps/backend/`. Put the file in
the wrong place and the app boots with no env — `lib/supabase.ts` throws during
module evaluation, so you get a **blank white page with nothing in the console**,
which is very hard to diagnose. (`apps/pos/.env.houzs` is committed in the wrong
folder for this reason — copy it up before using it.) Ports: POS 6273,
Backend 6274, API 8787.

```bash
# First run on a fresh clone — node_modules is not committed
pnpm install

# Dev (all apps, via turbo)
pnpm dev

# Dev (single app)
pnpm --filter @2990s/pos dev
pnpm --filter @2990s/backend dev
pnpm --filter @2990s/api dev

# POS against the Houzs target (needs no 2990 secrets; .env.houzs has dummies).
# NOTE: no `--` separator — pnpm 10 forwards it to vite as a literal argument.
cp apps/pos/.env.houzs .env.houzs
pnpm --filter @2990s/pos dev --mode houzs

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
