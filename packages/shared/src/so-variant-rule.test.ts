import { describe, expect, it } from 'vitest';
import { canonicalizeVariants, missingVariantAxes } from './so-variant-rule';

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

  it('fabric axis satisfied by the GRN-family fabricColor key (sofa + bedframe)', () => {
    // GRN / PI / PR / Stock-Adjustment store fabric under fabricColor — it must
    // satisfy the Fabrics axis, else a received sofa/bedframe never counts as
    // fabric-complete even though the operator filled it.
    expect(missingKeys('sofa', { seatHeight: '28', legHeight: '4"', fabricColor: 'AVANI01' }))
      .toEqual([]);
    expect(missingKeys('bedframe', { divanHeight: '10"', legHeight: '2', gap: '14', fabricColor: 'BF-01' }))
      .toEqual([]);
  });

  it('reports canonical keys when an axis has NO alias filled', () => {
    // sofa legHeight is `required: false` (aligned to Houzs 2026-07-22 —
    // always defaults to "Default RM 0", so it must never gate Confirm).
    // Only seatHeight + fabricCode remain required for sofa.
    expect(missingKeys('sofa', { depth: '24', fabricCode: 'CG-002' }))
      .toEqual([]);
    expect(missingKeys('sofa', {})).toEqual(['seatHeight', 'fabricCode']);
    expect(missingKeys('sofa', null)).toEqual(['seatHeight', 'fabricCode']);
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

describe('canonicalizeVariants — POS sofa keys → editor canonical keys', () => {
  it('REGRESSION 2026-06-08: a POS sofa line prefills the Edit modal (depth → seatHeight, sofaLegHeight → legHeight)', () => {
    // The exact failure Loo hit: editing a POS-created sofa SO left Seat Height
    // and Leg Height blank because the dropdowns read seatHeight / legHeight but
    // the line stored depth / sofaLegHeight. fabricCode shares one key, so only
    // those two axes were blank.
    const out = canonicalizeVariants('sofa', {
      depth: '24', sofaLegHeight: '1"', fabricCode: 'EZ-006', cells: [{ moduleId: '1A' }],
    });
    expect(out.seatHeight).toBe('24');
    expect(out.legHeight).toBe('1"');
    expect(out.fabricCode).toBe('EZ-006');
    // alias keys removed so a later edit of the canonical value isn't shadowed
    // by a stale alias in `depth ?? seatHeight` consumers.
    expect('depth' in out).toBe(false);
    expect('sofaLegHeight' in out).toBe(false);
    // unrelated keys pass through untouched.
    expect(out.cells).toEqual([{ moduleId: '1A' }]);
  });

  it('Backend-keyed sofa line is unchanged', () => {
    const input = { seatHeight: '28', legHeight: '4"', fabricCode: 'BF-01' };
    expect(canonicalizeVariants('sofa', input)).toEqual(input);
  });

  it('canonical value wins when both canonical and alias are present', () => {
    const out = canonicalizeVariants('sofa', { seatHeight: '28', depth: '24', fabricCode: 'X' });
    expect(out.seatHeight).toBe('28');
    expect('depth' in out).toBe(false);
  });

  it('empty alias does not overwrite, and is still removed', () => {
    const out = canonicalizeVariants('sofa', { depth: '  ', legHeight: '4"', fabricCode: 'X' });
    expect('depth' in out).toBe(false);
    expect('seatHeight' in out).toBe(false); // empty alias contributed nothing
    expect(out.legHeight).toBe('4"');
  });

  it('bedframe / mattress / unknown / null pass through untouched', () => {
    const bf = { divanHeight: '10"', legHeight: '4"', gap: '14"', fabricCode: 'BF-01' };
    expect(canonicalizeVariants('bedframe', bf)).toEqual(bf);
    expect(canonicalizeVariants('mattress', { size: 'Queen' })).toEqual({ size: 'Queen' });
    expect(canonicalizeVariants('others', { foo: 'bar' })).toEqual({ foo: 'bar' });
    expect(canonicalizeVariants('sofa', null)).toEqual({});
    expect(canonicalizeVariants(null, null)).toEqual({});
  });
});
