# POS Desktop Layout — Design Spec

| | |
|---|---|
| **Date** | 2026-05-10 |
| **Author** | Claude (with Loo) — brainstormed via `superpowers:brainstorming` |
| **Branch** | `main` |
| **Phase** | Cross-cutting UI polish (touches Phase 1–3 surfaces; not on the original phase plan) |
| **Status** | Design approved, awaiting `writing-plans` skill to produce implementation plan |
| **Estimated work** | ~5–7 days for full implementation + visual regression |

---

## 1. Goal & Scope

### 1.1 What we're building

A desktop-tier layout pass for the POS app, additive on top of the existing tablet-first design. The locked tablet UX is unchanged; FHD-class displays gain layout adjustments that use the extra horizontal space without changing flows or features.

Concretely:

1. **Single new media-query block** in 6 of 9 page CSS modules (Catalog, Handover, Cart, OrderConfirmed, OrderStatus, Quotes) plus `Topbar.module.css`.
2. **One new component** — `<CartRail>` — rendered only on `/catalog` at desktop. A 320px sticky right-side cart panel that mirrors the existing `/cart` page contents.
3. **One new hook** — `useMediaQuery(query: string): boolean` — runtime detection so the Catalog page conditionally mounts `<CartRail>` and hides the cart fab.
4. **One refactor** — extract the inner contents of `Cart.tsx` into a standalone `<CartContents>` so both `/cart` route and `<CartRail>` reuse the same JSX + `useCart` Zustand store.

### 1.2 Out of scope (explicitly)

- ❌ **Sofa configurator + custom builder.** `Configurator.tsx`, `CustomBuilder.tsx`, and their CSS modules are untouched. Per `CLAUDE.md` red line #2, the configurator design is locked. At desktop, the existing 1100px max-width centered layout is preserved.
- ❌ **New features / flows / power-user shortcuts.** No keyboard shortcuts, Cmd+K palette, multi-tab, or workflow restructuring. The user explicitly chose "rearrange layout only, no feature changes."
- ❌ **Multi-step Handover flattening.** The 3-step wizard (`01 CART · 02 CUSTOMER · 03 CONFIRMED`) stays. Within each step, form fields go from single-column to two/three-column.
- ❌ **Dense list mode for Catalog.** The product card grid stays; only the column count grows.
- ❌ **New design tokens.** Reuses existing `--space-*`, `--radius-*`, `--shadow-*`, `--c-*`, `--font-*` from `packages/design-system/src/tokens.css`.
- ❌ **PWA manifest changes.** `orientation: 'landscape'` stays. Has no effect in desktop browsers; only constrains iPad PWA installs.
- ❌ **Mobile / phone support.** Out of scope. POS targets are still tablet-first ≥1024×768 and desktop ≥1280×800.
- ❌ **E2E coverage.** `docs/known-issues/2026-05-09-e2e-test-blockers.md` blocks new e2e. Visual regression via gstack `/browse` only.

### 1.3 Why this is "approved deviation" not "feature change"

`UI_REFERENCE.md` says the prototype is canonical for tablet UI. The prototype was never designed for desktop — there is no canonical desktop spec to deviate from. This spec extends into desktop territory the prototype did not cover. Per the deviation protocol, it gets logged as `§3` in `UI_REFERENCE.md` "Approved deviations."

---

## 2. Architecture

### 2.1 Breakpoint strategy

A single primary desktop breakpoint:

```css
@media (min-width: 1280px) and (hover: hover) and (pointer: fine)
```

The `hover: hover` + `pointer: fine` guards are load-bearing:

| Device | viewport | hover | pointer | Triggers desktop? |
|---|---|---|---|---|
| iPad mini landscape | 1024×768 | none | coarse | No (width too small) |
| iPad 10.9" landscape | 1180×820 | none | coarse | No (width too small) |
| iPad Pro 11" landscape | 1194×834 | none | coarse | No (width too small) |
| iPad Pro 12.9" landscape (no kb) | 1366×1024 | none | coarse | No (pointer guard) |
| iPad Pro 12.9" + Magic Keyboard | 1366×1024 | hover | fine | **Yes** |
| Counter desktop FHD | 1920×1080 | hover | fine | **Yes** |
| Desk laptop QHD | 2560×1440 | hover | fine | **Yes** |
| Phone landscape | 844×390 | none | coarse | No |

