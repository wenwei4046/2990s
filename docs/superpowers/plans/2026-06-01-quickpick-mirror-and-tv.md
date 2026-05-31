# Quick Pick Mirror + TV Marker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let POS sales mirror an asymmetric saved Quick Pick left↔right (per order), and show a TV reference marker on the Quick Pick preview canvas like the Customize page.

**Architecture:** Two pure helpers (`mirrorCode`, `mirrorModules`, `canMirror`) + a price-invariant à-la-carte mirror fallback in `packages/shared`. POS `Configurator.tsx` gains a `qpMirror` per-order toggle wired through price/preview/add-to-cart, a flip control on the selected Quick Pick card, and a TV marker ported from CustomBuilder onto the hero (hero-only — the shared `SofaCellsPreview` is untouched so rail thumbnails stay TV-free).

**Tech Stack:** TypeScript, React 19, Vite, Vitest (shared unit tests), CSS Modules, Lucide React icons.

**Spec:** `docs/superpowers/specs/2026-06-01-quickpick-mirror-and-tv.md`

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `packages/shared/src/sofa-build.ts` | pure sofa math/helpers | add `mirrorCode`/`mirrorModules`/`canMirror`; add mirror fallback in `groupPrice` à-la-carte loop |
| `packages/shared/src/__tests__/sofa-build.test.ts` | shared unit tests | add mirror + price-invariance tests |
| `apps/pos/src/pages/Configurator.tsx` | Quick Pick + Customize host | `qpMirror` state, mirrored modules → price/preview/cart, flip control, TV marker |
| `apps/pos/src/pages/Configurator.module.css` | Configurator styles | `.qpMirrorBtn` + ported `.tv`/`.tvScreen`/`.tvLabel`/`.tvBeam` |

---

## Setup (execution-time, before Task 1)

⚠️ **Concurrent-session git hazard** (see memory `sofa-custombuild-seamless-overlay`): Loo runs several Claude sessions on this repo; `git checkout` in the shared working dir gets raced. The current branch is `fix/pos-maintain-admin-only` — unrelated to this work.

- [ ] **Create an isolated worktree off `origin/main`** via the `superpowers:using-git-worktrees` skill, branch `feat/quickpick-mirror-tv`. Do all work + commits there, then PR + squash-merge. This sidesteps the race and keeps this feature off the maintain-admin branch.
- [ ] **Commit the already-written spec** as the first commit on the new branch:

