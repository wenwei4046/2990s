# Headrest attaches to a sofa's back (renders as a full-width band)

**Date:** 2026-06-30
**Author:** Wei Siang (with Claude)
**Status:** Approved design — ready for implementation plan

---

## Problem

`HEADREST` shipped as a free-standing accessory module (50×30 floor box, like Console/STOOL —
see `2026-06-29-headrest-accessory-module-design.md`). When a salesperson places it next to a sofa,
it renders as a separate 50×30 box sitting on top of the sofa, and its own dimension labels (50/30)
overlap the sofa's (105/95). Confirmed by live reproduction: the canvas holds **two separate groups**
(sofa composite + headrest box) whose dim callouts stack and clutter. Loo calls this "unnormal."

A headrest physically sits along the **back** of a sofa. It must stay a **separate SKU line** in the
sales order (so the per-seat-upgrade model is ruled out — that wouldn't be its own SKU).

## Goal

When a headrest is attached to a sofa's back, render it as a **full-width band** flush along that
sofa's back (top) edge — looking like an integrated backrest — instead of a floating box with
duplicate dimension labels. Keep it a separate SKU; keep standalone behaviour unchanged.

## Decisions (Loo, 2026-06-30)

| Question | Decision |
|---|---|
| Band width | **Full width** of the sofa (group) it attaches to. |
| Attach trigger | **Snap on drop** — dropping a headrest near a sofa's back aligns it flush to that back. No live during-drag snap (avoids touching the `findSnap` core / red line #2). |
| Standalone headrest (not on a back) | **Still allowed**, still reads "not closed — needs a sofa next to it" (unchanged). |
| Sales order | Headrest stays its **own SKU line** (pricing + snapshot unchanged). |
| Band thickness | Headrest depth = **30 cm**, drawn at the top (back) of the sofa, overlapping the back-band region. |
| Band style | Sofa **band colour** (`SOFA_BAND`) + ink outline (`SOFA_INK`), rounded — reads as one continuous backrest. Not the STOOL art. |
| Orientation | v1 supports the standard orientation only: **back = the sofa group's top edge** (sofas face the TV at the bottom). Rotated-sofa attachment is out of scope for v1. |

## Architecture

One shared pure function drives everything; all UI changes are render-time + a drop-handler tweak in
the POS Configurator's `CustomBuilder`. No PNG, sofa-composite engine, pricing, or DB changes.

### New shared helper — `packages/shared/src/sofa-build.ts`

```ts
/** The sofa GROUP bbox a headrest is attached to (flush against its back/top
 *  edge), or null when the headrest is free-standing. "Attached" = the
 *  headrest's footprint horizontally overlaps a non-accessory sofa group AND
 *  its bottom edge is within HEADREST_ATTACH_TOL_CM of that group's top edge.
 *  Pure: re-derives sofa groups from `cells` (groupSofas, accessories dropped).
 *  Used by render (full-width band), drop-snap, dim-suppression, and closure. */
export const HEADREST_ATTACH_TOL_CM = 20;
export const headrestBackTarget = (
  headrest: Cell,
  cells: Cell[],
  depth: Depth,
): Bbox | null => { /* see plan */ };
```

- Sofa groups = `groupSofas(cells.filter(c => !isAccessoryModule(c.moduleId)), depth)`, each measured
  with `cellsBbox`. (Headrest is an accessory, so it never joins these groups — confirmed: it sits in
  its own group today.)
- A headrest's footprint comes from `moduleFootprint(findModule('HEADREST'), rot, depth)` = 50×30.
- Match rule: horizontal overlap > 0 with the group AND the group's **top edge** `groupTop` lies within
  the headrest's footprint expanded by `TOL` vertically — i.e.
  `headrestTop - TOL <= groupTop <= headrestBottom + TOL`. This catches the headrest overlapping the
  sofa's back band, sitting just above it, or dropped slightly into it — without depending on an exact
  flush position. Pick the group whose `groupTop` is nearest the headrest when several qualify.

### POS — `apps/pos/src/pages/CustomBuilder.tsx`

1. **Drop-snap** (single-cell drop, after `findSnap` + clamp, `~CustomBuilder.tsx:598-602`):
   if the dropped cell is `HEADREST` and `headrestBackTarget(droppedCell, otherCells, depth)` returns a
   group bbox `g`, override `finalX = g.x` (band spans the group), `finalY = g.y` (flush at the back),
   so the stored cell sits flush at the group's back-left. (Width comes from `g` at render time;
   storing `x=g.x` keeps attachment stable across re-renders.)

