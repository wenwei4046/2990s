import { describe, it, expect } from 'vitest';
import { BUNDLES, detectBundle, findModule, moduleFootprint, type BundleDef, type Cell, type Depth } from '@2990s/shared';
import { canonicalConversion, canonicalMatchesCells, canonicalSkusForBundle } from './sofa-canonical';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSeamlessRun, renderSeamlessSofa } from './sofa-seamless';

// 30" seat depth — the depth in Loo's 2026-09-01 repro. widthOffsetPerCushion
// adds 2.5cm per inch over the 24" baseline, per cushion:
//   1A(LHF/RHF) 95+15 = 110 · 1NA 75+15 = 90 · 2A 158+30 = 188 · 2NA 142+30 = 172
const D: Depth = '30';

let seq = 0;
const nextId = () => `c${++seq}`;

/** Lay module ids out left→right, flush, at y = 0 — the same contiguous row a
 *  salesperson gets by snapping modules together on the canvas. */
const row = (ids: string[]): Cell[] => {
  let x = 0;
  return ids.map((moduleId, i) => {
    const cell: Cell = { id: `u${i}`, moduleId, x, y: 0, rot: 0 };
    x += moduleFootprint(findModule(moduleId)!, 0, D).w;
    return cell;
  });
};

const bundleOf = (cells: Cell[]): BundleDef => {
  const b = detectBundle(cells.map((c) => c.moduleId));
  if (!b) throw new Error(`no bundle for ${cells.map((c) => c.moduleId).join('+')}`);
  return b;
};

describe('canonicalConversion — never merges the customer\'s compartments', () => {
  // Loo 2026-09-01. Three modules linked into one closed sofa were silently
  // rewritten to the 3S canonical breakdown [1A, 2A]: three compartments became
  // two and the sofa shrank 310cm → 298cm, reached by nothing more than
  // snapping the pieces together.
  it('leaves 1A(LHF) + 1NA + 1A(RHF) alone (3S canonical is only 2 compartments)', () => {
    const cells = row(['1A(LHF)', '1NA', '1A(RHF)']);
    const bundle = bundleOf(cells);
    expect(bundle.id).toBe('3S');
    expect(bundle.canonicalModules).toEqual(['1A', '2A']);
    expect(canonicalConversion(cells, bundle, D, nextId)).toBeNull();
  });

  it('the merged layout it used to produce was a physically different sofa', () => {
    const wide = (ids: string[]) =>
      ids.reduce((sum, id) => sum + moduleFootprint(findModule(id)!, 0, D).w, 0);
    expect(wide(['1A(LHF)', '1NA', '1A(RHF)'])).toBe(310);
    expect(wide(['1A(LHF)', '2A(RHF)'])).toBe(298);
  });

  it('leaves 1A(LHF) + 1A(RHF) alone (2S canonical is a single open-ended 2A)', () => {
    const cells = row(['1A(LHF)', '1A(RHF)']);
    expect(canonicalConversion(cells, bundleOf(cells), D, nextId)).toBeNull();
  });

  it('still re-expresses a build with the SAME compartment count', () => {
    // 3+L: user drags 1A(LHF) + 2NA + L(RHF); canonical is 2A(LHF) + 1NA + L(RHF).
    // Three compartments in, three out — the case the auto-convert exists for.
    const cells = row(['1A(LHF)', '2NA', 'L(RHF)']);
    const bundle = bundleOf(cells);
    expect(bundle.id).toBe('3+L');
    const out = canonicalConversion(cells, bundle, D, nextId);
    expect(out?.map((c) => c.moduleId)).toEqual(['2A(LHF)', '1NA', 'L(RHF)']);
    expect(out).toHaveLength(cells.length);
  });

  it('leaves an already-canonical build alone', () => {
    const cells = row(['1A(LHF)', '2A(RHF)']);
    expect(canonicalConversion(cells, bundleOf(cells), D, nextId)).toBeNull();
  });

  it('keeps skipping accessories, functional seats and wide-arm B variants', () => {
    const threeS = BUNDLES.find((b) => b.id === '3S')!;
    // Console between two armed 1-seaters — converting would delete the console.
    expect(canonicalConversion(row(['1A(LHF)', 'Console', '1A(RHF)']), threeS, D, nextId)).toBeNull();
    // Power seat — the canonical breakdown collapses the mechanism suffix away.
    expect(canonicalConversion(row(['1A(LHF)', '1NA(P)', '1A(RHF)']), threeS, D, nextId)).toBeNull();
    // 1B wide arm — canonical SKUs can only express the A families.
    expect(canonicalConversion(row(['1B(LHF)', '1NA', '1A(RHF)']), threeS, D, nextId)).toBeNull();
  });
});