```bash
git add docs/superpowers/specs/2026-06-01-quickpick-mirror-and-tv.md docs/superpowers/plans/2026-06-01-quickpick-mirror-and-tv.md
git commit -m "$(cat <<'EOF'
docs(pos): spec + plan for Quick Pick mirror toggle and TV marker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: Pure mirror helpers in shared

**Files:**
- Modify: `packages/shared/src/sofa-build.ts` (add after `classifySofaCompartment`, ~line 227)
- Test: `packages/shared/src/__tests__/sofa-build.test.ts`

- [ ] **Step 1: Add the three helpers to imports in the test file**

In `packages/shared/src/__tests__/sofa-build.test.ts`, add `mirrorCode, mirrorModules, canMirror,` to the import block from `'../sofa-build'` (after `fabricColourSuffix,` on line 19):

```ts
  fabricColourSuffix,
  mirrorCode,
  mirrorModules,
  canMirror,
  SNAP_CM,
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/shared/src/__tests__/sofa-build.test.ts`:

```ts
describe('mirror helpers (Quick Pick L↔R flip)', () => {
  it('mirrorCode swaps LHF↔RHF for dash + parens forms, leaves no-hand codes', () => {
    expect(mirrorCode('2A-LHF')).toBe('2A-RHF');
    expect(mirrorCode('L-RHF')).toBe('L-LHF');
    expect(mirrorCode('1A(P)(LHF)')).toBe('1A(P)(RHF)');
    expect(mirrorCode('1NA')).toBe('1NA');
    expect(mirrorCode('WC-45')).toBe('WC-45');
    expect(mirrorCode('CNR')).toBe('CNR');
  });

  it('mirrorModules reverses slot order and swaps each hand', () => {
    expect(mirrorModules([['2A-LHF'], ['L-RHF']])).toEqual([['L-LHF'], ['2A-RHF']]);
    expect(mirrorModules([['2A-LHF', '2A-RHF'], ['L-LHF', 'L-RHF']]))
      .toEqual([['L-RHF', 'L-LHF'], ['2A-RHF', '2A-LHF']]);
  });

  it('canMirror is false for symmetric layouts, true for asymmetric', () => {
    expect(canMirror([['2A-LHF'], ['2A-RHF']])).toBe(false);
    expect(canMirror([['1A-LHF'], ['1A-RHF']])).toBe(false);
    expect(canMirror([['2A-LHF'], ['L-RHF']])).toBe(true);
    expect(canMirror([['1A-LHF'], ['2A-RHF']])).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @2990s/shared test`
Expected: FAIL — `mirrorCode`/`mirrorModules`/`canMirror` are not exported (import error / undefined).

- [ ] **Step 4: Implement the helpers**

In `packages/shared/src/sofa-build.ts`, immediately after the `classifySofaCompartment` function (the `return 'Other';\n};` block ending ~line 227), insert:

```ts
/* ─── Mirror helpers (Quick Pick L↔R flip, 2026-06-01) ───────────────────
 * Flip a saved Quick Pick layout left↔right: reverse the slot order and swap
 * each handed code's LHF↔RHF. Codes with no orientation (1NA, 2NA, WC-45, CNR,
 * STOOL, power variants without a hand) pass through unchanged. Works on BOTH
 * the dash form (`2A-LHF`) and the parens form (`1A(P)(LHF)`) because LHF/RHF
 * only ever appear as the orientation token and never both in one code. */
export const mirrorCode = (code: string): string => {
  if (code.includes('LHF')) return code.replace('LHF', 'RHF');
  if (code.includes('RHF')) return code.replace('RHF', 'LHF');
  return code;
};

/** Mirror a Quick Pick's OR-set slot layout left↔right. Pure; identical result
 *  on POS + server. */
export const mirrorModules = (modules: string[][]): string[][] =>
  modules.slice().reverse().map((slot) => slot.map(mirrorCode));

/** True when mirroring actually changes the layout. Symmetric palindromes
 *  (1-seater, 2-seater) mirror to themselves → false, so the POS hides the flip
 *  control for them. Compares the representative-code sequence (first code per
 *  slot) — that's what the preview + cart build consume. */
export const canMirror = (modules: string[][]): boolean => {
  const rep = (m: string[][]): string => m.map((s) => s[0] ?? '').join('+');
  return rep(modules) !== rep(mirrorModules(modules));
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @2990s/shared test`
Expected: PASS (the new `mirror helpers` describe block green; all pre-existing tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sofa-build.ts packages/shared/src/__tests__/sofa-build.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): mirrorCode/mirrorModules/canMirror for Quick Pick L<->R flip

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Price-invariant mirror fallback

**Files:**
- Modify: `packages/shared/src/sofa-build.ts` (`groupPrice`, à-la-carte loop ~line 767-771)
- Test: `packages/shared/src/__tests__/sofa-build.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/__tests__/sofa-build.test.ts`:

```ts
describe('mirror price-invariance (à-la-carte fallback)', () => {
  it('prices a mirrored layout identically when only one hand is priced', () => {
    // Only the LHF hands carry a price; the RHF rows are absent.
    const oneHand = pricing({
      compartments: [
        { compartmentId: '2A-LHF', active: true, price: 2400 },
        { compartmentId: 'L-LHF',  active: true, price: 1900 },
      ],
      bundles: [],
      combos: [],
    });
    // 2A(LHF) + L(RHF) laid out left→right.
    const cells: Cell[] = [
      { id: 'a', moduleId: '2A-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: 'L-RHF',  x: 188, y: 0, rot: 0 },
    ];
    // Its mirror: L(LHF) + 2A(RHF).
    const mirrored: Cell[] = [
      { id: 'a', moduleId: 'L-LHF',  x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: '2A-RHF', x: 188, y: 0, rot: 0 },
    ];
    const t1 = computeSofaPrice(cells, '24', oneHand).total;
    const t2 = computeSofaPrice(mirrored, '24', oneHand).total;
    expect(t1).toBeGreaterThan(0);
    expect(t2).toBe(t1); // 2400 + 1900 both ways, thanks to the mirror fallback
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @2990s/shared test`
Expected: FAIL — without the fallback, `t1 = 2400` (L-RHF unpriced) but `t2 = 1900` (2A-RHF unpriced), so `expect(t2).toBe(t1)` fails (1900 ≠ 2400).

- [ ] **Step 3: Add the mirror fallback to the à-la-carte loop**

In `packages/shared/src/sofa-build.ts`, replace the à-la-carte loop in `groupPrice`:

```ts
  let aLaCarteTotal = 0;
  for (const cell of group) {
    const row = compRow(pricing, cell.moduleId);
    aLaCarteTotal += row?.price ?? 0;
  }
```

with:

```ts
  let aLaCarteTotal = 0;
  for (const cell of group) {
    // Mirror fallback (2026-06-01): a flipped Quick Pick swaps LHF↔RHF. If a
    // Model priced only one hand, resolve the other hand to the SAME row so a
    // mirrored sofa never prices to RM 0 or differs from its un-flipped twin.
    // Additive only — never lowers a priced module. POS + server share this
    // function, so the drift-reject on POST /orders can't fire from mirroring.
    const row = compRow(pricing, cell.moduleId)
      ?? compRow(pricing, mirrorCode(cell.moduleId));
    aLaCarteTotal += row?.price ?? 0;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @2990s/shared test`
Expected: PASS (mirror price-invariance green; all pre-existing pricing tests still green — the fallback only triggers on an exact-code miss).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sofa-build.ts packages/shared/src/__tests__/sofa-build.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): à-la-carte mirror fallback so flipped sofas price identically

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: POS — mirror state + thread mirrored modules into price/cart

**Files:**
- Modify: `apps/pos/src/pages/Configurator.tsx`

This task is parent-only wiring. `qpMirror` defaults `false`, so after this task behaviour is unchanged (dormant) until Task 4 adds the toggle. Verified by typecheck.

- [ ] **Step 1: Import the helpers**

In `apps/pos/src/pages/Configurator.tsx`, line 5, add `mirrorModules, canMirror` to the `@2990s/shared` import:

```ts
import { fmtRM, BUNDLES, findModule, moduleFootprint, buildComboLabel, computeSofaPrice, mirrorModules, canMirror, type BundleDef, type Cell, type Depth, type SofaProductPricing } from '@2990s/shared';
```

- [ ] **Step 2: Add `qpMirror` state**

After the `activeDepth` state (line 217 `const [activeDepth, setActiveDepth] = useState<Depth>('24');`), add:

```ts
  // Quick Pick L↔R mirror (2026-06-01). Per-order toggle on the selected saved
  // Quick Pick; reset whenever a different pick is selected. Only meaningful for
  // asymmetric layouts (canMirror) — the card hides the control otherwise.
  const [qpMirror, setQpMirror] = useState(false);
```

- [ ] **Step 3: Compute effective modules + display label, feed the price**

Replace (lines 656-657):

```ts
  // Quick Pick selection price: computed from its layout via the engine.
  const qpPickPrice = pickedQP ? (priceForLayout(pickedQP.modules) ?? 0) : 0;
```

with:

```ts
  // Quick Pick selection price: computed from its layout via the engine.
  // effectiveQPModules applies the L↔R mirror toggle (2026-06-01) so the price,
  // hero preview, and cart line all reflect the flipped orientation.
  const effectiveQPModules = pickedQP
    ? (qpMirror ? mirrorModules(pickedQP.modules) : pickedQP.modules)
    : null;
  // A mirrored pick can't reuse its stored label (it still names the un-flipped
  // hands), so rebuild the label from the flipped modules.
  const qpDisplayLabel = pickedQP
    ? (qpMirror ? buildComboLabel(effectiveQPModules!) : (pickedQP.label || buildComboLabel(pickedQP.modules)))
    : '';
  const qpPickPrice = effectiveQPModules ? (priceForLayout(effectiveQPModules) ?? 0) : 0;
```

- [ ] **Step 4: Use the flipped modules + label in add-to-cart**

Replace the first four lines of `handleAddQuickPick` (lines 703-706):

```ts
  const handleAddQuickPick = () => {
    if (pickedQP == null || fabricSel == null) return;
    const cells = cellsFromComboModules(pickedQP.modules, activeDepth);
    const label = pickedQP.label || buildComboLabel(pickedQP.modules);
```

with:

```ts
  const handleAddQuickPick = () => {
    if (pickedQP == null || fabricSel == null || effectiveQPModules == null) return;
    const cells = cellsFromComboModules(effectiveQPModules, activeDepth);
    const label = qpDisplayLabel;
```

- [ ] **Step 5: Use the display label in the topbar chip**

Replace (lines 831-833):

```tsx
          {pickedQP
            ? `${pickedQP.label || buildComboLabel(pickedQP.modules)} · ${activeDepth}"`
            : pickedSofaRow
```

with:

```tsx
          {pickedQP
            ? `${qpDisplayLabel} · ${activeDepth}"`
            : pickedSofaRow
```

- [ ] **Step 6: Reset the flip when a new Quick Pick is selected**

In the `<SofaQuickPick ... onQuickPickSelect={...}>` handler, after `setPicked(null);` (line 997), add `setQpMirror(false);`:

```tsx
              setPickedQP(item);
              setPicked(null);
              setQpMirror(false);
            }}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck` (or repo-root `pnpm typecheck`)
Expected: PASS (no unused-var: `qpMirror` is read in `effectiveQPModules`, `setQpMirror` is used in `onQuickPickSelect`).

- [ ] **Step 8: Commit**

```bash
git add apps/pos/src/pages/Configurator.tsx
git commit -m "$(cat <<'EOF'
feat(pos): wire Quick Pick mirror state into price + add-to-cart (dormant)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: POS — flip control on the selected card + mirrored hero

**Files:**
- Modify: `apps/pos/src/pages/Configurator.tsx`
- Modify: `apps/pos/src/pages/Configurator.module.css`

- [ ] **Step 1: Import the icon**

Line 3, add `FlipHorizontal2` to the lucide-react import:

```ts
import { ArrowLeft, Hourglass, X, Plus, Minus, Sparkles, Package, Trash2, FlipHorizontal2 } from 'lucide-react';
```

- [ ] **Step 2: Add the two props to `SofaQuickPickProps`**

In the `SofaQuickPickProps` interface, after `onFlipChange: (flip: 'L' | 'R') => void;` (line 1473), add:

```ts
  /** L↔R mirror toggle for the selected saved Quick Pick (2026-06-01). */
  qpMirror?: boolean;
  onToggleQpMirror?: () => void;
```

- [ ] **Step 3: Pass the props at the call site**

In the `<SofaQuickPick ... />` JSX, after `onFlipChange={setQuickFlip}` (line 981), add:

```tsx
            qpMirror={qpMirror}
            onToggleQpMirror={() => setQpMirror((v) => !v)}
```

- [ ] **Step 4: Destructure the props in the component**

In the `SofaQuickPick = ({ ... }: SofaQuickPickProps) =>` signature (line 1610), add `qpMirror, onToggleQpMirror,` to the destructured params (e.g. right after `onFlipChange,`):

```tsx
const SofaQuickPick = ({ isLoading, rows, picked, onPick, quickFlip, onFlipChange, qpMirror, onToggleQpMirror, depth, fabricBlock, globalQuickPicks, personalQuickPicks, pickedQuickPickId, priceForLayout, canDeleteGlobal, onQuickPickSelect, onQuickPickEdit, onQuickPickDelete }: SofaQuickPickProps) => {
```

- [ ] **Step 5: Mirror the hero preview**

Replace the selected-Quick-Pick hero block (lines 1796-1804):

```tsx
          {pickedQPRow ? (
            // Quick Pick selected — show its layout cells in the hero.
            <div className={styles.qpHeroCells}>
              <SofaCellsPreview
                cells={cellsFromComboModules(pickedQPRow.modules, depth)}
                depth={depth}
                showDims
              />
            </div>
          ) : heroCells ? (
```

with:

```tsx
          {pickedQPRow ? (
            // Quick Pick selected — show its (optionally mirrored) layout cells.
            <div className={styles.qpHeroCells}>
              <SofaCellsPreview
                cells={cellsFromComboModules(qpMirror ? mirrorModules(pickedQPRow.modules) : pickedQPRow.modules, depth)}
                depth={depth}
                showDims
              />
            </div>
          ) : heroCells ? (
```

- [ ] **Step 6: Add the flip control to the selected card**

In the saved-Quick-Pick `items.map`, immediately before the `{isPicked && (` "Edit in Customize" block (line 1775), add:

```tsx
                    {isPicked && canMirror(item.modules) && (
                      <button
                        type="button"
                        className={styles.qpMirrorBtn}
                        aria-pressed={qpMirror}
                        onClick={(e) => { e.stopPropagation(); onToggleQpMirror?.(); }}
                        title="Mirror left ↔ right"
                        aria-label="Mirror left to right"
                      >
                        <FlipHorizontal2 size={14} strokeWidth={1.75} />
                      </button>
                    )}
```

- [ ] **Step 7: Add `.qpMirrorBtn` styling**

In `apps/pos/src/pages/Configurator.module.css`, after the `.qpFlipBtnActive` rule (line 853), add:

```css
/* Mirror (L↔R flip) control on the selected saved Quick Pick card. Top-left so
   it never collides with the top-right delete affordance. */
.qpMirrorBtn {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.9);
  color: var(--c-ink);
  cursor: pointer;
  z-index: 2;
}
.qpMirrorBtn[aria-pressed='true'] {
  background: var(--c-orange);
  border-color: var(--c-orange);
  color: #fff;
}
```

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/pos/src/pages/Configurator.tsx apps/pos/src/pages/Configurator.module.css
git commit -m "$(cat <<'EOF'
feat(pos): L<->R mirror control on selected Quick Pick card + mirrored hero

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: POS — TV reference marker on the Quick Pick hero

**Files:**
- Modify: `apps/pos/src/pages/Configurator.tsx` (inside `.qpHeroFrame`)
- Modify: `apps/pos/src/pages/Configurator.module.css`

- [ ] **Step 1: Add the TV markup to the hero frame**

In `apps/pos/src/pages/Configurator.tsx`, find the close of the hero conditional + `.qpHeroFrame` div (lines 1839-1842):

```tsx
          ) : (
            <div className={styles.qpHeroCells} />
          )}
        </div>
```

Replace with (insert the TV marker just before the `.qpHeroFrame` closing `</div>`):

```tsx
          ) : (
            <div className={styles.qpHeroCells} />
          )}
          {/* TV reference marker (2026-06-01) — bottom-center of the hero, sofa
              faces it. Hero-only: NOT rendered inside SofaCellsPreview, so the
              small rail card thumbnails stay TV-free. Pure decoration. */}
          <div className={styles.tvBeam} aria-hidden="true" />
          <div className={styles.tv} aria-hidden="true" title="TV — sofas face this way">
            <div className={styles.tvScreen} />
            <div className={styles.tvLabel}>TV</div>
          </div>
        </div>
```

- [ ] **Step 2: Add the TV styles**

In `apps/pos/src/pages/Configurator.module.css`, after the `.qpMirrorBtn` rules added in Task 4, add (ported from `CustomBuilder.module.css` lines 228-265, re-positioned as a fixed-size bottom-center reference inside the relative `.qpHeroFrame`):

```css
/* TV reference marker on the Quick Pick hero — ported from CustomBuilder's room
   TV. Here it's a fixed-size reference pinned bottom-center of .qpHeroFrame
   (which is position:relative), not a to-scale room object. */
.tv {
  position: absolute;
  left: 50%;
  bottom: 10px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 130px;
  height: 28px;
  background: #221f20;
  border-radius: 4px;
  box-shadow: 0 6px 14px rgba(34, 31, 32, 0.18);
  pointer-events: none;
  z-index: 3;
}
.tvScreen {
  position: absolute;
  inset: 4px;
  background: linear-gradient(180deg, #2a4356 0%, #1a2a35 100%);
  border-radius: 2px;
}
.tvLabel {
  position: relative;
  font-family: var(--font-button);
  font-size: 10px;
  font-weight: var(--w-semibold);
  letter-spacing: 0.18em;
  color: #fff9eb;
  text-transform: uppercase;
}
.tvBeam {
  position: absolute;
  left: 50%;
  bottom: 42px;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 10px solid var(--c-orange);
  pointer-events: none;
  z-index: 3;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/pages/Configurator.tsx apps/pos/src/pages/Configurator.module.css
git commit -m "$(cat <<'EOF'
feat(pos): TV reference marker on the Quick Pick hero canvas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full verification + visual e2e

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: PASS across packages.

- [ ] **Step 2: Run shared tests**

Run: `pnpm --filter @2990s/shared test`
Expected: PASS — new `mirror helpers` + `mirror price-invariance` blocks green; no regressions.

- [ ] **Step 3: Build POS**

Run: `pnpm --filter @2990s/pos build`
Expected: build succeeds.

- [ ] **Step 4: Visual e2e (Playwright / browse)**

Start the POS dev server, open a sofa Model's configurator → Quick Pick tab, and verify:
- Select an L-shape Quick Pick (e.g. "2A(LHF) + L(RHF)") → a flip control appears on the card → tap → the hero preview mirrors L↔R and the card label flips to "L(LHF) + 2A(RHF)"; the LIVE TOTAL is unchanged.
- Select a 1S / 2S pick → NO flip control.
- The TV bar + orange beam shows at the bottom-center of the hero, sofa above facing it; NO TV on the small rail card thumbnails.
- Add a mirrored pick to cart → the cart line reflects the flipped composition; no server drift-reject on submit (if testing against a live API).

⚠️ **PWA cache** (memory `sofa-custombuild-seamless-overlay`): the POS is a vite-pwa app; after deploy, hard-refresh / fully close+reopen (or unregister SW + clear caches) before verifying, or you'll see the stale bundle.

- [ ] **Step 5: Open PR** (after Loo's go to push)

```bash
git push -u origin feat/quickpick-mirror-tv
gh pr create --fill --base main
```

---

## Self-review (against spec)

- **§3.1 mirror transform** → Task 1 (`mirrorCode`/`mirrorModules`/`canMirror` + tests). ✔
- **§3.2 UI: state, reset-on-select, flip control on selected card (canMirror-gated), feeds hero/price/cart, label rebuild** → Tasks 3 (state/price/cart/label/reset) + 4 (control + hero). ✔
- **§3.3 price-invariance fallback (POS+server share computeSofaPrice)** → Task 2. ✔
- **§3.4 edge cases**: symmetric hidden (canMirror, Task 4 Step 6); no-hand passthrough (Task 1); editing-line out of scope (no change). ✔
- **§4 TV marker: sibling of preview in hero frame, hero-only, ported 4 classes, aria-hidden/pointer-events:none** → Task 5. ✔
- **§5 non-goals**: no DB/RLS/Backend changes; no saved mirrored card; no mini-room. Plan touches only shared + POS Configurator. ✔
- **§6 files** match the four files in this plan. ✔
- **§7 test plan** → Task 6. ✔

**Type consistency:** `qpMirror: boolean`, `onToggleQpMirror: () => void`, `effectiveQPModules: string[][] | null`, `qpDisplayLabel: string`, `mirrorModules(string[][]): string[][]`, `canMirror(string[][]): boolean`, `mirrorCode(string): string` — names + signatures consistent across Tasks 1, 3, 4. ✔
