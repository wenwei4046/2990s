import { describe, it, expect } from 'vitest';
import { remarkSlug, oneShotSofaCode, oneShotSimpleCode, buildOneShotName } from './one-shot-sku';

describe('remarkSlug', () => {
  it('uppercases and dash-joins alphanumerics', () => {
    expect(remarkSlug('Seat Extend 40cm')).toBe('SEAT-EXTEND-40CM');
  });
  it('collapses punctuation runs and trims edge dashes', () => {
    expect(remarkSlug('  extend++40 cm!! ')).toBe('EXTEND-40-CM');
  });
  it('caps at 40 chars and never ends on a dash', () => {
    const s = remarkSlug('a'.repeat(60));
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('oneShotSofaCode — normalized parens form (D6)', () => {
  it('produces a canonical, Phase-2-stable code', () => {
    expect(oneShotSofaCode('ANNSA', '1A(LHF)', 'SEAT-EXTEND-40CM'))
      .toBe('ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)');
  });
  it('collision suffix stays inside the normalization (no stray dash)', () => {
    expect(oneShotSofaCode('ANNSA', '1A(LHF)', 'SEAT-EXTEND-40CM', 2))
      .toBe('ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)(2)');
  });
  it('uppercases a lowercase model code', () => {
    expect(oneShotSofaCode('annsa', '2A(RHF)', 'WIDE')).toBe('ANNSA-2A(RHF)(WIDE)');
  });
});

describe('oneShotSimpleCode — mattress/bedframe (no compartment axis)', () => {
  it('suffixes the base SKU code with the slug', () => {
    expect(oneShotSimpleCode('2990 AKKA-FIRM MATT (Q)', 'EXTEND-5CM'))
      .toBe('2990 AKKA-FIRM MATT (Q)-EXTEND-5CM');
  });
  it('appends a collision counter', () => {
    expect(oneShotSimpleCode('1003-(K)', 'TALLER', 3)).toBe('1003-(K)-TALLER-3');
  });
});

describe('buildOneShotName', () => {
  it('appends the remark in parentheses', () => {
    expect(buildOneShotName('SOFA ANNSA 1A(LHF)', 'Seat Extend 40cm'))
      .toBe('SOFA ANNSA 1A(LHF) (Seat Extend 40cm)');
  });
  it('returns the base name unchanged when remark is empty', () => {
    expect(buildOneShotName('SOFA ANNSA 1A(LHF)', '  ')).toBe('SOFA ANNSA 1A(LHF)');
  });
});
