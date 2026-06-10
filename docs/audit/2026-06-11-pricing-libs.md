# Deep bug audit — pricing libraries (2026-06-11)

Scope: `packages/shared/src/**` (mfg-pricing, sofa-build, sofa-combo-pricing,
sofa-quick-presets, fabric-tier-addon, pricing, order-rules, service-sku /
service-lines, so-sofa-split, one-shot-sku, variant-key / variant-summary,
inventory-adjustment, sofa-tier, format, phone, schemas) +
`apps/api/src/lib/mfg-pricing-recompute.ts`, `po-pricing.ts`, and the route-side
consumers of the shared combo/cost math (`mfg-sales-orders.ts`,
`mfg-purchase-orders.ts`, `consignment-orders.ts`) where needed to verify
end-to-end behaviour. payslips.ts / recost.ts skipped (already audited).
Excludes everything already logged in BUG-HISTORY (newest entry
BUG-2026-06-11-001) and the sibling 2026-06-11 money / misc-routes audits
(zero overlap — those cover SI/PI/credit ledger and route auth).

Note: the brief named `apps/api/src/lib/sofa-combo.ts` (`applySofaCombos`) —
that file does not exist in this repo (it is HOOKKA-side). The 2990s combo
engine is `packages/shared/src/sofa-combo-pricing.ts` + the three route-side
`recomputeTotals` / PO cost-spread consumers, audited below.

Every finding below was re-verified at file:line against the current tree.
Read-only audit — no app code modified.

---

## CRITICAL

### C1 — Combo subset sum skips the mirror price fallback → customer overcharged on mirrored builds
`packages/shared/src/sofa-build.ts`

- À-la-carte total uses the mirror fallback (line 1043-1045):
  `compRow(pricing, cell.moduleId) ?? compRow(pricing, mirrorCode(cell.moduleId))`
- The combo **subsetSum** does NOT (line 1117-1121):
  `subsetSum += compRow(pricing, cell.moduleId)?.price ?? 0;`

