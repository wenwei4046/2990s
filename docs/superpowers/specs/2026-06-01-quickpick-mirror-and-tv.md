# Spec — Quick Pick mirror toggle + TV reference marker

**Date:** 2026-06-01
**Author:** Claude (with Loo)
**Scope:** POS Configurator → Quick Pick screen only
**Status:** approved for planning

---

## 1. Goal

Two small, independent enhancements to the POS **Quick Pick** screen
(`apps/pos/src/pages/Configurator.tsx` → `SofaQuickPick`):

1. **Mirror toggle** — let a salesperson flip an asymmetric saved Quick Pick
   left↔right (e.g. an L-shape chaise from right side to left side) for the
   order they're building, without leaving Quick Pick mode.
2. **TV reference marker** — show the same TV bar + orange "facing" beam on the
   Quick Pick preview canvas that the Customize page already shows, so the
   customer can see which way the sofa faces.

Non-coder summary: "let me turn the L-shape Quick Pick to the left or right, and
put the TV on the Quick Pick picture like the Customize page has."

---

## 2. Background — how it works today

- A **saved Quick Pick** (`QuickPickItem`) stores `modules: string[][]`
  (OR-set slots) + a `depth`. Selecting one sets `pickedQP`; the hero renders
  `cellsFromComboModules(pickedQP.modules, depth)` through `<SofaCellsPreview>`,
  and `handleAddQuickPick` builds the cart line from the same cells.
- There is already a `quickFlip: 'L' | 'R'` state, but it ONLY drives the
  **legacy bundle** PNG swap (`bundleArtSrc('2+L'|'3+L', flip)`). It does NOT
  touch saved Quick Picks. The cards in the screenshot ("2A(LHF) + L(RHF)",
  "1A(LHF) + 2A(RHF)", "2S", "1S") are all **saved Quick Picks**, so today they
  cannot be mirrored.
- `MIRROR_PAIR` (in `CustomBuilder.tsx`) maps `LHF↔RHF` for `1A/1B/2A/2B/L`.
  It's a local const, used only by the Customize drag-flip; not exported.
- **À-la-carte pricing** (`computeSofaPrice` in `packages/shared/src/sofa-build.ts`):
  `compRow(pricing, cell.moduleId)` matches the compartment row by **exact**
  `compartmentId === moduleId`. So `2A-LHF` and `2A-RHF` are distinct price keys.
- **Combo matching** (`matchComboSubset` in `sofa-combo-pricing.ts`): slots are
  OR-sets and the documented convention authors both hands in one slot
  (`['2A-LHF','2A-RHF']`), so a combo authored that way already matches either
  hand. Matching is order-independent.
- **TV marker** lives only in `CustomBuilder.tsx` + `CustomBuilder.module.css`
  (`.tv` 140×30 dark bar, `.tvScreen` gradient, `.tvLabel` "TV", `.tvBeam`
  orange up-triangle). It is positioned in absolute *room* coordinates
  (constants `TV_W=140, TV_H=30, TV_BOTTOM_MARGIN=30`). The Quick Pick hero has
  no "room" — `<SofaCellsPreview>` auto-scales the sofa to fill the frame.
- `<SofaCellsPreview>` is **shared** by the tiny rail card thumbnails
  (`.qpCardArt`) AND the big hero (`.qpHeroCells`). Anything added *inside* it
  would also appear on the thumbnails.

---

## 3. Feature 1 — Mirror toggle on saved Quick Picks

### 3.1 Pure transform (in `packages/shared/src/sofa-build.ts`)

```
mirrorCode(code: string): string
  // swap the single orientation token; codes with neither pass through.
  if code includes 'LHF'  → code.replace('LHF','RHF')
  else if code includes 'RHF' → code.replace('RHF','LHF')
  else → code              // 1NA, 2NA, WC-45, CNR, STOOL, etc.
```
`LHF`/`RHF` only ever appear as the orientation token and never both in one
code, so a plain conditional replace is safe for BOTH the dash form (`2A-LHF`)
and the parens form (`1A(P)(LHF)`).

```
mirrorModules(modules: string[][]): string[][]
  return modules
    .slice().reverse()                       // ① reverse left→right order
    .map(slot => slot.map(mirrorCode))       // ② swap LHF↔RHF in every code
```

`canMirror(modules)`: true iff the mirrored representative-code sequence differs
from the original (so symmetric layouts like `[[2A-LHF],[2A-RHF]]` → palindrome
→ `false`, asymmetric like `[[2A-LHF],[L-RHF]]` → `true`).

Worked example (matches the screenshot):
`[[2A-LHF],[L-RHF]]` → reverse `[[L-RHF],[2A-LHF]]` → swap `[[L-LHF],[2A-RHF]]`
= "L(LHF) + 2A(RHF)" (chaise moves right→left). ✔

### 3.2 UI

- New state in `Configurator`: `const [qpMirror, setQpMirror] = useState(false)`.
- Reset `qpMirror` to `false` whenever a different Quick Pick is selected
  (in `onQuickPickSelect`).
- The selected Quick Pick card shows a small **flip control** (Lucide
  `FlipHorizontal2`, stroke 1.75), styled like the existing `.qpFlip` control,
  ONLY when `canMirror(item.modules)` is true. Tap toggles `qpMirror`. Clicking
  it must `stopPropagation` so it doesn't re-fire card select.
