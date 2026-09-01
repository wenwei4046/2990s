import {
  analyzeSofa,
  cellsBbox,
  familySignature,
  findModule,
  isAccessoryModule,
  isWideArmSeat,
  moduleFootprint,
  type BundleDef,
  type Cell,
  type Depth,
} from '@2990s/shared';
import { isFunctionalSeat } from './sofa-seamless';

/* ─── Canonical bundle breakdown (Custom Build) ──────────────────────
 *
 * A bundle (2S / 3S / 2+L / 3+L …) names the compartments the factory ships
 * against — `BundleDef.canonicalModules`. A custom drag-out that matches the
 * bundle's SIGNATURE may nevertheless be built from DIFFERENT compartments
 * (detectBundle matches a multiset of families, not a layout).
 *
 * Two consumers need to know whether the canvas is holding the canonical
 * breakdown or something else:
 *   • the auto-convert effect — may it rewrite the user's cells?
 *   • the composite-art gate — may it paint the bundle PNG over the group?
 *
 * Both answers live here so they can't drift, and so the rules are testable
 * without mounting CustomBuilder.
 */

/** The bundle's canonical breakdown resolved to ORIENTED module ids for this
 *  group. For L-shape bundles the arm faces opposite the chaise side (L on
 *  right → arm on left → (LHF) variants). For non-L bundles with multiple
 *  armed compartments the first armed family gets LHF, the last RHF.
 *  Single-armed bundles default LHF; NA families pass through unchanged. */
export const canonicalSkusForBundle = (bundle: BundleDef, groupCells: Cell[]): string[] => {
  const flip: 'L' | 'R' = groupCells.find((c) => c.moduleId === 'L(LHF)') ? 'L' : 'R';
  const hasL = bundle.canonicalModules.includes('L');
  const armedIdxs = bundle.canonicalModules
    .map((f, idx) => (f === '1A' || f === '2A' ? idx : -1))
    .filter((x) => x >= 0);
  const resolveSku = (fam: string, idx: number): string => {
    if (fam === '1NA' || fam === '2NA') return fam;
    if (fam === 'L') return `L(${flip}HF)`;
    if (fam === '1A' || fam === '2A') {
      let armSide: 'L' | 'R';
      if (hasL) {
        armSide = flip === 'R' ? 'L' : 'R';
      } else if (armedIdxs.length > 1) {
        armSide = idx === armedIdxs[0] ? 'L' : 'R';
      } else {
        armSide = 'L';
      }
      return `${fam}(${armSide}HF)`;
    }
    return fam;
  };
  const orderedFams =
    hasL && flip === 'L'
      ? [...bundle.canonicalModules].reverse()
      : bundle.canonicalModules;
  return orderedFams.map((f, idx) => resolveSku(f, idx));
};

/** Are these cells the bundle's canonical compartment make-up?
 *
 *  Families only — a mirrored build (2A(LHF) + 1A(RHF) vs the canonical
 *  1A(LHF) + 2A(RHF)) is the same sofa flipped and "mirror is equally valid"
 *  (Loo 2026-05-24), so it still counts as canonical.
 *
 *  🔑 The composite bundle PNG (3S.png …) draws the CANONICAL compartments —
 *  one solid module boundary a third of the way along a 3-Seater, then a
 *  dashed cushion seam. Stretching it over a group whose real compartments sit
 *  somewhere else DRAWS A SOFA THE CUSTOMER IS NOT BUYING: a hand-built
 *  1A(LHF) + 1NA + 1A(RHF) signs as 3S, and the PNG then shows TWO
 *  compartments over a build that has THREE (Loo 2026-09-01). So the art gate
 *  asks this first and falls through to the code-drawn seamless run — which
 *  draws each real module boundary — whenever the answer is no. */
export const canonicalMatchesCells = (cells: Cell[], bundle: BundleDef): boolean =>
  familySignature(cells.map((c) => c.moduleId)) === familySignature([...bundle.canonicalModules]);

/** Auto-convert a closed, bundle-matched group to the canonical layout at the
 *  same anchor — or null to leave the user's cells exactly as laid out.
 *
 *  e.g. user dragged 1A(LHF) + 2NA + L(RHF) but the 3+L canonical is
 *  2A(LHF) + 1NA + L(RHF): same three compartments re-expressed, so the build
 *  matches Combos / Quick-Pick art defined on the canonical breakdown.
 *
 *  The `null` cases are all one rule — NEVER silently hand the customer
 *  different compartments than the ones they placed. */
