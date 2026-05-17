# Handover Redesign — Design Spec

| | |
|---|---|
| **Date** | 2026-05-17 |
| **Author** | Claude (with Loo) — brainstormed via `superpowers:brainstorming` |
| **Branch** | `main` |
| **Phase** | Phase 2 (Order placement) — UX rebuild on top of existing data flow |
| **Status** | Design approved, awaiting `writing-plans` skill to produce implementation plan |
| **Estimated work** | ~4–5 days for full implementation + visual regression + Backend SKU Master hero upload |

---

## 1. Goal & Scope

### 1.1 What we're building

A complete UX rebuild of the `/handover` flow, replacing the existing 4-step linear wizard (Customer · Delivery · Payment · Sign-off) with a 2-phase × multi-sub-step structure that pixel-matches a new set of Loo-approved mockups. The right side of the page gains a **live order summary pane** that updates in real time as the salesperson fills the form. After submission, the user lands on a redesigned `/confirmed/:orderId` page with a category-themed full-bleed hero photo and a receipt panel.

Concretely:

1. **`/handover` rewritten** — 2 phases × (4 + 3) = 7 sub-steps. Sub-step chips at top, single form-state object, linear navigation with chip back-jump.
2. **`/confirmed/:orderId` new** — replaces current `/orders/:orderId` (which routed to `OrderConfirmed`). Old route stays for `OrderStatus` (existing audit-log view).
3. **Live `OrderSummaryPane`** — sticky right column bound to form state in `form` mode; switches to `receipt` mode after submit.
4. **Backend SKU Master gets a "Category hero photos" widget** — admin uploads one image per `categories` row, stored in R2 as `category-heroes/<categoryId>.jpg`. Confirmed page picks the dominant category by line-item subtotal.
5. **Schema migration `0023_handover_redesign.sql`** — adds 4 columns to `orders`, 1 column to `categories`.
6. **API `POST /orders`** — accepts 4 new optional fields; rejects with 400 if unknown.

### 1.2 Out of scope (explicitly)

- ❌ **Catalog / Cart / Configurator / Custom Builder.** Not touched.
- ❌ **Quote import behaviour.** "Quote items have been carried over" is just header copy; the cart-lines flow from `/cart` → `/handover` is unchanged.
- ❌ **Billing address as separate fields.** Mock shows only a "Billing same as delivery" toggle. We store the boolean; if Loo later asks for distinct billing, a follow-up migration adds the columns.
- ❌ **Order ID format change.** Mock placeholders (`ORD-806026`) ignored. Keep locked `SO-XXXX` from `next_order_id()` sequence (CLAUDE.md §Order IDs).
- ❌ **Express delivery slots (EXP).** Removed entirely per Loo. Calendar shows only a `Selected` marker; legend simplified to one item.
- ❌ **PDF receipt generation.** `Print receipt` uses `window.print()` with a print-only CSS stylesheet. No backend PDF pipeline.
- ❌ **Mobile / phone POS.** Tablet-first 1180×820 baseline; desktop 1440×900. Below 1024px is not supported per project device targets.
- ❌ **`OrderStatus.tsx`** — the existing audit view stays untouched at `/orders/:orderId/status` or wherever it currently routes (verified during implementation).

---

## 2. Routes & navigation

| Route | Page | Status |
|---|---|---|
| `/cart` | `Cart.tsx` | unchanged |
| `/handover` | `Handover.tsx` | **rewritten** |
| `/confirmed/:orderId` | `Confirmed.tsx` (new) | **new** |
| `/orders/:orderId` | `OrderConfirmed.tsx` | **deleted** — was the success page; replaced by `/confirmed/:orderId` |
| `/orders/:orderId/...` | `OrderStatus.tsx` | unchanged |

`Handover.tsx` redirects to `/cart` when `useCart` is empty (existing behaviour preserved). Successful order placement does `navigate(`/confirmed/${id}`, { replace: true })` then `clear()` on the cart store.

