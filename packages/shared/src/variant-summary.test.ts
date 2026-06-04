// Unit tests for buildVariantSummary — the human-readable one-line variant
// string shared across POS, Backend, and Workers.

import { describe, it, expect } from 'vitest';
import { buildVariantSummary } from './variant-summary';

describe('buildVariantSummary', () => {
  it('sofa summary keeps seat SIZE and leg height as separate, labelled tokens', () => {
    // Commander 2026-05-29: seat size + leg height read as distinct tokens, and
    // every attribute uses ONE consistent ` / ` separator (no mixed ` · `).
    const summary = buildVariantSummary('sofa', {
      fabricCode: 'BF-17',
      seatHeight: '28',
      legHeight: '4"',
    });
    expect(summary).toContain('SEAT 28');
    expect(summary).toContain('LEG 4"');
    // One consistent ` / ` delimiter throughout: "BF-17 / SEAT 28 / LEG 4\"".
    expect(summary).toBe('BF-17 / SEAT 28 / LEG 4"');
    expect(summary).not.toContain(' · ');
    expect(summary).not.toContain('SEAT 28 4"');
  });

  it('sofa summary with only a seat size omits the leg token', () => {
    const summary = buildVariantSummary('sofa', { seatHeight: '26' });
    expect(summary).toContain('SEAT 26');
    expect(summary).not.toContain('LEG');
  });

  it('bedframe summary labels the leg height and shows the chosen colour', () => {
    // Loo 2026-06-03: leg height must read as a labelled "LEG x" token (not a
    // bare number glued to the divan), and the picked colour must appear.
    const summary = buildVariantSummary('bedframe', {
      fabricCode: 'BF-01',
      colourLabel: 'Sand',
      divanHeight: '10"',
      legHeight: '1"',
      gap: '10"',
      totalHeight: '21"',
    });
    expect(summary).toBe('BF-01 Sand / DIVAN 10" + LEG 1" / GAP 10" / T.Heights 21"');
  });

  it('bedframe leg height carries the LEG label even without a colour', () => {
    const summary = buildVariantSummary('bedframe', {
      divanHeight: '10"',
      legHeight: '2"',
      gap: '14"',
      totalHeight: '24"',
    });
    expect(summary).toContain('DIVAN 10" + LEG 2"');
    expect(summary).toContain('GAP 14"');
    expect(summary).toContain('T.Heights 24"');
  });

  it('bedframe "No Leg" reads without a redundant LEG prefix', () => {
    const summary = buildVariantSummary('bedframe', { divanHeight: '10"', legHeight: 'No Leg' });
    expect(summary).toBe('DIVAN 10" + NO LEG');
  });
});
