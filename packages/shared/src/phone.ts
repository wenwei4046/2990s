// Phone format helpers. Storage = E.164 ("+60116155633"),
// display = pretty Malaysian convention ("+60 11-6155 6133").
//
// Commander 2026-05-27 (Task #91): "电话format 要统一".
// Phones were previously stored / displayed inconsistently across the app —
// some "+601161556133" (E.164 no spaces), some "0123456789", some
// "+60 12-345 6789". This module is the SOLE source of truth for both
// directions of the conversion. UI inputs normalize on change, display
// callsites format on render, and the API normalizes defensively on
// POST/PATCH so the DB only ever holds the canonical E.164 form.
//
// Design constraint: no libphonenumber-js (200KB+). Pure regex + slice.
// Fallback: if the stored string doesn't match a recognised Malaysian
// pattern (e.g. legacy / international), we return it as-is rather than
// mangle it.

/** Strip every character except digits. `+` is reinjected after we decide
 *  whether the input had a country code. */
const onlyDigits = (s: string): string => s.replace(/\D+/g, '');

/**
 * Normalize a user-typed phone string to E.164 storage form.
 *  - strips spaces, dashes, parens, plus signs
 *  - if starts with `60` keeps it
 *  - if starts with `0` replaces with `60` (Malaysian local form)
 *  - if 8+ digits with no country code prefix, prepends `60`
 *  - returns `+<digits>` or null when input is empty / less than 7 digits
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = onlyDigits(String(raw));
  if (digits.length === 0) return null;

  let normalized: string;
  if (digits.startsWith('60')) {
    normalized = digits;
  } else if (digits.startsWith('0')) {
    // Malaysian local form: drop the leading 0 and prepend 60.
    normalized = '60' + digits.slice(1);
  } else if (digits.length >= 8) {
    // Bare 8+ digits with no country code — assume Malaysia.
    normalized = '60' + digits;
  } else {
    // Too short to be a real phone number (likely mid-typing).
    return null;
  }

  // After normalization we should have at least 7 total digits to be plausible.
  if (normalized.length < 7) return null;

  return '+' + normalized;
}

/**
 * Format a stored E.164 phone for display. Falls back to raw input
 * if not a recognised Malaysian pattern.
 *
 * Mobile (Malaysia): "+60 11-6155 6133" — country + space + first digit-block
 *                    after `60` (1–2 digits ending the carrier prefix `1X`) +
 *                    dash + 4-digit + space + 4-digit. 9–10 local digits.
 * Landline (Malaysia): "+60 3-1234 5678" — country + space + state code (1–2
 *                      digits) + dash + 4 + space + 4. 8–9 local digits.
 */
export function formatPhone(stored: string | null | undefined): string {
  if (stored == null) return '';
  const raw = String(stored).trim();
  if (raw === '') return '';

  const digits = onlyDigits(raw);
  if (digits.length === 0) return raw;

  // Only attempt the Malaysian formatter for +60 numbers. Anything else
  // (rare non-MY entries, half-typed input) gets returned untouched so we
  // don't garble it.
  if (!digits.startsWith('60')) return raw;

  const local = digits.slice(2); // strip "60"

  // Mobile: starts with `1`, total local length 9 or 10.
  // E.g. "1161556133" (10) → "11-6155 6133"
  //      "161556133"  (9)  → "16-155 6133" — we still want the dash after the
  //      carrier digit-block. Malaysian mobile prefix is `1X` (`X` = digit),
  //      so for a 9-digit local we group "16-1556 133"? — actually Maxis-era
  //      9-digit numbers are formatted as `1X-XXX XXXX`: take the first 2
  //      after `60` as the prefix, then 3 + 4. For 10-digit (e.g. 11-xxxx-
  //      xxxx) it's `1X-XXXX XXXX`: prefix 2, then 4 + 4.
  if (local.startsWith('1')) {
    if (local.length === 10) {
      // 11-6155 6133 pattern
      const prefix = local.slice(0, 2);
      const mid = local.slice(2, 6);
      const tail = local.slice(6);
      return `+60 ${prefix}-${mid} ${tail}`;
    }
    if (local.length === 9) {
      // 16-155 6133 pattern (older 9-digit mobile)
      const prefix = local.slice(0, 2);
      const mid = local.slice(2, 5);
      const tail = local.slice(5);
      return `+60 ${prefix}-${mid} ${tail}`;
    }
    // Unrecognised mobile length — give up, return raw.
    return raw;
  }

  // Landline: starts with state digit `3` (KL/Selangor), `4` (Penang),
  // `7` (Johor), etc. Local digits 8 or 9 total.
  // E.g. "316155633" (9) → "3-1615 5633" — single state digit + 4 + 4
  //      "31234567" (8)  → "3-123 4567" — single state digit + 3 + 4
  if (local.length === 9) {
    const state = local.slice(0, 1);
    const mid = local.slice(1, 5);
    const tail = local.slice(5);
    return `+60 ${state}-${mid} ${tail}`;
  }
  if (local.length === 8) {
    const state = local.slice(0, 1);
    const mid = local.slice(1, 4);
    const tail = local.slice(4);
    return `+60 ${state}-${mid} ${tail}`;
  }

  // Anything else (too short / too long for MY) — leave alone.
  return raw;
}

/**
 * Validate that a phone is a usable Malaysian mobile (+60 1x ... where
 * total digits 11-12). Returns true / false.
 */
export function isValidMalaysianPhone(stored: string | null | undefined): boolean {
  if (stored == null) return false;
  const digits = onlyDigits(String(stored));
  if (digits.length < 11 || digits.length > 12) return false;
  if (!digits.startsWith('60')) return false;
  const local = digits.slice(2);
  if (!local.startsWith('1')) return false;
  return local.length === 9 || local.length === 10;
}