The topbar pill chain stays `01 CART · 02 CUSTOMER · 03 CONFIRMED`. `Handover.tsx` is always under the `02 CUSTOMER` pill regardless of phase. `Confirmed.tsx` is under `03 CONFIRMED`.

---

## 3. Step structure

```
PHASE 1 OF 2 · ADDITIONAL INFO
  ├── 1.1 Customer       — name, phone, email, salesperson, customerType
  ├── 1.2 Address        — fill-later toggle, address, postcode, city, state, buildingType, billingSame
  ├── 1.3 Emergency      — name, relationship, phone
  └── 1.4 Target date    — month calendar (no EXP) + special instructions

PHASE 2 OF 2 · CONFIRM & PAY
  ├── 2.1 Add-ons & payment — addon cards (logistics) + payment method cards
  ├── 2.2 Confirm payment   — amount, presets, approval code, slip upload
  └── 2.3 Sign & confirm    — signature pad + Complete order
```

Linear `idx: 0..6` drives both `currentStep` and `phase` (computed: `idx < 4 ? 1 : 2`). Sub-step chips render only the current phase's slice (4 or 3 chips).

### 3.1 Sub-step chip states (per mock)

- **Past** — green filled circle + check icon + label
- **Current** — orange-ring outline circle + step number + label (orange text)
- **Future** — grey filled circle + step number + label (muted text)

Past chips are clickable (jumps back). Future chips are not clickable (must advance via `Next →`).

### 3.2 Step validity

| Step | Valid when |
|---|---|
| 1.1 Customer | `name.trim().length > 0` AND `/.+@.+\..+/.test(email)` |
| 1.2 Address | `addressLater === true` OR (`fullAddress` AND `postcode` AND `city` AND `state` AND `buildingType`) |
| 1.3 Emergency | All three filled OR all three empty (optional section; if started, must complete) |
| 1.4 Target date | `addressLater === true` (no delivery date needed) OR `deliveryDate` set |
| 2.1 Add-ons & payment | `paymentMethod` chosen. Add-ons are optional. |
| 2.2 Confirm payment | `amountPaid >= halfTotal && amountPaid <= total`, `approvalCode.trim().length > 0`, `paymentRecorded === true`. If `paymentMethod === 'transfer'`, also `slipUploadSessionId !== null`. |
| 2.3 Sign & confirm | `signed === true` |

`Next →` button is disabled when current step is invalid. Going `← Previous` from 2.1 takes the user back to 1.4 (and the phase pill flips from 2 back to 1).

### 3.3 Bottom footer button labels

| Step | Left button | Right button |
|---|---|---|
| 1.1 | (no Back to cart pill at top right of left pane goes to `/cart`) | `Next →` |
| 1.2 / 1.3 / 1.4 / 2.1 | `← Previous` | `Next →` |
| 2.2 (before record) | `← Previous` | `Confirm payment received` |
| 2.2 (after record) | `← Previous` | `Continue to signature →` |
| 2.3 | `← Previous` | `Complete order ✓` |

`Confirm payment received` flips an internal `paymentRecorded` flag; pressing once gives the inline "✓ Payment recorded · RM X,XXX" feedback and changes the button to `Continue to signature →`. Pressing the second button advances.

---

## 4. Form state model

Single `useState<HandoverForm>` in `Handover.tsx`. All step components receive `{ form, update }` props.