- The effective modules for the selected pick are
  `qpMirror ? mirrorModules(pickedQP.modules) : pickedQP.modules`. This feeds:
  - the **hero** preview (`<SofaCellsPreview>` + `showDims`),
  - `priceForLayout` for the topbar LIVE TOTAL,
  - `handleAddQuickPick` (cart cells + label).
- Card label when mirrored: append nothing structural — `buildComboLabel`
  recomputes from the mirrored modules, so the displayed label naturally reads
  the flipped composition.

### 3.3 Price-invariance (the one engine change)

A flipped sofa must cost the same as its un-flipped twin. Add a mirror fallback
to the à-la-carte lookup inside `computeSofaPrice`:

```
const row = compRow(pricing, cell.moduleId)
         ?? compRow(pricing, mirrorCode(cell.moduleId));
```

- Additive only: it can never make a module cheaper or RM 0 — it only resolves a
  previously-unpriced hand to its mirror's price.
- POS and server both call `computeSofaPrice`, so the client total and the
  server recompute stay identical by construction → the >0.5% drift-reject in
  `POST /orders` cannot fire from mirroring. Honest-pricing promise intact.
- Combos: rely on the existing both-hand OR-set convention (already documented
  in `sofa-combo-pricing.ts`). A combo authored with both hands matches either
  orientation → identical combo price both ways. **Caveat:** a combo authored
  with only ONE hand (against convention) would match the original but not the
  mirror; the mirror then prices via the (price-invariant) à-la-carte sum, which
  could differ from that single-hand combo price. This is never RM 0 and never a
  drift-reject — it's a data-authoring edge, not a code bug. If Loo wants
  *guaranteed* identical price even for single-hand combos, that needs a
  mirror-aware combo matcher (bigger change, deferred unless requested).

### 3.4 Edge cases

- Symmetric layouts (1S, 2S): flip control hidden (`canMirror=false`).
- Console / corner / no-hand modules: pass through `mirrorCode` unchanged; only
  their order reverses.
- Editing an existing cart line: out of scope — mirror is a pre-add toggle;
  saved lines keep whatever cells they were added with.

---

## 4. Feature 2 — TV reference marker on Quick Pick canvas

Chosen form: **reference marker** (not a scaled mini-room).

- Add a TV marker as a sibling element inside `.qpHeroFrame` (NOT inside
  `<SofaCellsPreview>`), pinned bottom-center: a dark bar + "TV" label + an
  orange up-triangle beam just above it, sofa preview sitting above.
- Port the four styles (`.tv`, `.tvScreen`, `.tvLabel`, `.tvBeam`) from
  `CustomBuilder.module.css` into `Configurator.module.css`. In the hero they're
  positioned `absolute; left:50%; transform:translateX(-50%); bottom:<gap>`
  within the frame (fixed marker size ~130×28px — a reference, not to-scale),
  beam centered just above the bar.
- Renders for BOTH the saved-Quick-Pick hero and the bundle/preset hero.
- Hero-only: the rail thumbnails (`.qpCardArt`) get NO TV.
- `aria-hidden`, `pointer-events:none` — pure decoration.
- Must not collide with the bottom `D` dimension callout or `.qpHeroFoot`;
  reserve bottom space in the frame so the sofa preview and TV don't overlap.

---

## 5. Scope / non-goals

| In scope | Out of scope |
|---|---|
| Mirror saved Quick Picks (per-order toggle) | Saving a mirrored pick as a new card (use "Edit in Customize →") |
| Price-invariant mirror fallback (shared engine) | Re-pricing rules, combo authoring changes |
| TV reference marker on Quick Pick hero | Mini-room rendering; TV in Customize (already there) |
| POS Configurator + shared pkg | Backend, DB/migration, RLS, orders schema |

---

## 6. Files touched

- `packages/shared/src/sofa-build.ts` — add `mirrorCode`, `mirrorModules`,
  `canMirror`; add the à-la-carte mirror fallback in `computeSofaPrice`.
- `packages/shared/src/__tests__/sofa-build.test.ts` — mirror unit tests.
- `apps/pos/src/pages/Configurator.tsx` — `qpMirror` state, flip control on the
  selected card, mirrored modules feed hero + price + add-to-cart; TV marker in
  the hero.
- `apps/pos/src/pages/Configurator.module.css` — TV marker styles (+ flip
  control if a new class is needed).

---

## 7. Test plan / acceptance

1. **Unit (shared):**
   - `mirrorModules([[2A-LHF],[L-RHF]])` === `[[L-LHF],[2A-RHF]]`.
   - `mirrorCode` handles dash, parens, recliner variant, and no-hand codes.
   - `canMirror` false for 1S/2S, true for 2A+L and 1A+2A.
   - `computeSofaPrice` returns the SAME total for a layout and its
     `mirrorModules` twin, including when only one hand is priced.
2. **Typecheck + build:** `pnpm typecheck`, POS build green.
3. **Visual (POS Quick Pick):**
   - Select an L-shape Quick Pick → flip control appears → tap → hero flips L↔R,
     LIVE TOTAL unchanged.
   - 1S/2S → no flip control.
   - TV bar + beam shows on the hero, sofa above it facing the TV; NO TV on the
     small rail thumbnails.
   - Add a mirrored pick to cart → line reflects the flipped composition; server
     accepts (no drift-reject).
