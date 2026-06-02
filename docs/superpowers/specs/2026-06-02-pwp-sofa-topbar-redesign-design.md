# PWP Sofa — move "Insert PWP Code" to the shared top bar (Design Spec)

> 2026-06-02. Chairman-driven. **SPEC ONLY — implement in a fresh session.**
> POS-SELLING only; cost/procurement untouched. Default data → ZERO price change.
> This is a follow-up to the shipped PWP Code Voucher system (Phase 1 mattress↔
> bedframe + Phase 2 sofa-by-combo + Auto Fill). It RELOCATES the sofa redeem UI
> and does NOT change any pricing math, schema, or server logic.

---

## 0. Where we are (shipped + deployed on prod, 2026-06-02)

| Piece | Status | Where |
|---|---|---|
| PWP voucher system (codes RESERVED/USED/AVAILABLE; reserve/free/validate/consume; anti-tamper) | ✅ shipped (PR #422/#424/#429) | `apps/api/src/routes/pwp-codes.ts`, `pwp-rules.ts`, `mfg-sales-orders.ts`; migrations 0130–0132 |
| Sofa-by-combo PWP (combo PWP price column, rules combo mode, recompute sofa branch) | ✅ shipped (PR #432) | `sofa_combo_pricing.pwp_prices_by_height`; `recomputeFromSnapshot(...pwpSofaComboIds)`; `SofaComboTab` + `PwpRulesTab` |
| Bed frame + mattress redeem UI (shared `pwpRailSection`: Insert PWP Code + **Auto Fill** button, FIFO same-cart codes) | ✅ shipped (PR #433/#434/#436) | `apps/pos/src/pages/Configurator.tsx` (`pwpRailSection`, `sameCartCode`, `applyInsertedCode`) |
| **Sofa redeem UI** (cross-order Insert PWP Code + same-cart toggle) | ✅ shipped but **WRONG PLACEMENT** → this spec | `apps/pos/src/pages/CustomBuilder.tsx` (footer price bar) |

**The problem (Chairman 2026-06-02, screenshots):** the sofa "Insert PWP Code"
field lives in **CustomBuilder's bottom price footer** — visible only in
**Customize** mode. The sofa configurator has TWO modes with different layouts:

- **Quick Pick** mode → CTA (Add to Cart) is in the **top bar** (`sofaTopbarSlot`); CustomBuilder is NOT rendered, so there's NO PWP field at all.
- **Customize** mode → CTA + the PWP field are in **CustomBuilder's footer**.

Chairman wants the PWP code field in the **shared bar that shows in BOTH modes**
— the "Quick Pick / Customize" tab bar (`sofaCenterSlot`) — and the
CustomBuilder-footer field **deleted**.

---

## 1. Goal (白话)

把沙发的「Insert PWP Code」券栏，从 **Customize 模式底部的 footer**，移到**两个模式都看得到的顶部 bar**（就是 Quick Pick / Customize 那条 tab bar）。Customize footer 里那个删掉。这样不管 Quick Pick 还是 Customize，都能在同一个地方输入/Auto Fill 换购券。

**只是搬位置 + 让两个模式都能用** —— 价格引擎、schema、server 全部不动。

---

## 2. The core change: lift the sofa PWP state to the parent

Today the sofa PWP state (`pwpCode`, `pwpComboIds`, `pwpInput`, `sameCartSofa`,
`effectivePricing`, the apply logic) lives **inside CustomBuilder**. To render
the field in `sofaCenterSlot` (owned by `Configurator`) AND make it affect BOTH
modes' pricing, the state must move **up to Configurator**.

**This is feasible because `sofaCells` is already lifted to Configurator**
(`apps/pos/src/pages/Configurator.tsx` ~L301 `const [sofaCells, setSofaCells] = useState<Cell[]>([])`, passed to CustomBuilder as `cells`/`setCells`). The parent already holds the build, so it can compute the matched combos + the PWP-effective pricing.

### 2a. New state in Configurator (mirror what CustomBuilder has today)
```ts
const [sofaPwpInput, setSofaPwpInput] = useState('');
const [sofaPwpCode, setSofaPwpCode] = useState<string | null>(null);
const [sofaPwpComboIds, setSofaPwpComboIds] = useState<string[]>([]);
const [sofaPwpErr, setSofaPwpErr] = useState<string | null>(null);
const [sofaPwpChecking, setSofaPwpChecking] = useState(false);
```
- `useMyReservedPwpCodes`, `validatePwpCode` are ALREADY imported in Configurator.
- The build's module codes: in **Customize** mode = `sofaCells.map(c => c.moduleId)`; in **Quick Pick** mode = the selected pick's modules (`effectiveQPModules`, already computed ~L1023) OR the bundle's modules (`pickedSofaRow.bundle` → `BUNDLES`). Compute `sofaBuiltModules` per mode.
- Reset `sofaPwp*` whenever the build/mode/pick changes (mirror CustomBuilder's `builtSig` effect).

### 2b. Matched combos + apply (move from CustomBuilder verbatim)
```ts
const sofaMatchedComboIds = useMemo(
  () => (sofaPricing.combos ?? []).filter(c => matchComboSubset(sofaBuiltModules, c.modules) != null).map(c => c.id),
  [sofaPricing.combos, sofaBuiltModules],
);
// same-cart: a RESERVED SOFA code in this cart eligible for a matched combo,
// not already applied to another line (FIFO by cart line order, like sameCartCode).
const sameCartSofa = useMemo(() => { /* see CustomBuilder current impl + FIFO */ }, [...]);
const applySofaPwp = async (codeArg?: string) => { /* validate each matched combo until valid; set sofaPwpCode + sofaPwpComboIds */ };
```

### 2c. PWP-effective pricing → feed BOTH modes
```ts
const effectiveSofaPricing = useMemo<SofaProductPricing>(() => {
  if (sofaPwpComboIds.length === 0) return sofaPricing;
  const set = new Set(sofaPwpComboIds);
  return { ...sofaPricing, combos: (sofaPricing.combos ?? []).map(c =>
    set.has(c.id) ? { ...c, pricesByHeight: comboChargedPrices(c.pwpPricesByHeight, c.pricesByHeight) } : c) };
}, [sofaPricing, sofaPwpComboIds]);
```
- Pass `effectiveSofaPricing` to **CustomBuilder** as `pricing=` (replace `sofaPricing`) → Customize live total reflects PWP.
- Use `effectiveSofaPricing` in **`priceForLayout`** (~L696) → `qpPickPrice` (~L1023) reflects PWP for Quick Pick.
- The top-bar LIVE TOTAL (`sofaTotal`) must derive from the effective price too.

### 2d. Both add-paths stamp pwp/pwpCode on the snapshot
The `SofaConfigSnapshot` already has `pwp?`/`pwpCode?` (added in Phase 2). Set them on the line whose build matches the applied reward combo:
- **`handleAddSofa`** (bundle quick pick, ~L1042): bundle modules → `matchComboSubset` vs the applied reward combo → `...(matched && sofaPwpCode ? { pwp: true, pwpCode: sofaPwpCode } : {})`. `total` already PWP (priceForLayout/effective).
- **`handleAddQuickPick`** (saved QP, ~L1075): `cells`/`effectiveQPModules` → same match → stamp. `total = qpPickPrice + sofaFabricDelta` (already PWP).
- **CustomBuilder `handleAdd`** (~current): it already stamps per-group when the group matches `pwpComboIds`. Now `pwpCode`/`pwpComboIds` come from **props** (passed down from Configurator) instead of local state.

### 2e. Render the field in `sofaCenterSlot` (both modes)
`sofaCenterSlot` (`Configurator.tsx` ~L1247) holds the back arrow + depth tabs + Quick/Customize tabs and renders for BOTH modes. Add a compact PWP control there (or just below it in a thin sub-bar): an `Insert PWP Code` input + **Auto Fill** button (when `sameCartSofa`) + Apply, mirroring `pwpRailSection`. When `sofaPwpCode` is applied, show "PWP code … applied · remove". Keep it visually small (top-bar real estate is tight) — a single-line control.

### 2f. Delete the CustomBuilder footer field + its now-dead state
In `apps/pos/src/pages/CustomBuilder.tsx`:
- DELETE the footer PWP block (the `{cells.length > 0 && allClosed && ( pwpCode ? … : sameCartSofa ? <toggle> : <insert field> )}` JSX in the `<footer className={styles.priceBar}>`).
- DELETE the local PWP state (`pwpInput`, `pwpCode`, `pwpComboIds`, `pwpErr`, `pwpChecking`, `useSameCartPwp`, `sameCartSofa`, `matchedComboIds`, `applyPwpCode`, `onToggleSameCartPwp`, `builtModuleCodes`, the build-change reset effect, the `useMyReservedPwpCodes`/`validatePwpCode` imports if now unused).
- ADD props `pwpCode?: string | null` + `pwpComboIds?: string[]` to `CustomBuilderProps`; use them in `handleAdd`'s per-group stamp + keep `effectivePricing` OUT (pricing now arrives already-effective from the parent → `priceResult = computeSofaPrice(cells, depth, pricing)` with `pricing` = effective).

---

## 3. File map (verified anchors, line numbers approximate — they drift)

- `apps/pos/src/pages/Configurator.tsx`
  - `~L301` `sofaCells`/`setSofaCells` (already lifted — the enabler)
  - `~L629` `const sofaPricing = useMemo<SofaProductPricing>(...)` (combos fed here)
  - `~L696` `priceForLayout` (Quick Pick price) → use `effectiveSofaPricing`
  - `~L1023` `qpPickPrice` (Quick Pick total)
  - `~L1042` `handleAddSofa` (bundle QP add) — stamp pwp/pwpCode
  - `~L1075` `handleAddQuickPick` (saved QP add) — stamp pwp/pwpCode
  - `~L1196` `sofaTopbarSlot` (Quick-Pick-only top bar: chip + LIVE TOTAL + Add to Cart)
  - `~L1247` `sofaCenterSlot` (BOTH modes: back + depth + mode tabs) → **add the PWP control here / a sub-bar**
  - `~L1296` `<Topbar centerSlot={sofaCenterSlot} rightSlot={...} />`
  - `~L1400` `<CustomBuilder pricing={sofaPricing} cells={sofaCells} ... />` → pass `effectiveSofaPricing` + `pwpCode`/`pwpComboIds`
  - existing `pwpRailSection`/`sameCartCode`/`applyInsertedCode` (~L444–476, ~L852) = the bed frame/mattress reference impl to mirror for sofa
- `apps/pos/src/pages/CustomBuilder.tsx`
  - `CustomBuilderProps` (~L436) + the component (~L486)
  - PWP state block + `applyPwpCode`/`onToggleSameCartPwp`/`effectivePricing` (added in Phase 2 / same-cart) → DELETE / convert to props
  - `priceResult` (~L817) → `computeSofaPrice(cells, depth, pricing)` (pricing already effective)
  - `handleAdd` snapshot (~L1044) per-group pwp/pwpCode stamp (keep, source from props)
  - footer `<footer className={styles.priceBar}>` PWP block → DELETE
- NO server / schema / shared changes. NO migration.

---

## 4. Edge cases
1. **Quick Pick + bundle (`handleAddSofa`)**: a bundle has no `cells`; derive its modules from `BUNDLES[bundleId]` (or `pickedSofaRow.bundle`) to match a combo. If a bundle build matches no reward combo, the code can't apply → keep full price (Apply error in the top bar).
2. **Mode switch (quick⇄custom)**: the build changes → reset `sofaPwpCode`/`sofaPwpComboIds` (don't carry a grant across a build the new mode doesn't match).
3. **Sofa is its own cart** (sofa-exclusivity) → same-cart sofa-reward only inside an all-sofa cart; the FIFO `sameCartSofa` mirrors `sameCartCode`.
4. **Edit a sofa cart line**: hydrate `sofaPwpCode` from the line's `config.pwpCode` (cross-order path), like the bed frame hydrate.
5. **Multi-group Custom build**: only the group matching the reward combo gets the pwp/pwpCode flag (CustomBuilder `handleAdd` already does this per-group).
6. **Gated**: with no code applied, `effectiveSofaPricing === sofaPricing` → ZERO change to the normal sofa flow. Verify this first.

---

## 5. Acceptance criteria
1. The "Insert PWP Code" + Auto Fill control shows in the sofa top bar (the Quick Pick / Customize bar) in BOTH modes; the CustomBuilder footer field is gone.
2. Quick Pick mode: select a combo-matching layout, Apply/Auto Fill a valid sofa code → the top-bar LIVE TOTAL drops to the combo PWP price; Add to Cart → the line carries pwp/pwpCode.
3. Customize mode: same, with the build's matched reward combo.
4. No code applied → sofa prices exactly as today (à-la-carte / normal combo). typecheck 6/6; shared/api tests unchanged; pos build green.
5. Server unchanged — a submitted sofa line with `variants.pwpCode` is validated + the combo PWP price locked at Confirm (already shipped); tamper → 400.

---

## 6. Implementation order
1. Lift state + `applySofaPwp` + `sameCartSofa` (FIFO) + `effectiveSofaPricing` into Configurator.
2. Feed `effectiveSofaPricing` to `priceForLayout` + CustomBuilder `pricing` + the top-bar total. Verify GATED no-op (no code → no change).
3. Stamp pwp/pwpCode in `handleAddSofa` + `handleAddQuickPick` (+ CustomBuilder via props).
4. Render the PWP control in `sofaCenterSlot` (or a thin sub-bar under it).
5. Delete CustomBuilder's footer PWP block + dead state; convert to props.
6. typecheck + build + visual e2e (both modes, combo PWP price set, a reserved/AVAILABLE sofa code) → PR → Chairman GO → merge → deploy.

---

## 7. Notes for the implementer
- The bed frame/mattress `pwpRailSection` in `Configurator.tsx` is the canonical UI reference (Auto Fill, FIFO same-cart, applied-chip, error text) — mirror it for the sofa control, condensed to one line for the top bar.
- Keep the change SURGICAL: this is a relocation + state lift, not a pricing change. Every sofa-price diff must be traceable to "PWP applied" — if a no-code sofa changes price by a cent, something's wrong.
- The memory has many sofa-pricing regression warnings (`sofa-combo-tier-p1-fix`, `sofa-custom-build-combo-fix`, `sofa-seat-size-drives-width-not-depth`, etc.) — read the sofa entries in MEMORY.md before touching `computeSofaPrice`/`sofaPricing`.
- PWA hard-reload after deploy (service worker caches the old bundle).
