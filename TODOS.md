# 2990's Portal — TODOs

Items deferred from `/plan-eng-review` 2026-05-08. All items here have explicit deferral reasons. Pull into a Phase plan when the trigger condition fires.

---

## T1 — Suppliers + product_supplier schema

**What:** Add `suppliers` and `product_supplier` tables to Drizzle schema. Replace the prototype's hardcoded `PO_SUPPLIER` mock (in `prototype/backend-orders.jsx`) with a real lookup.

**Why:** PoScanModal aggregates orders by supplier for the "Issue PO" workflow. Currently mocked by category (`mattress→SLP, sofa/bedframe→KFA, dining→OAK, ...`). Real suppliers will diverge — same category may have multiple suppliers; same product may have alt suppliers; suppliers have contact info, payment terms, lead times.

**Pros:**
- Unblocks Issue 12 (server-side `/api/po-aggregate`)
- Real PO generation needs real supplier data
- Audit trail of who supplied what

**Cons:**
- Phase 4+ feature — pilot has no real suppliers yet
- Complexity adds ~3 tables, ~15 columns

**Context:** The prototype already shows the UX (`PoScanModal` with supplier roll-up + by-order detail). Schema design: `suppliers (id, code, name, contact_email, contact_phone, lead_time_days, payment_terms, active)`. `product_supplier (product_id, supplier_id, sku_at_supplier, cost_price, lead_time_override, is_primary)`. Many-to-many; one product can have multiple suppliers, one is `is_primary=true`.

**Depends on / blocked by:** Phase 3 (order lifecycle) must be done first. Real supplier names come from Loo. Schema work is ~1 day; data entry follows.

**Trigger:** Phase 4 kickoff, OR the moment Loo has supplier contact list ready.

---

## T2 — Pricing audit history

**What:** Add `product_pricing_history` table to capture every change to per-Model pricing, with `changed_by`, `changed_at`, `reason`, before/after JSONB snapshots.

**Why:** Currently when admin edits Tanah's `1A-L` from 1690 → 1990, no record exists of who/when/why. For audit (refunds, customer dispute about prior pricing), legal compliance, and operational debugging ("why did margin drop in May?").

**Pros:**
- Audit trail for compliance + dispute resolution
- Operational insight (pricing trends per Model)
- Required if Loo wants to roll back pricing changes ever

**Cons:**
- Storage cost (small but compounding)
- Complicates pricing UPDATE flow (extra INSERT per change)

**Context:** Drizzle schema: `product_pricing_history (id, product_id, changed_by → staff.id, changed_at, reason text, before jsonb, after jsonb)`. Trigger on `product_compartments` / `product_bundles` / `product_size_variants` UPDATE captures the row. Or easier: API route writes a history row alongside the UPDATE in same transaction.

**Depends on / blocked by:** Decision 10 (admin SKU creation flow) must be live so there's pricing to audit. Add in Phase 2 or 3.

**Trigger:** First customer pricing dispute, OR end of pilot when reviewing pilot price changes.

---

## T3 — PWA push notifications (iOS 16.4+)

**What:** Wire Web Push for the Backend portal — coordinator gets a push when a new order arrives, even with browser tab closed.

**Why:** Currently coordinator must keep `backend.html` open. New order → toast appears in-tab. If coordinator's away from desk and hasn't installed PWA, missed orders. iOS 16.4+ supports Web Push for installed PWAs (limited support, evolving).

**Pros:**
- Coordinator stays out of "must keep tab open" mode
- Reduces missed orders during off-peak periods
- Free (no third-party push service if using Web Push API directly)

**Cons:**
- iOS 16.4+ only (older devices excluded)
- PWA must be installed (added to home screen) for push to work on iOS
- Permission UX is annoying — first time user gets "Allow notifications?" prompt
- Backend is desktop-first; coordinator typically at desk anyway

**Context:** Web Push API + service worker. Backend service worker registers push subscription with API. New order → server pushes via VAPID keys. Show notification with order ID + customer name. Click → opens drawer.

**Depends on / blocked by:** PWA infrastructure (Phase 1 if Backend also goes PWA, or later). Realtime is already wired so this is incremental.

**Trigger:** Coordinator complains about missing orders post-pilot, OR Phase 5 expansion.

---

## T4 — Bilingual switcher (中文 toggle)

**What:** Re-enable the `lang === 'cn'` toggle in POS handover/configurator. Source strings live in `i18n/{en,cn}/{pos,backend}.json`. Cloudflare-hosted, no service.

**Why:** Decision 4 in plan §10 says "Bilingual EN-only at pilot. 中文 toggle reactivates post-pilot." The wiring is already in the prototype; just disabled. Malaysian Chinese customers + showroom staff often prefer 中文 for receipts and product names.

**Pros:**
- Inclusivity for Chinese-speaking customers
- Brand alignment (Hiragino Sans GB font already in design system)
- Wiring exists — modest effort to enable

**Cons:**
- Translation work (every UI string needs 中文 equivalent)
- Maintenance burden (every new string needs both)
- Pilot doesn't need it

