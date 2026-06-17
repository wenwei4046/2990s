// Address "manual key-in" support. The POS Handover + Sales Order address
// editors drive State → City → Postcode as cascading <select>s sourced from
// the seeded my_localities table. Some real postcodes (new developments,
// gaps in the seed) aren't searchable, so staff need to type City + Postcode
// by hand. The State stays a dropdown — Malaysia's states are a complete,
// fixed set and the state name drives server-side Country + warehouse
// derivation, so free-typing it is a footgun we avoid.
//
// This module holds the one piece of shared logic worth a test: deciding
// whether an existing address can't be represented by the dropdowns (its
// city or postcode isn't in the seed) so an edit surface can default the
// manual toggle ON instead of dropping the stored value into a blank select.

/** Minimal shape this module reads from a locality row — both apps' richer
 *  LocalityRow types are structurally assignable to this. */
export interface LocalityLike {
  state: string;
  city: string;
  postcode: string;
}

type AddressValue = {
  state?: string | null;
  city?: string | null;
  postcode?: string | null;
};

/**
 * True when the chosen city or postcode is present but NOT found in the
 * seeded locality list for the current state/city — i.e. the cascading
 * dropdowns can't represent this address and manual key-in is needed.
 *
 * - State is never the deciding factor (it stays a dropdown by design).
 * - Empty city/postcode are never "off-list" — a fresh/blank form starts in
 *   dropdown mode.
 * - An empty `rows` list means the dataset hasn't loaded yet; we can't
 *   decide, so return false (mount in dropdown mode, flip on once rows load).
 */
export function localityNeedsManualEntry(
  rows: readonly LocalityLike[],
  value: AddressValue,
): boolean {
  if (rows.length === 0) return false;

  const state = (value.state ?? '').trim();
  const city = (value.city ?? '').trim();
  const postcode = (value.postcode ?? '').trim();

  if (city && !rows.some((r) => r.state === state && r.city === city)) {
    return true;
  }
  if (postcode && !rows.some((r) => r.state === state && r.city === city && r.postcode === postcode)) {
    return true;
  }
  return false;
}
