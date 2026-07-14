import { describe, expect, it } from 'vitest';
import { SA_HEX, entityColor, orderBuckets } from './entity-colors';

describe('entityColor', () => {
  it("'Unknown' is ALWAYS the neutral, in every dim", () => {
    for (const dim of ['race', 'gender', 'newReturning', 'category'] as const) {
      expect(entityColor(dim, 'Unknown')).toBe(SA_HEX.unknown);
    }
  });

  it('is stable per entity (color follows the entity, never the rank)', () => {
    expect(entityColor('race', 'Malay')).toBe(SA_HEX.c1);
    expect(entityColor('race', 'Chinese')).toBe(SA_HEX.c4);
    expect(entityColor('race', 'Indian')).toBe(SA_HEX.c2);
    expect(entityColor('race', 'Others')).toBe(SA_HEX.c3);
    expect(entityColor('gender', 'Male')).toBe(SA_HEX.c4);
    expect(entityColor('gender', 'Female')).toBe(SA_HEX.c1);
    expect(entityColor('newReturning', 'New')).toBe(SA_HEX.c4);
    expect(entityColor('newReturning', 'Returning')).toBe(SA_HEX.c1);
    expect(entityColor('category', 'SOFA')).toBe(SA_HEX.c1);
    expect(entityColor('category', 'ACCESSORY')).toBe(SA_HEX.c4);
  });

  it('unexpected keys fall back to the warm charcoal', () => {
    expect(entityColor('race', 'Eurasian')).toBe(SA_HEX.c5);
    expect(entityColor('category', 'SERVICE')).toBe(SA_HEX.c5);
  });
});

describe('orderBuckets', () => {
  it('reorders race buckets into RACE_OPTIONS order, Unknown last', () => {
    const out = orderBuckets('race', [
      { key: 'Chinese', count: 20 },
      { key: 'Unknown', count: 3 },
      { key: 'Malay', count: 10 },
      { key: 'Indian', count: 5 },
    ]);
    expect(out.map((b) => b.key)).toEqual(['Malay', 'Chinese', 'Indian', 'Unknown']);
  });

  it('reorders gender buckets into GENDER_OPTIONS order', () => {
    const out = orderBuckets('gender', [
      { key: 'Female', count: 9 },
      { key: 'Male', count: 4 },
    ]);
    expect(out.map((b) => b.key)).toEqual(['Male', 'Female']);
  });

  it('reorders newReturning into New, Returning', () => {
    const out = orderBuckets('newReturning', [
      { key: 'Returning', count: 5 },
      { key: 'New', count: 2 },
    ]);
    expect(out.map((b) => b.key)).toEqual(['New', 'Returning']);
  });

  it('drops zero-count buckets', () => {
    const out = orderBuckets('race', [
      { key: 'Malay', count: 0 },
      { key: 'Chinese', count: 2 },
      { key: 'Unknown', count: 0 },
    ]);
    expect(out).toEqual([{ key: 'Chinese', count: 2 }]);
  });

  it('puts unexpected keys after canonical ones, count desc, before Unknown', () => {
    const out = orderBuckets('race', [
      { key: 'Sikh', count: 4 },
      { key: 'Unknown', count: 1 },
      { key: 'Eurasian', count: 7 },
      { key: 'Malay', count: 2 },
    ]);
    expect(out.map((b) => b.key)).toEqual(['Malay', 'Eurasian', 'Sikh', 'Unknown']);
  });

  it('category is NOT reordered (caller pre-sorts by revenue)', () => {
    const out = orderBuckets('category', [
      { key: 'MATTRESS', count: 200 },
      { key: 'SOFA', count: 100 },
      { key: 'ACCESSORY', count: 0 },
    ]);
    expect(out.map((b) => b.key)).toEqual(['MATTRESS', 'SOFA']);
  });

  it('handles empty input and does not mutate the input', () => {
    expect(orderBuckets('gender', [])).toEqual([]);
    const input = [{ key: 'Female', count: 3 }, { key: 'Male', count: 1 }];
    const snapshot = JSON.stringify(input);
    orderBuckets('gender', input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
