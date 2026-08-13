import { describe, it, expect } from 'vitest';
import { leadModuleValueCenti } from './voucher-sofa-cap';

const cell = (moduleId: string, x: number) => ({ id: `c-${moduleId}`, moduleId, x, y: 0, rot: 0 });

const PRICES = { '1A(LHF)': 30_000, '1A(RHF)': 90_000, 'CONSOLE': 60_000 };

describe('leadModuleValueCenti — the number', () => {
  it('is the leftmost module\'s own catalog price', () => {
    /* NOT row 0's share of the build. w0 is the one figure both sides read
       from the same store; the build total and the other weights are exactly
       what the client can be wrong about (invisible module prices, or a
       drift-fix that adopted the server's total wholesale). The server's real
       row-0 share is `build × w0/Σw` ≥ w0 whenever build ≥ Σw, so w0 is a
       floor — and the build-price clamp covers the swap case below. */
    expect(leadModuleValueCenti({
      cells: [cell('1A(LHF)', 0), cell('1A(RHF)', 200)],
      depth: '24', buildUnitPriceCenti: 120_000, qty: 1, modulePrices: PRICES,
    })).toBe(30_000);
  });

  it('multiplies by qty — the row headroom is qty × unit share', () => {
    expect(leadModuleValueCenti({
      cells: [cell('1A(LHF)', 0), cell('1A(RHF)', 200)],
      depth: '24', buildUnitPriceCenti: 120_000, qty: 3, modulePrices: PRICES,
    })).toBe(90_000);
  });

  it('measures the LEFTMOST module, not the first one in the array', () => {
    /* The server splits in left-to-right walk order, so row 0 is whichever
       module is visually first — not whichever the salesperson dragged on
       first. Reading the array order instead would measure the wrong module
       and hand back a ceiling three times too high here. */
    const rightFirst = leadModuleValueCenti({
      cells: [cell('1A(RHF)', 200), cell('1A(LHF)', 0)],
      depth: '24', buildUnitPriceCenti: 120_000, qty: 1, modulePrices: PRICES,
    });
    expect(rightFirst).toBe(30_000);
  });

  it('handles a three-module build', () => {
    expect(leadModuleValueCenti({
      cells: [cell('1A(LHF)', 0), cell('CONSOLE', 100), cell('1A(RHF)', 200)],
      depth: '24', buildUnitPriceCenti: 180_000, qty: 1, modulePrices: PRICES,
    })).toBe(30_000);
  });

  it('clamps to the build price when a price swap undercuts the catalog weight', () => {
    /* PWP reward combo: the whole build is repriced BELOW the sum of its
       module weights, compressing every row's share below its catalog price.
       w0 alone would overstate row 0; the clamp keeps us under the whole
       build, and the caller's safety fraction covers the compression. */
    expect(leadModuleValueCenti({
      cells: [cell('1A(LHF)', 0), cell('1A(RHF)', 200)],
      depth: '24', buildUnitPriceCenti: 20_000, qty: 1, modulePrices: PRICES,
    })).toBe(20_000);
  });
});

describe('leadModuleValueCenti — refuses rather than guesses', () => {
  const base = {
    cells: [cell('1A(LHF)', 0), cell('1A(RHF)', 200)],
    depth: '24', buildUnitPriceCenti: 120_000, qty: 1, modulePrices: PRICES,
  };

  it('returns null when the LEFTMOST module is unpriced', () => {
    /* THE CASE THAT MATTERS. Row 0 unpriced means a RM 0 share, so any discount
       at all goes negative there and nothing downstream re-checks. */
    expect(leadModuleValueCenti({ ...base, modulePrices: { '1A(RHF)': 90_000 } })).toBeNull();
    expect(leadModuleValueCenti({
      ...base, modulePrices: { '1A(LHF)': 0, '1A(RHF)': 90_000 },
    })).toBeNull();
  });

  it('tolerates an unpriced module in a LATER position — and does NOT inflate', () => {
    /* THE UBORR SHAPE. The tablet can see the leftmost module's price but not
       its siblings' (62 module SKUs serve no selling price through the catalog
       endpoint, though the server evidently prices some of them — its drift
       recompute said RM 1,980 where the tablet saw RM 990). The answer must
       stay w0, NOT balloon to the whole build: with invisible weights, "row
       0's share of OUR total" over-estimates in exactly the unsafe direction.
       An invisible sibling can only ENLARGE the server's true row-0 share, so
       w0 remains a floor. */
    expect(leadModuleValueCenti({ ...base, modulePrices: { '1A(LHF)': 30_000 } })).toBe(30_000);
    expect(leadModuleValueCenti({
      ...base,
      cells: [cell('1A(LHF)', 0), cell('CONSOLE', 100), cell('1A(RHF)', 200)],
      modulePrices: { '1A(LHF)': 30_000 },
    })).toBe(30_000);
  });

  it('holds after a drift-fix adopts the server\'s (higher) build price', () => {
    /* After adopting the server's RM 1,980 for a build the tablet priced at
       RM 990, buildUnitPriceCenti is a figure the client cannot decompose.
       The cap must not change with it (beyond the clamp): still w0. */
    expect(leadModuleValueCenti({
      ...base, buildUnitPriceCenti: 198_000, modulePrices: { '1A(LHF)': 99_000 },
    })).toBe(99_000);
  });

  it('returns null with no price map at all', () => {
    expect(leadModuleValueCenti({ ...base, modulePrices: null })).toBeNull();
  });

  it('returns null for a bundle-only sofa (no cells)', () => {
    expect(leadModuleValueCenti({ ...base, cells: [] })).toBeNull();
    expect(leadModuleValueCenti({ ...base, cells: undefined })).toBeNull();
  });

  it('returns null on a malformed cell rather than skipping it', () => {
    expect(leadModuleValueCenti({ ...base, cells: [cell('1A(LHF)', 0), { x: 200 }] })).toBeNull();
    expect(leadModuleValueCenti({ ...base, cells: [null] })).toBeNull();
  });

  it('returns null for a build with no price or no qty', () => {
    expect(leadModuleValueCenti({ ...base, buildUnitPriceCenti: 0 })).toBeNull();
    expect(leadModuleValueCenti({ ...base, qty: 0 })).toBeNull();
  });

  it('normalizes module codes, so a dash-form cell still resolves', () => {
    // '1A-LHF' and '1A(LHF)' are the same module written two ways.
    expect(leadModuleValueCenti({
      ...base, cells: [cell('1A-LHF', 0), cell('1A(RHF)', 200)],
    })).toBe(30_000);
  });
});