```ts
interface HandoverForm {
  // P1.1 Customer
  name: string;
  phone: string;
  email: string;
  salespersonId: string;                       // default = session staff.id
  customerType: 'new' | 'existing';            // default 'new'

  // P1.2 Address
  addressLater: boolean;                        // default false
  fullAddress: string;                          // textarea, merges line1+line2; persisted to customer_address
  postcode: string;
  city: string;
  state: string;                                // full name e.g. "Selangor"
  buildingType: '' | 'condo' | 'landed' | 'apartment' | 'office' | 'shop' | 'other';
  billingSame: boolean;                         // default true

  // P1.3 Emergency
  emergencyName: string;
  emergencyRelation: string;                    // dropdown values defined below
  emergencyPhone: string;

  // P1.4 Target date
  deliveryDate: string;                         // YYYY-MM-DD, '' = none
  specialInstructions: string;                  // textarea, persisted to delivery_notes

  // P2.1 Add-ons & payment
  addons: Record<string, AddonSelection>;       // keyed by addons.id
  paymentMethod: 'credit' | 'debit' | 'transfer' | 'installment' | '';

  // P2.2 Confirm payment
  amountPaid: number;                           // whole RM
  paymentPreset: 'half' | 'full' | 'seventy' | 'custom';  // default 'full'
  approvalCode: string;
  slipUploadSessionId: string | null;
  paymentRecorded: boolean;                     // flips on "Confirm payment received" press

  // P2.3 Sign & confirm
  signed: boolean;
}

interface AddonSelection {
  selected: boolean;
  expanded: boolean;     // "configurable" link toggles inline form
  floorsCount?: number;  // for 'lift' (kind='floors_items')
  itemsCount?: number;   // for 'lift'
  qty?: number;          // for 'qty' kind addons (dispose-mattress, dispose-bedframe)
}
```

Defaults: empty strings, `addressLater=false`, `billingSame=true`, `customerType='new'`, `paymentPreset='full'`, `amountPaid = subtotal` (recomputed when addons toggle), `paymentRecorded=false`, `signed=false`.

### 4.1 Relationship dropdown values

`Husband · Wife · Father · Mother · Son · Daughter · Brother · Sister · Friend · Colleague · Relative · Other` — same as current production list, no change.

### 4.2 Salesperson dropdown source

`useQuery(['staff_all'])` fetches `SELECT id, name, initials, color FROM staff WHERE active = true ORDER BY name`. Defaults to the logged-in staff member; sales can pick another (e.g., when a colleague helps close a sale).

### 4.3 Building type dropdown

Six options stored as lowercase string in DB:

| Value | Label |
|---|---|
| `condo` | Condo |
| `landed` | Landed |
| `apartment` | Apartment |
| `office` | Office |
| `shop` | Shop |
| `other` | Other |

No default; "Select…" placeholder. Required to advance step 1.2 (unless `addressLater`).

### 4.4 Auto-suggest lift addon

When `buildingType === 'condo' || buildingType === 'apartment'`, on entering step 2.1 the `lift` addon's `selected` defaults to `false` but the card shows a subtle visual hint (no auto-check, since lift cost depends on actual floor — we don't presume).

---

## 5. Live `OrderSummaryPane` (right side)

Sticky position, fixed-width 320px on desktop, full-width below 1024px. Two modes — `form` (during handover) and `receipt` (after confirmation).

### 5.1 `mode="form"`

| Section | Content | Placeholder when empty |
|---|---|---|
| Header | `SO-XXXX` placeholder · today's `DD/MM/YYYY` | always shown; ID is the placeholder string `SO-XXXX` until server returns the real ID after submit |
| ITEMS · N | One card per cart line — product photo, name, size_display, included addon pills (e.g., `2× Memory foam FREE Included`), `RM X,XXX` (per-line) | always shown when cart has items |
| CUSTOMER | `Name / Phone / Email / Address` rows | "Not yet captured" italicized when name is empty |
| EMERGENCY CONTACT | `Relation / Phone` rows | section hidden when all three emergency fields are empty |
| DELIVERY | `Date` row (formatted `Thu, 28 May`) | `Pending` when no date |
| PAYMENT | `Method` row (formatted "Debit Card") | `Pending` when no method |
| TOTALS | `Items subtotal: RM X,XXX.00` `Add-ons: RM Y,YY.00` (only if any addon selected) | always shown |
| TOTAL bar | Large `RM X,XXX` + caption `Inclusive of delivery within Klang Valley` | always shown |

