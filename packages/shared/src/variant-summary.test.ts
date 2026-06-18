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

  it('shows the GRN-family fabricColor key as the fabric segment', () => {
    // A sofa received via GRN/PI/PR stores its fabric under fabricColor; the
    // summary must still surface it (was dropped before the alias fix).
    const summary = buildVariantSummary('sofa', { fabricColor: 'AVANI01', seatHeight: '28' });
    expect(summary).toContain('AVANI01');
    // fabricCode still wins when both are present (canonical first).
    expect(buildVariantSummary('sofa', { fabricCode: 'BF-17', fabricColor: 'AVANI01', seatHeight: '28' }))
      .toContain('BF-17');
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

  it('bedframe does not repeat the fabric when the colour label is the code itself', () => {
    // BF-07's colour label is also "BF-07" — must not render "BF-07 BF-07".
    const summary = buildVariantSummary('bedframe', {
      fabricCode: 'BF-07',
      colourLabel: 'BF-07',
      divanHeight: '10"',
      legHeight: '2"',
      gap: '9"',
    });
    expect(summary).toBe('BF-07 / DIVAN 10" + LEG 2" / GAP 9"');
  });

  it('bedframe does not repeat the bare colour label after an ENRICHED fabric code', () => {
    // The doc layer enriches fabricCode to "BF-12 (PC151-12)"; the bare colour
    // label "BF-12" must not tack on again → "BF-12 (PC151-12) BF-12".
    const summary = buildVariantSummary('bedframe', {
      fabricCode: 'BF-12 (PC151-12)',
      colourLabel: 'BF-12',
      divanHeight: '8"',
      legHeight: '2"',
      gap: '11"',
    });
    expect(summary).toBe('BF-12 (PC151-12) / DIVAN 8" + LEG 2" / GAP 11"');
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

  /* Loo 2026-06-13 — the POS product-page "special add-on" (note + extra charge,
     variants.extraAddonNote + extraAddonAmountRM) is a free-text Special Add-on.
     With money attached it renders inside the SPECIAL segment, next to the picked
     add-ons. The item remark (variants.remark) is SEPARATE: it never enters the
     SPECIAL segment — it prints as its own "Remark:" line off the .remark column. */
  // Loo 2026-06-15 — the add-on AMOUNT is no longer shown in the summary (it is
  // already folded into the line price); the SPECIAL segment keeps only the note.
  it('a special add-on note + extra charge renders the note (no RM figure) in the SPECIAL segment', () => {
    const summary = buildVariantSummary('bedframe', {
      divanHeight: '10"',
      specials: ['Divan Fully Cover'],
      extraAddonNote: 'Custom side pocket',
      extraAddonAmountRM: 200,
    });
    expect(summary).toContain('SPECIAL: Divan Fully Cover + Custom side pocket');
    expect(summary).not.toContain('RM');
  });

  it('an extra charge without a note renders a generic SPECIAL entry, no RM figure', () => {
    const summary = buildVariantSummary('bedframe', { divanHeight: '10"', extraAddonAmountRM: 150 });
    expect(summary).toContain('SPECIAL: Extra add-on');
    expect(summary).not.toContain('RM');
  });

  it('a note WITHOUT money also renders in the SPECIAL segment, bare', () => {
    const summary = buildVariantSummary('bedframe', { divanHeight: '10"', extraAddonNote: 'Deliver before noon' });
    expect(summary).toBe('DIVAN 10" / SPECIAL: Deliver before noon');
  });

  it('the item remark (variants.remark) never enters the SPECIAL segment (Loo 2026-06-13)', () => {
    const summary = buildVariantSummary('bedframe', { divanHeight: '10"', remark: 'Handle this item with care' });
    expect(summary).toBe('DIVAN 10"');
  });

  /* Colour KIV (Loo 2026-06-12) — the customer commits to a fabric SERIES
     (tier add-on charged) but confirms the colour later: variants carry
     fabricId + fabricLabel and NO fabricCode. The doc line must surface the
     series + the open colour instead of silently dropping the fabric. */
  it('sofa with a fabric series but no colour reads "<series> COLOUR KIV"', () => {
    const summary = buildVariantSummary('sofa', {
      fabricId: 'aaaa-bbbb', fabricLabel: 'EZ', depth: '24', sofaLegHeight: '6"',
    });
    expect(summary).toBe('EZ COLOUR KIV / SEAT 24 / LEG 6"');
  });

  it('bedframe with a fabric series but no colour reads "<series> COLOUR KIV"', () => {
    const summary = buildVariantSummary('bedframe', {
      fabricId: 'aaaa-bbbb', fabricLabel: 'BF', divanHeight: '10"', legHeight: '2"',
    });
    expect(summary).toBe('BF COLOUR KIV / DIVAN 10" + LEG 2"');
  });

  it('a filled colour wins over the KIV fallback (fabricLabel rides along)', () => {
    const summary = buildVariantSummary('sofa', {
      fabricId: 'aaaa-bbbb', fabricLabel: 'EZ', fabricCode: 'EZ-003', seatHeight: '28',
    });
    expect(summary).toBe('EZ-003 / SEAT 28');
    expect(summary).not.toContain('KIV');
  });

  /* Free Item Campaign (migration 0176, 2026-06-17) — a line whose
     variants.freeItem.campaignId is set (stamped server-side by Task 5) must
     show "FREE · <campaign name>" as the last segment on every customer doc.
     When the campaign name is blank, it degrades to just "FREE". A normal line
     (no freeItem key) must not show either token. */
  it('a free-item line appends "FREE · <name>" when a campaign name is present', () => {
    const summary = buildVariantSummary('accessory', {
      freeItem: { campaignId: 'june-2026', campaignName: 'Raya Promo' },
    });
    expect(summary).toBe('FREE · Raya Promo');
  });

  it('a free-item line without a campaign name degrades to "FREE"', () => {
    const summary = buildVariantSummary('accessory', {
      freeItem: { campaignId: 'june-2026', campaignName: null },
    });
    expect(summary).toBe('FREE');
  });

  it('a free-item line with other segments puts FREE last', () => {
    const summary = buildVariantSummary('accessory', {
      freeItem: { campaignId: 'june-2026', campaignName: 'Mid-Year Sale' },
      specials: ['Extra Padding'],
    });
    expect(summary).toBe('SPECIAL: Extra Padding / FREE · Mid-Year Sale');
  });

  it('a normal accessory line (no freeItem) does not show FREE', () => {
    const summary = buildVariantSummary('accessory', { specials: ['Plush Cover'] });
    expect(summary).not.toContain('FREE');
  });

  it('a line with freeItem but no campaignId is not a free-item line (isFreeItemLine guard)', () => {
    const summary = buildVariantSummary('accessory', {
      freeItem: { campaignName: 'Orphan' },
    });
    expect(summary).not.toContain('FREE');
  });
});