Without the pointer guards, a 12.9" iPad in pure tablet mode would land in the desktop layout, which violates the locked tablet-first decision for that device.

Single breakpoint avoids middle-tier complexity. We do not introduce a "small desktop / large desktop" split at this iteration.

### 2.2 New files

```
apps/pos/src/
├── hooks/
│   └── useMediaQuery.ts            (~30 lines, new)
├── components/
│   ├── CartRail.tsx                (~80 lines, new)
│   └── CartRail.module.css         (~120 lines, new)
└── pages/
    └── Cart.tsx                    (refactor: extract <CartContents>)
```

### 2.3 Modified files (CSS-only desktop blocks)

```
apps/pos/src/components/Topbar.module.css       (+ desktop block)
apps/pos/src/pages/Catalog.module.css           (+ desktop block, 6-col grid + hide fab)
apps/pos/src/pages/Cart.module.css              (+ desktop block, max-width 1400→1600px)
apps/pos/src/pages/Handover.module.css          (+ desktop block, form 2/3-col)
apps/pos/src/pages/OrderConfirmed.module.css    (+ desktop block, max-width adjust)
apps/pos/src/pages/OrderStatus.module.css       (+ desktop block, max-width + lane history)
apps/pos/src/pages/Quotes.module.css            (+ desktop block, max-width + columns)
apps/pos/src/pages/Login.module.css             (no change)
apps/pos/src/pages/Configurator.module.css      (no change — locked)
apps/pos/src/pages/CustomBuilder.module.css     (no change — locked)
```

### 2.4 Modified TSX files

```
apps/pos/src/pages/Catalog.tsx                  (mount <CartRail/>, hide fab at desktop)
apps/pos/src/pages/Cart.tsx                     (extract <CartContents/>)
```

No router changes. No new dependencies. No new envvars.

---

## 3. Components

### 3.1 `useMediaQuery` hook

```ts
// apps/pos/src/hooks/useMediaQuery.ts
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
```

Usage:

```tsx
const isDesktop = useMediaQuery('(min-width: 1280px) and (hover: hover) and (pointer: fine)');
```

The `typeof window` guard is defensive — Vite SPA does not SSR, but the guard makes the hook safe if anyone imports it from a future SSR context.

### 3.2 `<CartRail>` component

A 320px sticky-right panel rendered next to the catalog grid at desktop. Visual structure:

```
┌─ CART · N items ─────────┐
│ Line 1: Product · qty   │
│   sub-config preview    │
│   RM 2,990              │
├─────────────────────────┤
│ Line 2: ...             │
├─────────────────────────┤
│ Subtotal       RM 6,060 │
│ [ Continue to customer ]│
└─────────────────────────┘
```

Behavior:

- Reads from existing `useCart()` Zustand store. No new state.
- Empty state: "Cart is empty · tap a product to add." (already exists in `Cart.tsx`.)
- Qty stepper, remove, addons section: all reuse `<CartContents>` extracted from `Cart.tsx`.
- "Continue to customer" CTA navigates to `/handover` (same target as the existing `/cart` page button).
- No max-height on the rail body — uses sticky positioning relative to viewport, scrolls within itself if cart grows past viewport height.
- Sticky with `top: var(--space-3)` so it sits below the topbar on FHD.

### 3.3 `<CartContents>` extraction

`Cart.tsx` today renders the cart inline. The refactor moves the inner JSX (line list, addons, subtotal, CTAs) into a separate `<CartContents>` component that takes:

```ts
interface CartContentsProps {
  variant: 'page' | 'rail';   // controls layout/spacing scaling
  onContinue: () => void;     // page navigates to /handover; rail does same
}
```

`Cart.tsx` becomes a thin route wrapper that renders `<CartContents variant="page" />` inside the existing page chrome. `<CartRail>` renders `<CartContents variant="rail" />` inside the sticky panel.

---

## 4. Per-page changes

### 4.1 Catalog (structural)

`Catalog.module.css` — add at the bottom:

```css
@media (min-width: 1280px) and (hover: hover) and (pointer: fine) {
  .layout {
    grid-template-columns: 240px 1fr 320px;
  }
  .grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  .fab {
    display: none;
  }
}
```

