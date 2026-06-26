import { describe, it, expect } from 'vitest';
import {
  RACE_OPTIONS, AGE_FRAMES, isValidRace, isValidAgeFrame, ageFrameLabel,
  GENDER_OPTIONS, isValidGender, ageFromBirthday, isValidBirthday,
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

describe('GENDER_OPTIONS / isValidGender', () => {
  it('exposes Male/Female/Others in order', () => {
    expect(GENDER_OPTIONS).toEqual(['Male', 'Female', 'Others']);
  });
  it('accepts known values, rejects everything else', () => {
    expect(isValidGender('Male')).toBe(true);
    expect(isValidGender('Female')).toBe(true);
    expect(isValidGender('Others')).toBe(true);
    expect(isValidGender('male')).toBe(false);
    expect(isValidGender('')).toBe(false);
    expect(isValidGender(null)).toBe(false);
  });
});

describe('ageFromBirthday', () => {
  const asOf = '2026-06-26';
  it('is one less before the birthday lands this year', () => {
    expect(ageFromBirthday('2000-12-31', asOf)).toBe(25);
  });
  it('ticks up on and after the birthday', () => {
    expect(ageFromBirthday('2000-06-26', asOf)).toBe(26);
    expect(ageFromBirthday('2000-01-01', asOf)).toBe(26);
  });
  it('handles leap-day births', () => {
    expect(ageFromBirthday('2004-02-29', '2026-02-28')).toBe(21);
    expect(ageFromBirthday('2004-02-29', '2026-03-01')).toBe(22);
  });
  it('returns null for malformed or impossible dates', () => {
    expect(ageFromBirthday('2021-02-29', asOf)).toBeNull(); // not a real date
    expect(ageFromBirthday('not-a-date', asOf)).toBeNull();
    expect(ageFromBirthday('', asOf)).toBeNull();
    expect(ageFromBirthday(null, asOf)).toBeNull();
  });
});

describe('isValidBirthday', () => {
  const asOf = '2026-06-26';
  it('accepts a plausible past date', () => {
    expect(isValidBirthday('1990-05-10', asOf)).toBe(true);
  });
  it('rejects future dates', () => {
    expect(isValidBirthday('2027-01-01', asOf)).toBe(false);
  });
  it('rejects implausible ages (>120) and bad formats', () => {
    expect(isValidBirthday('1900-01-01', asOf)).toBe(false);
    expect(isValidBirthday('1990/05/10', asOf)).toBe(false);
    expect(isValidBirthday('1990-13-01', asOf)).toBe(false);
    expect(isValidBirthday(null, asOf)).toBe(false);
  });
});
