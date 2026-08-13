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
}

/**
 * A safe floor (sen) for module row 0's value on this build — the ceiling a
 * discount on this cart line must stay under.
 *
 * Returns **null** when it cannot be established:
 *
 *  · no cells / malformed cells / no module price map — nothing to reason from
 *  · **the leftmost module is unpriced** — it gets weight 0 and therefore a
 *    RM 0 share server-side, so any discount at all would go negative there
 *  · no positive build price / qty
 *
 * Unpriced modules in OTHER positions are fine — they can only make the
 * server's row-0 share LARGER than w0 (they shrink Σw), so w0 stays a floor.
 */
export const leadModuleValueCenti = (args: SofaCapInput): number | null => {
  const { cells, depth, buildUnitPriceCenti, qty, modulePrices } = args;

  if (!modulePrices) return null;
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

  /* The walk decides which module IS row 0 — same function, same depth default
     as splitSofaBuildIntoModuleLines, or we would be measuring a different
     module than the one the discount lands on. */
  const ordered = orderSofaCellsLeftToRight(parsed, depth ?? '24');
  const leadCode = normalizeCompartmentCode((ordered[0] as { moduleId: string }).moduleId);

  const w0 = modulePrices[leadCode];
  if (typeof w0 !== 'number' || !Number.isFinite(w0) || w0 <= 0) return null;

  /* Clamp to the build price: a whole-build price swap (PWP reward combo) can
     price the build below its catalog-weight sum, and no share exceeds the
     whole. The row's real headroom is qty × its unit share — moduleLineTotal
     is `(qty * s.unitPriceSen) - discount`. */
  return Math.min(w0, build) * units;
};
