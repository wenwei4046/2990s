// ----------------------------------------------------------------------------
// Wire-shaping for the HR / commission API. Pure — NO imports, deliberately.
//
// These live apart from hr-commission-queries.ts so they can be tested. That
// module imports apiClient, which imports supabase, which THROWS at module
// evaluation when the root .env is absent (the documented "blank white page
// with nothing in the console" failure). A test that only wants to check a key
// rename must not have to boot Supabase — houzs-money-keys.ts is split from its
// callers for exactly this reason.
//
// Two jobs, both consequences of the POS talking to two backends:
//   · the `*Centi` / `*Sen` rename (Houzs migration 0305) — same unit, pure
//     rename, never a conversion
//   · turning a thrown HTTP string back into the sentence the server wrote
// ----------------------------------------------------------------------------

/** Fill every `*Sen` key that is missing from its `*Centi` twin, recursively.
 *
 *  An existing `*Sen` always wins, so a transitional response carrying both is
 *  never clobbered. Mirrors `senKeysToCenti` in sales-analysis-queries.ts,
 *  pointed the other way: this page canonicalises on the Houzs spelling because
 *  Houzs is the live backend and 2990's API is the one being retired. */
export const centiKeysToSen = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(centiKeysToSen);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = centiKeysToSen(v);
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!k.endsWith('Centi')) continue;
    const modern = `${k.slice(0, -'Centi'.length)}Sen`;
    if (!(modern in out)) out[modern] = centiKeysToSen(v);
  }
  return out;
};

/** Add a `*Centi` twin for every `*Sen` key on an outgoing body, so the same
 *  payload satisfies both servers (each zod schema is non-strict and drops the
 *  key it does not know). Shallow on purpose — every write body on this page is
 *  flat, and a deep walk would invent keys inside nested values nobody reads. */
export const withCentiTwins = <T extends Record<string, unknown>>(
  body: T,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...body };
  for (const [k, v] of Object.entries(body)) {
    if (!k.endsWith('Sen')) continue;
    const legacy = `${k.slice(0, -'Sen'.length)}Centi`;
    if (!(legacy in out)) out[legacy] = v;
  }
  return out;
};

/** Turn `authedFetch`'s thrown `"409 Conflict: {\"error\":…,\"reason\":…}"` into
 *  the sentence the server actually wrote.
 *
 *  The HR route answers with a `reason` on every refusal it expects a human to
 *  act on ("Chain override mode needs at least one override level configured…"),
 *  and those sentences are the whole reason that module fails loudly instead of
 *  paying a confident RM 0. Printing the raw thrown string would bury them. */
export const hrErrorMessage = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err);
  const brace = raw.indexOf('{');
  if (brace >= 0) {
    try {
      const body = JSON.parse(raw.slice(brace)) as { reason?: unknown; error?: unknown };
      if (typeof body.reason === 'string' && body.reason) return body.reason;
      if (typeof body.error === 'string' && body.error) return body.error.replace(/_/g, ' ');
    } catch {
      /* fall through to the raw string — still better than nothing */
    }
  }
  return raw;
};
