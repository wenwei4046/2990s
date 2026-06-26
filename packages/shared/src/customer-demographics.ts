// customer-demographics — race + age-frame vocabulary for the POS customer
// capture step and the Sales Analysis marketing list (single source of truth).
// Stored on the SO snapshot (mfg_sales_orders.customer_race / customer_age_frame),
// mirroring the emergency-contact precedent. Captured at handover (REQUIRED for
// NEW customers), never shown on the SO/PDF — collected for marketing analysis.

export const RACE_OPTIONS = ['Malay', 'Chinese', 'Indian', 'Others'] as const;
export type Race = (typeof RACE_OPTIONS)[number];

/** Age band the salesperson picks at handover. We store the stable CODE (not a
 *  birthdate / computed age); the label is derived for display so relabelling
 *  never migrates data. Buckets are non-overlapping. */
export const AGE_FRAMES = [
  { code: 'below_18', label: 'Below 18' },
  { code: '18_25', label: '18–25' },
  { code: '26_35', label: '26–35' },
  { code: '36_45', label: '36–45' },
  { code: 'above_45', label: 'Above 45' },
] as const;
export type AgeFrameCode = (typeof AGE_FRAMES)[number]['code'];

const RACE_SET = new Set<string>(RACE_OPTIONS);
const AGE_FRAME_SET = new Set<string>(AGE_FRAMES.map((a) => a.code));

export function isValidRace(v: unknown): v is Race {
  return typeof v === 'string' && RACE_SET.has(v);
}

export function isValidAgeFrame(v: unknown): v is AgeFrameCode {
  return typeof v === 'string' && AGE_FRAME_SET.has(v);
}

/** Human label for a stored age-frame code; '' for unknown/empty. */
export function ageFrameLabel(code: string | null | undefined): string {
  return AGE_FRAMES.find((a) => a.code === code)?.label ?? '';
}

export const GENDER_OPTIONS = ['Male', 'Female', 'Others'] as const;
export type Gender = (typeof GENDER_OPTIONS)[number];
const GENDER_SET = new Set<string>(GENDER_OPTIONS);

export function isValidGender(v: unknown): v is Gender {
  return typeof v === 'string' && GENDER_SET.has(v);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Device-local today as ISO YYYY-MM-DD (Malaysia UTC+8 on the tablets). The
 *  age derivations compare device-local on purpose, mirroring the handover
 *  no-past-dates rule. */
function todayIsoLocal(): string {
  return new Date().toLocaleDateString('en-CA');
}

/** Exact integer age from an ISO birthday as of `asOf` (default today). Returns
 *  null for malformed or impossible calendar input. Calendar comparison (no
 *  rounding) — age ticks up only on/after the birthday. */
export function ageFromBirthday(birthday: string | null | undefined, asOf?: string): number | null {
  if (typeof birthday !== 'string' || !ISO_DATE_RE.test(birthday)) return null;
  const ref = asOf && ISO_DATE_RE.test(asOf) ? asOf : todayIsoLocal();
  const [by, bm, bd] = birthday.split('-').map(Number) as [number, number, number];
  const [ry, rm, rd] = ref.split('-').map(Number) as [number, number, number];
  // Reject impossible dates (e.g. 2021-02-29) — Date would silently roll over.
  const d = new Date(Date.UTC(by, bm - 1, bd));
  if (d.getUTCFullYear() !== by || d.getUTCMonth() !== bm - 1 || d.getUTCDate() !== bd) return null;
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return age;
}

/** True when `v` is a valid ISO birthday: a real calendar date, not in the
 *  future, and a plausible human age (0..120) as of `asOf`. */
export function isValidBirthday(v: unknown, asOf?: string): v is string {
  if (typeof v !== 'string' || !ISO_DATE_RE.test(v)) return false;
  const age = ageFromBirthday(v, asOf);
  return age !== null && age >= 0 && age <= 120;
}
