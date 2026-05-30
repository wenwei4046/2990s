# UI Reference — Production implementation contract

> **For Claude Code, and any dev/AI implementing 2990's Portal in production.**
> Read this before writing a single line of UI code.

---

## TL;DR

**The `prototype/` folder is the canonical UI specification.**
Visual design, motion, and functional behaviour must match it 100%.
**Deviation requires explicit written approval from Loo** — recorded in this doc's "Approved deviations" section.

When the prototype and your instinct disagree, **the prototype wins.**

---

## What "follow 100%" means — the four dimensions

### 1. Visual fidelity

Every pixel-level decision is already made and committed in the prototype's CSS. Reuse it directly:

| Aspect | Source of truth |
|---|---|
| **Colors** | `prototype/assets/colors_and_type.css` — `--c-cream`, `--c-beige`, `--c-orange`, `--c-burnt`, `--c-ink`, `--c-paper`, `--fg-muted`, etc. Never substitute hex values. |
| **Typography** | Same file — `--font-title` (Merriweather, headings), `--font-sans` (Poppins, body), `--font-button` (Raleway, buttons + eyebrows + sku codes), `--font-mark` (Archivo Black, the RM2,990 wordmark + price display), `--font-cn` (Hiragino Sans GB for 中文), `--font-mono` (sku codes). |
| **Spacing** | `--space-1` (4px) → `--space-10` (128px). Pull from `colors_and_type.css`. |
| **Border radii** | `--radius-xs` 6 / `-sm` 10 / `-md` 16 / `-lg` 24 / `-xl` 36 / `-pill` 999. |
| **Shadows** | `--shadow-1` (chip hover) / `-2` (default card) / `-3` (drawer/modal) / `-press` (active). |
| **POS class names** | `prototype/pos-styles.css` — `.pos-topbar`, `.pos-staff-chip`, `.cat-side`, `.cat-side__item`, `.prod-card`, `.prod-card__photo`, `.prod-card__badge`, `.prod-card__stock`, `.prod-card__add`, `.cart-fab`, `.sof-flow`, `.sof-qp`, `.sof-cust`, `.sof-cv__mod`, `.login__pad-key`, etc. **Use these exact names** when porting to React + Vite — they encode visual decisions you don't need to re-make. |
| **Backend class names** | `prototype/backend-styles.css` — `.be-shell`, `.be-rule-banner`, `.sku-row`, `.be-table`, `.sku-form-section`, `.sku-pricing-block`, `.sku-pricing-row`, `.sku-price-input`, `.be-addon`, etc. |

**How to verify:** open `prototype/index.html` and `prototype/backend.html` in a browser side-by-side with your production app. They should be visually indistinguishable except where listed under "Approved deviations" below.

### 2. Motion fidelity

The prototype's animations are restrained and intentional. Match their timing functions and durations exactly.

| Motion | Spec from prototype |
|---|---|
| **Page transitions** | `pageEnter` keyframe (`pos-styles.css` line ~111). 320ms `cubic-bezier(0.22, 1, 0.36, 1)`, opacity 0→1, translateY(10px)→0. Triggers on every step change (catalog → configurator → handover → confirmed). |
| **Card hover** | `translateY(-2px)`, shadow grows from `--shadow-2` to `0 12px 24px rgba(34,31,32,0.10)`. 200ms cubic-bezier(0.22,1,0.36,1). Applies to `.prod-card`, `.cart-fab`, `.sof-qp__card`. |
| **Button press** | `scale(0.98)`, `--shadow-press` inset. 100ms ease-out. Applies to `.btn--primary`, `.cat-side__item`, `.login__pad-key`. |
| **Add-to-cart pulse** | `.prod-card__add.is-pulsing` — 280ms one-shot. See `pos-screens.jsx` line ~239 — `setPulseId(p.id); setTimeout(() => setPulseId(null), 280)`. |
| **Toast slide-in** | 1600ms life. Slides up from bottom, fades. See `pos-screens.jsx` for trigger logic. |
| **Sofa module drag** | The configurator's drag-and-drop in Customize mode must feel exactly like the prototype. See `pos-sofa-config.jsx` `SofaCanvas` component for pointer event handling, snap thresholds, and group selection. Don't try to "improve" with a different library — the snap math + violation detection is tuned. |
| **Drawer open** | `.be-drawer` slides in from right, ~280ms. Backdrop fades to `rgba(34,31,32,0.32)`. |
| **Reduced motion** | `@media (prefers-reduced-motion: reduce)` disables `pageEnter`. Honour it. |

