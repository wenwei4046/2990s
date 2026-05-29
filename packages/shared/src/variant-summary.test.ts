// Unit tests for buildVariantSummary — the human-readable one-line variant
// string shared across POS, Backend, and Workers.

import { describe, it, expect } from 'vitest';
import { buildVariantSummary } from './variant-summary';

describe('buildVariantSummary', () => {
  it('sofa summary keeps seat SIZE and leg height as separate, labelled tokens', () => {
    // Commander 2026-05-29: seat size and leg height used to mash together
    // ("SEAT 28 4\"") — they must read as two distinct tokens now.
    const summary = buildVariantSummary('sofa', {
      fabricCode: 'BF-17',
      seatHeight: '28',
      legHeight: '4"',
    });
    expect(summary).toContain('SEAT 28');
    expect(summary).toContain('LEG 4"');
    // The two attributes are split by the shared ` · ` delimiter, not a bare space.
    expect(summary).toContain('SEAT 28 · LEG 4"');
    expect(summary).not.toContain('SEAT 28 4"');
  });

  it('sofa summary with only a seat size omits the leg token', () => {
    const summary = buildVariantSummary('sofa', { seatHeight: '26' });
    expect(summary).toContain('SEAT 26');
    expect(summary).not.toContain('LEG');
  });

  it('bedframe summary still renders DIVAN + LEG / GAP / T.Heights', () => {
    const summary = buildVariantSummary('bedframe', {
      divanHeight: '10"',
      legHeight: '2"',
      gap: '14"',
      totalHeight: '24"',
    });
    expect(summary).toContain('DIVAN 10" + 2"');
    expect(summary).toContain('GAP 14"');
    expect(summary).toContain('T.Heights 24"');
  });
});
