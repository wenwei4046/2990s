import { describe, expect, it } from 'vitest';
import { missingVariantAxes } from './so-variant-rule';

const missingKeys = (
  group: string | null | undefined,
  variants: Record<string, unknown> | null | undefined,
) => missingVariantAxes(group, variants).map((a) => a.key);

describe('missingVariantAxes — sofa', () => {
  it('REGRESSION 2026-06-04: a real POS handover sofa line passes (depth + sofaLegHeight + fabricCode)', () => {
    // Exact shape pos-handover-so.ts buildVariants() produces — this payload
    // 409'd `variants_incomplete` at the handover screen when the order
    // carried a Process Date, because the old rule only knew the Backend
    // keys (seatHeight / legHeight).
    const posSofa = {
      cells: [{ moduleId: '1A(LHF)', x: 0, y: 0 }, { moduleId: '2A(RHF)', x: 1, y: 0 }],
      depth: '30',
      fabricId: 'CG',
      fabricCode: 'CG-002',
      colourId: 'CG-002',
      sofaLegHeight: '1"',
    };
    expect(missingKeys('sofa', posSofa)).toEqual([]);
  });

  it('Backend coordinator sofa line still passes (seatHeight + legHeight + fabricCode)', () => {
    expect(missingKeys('sofa', { seatHeight: '28', legHeight: '4"', fabricCode: 'BF-01' }))
      .toEqual([]);
  });

  it('reports canonical keys when an axis has NO alias filled', () => {
    // Pre-#473 cart: no leg pick under either name → legHeight is genuinely
    // missing. Seat axis satisfied via depth.
    expect(missingKeys('sofa', { depth: '24', fabricCode: 'CG-002' }))
      .toEqual(['legHeight']);
    // Nothing at all → every axis reported under its Backend canonical key.
    expect(missingKeys('sofa', {})).toEqual(['seatHeight', 'legHeight', 'fabricCode']);
    expect(missingKeys('sofa', null)).toEqual(['seatHeight', 'legHeight', 'fabricCode']);
  });

  it('empty-string / whitespace alias values do NOT satisfy an axis', () => {
    expect(missingKeys('sofa', { depth: ' ', seatHeight: '', legHeight: '4"', fabricCode: 'X' }))
      .toEqual(['seatHeight']);
  });
});

describe('missingVariantAxes — bedframe', () => {
  it('POS bedframe line passes (gap + legHeight + divanHeight + fabricCode — Backend keys already)', () => {
    expect(missingKeys('bedframe', {
      sizeId: 'king', colourId: 'BF-01', fabricCode: 'BF-01',
      gap: '14"', legHeight: '4"', divanHeight: '10"',
    })).toEqual([]);
  });

  it('bedframe missing gap + divan reports both (divan-only models — known open case)', () => {
    expect(missingKeys('bedframe', { fabricCode: 'BF-01', legHeight: '4"' }))
      .toEqual(['divanHeight', 'gap']);
  });
});

describe('missingVariantAxes — categories without mandatory variants', () => {
  it.each(['mattress', 'accessory', 'others', 'service', '', null, undefined])(
    'group %s never reports missing axes',
    (group) => {
      expect(missingKeys(group as string | null | undefined, null)).toEqual([]);
    },
  );

  it('group casing is irrelevant', () => {
    expect(missingKeys('SOFA', { depth: '24', sofaLegHeight: 'No Leg', fabricCode: 'CG-1' }))
      .toEqual([]);
    expect(missingKeys('Bedframe', {})).toEqual(['divanHeight', 'legHeight', 'gap', 'fabricCode']);
  });
});
