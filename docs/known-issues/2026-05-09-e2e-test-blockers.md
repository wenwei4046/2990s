# E2E Test Blockers — 2026-05-09

End-to-end test ran via Playwright MCP. Goal: POS places order → Backend
advances through 6 lanes → POS My Orders shows Delivered.

**Result**: lifecycle proven (SO-2050 created from POS, advanced to delivered,
visible in POS My Orders Delivered lane), but **5 blockers + 3 quality issues
were worked around, not fixed.** This doc tracks each one for next session.

Order placed during test: `SO-2050` (Sofa 5539 Quick-Pick 1S, customer "Google").

---

## 🔴 Blockers (workarounds applied during test, not fixed)

### 1. Compartment ID schema mismatch — DB ≠ frontend constant

**Symptom**: Custom build palette only shows 1NA + 2NA. The other 12 active
compartments (1A-LHF, 1A-RHF, 1B-LHF, 1B-RHF, 2A-LHF, 2A-RHF, 2B-LHF,
2B-RHF, L-LHF, L-RHF, CNR, STOOL) are filtered out → can't close a sofa →
Custom build is unusable.

**Root cause**: Two parallel naming schemes never reconciled.

| Source | IDs used |
|---|---|
| `compartment_library` (DB seed) | `1NA, 2NA, 1A-LHF, 1A-RHF, 1B-LHF, 1B-RHF, 2A-LHF, 2A-RHF, 2B-LHF, 2B-RHF, L-LHF, L-RHF, CNR, STOOL` |
| `SOFA_MODULES` (`packages/shared/src/sofa-build.ts:82-101`) | `1A-L, 1A-R, 1NA, 2A-L, 2A-R, 2NA, 1C-NW, 1C-NE, 1C-SE, 1C-SW, L-R, L-L, WC-45` |

`apps/pos/src/pages/CustomBuilder.tsx:227-228` filters palette by
`SOFA_MODULES.filter(m.group === g).filter(m => pricing.compartments.find(cc => cc.compartmentId === m.id)?.active)`.
Active compartments with DB-only IDs (1A-LHF, CNR, etc.) never match → never
render. Then closure analysis at `sofa-build.ts:528-595` requires `1A`
arms or L modules which aren't in the palette → can't close.

Also: `1B/2B wide arm` and `STOOL` exist in DB only (no frontend representation
at all). Conversely, 4 corners (`1C-NW/NE/SE/SW`) and `WC-45` accessory exist in
SOFA_MODULES but DB has just `CNR`.

**Fix options**:

A. **Rename DB IDs to match SOFA_MODULES** — destructive (cascades to
   `product_compartments` rows + Hookka 5531/5535/5539 seed). Requires
   migration with explicit OK. Loses 1B/2B wide arm + STOOL semantics.

B. **Extend SOFA_MODULES with DB IDs as aliases** — non-destructive. Adds
   1A-LHF/1A-RHF/1B-LHF/1B-RHF/2A-LHF/2A-RHF/2B-LHF/2B-RHF/L-LHF/L-RHF/CNR/STOOL
   with same w/d as nearest equivalent. Canvas math + closure analysis pick up
   automatically. Recommended.

C. **Read compartment specs from compartment_library at runtime** — biggest
   refactor. DB becomes source of truth for w/d/cushions. Removes hardcoded
   SOFA_MODULES. Right move long-term but deferred.

**Files**: `packages/shared/src/sofa-build.ts`, optionally migration to
add the 4 missing 1C corners or rename CNR.

---

### 2. Flat-priced products: "Add to cart" disabled

**Symptom**: All flat-priced SKUs (Oak King mattress, Noor / Tanah / Rumah /
Petang sofas, Platform / Storage / Wooden bedframes, Cloud / Linen / Dusk
mattresses, Petang armchair) show a hard-disabled button labelled
*"Add to cart (Phase 2 step C)"*.

**Root cause**: Configurator deferred per Phase 2C plan.
`apps/pos/src/pages/Configurator.tsx:120-122`:

```tsx
<Button variant="primary" disabled>
  Add to cart (Phase 2 step C)
</Button>
```

The order pipeline only supports `kind: 'sofa' | 'size'`. There's no `'flat'`
config kind anywhere.

**Fix**: add `kind: 'flat'` end-to-end:

