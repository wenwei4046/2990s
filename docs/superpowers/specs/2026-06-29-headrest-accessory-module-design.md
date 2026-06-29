# HEADREST as a free-standing accessory sofa module

**Date:** 2026-06-29
**Author:** Wei Siang (with Claude)
**Status:** Approved design — ready for implementation plan

---

## Problem

A salesperson activated the `HEADREST` compartment in the Backend/POS **Allowed Options** drawer
for the **Annsa** sofa model, but `HEADREST` never appears as a selectable option in the POS sofa
configurator (Custom Build palette).

### Root cause (confirmed by reading source)

Ticking a compartment in Allowed Options only controls *membership*. The configurator has a second,
silent requirement: every compartment must resolve to a **known module geometry**, or it is dropped.
Two filters combine to block `HEADREST`:

1. **`findModule('HEADREST')` returns `undefined`** — `apps/pos/src/pages/CustomBuilder.tsx:1121-1126`
   synthesizes specs for non-built-in codes via `findModule` and filters out anything that returns
   `undefined`. In `packages/shared/src/sofa-build.ts:265-279`, `synthesizeModule` calls
   `familyRepresentative`, whose `switch` only knows the base families
   `1A/1B/2A/2B/L/1NA/2NA/1S/2S/3S/CNR/Console/STOOL`. `HEADREST` matches none → `undefined`. This is
   intentional per the comment at `sofa-build.ts:218-220`: a brand-new physical module needs real
   dims + art, which is dev work by design.

2. **Group `'Other'` is not rendered** — even if (1) were bypassed, `classifyCompartmentCode`
   (`apps/pos/src/lib/queries.ts:1257-1265`) would classify `HEADREST` as `'Other'`, which is absent
   from `PALETTE_GROUPS` (`CustomBuilder.tsx:315-322`), so its group box never renders.

### Product decision

Loo decided `HEADREST` should be a genuine, placeable **module** (not a per-seat upgrade), behaving
as a **free-standing accessory** like `Console` / `STOOL` — it does not participate in snap math, but
(like `Console`) it must sit beside a sofa to form a sellable, closed group.

---

## Design

Mirror the existing `STOOL` / `Console` accessory pattern. Adding `HEADREST` as a first-class entry
in the geometry table makes `findModule('HEADREST')` resolve directly via `MODULE_BY_ID`, so it is
never sent through `synthesizeModule` and never filtered out. Its `group: 'Accessory'` is already in
`PALETTE_GROUPS`, so it renders.

### Specs (Loo, 2026-06-29)

| Property | Value |
|---|---|
| Plan-view size (w × d, cm) | **50 × 30** (narrow rest bar) |
| Group | `Accessory` |
| Stands alone? | **No** — needs a sofa beside it to close (like `Console`) |
| Art (PNG) | **Temporary:** reuse `STOOL.png`. Final art: Loo uploads via Maintenance later. |
| Price | Per-Model, set in the allowed-options pricing editor (same mechanism as every compartment) |

### Changes

**1. `packages/shared/src/sofa-build.ts`**

- Add to `SOFA_MODULES` (alongside `Console` / `STOOL`):
  ```ts
  { id: 'HEADREST', group: 'Accessory', label: 'Headrest', w: 50, d: 30, cushions: 0, accessory: true }
  ```
  This makes `findModule`, `representativeArtCode`, `isAccessoryModule`, and the customizer palette
  filter all recognize `HEADREST` automatically.

- In `representativeArtCode` (`sofa-build.ts:288-294`), add a **temporary** art alias
  `HEADREST → 'STOOL'`, so the bundled-art fallback (`${ASSET_BASE}/HEADREST.png`) is never hit while
  no real PNG exists. Mark it clearly as temporary. Once Loo uploads a PNG in Maintenance, the
  `imageUrl` branch in `resolveModuleArtSrc` (`CustomBuilder.tsx:362-371`) takes precedence and the
  alias becomes dormant.

- In the closure block (`sofa-build.ts:1635-1643`), **generalize** the failure message from
  `'Console needs a sofa next to it'` to `'Accessory needs a sofa next to it'` so a `HEADREST`-only
  (or `Console`-only) group shows accessory-agnostic copy. Verify `ClosureFailure` type allows the new
  string (widen the union if it is a string-literal type). No logic change — `everyPieceStandsAlone`
  still only contains `STOOL`.

**2. `apps/pos/src/lib/queries.ts`**

- In `classifyCompartmentCode` (`queries.ts:1257-1265`), add a rule mapping `HEADREST` → `'Accessory'`
  (before the `'Other'` fallback) so the resolved compartment carries the correct group.

### Explicitly NOT changed (red lines #2, #4)

- Snap math, `cellEdges`, the 22 plan-view PNGs.
- Backend: `HEADREST` is already in the master compartment pool and tickable (no backend or migration
  change).
- Server-side pricing recompute engine: `HEADREST` flows through `computeMfgLinePrice` /
  `computeMfgLineCost` as an ordinary priced compartment cell — no engine change.

---

## Data flow

1. Maintenance master pool already contains `HEADREST` → it appears as a chip in the Allowed Options
   drawer and can be ticked per-Model (unchanged).
2. `useSofaCustomizerData` (`queries.ts`) reads `allowed_options.compartments`, builds a
   `ResolvedSofaCompartment` for `HEADREST` with `group: 'Accessory'` and its per-Model `priceSen`.
3. `CustomBuilder` palette: `HEADREST` is now in `SOFA_MODULES` (`stdIds`), so
   `customizerByNormId.has('HEADREST')` is true and `m.group === 'Accessory'` renders it under the
   Accessory group with its price (`customRow.priceSen`).
4. Canvas: `resolveModuleArtSrc('HEADREST')` returns the Maintenance `imageUrl` if uploaded, else the
   aliased `STOOL.png`. Cell is drawn at 50×30.
5. Closure: a `HEADREST`-only group is not closed (reason: "Accessory needs a sofa next to it");
   `HEADREST` + a closed sofa is fine (accessory does not break closure).
6. Order submit: server recompute prices the `HEADREST` cell from current per-Model compartment
   pricing — same path as any compartment.

---

## Edge cases

- **No price set:** palette shows `TBC` (existing behaviour via `priceRm == null`). Loo sets the
  price in the pricing editor.
- **No PNG uploaded:** falls back to `STOOL.png` via the alias — placeholder, not a broken image.
- **`HEADREST`-only build:** correctly blocked from closing with the generalized accessory message.
- **Mixed with sofa:** treated like any accessory cell; does not count toward seats/bundles
  (`cushions: 0`, `accessory: true`).

---

## Testing (`packages/shared/src/__tests__/sofa-build.test.ts`)

- `findModule('HEADREST')` resolves to a spec with `group: 'Accessory'`, `accessory: true`, `w: 50`,
  `d: 30`.
- `isAccessoryModule('HEADREST') === true`.
- `representativeArtCode('HEADREST') === 'STOOL'` (temporary alias).
- A `HEADREST`-only group → `closed === false`, `reason === 'Accessory needs a sofa next to it'`.
- A `HEADREST` + a closed single sofa group → `closed === true`.

Run gates: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build` (POS may need
`ALLOW_LOCAL_API_URL=1`).

---

## Deployment notes

- No migration. Code-only change to `packages/shared` + `apps/pos`.
- Deploy API/shared and POS bundle; remind Loo to hard-refresh the PWA after the POS deploy.
- After deploy, Loo: (a) confirm/ set the per-Model `HEADREST` price, (b) optionally upload the real
  `HEADREST` PNG in Maintenance to replace the STOOL placeholder.
