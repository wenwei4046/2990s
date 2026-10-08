// ----------------------------------------------------------------------------
// Plan-view geometry for <SofaBlueprint>, in the SVG viewBox units of
// public/sofa-modules/<code>.svg (the body rect inside each file's
// translate(20,20) group).
//
// The design's blueprint (SofaBlueprint.dc.html) drew eight modules —
// 1A, 1NA, 2A, 2NA, L — with exactly these numbers. Maintenance carries more
// than eight, so every other code that has module art here was measured off
// its own SVG the same way (body size, which side carries the arm, where the
// seat seams fall). A code with no art falls back to a plain 60×70 body, which
// is what the design's renderer did for anything it did not know.
// ----------------------------------------------------------------------------

import { normalizeCompartmentCode, representativeArtCode } from '@2990s/shared/sofa-build';

export interface BlueprintModule {
  /** Body width / depth (viewBox units). */
  w: number;
  h: number;
  /** Hard arm strip (11 units) on the left / right edge. */
  armL?: boolean;
  armR?: boolean;
  /** A bench end (the 1B / 2B "no arm, deep seat" side): a wider strip in the
   *  backrest colour, as the module art draws it. */
  benchL?: boolean;
  benchR?: boolean;
  /** Backrest strip down the left edge too — the corner piece. */
  backL?: boolean;
  /** No backrest at all — a stool or a console. */
  noBack?: boolean;
  /** Wood console: the whole body in the arm colour. */
  wood?: boolean;
  /** Dashed seat seams, x positions from the body's left edge. */
  seams?: number[];
}

const ONE: BlueprintModule = { w: 60, h: 70 };

export const BLUEPRINT_MODULES: Readonly<Record<string, BlueprintModule>> = {
  // ── the design's eight, verbatim ─────────────────────────────────────────
  '1A(LHF)': { w: 60, h: 70, armL: true },
  '1A(RHF)': { w: 60, h: 70, armR: true },
  '1NA': { w: 47, h: 70 },
  '2A(LHF)': { w: 120, h: 70, armL: true, seams: [65.5] },
  '2A(RHF)': { w: 120, h: 70, armR: true, seams: [54.5] },
  '2NA': { w: 108, h: 70, seams: [54] },
  'L(LHF)': { w: 60, h: 105, armL: true },
  'L(RHF)': { w: 60, h: 105, armR: true },
  // ── measured off the remaining module art ────────────────────────────────
  '1A(P)(LHF)': { w: 60, h: 70, armL: true },
  '1A(P)(RHF)': { w: 60, h: 70, armR: true },
  '1A(R)(LHF)': { w: 60, h: 70, armL: true },
  '1A(R)(RHF)': { w: 60, h: 70, armR: true },
  '1A(L)(LHF)': { w: 60, h: 70, armL: true },
  '1A(L)(RHF)': { w: 60, h: 70, armR: true },
  '1B(LHF)': { w: 60, h: 70, benchL: true },
  '1B(RHF)': { w: 60, h: 70, benchR: true },
  '1NA(P)': { w: 60, h: 70 },
  '1NA(R)': { w: 60, h: 70 },
  '1NA(L)': { w: 60, h: 70 },
  '1S': { w: 60, h: 70, armL: true, armR: true },
  '1S(P)': { w: 60, h: 70, armL: true, armR: true },
  '1S(R)': { w: 60, h: 70, armL: true, armR: true },
  '1S(L)': { w: 60, h: 70, armL: true, armR: true },
  '1R-CLOSED': { w: 60, h: 70, armL: true, armR: true },
  '1R-OPEN': { w: 60, h: 70, armL: true, armR: true },
  '2B(LHF)': { w: 120, h: 70, benchL: true, seams: [71] },
  '2B(RHF)': { w: 120, h: 70, benchR: true, seams: [49] },
  '2S': { w: 120, h: 70, armL: true, armR: true, seams: [60] },
  '3S': { w: 180, h: 70, armL: true, armR: true, seams: [67, 113] },
  'CNR': { w: 60, h: 60, backL: true },
  'STOOL': { w: 47, h: 47, noBack: true },
  'WC-45': { w: 28, h: 70, noBack: true },
  'Console': { w: 28, h: 70, noBack: true, wood: true },
};

/** Geometry for any compartment code as Maintenance spells it. A one-shot
 *  variant ('1A(LHF)(SEAT)(EXTEND)…') draws as its base family, the same way
 *  the configurator reuses the base art for it. */
export function blueprintModule(code: string): BlueprintModule {
  return BLUEPRINT_MODULES[code]
    ?? BLUEPRINT_MODULES[normalizeCompartmentCode(code)]
    ?? BLUEPRINT_MODULES[representativeArtCode(code)]
    ?? ONE;
}