1. `packages/shared/src/schemas/order-v1.schema.ts` — add `flatLineConfigSchema = z.object({ kind: z.literal('flat'), productId: z.string().uuid() })` to the discriminated union.
2. `packages/shared/src/pricing.ts` (haven't read but exists per orders.ts line 6) — handle `kind: 'flat'` in `computeOrderTotal`. Server looks up `products.flat_price` (already fetched at orders.ts line 88-89).
3. `apps/pos/src/state/cart.ts` — add `FlatConfigSnapshot { kind: 'flat'; productId; productName; total; summary }` to the CartConfig union.
4. `apps/pos/src/lib/orders.ts:51-89` (`buildPostBody`) — handle 'flat' kind branch.
5. `apps/pos/src/pages/Configurator.tsx:116-124` — replace disabled button with handler that pushes a `FlatConfigSnapshot` to cart.

**Impact**: 14 / 18 catalog SKUs are unsellable. Half the test flow broken.

---

### 3. Size-variants configurator: hardcoded placeholder

**Symptom**: Cloud Series Mattress (`MAT-001`) shows
*"Size-variant configurator lands in Phase 2 step C — pick a size + pillows + addons."*
No way to add to cart.

**Root cause**: Same Phase 2C deferral.
`apps/pos/src/pages/Configurator.tsx:109-114`. The data layer
(`product_size_variants` table, server pricing) already supports it — only
the UI is missing.

**Fix**: build a SizeConfigurator panel:
- Pull `useProductSizes(productId)` (already exists at queries.ts).
- Render size options as buttons (Single / Super single / Queen / King +
  whatever's active for the Model).
- Optional pillows / addons UI (defer if scope tight).
- `FormSubmit → addConfigured({ kind: 'size', productId, productName, sizeId, total, summary })`.

The CartConfig + API already supports `kind: 'size'`. Just frontend work.

**Impact**: 1 catalog SKU today (Cloud Series). Will grow as Loo seeds more
mattresses by-size.

---

### 4. Backend auth: navigator-locks deadlock on login retry

**Symptom**: Sign-in button stays at *"Signing in…"* indefinitely. Console
warning `[auth] getSession() did not resolve within 7s — releasing Loading
state. Likely a stuck navigator-locks acquisition` (apps/backend/src/lib/auth.tsx:49).

**Root cause**: Supabase JS uses `navigator.locks` to coordinate session sync
across tabs. When two open tabs (POS at 6273 + Backend at 6274 in our test)
both initialise Supabase clients pointing at the same project, lock
acquisition can stall. The 7s timeout fallback releases the loading flag but
the actual sign-in promise never resolves on the stuck tab.

**Workaround used in test**: `localStorage.clear()` + `sessionStorage.clear()`
on `localhost:6274` then retry login. Worked.

**Fix options**:

A. **Different Supabase storage keys per app** — POS already uses
   `sb-pos-auth-token`. Verify Backend uses something different, e.g.
   `sb-backend-auth-token`, so the navigator-locks key namespaces don't
   collide cross-tab. Quick check + 1-line fix if not already.

B. **Race signin against a 10s timeout** — wrap `signInWithPassword` in
   `Promise.race([signin, timeoutReject(10000)])` and surface a clear
   "Sign-in timed out — clear browser data and retry" message.

C. **Disable persist + autoRefresh during dev** — only loads tokens once,
   no cross-tab sync. Causes re-login per tab. Acceptable for dev, not prod.

**Files**: `apps/backend/src/lib/supabase.ts`, `apps/backend/src/lib/auth.tsx`.

---

### 5. Backend auth: session lost on URL navigation

**Symptom**: After successful login, navigating from `/dashboard` → `/orders`
(or any direct URL change) bounces user back to `/login`.

**Root cause**: Suspected order:
1. Signin sets session in localStorage
2. Layout renders `<Navigate to="/login">` because `staff` is still null
   (staff query hasn't returned yet) and `loading` flag flipped false
3. Race: page nav redirects before staff query lands

`apps/backend/src/components/Layout.tsx:14-15` checks `!user → /login`,
`!staff → /no-access`. The transition window between `loading=true` →
`loading=false` + `staff=null` then `staff=row` is what's biting us.

**Fix**: extend `loading` to cover staff query as well, not just session
fetch. AuthProvider should keep `loading=true` until BOTH the session is
known AND the staff row has been queried (success OR confirmed-null).

**Files**: `apps/backend/src/lib/auth.tsx` — broaden loading state.

---

## 🟡 Quality issues

### 6. Hookka 5531 / 5535 / 5539 prices = 0

By design — seed migration `54930d0` intentionally left prices empty per
"Loo to fill via SKU Master" decision. Test order SO-2050 has total RM 0.
Not a bug, but it means:

- Pricing drift validation isn't exercised (everything's 0)
- Can't tell if server-side pricing recompute would catch a tampered total
- Backend OrderCard / drawer formatting for RM 0 tested

**Action**: Loo seeds prices via SKU Master when ready. Then re-run drift
test with non-zero amounts.

---

### 7. delivery_date written to notes, not the schema column

**Symptom**: Handover step 2 captures `Delivery date: 2026-05-15 ·
12:00 – 15:00`. But on the order, `orders.delivery_date` column is NULL;
the date string is stuffed into `orders.notes`. Backend OrderCard then
shows "Date TBD" for SO-2050 even though the user entered a date.

**Root cause**: `apps/pos/src/pages/Handover.tsx:184-191` (buildNotesFromForm)
appends `Delivery date: …` to notes. The orders POST body (`OrderV1PostBody`)
doesn't have a `deliveryDate` field. Schema's `orders.delivery_date` column
exists per migration 0006 but no path writes to it.

**Fix**: 
1. Add `deliveryDate?: string` (ISO `YYYY-MM-DD`) and `deliverySlot?: string` to `OrderV1PostBody`.
2. POST handler at `apps/api/src/routes/orders.ts:39+` passes them through to the `create_order_with_items` RPC.
3. Confirm the RPC at migration 0006 / 0010 already writes `delivery_date` (it has the column — just needs the input).
4. POS Handover.tsx submit() includes `deliveryDate: form.deliveryDate, deliverySlot: form.deliverySlot` (and skip stuffing into notes).

**Files**: shared schema, api/orders.ts, pos/lib/orders.ts buildPostBody, pos/pages/Handover.tsx.

---

### 8. PO scan modal — not exercised in this test

E2E test SQL-bypassed `po_issued=true` because the Scan PO modal is its own
sub-system (Sub-project D). Real flow:

1. Logistics lane → "Scan PO needed (n)" button on lane head
2. Modal opens with supplier roll-up of all line items across orders
3. Pick supplier → see SKU / size / colour / qty rolled up
4. Click "Generate PO" → API creates PO + lines + marks orders
   `po_issued=true`

Real test of this flow needs a non-zero-priced order with cross-supplier or
single-supplier line items (SO-9008 / SO-9009 are the seeded fixtures).
Worth running once the pricing is no longer 0.

---

## Recovery state for next session

- DB row inserted: `auth.users` for `wenwei4046@gmail.com` (id `90d06620-0f2f-4b13-959b-b744a28ed6f3`, password `111`).
- `public.staff` admin row matching that id (`LOO`, role `admin`).
- `app_config.owner_email` updated from `lllll@l.l` to `wenwei4046@gmail.com`.
- `auth.users` token columns coerced from NULL to '' to fix GoTrue scan error.
- `.env.local` populated at root (gitignored).
- `apps/api/.dev.vars` populated (gitignored).
- `quotes` table aligned: API + POS code use the existing schema (text id,
  `cart` jsonb, `created_by`, `pricing_version=v1`). Migration 0018 was
  deleted because the table pre-existed.

Test order `SO-2050` exists in DB at lane=`delivered`. Drop it before
re-testing if you want a clean slate:

```sql
DELETE FROM order_lane_history WHERE order_id = 'SO-2050';
DELETE FROM order_items WHERE order_id = 'SO-2050';
DELETE FROM orders WHERE id = 'SO-2050';
```

## Suggested fix order (next session)

| Priority | Bug | Estimated effort |
|---|---|---|
| P0 | #1 Compartment ID alignment (option B) | 4-6h |
| P0 | #4 + #5 Backend auth stability | 2-3h |
| P1 | #2 Flat add-to-cart (full kind=flat path) | 1d |
| P1 | #7 deliveryDate to schema column | 1h |
| P2 | #3 Size-variants configurator | 1d |
| P2 | #8 PO scan flow real test | 4h |

Total: ~3-4 days to clear all listed items.
