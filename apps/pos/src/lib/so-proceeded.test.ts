import { describe, expect, it, vi } from 'vitest';

// OrderStatus pulls in apiClient -> the supabase singleton, which reads
// VITE_SUPABASE_URL/KEY at module load.
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

import { soIsProceeded } from '../pages/OrderStatus';

/* WHAT BROKE, and why no existing test caught it.
 *
 * The My-orders board sent a CONFIRMED order to the "Proceed" lane when
 * `proceededAt` was set. On 2026-08-18 Houzs RETIRED `proceeded_at` — not as
 * dead weight, but because it was a SECOND storage for the Processing Date and
 * their owner ruled three times that there is exactly one. They now have a
 * source-level test that fails any executable line naming it, so it is not
 * coming back.
 *
 * Our read became `undefined`, and `undefined` is not an error — every
 * CONFIRMED order, proceeded or not, quietly fell back to "Order placed". The
 * board stopped reflecting what the coordinator had done, with nothing in any
 * log. Every test here passed throughout, because the rule had no name and no
 * home: it was an inline ternary inside a lane switch.
 *
 * So these pin the RULE, not the lane. */

const row = (over: Partial<{ processingDate: string | null; proceededAt: string | null }> = {}) => ({
  processingDate: null,
  proceededAt: null,
  ...over,
});

describe('soIsProceeded — the Processing Date is the one storage', () => {
  it('a Processing Date means proceeded', () => {
    expect(soIsProceeded(row({ processingDate: '2026-09-18' }))).toBe(true);
  });

  it('no Processing Date means NOT proceeded', () => {
    /* Houzs measured this in production on 2026-08-18: 16 live company-2 orders
       carried a proceed stamp with no date. Under the owner's rule they are not
       proceeded, and the repair is a human entering the date — never code
       inventing one. */
    expect(soIsProceeded(row())).toBe(false);
  });

  it('still accepts the legacy stamp, so 2990\'s own API keeps working', () => {
    /* Local dev and any un-migrated surface still serve proceeded_at. Without
       this fallback the board would break the other way for developers. */
    expect(soIsProceeded(row({ proceededAt: '2026-08-01T02:00:00Z' }))).toBe(true);
  });

  it('prefers the Processing Date when BOTH are present', () => {
    /* The ordering that keeps the two storages from disagreeing. Houzs's own
       note says the failure mode was never a crash — it was two consumers of
       "is this proceeded" quietly answering differently. */
    expect(soIsProceeded(row({ processingDate: '2026-09-18', proceededAt: null }))).toBe(true);
    expect(soIsProceeded(row({ processingDate: null, proceededAt: '2026-08-01' }))).toBe(true);
  });

  it('treats an empty string as no date, not as a date', () => {
    /* `??` falls through on null/undefined ONLY — a present-but-empty string
       would satisfy it and then read as truthy nowhere else. Boolean() is what
       makes '' behave like absent here. */
    expect(soIsProceeded(row({ processingDate: '' }))).toBe(false);
  });
});