### 5.2 `mode="receipt"`

Switches when `Confirmed.tsx` mounts. Differences:

- Header: `Receipt` (no "Order summary")
- Items card simplified — no size_display detail line, keep image + name + qty + price
- CUSTOMER section hidden (already greeted on hero)
- DELIVERY shows `Address` + `Date`
- PAYMENT shows `Method` + `Status: Recorded` (green text, `--c-success`)
- TOTALS section hidden
- Bottom bar shows `PAID RM X,XXX` (not "TOTAL")
- Footer caption: `Same price. Every piece. Always.` (replaces the Klang Valley line)

### 5.3 Live binding mechanism

`Handover.tsx` passes the entire `form` object plus `lines` (from `useCart`) to `OrderSummaryPane`. The pane is a pure render of those props — no internal state, no fetch. Updates happen automatically on every keystroke because React re-renders Handover whenever `setForm` is called.

For `Confirmed.tsx`, the pane gets `mode="receipt"` plus the persisted order data fetched via `useQuery(['order', id])` (existing pattern in `OrderConfirmed.tsx`).

---

## 6. Calendar (`MonthCalendar.tsx`)

Custom component, no external deps.

- Month grid: 7-column × 6-row, weekday labels (Su Mo Tu We Th Fr Sa)
- Header: `< May 2026 >` with prev/next month arrows
- Each cell is a `<button>` with day number
- **Min selectable date**: `T+1` calendar day (i.e., tomorrow onwards, including weekends). Today and earlier are visually muted and disabled.
- Selected date: filled orange circle, white text
- Legend below grid: `● Selected` · `3-5 working days standard` (no Express slots — removed)
- Below calendar: `SPECIAL INSTRUCTIONS (OPTIONAL)` textarea, placeholder `Lift available, leave at concierge, etc.`