**Context:** Prototype uses `.t-cn` CSS class for 中文 type. Strings: ~150 UI strings + 50 brand-approved copy ("Same price. Always.", lane names, etc). Translator engagement needed (or Loo writes them himself).

**Depends on / blocked by:** Pilot feedback. If pilot customers explicitly ask for 中文, prioritize Phase 5+. Otherwise post-pilot.

**Trigger:** Pilot survey indicates ≥30% of customers prefer 中文, OR Loo decides to push for 中文-first marketing.

---

## T5 — Native iOS app (Capacitor or Expo)

**What:** Wrap the POS PWA in a native iOS shell for App Store distribution. Capacitor preferred (lighter, less ceremony than Expo).

**Why:** PWA covers 95% of need (Decision in §2.4 device targets). Native iOS adds: reliable push notifications, deeper iOS integrations (e.g., scan barcode via native camera SDK), App Store discoverability, no "Add to Home Screen" friction for new staff.

**Pros:**
- Polished install experience (App Store > "Add to Home Screen")
- Native push (no PWA-on-iOS limitations)
- Deeper hardware access if needed (NFC, barcode SDK, etc.)

**Cons:**
- App Store review process (1-2 weeks)
- $99/year Apple Developer Program
- Capacitor adds build complexity
- 95% of value already achieved with PWA

**Context:** Capacitor wraps a Vite SPA in a WKWebView. `npx cap init`, `npx cap add ios`, build into Xcode project. Code stays the same — just adds a native shell. Submit via TestFlight first, then App Store.

**Depends on / blocked by:** Pilot validation that PWA isn't enough. Apple Developer account purchase. Submission needs branding assets (icon, screenshots, App Store listing copy).

**Trigger:** Pilot reveals PWA install friction is hurting adoption, OR Loo wants App Store presence for brand reasons.

---

## T6 — Property-based testing for pricing

**What:** Add fast-check (or hypothesis-style) property tests for `packages/shared/src/pricing.ts` and `sofa-build.ts`.

**Why:** Pricing math has complex branching (bundle vs à la carte, recliner upgrades, multi-sofa, addon variants). Example tests catch known cases; property tests catch edge cases nobody thought of.

**Pros:**
- Higher confidence in pricing correctness
- Finds edge cases automatically (e.g., zero qty, negative, max safe integer)
- Catches regressions when refactoring

**Cons:**
- More test infrastructure
- Slower CI (property tests run thousands of iterations)
- Overkill for pilot if example tests already cover Phase 1 acceptance

**Context:** Vitest + fast-check. `test('addonPrice never negative for valid input', () => fc.assert(fc.property(fc.integer({ min: 1 }), fc.integer({ min: 1 }), (floors, items) => addonPrice(...).result >= 0)))`. Run as separate test suite tagged `[property]`, only on main branch CI.

**Depends on / blocked by:** Pricing functions implemented (Phase 1). Should be added in Phase 2 alongside server-side pricing recompute work.

**Trigger:** First pricing bug found in production, OR Phase 2 implementation start.

---

## T7 — POS PIN auto-lock (revisit post-pilot)

**What:** Add idle timer to POS — re-prompt for PIN after N minutes of inactivity.

**Why:** Decision 5 in §10 says "no auto-lock". Pilot may show that staff leave tablets unlocked at counter, exposing customer details + pricing to walk-by visitors.

**Pros:**
- Reduces accidental data exposure
- Aligns with phone/tablet lockscreen norms

**Cons:**
- Friction during active sales (sales staff has to re-enter PIN every N min)
- Decision 5 explicitly chose to skip this for pilot

**Context:** Idle timer in `apps/pos/src/lib/auth.ts`. On `staff` action → reset timer. After N min → show PinGate. Configurable threshold per role (sales 10 min, lead 15 min, coordinator never).

**Depends on / blocked by:** Pilot feedback. If first 2 weeks show ZERO incidents → keep no-auto-lock. If even one customer reports seeing prior order data → enable.

**Trigger:** Pilot retro identifies a privacy incident, OR a sales staff explicitly asks for it.

---

## T8 — Customer directory enrichment

**What:** Build out the `customers` table beyond placeholder. Add: order history per customer, repeat purchase detection (auto-merge by phone), notes / preferences, "interested in" tags, last contact date.

**Why:** Decision 6 in plan §10 says "Customers do NOT log in — internal directory only". Currently the `customers` table exists but is unused (orders snapshot customer fields denormalized). Coordinator value: "Lim Wei Ling bought a sofa last year — let's WhatsApp her about the new range."

**Pros:**
- Repeat-customer marketing
- Better service ("we know you")
- Foundation for loyalty post-pilot

**Cons:**
- Phase 4+ feature
- Privacy considerations (PDPA compliance if storing extensively)

**Context:** Currently `orders.customer_id` references `customers.id` (nullable). When sales fills handover form with phone matching existing customer → suggest "looks like Lim Wei Ling — link?". Backend portal `Customers` page (currently stub) shows directory + per-customer order history.

**Depends on / blocked by:** Phase 4. PDPA compliance review.

**Trigger:** Phase 4 kickoff.

---
