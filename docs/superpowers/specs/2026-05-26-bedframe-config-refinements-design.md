# Bedframe configurator refinements + cart line editing — design

Date: 2026-05-26
Status: approved (lean track — implement directly, ship + verify live)
Follows: `2026-05-25-bedframe-configurator-design.md` (the original build, PR #25/#26)

Four refinements requested by Loo, three scoped to the bedframe configurator and
one cross-cutting (cart line editing for every configurable kind).

---

## 1. Remove the "Total height" option (frontend only, no migration)

The bedframe build options were `gap / leg_height / divan_height / total_height /
special`. Loo wants `total_height` gone from the POS configurator.

- `apps/pos/src/components/BedframeOptions.tsx`
  - Drop `totalId / totalLabel / totalSurcharge` from `BedframeSelection`,
    `emptyBedframeSelection`, and the `bedframeSurcharge` sum.
  - Remove `pickTotal`, the `total_height` bucket from `byKind`, and the
    "Total height" group from render.
- `apps/pos/src/pages/Configurator.tsx`
  - `canAddBedframe`: drop `&& bfSel.totalId != null`.
  - `handleAddBedframe`: drop the `Total …` summary part and the
    `totalHeightId / totalHeightLabel` snapshot fields.

**Deliberately NOT removed** (backward compatibility for already-placed orders /
saved quotes): the optional `totalHeight*` fields in `state/cart.ts`,
`schemas/order-v1.schema.ts`, `pricing.ts` (`describeBedframeLine` +
recompute `optionIds`), and the `total_height` rows in `bedframe_options`. POS
simply stops surfacing them. New orders never carry them; old ones still render
and revalidate.

DIVAN ONLY models never showed total height, so no change there.

## 2. Mattress gap: add 14" and 16" (seed + prod INSERT)

Current gap values: 4"–10". Add 14" and 16" only (skip 11"–13", per Loo).

- `packages/db/seeds/bedframe-options.sql`: add
  `('gap-14','gap','14"',0,true,8),('gap-16','gap','16"',0,true,9)`.
- Apply the same idempotent INSERT (`ON CONFLICT (id) DO UPDATE`) to the live
  Supabase project. No migration file — sidesteps the current 0045/0046
  numbering collision on main, and matches how the option snapshot was seeded.

Result: `4,5,6,7,8,9,10,14,16`.

## 3. Build options → dropdowns (frontend redesign)

The always-open chip rows scroll too much. Replace the single-select groups with
compact native `<select>` dropdowns (great touch picker on tablet, the POS
primary device). The "Size" grid + special-size input in `Configurator.tsx` stay
unchanged ("various size" is explicitly kept).

In `BedframeOptions.tsx` each option becomes a labelled row (label + optional
"Required" + a brand-styled `<select>` on the right):

- **Colour** → dropdown listing the Model's enabled colours; a swatch dot in the
  trigger reflects the chosen `swatchHex` so it stays recognisable.
- **Mattress gap / Leg height / Divan height** → dropdown.
- **Specials** → stays a multi-select chip row (a dropdown can't express
  multi-select).

Option text appends `· +RM{n}` when `surcharge > 0` (all 0 at pilot). DIVAN ONLY
collapses to Colour + Leg height. `BedframeOptions`' controlled contract
(`value` / `onChange`) is unchanged; only the rendering changes. Styling lives in
`BedframeOptions.module.css` (appearance:none, brand border, burnt focus ring,
chevron), matching `sizeOtherInput`.

## 4. Cart line "Edit" button (frontend)

`addConfigured(config, { editingKey })` already replaces in place — only the UI
entry point + state hydration are missing.

- `apps/pos/src/components/CartContents.tsx`: each `Line` gets an Edit (pencil)
  button. Shown for `sofa` / `size` / `bedframe`; hidden for `flat` (nothing to
  edit). Click → `navigate('/configure/{productId}?edit={line.key}')`.
- `apps/pos/src/pages/Configurator.tsx`: read `?edit=key` via `useSearchParams`,
  look up the line in the cart, and run a **one-shot hydration** (guarded by a
  `hydratedRef`) once the queries that kind needs have loaded:
  - **size** → `pickedSizeId`, `pillowExtras` (from `addonExtras`)
  - **bedframe** → `pickedSizeId`, `bfSizeOther`, and `bfSel` rebuilt from the
    snapshot ids by re-looking-up `useBedframeColours` / `useBedframeOptions`
    (to recover label/hex/surcharge; falls back to snapshot labels + 0).
  - **sofa quick** (`bundleId`) → `mode='quick'`, `picked`, `activeDepth`,
    `fabricSel` (re-derived from fabric queries), `quickFlip` (parsed from
    summary, default `R`).
  - **sofa custom** (`cells`) → `mode='custom'`, `setSofaCells(cells)`,
    `activeDepth`; fabric passed into `CustomBuilder` via a new `initialFabric`
    prop.
  - In edit mode the Add CTA reads **"Save changes"**; on save call
    `addConfigured(snapshot, { editingKey })` and navigate back to `/cart`.
- `apps/pos/src/pages/CustomBuilder.tsx`: accept optional `editingKey` +
  `initialFabric`. Hydrate its internal `fabricSel` once from `initialFabric`;
  `handleAdd` passes `editingKey` to the first split group (replace) and appends
  the rest. CTA reads "Save changes" when editing.

---

## Testing

- `packages/shared/src/__tests__/pricing.test.ts`: add a case proving a bedframe
  line WITHOUT `totalHeightId` reprices correctly, and one WITH the new `gap-14`
  /`gap-16` option ids passing recompute (active option lookup).
- Frontend hydration: manual QA across the four kinds on the live preview after
  deploy (PWA hard-refresh). `pnpm typecheck` + existing vitest must stay green.

## Out of scope

- Backend SKU Master / pricing editor changes for total_height (POS-only ask).
- Deleting `total_height` DB rows (kept for old-order rendering).
- Filling gap 11"–13".
