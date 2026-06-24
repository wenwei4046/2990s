import { describe, it, expect } from 'vitest';
import {
  RACE_OPTIONS, AGE_FRAMES, isValidRace, isValidAgeFrame, ageFrameLabel,
} from './customer-demographics';

describe('customer-demographics', () => {
  it('exposes the four race options in order', () => {
    expect(RACE_OPTIONS).toEqual(['Malay', 'Chinese', 'Indian', 'Others']);
  });

  it('exposes five non-overlapping age-frame codes in order', () => {
    expect(AGE_FRAMES.map((a) => a.code)).toEqual([
      'below_18', '18_25', '26_35', '36_45', 'above_45',
    ]);
  });

  it('isValidRace accepts known races and rejects anything else', () => {
    expect(isValidRace('Chinese')).toBe(true);
    expect(isValidRace('Martian')).toBe(false);
    expect(isValidRace('')).toBe(false);
    expect(isValidRace(null)).toBe(false);
  });

  it('isValidAgeFrame accepts codes and rejects labels/others', () => {
    expect(isValidAgeFrame('26_35')).toBe(true);
    expect(isValidAgeFrame('26-35')).toBe(false);
    expect(isValidAgeFrame('26–35')).toBe(false);
    expect(isValidAgeFrame(undefined)).toBe(false);
  });

  it('ageFrameLabel maps code → label and returns "" for unknown/empty', () => {
    expect(ageFrameLabel('18_25')).toBe('18–25');
    expect(ageFrameLabel('nope')).toBe('');
    expect(ageFrameLabel(null)).toBe('');
  });
});