`Catalog.tsx` — at top of component:

```tsx
const isDesktop = useMediaQuery('(min-width: 1280px) and (hover: hover) and (pointer: fine)');
// ...
<div className={s.layout}>
  <Sidebar />
  <Grid />
  {isDesktop && <CartRail />}
</div>
```

The fab is CSS-hidden at desktop (avoids tablet flash before hook resolves) AND not rendered when `isDesktop` (clean DOM). CartRail renders only when desktop.

### 4.2 Handover (structural)

`Handover.module.css` — desktop block converts form rows from `flex-direction: column` to `display: grid; grid-template-columns: 1fr 1fr;` for paired fields, and 3-col for postcode/city/state. Wizard stepper unchanged. The existing right-side order summary panel stays.

The exact field grouping (which fields pair) is implementation-detail; placeholder grouping in the spec mockup:

```
Row 1: [ Name        ] [ Phone       ]
Row 2: [ Email (optional, full width) ]
Row 3: [ Address line 1 (full width) ]
Row 4: [ Address line 2 (full width) ]
Row 5: [ Postcode ] [ City     ] [ State    ]
Row 6: [ Emergency contact name ] [ Emergency phone ]
```

### 4.3 Topbar (cosmetic)

`Topbar.module.css` desktop block:

```css
.iconBtn { width: 32px; height: 32px; }   /* was 36 */
.staffMeta .staffRole { font-size: 10px; } /* was 11 */
```

The 28px avatar stays — readable, consistent with brand.

### 4.4 Cart route page (cosmetic)

`Cart.module.css` desktop block bumps `max-width: 1400px → 1600px`. CartRail does NOT render on `/cart` (would be a duplicate cart view). The Catalog-side conditional rendering already handles this — `<CartRail>` is only mounted from `Catalog.tsx`.

### 4.5 OrderConfirmed / OrderStatus / Quotes (cosmetic)

Each gets a desktop block raising `max-width` (specifics in implementation plan). No layout structure changes. Quotes additionally widens the per-row layout to surface amount/date/status side by side.

### 4.6 Login (no change)

PIN pad is centered + already small. Stretches sensibly on big screens. No desktop block.

### 4.7 Configurator + CustomBuilder (locked, untouched)

No desktop block. `max-width: 1100px` centered layout preserved. On a 1920px screen this leaves ~410px whitespace each side. Acceptable per `CLAUDE.md` red line #2.

---

## 5. Data flow

No changes. Cart state lives in `apps/pos/src/state/cart.ts` (Zustand with `persist` to localStorage). `<CartRail>` reads via `useCart()` hook just like `Cart.tsx` does. Adding to cart from Catalog updates Zustand → both `<CartRail>` and Topbar cart chip re-render.

API client unchanged. No new endpoints. No new mutations.

---

## 6. Edge cases

1. **iPad Pro + Magic Keyboard mid-session.** Connecting the keyboard fires the matchMedia `change` event; `useMediaQuery` flips to `true`; CartRail mounts; fab hides. Cart state preserved across the transition (Zustand store, not component state).
2. **Window resize across the 1280px threshold.** Same path as #1. ~one frame to remount. Acceptable.
3. **First paint flash.** `useMediaQuery`'s initial-state lazy evaluator calls `matchMedia` synchronously before paint, so the first commit already knows desktop vs tablet. No "tablet → desktop" flicker.
4. **`/cart` route reached on desktop.** Page renders normally without rail. Topbar cart chip still shows count. User can navigate to `/handover` from the page CTA.
5. **Topbar cart chip + CartRail simultaneously.** Both visible; redundant but not conflicting (chip is a count badge, rail shows full cart). No deduplication needed.
6. **Cart grows past viewport height.** Rail body has internal `overflow-y: auto`. The sticky panel itself doesn't grow past `100vh - top-offset`.
7. **User adds item from Catalog while cart is at scroll position.** Zustand subscription re-renders; new line appears at top; rail scrollTop preserved (React reconciliation, not full remount).
8. **Configurator opened on desktop.** No CartRail (only Catalog mounts it). Configurator's 1100px centered layout preserved. User must close configurator and return to Catalog to see updated cart in rail — same UX as on tablet.

---

## 7. Testing strategy

