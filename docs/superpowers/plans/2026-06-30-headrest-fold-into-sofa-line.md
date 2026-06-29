# Headrest Folds Into the Sofa Line Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** An attached headrest is no longer a separate cart/SO line — it folds into its sofa's line (one cart item, one folded SO line), like a normal compartment.

**Architecture:** Fold entirely in POS `handleAdd`: when a group is an attached headrest (single HEADREST cell with `headrestBackTarget != null`), skip emitting it as its own cart item and instead merge its cell + group price into the sofa group's snapshot. One cart item → one `buildKey` server-side → folds in cart + SO/print. **No server change** — verified the recompute (`computeSofaSellingSen → computeSofaPrice(cells).total`, `mfg-pricing-recompute.ts:550` / `sofa-build.ts:541`) sums all groups, so a combined sofa+headrest build prices to (sofa + headrest) → no drift (red line #4 safe).

**Tech Stack:** React 19 + TypeScript, POS app only.

## Global Constraints
- POS-only: `apps/pos/src/pages/CustomBuilder.tsx`. No `groupSofas`, server, pricing-engine, or DB change.
- Red line #4 intact: server recompute already totals all groups; combined build = same total, no drift.
- The headrest is no longer a separate SKU line (deliberate — Loo's choice 2026-06-30); its price still counts into the sofa line total.

---

### Task 1: Fold attached headrests into the sofa cart line

**Files:**
- Modify: `apps/pos/src/pages/CustomBuilder.tsx` — add a `headrestFold` memo after `priceResult` (≈ line 698); update `canAdd` (≈ 940) and `handleAdd` loop (≈ 966-1021).

**Interfaces:**
- Consumes: `priceResult.groups` (each `{ cellIds: string[]; finalPrice: number }`), `headrestBackTarget`, `cellsBbox` (already imported), `cells`, `depth`.
- Produces: `headrestFold = { skip: Set<number>; foldInto: Map<number, number[]> }` and `effectiveBuildCount`.

- [ ] **Step 1: Add the `headrestFold` memo** (right after the `priceResult` useMemo, ≈ line 698)

```ts
  // Fold plan: an attached-headrest group (single HEADREST cell sitting on a
  // sofa's back) is NOT its own cart line — it merges into that sofa's line.
  // `skip` = group indices to drop; `foldInto` = sofaGroupIdx → [headrestGroupIdx].
  const headrestFold = useMemo(() => {
    const skip = new Set<number>();
    const foldInto = new Map<number, number[]>();
    const byId = new Map<string, Cell>();
    for (const c of cells) { if (c.id) byId.set(c.id, c); }
    const cellsOf = (gi: number): Cell[] =>
      (priceResult.groups[gi]?.cellIds ?? []).map((id) => byId.get(id)).filter((c): c is Cell => c != null);
    const bboxes = priceResult.groups.map((_, gi) => cellsBbox(cellsOf(gi), depth));
    priceResult.groups.forEach((_, gi) => {
      const gc = cellsOf(gi);
      if (gc.length !== 1 || gc[0]!.moduleId !== 'HEADREST') return;
      const back = headrestBackTarget(gc[0]!, cells, depth);
      if (!back) return;
      const si = bboxes.findIndex((bb, bi) =>
        bi !== gi && bb != null
        && Math.abs(bb.x - back.x) < 1 && Math.abs(bb.y - back.y) < 1 && Math.abs(bb.w - back.w) < 1);
      if (si < 0) return;
      skip.add(gi);
      foldInto.set(si, [...(foldInto.get(si) ?? []), gi]);
    });
    return { skip, foldInto };
  }, [priceResult.groups, cells, depth]);
  const effectiveBuildCount = priceResult.groups.length - headrestFold.skip.size;
```

- [ ] **Step 2: Gate swap / add-to-order on the folded build count**

Change `canAdd` (≈ line 940):

```ts
  const canAdd = cells.length > 0 && allClosed
    && (!onSwapConfirm || priceResult.groups.length === 1)
    && (!onAddToOrderConfirm || priceResult.groups.length === 1);
```

to:

```ts
  const canAdd = cells.length > 0 && allClosed
    && (!onSwapConfirm || effectiveBuildCount === 1)
    && (!onAddToOrderConfirm || effectiveBuildCount === 1);
```

- [ ] **Step 3: Skip folded groups + merge their cells/price in `handleAdd`**

In the `handleAdd` loop (≈ line 966), change the top of the loop body:

```ts
    for (let i = 0; i < priceResult.groups.length; i++) {
      const g = priceResult.groups[i]!;
      const groupCells = g.cellIds
        .map((id) => cellById.get(id))
        .filter((c): c is Cell => c != null)
        .map((c) => ({ ...c }));
      if (groupCells.length === 0) continue;
```

to (skip folded headrest groups, fold their cells in):

```ts
    for (let i = 0; i < priceResult.groups.length; i++) {
      if (headrestFold.skip.has(i)) continue; // folded into its sofa's line below
      const g = priceResult.groups[i]!;
      const groupCells = g.cellIds
        .map((id) => cellById.get(id))
        .filter((c): c is Cell => c != null)
        .map((c) => ({ ...c }));
      if (groupCells.length === 0) continue;
      // Fold any headrest(s) attached to this sofa into the same line.
      let foldedPrice = g.finalPrice;
      for (const hi of headrestFold.foldInto.get(i) ?? []) {
        const hg = priceResult.groups[hi]!;
        for (const id of hg.cellIds) {
          const hc = cellById.get(id);
          if (hc) groupCells.push({ ...hc });
        }
        foldedPrice += hg.finalPrice;
      }
```

Then change the snapshot `total` (≈ line 1010) from `g.finalPrice` to `foldedPrice`:

```ts
        total: foldedPrice + sofaFabricDelta + legSurchargeRm + (!usedEditKey ? extraAmountRm : 0),
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/pages/CustomBuilder.tsx
git commit -m "feat(pos): fold an attached headrest into its sofa's cart/SO line"
```

---

### Task 2: Verify (harness) + gates

- [ ] **Step 1: Live QA** — dev harness (sofa + attached headrest): the cart shows **ONE** line ("Annsa · 2S …"), not a separate "Annsa · HEADREST" line; the line total includes the headrest price (RM0 until a per-Model price is set). Detaching the headrest (drag away) makes it its own line again.
- [ ] **Step 2: Gates** — `pnpm typecheck`, `pnpm test`, lint clean on the changed file.
- [ ] **Step 3: Remove harness** — delete `apps/pos/src/pages/dev/HeadrestHarness.tsx` + its route in `router.tsx`.
- [ ] **Step 4: Commit** the harness removal.

---

## Notes
- Internally the SO still has a per-module `ANNSA-HEADREST` row (like every compartment), sharing the sofa build's `buildKey`, so the customer print + cart fold it into one line. This is exactly how other compartments behave.
- Deploy POS; hard-refresh PWA.