State managed inside `MonthCalendar`:
- `viewMonth: { year, month }` — what month is currently displayed (defaults to today's month or month containing `value`)
- prop `value: string | undefined` — selected `YYYY-MM-DD`
- prop `onChange: (date: string) => void`
- prop `minDate: Date` — defaults to `addDays(today, 1)`

Month navigation is unbounded forward (sales can pick months ahead). Backwards is bounded at the current month (can't navigate into past months whose dates are all disabled).

---

## 7. Add-on cards (P2.1) — inline-expand "configurable"

`useAddons()` query returns enabled addons. The Handover filters to a fixed allow-list of logistics addons by `id`:

```
['dispose-mattress', 'dispose-bedframe', 'lift', 'assemble']
```

(`wrap` and `pillow-set` are product-bundled — Configurator handles those. `assemble` shows if `lift` is in cart, otherwise contextual.)

Each card renders:

```
┌──────────────────────────────────────────────────────────┐
│ [icon] Dispose old mattress              configurable [○]│   ← collapsed
│        RM120 per piece · we collect &                    │
│        dispose responsibly                                │
└──────────────────────────────────────────────────────────┘
```

When `configurable` is clicked, the card expands in place:

```
┌──────────────────────────────────────────────────────────┐
│ [icon] Dispose old mattress              configurable [●]│   ← expanded
│        RM120 per piece · we collect & dispose responsibly│
│                                                          │
│  QTY                                                      │
│  [- 1 +]                       Line total: RM 120        │
└──────────────────────────────────────────────────────────┘
```

For `lift` (kind=`floors_items`), the expanded form shows two inputs (`Floors` and `Items`) and computes `floors × items × perFloorItem`. Other `qty`-kind addons show one `QTY` input.

The `[○]` / `[●]` is the select-checkbox in the top-right corner; clicking it toggles `selected`. Selecting auto-expands. Deselecting collapses.

`addonTotal` is reactively computed from `form.addons` × `addons` query result.

---

## 8. Confirm payment step (P2.2) — slip upload

Reuses existing `<SlipUploadStep />`. Layout:

```
AMOUNT PAID
[ RM 2,990 ]
[ 50% deposit · RM1,495 ]  [ Full payment · RM2,990 ]  [ 70% · RM2,093 ]

APPROVAL CODE *
[ ___________________ ]

PAYMENT SLIP / PROOF *
┌──────────────────────────┬──────────────────────────┐
│ [Upload file]            │ [Take photo]              │      ← when empty
└──────────────────────────┴──────────────────────────┘

  ───── after upload, the card collapses to: ─────

[ file-icon ] PO-PO-2032 (2).pdf                  [Remove]
              Captured via file upload

✓ Payment recorded · RM 2,990                              ← only after "Confirm payment received" pressed
```

When `paymentMethod !== 'transfer'`, slip upload is **optional but recommended** (e.g., terminal receipt photo). When `'transfer'`, it's **required**.

The 3 preset pills are mutually exclusive radio-like buttons:
- `half` = `Math.round(subtotal / 2)`
- `full` = `subtotal + addonTotal` (the visible total)
- `seventy` = `Math.round(subtotal × 0.7)` (new — currently the form has no 70% option)
- `custom` = whatever the user types in the `AMOUNT PAID` input that doesn't match the other three

`amountPaid` is constrained to `[Math.round(total/2), total]`. Input below `half` is rejected with inline message; above `total` is clamped on blur.

---

## 9. Schema migration `0023_handover_redesign.sql`

### 9.1 `orders` table additions

```sql
ALTER TABLE orders
  ADD COLUMN customer_type   text  CHECK (customer_type IN ('new','existing')),
  ADD COLUMN building_type   text  CHECK (building_type IN ('condo','landed','apartment','office','shop','other')),
  ADD COLUMN billing_same    boolean NOT NULL DEFAULT true,
  ADD COLUMN salesperson_id  uuid REFERENCES staff(id);
```

All nullable / defaulted so existing rows survive.

### 9.2 `categories` table addition

```sql
ALTER TABLE categories
  ADD COLUMN hero_image_key  text;
```

Stores R2 key like `category-heroes/sofa.jpg`. If null, `Confirmed.tsx` falls back to `/imagery/bedroom-warm.jpg` (committed static fallback).

### 9.3 Effects on RLS

No new policies needed — existing `orders` RLS on `staff_id` / `customer_id` already cover the new columns. `salesperson_id` is just additional denormalised metadata.

### 9.4 `app_config.pricing_version` bump trigger

Already triggered by changes to `products` / `product_pricing*` tables. Adding columns to `orders` / `categories` does not bump pricing_version (correct — these aren't pricing inputs).

---

## 10. API changes

### 10.1 `@2990s/shared/schemas/order-v1.schema.ts`

Add to `OrderV1PostBody`:

```ts
customerType?: 'new' | 'existing';
buildingType?: 'condo'|'landed'|'apartment'|'office'|'shop'|'other';
billingSame?: boolean;                        // omitted = true on server
salespersonId?: string;                       // UUID; omitted = use staff_id
specialInstructions?: string;                 // textarea content → orders.delivery_notes
```

Also rename existing field semantics:
- `customer.address` → now interpreted as the full address textarea (server splits or stores raw to `customer_address`).
- `addressLater: boolean` (new) → server reads this; if true, all address columns stored as NULL and `delivery_tbd` set to true.

### 10.2 `apps/api/src/routes/orders.ts`

`POST /orders` handler:
- Validates new fields via Zod.
- Stores `customerType`, `buildingType`, `billingSame`, `salespersonId` on order row.
- Server-side pricing recompute unchanged.
- `addons` array (new in body) is iterated to insert `order_items` rows with `kind='addon'`, applying per-addon pricing from `addons` table (NOT from client — already the existing pattern).

### 10.3 `apps/api/src/routes/categories.ts` (new endpoint or extend existing)

`POST /admin/categories/:id/hero-image` — accepts multipart upload, stores to R2 at `category-heroes/<categoryId>.jpg`, updates `categories.hero_image_key`. Only `coordinator` / `admin` role.

`GET /categories` (existing) — returns `hero_image_key` along with other category fields.

---

## 11. Confirmed page (`Confirmed.tsx`)

### 11.1 Layout

Full-bleed two-column at desktop:

- **Left 60%**: hero photo background (R2 image, fallback to local `/imagery/`), darkened overlay, content stacked:
  - Top-left: `← back to dashboard` (optional, low priority)
  - Middle-left: small circle check icon → `ORDER CONFIRMED · SO-2051` eyebrow → `Welcome` + handwritten `home`, + `, {firstName}.` large serif title → status paragraph `Your N piece(s) will arrive on {weekday}, {DD month}. A copy of the receipt has been sent to {email}.`
  - Bottom buttons: `+ New order` (primary, goes to `/catalog`) and `Print receipt` (ghost, calls `window.print()`)
- **Right 40%**: `OrderSummaryPane mode="receipt"` (described in §5.2)

Below 1024px, stacks vertically: hero on top (limited height), receipt below.

### 11.2 First name extraction

`customer_name.trim().split(/\s+/)[0]` — first whitespace-delimited token. For "Lim Mei Hua" → "Lim". Sufficient for greeting; we don't try to detect Chinese given-name vs surname order.

### 11.3 Dominant category

`CartConfig` snapshots (in `apps/pos/src/state/cart.ts`) carry only `productId`, no `categoryId`. To avoid altering cart shape (and avoid stamping a `categoryId` column onto orders), we derive dominant category on Confirmed page mount:

```sql
SELECT p.category_id, SUM(oi.line_total) AS total_rm
FROM order_items oi
JOIN products p ON p.id = oi.product_id
WHERE oi.order_id = $1 AND oi.kind = 'product'
GROUP BY p.category_id
ORDER BY total_rm DESC
LIMIT 1
```

One extra query on Confirmed mount. The result feeds `categories.hero_image_key` lookup.

### 11.4 Fallback hero

If `dominantId === null` or category's `hero_image_key === null` → use `/imagery/bedroom-warm.jpg` (committed static fallback in `apps/pos/public/imagery/`).

### 11.5 Print CSS

Add `apps/pos/src/pages/Confirmed.print.css` imported only on `Confirmed.tsx` mount:

```css
@media print {
  body * { visibility: hidden; }
  .receipt, .receipt * { visibility: visible; }
  .receipt { position: absolute; left: 0; top: 0; width: 100%; }
  /* hide hero, nav, buttons; show only the receipt pane */
}
```

`Print receipt` button → `window.print()`.

---

## 12. Component tree

```
apps/pos/src/pages/Handover.tsx                   (~250 lines, orchestrator only)
apps/pos/src/pages/Handover.module.css            (~80 lines)
apps/pos/src/pages/Confirmed.tsx                  (~150 lines)
apps/pos/src/pages/Confirmed.module.css           (~120 lines)
apps/pos/src/pages/Confirmed.print.css            (~30 lines)

apps/pos/src/components/handover/
  PhaseNav.tsx (.module.css)                      sub-step chips + phase eyebrow
  StepFooter.tsx (.module.css)                    Prev / Next bottom bar
  OrderSummaryPane.tsx (.module.css)              right pane (both modes)
  CustomerStep.tsx
  AddressStep.tsx
  EmergencyStep.tsx
  TargetDateStep.tsx
  MonthCalendar.tsx (.module.css)
  AddonsPaymentStep.tsx
  AddonCard.tsx (.module.css)                     individual addon row w/ inline expand
  ConfirmPaymentStep.tsx
  SignConfirmStep.tsx
  SignaturePad.tsx (.module.css)                  extracted from current Handover.tsx
  Hero.tsx (.module.css)                          Confirmed-page background
```

**Existing files to retire:**
- `apps/pos/src/pages/OrderConfirmed.tsx` + `.module.css` — deleted
- Current `apps/pos/src/pages/Handover.tsx` — fully rewritten (line-1 to EOF)

**Existing files reused as-is:**
- `apps/pos/src/components/SlipUploadStep.tsx` — used inside `ConfirmPaymentStep.tsx`
- `apps/pos/src/lib/orders.ts` `useCreateOrder()` — extended with new fields
- `apps/pos/src/state/cart.ts` — unchanged
- `apps/pos/src/lib/queries.ts` `useLocalities()` — used by Address step's State / City / Postcode cascade (kept behind the new flat textarea, used to populate the state and city dropdowns)

---

## 13. Backend SKU Master — Category hero photo widget

New panel in the existing categories editor (in `apps/backend`):

- Row per category, with thumbnail preview if `hero_image_key` is set
- "Upload image" button → file picker → calls `POST /admin/categories/:id/hero-image` multipart
- "Remove" button → `DELETE /admin/categories/:id/hero-image` → R2 delete + set column to NULL
- Image preview is 320×180 cropped thumbnail
- Accepted formats: JPG / PNG; max 4 MB; recommend 1920×1080 landscape

---

## 14. Testing

- **Vitest unit tests**: validators per step, calendar minDate clamping, addon total computation, first-name extraction
- **End-to-end via gstack /browse**: walk through both phases, screenshot each sub-step and the live pane state, confirm pricing drift modal still appears if server total mismatches
- **Visual regression**: compare to mocks. Loo signs off pixel match.
- **Print CSS test**: in dev, `Cmd/Ctrl+P` on `/confirmed/:orderId`, assert only the receipt content is in the print preview

---

## 15. Open follow-ups (out of scope for this spec)

- Separate billing address fields (only if Loo confirms there's a use case)
- Backend "Drivers" mapping to confirm delivery scheduling against calendar
- Sales-rep substitution flow (one staff opens, another closes — current spec just lets them pick from the dropdown)
- Multi-language: the Confirmed page hero copy ("Welcome home") is EN-only; CN translation comes when the bilingual toggle is reactivated post-pilot
- A11y pass on the calendar (keyboard nav, screen reader month/day labels)

---

## 16. Risks

- **Categories `hero_image_key` upload pipeline** is new — first time POS app reads category-keyed R2 images for rendering. Have to validate R2 CORS + public-bucket access vs signed URL.
- **Live pane re-render perf**: typing in the address textarea triggers full pane re-render. With ~10 fields and 4 cart lines this is < 5ms — acceptable on tablet. If profiling shows jank, memoize sections.
- **Slip upload state on Phase 2.2** — moving the slip upload here (it was on the payment step before) changes the upload session lifecycle slightly. Need to verify the existing `SlipUploadStep` cleanup path on phase back-nav doesn't orphan R2 keys.
- **Migration ordering** — `0023` lands after `0022_address_line2.sql` which is currently uncommitted in the working tree. Decide whether to commit `0022` first or fold it into `0023`. The implementation plan will decide.

---

## 17. Phasing for implementation plan

Suggested order (`writing-plans` skill will refine):

1. **Schema migration + API schema update** (1 day) — `0023_handover_redesign.sql`, `OrderV1PostBody` extension, server insert paths.
2. **Skeleton + state model + OrderSummaryPane (form mode)** (1 day) — new files, empty step placeholders, live pane wired.
3. **Phase 1 step components** (1 day) — Customer / Address / Emergency / Target date with MonthCalendar.
4. **Phase 2 step components** (1 day) — Add-ons (with inline-expand) / Confirm payment / Sign.
5. **Confirmed page + receipt mode + print CSS + hero image fetch + Backend SKU Master widget** (1 day).
6. **End-to-end visual regression + sign-off** (0.5 day).