describe('canonicalMatchesCells — which groups may wear the bundle PNG', () => {
  // The 3S artwork draws the canonical TWO compartments. Painted over a build
  // that has three, it shows a sofa the customer is not buying — Loo's
  // "diagram 显示就错了". Those groups fall through to the code-drawn seamless
  // run, which draws every real module boundary.
  it('rejects a 3-compartment build that merely SIGNS as 3S', () => {
    const cells = row(['1A(LHF)', '1NA', '1A(RHF)']);
    expect(canonicalMatchesCells(cells, bundleOf(cells))).toBe(false);
  });

  it('accepts the canonical breakdown', () => {
    const cells = row(['1A(LHF)', '2A(RHF)']);
    expect(canonicalMatchesCells(cells, bundleOf(cells))).toBe(true);
  });

  it('accepts a mirrored canonical breakdown (same families, flipped)', () => {
    const cells = row(['2A(LHF)', '1A(RHF)']);
    expect(canonicalMatchesCells(cells, bundleOf(cells))).toBe(true);
  });

  it('ignores accessories on both sides of the comparison', () => {
    const cells = row(['1A(LHF)', 'Console', '2A(RHF)']);
    expect(canonicalMatchesCells(cells, BUNDLES.find((b) => b.id === '3S')!)).toBe(true);
  });

  it('what the rejected group falls through to draws all three compartments', () => {
    // The art gate hands a non-canonical group to buildSeamlessRun (gate 2 in
    // CustomBuilder), which draws one continuous sofa with a SOLID line at each
    // real module boundary and an arm only where a module actually has one.
    const run = buildSeamlessRun(row(['1A(LHF)', '1NA', '1A(RHF)']), D, 0);
    expect(run?.totalLen).toBe(310);
    expect(run?.slots.map((s) => s.len)).toEqual([110, 90, 110]);
    expect(run?.slots.map((s) => [s.armLeft, s.armRight])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);

    // …and the drawing really carries both boundaries: a 310cm body with a
    // SOLID line at 110 and at 200, and an arm at each end. The 3S PNG this
    // replaces is one stretched <image> holding a single module boundary.
    const svg = renderToStaticMarkup(
      renderSeamlessSofa(run!, run!.totalLen, run!.thickness, () => '', () => undefined),
    );
    const boundaries = [...svg.matchAll(/<line\b[^>]*>/g)]
      .filter((m) => !m[0].includes('stroke-dasharray'))
      .map((m) => Number(/x1="([\d.]+)"/.exec(m[0])?.[1]));
    expect(boundaries).toEqual([110, 200]);
    expect(svg).toContain('viewBox="0 0 310 95"');
  });
});

describe('canonicalSkusForBundle — orientation resolution', () => {
  it('3S: first armed family faces left, last faces right', () => {
    expect(canonicalSkusForBundle(BUNDLES.find((b) => b.id === '3S')!, [])).toEqual(['1A(LHF)', '2A(RHF)']);
  });

  it('3+L: the arm faces opposite the chaise, and a left chaise reverses the run', () => {
    const threeL = BUNDLES.find((b) => b.id === '3+L')!;
    expect(canonicalSkusForBundle(threeL, row(['L(RHF)']))).toEqual(['2A(LHF)', '1NA', 'L(RHF)']);
    expect(canonicalSkusForBundle(threeL, row(['L(LHF)']))).toEqual(['L(LHF)', '1NA', '2A(RHF)']);
  });
});
