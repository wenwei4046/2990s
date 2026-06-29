# Headrest Attach-to-Sofa-Back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a HEADREST accessory is dropped near a sofa's back, snap it flush and render it as a full-width band along that sofa's back (instead of a floating 50×30 box with duplicate dimension labels), while keeping it a separate SKU.

**Architecture:** One shared pure function `headrestBackTarget(headrest, cells, depth)` returns the sofa-group bbox a headrest is attached to (or null). The POS `CustomBuilder` consumes it in four places: drop-snap (align on drop), render (full-width band), dim-callout suppression, and closure (attached → closed). No snap-math, sofa-composite, PNG, pricing, or DB changes.

**Tech Stack:** TypeScript (strict), Vitest, React 19, pnpm workspace. Packages: `@2990s/shared` (pure geometry) + `@2990s/pos`.

## Global Constraints

- Red line #2: do NOT change `findSnap` core, `renderSeamlessSofa/Group`, snap math, or the 22 PNGs. Attachment is additive (render-time + drop-handler only).
- Red line #4: do NOT change server pricing/recompute. Headrest stays its own priced SKU line.
- No DB migration.
- v1 attaches to a sofa group's **top edge** only (standard orientation; sofas face the TV at the bottom). Rotated sofas don't attach.
- Attach tolerance: `HEADREST_ATTACH_TOL_CM = 20`. Band thickness = headrest depth (30 cm). Band colours: `SOFA_BAND` (#D9C2A0) fill, `SOFA_INK` (#2C2C2A) stroke (reuse `@2990s/pos`'s `sofa-seamless` exports).
- Base dims (depth 24, no offset): `1A=95×95`, `2A=158×95`, `HEADREST=50×30`.

---

### Task 1: `headrestBackTarget` shared helper

**Files:**
- Modify: `packages/shared/src/sofa-build.ts` (add after `cellsBbox`, ≈ line 954)
- Test: `packages/shared/src/__tests__/sofa-build.test.ts` (append a new `describe` at end of file)

**Interfaces:**
- Consumes: existing exports `findModule`, `moduleFootprint`, `isAccessoryModule`, `groupSofas`, `cellsBbox`, and types `Cell`, `Depth`, `Bbox` (all already in `sofa-build.ts`).
- Produces: `export const HEADREST_ATTACH_TOL_CM = 20;` and
  `export const headrestBackTarget = (headrest: Cell, cells: Cell[], depth: Depth): Bbox | null` —
  returns the sofa group's bbox whose top edge the headrest is attached to, else null.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/__tests__/sofa-build.test.ts`:

```ts
/* Case 9 — headrestBackTarget: headrest attaches to a sofa group's back (2026-06-30). */
describe('headrestBackTarget', () => {
  // depth '24' → no width offset, so footprints equal base dims.
  const hr = (x: number, y: number): Cell => ({ id: 'h', moduleId: 'HEADREST', x, y, rot: 0 });

  it('attaches above a single sofa and returns that sofa full width (95)', () => {
    const cells: Cell[] = [
      { id: 's', moduleId: '1A(RHF)', x: 200, y: 130, rot: 0 }, // 95×95, top=130
      hr(200, 100), // 50×30, bottom=130 flush with sofa top
    ];
    const bb = headrestBackTarget(hr(200, 100), cells, '24');
    expect(bb).not.toBeNull();
    expect(bb!.w).toBe(95);
    expect(bb!.x).toBe(200);
    expect(bb!.y).toBe(130);
  });

  it('returns the FULL width of a multi-module sofa group (158+158 = 316)', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '2A(LHF)', x: 100, y: 130, rot: 0 }, // open right
      { id: 'b', moduleId: '2A(RHF)', x: 258, y: 130, rot: 0 }, // open left — joins a
      hr(150, 100),
    ];
    const bb = headrestBackTarget(hr(150, 100), cells, '24');
    expect(bb).not.toBeNull();
    expect(bb!.w).toBe(316);
  });

  it('returns null when far from any sofa (vertical gap beyond tolerance)', () => {
    const cells: Cell[] = [
      { id: 's', moduleId: '1A(RHF)', x: 200, y: 130, rot: 0 },
      hr(200, 400),
    ];
    expect(headrestBackTarget(hr(200, 400), cells, '24')).toBeNull();
  });

  it('returns null when there is no horizontal overlap', () => {
    const cells: Cell[] = [
      { id: 's', moduleId: '1A(RHF)', x: 200, y: 130, rot: 0 }, // spans 200..295
      hr(500, 100), // spans 500..550 — no overlap
    ];
    expect(headrestBackTarget(hr(500, 100), cells, '24')).toBeNull();
  });

  it('picks the nearer sofa back when two qualify', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '1A(RHF)', x: 200, y: 130, rot: 0 }, // top 130, gap |130-100|=30
      { id: 'b', moduleId: '1A(RHF)', x: 230, y: 120, rot: 0 }, // top 120, gap |120-100|=20 (nearer)
      hr(210, 100),
    ];
    const bb = headrestBackTarget(hr(210, 100), cells, '24');
    expect(bb).not.toBeNull();
    expect(bb!.y).toBe(120); // group b
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @2990s/shared exec vitest run sofa-build`
Expected: FAIL — `headrestBackTarget is not a function` (not yet exported).

- [ ] **Step 3: Implement the helper**

In `packages/shared/src/sofa-build.ts`, immediately after `cellsBbox` (the function ending ≈ line 954), add:

```ts
/** Vertical tolerance (cm) for a headrest to count as "on" a sofa's back. */
export const HEADREST_ATTACH_TOL_CM = 20;

/** The sofa GROUP bbox a headrest is attached to (flush against its back/top
 *  edge), or null when free-standing. Attached = the headrest horizontally
 *  overlaps a non-accessory sofa group AND that group's top edge lies within
 *  the headrest footprint expanded vertically by HEADREST_ATTACH_TOL_CM.
 *  Pure: re-derives sofa groups from `cells`. v1 matches the group's TOP edge
 *  only (standard orientation). */
export const headrestBackTarget = (
  headrest: Cell,
  cells: Cell[],
  depth: Depth,
): Bbox | null => {
  const hm = findModule(headrest.moduleId);
  if (!hm) return null;
  const hfp = moduleFootprint(hm, headrest.rot, depth);
  const hTop = headrest.y;
  const hBottom = headrest.y + hfp.h;
  const hLeft = headrest.x;
  const hRight = headrest.x + hfp.w;
  const sofaCells = cells.filter(
    (c) => c.id !== headrest.id && !isAccessoryModule(c.moduleId),
  );
  let best: Bbox | null = null;
  let bestGap = Infinity;
  for (const g of groupSofas(sofaCells, depth)) {
    const bb = cellsBbox(g, depth);
    if (!bb) continue;
    const overlap = Math.min(hRight, bb.x + bb.w) - Math.max(hLeft, bb.x);
    if (overlap <= 0) continue;
    const groupTop = bb.y;
    if (groupTop < hTop - HEADREST_ATTACH_TOL_CM || groupTop > hBottom + HEADREST_ATTACH_TOL_CM) continue;
    const gap = Math.abs(groupTop - hTop);
    if (gap < bestGap) { bestGap = gap; best = bb; }
  }
  return best;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @2990s/shared exec vitest run sofa-build`
Expected: PASS — all 5 new tests green, no regression.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sofa-build.ts packages/shared/src/__tests__/sofa-build.test.ts
git commit -m "feat(shared): headrestBackTarget — detect a headrest attached to a sofa back"
```

---

### Task 2: Drop-snap the headrest flush to the sofa back (POS)

**Files:**
- Modify: `apps/pos/src/pages/CustomBuilder.tsx` (imports ≈ line 5-33; `onCellPointerUp` single-cell branch ≈ line 588-618)

**Interfaces:**
- Consumes: `headrestBackTarget` (Task 1).
- Produces: on drop, a HEADREST cell near a sofa back gets `x`/`y` aligned to that group's top-left.

- [ ] **Step 1: Import the helper**

In `apps/pos/src/pages/CustomBuilder.tsx`, add `headrestBackTarget` to the `@2990s/shared` import block (the one starting at line 5):

```ts
  orderSofaCellsLeftToRight,
  summarizeSofaCells,
  headrestBackTarget,
  findDuplicateCombo,
```

- [ ] **Step 2: Inject the back-snap after clamp**

In `onCellPointerUp`, in the single-cell branch, immediately AFTER the clamp lines (`finalY = Math.max(0, Math.min(finalY, roomH - fp.h));`, line 602) and BEFORE the `let flippedId` block (line 604), add:

```ts
      // Headrest snaps flush to a sofa's back on drop (2026-06-30). Align the
      // cell to the target group's top-left; render then draws it full-width.
      if (cell.moduleId === 'HEADREST') {
        const back = headrestBackTarget({ ...cell, x: finalX, y: finalY }, cells, depth);
        if (back) { finalX = back.x; finalY = back.y; }
      }
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/pages/CustomBuilder.tsx
git commit -m "feat(pos): snap a dropped headrest flush to the nearest sofa back"
```

---

### Task 3: Render the attached headrest as a full-width band + suppress its dims + close it (POS)

**Files:**
- Modify: `apps/pos/src/pages/CustomBuilder.tsx` (imports; `analyses` memo ≈ line 653-657; dim-callout `groups.map` ≈ line 1346-1390; cell render `displayCells.map` ≈ line 1393-1469)

**Interfaces:**
- Consumes: `headrestBackTarget` (Task 1), `SOFA_BAND`, `SOFA_INK` (from `../lib/sofa-seamless`).
- Produces: an attached headrest renders as a band on the sofa back; its standalone dim callout is hidden; its one-cell group counts as closed.

- [ ] **Step 1: Import the band colours**

In `apps/pos/src/pages/CustomBuilder.tsx`, extend the `../lib/sofa-seamless` import (line 34) to include the palette colours:

```ts
import { buildSeamlessRun, renderSeamlessSofa, renderSeamlessGroup, isFunctionalSeat, SOFA_BAND, SOFA_INK, type SeamlessRun } from '../lib/sofa-seamless';
```

- [ ] **Step 2: Close an attached-headrest group (analyses memo)**

Replace the `analyses` memo (lines 654-657) with:

```ts
  const analyses = useMemo(
    () => groups.map((g) => {
      const a = { group: g, ...analyzeSofa(g, depth) };
      // An attached headrest (renders as a band on a sofa back) counts as
      // closed — it no longer needs its own "needs a sofa" prompt.
      if (!a.closed && g.length === 1 && g[0]!.moduleId === 'HEADREST'
          && headrestBackTarget(g[0]!, cells, depth)) {
        return { ...a, closed: true, reason: null };
      }
      return a;
    }),
    [groups, depth, cells],
  );
```

- [ ] **Step 3: Suppress the standalone dim callout for an attached headrest**

In the per-group dim-callout block (`groups.map`, line 1346), right after `const ids = new Set(...)` (line 1347) — i.e. before `if (editingGroupIds ...)` on line 1351 — add:

```ts
            // An attached headrest renders as a band on the sofa; hide its own
            // 50/30 callouts so they don't duplicate the sofa's.
            if (g.length === 1 && g[0]!.moduleId === 'HEADREST'
                && headrestBackTarget(g[0]!, displayCells, depth)) return null;
```

- [ ] **Step 4: Render the band in the cell map**

In `displayCells.map` (line 1393), after `const nativeH = isSideways ? m.d * SCALE : h;` (line 1415), the `px/py/w/h/nativeW/nativeH` are already computed above. Replace the geometry lines (1399-1415) so an attached headrest uses the sofa group's box. Change:

```ts
            const fp = moduleFootprint(m, c.rot, depth);
            const isSelected = c.id === selectedId;
            const inViolation = c.id != null && violationCellIds.has(c.id);
            const px = (c.x ?? 0) * SCALE;
            const py = (c.y ?? 0) * SCALE;
            const w = fp.w * SCALE;
            const h = fp.h * SCALE;
```

to:

```ts
            const fp = moduleFootprint(m, c.rot, depth);
            const isSelected = c.id === selectedId;
            const inViolation = c.id != null && violationCellIds.has(c.id);
            // Attached headrest → draw as a full-width band on the sofa back.
            const headrestBack = c.moduleId === 'HEADREST'
              ? headrestBackTarget(c, displayCells, depth) : null;
            const px = (headrestBack ? headrestBack.x : (c.x ?? 0)) * SCALE;
            const py = (headrestBack ? headrestBack.y : (c.y ?? 0)) * SCALE;
            const w = (headrestBack ? headrestBack.w : fp.w) * SCALE;
            const h = fp.h * SCALE; // band thickness = headrest depth (30cm)
```

Then in the art IIFE (lines 1439-1469), make the band replace the STOOL image when attached. Change the IIFE body's start (after `if (c.id != null && compositeCoveredIds.has(c.id)) return null;`, line 1445) to short-circuit to a band:

```ts
                    if (c.id != null && compositeCoveredIds.has(c.id)) return null;
                    if (headrestBack) {
                      // Full-width backrest band — matches the sofa's band colour
                      // so it reads as one continuous backrest.
                      return (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: SOFA_BAND,
                            border: `1px solid ${SOFA_INK}`,
                            borderRadius: 8,
                          }}
                        />
                      );
                    }
                    const artSrc = resolveModuleArtSrc(c.moduleId);
