import { describe, expect, it } from 'vitest';
import { cartSummary, type SofaConfigSnapshot } from './cart';

const sofa: SofaConfigSnapshot = {
  kind: 'sofa', productId: 'sofa-1', productName: 'Example sofa', total: 3490,
  depth: '28', summary: 'Old build label · EZ/EZ002',
  cells: [
    { moduleId: '1A(LHF)', x: 0, y: 0, rot: 0, recliners: [{ seatIdx: 0, open: false }] },
    { moduleId: '1A(RHF)', x: 95, y: 0, rot: 0 },
  ],
  seatUpgradeLabel: 'Power slide',
  fabricId: 'fabric-ez', fabricLabel: 'EZ', colourId: 'EZ002', colourLabel: 'EZ002',
  sofaLegHeight: '6"',
};

describe('sofa cart summary', () => {
  it('keeps the current build and all booked options visible without repeating prices', () => {
    const summary = cartSummary({
      ...sofa,
      specialIds: ['DRAWER'], specialLabels: ['Right drawer'], specialChoices: { DRAWER: ['10"'] },
      extraAddonNote: 'Custom stitching', extraAddonAmountRM: 125, remark: 'Face the window',
    });
    expect(summary).toContain('Custom (1A+1A)');
    expect(summary).toContain('+ 1 Power slide');
    expect(summary).toContain('EZ / EZ002 / SEAT 28" / LEG 6"');
    expect(summary).toContain('SPECIAL: Right drawer (10") + Custom stitching');
    expect(summary).toContain('Remark: Face the window');
    expect(summary).not.toMatch(/Old build label|KIV|RM|3490|125/);
  });

  it('distinguishes colour KIV from confirmed colour with a missing display label', () => {
    expect(cartSummary({ ...sofa, colourId: undefined, colourLabel: undefined })).toContain('EZ COLOUR KIV');
    expect(cartSummary({ ...sofa, colourLabel: undefined })).toContain('EZ / EZ002');
    expect(cartSummary({ ...sofa, colourLabel: undefined })).not.toContain('KIV');
    expect(cartSummary({ ...sofa, fabricId: undefined, fabricLabel: undefined, colourId: undefined, colourLabel: undefined })).not.toContain('KIV');
  });

  it('preserves a legacy bundle facing direction while listing each option once', () => {
    const summary = cartSummary({ ...sofa, cells: undefined, summary: '2+L · L shape · R-facing · 28" · EZ/EZ002' });
    expect(summary).toBe('2+L · L shape · R-facing · EZ / EZ002 / SEAT 28" / LEG 6"');
  });
});
