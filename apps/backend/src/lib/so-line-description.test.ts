import { describe, it, expect } from 'vitest';
import { composeSoLineDescription } from './so-line-description';

/* Loo 2026-06-13 — the backend SO PDF printed the variant summary TWICE on a
   split-sofa module line (the stored description2 AND the recomputed specs are
   both buildVariantSummary). The variant summary (incl. SPECIAL) must appear
   exactly once per SKU line. */
describe('composeSoLineDescription', () => {
  it('prints the variant summary ONCE when description2 === specs (the bug)', () => {
    const lines = composeSoLineDescription({
      description: 'SOFA ANNSA 1A(LHF)',
      description2: 'SEAT 28 / SPECIAL: try speical add on (+RM300)',
      specs: 'SEAT 28 / SPECIAL: try speical add on (+RM300)',
      remark: 'try item remark',
      notes: ['PWP voucher issued: PWP-3864IOLG · not redeemed yet'],
    });
    expect(lines.filter((l) => l.includes('SPECIAL: try speical add on'))).toHaveLength(1);
    expect(lines).toEqual([
      'SOFA ANNSA 1A(LHF)',
      'SEAT 28 / SPECIAL: try speical add on (+RM300)',
      'PWP voucher issued: PWP-3864IOLG · not redeemed yet',
      'Remark: try item remark',
    ]);
  });

  it('prefers specs (fabric-expanded) over the stored description2', () => {
    const lines = composeSoLineDescription({
      description: 'SOFA ANNSA 1A(LHF)',
      description2: 'BF-07 / SEAT 28 / SPECIAL: x (+RM300)',
      specs: 'BF-07 — PC151-07 / SEAT 28 / SPECIAL: x (+RM300)',
      remark: null,
    });
    expect(lines.filter((l) => l.includes('SPECIAL: x'))).toHaveLength(1);
    expect(lines[1]).toBe('BF-07 — PC151-07 / SEAT 28 / SPECIAL: x (+RM300)');
  });

  it('falls back to description2 when there is no recomputed specs (no-variant line)', () => {
    const lines = composeSoLineDescription({
      description: 'Cross-category delivery',
      description2: '',
      specs: '',
      remark: 'Follow-up of SO-2606-011',
    });
    // No variant summary → the remark stands in as the second line (not a
    // separate "Remark:" line).
    expect(lines).toEqual(['Cross-category delivery', 'Follow-up of SO-2606-011']);
  });

  it('suppresses the separate Remark line when the summary already contains it (legacy rows)', () => {
    const lines = composeSoLineDescription({
      description: 'SOFA X',
      description2: '',
      specs: 'SEAT 28 / SPECIAL: old combined remark',
      remark: 'old combined remark',
    });
    expect(lines.filter((l) => l.startsWith('Remark:'))).toHaveLength(0);
    expect(lines).toEqual(['SOFA X', 'SEAT 28 / SPECIAL: old combined remark']);
  });

  it('item remark prints as its own line when the summary does not contain it', () => {
    const lines = composeSoLineDescription({
      description: 'BARON BEDFRAME',
      description2: 'DIVAN 10" / SPECIAL: going fun (+RM200)',
      specs: 'DIVAN 10" / SPECIAL: going fun (+RM200)',
      remark: 'trying',
    });
    expect(lines).toEqual([
      'BARON BEDFRAME',
      'DIVAN 10" / SPECIAL: going fun (+RM200)',
      'Remark: trying',
    ]);
  });
});