2. **Render** (`displayCells.map`, `~CustomBuilder.tsx:1393-1606`): compute
   `const back = headrestBackTarget(c, displayCells, depth)` for each `HEADREST` cell.
   - `back != null` → render the cell as a **full-width band**: wrapper rect at
     `left=g.x*SCALE, top=g.y*SCALE, width=g.w*SCALE, height=HEADREST_DEPTH*SCALE`, art = a styled
     rounded band (`SOFA_BAND` fill, `SOFA_INK` stroke) — NOT the STOOL `<img>`. Keep the cell
     draggable (dragging the band re-runs drop-snap).
   - `back == null` → unchanged 50×30 STOOL-art box.

3. **Dim callouts** (`groups.map`, `~CustomBuilder.tsx:1346-1390`): skip the callout for a
   headrest-only group when that headrest is attached (`headrestBackTarget != null`) — removes the
   duplicate 50/30 labels. The sofa's own callouts are untouched.

4. **Closure** (`analyses`, `~CustomBuilder.tsx:653-655` + the "not closed" pill `~1227-1231` /
   Resolve gate): for a headrest-only group whose headrest is attached, treat it as **closed**
   (override in the POS consumer, where all cells are in scope — `analyzeSofa` stays pure). Standalone
   headrest still reports "Accessory needs a sofa next to it".

### Not changed
- `findSnap` core, sofa-composite renderers (`renderSeamlessSofa/Group`), the 22 PNGs, snap math
  (red line #2).
- Server recompute / pricing / SKU lines — headrest remains its own priced line (red line #4 intact).
- DB / migrations — none.
- Standalone headrest behaviour.

## Data flow

1. Drag headrest, drop near a sofa back → drop handler calls `headrestBackTarget` → snaps the cell to
   the group's back-left.
2. Each render, `headrestBackTarget` re-derives attachment from current cells → drives band render,
   dim-callout suppression, and closure.
3. Build snapshot / SO line: unchanged — the headrest cell is one accessory SKU as today.

## Edge cases

- **Two sofas on the canvas:** headrest attaches to the group with the smallest vertical gap that it
  horizontally overlaps; ambiguous overlaps resolve to the nearest.
- **Headrest dragged off the back:** `headrestBackTarget` returns null next render → reverts to the
  50×30 box + "needs a sofa" + its own callouts.
- **Sofa moved away from a headrest:** same — attachment is derived each render, not stored, so it
  releases automatically.
- **Multiple headrests on one sofa back:** each independently attaches and renders full-width (they
  overlap visually). Acceptable for v1; not blocked.
- **Rotated sofa:** v1 only matches the group's top edge; a rotated sofa simply won't attach (headrest
  stays a box). Documented limitation.

## Testing (`packages/shared/src/__tests__/sofa-build.test.ts`)

- `headrestBackTarget` returns the sofa group's bbox when a headrest sits within tolerance above a
  sofa's top edge with horizontal overlap; returns the **full group width** for a multi-module sofa
  (e.g. `2A(LHF)+2A(RHF)`).
- Returns `null` when the headrest is far from any sofa, horizontally non-overlapping, or below/beside
  (not above) the sofa.
- Returns the nearer group when two sofas qualify.

POS render/drop/closure wiring is verified live in the dev harness (`/dev/headrest`, removed before
merge) + manual QA, since `CustomBuilder` has no unit-test harness.

Gates: `pnpm typecheck`, `pnpm test`, `pnpm lint`, POS `build`.

## Deploy notes
- Code-only, no migration. Deploy POS (+ shared). Remind Loo to hard-refresh the PWA.
- Remove the temporary `/dev/headrest` harness route + `HeadrestHarness.tsx` before merge.
