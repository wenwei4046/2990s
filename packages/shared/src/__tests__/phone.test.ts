import { describe, it, expect } from 'vitest';
import { normalizePhone, formatPhone, isValidMalaysianPhone } from '../phone';

describe('normalizePhone', () => {
  it('keeps an already-E.164 +60 mobile (10-digit local) as-is', () => {
    // 12 digits after +: "60" + "1161556133". Storage form is the input minus
    // the human formatting noise.
    expect(normalizePhone('+601161556133')).toBe('+601161556133');
  });

  it('converts a Malaysian local form (leading 0) to E.164', () => {
    expect(normalizePhone('0161556133')).toBe('+60161556133');
  });

  it('converts a Malaysian landline local form (leading 0) to E.164', () => {
    expect(normalizePhone('0316155633')).toBe('+60316155633');
  });

  it('strips spaces, dashes, parens and re-emits E.164', () => {
    // Task spec example: "+60 11-6155 6133" round-trips through the formatter.
    // The task spec text had a typo ("+60116155633", missing one digit) — the
    // actual correct round-trip is "+601161556133" so storage stays lossless.
    expect(normalizePhone('+60 11-6155 6133')).toBe('+601161556133');
    expect(normalizePhone('(011) 6155-6133')).toBe('+601161556133');
  });

  it('treats 8+ bare digits as Malaysian (prepends 60)', () => {
    expect(normalizePhone('161556133')).toBe('+60161556133');
  });

  it('returns null for empty / whitespace / too-short input', () => {
    expect(normalizePhone('')).toBe(null);
    expect(normalizePhone(null)).toBe(null);
    expect(normalizePhone(undefined)).toBe(null);
    expect(normalizePhone('123')).toBe(null);
    expect(normalizePhone('   ')).toBe(null);
  });
});

describe('formatPhone', () => {
  it('formats a 10-digit Malaysian mobile (prefix-style "11")', () => {
    expect(formatPhone('+601161556133')).toBe('+60 11-6155 6133');
  });

  it('formats a 9-digit Malaysian mobile (older "16" carrier)', () => {
    expect(formatPhone('+60161556133')).toBe('+60 16-155 6133');
  });

  it('formats a 9-digit Malaysian landline (KL "3")', () => {
    expect(formatPhone('+60316155633')).toBe('+60 3-1615 5633');
  });

  it('returns empty string for nullish input', () => {
    expect(formatPhone('')).toBe('');
    expect(formatPhone(null)).toBe('');
    expect(formatPhone(undefined)).toBe('');
  });

  it('falls back to raw input for unrecognised / non-MY format', () => {
    expect(formatPhone('+6512345678')).toBe('+6512345678'); // Singapore
    expect(formatPhone('not-a-number')).toBe('not-a-number');
  });

  it('formats correctly after a round-trip through normalizePhone', () => {
    const stored = normalizePhone('011 6155 6133');
    expect(stored).toBe('+601161556133');
    expect(formatPhone(stored)).toBe('+60 11-6155 6133');
  });
});

describe('isValidMalaysianPhone', () => {
  it('accepts a valid 10-digit-local mobile', () => {
    expect(isValidMalaysianPhone('+601161556133')).toBe(true);
  });

  it('accepts a valid 9-digit-local mobile', () => {
    expect(isValidMalaysianPhone('+60161556133')).toBe(true);
  });

  it('rejects landlines (not mobile)', () => {
    expect(isValidMalaysianPhone('+60316155633')).toBe(false);
  });

  it('rejects empty / nullish / short input', () => {
    expect(isValidMalaysianPhone('')).toBe(false);
    expect(isValidMalaysianPhone(null)).toBe(false);
    expect(isValidMalaysianPhone(undefined)).toBe(false);
    expect(isValidMalaysianPhone('+6011')).toBe(false);
  });

  it('rejects non-MY country codes', () => {
    expect(isValidMalaysianPhone('+6512345678')).toBe(false);
  });
});