When a Quick Pick is flipped L↔R on a Model that priced only one hand
(the exact case the mirror fallback exists for), a matched-subset cell's price
is counted in `aLaCarteTotal` but **not** in `subsetSum`. Then
`comboExtrasALaCarte = max(0, aLaCarteTotal − subsetSum)` (line 1132) wrongly
includes that matched cell's price, and `basePrice = comboPrice +
comboExtrasALaCarte` (line 1154) **double-charges** — the customer pays the
combo total PLUS the mirrored module's à-la-carte price even though the combo
already covers it. POS and server recompute share this function, so the drift
gate cannot catch it (both sides agree on the wrong number).

Repro shape: combo `[['2A(LHF)','2A(RHF)'],['L(LHF)','L(RHF)']]`, pricing rows
only for `2A(LHF)` / `L(RHF)`, build = mirrored `[2A(RHF), L(LHF)]`.
subsetSum = 0, extras = full à-la-carte → final = combo + full à-la-carte.

Test gap: `__tests__/sofa-build.test.ts:878` ("mirror price-invariance") only
covers the à-la-carte fallback with **no combos**; no test exercises
combo-match × mirrored one-hand-priced pricing.

Fix shape: use the same `compRow(...) ?? compRow(mirrorCode(...))` lookup at
line 1120.

### C2 — Multi-module sofa build COST = ONE module's cost (margin overstated for every non-combo build)
Chain, verified end-to-end:

- `apps/api/src/lib/mfg-pricing-recompute.ts:249-267` — the cost compute's
  `product` is the **submitted itemCode's** row. For a POS configurator build
  the submitted itemCode is the FIRST module's SKU (so-sofa-split header
  comment, `mfg-sales-orders.ts` split path). `seatSize:
  variants.seatHeight ?? null` (line 265) — POS lines carry `depth`, not
  `seatHeight`, so seat-height cost rows never resolve and
  `computeMfgLineCost` falls to that single SKU's flat
  `base_price_sen` (`mfg-pricing.ts:463`).
- `apps/api/src/routes/mfg-sales-orders.ts:1875-1878` — `unitCost =
  recomputed.unit_cost_sen` (that single module's cost).
- `mfg-sales-orders.ts:1985-1994` — `buildUnitCostSen: unitCost` is fed to the
  split; `packages/shared/src/so-sofa-split.ts:118` distributes it across ALL
  N module lines.

Net: a 3-module build's **whole-build cost = one module's flat cost**, spread
over 3 lines. `line_margin_centi` is inflated by roughly (N−1)/N of the true
cost. The master combo cost spread in `recomputeTotals`
(`mfg-sales-orders.ts:3311-3368`) repairs ONLY sets that match a master combo
(uniform tier + height required); every custom / non-combo build keeps the
wrong cost. Should sum the per-module SKU costs
(`loadModelSofaModuleCosts` exists at `mfg-pricing-recompute.ts:534` but is
only used by `sofa-combos.ts`).

---

## IMPORTANT

### I1 — Sofa combo cost spread ignores line qty (cost understated ×qty)
`apps/api/src/routes/mfg-sales-orders.ts:3356-3366` and the byte-similar clone
`apps/api/src/routes/consignment-orders.ts:1152-1162`.

`spreadComboTotal(matched.map(line_cost_centi), comboTotal)` sets the matched
lines' **line_cost_centi sum = ONE set's combo price**, then
`unit_cost_centi = round(newLineCost / q)`. For module lines with qty ≥ 2
(Backend-keyed sets, or a qty-2 build), the set cost should be
`comboTotal × qty`; instead total cost = one set. Margin overstated by
(qty−1) sets. The PO-side spread (`mfg-purchase-orders.ts:1078-1080`) is
correct by construction — it spreads per-UNIT base costs and stores per-unit
results.

### I2 — Cross-model combo bleed: `pool = named.length > 0 ? named : combos`
- `mfg-sales-orders.ts:3347-3348` (master scope — ALL combos)
- `consignment-orders.ts:1143-1144` (same)
- `mfg-purchase-orders.ts:1061-1062` (supplier scope — that supplier's combos)

Module codes are a SHARED vocabulary (`2A(LHF)`, `L(RHF)` are the same strings
on every Model), and the subsequent `pickComboMatch` is called with
`baseModel: ''` (wildcard). So a Model with no combos of its own silently
takes ANOTHER Model's combo price as its set cost whenever the slot-set
matches — e.g. a budget model's 2+L set costed at a premium model's combo
price. The comment says the fallback is spelling tolerance ("Booqit" vs
"BOOQIT-…"), but the uppercase compare already handles casing; the fallback
fires precisely when the model genuinely has no combos. Selling side got this
exact guard (`mfg-pricing-recompute.ts:386-389` filters by base_model and the
comment warns about cross-model false matches); the cost side didn't.

### I3 — `computeVariantKey` misses the POS sofa vocabulary (`depth` / `sofaLegHeight`) → split stock buckets
`packages/shared/src/variant-key.ts:63-70` keys sofa on
`['fabricCode','seatHeight','legHeight']` and aliases ONLY the fabric axis
(line 101-111). But the system's own axis rule
(`so-variant-rule.ts:44-51`) declares `depth` ≡ `seatHeight` and
`sofaLegHeight` ≡ `legHeight` as the POS vocabulary for the SAME physical
attributes, and `canonicalizeVariants` is applied only in the Backend edit UI
(`apps/backend/src/pages/SalesOrderDetail.tsx:316`), never on the SO write
path. Consequences:

- A POS-created sofa line keys as `fabriccode=…` only (no seat / no leg);
  a Backend-keyed physically-identical line keys WITH them → two different
  buckets in `so-stock-allocation.ts:235/245` and `inventory_balances`.
- Two POS sofas differing only by depth (28 vs 30) collapse into ONE bucket.

Same family as the long-fixed fabric/colour alias bug (the comment block at
variant-key.ts:36-50 documents that fix) — seat/leg got left behind. Fix
shape: alias `seatHeight ← depth` and `legHeight ← sofaLegHeight` inside
`computeVariantKey` (or canonicalize variants at every write boundary).

### I4 — PO cost path drops POS-vocab seat/leg (same alias family as I3)
`apps/api/src/routes/mfg-purchase-orders.ts:1017-1020`:
`seatSize: variants.seatHeight ?? null`, `sofaLegHeight: variants.legHeight ??
null`. SO lines created from a POS build carry `depth` / `sofaLegHeight`, so
the supplier price_matrix seat lookup misses (falls to flat binding price) and
the sofa leg surcharge is never added to PO cost. Note the same file reads
heights via `sofaHeightKey` (= `depth ?? seatHeight`) for combos two screens
later — the vocab equivalence is honoured for combos but not for the matrix.

### I5 — Supplier matrix with only P1 priced + PRICE_2/no-tier line → PO cost silently 0
`packages/shared/src/mfg-pricing.ts:599`:
`basePriceSen: p2 ?? (p1 == null ? input.unitPriceCenti : null)`.
When the bedframe matrix carries ONLY `P1` and the line's fabric resolves
PRICE_2 (or no fabric), `basePriceSen = null`, `price1Sen` is ignored
(tier ≠ PRICE_1), and `computeMfgLineCost` lands on `null ?? costPriceSen ?? 0
= 0` (mfg-pricing.ts:471) — a zero-cost PO line with no warning. The
"both missing → flat fallback" rule should arguably extend to "wanted tier's
cell missing → flat fallback" (or at least fall back to the P1 cell / flat
price rather than 0). Test gap: `mfg-pricing.test.ts:575` covers the opposite
case (P2-only + PRICE_1 tier) but not this one. Same shape applies to a sofa
seat cell priced only at P1: covered there by the cost resolver's any-tier
fallback (mfg-pricing.ts:301-303), so it's bedframe-only.

### I6 — PWP "FREE" grant disables the price gate instead of enforcing 0
`apps/api/src/lib/mfg-pricing-recompute.ts:335-340 + 425-428`.
`pwpBaseSen = 0` (promo redeems FREE, migration 0145) →
`effectiveBaseSen = 0` → `hasAuthoritativeSelling = effectiveBaseSen > 0` is
FALSE → the line falls into the trust-the-operator branch:
`drift = false; unitToPersistSen = manualUnitSelling`. A granted-FREE reward
line therefore books at **whatever the client sent** — the one PWP case with
the strongest claim to an authoritative price (0) is the one case with no
gate. A tampered POS payload can charge the customer for a free promo item
without tripping `pricing_drift`. Fix shape: treat `pwpBase != null` as
authoritative even when 0 (`hasAuthoritativeSelling = category !== 'SOFA' &&
(pwpBase != null || sellBaseSen > 0)`).

### I7 — `cellsToPoSkus` rewrites wide-arm (1B/2B) builds to standard-arm bundle SKUs on the retail PO sheet
`packages/shared/src/sofa-build.ts:1498-1501` — `detectBundle` uses
`bundleSignature`, which collapses `1B→1A`, `2B→2A`
(BUNDLE_FAMILY_COLLAPSE, line 557-563). A `1B(LHF)+1B(RHF)` build therefore
signs as `1A+1A` → 2S bundle → the PO emits one `2S` line, silently dropping
the customer's deliberate wide-arm choice. This is exactly the Loo 2026-06-03
bug class the codebase already documents (`isWideArmSeat`, line 572-582:
"the auto-convert must SKIP any group containing one") — the configurator
auto-convert got the skip, `cellsToPoSkus` did not. Live consumer:
`apps/backend/src/lib/queries.ts:234` (factory PO sheet). Fix shape: bypass
the bundle short-circuit when `modIds.some(isWideArmSeat)` and emit per-cell
lines.

---

## MEDIUM

### M1 — `recomputeTotals` pools ALL sofa lines of a Model into one combo-match group
`mfg-sales-orders.ts:3330-3336` (clone: `consignment-orders.ts:1126-1133`)
groups by `baseModel` only — `variants.buildKey` (written by the split,
`mfg-sales-orders.ts:1996-2007`) is ignored. Two separate builds of the same
Model on one SO are matched as ONE module pool: the combo can be covered by
cells straddling both builds, applies only once (the second identical set
keeps raw module costs), and the matched-subset choice across builds is
arbitrary. Group by `(baseModel, buildKey)` and the qty issue (I1) shrinks
too.

### M2 — Partial catalog gap in the sofa split creates RM 0 SO lines
`packages/shared/src/so-sofa-split.ts:57-69 + 112-118`. The equal-split
fallback only triggers when ALL weights are 0. If ONE module of a build has no
catalog sell price, its weight is 0 → its line books `unit_price_sen = 0` (and
`unit_cost_sen = 0`) while the others absorb its share. Σ stays exact, but a
zero-money goods line then rides DO/SI prints and per-line margin reports.
The create-path only warns when the WHOLE map is missing
(`mfg-sales-orders.ts:1978-1984`), not for a partial gap.

### M3 — `comboChargedPrices` lets an explicit selling 0 win
`packages/shared/src/sofa-combo-pricing.ts:77-86` — `v !== null && v !==
undefined` accepts `0`, so a combo height with selling price keyed as 0
charges RM 0 for the whole matched subset. Downstream guards
(`comboPriceMyr > 0` in groupPrice:1128, `comboTotal <= 0` in the cost
spreads) stop the zero from APPLYING, so today this only suppresses the
fallback-to-cost — but any future caller that doesn't re-guard inherits a
free-sofa hole. Suggest treating 0 as "unpriced" at the merge.

### M4 — `distributeProportionally` mis-documents negative totals
`so-sofa-split.ts:53` claims "Negative totals distribute symmetrically" —
false: `Math.floor` on negative shares rounds AWAY from zero, so the last
line absorbs a POSITIVE residue of up to n−1 sen (e.g. −100 over [1,1,1] →
[−34,−34,−32]). No current caller passes negative totals; fix the doc or use
truncation toward zero if credits ever flow through it.

---

## LOW / OBSERVATIONS

- **L1 — Whole-MYR quantisation in the mfg sofa selling path.**
  `sofa-build.ts:466` (`price: Math.round(sen / 100)`) and `:1112`
  (`comboPriceMyr = Math.round(centi / 100)`), re-multiplied ×100 at `:495`.
  Any module/combo price not a multiple of RM 1 is silently rounded (≤ 50 sen
  per module). POS and server share the rounding so the drift gate stays
  quiet; only a concern if Master Admin ever keys sub-RM prices.
- **L2 — Split discount lands entirely on the first module line.**
  `mfg-sales-orders.ts:2008` — `(qty × share) − discount` on line 0 can go
  negative when the build discount exceeds the first module's share; the
  proportional `distributeProportionally` helper is right there and could
  spread it.
- **L3 — `spreadComboTotal` unit ambiguity.** The PO path passes per-UNIT
  costs, the SO/consignment paths pass line totals; the helper is
  unit-agnostic by doc (`sofa-combo-pricing.ts:466-471`) but the SO-side
  output is then treated as a line total regardless of qty — see I1.
- **L4 — `loadActiveSofaCombos` is duplicated** in `mfg-sales-orders.ts` and
  `consignment-orders.ts` along with the whole ~55-line combo-cost-spread
  block; they have already drifted cosmetically and will drift functionally
  when I1/I2/M1 are fixed in one place only.
- **L5 — `pricing.ts` retail money is float-RM** (e.g.
  `DEFAULT_EXTRA_PILLOW_PRICE = 80`) by design (POS retail convention);
  flagged only because the repo rule of thumb is "money in sen" — boundary
  conversions (`service-lines.ts` ×100, `computeSofaSellingSen` ×100) were
  checked and are correct.
- **L6 — `formatPhone` 9-digit-mobile comment vs code** agree (2-3-4 split);
  no bug. `normalizePhone`/`splitE164`/`combineE164` round-trip cleanly,
  greedy dial matching is longest-first — clean.

## Test gaps worth closing (assert-the-right-behaviour list)

1. Combo match on a MIRRORED build with one-hand-only compartment pricing
   (pins C1).
2. Multi-module build cost = Σ module SKU costs (pins C2; currently nothing
   asserts build-level cost at all).
3. Combo cost spread with qty = 2 module lines (pins I1).
4. Bedframe matrix `{P1 only}` + PRICE_2 fabric → expect flat fallback, not 0
   (pins I5; the existing test at `mfg-pricing.test.ts:575` covers only the
   mirror-image case).
5. `computeVariantKey('sofa', { depth, sofaLegHeight, … })` ≡
   `computeVariantKey('sofa', { seatHeight, legHeight, … })` (pins I3).
6. PWP free grant (pwpBaseSen = 0) → unit_price_sen forced 0, drift on a
   non-zero client price (pins I6).
7. `cellsToPoSkus` on a 1B/2B build → per-cell lines, never a collapsed
   bundle SKU (pins I7).

## Checked and found clean

- `matchComboSubset` (Kuhn bipartite matching) — handles the overlapping
  OR-set / dupes / subset edge cases correctly, incl. the `[{X,Y},{X}]` trap;
  empty combos and short builds rejected.
- `canonicalizeComboModulesForStorage` vs `canonicalizeLayoutModulesForStorage`
  ordering semantics; `comboSlotsKey` order-independence; `findDuplicateCombo`.
- `spreadComboTotal` residual math (floors → residual ≥ 0 → dearest line);
  even-split degenerate case sums exactly.
- `pickComboMatch` scope ranking (customer+tier > customer+any > company+tier
  > company+any, newest effectiveFrom tie-break); soft-delete and
  effective-date filters; customer-mismatch rows can't win.
- `resolveSeatHeightSen` / `resolveSeatHeightSelling` tier fallbacks — the
  deliberate asymmetry (cost: any-tier fallback; selling: never) is sound.
- `normalizeSofaTier` (reject-don't-normalize importer gate), `fabricTierAddon`
  clamps, `liftChargeableUnits` / `computeAddonServiceLines` overflow ceilings
  and the dedupe-by-id guard, `buildDeliveryFeeServiceLines` Σ == fee.total,
  `computeSoDeliveryFee` special/follow-up branches, `meetsProceedGate`,
  `oneShotSofaCode` normalization-stability, `adjustmentIncreaseErrors`,
  `buildVariantSummary` (reads BOTH vocabularies — unlike variant-key),
  `mfgPricingDriftExceeds` / `driftThresholdExceeded` zero-handling,
  schemas (order-v1 / product / slip) money fields.