| Layer | Tool | Coverage |
|---|---|---|
| Hook unit | Vitest | `useMediaQuery`: matches/no-matches/change-event with mocked `window.matchMedia` |
| Visual regression | gstack `/browse` | POS dev server `localhost:6273`. Screenshot all 9 pages at 1180×820 (iPad) and 1920×1080 (FHD), before vs after diff. Regression check covers all 9 even though only 6 + Topbar see structural change — catches accidental token/global cascade leaks. |
| Cart state share | Manual | Drag window across 1280 threshold; cart contents must persist; CartRail mount/unmount must be smooth |
| iPad real device | Manual at pilot | Verify hover/pointer guards keep iPad on tablet layout |

**Not in scope:** new Playwright e2e (e2e currently blocked per `docs/known-issues/2026-05-09-e2e-test-blockers.md`). New component snapshot tests for CartRail are also out — visual regression covers it.

---

## 8. Deviation log entry to add

Append to `UI_REFERENCE.md` "Approved deviations" section:

```markdown
### §3 · POS desktop layout (≥1280px hover-and-pointer:fine)

**Approved on:** 2026-05-10
**Status:** Spec at docs/superpowers/specs/2026-05-10-pos-desktop-view-design.md

**What changed:**
- POS gains a desktop breakpoint at min-width:1280px with hover:hover + pointer:fine
  guards. iPad Pro 12.9" without keyboard stays on tablet layout; with Magic Keyboard
  (or any pointing device) triggers desktop.
- Catalog: 4-col product grid → 6-col, cart fab hidden at desktop, <CartRail/> mounts
  as 320px right sticky panel.
- Handover form: single-column → two/three-column within each wizard step (stepper
  flow unchanged).
- Other pages (Login / Cart route / OrderConfirmed / OrderStatus / Quotes / Topbar):
  cosmetic only — container max-width tweaks, font-size adjustments, iconBtn 36→32.
- Sofa configurator + CustomBuilder: explicitly untouched per CLAUDE.md red line #2.
  1100px max-width centered preserved on FHD.

**New code:** apps/pos/src/hooks/useMediaQuery.ts, apps/pos/src/components/CartRail.tsx
(+ CSS module). apps/pos/src/pages/Cart.tsx refactored to extract <CartContents/>.

**Not changed:** prototype/ files (tablet-canonical and not desktop-aware), PWA
manifest, design tokens, routes, schema, API contracts.
```

---

## 9. Open questions / risks

- **Q1.** Cart rail "Continue to customer" CTA — should it route directly to `/handover` (skipping `/cart`)? Proposal: yes. Rationale: on desktop, the user already sees the cart in the rail; routing to `/cart` first is redundant. On tablet, the fab → `/cart` → handover flow stays.
- **Q2.** Topbar cart chip on desktop — keep, hide, or convert to a "scroll cart rail into view" affordance? Proposal: keep as-is. It's a count badge that's useful at a glance even when rail is visible.
- **R1.** Visual regression budget. 8 pages × 2 viewports = 16 screenshots before, 16 after. Manual diff. Allow ~30 min per pass. If automated diff (Playwright trace, Percy) is desired, scope creep — defer.
- **R2.** `CartContents` extraction risk. Cart.tsx is non-trivial (qty steppers, addons, removals). Extracting may surface implicit prop dependencies. Mitigation: extract as a clean refactor commit before adding rail-specific code; verify `/cart` route renders identically to before.

---

## 10. Acceptance

This iteration is done when:

1. Desktop FHD 1920×1080: `/catalog` shows 6-col product grid + 320px CartRail, no fab.
2. Desktop FHD: `/handover` step 2 form fields lay out in 2 or 3 columns where appropriate.
3. iPad 10.9" landscape (1180×820): POS looks identical to today (no regression).
4. iPad Pro 12.9" no keyboard: tablet layout (pointer guard correctly excludes).
5. iPad Pro 12.9" + Magic Keyboard: desktop layout.
6. Cart contents survive a window resize across 1280px in either direction.
7. `pnpm typecheck` passes 6/6 workspaces.
8. `pnpm --filter @2990s/pos test` passes — including the new `useMediaQuery` test.
9. `UI_REFERENCE.md` §3 deviation entry committed.
10. Implementation plan (next step, `writing-plans`) lists each affected file with a verifiable change.
