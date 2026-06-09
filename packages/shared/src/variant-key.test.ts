// Unit tests for the inventory variant-key (attribute composition) helper.
// The whole point is: identical physical attributes → identical key (same
// stock bucket); any difference → different key; legacy/empty → ''.

import { describe, it, expect } from 'vitest';
import { computeVariantKey, formatVariantKey } from './variant-key';

describe('computeVariantKey', () => {
  it('same sofa attributes produce the same key regardless of object order, case, or whitespace', () => {
    const a = computeVariantKey('sofa', { fabricCode: 'AVANI 01', seatHeight: '28', legHeight: '2' });
    const b = computeVariantKey('sofa', { legHeight: ' 2 ', seatHeight: '28', fabricCode: 'avani 01' });
    expect(a).toBe(b);
    expect(a).not.toBe('');
  });

  it('different sofa attribute → different key (separate bucket)', () => {
    const k28 = computeVariantKey('sofa', { fabricCode: 'AVANI01', seatHeight: '28', legHeight: '2' });
    const k30 = computeVariantKey('sofa', { fabricCode: 'AVANI01', seatHeight: '30', legHeight: '2' });
    expect(k28).not.toBe(k30);
  });

  it('sofa identity uses seat height; bedframe identity ignores seat size but uses gap/divan/leg/total', () => {
    // Seat size passed to a bedframe must NOT affect its key.
    const bf1 = computeVariantKey('bedframe', {
      fabricCode: 'BF-16', gap: '16', divanHeight: '6', legHeight: '2', totalHeight: '18', seatHeight: '28',
    });
    const bf2 = computeVariantKey('bedframe', {
      fabricCode: 'BF-16', gap: '16', divanHeight: '6', legHeight: '2', totalHeight: '18', seatHeight: '30',
    });
    expect(bf1).toBe(bf2); // seat size ignored for bedframe
    expect(bf1).toContain('gap=16');
    expect(bf1).toContain('totalheight=18');

    // A different gap → different bedframe bucket.
    const bf3 = computeVariantKey('bedframe', {
      fabricCode: 'BF-16', gap: '18', divanHeight: '6', legHeight: '2', totalHeight: '20',
    });
    expect(bf3).not.toBe(bf1);
  });

  it('special-order config is part of identity and order-independent', () => {
    const withSpecials = computeVariantKey('sofa', {
      fabricCode: 'AVANI01', seatHeight: '28', specials: ['Extra Firm', 'No Logo'],
    });
    const reordered = computeVariantKey('sofa', {
      fabricCode: 'AVANI01', seatHeight: '28', specials: ['No Logo', 'Extra Firm'],
    });
    const noSpecials = computeVariantKey('sofa', { fabricCode: 'AVANI01', seatHeight: '28' });
    expect(withSpecials).toBe(reordered); // order does not matter
    expect(withSpecials).not.toBe(noSpecials); // specials change the bucket
  });

  it('treats colorCode / colourCode as the fabric attribute (alias)', () => {
    // A line that stores its fabric pick as colorCode must bucket identically
    // to one that stores it as fabricCode.
    const viaFabric = computeVariantKey('bedframe', { fabricCode: 'Olive', divanHeight: '10"' });
    const viaColor  = computeVariantKey('bedframe', { colorCode: 'Olive', divanHeight: '10"' });
    expect(viaColor).toBe(viaFabric);
    expect(viaColor).toContain('fabriccode=olive');

    // Different colour → different bucket (the whole point of the fix).
    const olive = computeVariantKey('bedframe', { colorCode: 'Olive', divanHeight: '10"' });
    const rust  = computeVariantKey('bedframe', { colorCode: 'Rust', divanHeight: '10"' });
    expect(olive).not.toBe(rust);
  });

  it('treats fabricColor (GRN-family editor key) as the fabric attribute (alias)', () => {
    // GRN / PI / PR / Stock-Adjustment store the fabric pick as fabricColor — it
    // must bucket identically to the SO-side fabricCode so a received line and
    // its sales-order line share one variant bucket.
    const viaCode  = computeVariantKey('bedframe', { fabricCode: 'Olive', divanHeight: '10"', legHeight: '2', gap: '14' });
    const viaColor = computeVariantKey('bedframe', { fabricColor: 'Olive', divanHeight: '10"', legHeight: '2', gap: '14' });
    expect(viaColor).toBe(viaCode);
    expect(viaColor).toContain('fabriccode=olive');

    const sofaCode  = computeVariantKey('sofa', { fabricCode: 'AVANI01', seatHeight: '28', legHeight: '2' });
    const sofaColor = computeVariantKey('sofa', { fabricColor: 'AVANI01', seatHeight: '28', legHeight: '2' });
    expect(sofaColor).toBe(sofaCode);
  });

  it('mattress / accessory ignore soft attributes (size lives in the product code)', () => {
    // Mattress carries no soft-attribute identity → empty key (only specials matter).
    expect(computeVariantKey('mattress', { fabricCode: 'X', seatHeight: '28' })).toBe('');
    expect(computeVariantKey('accessory', { gap: '16' })).toBe('');
    expect(
      computeVariantKey('mattress', { specials: ['Custom Cover'] }),
    ).toBe('special=custom cover');
  });

  it('legacy / no attributes → empty key (unclassified bucket)', () => {
    expect(computeVariantKey('sofa', null)).toBe('');
    expect(computeVariantKey('sofa', {})).toBe('');
    expect(computeVariantKey(null, { fabricCode: 'AVANI01' })).toBe('');
    expect(computeVariantKey('sofa', { fabricCode: '', seatHeight: '  ', legHeight: null })).toBe('');
  });
});

describe('formatVariantKey', () => {
  it('turns a canonical key into a readable label', () => {
    const key = computeVariantKey('bedframe', {
      fabricCode: 'BF-16', gap: '16', divanHeight: '6', legHeight: '2', totalHeight: '18',
    });
    const label = formatVariantKey(key);
    expect(label).toContain('Fabric BF-16');
    expect(label).toContain('Gap 16');
    expect(label).toContain('Total H 18');
    expect(label).toContain(' · ');
  });

  it('empty / unclassified key → empty label', () => {
    expect(formatVariantKey('')).toBe('');
    expect(formatVariantKey(null)).toBe('');
    expect(formatVariantKey(undefined)).toBe('');
  });
});