```

(The rest of the IIFE — `bbox`, `imgW`, the `<img>` — stays; it's only reached when `headrestBack` is null.)

- [ ] **Step 5: Verify it typechecks**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/pages/CustomBuilder.tsx
git commit -m "feat(pos): render an attached headrest as a full-width sofa-back band"
```

---

### Task 4: Verify gates + live QA, remove the dev harness

**Files:**
- Delete: `apps/pos/src/pages/dev/HeadrestHarness.tsx`
- Modify: `apps/pos/src/router.tsx` (remove the temp `/dev/headrest` route + its import)

- [ ] **Step 1: Live QA in the dev harness (before removing it)**

With the dev server running (`pnpm --filter @2990s/pos dev`, harness at `/dev/headrest` — its cells already include a `1A(RHF)` sofa + a `HEADREST`), confirm:
- The HEADREST renders as a full-width band along the sofa's top (back), same colour family as the sofa — not a separate STOOL box.
- Only the sofa's dimension labels show (no duplicate 50/30 headrest labels).
- Dragging the headrest away from the sofa reverts it to a 50×30 box with "Accessory needs a sofa next to it"; dragging it back near the sofa back snaps it flush into a band again.
- The closure pill no longer says the headrest is unresolved while attached.

- [ ] **Step 2: Run the full gates**

Run:
```bash
pnpm typecheck
pnpm test
pnpm lint
```
Expected: all PASS. (POS `build` may need `ALLOW_LOCAL_API_URL=1`.) The one pre-existing lint error in `apps/backend/src/lib/authed-fetch.ts` is unrelated — confirm it is not in the changed files.

- [ ] **Step 3: Remove the temporary harness**

Delete `apps/pos/src/pages/dev/HeadrestHarness.tsx`. In `apps/pos/src/router.tsx`, remove the import line `import { HeadrestHarness } from './pages/dev/HeadrestHarness';` and the route `{ path: '/dev/headrest', element: <HeadrestHarness /> },` (with its TEMP comment).

- [ ] **Step 4: Verify the harness is gone and typecheck still passes**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS, no dangling reference to `HeadrestHarness`.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/router.tsx apps/pos/src/pages/dev/HeadrestHarness.tsx
git commit -m "chore(pos): remove temporary headrest dev harness"
```

---

## Post-merge / deploy notes (not implementation steps)

- Code-only, no migration. Deploy POS (+ shared). Remind Loo to hard-refresh the PWA.
- Spec: `docs/superpowers/specs/2026-06-30-headrest-attach-to-sofa-back-design.md`.