export const canonicalConversion = (
  groupCells: Cell[],
  bundle: BundleDef,
  depth: Depth,
  nextId: () => string,
): Cell[] | null => {
  if (groupCells.length === 0) return null;
  // Never rewrite a group that includes an accessory (console / stool) to
  // its canonical seat-only SKUs — that would delete the accessory cell
  // entirely (e.g. 1A + WC-45 + 2A matches the 3S signature, whose canonical
  // [1A,2A] is closed and would replace the console). The PO layer
  // (cellsToPoSkus) already splits accessories onto their own lines, so the
  // canvas safely keeps the user's modules exactly as laid out.
  if (groupCells.some((c) => isAccessoryModule(c.moduleId))) return null;
  // Likewise never rewrite a group containing a FUNCTIONAL seat (power /
  // recliner / leg — 1A(P), 1NA(P), 1S(P)/(R)/(L), …). The canonical breakdown
  // collapses the mechanism suffix (1NA(P) → 1NA), so 1A(LHF) + 1NA(P) + 1A(RHF)
  // signs as 1A+1A+1NA → the plain 3S [1A,2A], and the rewrite would
  // silently DELETE the power seat the user deliberately placed — the
  // layout "jumps" to a standard sofa. Keep the user's exact modules; PO
  // SKU translation happens in the order layer (cellsToPoSkus).
  if (groupCells.some((c) => isFunctionalSeat(c.moduleId))) return null;
  // Likewise never rewrite a group containing a B-variant (wide-arm) seat —
  // 1B / 2B. detectBundle COLLAPSES 1B→1A / 2B→2A so the build still matches
  // a bundle (good: it prices/combos as the bundle), but the canonical SKU
  // breakdown only emits A/NA/L families and can't express a B. Converting
  // would silently swap the customer's deliberate 1B/2B for a 1A/2A — showing
  // a different compartment than they picked (Loo 2026-06-03).
  // Keep the user's exact modules; cellsToPoSkus handles SKU translation.
  if (groupCells.some((c) => isWideArmSeat(c.moduleId))) return null;

  const canonicalSkus = canonicalSkusForBundle(bundle, groupCells);

  // 🔑 Guard: never MERGE compartments away (Loo 2026-09-01). detectBundle
  // matches a multiset of FAMILIES, so 1A(LHF) + 1NA + 1A(RHF) signs as
  // '1A+1A+1NA' → the 3S bundle, whose canonical breakdown is just TWO
  // compartments [1A, 2A]. Converting replaced three deliberately-placed
  // modules with two — a physically different sofa (298cm instead of 310cm
  // @30", one seam fewer, one fewer piece to ship and to price), reached by
  // nothing more than linking the modules together. The same shape bites
  // 1A+1A+L → [2A, L] and 1A+1A+1NA+L → [2A, 1NA, L].
  // A count-preserving re-expression (1A+2NA+L → 2A+1NA+L) is still allowed:
  // that swaps which compartments, not how many, and is the case the
  // auto-convert was written for.
  if (canonicalSkus.length < groupCells.length) return null;

  // Already canonical? Compare sorted multisets — order on canvas might
  // differ but the SKU set is what matters for "is this the standard".
  const userSorted = groupCells.map((c) => c.moduleId).sort();
  const canonSorted = [...canonicalSkus].sort();
  if (
    userSorted.length === canonSorted.length &&
    userSorted.every((id, j) => id === canonSorted[j])
  ) {
    return null;
  }

  const bb = cellsBbox(groupCells, depth);
  if (!bb) return null;
  let x = bb.x;
  const y = bb.y;
  const addCells: Cell[] = [];
  for (const sku of canonicalSkus) {
    const m = findModule(sku);
    if (!m) continue;
    const fp = moduleFootprint(m, 0, depth);
    addCells.push({ id: nextId(), moduleId: sku, x, y, rot: 0 });
    x += fp.w;
  }
  // Guard: never auto-convert when the canonical SKU layout is itself NOT
  // closed (e.g. 2S.canonicalModules = ['2A'] resolves to a single 2A(LHF)
  // with right end open). Otherwise we'd silently strip the user's
  // closed sofa down to a half-open one — visually broken and triggering
  // the "Right end has no arm" warning on a layout the user just built
  // properly. This skip preserves the user's modules; the canonical SKU
  // translation for PO purposes happens in the order layer instead.
  if (!analyzeSofa(addCells, depth).closed) return null;
  return addCells;
};
