// ----------------------------------------------------------------------------
// How much voucher money a SOFA BUILD may safely carry.
//
// THE HAZARD. A sofa arrives at the server as ONE line and is split into one
// row per module (so-sofa-split.ts). The line's WHOLE discount is then assigned
// to module row 0 (`i === 0 ? discount : 0`) while the bound
// `0 <= discount <= qty * unit` was checked against the WHOLE BUILD. So a
// discount larger than row 0's own share persists a negative total_centi /
// line_margin_centi, and nothing re-checks after the split.
//
//   RM 1,600 build, 4 equal modules → row 0 = RM 400.
//   RM 500 discount passes the bound (500 <= 1,600) and writes RM −100.
//
// The real fix is one line upstream — split the discount with the SAME weights
// the price already uses. That code runs in HouzsERP. Until it lands, this
// module computes a floor on what row 0 is worth so the POS can refuse to send
// more than it can hold.
//
// WHY THE ANSWER IS THE LEFTMOST MODULE'S OWN PRICE, not row 0's share of the
// build total. The server's row-0 share is `build × w0 / Σw`. We reliably know
// w0 — the leftmost module's catalog price, read from the same store the server
// reads. We do NOT reliably know `build` or `Σw`: 62 sofa module SKUs carry no
// visible selling price, so a client-side Σw can be missing terms the server
// has (that is exactly what the Uborr drift rejections were), and after a
// drift-fix the line's `build` is the SERVER's figure with no client-side
// decomposition at all. Splitting our own build total across our own weights
// therefore OVER-estimates row 0 whenever a module is invisible — the unsafe
// direction. `w0` alone is only wrong when a whole-build price swap (PWP
// reward combo) compresses every share below its catalog weight, which is why
// the result is additionally clamped to the build price, and why the caller
// spends only a fraction of it (SOFA_LEAD_MODULE_SAFETY).
//
// DESIGN RULE: return null whenever the answer is not provable. The caller
// treats null as "this sofa carries nothing". Declining a sale we could have
// taken is recoverable; a negative row is silent and lands in the ledger.
// ----------------------------------------------------------------------------
import { normalizeCompartmentCode, orderSofaCellsLeftToRight, type Rot } from './sofa-build';

export interface SofaCapInput {
  /** variants.cells — the build layout, exactly as it goes into the payload. */
  cells: unknown;
  /** variants.depth. Feeds the same left-to-right walk the server uses, which
   *  is what decides WHICH module becomes row 0. */
  depth: string | null | undefined;
  /** Per-UNIT build selling price in sen (the client's figure — or the
   *  server's, after a drift-fix adopted it). Clamps the answer: no row's
   *  share can exceed the whole build. */
  buildUnitPriceCenti: number;
  qty: number;
  /** Normalized module code → sen, built the same way the server builds it. */
  modulePrices: Record<string, number> | null | undefined;
  /**
   * True when this line declares an extra add-on charge. The server then splits
   * the selling price EVENLY across modules regardless of catalogue weights
   * (`evenSplitPrice: extraRM > 0`, mfg-sales-orders.ts), so row 0 is
   * build/N — which is knowable, and better than refusing.
   */
  evenSplitPrice?: boolean;
}

/**
 * A safe floor (sen) for module row 0's value on this build — the ceiling a
 * discount on this cart line must stay under.
 *
 * THREE CASES, because the server splits a build's price three ways:
 *
 *  1. **Equal split** — either the line declares an extra charge, or NO module
 *     has a catalogue price. `distributeProportionally` falls back to equal
 *     weights when every weight is 0 (so-sofa-split.ts), so row 0 is exactly
 *     `build / N`. This is not an estimate: the server does the same arithmetic
 *     on the same build price. Confirmed against a live order — a 2-module
 *     Telluc at RM 2,990 booked RM 1,495 per module per unit.
 *     This case is what makes Telluc / Pllao quick-picks work: their combo
 *     gives the build a real price even though no module carries one.
 *  2. **Weighted split, leftmost priced** — row 0 is `build × w0/Σw`, which is
 *     ≥ w0 whenever build ≥ Σw. So w0 is a floor, and the one figure both sides
 *     read from the same store. Used clamped to the build price.
 *  3. **Weighted split, leftmost UNPRICED** — row 0's share is 0, so any
 *     discount at all goes negative. Returns null.
 *
 * Also returns null with no cells, malformed cells, no price map, or no
 * positive build price / qty.
 */
export const leadModuleValueCenti = (args: SofaCapInput): number | null => {
  const { cells, depth, buildUnitPriceCenti, qty, modulePrices, evenSplitPrice } = args;

  /* An absent price map is only fatal for the WEIGHTED cases. On the equal
     split the weights are irrelevant — the server ignores them too. */
  if (!modulePrices && !evenSplitPrice) return null;
  if (!Array.isArray(cells) || cells.length === 0) return null;
  const build = Math.trunc(buildUnitPriceCenti);
  if (!Number.isFinite(build) || build <= 0) return null;
  const units = Math.floor(qty);
  if (!Number.isFinite(units) || units <= 0) return null;

  const parsed: Array<{ moduleId: string; x: number; y: number; rot: Rot }> = [];
  for (const raw of cells) {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    const moduleId = typeof c.moduleId === 'string' ? c.moduleId.trim() : '';
    if (!moduleId) return null;
    parsed.push({
      moduleId,
      x: typeof c.x === 'number' ? c.x : Number.NaN,
      y: typeof c.y === 'number' ? c.y : Number.NaN,
      // Same rot normalization as the split, so degenerate stored values
      // (-90, 450) order identically on both sides.
      rot: ((((typeof c.rot === 'number' ? c.rot : 0) % 360) + 360) % 360) as Rot,
    });
  }

  /* CASE 1 — equal split. Either the line declares an extra charge, or not one
     module carries a catalogue price (so every weight is 0 and
     distributeProportionally falls back to equal weights). Row 0 is then
     build/N exactly, floored the same way the server floors it. Checked before
     the walk because the walk's ORDER cannot matter when every share is equal.

     `Math.floor` matches distributeProportionally, which floors every share
     except the last and puts the residue there — so row 0 is never the
     rounded-up one. */
  const anyPriced = modulePrices
    ? parsed.some((c) => {
        const w = modulePrices[normalizeCompartmentCode(c.moduleId)];
        return typeof w === 'number' && Number.isFinite(w) && w > 0;
      })
    : false;

  if (evenSplitPrice || !anyPriced) {
    return Math.floor(build / parsed.length) * units;
  }

  /* The walk decides which module IS row 0 — same function, same depth default
     as splitSofaBuildIntoModuleLines, or we would be measuring a different
     module than the one the discount lands on. */
  const ordered = orderSofaCellsLeftToRight(parsed, depth ?? '24');
  const leadCode = normalizeCompartmentCode((ordered[0] as { moduleId: string }).moduleId);

  // CASE 3 — weighted split with an unpriced leftmost module: its share is 0.
  const w0 = modulePrices?.[leadCode];
  if (typeof w0 !== 'number' || !Number.isFinite(w0) || w0 <= 0) return null;

  /* CASE 2 — weighted split, leftmost priced. Clamp to the build price: a
     whole-build price swap (PWP reward combo) can price the build below its
     catalog-weight sum, and no share exceeds the whole. The row's real headroom
     is qty × its unit share — moduleLineTotal is
     `(qty * s.unitPriceSen) - discount`. */
  return Math.min(w0, build) * units;
};
