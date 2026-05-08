# 2990's Portal — Master Port Design Doc

> Generated 2026-05-08 after a full deep-dive of `prototype/`.
> Companion to `2990S-PORTAL-PLAN.md` (architecture) and `UI_REFERENCE.md` (UI contract).
> This doc captures **what's in the prototype** + **how it ports** to the production stack.

---

## 0. How to read this doc

**Audience**: anyone porting `prototype/` → production (`apps/pos`, `apps/backend`, `apps/api`, `packages/*`).

**Authority order** (highest first):
1. `UI_REFERENCE.md` — UI/motion/copy contract; what NOT to change.
2. `2990S-PORTAL-PLAN.md` — architecture, locked decisions.
3. **This doc** — implementation reference; what each prototype file does and where it goes.
4. The prototype itself — visual/functional source of truth.

If this doc and the prototype disagree, the prototype wins.

---

## 1. Prototype inventory

### POS bundle (`prototype/index.html` loads in this order)

| File | KB | Role |
|---|---:|---|
| `pos-data.jsx` | 18 | Static catalog data — STAFF, CATEGORIES, PRODUCTS (with per-Model pricing), ADDONS, IMG. Library tables: `SOFA_COMPARTMENT_LIBRARY` (13), `SOFA_BUNDLE_LIBRARY` (5), `MATTRESS_SIZE_LIBRARY` (4), `BEDFRAME_SIZE_LIBRARY` (4). Pricing factories: `defaultSofaPricing`, `defaultMattressPricing`, `defaultBedframePricing`, `pricingRange`. **⚠ The 4 sofa Models (Noor/Tanah/Rumah/Petang), 4 mattresses, 3 bedframes, etc. are TESTIMONY/DEMO ONLY — NOT seeded into production. Loo seeds real SKUs via the Backend SKU Master (Decision 10).** Library tables (compartments/bundles/sizes/categories/series) DO seed; only the products array is demo. |
| `order-bridge.jsx` | 3 | localStorage bridge POS↔Backend. `pushOrderToBackend`, `subscribeBridge`, `buildBackendOrder`. **Replace with Supabase Realtime + `POST /orders`** in production. |
| `pos-screens.jsx` | 23 | `Topbar`, `LoginScreen` (4-digit PIN pad), `CatalogScreen`, `CartPanel` (FAB+popup), `QuotesDrawer`, `Avatar`, `Price`, `useLucide`. |
| `pos-handover.jsx` | 67 | `HandoverScreen` (8-step flow), `SignaturePad`, `DatePicker`, `CameraCapture`, `SummaryPanel`, `ConfirmScreen`, `PrintReceipt`, `PillowSummary`. |
| `pos-sofa-config.jsx` | 93 | The hardest file. `SofaCustomFlow` + `QuickPick` + `CustomizeMode` + `SofaCanvas` + `SofaModule`. Pure functions to lift: `detectBundle`, `analyzeSofa`, `groupSofas`, `findSnap`, `hasArmConflict`, `quickPresetDims`, `cellBbox`, `cellEffectiveBbox`, `cellsBbox`, `edgeContacts`, `cellEdges`, `rotateEdges`, `footprint`, `moduleWidth`, `seatRectsCm`, `reclinerEligible`, `seatCount`, `familySignature`. Plus pricing helpers `modulePriceFor` / `bundlePriceFor` / `reclinerPriceFor` / `isCompartmentActive` / `isBundleActive`. |
| `pos-configurator.jsx` | 59 | `ConfiguratorScreen` (header crumb + body), `BedConfigurator`, `MattressConfigurator`, `BedPlanView`, `MattressPlanView`, `SofaConfigurator` shim. Inline SVG icons (no Lucide because it conflicts with React reconciliation). |
| `pos-order-status.jsx` | 27 | `OrderStatusScreen` (3-lane board: Place / Proceed / Delivered), `OrderCard`, `OrderDetail`, `PinGate` (6-digit, hint `299000`), `seedSampleOrders`. `checkConditions` rule: customerInfoOk + addressOk + paidOk(≥50%) + dateOk → can proceed. |
| `pos-app.jsx` | 24 | Root state machine. Steps: `login` / `cart` / `configure` / `handover` / `confirm` / `order-status`. Owns: cart, customer, emergency, payment, delivery, addons, quotes, orders. `EMPTY_CUSTOMER` / `EMPTY_EMERGENCY` / `EMPTY_DELIVERY` shape. Tweaks panel (drop in production). |

**Legacy (do NOT port — replaced by `pos-handover.jsx`):**
- `pos-quote.jsx` (`QuoteTab`, `SofaQuote`, `SizeQuote`, `SavedQuotesList`) — earlier modular configurator with different compartment IDs (`arm-l`, `seat-2`, `chaise`, etc.). Superseded by `pos-sofa-config.jsx`.
- `pos-order-modal.jsx` (`NewOrderModal`, `CustomerStepModal`, `PaymentStepModal`, `SignStepModal`) — earlier checkout modal. Superseded by `HandoverScreen`.

### Backend bundle (`prototype/backend.html`)

| File | KB | Role |
|---|---:|---|
| `pos-data.jsx` | (shared) | Reused for products + payment methods. |
| `order-bridge.jsx` | (shared) | Subscribes to localStorage stream of new orders. |
| `backend-data.jsx` | 10 | `COORDINATOR` (Mei Lin), `LANES` (6), `SLIP_VERIFY` (4 states), `BE_ADDONS`, `SEED_DRIVERS`, `seedBackendOrders` (returns `[]` — populated via bridge). `_legacySeedBackendOrders` parked for re-enabling. |
| `backend-shell.jsx` | 4 | `Sidebar` (Workspace / Catalog / Reference groups), `Topbar` (search + alerts/help pills), `StatusPill`, `Wordmark`, helpers `fmtMoney` / `fmtDate` / `fmtTime` / `pieceCount` / `useLucideBE`. |
| `backend-dashboard.jsx` | 7 | `Dashboard` — KPI grid (New today, Dispatch today, Slips to verify, Collected), 6-lane strip, awaiting-slip queue. |
| `backend-orders.jsx` | 25 | `OrdersBoard` (overall kanban + per-lane drill-down via subtabs), `OrderCard`, `PoScanModal` (PO aggregation by supplier — `PO_SUPPLIER` / `SOFA_FABRIC` / `SOFA_COMPARTMENTS` / `MATTRESS_PILLOWS` / `buildPoLines`). |
| `backend-drawer.jsx` | 35 | `OrderDrawer` — order pipeline timeline (6 steps), items, customer, payment slip (with verify / flag), driver picker (lane=ready), logistics PO row (lane=logistics), DO upload (lane=dispatched), delivered confirmation. `generatePDF` via print-window. |
| `backend-catalog.jsx` | 51 | `SkuMaster` (filterable+sortable table, bulk visibility, per-row stock stepper), `SkuDrawer` (edit/create), `PricingEditor` → `SofaPricingEditor` / `SizePricingEditor` / `TbcPricingPlaceholder`, `PriceInput`, `ActiveToggle`, `SkuStat`, `Checkbox`, `useSkuState` (lives on `window.PRODUCTS_STATE`). Also: `AddonsManager`, `CustomersStub`, `SettingsPage` (drivers CRUD). |
| `backend-app.jsx` | 10 | Root. Page state: `dashboard` / `orders` / `verify` / `skus` / `addons` / `customers` / `settings`. Subscribes to bridge. Owns drivers + active order id + toast. Hosts inline `VerifySlips` page. |

### Assets

- `assets/colors_and_type.css` — brand tokens (THE source of truth for design system).
- `assets/imagery/` — 14 lifestyle photos (jpg).
- `assets/logo/` — 2 SVG (wordmark + circular mark).
- `assets/sofa-modules/png/` — **22 plan-view PNGs**. The 13 compartment + 5 bundle + 1R-OPEN/CLOSED + WC-45. Locked spec — do not regenerate.
- `assets/sofa-modules/*.svg` — 12 SVG variants (mini icons used by configurator palette).

---

## 2. Design system

### 2.1 Brand tokens (`colors_and_type.css`)

**Colors** (commit these to `packages/design-system/src/tokens.css` 1:1):

| Token | Hex | Use |
|---|---|---|
| `--c-cream` | `#FFF9EB` | Primary canvas background |
| `--c-beige` | `#E3D0A6` | Tan blocks / packaging |
| `--c-orange` | `#E86B3A` | Primary accent (10% rule — never flood) |
| `--c-burnt` | `#A6471E` | Deep emphasis / type |
| `--c-paper` | `#F4F3F2` | Studio white / photo backdrop |
| `--c-ink` | `#221F20` | Body type — never pure black |
| `--c-secondary-a` | `#2F5D4F` | Earth forest |
| `--c-secondary-b` | `#1F3A8A` | Trend blue |
| `--c-festive-a` | `#1F4A36` | Christmas green |
| `--c-festive-b` | `#B8331F` | Christmas red-orange |

**Foreground**: `--fg` = ink, `--fg-muted` = `#5C5455`, `--fg-soft` = `#8B7E6A`, `--fg-on-orange` = cream, `--fg-on-ink` = cream, `--fg-accent` = orange, `--fg-accent-deep` = burnt.

**Lines**: `--line` = `rgba(34,31,32,0.12)` / `--line-strong` = `rgba(34,31,32,0.28)`.

**Radii**: xs 6 / sm 10 / md 16 / lg 24 / xl 36 / pill 999.

**Shadows**: 1 (chip hover) / 2 (default card) / 3 (drawer/modal) / press (inset).

**Spacing**: 4px base. 1=4 / 2=8 / 3=12 / 4=16 / 5=24 / 6=32 / 7=48 / 8=64 / 9=96 / 10=128.

**Fonts**:
- `--font-sans` = Poppins → body
- `--font-title` = Merriweather → headings
- `--font-button` = Raleway → buttons / links / nav / eyebrows / sku codes
- `--font-script` = Caveat → hand-written accents
- `--font-mark` = Archivo Black → 2990 wordmark + price display
- `--font-cn` = Hiragino Sans GB → 中文 fallback chain
- `--font-mono` = ui-monospace → IC numbers, etc.

**Type scale**: fs-12 / 13 / 14 / 15 / 16 / 18 / 20 / 24 / 32 / 40 / 56 / 72 / 104. Each with `--lh-*` partner.

