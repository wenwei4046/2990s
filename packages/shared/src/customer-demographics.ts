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