### 3. Functional fidelity

The flows are not redesignable without permission. Every step in the prototype must exist in production with the same inputs, outputs, and edge cases.

**POS flow (matches `index.html` step machine):**

1. **Login** — `LoginScreen` in `pos-screens.jsx`. Staff list → tap → 4-digit PIN pad. PIN error shakes dots red for 700ms. **Reproduce the PIN pad layout exactly** (3×4 grid, "Clear" + "0" + delete-icon row at bottom).
2. **Catalog** — `CatalogScreen`. Left rail with Categories / To be confirmed (SOON pills) / Quick. Top toolbar with search + series filter + count. 4-up product grid. Floating `cart-fab` bottom-right.
   - Sofa, mattress, bedframe cards open the **configurator** (gear icon = `sliders-horizontal`). Other cards add directly.
3. **Configurator** — `pos-configurator.jsx` + `pos-sofa-config.jsx`. Header crumb has depth tabs (24″ / 28″) and mode tabs (Quick Pick / Customize). The Customize mode is the most complex screen — see "Sofa configurator details" below.
4. **Cart** — `CartPanel`. Editable lines, qty steppers, addon section, subtotal. "Save quote" + "Continue to customer" buttons.
5. **Customer** — `pos-handover.jsx`. Form: name, phone, email, address, postcode, city, state. Optional emergency contact. Optional addons (disposal, lift, assembly, wrap, pillow set).
6. **Payment + Slip** — payment method (credit/debit/installment/transfer), approval code input, slip image upload (transfer only). Live total recap.
7. **Customer signature** — double-layer signature pad (terms acknowledgment + final receipt).
8. **Confirmed** — `pos-app.jsx` confirmation step. Order ID, summary, "New order" CTA back to catalog.

**Backend flow (matches `backend.html`):**

1. **Login** — same staff list pattern.
2. **Dashboard** — `backend-dashboard.jsx`. KPIs + recent orders + alerts.
3. **Orders** — `backend-orders.jsx`. Filterable list (lane / slip / search / date). Click row → drawer.
4. **Order drawer** — `backend-drawer.jsx`. Full detail: customer, items, payments, slip, lane history, dispatch tools.
5. **Verify slips** — pending queue. Open → see slip image + amount cross-check → Verified / Flagged.
6. **SKU Master** — `backend-catalog.jsx`. Per-Model pricing editor for sofas + size variants for mattresses/bedframes (see "Approved deviations" §1).
7. **Add-ons** — manager for the 6 addon products. Stock, price, enabled toggle.