**Tracking**: tight (-0.02em) / base (0) / wide (0.06em) / loud (0.18em — for caps eyebrows).

**Weights**: light 300 / regular 400 / medium 500 / semibold 600 / bold 700 / black 900.

### 2.2 Semantic type classes

`.t-display` (104px Archivo Black 80% stretch) · `.t-h1` (56px Merriweather 900) · `.t-h2`–`.t-h5` · `.t-lede` (24px Poppins Light) · `.t-body` / `.t-body-lg` / `.t-body-sm` · `.t-eyebrow` (12px Raleway 600 caps loud-tracked) · `.t-button` · `.t-link` · `.t-script` (40px Caveat orange) · `.t-caption` / `small` · **`.t-price`** (72px Archivo Black 80% stretch burnt — the brand's hero element) · `.t-cn` (Hiragino Sans GB).

Helpers: `.fg-accent` / `.fg-accent-deep` / `.fg-muted` · `.bg-cream` / `.bg-beige` / `.bg-paper` / `.bg-orange` / `.bg-burnt` / `.bg-ink`.

### 2.3 The 8 brand commandments (enforced)

1. No "sale" / "discount" / strikethrough / "% off" / "was/now". The price IS the brand.
2. Orange = accent, never flood. 60/30/10 ratio (neutral / secondary / orange).
3. Rounded always — every `border-radius` uses a token, never a literal px.
4. Generous whitespace — section gaps ≥ `--space-9` (96px) on marketing surfaces.
5. **No emoji**, anywhere. Lucide rounded stroke 1.75 only.
6. Body type uses `#221F20` (`--c-ink`), never pure black.
7. No gradients on UI surfaces. Photography is the texture.
8. Bilingual EN-first, 中文 alongside via `.t-cn` (toggle off at pilot).

### 2.4 Device targets — POS = tablet-first, Backend = desktop-first

**This is a top-level design constraint, not a fallback strategy.** Sales staff use the POS on iPad. Coordinators use the Backend on desktop. Each app must be **designed and tested at its primary form factor first**, not retrofitted.

| App | Primary device | Min supported | Touch targets | Layout strategy |
|---|---|---|---|---|
| **POS** | iPad 10.9″ landscape (**1180 × 820** logical px) — installed as PWA, no Safari chrome | iPad mini landscape (1024 × 768) | **min 44 × 44 px** (Apple HIG) — every interactive element | **Landscape ONLY** — PWA manifest `orientation: 'landscape'` locks orientation. **Primary form factor**: salesperson holds iPad horizontal while designing custom sofas with customer (sofa configurator is the killer interaction). **No portrait support** — drop iPad portrait fallback. **Secondary**: desktop counter monitor (1366 × 768 typical, 1920 × 1080 max) — same layout, mouse + touch both work via pointer events. iPad Pro 12.9″ landscape (1366 × 1024) gets more whitespace, not different layout. Phone (home visits) is graceful-fallback only — feature parity not required. |
| **Backend** | Desktop 1440 × 900+ (Mac MBP / Windows full HD) | iPad landscape 1180 × 820 | min 36 × 36 px (mouse precision) | Desktop baseline at 1440 × 900. Sidebar collapses to icon-only at <1100 px (already wired in `backend-styles.css`). Tablet support is "coordinator picks up iPad ad-hoc", not primary workflow. Mobile not supported. |

**POS-specific tablet rules**:
- Every button, chip, swatch, toggle, stepper button: **min 44 × 44 px**. The prototype already does this (`.btn` is 40px, but `.btn--lg` is 52px — audit POS-touched buttons to use `--lg` variant where staff tap).
- All interactions use **pointer events** (covers mouse + touch + Apple Pencil with one code path). Sofa configurator drag-drop already does this — preserve.
- **No hover-only affordances** — anything reachable by hover must also be reachable by tap (the prototype already follows this; e.g., cart items show edit button by default, not hover-revealed).
- **Test on real iPad before pilot.** Specifically: sofa configurator drag-drop, signature pad pressure, slip camera capture (`getUserMedia` env-facing), date picker pinch-to-pan (it currently doesn't pinch — confirm OK with single-finger nav).
- **Safari quirks to watch**: `100vh` includes URL bar — use `100dvh`. `position: fixed` + `transform` jitters on scroll — already guarded in CSS via `cubic-bezier`. `<input type="date">` looks different on iOS — confirm it's still acceptable (or implement `<DatePicker>` ourselves, which the prototype does for delivery date).

**POS PWA installation (NOT via Safari at runtime)**:
- Use `vite-plugin-pwa` (Vite 6 first-class). Generates `manifest.webmanifest` + service worker.
- Manifest fields:
  ```json
  {
    "name": "2990's POS",
    "short_name": "POS",
    "display": "fullscreen",
    "orientation": "landscape",
    "background_color": "#FFF9EB",
    "theme_color": "#E86B3A",
    "start_url": "/",
    "icons": [
      { "src": "/icons/pwa-192.png", "sizes": "192x192", "type": "image/png" },
      { "src": "/icons/pwa-512.png", "sizes": "512x512", "type": "image/png" },
      { "src": "/icons/pwa-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
    ]
  }
  ```
- iOS-specific meta tags in `index.html`:
  ```html
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-180.png" />
  <meta name="theme-color" content="#E86B3A" />
  ```
- Install flow at pilot: Loo opens `pos.2990s.com.my` in iPad Safari → Share menu → "Add to Home Screen" → app icon appears on home screen → tap → fullscreen, no URL bar, looks native.
- Service worker scope: cache `/sofa-modules/png/*` (22 PNGs) + brand fonts + tokens for offline-soft (catalog + read OK offline; orders need online).
- **Native iOS via Capacitor/Expo deferred to post-pilot** — PWA covers 95% of need, less ceremony, no App Store review.
- **Backend portal stays browser-based** — desktop coordinator workflow doesn't need PWA install.

**Breakpoints** (from prototype CSS, keep these):
- 1280 (configurator narrows controls column)
- 1100 (configurator stacks tablets, backend collapses sidebar)
- 1024 (POS catalog narrows side rail, handover stacks)
- 880 (POS catalog hides side rail, login goes single-column)
- 720 (configurator stacks fully)

**QA matrix for the pilot**:
- POS: iPad 10″ **landscape only** (installed as PWA, also test in-Safari for first-install flow), iPad Pro 11″ landscape, desktop counter (1366 × 768 mouse), Safari iOS + Chrome iOS
- Backend: 1440 × 900 desktop Chrome + Safari, 1920 × 1080 Chrome, iPad landscape browser (smoke only — coordinator workflow is desktop)

### 2.5 Component primitives to build (`packages/design-system/src/components/`)

Built from prototype CSS (`pos-styles.css` + `backend-styles.css`). Class names are mandatory — the CSS is the source of truth.

**Cross-app**:
- `<Button variant="primary|ghost|text" size="sm|md|lg">` → `.btn` family
- `<IconButton>` → `.icon-btn`
- `<Chip variant="ink|ghost|burnt">`
- `<PriceTag amount={2990} size="sm|md|lg">` → `.t-price`
- `<Wordmark>` → 2990®
- `<Eyebrow>` / `<EyebrowSection>` → `.pos-eyebrow`
- `<Drawer side="right">` (POS quotes / Backend order detail / SKU edit)
- `<DataTable>` (orders + SKU + drivers)
- `<FormField>` / `<TextInput>` / `<TextArea>` / `<Select>` / `<DateInput>` / `<NumberInput>` / `<Toggle>`
- `<PriceInput>` (RM + numeric input combo, `.sku-price-input`)
- `<StatusPill tone="ok|warn|bad|muted">` → `.be-status`
- `<Toggle on/off>` → `.be-toggle`
- `<Checkbox>`
- `<Avatar initials color size>` → `.login__staff-avatar`
- `<Banner>` (rule banners — `.be-rule-banner`)
- `<KPI>` / `<StatTile>` (Dashboard)
- `<Toast tone>`

**POS-specific** (**tablet-first**, `apps/pos/src/components/`):
- `<BottomBar>` — sticky cart total + cancel + CTA
- `<StaffPin digits=4>` — login PIN pad
- `<PinGate digits=6>` — Order Status gate
- `<SignaturePad>` — `<canvas>` + DPR scaling + clear
- `<DatePicker>` — month grid with `EXP` express markers, past dates disabled
- `<CameraCapture>` — `getUserMedia({video: { facingMode: 'environment' }})` + canvas snap
- `<SofaConfigurator>` — the big one (see §3.4)
- `<MattressConfigurator>`
- `<BedConfigurator>` — size + colour + mattress gap (10/12/14/16/other)
- `<CartFAB>` + `<CartPanel>` (popup)
- `<QuotesDrawer>` — saved quotes browser
- `<HandoverStepper>` — 7-step pill bar across 2 phases (4 + 3)
- `<AddonCard>` — qty / floors-items / flat variants
- `<PaymentRecap>` — sub + addons + delivery + total

**Backend-specific** (**desktop-first**, `apps/backend/src/components/`):
- `<Sidebar>` — left rail nav, group headings, badge counts
- `<Topbar>` — title + sub + search + alerts/help pills
- `<OrdersBoard>` — overall kanban (6 lanes) + per-lane drill-down with subtabs
- `<OrderCard>` — id, customer, photos collage, total, status pills, staff initials
- `<OrderDrawer>` — pipeline timeline (clickable steps with gating), items, customer, slip, driver picker (lane=ready), DO upload (lane=dispatched), PDF print
- `<TimelineSteps>` — 6-step progress with done/current/blocked states
- `<PoScanModal>` — supplier roll-up + by-order detail; SKU + colour + qty per supplier; "Generate PO" actions
- `<SkuTable>` — bulk-select header, photo, name+pills, sku-mono, series chip, size, stock stepper, price range, visibility toggle, pencil
- `<SkuDrawer>` — photo picker (thumbs from `IMG`), identity (name/category/sku/series/size/detail), inventory (stock + lowAt), `<PricingEditor>` (category-aware), visibility row
- `<PricingEditor>` (category-aware: SofaPricingEditor / SizePricingEditor / TbcPricingPlaceholder)
- `<DriverPicker>` (radio list with active-only filter)
- `<DOUpload>` — file/PDF accept, replace flow
- `<BulkActionBar>`
- `<SkuStat>` (filterable stat cards)
- `<VerifySlipsRow>`
- `<DashboardHero>` (greeting + KPI grid + lane strip)

---

## 3. POS architecture

### 3.1 Step machine

```
        ┌──────────┐
        │  login   │  4-digit PIN (skipped in dev)
        └────┬─────┘
             ▼
        ┌──────────┐    ── (FAB → quotes drawer)
        │   cart   │◄───── (load saved quote)
        └────┬─────┘
             │ tap product (sofa/bedframe/mattress only)
             ▼
        ┌──────────┐
        │ configure│  Sofa / Bed / Mattress tabs (locked when scoped)
        └────┬─────┘
             │ Add to Cart  ─→ back to cart
             │ OR Convert to Sales Order
             ▼
        ┌──────────┐
        │ handover │  7 sub-steps (Customer → Address → Emergency → Date → Addons+Payment → Confirm payment → Sign)
        └────┬─────┘
             ▼
        ┌──────────┐
        │ confirm  │  Order ID + receipt + "New order" CTA
        └──────────┘

Top-bar shortcuts: → order-status (PIN-gated 6-digit, hint 299000)
```

### 3.2 Login (`LoginScreen`)

Two-pane: left photo with editorial quote, right panel with staff list + PIN dots + 3×4 keypad ("Clear"/"0"/delete row).
- Tap staff → PIN pad activates
- Type 4 digits → auto-validate (180ms delay if correct, 700ms shake if wrong)
- Hint shows the PIN in dev (`pin: ${selected.pin}`) — STRIP in production
- 4 staff seeded in `STAFF` (AW=2990, JM=1234, RL=4321, SN=0000)

**Production**: replace PIN auth with Supabase Auth `signInWithPassword({email, password})` for full-fat auth, OR call `/auth/staff-pin { staffCode, pin }` which the API verifies against a bcrypt `pin_hash` on the `staff` table. PIN must be tied to a session that expires fast (e.g. 30 min idle).

### 3.3 Catalog (`CatalogScreen`)

Three-column: left rail (Categories / TBC / Quick) + main grid (4-up product cards) + floating cart FAB.

- `useMemoC` filters by category + series + free-text search
- TBC categories show in own section with "Soon" pill, disabled
- Sofa / bedframe / mattress cards open configurator (icon: `sliders-horizontal`)
- Other categories add directly with 280ms pulse animation + toast
- "Same price. Always." reassurance copy at rail bottom

**Production**: `useQuery(['products'], () => api.products.list())` with TanStack Query. `staleTime: 30s`. Supabase Realtime subscribe to `products` table → invalidate cache.

### 3.4 Configurator — the heart of the POS

**Wrapper** (`ConfiguratorScreen`, `pos-configurator.jsx`):
- 3 tabs: Sofa / Bed / Mattress (locked to the category opened from)
- Header has back button, mode tabs slot (rendered by SofaCustomFlow via `ReactDOM.createPortal` into `#cfg-header-slot`), Live Total panel with hover breakdown popup
- Footer CTA: "Add to Cart" (when `lockTab` and `onAddToCart`) OR "Save & close" + "Convert to Sales Order"
- Inline SVG icons via `cIcon()` (NOT Lucide — see comment in file: Lucide swaps `<i>` for `<svg>` outside React's knowledge → corrupts fiber tree on next reconcile)

**Sofa flow** (`SofaCustomFlow`, `pos-sofa-config.jsx`):

State: `{ depth: '24'|'28', mode: 'quick'|'custom', quickPreset, quickFlip: 'L'|'R', customCells: Cell[] }`

`Cell = { id, moduleId, x, y, rot: 0|90|180|270, recliners?: [{seatIdx, open}] }`

**Per-Model pricing pull** (Phase 1.5 wiring):
```js
pricing = window.PRODUCTS_STATE.find(p => p.id === product.id).pricing
       ?? product.pricing  // snapshot fallback
       ?? undefined        // → global constants
```
Five lookup helpers: `modulePriceFor(id, pricing)`, `bundlePriceFor(id, pricing)`, `reclinerPriceFor(pricing)`, `isCompartmentActive(id, pricing)`, `isBundleActive(id, pricing)`. Each falls back gracefully to the global constants when pricing is missing.

**Auto-correct**: when the current `quickPreset` is inactive in this Model's pricing, slide to the first active bundle. (Petang has only `1S` active → defaults from `'2+L'` slide to `'1S'`.)

**Quick Pick** (`QuickPick`):
- Left rail: 5 preset cards (1S / 2S / 3S / 2+L / 3+L), each filtered by `isBundleActive`
- Right hero: PNG with measured tight bbox + tape-measure dim callouts (length top, depth right)
- L-shape presets get an L/R flip pill on top of the active card

**Customize** (`CustomizeMode`):
- Left palette grouped by `1-seater` / `2-seater` / `Corner` / `L-Shape` / `Accessory`. Filters by `isCompartmentActive`.
- Center: room canvas with 50cm grid + TV anchor at front (140cm × 30cm + 40cm clearance) + sight-line beam.
- Tap palette → spawn cell next to existing bbox (or center-front for first cell)
- Drag cell → live `findSnap` (12-cm threshold, edge-to-edge or flush)
- Selected cell shows tools (rotate 90° CW + remove)
- Per-seat recliner toggles (+R button) — eligible on 1A/2A/1NA/2NA only. Open/close toggles footrest extension (35cm) + safety zone (25cm).
- Group selection: tap whole-sofa outline → drag moves rigid group; "Edit modules" button to drop back to per-cell.
- Multi-sofa: separate connected sofas detected via `groupSofas`; each priced independently. Pill: "2 sofas" / "Sofa A + Sofa B".

**Pure functions** (must be lifted to `packages/shared/src/sofa-build.ts`):

| Function | Input | Output | Used by |
|---|---|---|---|
| `findModule(id)` | string | `SOFA_MODULES` entry | UI + price calc |
| `moduleWidth(m)` | module | cm (24" or 28" aware via `__activeWidthOffsetPerCushion`) | layout |
| `setActiveDepth('24'\|'28')` | depth | sets internal offset | call once per render |
| `footprint(m, rot)` | module + rot | `{w, h}` (rotated) | layout |
| `cellBbox(cell)` | cell | `{x,y,w,h}` cm | snap + group + render |
| `cellEffectiveBbox(cell)` | cell | bbox extended by FOOTREST when open | dim line |
| `cellsBbox(cells)` | cells | union bbox | sofa group dim |
| `findSnap(bbox, others, ignoreId)` | bbox + cells | `{dx, dy}` ≤ SNAP_CM | drag end |
| `edgeContacts(a, b)` | 2 cells | `[{edgeA, edgeB}]` | grouping + violations |
| `groupSofas(cells)` | cells | array of cell groups | multi-sofa pricing |
| `analyzeSofa(group)` | one group | `{violations, closed, reason, leftArm, rightArm}` | closure check |
| `hasArmConflict(cell, all)` | cell + cells | bool | auto-flip mirror on drop |
| `cellEdges(cell)` | cell | `[W,N,E,S]` of `'arm'\|'open'\|'back'\|'front'` | analyze |
| `rotateEdges(edges, rot)` | edges + deg | rotated edges | analyze |
| `familySignature(modIds)` | string[] | sorted family signature like `'1A+2NA+L'` | bundle detect |
| `detectBundle(modIds)` | string[] | bundle def or null | pricing |
| `quickPresetDims(presetId, depth)` | id + depth | `{w, d}` cm | quick pick hero |
| `seatRectsCm(m)` | module | seat rects with native + visual span | recliner overlay |
| `reclinerEligible(modId)` | string | bool | recliner UI |
| `seatCount(modId)` | string | 0/1/2 | recliner UI |

Plus: `MODULE_EDGES_BASE`, `ROTATE_NEXT`, `MIRROR_PAIR`, `BUNDLE_BY_SIG`, `SOFA_MODULES`, `QUICK_PRESETS`, `CONTACT_TOL`, `SNAP_CM`, `FOOTREST_CM`, `TV_W`/`TV_H`/`TV_GAP`, `EDGE_W/N/E/S` constants.

**Closure rule** (`analyzeSofa`):
- Build contact map (every edge-pair touching another cell)
- Any arm-arm OR arm-anywhere collision → violation (rendered as red "Not Match" pill at the midpoint)
- Determine dominant axis from group bbox (W >= H ⇒ horizontal)
- Both dominant-axis ends must have an arm OR L-cap (the L module's far end self-closes)
- Accessory-only group (just a console) → "Console needs a sofa next to it"
- Any open sofa → blocks Add to Cart with `lineItem.blocked = true`, `lineItem.blockedReason = "Sofa is not closed — add arms to both ends or close any arm-to-arm collisions."`

**Bundle auto-detection**:
- For each connected sofa group, compute `familySignature` (excludes accessories)
- Lookup `BUNDLE_BY_SIG[sig]` → if matches AND `isBundleActive(id, pricing)` AND bundle.price < àLaCarteTotal → use bundle price
- Recliner upgrades stack on top: `reclinerCount * reclinerPriceFor(pricing)`

**Bed configurator** (`BedConfigurator`):
- Size (4) + colour (6) + mattress gap (10/12/14/16/Other inches)
- Plan view: headboard + frame outline + mattress area + dim labels
- Single price per Model from `product_size_variants`

**Mattress configurator** (`MattressConfigurator`):
- Size (4) + 2 free Memory pillows + paid extras (Memory RM89 / Latex RM109)
- Plan view scaled to KING max so smaller sizes look smaller

**Snapshot shape** sent to cart on "Add":
```ts
{
  activeTab: 'sofa'|'bed'|'mattress',
  sofa:     { depth, mode, quickPreset, quickFlip, customCells },
  bed:      { sizeId, colourId, gapId, gapOther },
  mattress: { sizeId, freePillows: { memory, latex }, extraPillows },
  lineItem: {
    kind, title, sub, total, breakdown[],
    sofas?: SofaItem[],   // multi-sofa custom builds
    pillows?: { free, extra, extraCost },
    blocked?, blockedReason?,
  }
}
```

### 3.5 Handover (`HandoverScreen`)

**7 steps in 2 phases**:

| # | Step | Required to advance |
|---|---|---|
| 0 | Customer | name + phone + email |
| 1 | Delivery address | (address + postcode + billing OK) OR `addressLater` |
| 2 | Emergency contact | name + phone |
| 3 | Target date | date OR `tbd` |
| — | _phase divider_ | |
| 4 | Add-ons & payment | payment method picked |
| 5 | Confirm payment | amount valid (≥50%) + approval code + slip attachment + `paid` flag |
| 6 | Sign & confirm | `signed` flag |

**Step 4 add-ons**: 3 kinds — `qty` (per-piece), `floors` (lift access; floors 1+2 free, 3rd floor and above billable: `(floors-2) × items × perFloorItem`), `flat`.

**Step 5 payment**:
- Min deposit 50% (rounded up), default = full payment
- Quick chips: 50%, 70%, 100%
- Approval code REQUIRED
- Slip attachment REQUIRED — file upload OR `<CameraCapture>` (`getUserMedia` env-facing camera) → snap to JPEG dataUrl
- "Confirm payment received" → 1.4s spinner → `paid` flag set

**Step 6 signature**: `<canvas>` with DPR scaling + pointer events. `onChange(true)` first time the user touches.

On `Complete order`, calls `onComplete({ paidAmount, approvalCode, slipDataUrl, total, addonTotal, subtotal })`.

`SummaryPanel` (right rail): items (with sofa multi-card explode for `lineItem.sofas`), addons, customer, emergency, delivery, payment, totals.

### 3.6 Confirm + receipt

`ConfirmScreen`: hero check ✓ + greeting + "your N pieces will arrive on…" + New order CTA + Print receipt.

`PrintReceipt` (only visible in print mode via CSS `@media print`): letterhead + greeting + customer/delivery grid + itemised table (with sofa modules sub-row + pillow rows) + totals + 2 signature lines.

### 3.7 Order Status (PIN-gated)

`PinGate` 6-digit (hint `299000`). 3 lanes:
- 01 Place — paid but timing/address still pending
- 02 Proceed — fully confirmed (info OK + ≥50% paid + address + date)
- 03 Delivered — read-only mirror from Backend portal

`checkConditions(o)` = customerInfoOk + addressOk + paidOk(≥50%) + dateOk → all four → can advance to Proceed.

`OrderDetail` drawer lets sales staff edit name/phone/email/address/postcode/city/date AND record additional payments + approval code + slip photo (lane=place only). "Move to Proceed" gated on `cond.allOk`.

### 3.8 Quotes drawer (`QuotesDrawer`)

Saved quotes list — 3-photo collage, customer name, piece count, saved date, total. Load → restore cart + customer + activeQuote → land on cart screen. Delete via icon.

Quote ID format: `Q-XXXX` from `1000 + quotes.length + 1`.

### 3.9 Tweaks panel — DROP

Both apps have a `<TweaksPanel>` with theme/density/demo controls (sample order, seed quotes, skip login). **Do not port.** Brand has one canonical `--c-cream`; theming was for prototyping.

---

## 4. Backend architecture

### 4.1 Page router

State: `page: 'dashboard'|'orders'|'verify'|'skus'|'addons'|'customers'|'settings'`. Title bar context table:

| Page | Title | Sub |
|---|---|---|
| dashboard | Today's desk | Order Coordinator · Mei Lin Chua |
| orders | Orders | 01 received → 06 delivered |
| verify | Verify payment slips | Verify only · Finance approves |
| skus | SKU master | Every piece · RM2,990 |
| addons | Add-on products | Disposal, lift, assembly, extras |
| customers | Customers | Read-only directory |
| settings | Settings | Workspace preferences |

### 4.2 Sidebar

Three groups: **Workspace** (Dashboard / Orders / Verify slips) · **Catalog** (SKU master / Add-on products) · **Reference** (Customers / Settings). Each item: icon + label + optional badge count. Footer: avatar + Mei Lin Chua + role.

### 4.3 Dashboard

- Hero card: greeting + script-font number ("eight orders need a careful look today") + 4 chips (received/proceed/logistics/dispatched)
- KPI grid (4): New today (with delta vs yesterday), Dispatch today, Slips to verify, Collected today
- Lane strip (6) — clickable to jump to that lane in OrdersBoard with `focusLane` set
- Awaiting slip queue (top 4 pending) — clickable to open OrderDrawer

### 4.4 Orders board

Two view modes:
- **Overall** — 6-column kanban, each column = a lane; cards stack vertically per lane
- **Per-lane** — single big column for one lane (clicked from subtab)

Subtabs row above: Overall + 6 lane buttons (each shows count).
Filter row: All/Running late/Last 24h tabs + search box + Filter/Export pills.

`OrderCard`: id + when + customer name + city + 3-photo collage (+more N) + total + slip pill + Late pill (if `delivery.date < now && lane !== 'delivered'`) + "Issue PO" pill (if `lane === 'logistics' && !poIssued`) + staff initials + delivery date.

**Per-lane view** for `logistics` shows a "Scan PO needed" CTA → opens `<PoScanModal>`.

### 4.5 PO Scan Modal

Aggregates all logistics orders without `poIssued`:

- **Roll-up by supplier** (default view): for each supplier, table of SKU + name + size + colour + qty + from-orders. "Generate PO" button per supplier.
- **By-order detail**: for each order, group by supplier, expand each line:
  - Sofa → split into compartments (`SOFA_COMPARTMENTS[productId]` mock; production reads from `order_items.config`)
  - Mattress → mattress + paired pillows (`MATTRESS_PILLOWS[productId]`)
  - Other → single line

`PO_SUPPLIER` mapping by category (mattress→SLP, sofa/bedframe→KFA, dining→OAK, bathroom→AQS, kids→KID, accessory→HMG) — production should move this to a `suppliers` + `product_supplier` table.

### 4.6 Order Drawer (`OrderDrawer`)

Sections:
1. **Status timeline** — 6 clickable steps (received → delivered). Click forward 1 step (gated on conditions per lane); click backward unrestricted (ish).
2. **Items** — products + addons; addons price computed: `qty * def.price` OR `floors × items × 50` for lift.
3. **Customer** — read-only info grid + sales notes.
4. **Payment slip** — fake DUITNOW preview + verify metadata. Buttons "Mark verified" / "Flag for sales" when `slipVerify === 'pending'`. "Verify only" banner with explanation.
5. **Driver picker** (lane=ready) — radio cards from active drivers. Confirmed delivery date input + confirmation note. Override warning if `confirmedDeliveryDate !== delivery.date`.
6. **Logistics note + Issue PO** (lane=logistics) — textarea + PO row with "Issue PO" button.
7. **DO upload** (lane=dispatched) — file/PDF input → `URL.createObjectURL` (production: R2 presigned PUT).
8. **Delivered confirmation** (lane=delivered) — driver, deliveredAt, DO file name.

Footer: "Generate PDF" (opens print window with HTML invoice); "Step back" + "Move to next" (gated on lane-specific blockers); special "Mark as delivered" button on lane=dispatched.

**Lane gating**:
- received → proceed: set by POS, not coordinator
- logistics → ready: requires `poIssued` AND a `window.confirm` for "stock in warehouse"
- ready → dispatched: requires `driverId` AND `confirmedDeliveryDate`
- dispatched → delivered: requires `doUrl`

### 4.7 Verify Slips page

Inline component in `backend-app.jsx`. Filter tabs: Awaiting check / Verified / Flagged / All. Row: avatar (first product img) + customer + id + piece count + placed time + staff + amount + method icon + status pill + chevron → opens drawer.

### 4.8 SKU master

`useSkuState` hook maintains `window.PRODUCTS_STATE` so POS reads live edits.

**Stat strip** (4 clickable filter cards): All / Low stock / Hidden / TBC.

**Filter row**: category tabs (live + divider + TBC subtler) + series select + search.

**Bulk action bar** appears with selection: Show on showroom / Hide / Export CSV / Clear.

**Table columns**: checkbox, photo, product (name + tbc/hidden pills + detail), sku-mono, series chip, size, stock (stepper +/-), price (range "from RM X – Y" via `pricingRange`), visible toggle, edit pencil.

**`<SkuDrawer>`** sections:
- Photo picker (one main + thumbnail row from `IMG`)
- Identity: display name / category / sku / series / size / detail
- Inventory: stock stepper + low-at threshold
- **`<PricingEditor>`** (category-aware):
  - Sofa: `<SofaPricingEditor>` — 3 blocks (Compartments grouped by `compGroup` + Bundles + Recliner upgrade single row). Each row has `<ActiveToggle>` + ID label + name + `<PriceInput>`. "All on" / "All off" bulk buttons per block.
  - Mattress/Bedframe: `<SizePricingEditor>` — single block of 4 sizes with toggle + dim label + price input.
  - Other: `<TbcPricingPlaceholder>` — "Pricing scheme not finalised for {cat}".
- Visibility row: on/off toggle.

**Effects**:
- When `cat` changes in drafting, auto-suggest SKU code as `{prefix}-{nextN}` based on existing.
- When `cat` changes, auto-seed `pricing` shape if it doesn't fit (`size_variants` ↔ `compartments+bundles`).

### 4.9 Addons manager

Grid of cards (one per addon): icon + label + desc + enable toggle + price input + per-unit + stock + history/edit icons. "Add new add-on" tile at end.

### 4.10 Customers stub + Settings

- Customers: stub page, "Coming next" message.
- Settings: Drivers CRUD (form: name/phone/IC/vehicle; table: id, name+addedDate, phone, IC, vehicle, status toggle, edit, remove). "Working hours" section coming soon.

---

## 5. Cross-app contracts

### 5.1 Order data shape (POS → API → Backend)

From `order-bridge.jsx` `buildBackendOrder`. Production form to be Zod-schemaed in `packages/shared/src/schemas/order.schema.ts`:

```ts
{
  id: string,                              // 'SO-XXXX' — server generates
  placedAt: number,                        // ms epoch
  staffId: UUID,                           // server fills from JWT
  showroomId: UUID,                        // server fills from staff.showroomId
  lane: 'received',                        // always for new orders
  customer: { name, phone, email, address, postcode, city, state },
  emergency: { name, phone, relation } | null,
  cart: [{ productId, qty, config?: {
            depth, mode, quickPreset?, quickFlip?,
            customCells?: [{moduleId, x, y, rot, recliners?: [{seatIdx, open}]}],
            // OR
            sizeId? (mattress/bed),
            colourId?, gapId?, gapOther? (bed),
            freePillows?, extraPillows? (mattress),
          } }],
  addons: [{ id, qty?, floors?, items? }],
  delivery: { date, slot, tbd, notes },
  paymentMethod: 'credit'|'debit'|'installment'|'transfer',
  approvalCode: string,
  slipKey?: string,                        // R2 key (production)
  // Money — submitted by client for verification, recomputed by server:
  clientSubtotal, clientAddonTotal, clientPaid, clientTotal,
}
```

API response on success: full server-computed order with `id`, recomputed totals, `placedAt`.

### 5.2 Pricing — server-side recompute (NON-NEGOTIABLE)

Pure functions live in `packages/shared/src/pricing.ts` — both client and `apps/api/src/lib/pricing.ts` import from same source.

```ts
function computeOrderTotal(order, productsState, addonsState): {
  subtotal, addonTotal, total,
  perItem: [{itemIdx, kind, title, total, breakdown}]
}

function computeSofaPrice(cells, pricing): {
  groups: [{
    closed, reason, bundle?, bundlePrice, aLaCarteTotal,
    reclinerCount, reclinerExtra, finalPrice
  }],
  total
}

function computeMattressPrice(sizeId, freePillows, extraPillows, pricing): {
  base, pillowExtra, total, breakdown
}

function computeBedframePrice(sizeId, pricing): { total }

function computeAddonPrice(addon, def): number
```

API `POST /orders` flow:
1. Verify JWT, set Postgres role for RLS
2. Validate Zod schema
3. Read `app_config.pricing_version` — capture as `currentPricingVersion`
4. For each cart item, recompute total via pure functions
5. Recompute addon totals
6. If `|server.total - client.total| / server.total > 0.005`, **return HTTP 409 Conflict** with `{ kind: 'pricing_drift', server: {subtotal, addonTotal, total}, client: {subtotal, addonTotal, total}, perItem: [{itemIdx, kind, title, server, client, breakdown}], pricingVersion: currentPricingVersion }`. **Do NOT 400** — the request format is valid; only the totals drifted.
7. Else INSERT INTO `orders` + `order_items` in TRANSACTION (stamp `pricing_version = currentPricingVersion`)
8. INSERT INTO `order_lane_history` with `from=null, to='received'`
9. Generate `SO-XXXX` via `next_order_id()` sequence
10. If `slipKey`, set `slip_state = 'pending'`, INSERT INTO `order_slip_events` event=`'uploaded'`
11. Return order

### 5.2.1 Client recovery flow on 409 (Codex P2.3 fold, 2026-05-08)

Hard-rejecting a customer-facing transaction is operationally hostile. POS preserves the entire confirm step state (customer dto, payment method, signature data, slipKey, addon selections) and surfaces a `<PricingDriftModal>`:

> "Pricing was updated while you were filling this in. New total: **RM 3,180**. Original total: **RM 2,990**. Differences: SOF-001 1A-L 1500 → 1600 (+RM 100), SOF-001 2A-R 2100 → 2190 (+RM 90)."

Modal CTAs:

- **"Accept new total + place order"** — POS updates client cart totals from `server` payload, re-POSTs `/orders` immediately. State preserved. Server side this should now succeed (same `pricingVersion`).
- **"Cancel — return to cart"** — customer/staff review changes, can drop or re-quote.
- (Optional escape hatch, **admin only**, **NOT visible to sales**) "Override and force original total" — requires `staff.role IN ('admin','finance')` and writes `order.notes` with `[PRICE_OVERRIDE: original=2990 server=3180 by=ADMIN_X]`.

Phase 1 acceptance gate: this flow must work end-to-end before order placement is considered complete. Unit test the modal, integration test the re-POST. Do not ship Phase 2 with TODO 'pricing drift recovery'.

### 5.3 Sofa-build pure functions

All listed in §3.4 table. They sit in `packages/shared/src/sofa-build.ts`. Tests must cover:
- `analyzeSofa` returns `closed=true` for valid sofas (1S, 2S, 3S, 2+L, 3+L)
- `analyzeSofa` rejects: open sofa (`'No arms on either end'`), arm-arm collision, arm-blocked-by-module
- `detectBundle` matches `1A+2NA+L` → `3+L`
- `findSnap` snaps within 12cm threshold, no further
- `groupSofas` separates two non-touching sofas correctly
- `cellEffectiveBbox` extends FOOTREST when recliner open, on each rotation (0/90/180/270)

### 5.4 Bundle auto-detection rules

```
Quick lookup:
  '1A'         → 1S
  '2A'         → 2S
  '1A+2A'      → 3S
  '2A+L'       → 2+L
  '1A+2NA+L'   → 3+L
```

Family map: `1A-L` → `1A`, `1A-R` → `1A`, `1NA` → `1NA`, `1C-NW`/`NE`/`SE`/`SW` → `1C`, `L-L`/`L-R` → `L`, `WC-45` → excluded (accessory).

Apply rule: bundle wins ONLY if `bundle.price < aLaCarteTotal` (and bundle is `active` in this Model's pricing).

### 5.5 Real-time push (replace localStorage)

Backend subscribes:
```ts
supabase
  .channel('orders')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, ({ new: o }) => onNewOrder(o))
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, ({ new: o }) => onOrderUpdated(o))
  .subscribe();
```

POS doesn't subscribe to orders (writes only). Both apps subscribe to `products` so SKU master edits appear in POS catalog within ~300ms.

---

## 6. State management plan

| Concern | Technology | Where it lives |
|---|---|---|
| Server cache (products, orders, drivers) | TanStack Query | `apps/*/src/lib/api.ts` |
| App state (cart, customer, configurator state, current step, toasts) | Zustand | `apps/pos/src/stores/` |
| Form state (cart line edit, customer form, SKU drawer) | React Hook Form + Zod | shared schemas in `packages/shared/src/schemas/` |
| Auth session | Supabase Auth client | `apps/*/src/lib/auth.ts` |
| Real-time push | Supabase Realtime | `apps/*/src/lib/realtime.ts` |
| Per-Model pricing | TanStack Query (mirrors `window.PRODUCTS_STATE`) | `apps/pos/src/lib/api.ts` |

**Zustand stores** (POS):
- `useSession` — staff, signed-in time, idle timer for PIN re-prompt
- `useCart` — items, customer, emergency, delivery, payment, addons, addConfigured(), saveQuote(), restoreQuote()
- `useConfigurator` — activeQuote, sofa state, bed state, mattress state, lineItem snapshot
- `useToast` — toast queue
- `useQuotes` — saved quotes (or stored in Supabase as `quotes` table; TBD post-pilot)

---

## 7. Port mapping (prototype file → production location)

| Prototype | Production location |
|---|---|
| `pos-data.jsx` PRODUCTS / CATEGORIES / etc | `packages/db/src/seed/` SQL + `packages/shared/src/constants/` for static lookups (LANES, PAYMENT_METHODS, ADDONS schema) |
| `pos-data.jsx` library tables | `packages/db/src/schema/catalog.ts` + `seed-libraries.sql` (already done) |
| `pos-data.jsx` pricing factories (`defaultSofaPricing`, etc) | `packages/shared/src/pricing/factories.ts` |
| `pos-data.jsx` `pricingRange` | `packages/shared/src/pricing/range.ts` |
| `order-bridge.jsx` | DELETE — replaced by Supabase Realtime + `apps/api/src/routes/orders.ts` |
| `pos-screens.jsx` `Topbar` | `apps/pos/src/components/Topbar.tsx` |
| `pos-screens.jsx` `LoginScreen` | `apps/pos/src/routes/_index.tsx` (RR7 root) |
| `pos-screens.jsx` `CatalogScreen` | `apps/pos/src/routes/pos._index.tsx` |
| `pos-screens.jsx` `CartPanel` | `apps/pos/src/components/cart/CartPanel.tsx` |
| `pos-screens.jsx` `QuotesDrawer` | `apps/pos/src/components/QuotesDrawer.tsx` |
| `pos-handover.jsx` `HandoverScreen` (steps 0-3) | `apps/pos/src/routes/pos.customer.tsx` |
| `pos-handover.jsx` `HandoverScreen` (steps 4-6) | `apps/pos/src/routes/pos.payment.tsx` + `pos.payment.confirm.tsx` + `pos.payment.sign.tsx` |
| `pos-handover.jsx` `SignaturePad` | `packages/design-system/src/components/SignaturePad/` |
| `pos-handover.jsx` `DatePicker` | `packages/design-system/src/components/DatePicker/` |
| `pos-handover.jsx` `CameraCapture` | `apps/pos/src/components/CameraCapture.tsx` |
| `pos-handover.jsx` `SummaryPanel` | `apps/pos/src/components/SummaryPanel.tsx` |
| `pos-handover.jsx` `ConfirmScreen` | `apps/pos/src/routes/pos.confirmed.$orderId.tsx` |
| `pos-handover.jsx` `PrintReceipt` | `apps/pos/src/components/PrintReceipt.tsx` (CSS print-only) |
| `pos-sofa-config.jsx` pure functions | `packages/shared/src/sofa-build.ts` |
| `pos-sofa-config.jsx` `SofaCustomFlow` + `QuickPick` + `CustomizeMode` + `SofaCanvas` + `SofaModule` | `apps/pos/src/components/configurator/sofa/` |
| `pos-configurator.jsx` `ConfiguratorScreen` | `apps/pos/src/routes/pos.config.$productId.tsx` |
| `pos-configurator.jsx` `BedConfigurator` / `MattressConfigurator` | `apps/pos/src/components/configurator/{bed,mattress}/` |
| `pos-configurator.jsx` `BedPlanView` / `MattressPlanView` | same dirs |
| `pos-order-status.jsx` `OrderStatusScreen` | `apps/pos/src/routes/pos.orders.tsx` |
| `pos-order-status.jsx` `PinGate` | `apps/pos/src/components/PinGate.tsx` |
| `pos-order-status.jsx` `seedSampleOrders` | DELETE (Supabase has live data) |
| `pos-app.jsx` step machine | RR7 routing + Zustand `useCart`/`useConfigurator` |
| `pos-app.jsx` `<TweaksPanel>` | DELETE |
| `pos-quote.jsx`, `pos-order-modal.jsx` | DELETE (legacy, superseded) |
| `backend-data.jsx` LANES / SLIP_VERIFY / BE_ADDONS | `packages/shared/src/constants/lanes.ts` + `slips.ts` + `addons.ts` |
| `backend-data.jsx` SEED_DRIVERS | DB seed |
| `backend-data.jsx` `seedBackendOrders` | DELETE |
| `backend-shell.jsx` `Sidebar` / `Topbar` | `apps/backend/src/components/Sidebar.tsx` + `Topbar.tsx` |
| `backend-shell.jsx` helpers | `packages/shared/src/utils/format.ts` |
| `backend-dashboard.jsx` `Dashboard` | `apps/backend/src/routes/be._index.tsx` |
| `backend-orders.jsx` `OrdersBoard` | `apps/backend/src/routes/be.orders._index.tsx` |
| `backend-orders.jsx` `PoScanModal` | `apps/backend/src/components/orders/PoScanModal.tsx` |
| `backend-drawer.jsx` `OrderDrawer` | `apps/backend/src/routes/be.orders.$id.tsx` (slot-out drawer) |
| `backend-drawer.jsx` `generatePDF` | `apps/backend/src/lib/pdf.ts` (or server-side render endpoint) |
| `backend-catalog.jsx` `SkuMaster` | `apps/backend/src/routes/be.skus._index.tsx` |
| `backend-catalog.jsx` `SkuDrawer` | `apps/backend/src/routes/be.skus.$id.tsx` |
| `backend-catalog.jsx` `PricingEditor` family | `apps/backend/src/components/sku/PricingEditor/` |
| `backend-catalog.jsx` `AddonsManager` | `apps/backend/src/routes/be.addons.tsx` |
| `backend-catalog.jsx` `CustomersStub` | `apps/backend/src/routes/be.customers.tsx` |
| `backend-catalog.jsx` `SettingsPage` | `apps/backend/src/routes/be.settings.tsx` |
| `backend-app.jsx` `VerifySlips` | `apps/backend/src/routes/be.verify.tsx` |
| `backend-app.jsx` page router | RR7 routing |
| `pos-styles.css` | `packages/design-system/src/pos.css` (or split per component) |
| `backend-styles.css` | `packages/design-system/src/backend.css` (split per component) |
| `assets/colors_and_type.css` | `packages/design-system/src/tokens.css` (1:1) |
| `assets/imagery/` | `apps/pos/public/imagery/` + `apps/backend/public/imagery/` (or hosted via R2 once SKU photos move there) |
| `assets/sofa-modules/png/` | `apps/pos/public/sofa-modules/png/` (PNGs are configurator art — must be local for snappy load) |
| `assets/sofa-modules/*.svg` | `apps/pos/public/sofa-modules/` |
| `assets/logo/` | `packages/design-system/src/assets/` |

---

## 8. Risks / non-trivial bits

1. **Sofa configurator drag-drop precision** — uses raw pointer events with absolute coordinates. Don't substitute react-dnd; the snap math is in cm and any abstraction will fight it. Test on real iPad before pilot.
2. **PNG bbox measurement** (`measureBbox`) — done client-side via `<canvas>` ImageData. **Cross-origin tainted** if PNGs are served from R2 without proper CORS. Either (a) serve module PNGs from same origin (`apps/pos/public/`) — RECOMMENDED, OR (b) configure R2 CORS + `crossOrigin="anonymous"` on the Image.
3. **Lucide reconciliation crash** — `lucide.createIcons()` swaps `<i>` for `<svg>` outside React's tree; this corrupts the fiber tree on subsequent renders. The configurator works around this with inline SVG via `cIcon()`. **Production**: use `lucide-react` (proper React components) instead of the global `lucide.createIcons()` script.
4. **State machine vs RR7** — POS step machine in prototype is a single state (`step`). Production RR7 file-based routing means each step is its own URL. Need to handle browser back button, deep-linking to `pos/payment` with empty cart, etc.
5. **Quote vs Order ID** — prototype mixes `Q-XXXX` (saved quotes) and `SO-XXXX` (placed orders) and `ORD-XXXXXX` (legacy in `pos-order-modal.jsx`). Keep `Q-` for quotes, `SO-` for orders. ORD format is dead.
6. **Address picker in pos-order-modal.jsx** — uses a `MY_STATES` array (state → cities → postcodes) that ISN'T in the codebase. This is dead code now that `pos-handover.jsx` uses a free-text `<input>` for address (with state/city/postcode as plain inputs). Keep it simple — production uses free text + dropdown for state only.
7. **PIN security** — `STAFF[].pin` plaintext in `pos-data.jsx` for prototype. Production stores `pin_hash` (bcrypt) on `staff` table and verifies via API.
8. **Tweaks panel demo** has actions like "Send sample order" that hit `pushOrderToBackend`. These do NOT port. Strip both apps' Tweaks UI before deploy.
9. **`orders.id = TEXT 'SO-XXXX'`** — Drizzle can't model the `next_order_id()` function default. Set the column default in raw SQL (already in `seed-libraries.sql`). All API code should NOT pass `id`; let the DB default fill it.
10. **Soft delete for products** — `DELETE` is destructive but `visible=false` is the brand-friendly soft delete (also in spec). Backend SKU drawer shows `<Remove SKU>` button — production should rename to "Hide" + confirm "Are you sure? Hidden SKUs can be restored from the Hidden filter."
11. **Lane gating UX** — backend drawer's timeline shows clickable past steps. Be careful: clicking backwards on `delivered` shouldn't undo the DO sign-off. Prototype has minimal protection; production must add an `audit/who_did_it` trail (hooked to `order_lane_history`).
12. **PO suppliers** — prototype has `PO_SUPPLIER` mocked by category. Real product-supplier relationships live in `suppliers` + `product_supplier` tables (NOT YET IN SCHEMA). Phase 4+ work.

---

## 9. Phase-by-phase port order

| Phase | Files to port | Exit criteria |
|---|---|---|
| **0 · Scaffold** | (nothing from prototype) — pnpm workspace, 3 apps, packages/, Drizzle schema applied to Supabase, brand tokens copied | `pnpm dev` runs, deploy preview works |
| **1 · Catalog (admin-driven seed)** | `backend-catalog.jsx` (SkuMaster + SkuDrawer + **PricingEditor end-to-end**), `pos-screens.jsx` (Topbar + CatalogScreen + CartPanel), Address cascading-dropdown table seeded | Loo (admin) creates 1 sofa Model + 1 mattress + 1 bedframe through Backend SKU Master UI; POS catalog shows them within ~300ms via Realtime; Sales places a real order; backend receives with correct totals. **No prototype seed data used — empty catalog at boot, populated through admin UI**. |
| **1.5 · Sofa lift** | `pos-sofa-config.jsx` pure functions → `packages/shared/src/sofa-build.ts` + tests | All pure-function tests green |
| **2 · Order placement** | `pos-configurator.jsx` (ConfiguratorScreen + Bed/Mattress/Sofa configurators), `pos-handover.jsx` (HandoverScreen + SignaturePad + DatePicker), `pos-app.jsx` step machine via RR7 | E2E: place order in POS, see it in BE within 1s; server-side pricing recompute rejects tampered totals |
| **3 · Order lifecycle** | `backend-orders.jsx` (OrdersBoard), `backend-drawer.jsx` (OrderDrawer minus driver/DO), `backend-dashboard.jsx`, `backend-app.jsx` VerifySlips, `pos-order-status.jsx` (3-lane POS view with PIN gate) | Coordinator moves orders through 6 lanes, history records each transition |
| **4 · Slip + dispatch + delivery** | `pos-handover.jsx` slip upload → R2 presigned PUT, `backend-drawer.jsx` driver picker + DO upload, PoScanModal, `backend-catalog.jsx` SettingsPage drivers | Sales uploads slip; Coordinator verifies in <30s; dispatch + DO sign-off complete |
| **5 · Hardening** | RLS policies, Sentry, CF Analytics, bilingual switcher, customer directory, PrintReceipt polish | Full RLS test pass; bilingual EN+中文 toggle works |

---

## 10. Locked decisions (2026-05-08)

All 10 questions answered by Loo. These are now **non-negotiable** for Phase 0+.

| # | Decision | Implementation impact |
|---|---|---|
| 1 | **Saved quotes** → Supabase `quotes` table | Drizzle schema in `schema.ts` (added 2026-05-08 post-codex): `quotes (id 'Q-XXXX', showroomId, createdBy, customer snapshot, cart JSONB, addons JSONB, subtotal/addonTotal/total, pricingVersion, expiresAt, promotedToOrderId, createdAt, updatedAt)`. **Server-recomputes totals on save** (not trusted from client). RLS: `createdBy = auth.uid()` for sales (own quotes only); admin/showroom_lead bypass — see §11.1 Issue 7. POS reads/writes via TanStack Query. |
| 2 | **PDF receipt** → server-side render (Workers + Puppeteer) | Use Cloudflare **Browser Rendering API** (separate paid subsystem on Workers Paid plan). Endpoint `POST /receipts/{order_id}` returns signed PDF URL stored in R2 (`receipts/{order_id}.pdf`, 24h signed). Print-window remains in code as fallback for showroom printer. |
| 3 | **Address** → state → city → postcode cascading dropdowns | Drizzle table `my_localities (id, postcode, city, state, stateCode)` in `schema.ts` (added 2026-05-08). Postcode is NOT unique — multiple cities share prefixes; queries filter by state→city→postcode. Form behavior: select state → cities load → select city → postcodes load. Replace ALL free-text address inputs in `pos-handover.jsx` with the cascading component. Source data: vetted public dataset (yusufusoff/malaysia-postcodes or equivalent MIT/CC0). RLS: SELECT for all authenticated; INSERT/UPDATE admin only. |
| 4 | **Slip storage** → `slips/{order_id}/{uuid}.{ext}` private R2 | UUID per upload (replacement keeps old files for audit). Signed GET URL only when coordinator opens drawer (60s TTL). Server validates MIME on PUT (`image/jpeg \| image/png \| application/pdf` per Decision 7). Pre-order uploads tracked via `pending_slip_uploads` table with reaper lease (see §11.1 Issue 3) — full schema with status/contentHash/contentSize/retryCount/leaseExpiresAt fields in `schema.ts`. |
| 5 | **PIN auto-lock** → NONE (manual logout only) | Match prototype behavior. No idle timer. Re-evaluate post-pilot if any incident. Sales staff use lockscreen on the tablet OS instead. |
| 6 | **TweaksPanel** → DELETED | Hardcode `body[data-theme='cream']` + `body[data-density='calm']` directly in `apps/{pos,backend}/src/main.tsx`. Drop entire `<TweaksPanel>`/`<TweakSection>`/`<TweakRadio>`/`<TweakButton>`/`useTweaks` infrastructure. Confirmed locked values: **surface = cream · card density = calm**. |
| 7 | **DO upload** → accept image (jpg/png) + PDF | API: `accept: 'image/jpeg, image/png, application/pdf'`. Driver phone camera produces image; office scanner produces PDF. Both must work. |
| 8 | **Showroom topbar** → dynamic from `staff.showroom_id` → `showrooms.name` | Wire via TanStack Query at app load. When `staff.showroom_id IS NULL` (coordinator), show `"All showrooms"`. Phase 0 has 1 row ("Showroom KL") so dynamic just shows that string. |
| 9 | **Currency display** → INTEGER RM, never `.00` anywhere | Hard rule across **every** surface (POS UI, Backend UI, print receipt, server-rendered PDF, email, WhatsApp confirmations). Format: `RM2,990` (with optional `<sup>RM</sup>2,990` for hero). Audit the codebase: replace any `.toLocaleString('en-MY')` that emits `2,990.00` with integer `2,990`. Print receipt's `RM ${fmtMoney(p.price)}` is currently OK; CSS `.summary__row .val` emits `.00` — needs fix. |
| 10 | **Production starts with EMPTY catalog** — all prototype SKUs are testimony | The 4 sofa Models (Noor/Tanah/Rumah/Petang), 4 mattresses, 3 bedframes, dining/bathroom/kids/accessories — **all demo data**. Loo (admin role) seeds real SKUs via Backend SKU Master after deploy. Library tables (compartments/bundles/sizes/categories/series/showrooms/staff/drivers) DO seed; only `products` and per-product pricing tables (`product_compartments`, `product_bundles`, `product_size_variants`) start empty. **This decision supersedes** the earlier `CLAUDE.md` red line "Don't seed pricing data that conflicts with `prototype/pos-data.jsx` — port those." Prototype's hand-set per-Model pricing is now a **reference for testing only**, not seed data. CLAUDE.md updated 2026-05-08 to align. |

### Critical implication of Decision 10 — Phase 1 redefined

The **end-to-end admin SKU creation flow** is now Phase 1's exit gate. Loo (admin role) must be able to do this through the UI, with no developer intervention:

1. Log in to backend portal (Supabase Auth, admin role)
2. Click "New SKU" → blank `<SkuDrawer>` opens in create mode
3. Fill: photo (from `IMG` thumb picker — or upload custom later) / name / category / SKU code (auto-suggested `SOF-001` etc) / series / size / detail / stock / low-at threshold
4. Set per-Model pricing via category-aware `<PricingEditor>`:
   - **Sofa**: toggle 13 compartments + 5 bundles `active`, set per-row price (RM integer), set `reclinerUpgrade` (RM integer or 0 to disable)
   - **Mattress/Bedframe**: toggle 4 sizes `active`, set per-row price
   - **TBC categories** (dining/bathroom/kids/accessory): show TbcPricingPlaceholder, no pricing fields (Phase 4+)
5. Click "Create SKU" → `POST /products` with embedded pricing → server validates Zod schema → server inserts `products` + `product_compartments`/`product_bundles`/`product_size_variants` in transaction → returns full record
6. **Realtime push** (Supabase channel `products`) fires to POS → TanStack Query invalidates `['products']` → POS catalog re-renders within ~300ms
7. Sales staff (POS) sees the new SKU appear → opens it → configurator pulls `pricing` from `window.PRODUCTS_STATE` (or production equivalent) → all per-Model logic works (active filters, bundle detection per-Model, recliner upgrade per-Model)
8. Sales places an order → `POST /orders` → server-side pricing recompute uses the **same** `pricing` row → totals match → order persists → backend receives via Realtime

**Phase 1 acceptance test (concrete):**
- Loo creates SOF-001 "Acme 3-seater" with all compartments active, 1A-L=1500, 2A-R=2100, 1NA=900, recliner=990. Hits Save.
- Within 5s, POS catalog shows SOF-001 with photo + "from RM 900".
- Sales taps SOF-001 → configurator opens with Acme's pricing (not the global fallback constants).
- Sales builds 1A-L + 1NA + 2A-R, sees "Bundle 3S detected, save RM" if bundle is cheaper, OR sum à la carte = 4500.
- Sales adds to cart → handover → place order → server recomputes total from Acme's pricing → matches → order lands in Backend.
- Coordinator verifies the order → moves through 6 lanes → delivered.

If any step breaks, Phase 1 isn't done.

---

*This document is the implementation reference. Update it when porting decisions diverge.*
*Next step: /plan-eng-review on this doc → adjust → start Phase 0.*

---

## 11. Eng review additions (2026-05-08)

`/plan-eng-review` surfaced 12 issues; all decided. These additions are locked alongside §10.

### 11.1 Architecture (7 decisions)

| # | Issue | Decision | Implementation impact |
|---|---|---|---|
| 1 | Phase 0 admin bootstrap chicken-and-egg | **Migration trigger keyed on `app_config.owner_email` row** (NOT a CF/Vite env var — Postgres triggers cannot read those). Bootstrap migration seeds `app_config(key='owner_email', value=…)`; trigger on `auth.users INSERT` compares new row's email to `app_config.owner_email` and auto-creates matching `staff` row (`role='admin'`, `staff_code='OWNER'`). Admin can `UPDATE app_config` later (e.g. ownership transfer) without redeploy. | New migration `0042_owner_bootstrap.sql`. Idempotent. Phase 0 deploy: `INSERT INTO app_config(key,value) VALUES ('owner_email','wenwei4046@gmail.com')` then `pnpm db:push`. **Codex P1.8 fold (2026-05-08)**: original env-var design was fragile across dev/staging/prod and trigger-side env access. |
| 2 | Pricing freshness across configurator session + SW cache | **Realtime push + SW stale-while-revalidate**. Configurator subscribes to `products` Realtime channel for the active product; on UPDATE, re-derive `lineItem` and show toast "Pricing updated". SW (vite-plugin-pwa Workbox) uses `StaleWhileRevalidate` for `/api/products*` — instant cache + background fetch. | New: `apps/pos/src/lib/realtime.ts` Realtime hooks. Workbox runtime caching config in `apps/pos/vite.config.ts`. |
| 3 | Slip orphan on POST /orders failure | **`pending_slip_uploads` table with full upload state machine** (NOT just `promoted boolean`). Schema in `schema.ts`: `id, uploadSessionId UNIQUE (idempotency key), staffId, showroomId, r2Key, contentType, contentHash (sha256), contentSize, status enum (pending/uploaded/promoted/failed), retryCount, errorMsg, claimedBy, leaseExpiresAt, expiresAt, promotedAt, promotedToOrderId`. Flow: presigned PUT issues `pending` row → client confirms → API HEADs R2 + verifies hash + size → row goes `uploaded` → POST /orders promotes (`promoted` + sets promotedToOrderId) in same TX. Reaper: `SELECT FOR UPDATE SKIP LOCKED WHERE status IN ('pending','uploaded') AND expires_at < now() AND (claimed_by IS NULL OR lease_expires_at < now())`, set `claimed_by + lease_expires_at = now() + 1min`, then DELETE R2 object + DELETE row. **Lease prevents two reaper instances racing.** | Drizzle table done (2026-05-08). New CF Worker `reaper-pending-slips.ts` via `wrangler.toml` cron trigger (every 10 min). RLS: no client access — `service_role` only. |
| 4 | Server-side PDF scope | **Defer Browser Rendering integration to Phase 5** (when email-receipt ships). Phase 1-3 use print-window only — both showroom counter ("Print receipt" CTA) AND backend coordinator ("Generate PDF" CTA). No Browser Rendering API cost during Phase 1-3. | Drop the "Workers + Puppeteer" wiring from Phase 0/1 scaffold. Print-window code in `pos-handover.jsx` (`PrintReceipt` component) and `backend-drawer.jsx` (`generatePDF`) ports as-is. |
| 5 | Postcode seed source | **Vetted public GitHub dataset** (e.g., `yusufusoff/malaysia-postcodes` or equivalent MIT/CC0). License + completeness verified before seed. Coverage: 14 states + 3 federal territories, ~3000 entries. Free-text fallback for any postcode not found (rare). | One-time seed script: download CSV → transform to schema → INSERT into `my_localities`. Document the source URL + license + accessed date in `seed-libraries.sql`. |
| 6 | API contract / Zod schema sharing | **drizzle-zod auto-generates DB-row schemas** + hand-written Zod for higher-level shapes (Cart, ConfiguratorState, Order POST body). Both client + server import from `packages/shared`. CI enforces via `pnpm typecheck`. | `packages/shared/src/schemas/index.ts` exports both auto-generated (`productSelectSchema = createSelectSchema(products)`) AND hand-written (`orderPostSchema`). drizzle-zod added to `packages/db/package.json`. |
| 7 | RLS policies for ALL tables (not just new ones) | **Phase 0 migration MUST include RLS policies** — *not* deferred to Phase 5 hardening. A staff portal storing customer PII / payment data without RLS at first deploy is a data-exposure risk. Per-table policy spec: **`quotes`** — sales: own (`created_by = auth.uid()`); showroom_lead/coordinator: same showroom; admin: all. **`my_localities`** — SELECT all authenticated; INSERT/UPDATE admin only. **`pending_slip_uploads`** — no client access (`service_role` only). **`payments`** — sales: read on own showroom orders only; finance/coordinator: read all + insert; admin: all. **`orders` / `order_items` / `order_lane_history` / `order_slip_events`** — sales: read own showroom; coordinator/finance: all; admin: all. **`products` / pricing tables** — SELECT all authenticated; INSERT/UPDATE admin only. **`staff` / `showrooms`** — read for authenticated, write admin only. **`app_config`** — read service_role only (sensitive for owner_email seed). | Add to `packages/db/src/migrations/` alongside table creation in **Phase 0**. Test with RLS-enabled Supabase client BEFORE Phase 1. **Codex P1.5 fold (2026-05-08)**: PORT_DESIGN.md previously deferred RLS implementation to Phase 5 — wrong order. |

### 11.2 Code quality (1 decision)

| # | Issue | Decision | Implementation impact |
|---|---|---|---|
| 8 | Pure-function lift inventory was incomplete | **Expand §3.4 + §5.2**. Lift to `packages/shared/src/`: (a) `sofa-build.ts` — 18 fns from prototype `pos-sofa-config.jsx` (already listed); (b) `pricing.ts` — `addonPrice`, `computeOrderTotal`, `computeSofaPrice`, `computeMattressPrice`, `computeBedframePrice`; (c) `order-rules.ts` — `checkConditions`, `paidPct`, `pieceCount`; (d) `format.ts` — `fmtMoney`, `fmtDate`, `fmtTime`, `daysAgo`, `pricingRange`. **Codex P2.7 — addon formula divergence is a real bug, not just a lift target**: prototype POS uses `Math.max(0, floors - 2) * items * 50` (`pos-handover.jsx:260`, `:540`) — first 2 floors free, then RM 50 per floor·item. Prototype Backend drawer uses `floors * items * 50` (`backend-drawer.jsx:227`) — every floor charged. **POS version is canonical** (customer-visible at handover). Backend drawer port MUST match POS, not perpetuate the divergence. **Codex P2.6 — audit list of remaining inline price hardcodes** (must replace with per-Model pricing table reads during port): `prototype/pos-handover.jsx:481` ("one-time fees, added on top of the RM2,990 product price"), `:686` ("every piece is RM2,990"), `:738`, `:1190-1198` (pillow prices); `prototype/backend-drawer.jsx:105`, `:220`, `:247` (`BE_PRICE`, `RM2,990`). All must be sourced from `products.flatPrice` / `productCompartments.price` / `productSizeVariants.price` after Phase 1.5 wiring. | Phase 1 acceptance: server-side recompute imports identical functions as client. **Test**: assert addon formula gives identical results POS/Backend on inputs `(floors=1..5, items=1..3)`. **Audit**: grep production codebase for `2990` literal and `RM\s*\$\{?\s*\d` patterns before Phase 1 ships. |

### 11.3 Test coverage (1 decision)

| # | Issue | Decision | Implementation impact |
|---|---|---|---|
| 9 | UI fidelity to prototype enforcement | **Playwright + prototype-as-baseline diff**. Playwright config: launch prototype `index.html` (file://) + production app side-by-side, navigate same routes, screenshot, diff via `pixelmatch` (>1% diff = fail). Run at viewport 1180×820 (iPad), 1366×768 (counter), 1920×1080 (desktop dev). Include `@media print` snapshot for receipt. | New: `e2e/visual-fidelity.spec.ts` runs in CI. Critical: prototype `localStorage` bridge needs mocking so it doesn't drift. |

### 11.4 Performance (3 decisions)

| # | Issue | Decision | Implementation impact |
|---|---|---|---|
| 10 | 22 sofa-module PNGs first-paint | **SW pre-cache on install**: vite-plugin-pwa Workbox `precacheManifest` includes `/sofa-modules/png/*.png` (22 files, ~150KB). First app launch downloads all; subsequent opens are instant + offline-capable. | Workbox config in `apps/pos/vite.config.ts`. Verify cache size budget — should be <500KB for full app shell + assets. |
| 11 | TanStack Query cache thrash on Realtime | **Granular keys + Realtime payload-merge**. Use `['products', productId]` per-SKU. Realtime UPDATE event includes `productId` → invalidate ONLY `['products', productId]` + merge new row into list `select`. Admin rapid-edits one SKU → only that one re-renders, list stays stable. | `apps/pos/src/lib/api.ts` adopts granular keys. List view uses `useQueries` or one master `['products']` with `select` projection that picks per-SKU rows from a normalized cache. |
| 12 | PoScanModal aggregation | **Server-side endpoint `/api/po-aggregate`**. SQL aggregates logistics-lane orders without `po_issued`, joins `order_items` + product config, groups by supplier (from `product_supplier` table, see TODO in §11.5). Returns supplier-rolled-up SKU+qty list. Client just renders. | New API route. New Drizzle query. **Blocks on `suppliers` + `product_supplier` schema** (TODOS.md T1). **Codex P1.4 note (2026-05-08)**: until T1 lands, prototype's `prototype/backend-orders.jsx:273-312` derives supplier by category via the inline `PO_SUPPLIER` constant. **This is a known temporary stub, not the production model.** Phase 4 cannot ship until T1 supplier schema is in place — do NOT port `PO_SUPPLIER` to production code as-is. |

---

## 12. Codex outside-voice review fold (2026-05-08)

`/codex consult` against `PORT_DESIGN.md` after `/plan-eng-review` lock. 23 findings (8 P1 / 10 P2 / 5 P3). All 8 P1s decided; P2/P3 deferred to a separate pass. Full review artifact: `~/.gstack/projects/2990s/codex-review-20260508-port-design.md`.

| # | Codex finding | Decision | Where applied |
|---|---|---|---|
| P1.1 | `schema.ts` missing `quotes` / `my_localities` / `pending_slip_uploads` | **FOLD** | `schema.ts`: 3 new tables added with full fields. §10 Decision 1 + 3 + 4 + §11.1 Issue 3 + 7 updated |
| P1.2 | sofa config JSON storage missing geometry — server cannot recompute custom builds | **FOLD** | `schema.ts:orders.config` JSONB shape comment now mandates `customCells: [{moduleId, x, y, rot, recliners}]`. Aligns with §5.1 |
| P1.3 | Seed data contradiction: §10.10 says empty catalog vs CLAUDE.md says port prototype | **FOLD** | §10 Decision 10 amended to call out supersession; `CLAUDE.md` red-line #5 rewritten to align |
| P1.4 | Supplier schema missing but prototype `backend-orders.jsx:273-312` uses `PO_SUPPLIER` | **DEFER** | TODOS.md T1 still gates Phase 4. §11.4 Issue 12 now explicitly marks `PO_SUPPLIER` as a known temporary stub — must NOT be ported to production as-is |
| P1.5 | RLS only aspirational; deferred to Phase 5 hardening | **FOLD** | §11.1 Issue 7 rewritten: RLS policies are **Phase 0 mandatory**, per-table spec covers all tables (orders, payments, products, etc.) — not just the new ones |
| P1.6 | `pending_slip_uploads` lacks status / hash / lease fields, reaper races slow uploads | **FOLD (with P1.1)** | `schema.ts:pending_slip_uploads` includes `uploadSessionId`, `contentHash`, `contentSize`, `status` enum, `retryCount`, `claimedBy`, `leaseExpiresAt`. Reaper SELECT FOR UPDATE SKIP LOCKED pattern documented in §11.1 Issue 3 |
| P1.7 | `orders.paid` is single integer; cannot record multiple payments | **FOLD** | `schema.ts:payments` audit table added with `kind`, `amount`, `method`, `slipKey`, `recordedBy`. `orders.paid` stays as denormalised running total |
| P1.8 | `OWNER_EMAIL` env-var trigger fragile (Postgres can't read CF/Vite env) | **FOLD** | `schema.ts:app_config` table added. §11.1 Issue 1 rewritten: trigger reads `app_config.owner_email`, ALTER without redeploy |

### P2 high-priority fold (also 2026-05-08)

After P1 fold, 4 high-priority P2s also addressed:

| # | Codex P2 finding | Decision | Where applied |
|---|---|---|---|
| P2.3 | `>0.5%` reject UX hostile to live customer | **FOLD** | §5.2 — flow now returns HTTP **409 Conflict** (not 400), client preserves customer/payment/slip state, surfaces `<PricingDriftModal>` with "Accept new total + place order" CTA. New §5.2.1 added |
| P2.5 | Order rows missing `pricing_version` snapshot for audit | **FOLD** | `schema.ts:orders.pricing_version` text NOT NULL added. Server stamps from `app_config.pricing_version` (bumped by trigger on any pricing UPDATE) |
| P2.6 | Other inline price hardcodes beyond `MODULE_PRICE` | **FOLD** | §11.2 Issue 8 expanded with explicit audit list: `pos-handover.jsx:481/686/738/1190`, `backend-drawer.jsx:105/220/247`. Phase 1 grep gate added |
| P2.7 | POS uses `Math.max(0, floors-2)*items*50`; Backend uses `floors*items*50` (real bug) | **FOLD** | §11.2 Issue 8 declares POS version canonical (customer-visible). Backend drawer port MUST adopt POS formula. Test gate: identical results on inputs (floors=1..5, items=1..3) |
| P2.10 | `quotes` RLS too narrow | **FOLD** (with P1.5) | §11.1 Issue 7 rewrite covers this: showroom_lead sees same-showroom quotes |

### Pending P2/P3 (next pass)

5 P2 + 5 P3 still open. Highlights:

- **P2.1** Receipt UX inconsistency between §10.2 (server PDF locked) and §11.1 Issue 4 (deferred to Phase 5). Phases 1-4 need a defined interim receipt path (print only? browser save-as-PDF?) and copy fixes (`pos-handover.jsx:947` says "copy sent to email" but no email subsystem yet).
- **P2.2** Integer MYR + tax. SST/GST is %-based — decide tax-inclusive vs exclusive vs rounded-to-nearest-RM. Schema may need `tax_total`, `tax_rate_bps`, `tax_inclusive` columns. Or punt to "all displayed prices are tax-inclusive RM" if scope allows.
- **P2.4** Pricing freshness mid-configurator can thrash (admin edits while customer watches). Decide: live-price-always-wins vs lock-price-for-N-minutes via `pricingVersion`.
- **P2.8** iOS PWA realism — Safari orientation lock not reliable, 7-day storage eviction, install flow for non-technical staff.
- **P2.9** Slip upload idempotency / backoff (`uploadSessionId` already in schema for P1.6, but client-side retry policy + "resume / reselect slip" UX undefined).

P3 nice-to-haves (PIN auto-lock, multi-showroom RLS test cases, copy deviation log, popup-blocker handling for print fallback, Phase 0 lane parallelism — Phase 0 lane parallelism caveat is partially addressed by §11.8's pure-fn lift sequencing).

Schema impact of remaining P2/P3 pass: optional `tax_total` / `tax_rate_bps` / `tax_inclusive` columns on orders + payments **only if** tax decision lands in scope. No new tables expected.

---