**Functional invariants (don't break):**

- Order ID format: `SO-XXXX` (4-digit sequence, starts ≥2050).
- Sofa "closed" detection: `analyzeSofa` in `pos-sofa-config.jsx`. Don't reimplement.
- Bundle auto-detection: `detectBundle` in same file. When a custom build's signature matches a Quick Pick (e.g. `1A+2A` = 3-Seater), price by bundle if cheaper.
- Recliner upgrade: per-seat, only on 1A/2A/1NA/2NA modules. Toggle adds RM 990 (default; configurable per Model).
- Cart line-item shape: see `order-bridge.jsx` `buildBackendOrder()`. The production API contract for `POST /orders` mirrors this exactly.

### 4. Copy fidelity

The English copy is brand-approved. **Don't paraphrase.**

Examples that must stay verbatim:
- "Same price. Always."
- "Every piece in the catalog is RM2,990. No upsells, no comparison."
- "Pricing rules · per SKU"
- "Mattress & bedframe priced by size · Sofa priced by build (compartments + bundles, per Model). Toggle off any variant that doesn't apply to a specific Model."
- "Tap to add" (configurator palette)
- "Drag modules into the room" / "Empty room"
- "Customer order" (cart fab label)
- Stock pills: `12 in stock` (healthy) / `5 in stock` (low — orange + warning triangle)
- 6 lane labels: `01 Received` / `02 Proceed` / `03 Logistics` / `04 Ready` / `05 Dispatched` / `06 Delivered`
- 3-step POS breadcrumb: `01 CART` / `02 CUSTOMER` / `03 CONFIRMED`

When new copy is needed, draft it in the same voice (warm, sincere, calm, no hype) and check with Loo before shipping.

---

## Sofa configurator — extra detail

The sofa configurator is the most complex UI in the prototype. It deserves a dedicated section because it's where most "I'll just rewrite this" instincts go wrong.

**Two modes, one shared header:**

```
┌─────────────────────────────────────────────────────┐
│ [24″] [28″]    Quick Pick │ Customize               │  ← header crumb (sof-flow__modeTabs)
├─────────────────────────────────────────────────────┤
│                                                      │
│  Quick Pick mode:                                    │
│  ┌──────────┐  ┌─────────────────────────────────┐ │
│  │ Module   │  │  Plan-view hero canvas          │ │
│  │ rail     │  │  • PNG sofa image               │ │
│  │ • 1S     │  │  • Width dimension on top       │ │
│  │ • 2S     │  │  • Depth dimension on right     │ │
│  │ • 3S     │  │  • To-scale, ratio-locked       │ │
│  │ • 2+L    │  └─────────────────────────────────┘ │
│  │ • 3+L    │                                       │
│  │   [L|R]  │  (L/R flip pill appears for L-shape) │
│  └──────────┘                                       │
│                                                      │
│  Customize mode:                                     │
│  ┌──────────┐  ┌─────────────────────────────────┐ │
│  │ Palette  │  │  Canvas (room with grid)         │ │
│  │ groups:  │  │  • 50×50 cm grid legend          │ │
│  │ 1-seater │  │  • TV anchor at front            │ │
│  │ 2-seater │  │  • Drag to move modules          │ │
│  │ Corner   │  │  • Snap to other modules         │ │
│  │ L-Shape  │  │  • Per-cell tools: rotate, del   │ │
│  │ Accessory│  │  • Recliner toggle per seat      │ │
│  │   each:  │  │  • Group selection (whole sofa)  │ │
│  │   [art]  │  │  • Bundle pill: "3+L · save 500" │ │
│  │   ID     │  │  • Multi-sofa pill if 2+ groups  │ │
│  │   label  │  │  • Not Match pill if open        │ │
│  │   price  │  │  • Length pill (combined)        │ │
│  │   [+]    │  └─────────────────────────────────┘ │
│  └──────────┘                                       │
└─────────────────────────────────────────────────────┘
```

**Crucial behaviours that must be preserved:**

| Feature | Where in prototype | Why it matters |
|---|---|---|
| **24″ vs 28″ depth toggle** | `setActiveDepth()` in pos-sofa-config.jsx. Adjusts `__activeWidthOffsetPerCushion` to 0 or 10. | A 28″-deep sofa is ~10cm wider per cushion. Customer-visible dimension. |
| **L/R flip for L-shape Quick Picks** | `quickFlip` state in `SofaCustomFlow`. | Mirror art for left vs right chaise orientation. |
| **Bundle auto-detection** | `detectBundle(modIds)` checks signature like `1A+2NA+L` against `BUNDLES_SIGNATURE_MAP`. | Customer who builds `1A-L + 2NA + L-R` should be priced as 3+L bundle if cheaper. |
| **Sofa "closed" check** | `analyzeSofa(group)`. Returns `{closed, reason, dimW, dimH}`. | Open sofas (no arms on both ends) cannot be added to cart. UI shows "Not Match" pill + blocks Add-to-Cart. |
| **Group detection** | `groupSofas(cells)`. Cells touching = same sofa. Non-touching = separate sofas, priced independently. | Customer building a 2+L AND a separate armchair gets two line items, two prices. |
| **Per-seat recliner upgrade** | `getReclinerSeats`, `isSeatRecliner`, `toggleReclinerSeat`. Open animation: `isSeatReclinerOpen`. | Each upgraded seat = +RM 990 (configurable per Model — see Approved deviations §1). The "open" preview animates the footrest extension. |
| **Snap-to-edge while dragging** | `findSnap(draggedBbox, otherCells, ignoreId)`. Threshold ~12px. Snaps to align edges + abut. | Without snap, modules float disconnected. The whole point is they form a connected sofa. |
| **Arm conflict detection** | `hasArmConflict(cell, allCells)`. Two arms touching = invalid. | Visualised as red `is-violation` outline. |
| **Group bbox + outline** | `cellsBbox`, `groupBboxes`. Drawn around connected sofa group. | Visual feedback that "these 4 modules form one sofa." |
| **Plan-view PNGs** | `prototype/assets/sofa-modules/png/` — 22 files (1A-L, 1A-R, 1NA, 2A-L, 2A-R, 2NA, 1C-NW/NE/SE/SW, L-L/R, WC-45, plus bundle composites and recliner overlays). | Loo finalised these in a multi-session design effort. **Do not regenerate** — copy them as-is into the production assets folder. |

When porting this to React + Vite + RR7:
- Keep `pos-sofa-config.jsx` as the authoritative reference. Treat it as design doc, not legacy code to refactor.
- Lift the pure functions (`detectBundle`, `analyzeSofa`, `groupSofas`, `findSnap`, `hasArmConflict`, `quickPresetDims`) into `packages/shared/src/sofa-build.ts` so both POS client and API can use them (the API needs `analyzeSofa` to reject unclosed sofas in `POST /orders`).
- The drag-drop system uses raw pointer events with refs. **Don't substitute react-dnd** — the snap math is in absolute coordinates and any abstraction will fight it.

---

## Approved deviations from prototype

These are intentional changes from the prototype's current state. Anything not on this list is a regression and must be reverted to the prototype's behaviour.

### §1 · Per-Model sofa pricing (already merged into prototype/backend-catalog.jsx + prototype/pos-sofa-config.jsx)

**Approved on:** earlier in this thread.
**Status:** Already in `prototype/backend-catalog.jsx`, `prototype/pos-data.jsx`, and `prototype/pos-sofa-config.jsx` (Phase 1.5 complete). Production must implement it the same way.
**What changed:**
- Each sofa SKU carries its own `pricing.compartments[]`, `pricing.bundles[]`, `pricing.reclinerUpgrade`. Each compartment + bundle has `{active, price}`.
- Mattress and bedframe SKUs carry `pricing.sizes[]` with `{id, active, price}` (4 sizes: single / super-single / queen / king).
- SKU Master Drawer has a Pricing section that renders a `<PricingEditor>` component (sofa view OR size variants view OR TBC placeholder, based on category).
- Price column in SKU table shows `from RM X – Y` range computed via `pricingRange()`.
- POS catalog cards show `from RM X` (cheapest active variant) instead of fixed RM2,990. The brand voice copy adapts: "Every Model · honest pricing" replaces "Every piece is RM2,990. Always." in the SKU Master banner.
- **Phase 1.5 (the POS-side wiring) is now complete in the prototype.** The configurator threads `product` from `ConfiguratorScreen` → `SofaConfigurator` → `SofaCustomFlow`. Inside the flow, `pricing` is derived live from `window.PRODUCTS_STATE` (with `product.pricing` snapshot as fallback). Five new helpers — `modulePriceFor`, `bundlePriceFor`, `reclinerPriceFor`, `isCompartmentActive`, `isBundleActive` — replace the global hardcoded constants. The Customize palette filters out compartments where `active === false` (so Tanah hides corners, Petang hides everything but 1A/1NA). Quick Pick filters bundles the same way. An auto-correct `useEffect` slides the default preset to the first active bundle when the user opens a Model whose default is inactive (e.g. Petang's default would have been "2+L" but only "1S" is active).
- `MODULE_PRICE`, `QUICK_PRESET_PRICE`, `RECLINER_UPGRADE_PRICE` constants stay in the file as **graceful fallbacks** for legacy unscoped configurator opens (e.g. quote restore without product context). Don't delete them in the production port — keep the same fallback behavior.

### §2 · Multi-showroom support

**Approved on:** 6 May 2026.
**Status:** Schema-only at MVP. UI shows fixed "Showroom KL" until 2nd showroom is added.
**What changed in schema:**
- New `showrooms` table.
- `staff.showroom_id` (nullable — coordinators with NULL oversee all).
- `orders.showroom_id` (NOT NULL — every order tied to a showroom).
- `idx_orders_showroom` index for per-showroom dashboards.
**UI:** No change for pilot. The prototype's hardcoded "POS · Showroom KL" breadcrumb becomes dynamic from `staff.showroomId` lookup. When a 2nd showroom is added, sales staff log into their own showroom; coordinator drawer + dashboard get a showroom filter chip.

### §3 · POS desktop layout (≥1280px hover-and-pointer:fine)

**Approved on:** 2026-05-10
**Status:** Implementation plan at `docs/superpowers/plans/2026-05-11-pos-desktop-view.md`. Spec at `docs/superpowers/specs/2026-05-10-pos-desktop-view-design.md`.

**What changed:**
- POS gains a desktop breakpoint at `min-width:1280px` with `hover:hover` + `pointer:fine` guards. iPad Pro 12.9" without keyboard stays on tablet layout; with Magic Keyboard (or any pointing device) triggers desktop.
- Catalog: `<CartRail/>` mounts as a 320px right-side sticky panel at desktop. Layout grid changes from `240px 1fr` to `240px 1fr 320px`. Product grid auto-fills the middle lane.
- Topbar: iconBtn shrinks from 36px to 32px at desktop. Avatar 28px and 44px touch targets preserved on tablet.
- Cart route: refactored — `Cart.tsx` becomes a thin route wrapper around new `<CartContents variant="page"/>`. The same `<CartContents variant="rail"/>` powers the rail. No behavior change to `/cart` page.
- Save-quote panel hidden in rail variant (form is two-column and won't fit 320px). Save-quote remains available on the `/cart` route.
- Sofa configurator + CustomBuilder: explicitly untouched per `CLAUDE.md` red line #2. `1100px` max-width centered preserved on FHD.
- Handover: already responsive (default `.fieldRow` is 2-col grid). No changes needed.

**Resize edge case (acceptable for v1):** when the user crosses the 1280px breakpoint, `<CartRail/>` mounts/unmounts. CartContents local form state (e.g. mid-typed save-quote customer name) resets on unmount. Cart line items themselves persist via Zustand. If a user mid-quote-save resizes their window, they lose the typed name (not the cart). Acceptable trade-off; revisit if QA flags it.

**New code:** `apps/pos/src/hooks/useMediaQuery.ts` (+ test), `apps/pos/src/components/CartContents.tsx` + `.module.css` (extracted from `Cart.tsx`), `apps/pos/src/components/CartRail.tsx` + `.module.css`. New vitest + jsdom + `@testing-library/react` test infra in `apps/pos`.

**Not changed:** `prototype/` files (tablet-canonical and not desktop-aware), PWA manifest (`orientation: 'landscape'` is a no-op in desktop browsers), design tokens, routes, schema, API contracts.

### §4 · Per-brand catalog badge colours (mattress sub-brands)

**Approved on:** 2026-05-24 (Loo, with brand reference artwork for each).
**Status:** Implemented in `apps/pos/src/pages/Catalog.tsx` + `Catalog.module.css`.

**Why:** the mattress catalogue carries three real sub-brands (2990's / Carres / HappiSleep), seeded as `series` rows. The POS catalog card badge (`.photoBadge`, which renders `series.label`) was a single burnt-orange treatment for all. Loo wants each badge in its own brand identity so staff/customers read the brand at a glance.

**What changed:** the badge is keyed by `data-brand={series.id}`:
- `brand-2990s` → house orange (`--c-orange` #E86B3A) text on cream — the 2990's brand orange.
- `brand-carres` → Carres red-orange **#D44210** text on cream (sampled from the Carres wordmark).
- `brand-happisleep` → **inverted**: purple **#6259B2** fill + yellow **#FCE84D** text (sampled from HappiSleep brand artwork).

**Note on brand colours:** #D44210 / #6259B2 / #FCE84D are **sub-brand** identity colours, intentionally outside the 2990's house palette (cream/orange/burnt/ink). This is the one sanctioned place they appear — scoped to the brand badge only. The "Don't change the brand colours" rule still holds everywhere else.

---

## What NOT to do

Things that look like improvements but aren't:

- ❌ Don't substitute `shadcn/ui` or `Radix UI` components for the prototype's hand-built ones. The prototype's components match the brand spec; library defaults don't.
- ❌ Don't switch from CSS modules / vanilla CSS with tokens to **Tailwind**. The brand uses warm semantic tokens (`--c-cream`, `--fg-muted`) that Tailwind's design tokens don't map to. Mixing two systems creates drift.
- ❌ Don't replace Lucide icons with another icon set. Brand spec mandates Lucide rounded with stroke 1.75.
- ❌ Don't add gradients, glass effects, frosted backdrops, animated noise, neon glows, or any "modern AI app" decoration. The brand is flat and paper-like.
- ❌ Don't add emojis. Anywhere. Use Lucide.
- ❌ Don't change the order step machine (catalog → configurator → cart → customer → payment → signature → confirmed) to consolidate steps "for fewer screens". Each step exists for a reason.
- ❌ Don't replace the PIN pad with email login for sales staff. Counter switching is tap-and-go; full auth is for coordinators only.
- ❌ Don't replace the floating `cart-fab` with a sticky bottom bar or top bar. The fab is intentional — it doesn't compete with the catalog grid.
- ❌ Don't redesign the sofa configurator. Resist hard. The current design is the result of multiple Loo design reviews. (see "Sofa configurator — extra detail" above)
- ❌ Don't change the brand colors. `#FFF9EB` cream, `#E86B3A` orange, `#A6471E` burnt, `#221F20` ink. Use the CSS variables.

---

## How to flag a needed deviation

If you, the implementing dev/AI, believe a prototype behaviour should change for a real engineering reason (browser limitation, accessibility, performance, etc):

1. **Don't silently change it.** Don't even change it "temporarily."
2. Open a PR with the prototype unchanged but the production app showing your proposed alternative.
3. Tag Loo for review.
4. If approved, update **this document's "Approved deviations" section** with date, reason, scope.
5. THEN make the change.

The prototype always reflects current spec. If a change is approved but the prototype isn't updated to match, the next port-from-prototype session will silently regress it.

---

## How to use the prototype

- **POS app:** `open prototype/index.html` in any modern browser. Works offline. Login PINs are visible as hints (1234, 2345, 3456, 4567 — staff-specific).
- **Backend portal:** `open prototype/backend.html`. Logs in directly as Mei Lin (Coordinator).
- **Live order flow test:** open both at once. Place an order in POS → it appears in Backend's Dashboard within 200ms (via `localStorage` bridge in prototype; production uses Supabase Realtime).
- **Inspect the CSS:** `prototype/pos-styles.css` and `prototype/backend-styles.css` are the visual source of truth. Grep for any class name you encounter.
- **Inspect the data shape:** `prototype/pos-data.jsx` (categories, products with pricing, addons, staff) and `prototype/order-bridge.jsx` (order payload) define the API contract.

---

## Typography, Color & Format Standard (locked 2026-05-29)

Loo signed off: **accent colour stays orange**; fonts + sizes stay as the
existing tokens. This section is the single reference — every page must use
these tokens, never hard-coded fonts/sizes/hex. Tokens live in
`packages/design-system/src/tokens.css`.

### Fonts — NATIVE SYSTEM FONT (Loo 2026-05-29: serif strained the eyes)
The backend ERP uses the OS system font (Segoe UI on Windows, SF on macOS) for
titles, body, and buttons — all three tokens resolve to `--font-system`.
| Role | Token | Family |
|---|---|---|
| Page/section titles, KPI numbers | `--font-title` | system-ui (Segoe UI / SF) |
| Body, tables, inputs, labels | `--font-sans` | system-ui |
| Buttons, chips, tabs, eyebrow labels | `--font-button` | system-ui |
| Codes / SKUs / monospace cells | `--font-mono` | JetBrains Mono / system mono |
| 2990S wordmark only | `--font-mark` | Archivo (unchanged) |

### Type scale (use the token, not px)
- Page title `--fs-20` bold · subtitle `--fs-12` muted
- Section heading `--fs-14` semibold
- Table header `--fs-11` uppercase tracked, muted · body cell `--fs-13`
- Caption / hint `--fs-11`–`--fs-12` muted
- Weights: `--w-medium 500` · `--w-semibold 600` · `--w-bold 700`

### Colour
- Ink (body): `--c-ink` #221F20 · muted: `--fg-muted` #5C5455
- **Accent: `--c-orange` #E86B3A — accent ONLY** (CTAs, active state, shortage/warn). Never large fills.
- Surfaces: `--c-paper` (cards) on `--c-cream` (page). Lines: `--line` / `--line-strong`.
- Status: green = healthy/stock, blue = info/PO, orange = warn/shortage, red = error.

### Numbers & dates — ALWAYS via `@2990s/shared`
- Money (display): `fmtRM` / `fmtMoney`. Editing: `<MoneyInput>` (`components/MoneyInput.tsx`) — never a raw `<input type="number">`.
- Date: `fmtDate` → "4 May 2026" · `fmtDateOrDash` (→ "—" when null) · `fmtDateTime` → "4 May 2026, 11:20 AM". No ad-hoc `toLocaleDateString`.
- Phone: `formatPhone` (`@2990s/shared/phone`).

### Page frame
- Every page: `Breadcrumbs` (in Topbar) → title (`--fs-20` / title font) → subtitle (`--fs-12` / muted) → actions (right). Global Ctrl/Cmd+K palette always available.
- Empty/zero states show **"—"** + a short reason, never a bare `0.0%`.

*Rollout: new pages conform now; existing pages are swept onto these
helpers/components round by round (date helpers + a shared PageHeader).*

---

*This document is a living contract. Update the Approved deviations section every time Loo signs off on a change. Do not delete entries — they are the audit trail.*

*Maintainer: Loo (Chairman, HOUZS Venture). Implementer: Claude Code (or whichever AI/dev is doing the build).*
