// ----------------------------------------------------------------------------
// sofa-combo-pricing — pure lookup function for Sofa Combo Pricing.
//
// Given a SO/POS line about to be priced — (baseModel, modules array,
// customerId, fabricTier, height) — pick the best-matching combo row from
// a pre-fetched list and return the height-tier price, or null when no
// combo applies (caller should fall through to per-Model compartment
// pricing).
//
// OR-set per slot (Commander 2026-05-28, Hookka-style — PR combo-or-per-slot):
// A combo is an ORDERED list of SLOTS; each SLOT is a SET of alternative
// module codes joined by OR. e.g. combo "2+L" =
//   [ ['2A-LHF','2A-RHF'], ['L-LHF','L-RHF'] ]
// A built sofa MATCHES the combo iff there is a perfect bipartite matching
// that assigns each built module to a DISTINCT slot whose OR-set contains
// it, AND the built module count EQUALS the slot count (exact count — no
// extra, no missing). Order-independent: the matching ignores the order the
// modules were laid out.
//
// Scope precedence (high → low):
//   1. customer-specific row matching (baseModel, slot-set, tier)
//   2. customer = null row matching the same
// Within a scope, the row with the LATEST effective_from on/before today
// wins. Soft-deleted rows (deleted_at != null) never match.
//
// Tier match: row.tier === null matches any input tier (commander rarely
// uses this — most combos are tier-specific).
// ----------------------------------------------------------------------------

export type SofaPriceTier = 'PRICE_1' | 'PRICE_2' | 'PRICE_3';

/** A combo's ordered slots. Each slot is an OR-set of module codes. */
export type ComboSlots = string[][];

export interface SofaComboRow {
  id: string;
  baseModel: string;
  /** Ordered slots; each slot = OR-set of alternative module codes. */
  modules: ComboSlots;
  tier: SofaPriceTier | null;
  customerId: string | null;
  pricesByHeight: Record<string, number | null>;
  label?: string | null;
  effectiveFrom: string;        // ISO date 'YYYY-MM-DD'
  deletedAt?: string | null;
}

export interface PickComboArgs {
  baseModel: string;
  /** The BUILT sofa's flat list of module codes (one per laid-out cell). */
  modules: string[];
  customerId: string | null;
  tier: SofaPriceTier;
  height: string;               // '24' | '28' | '30' | '32' | '35'
  asOf?: string;                // ISO date; defaults to today
}

/**
 * Coerce raw combo `modules` into the canonical `string[][]` slot shape.
 *
 * Accepts:
 *   · `string[][]` — already slots; trims + sorts codes within each slot,
 *     drops empty slots.
 *   · `string[]`   — LEGACY flat form (pre-OR-set). Each code becomes its
 *     own singleton slot `['X'] → [['X']]`. This lets pre-migration data and
 *     old callers keep working.
 *
 * Codes within a slot are sorted so two equivalent OR-sets compare equal.
 * Slots are NOT reordered here — slot order is positional/display only;
 * matching is order-independent regardless. For stable storage + tuple
 * equality (the history drawer), use `comboSlotsKey`.
 */
export function normalizeComboModules(
  raw: readonly (string | readonly string[])[] | readonly string[],
): ComboSlots {
  const out: ComboSlots = [];
  for (const entry of raw as readonly (string | readonly string[])[]) {
    if (Array.isArray(entry)) {
      const slot = [...entry]
        .map((s) => String(s).trim())
        .filter(Boolean)
        .sort();
      if (slot.length > 0) out.push(slot);
    } else {
      const code = String(entry).trim();
      if (code) out.push([code]);
    }
  }
  return out;
}

/**
 * Order-independent canonical key for a combo's slot-set. Sorts the codes in
 * each slot, then sorts the slots themselves, then JSON-stringifies. Two
 * combos with the same slots in any order produce the same key — used to
 * group history rows + dedupe active rows.
 */
export function comboSlotsKey(raw: readonly (string | readonly string[])[]): string {
  const slots = normalizeComboModules(raw)
    .map((slot) => [...slot].sort())
    .sort((a, b) => (a.join('') < b.join('') ? -1 : a.join('') > b.join('') ? 1 : 0));
  return JSON.stringify(slots);
}

/** True iff two slot-sets are equal ignoring slot order + intra-slot order. */
function slotsEqual(
  a: readonly (string | readonly string[])[],
  b: readonly (string | readonly string[])[],
): boolean {
  return comboSlotsKey(a) === comboSlotsKey(b);
}

/**
 * Set-cover / exact-count match: does the BUILT sofa's flat module list
 * cover the combo's slots via a perfect bipartite matching?
 *
 * Returns true iff:
 *   · built.length === slots.length (exact count), AND
 *   · there is a perfect matching assigning each built module to a DISTINCT
 *     slot whose OR-set contains that module.
 *
 * Implementation: Kuhn's augmenting-path bipartite matching. n ≤ ~8 slots in
 * practice, so the O(V·E) cost is trivial; correctness (not greed) matters
 * because overlapping OR-sets need backtracking — e.g. built [X, Y] against
 * slots [{X,Y}, {X}] must match X→{X}, Y→{X,Y}, which a naive greedy would
 * miss if it grabbed X→{X,Y} first.
 */
export function matchesComboSlots(
  built: readonly string[],
  rawSlots: readonly (string | readonly string[])[],
): boolean {
  const slots = normalizeComboModules(rawSlots);
  const mods = built.map((m) => m.trim()).filter(Boolean);
  if (mods.length !== slots.length) return false;
  if (slots.length === 0) return true;

  // adjacency: for each built module, which slots can hold it.
  const slotSets = slots.map((s) => new Set(s));
  const canFill: number[][] = mods.map((m) =>
    slots.map((_, j) => j).filter((j) => slotSets[j]!.has(m)),
  );

  // Quick reject: every built module must fit at least one slot.
  if (canFill.some((opts) => opts.length === 0)) return false;

  // Kuhn's algorithm: match built module i → some slot.
  const slotToMod = new Array<number>(slots.length).fill(-1);
  const tryAssign = (i: number, seen: boolean[]): boolean => {
    for (const j of canFill[i]!) {
      if (seen[j]) continue;
      seen[j] = true;
      if (slotToMod[j] === -1 || tryAssign(slotToMod[j]!, seen)) {
        slotToMod[j] = i;
        return true;
      }
    }
    return false;
  };

  let matched = 0;
  for (let i = 0; i < mods.length; i++) {
    if (tryAssign(i, new Array<boolean>(slots.length).fill(false))) matched++;
  }
  return matched === slots.length;
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Pick the centi price for the given (built modules, baseModel, tier,
 * customer, height) tuple. Returns null when no combo applies (caller falls
 * through to per-Model compartment pricing).
 *
 * @param rows  Pre-fetched combo rows. Caller should filter by baseModel
 *              server-side for performance; this function will re-filter
 *              defensively.
 */
export function pickComboPrice(
  args: PickComboArgs,
  rows: readonly SofaComboRow[],
): number | null {
  const asOf = args.asOf ?? todayIso();
  const built = args.modules.map((m) => m.trim()).filter(Boolean);

  // 1. Filter to candidate rows: same base model (empty args.baseModel = wildcard,
  //    used by POS until the retail↔mfg base_model bridge surfaces), slots
  //    cover the built modules (set-cover + exact count), tier matches (or row
  //    tier null), effective on/before asOf, not soft-deleted.
  const wildcardBaseModel = !args.baseModel;
  const candidates = rows.filter((r) => {
    if (r.deletedAt) return false;
    if (!wildcardBaseModel && r.baseModel !== args.baseModel) return false;
    if (r.tier !== null && r.tier !== args.tier) return false;
    if (r.effectiveFrom > asOf) return false;
    if (!matchesComboSlots(built, r.modules)) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  // 2. Within candidates, split into customer-specific vs default (null).
  const customerHits = args.customerId
    ? candidates.filter((r) => r.customerId === args.customerId)
    : [];
  const defaultHits  = candidates.filter((r) => r.customerId === null);

  // 3. Pick the scope to use (customer-specific wins).
  const pool = customerHits.length > 0 ? customerHits : defaultHits;
  if (pool.length === 0) return null;

  // 4. Latest effective_from wins. Tie-breaker: most recent created_at —
  //    but we don't carry created_at on this lookup, so the caller's
  //    fetch order matters as a fallback. Defensive: sort by effectiveFrom
  //    DESC here.
  const sorted = [...pool].sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0,
  );
  const winner = sorted[0];
  if (!winner) return null;

  const centi = winner.pricesByHeight?.[args.height];
  return typeof centi === 'number' ? centi : null;
}

/** Format a single module code with its LHF/RHF orientation in parens. */
function fmtCode(raw: string): string {
  const m = raw.match(/^(.+?)-(LHF|RHF)$/);
  return m ? `${m[1]}(${m[2]})` : raw;
}

/**
 * Auto-build a human-readable combo label from a slot-set. Each slot's
 * OR-alternatives are joined with `/`, slots are joined with ` + `. Example:
 *   [ ['2A-LHF','2A-RHF'], ['L-LHF','L-RHF'] ]
 *   → "(2A(LHF)/2A(RHF)) + (L(LHF)/L(RHF))"
 * A singleton slot drops its parens:
 *   [ ['2NA'] ] → "2NA"
 *
 * Also accepts the legacy flat `string[]` (each code = singleton slot).
 */
export function buildComboLabel(
  raw: readonly (string | readonly string[])[],
): string {
  const slots = normalizeComboModules(raw);
  return slots
    .map((slot) => {
      const codes = slot.map(fmtCode);
      return codes.length === 1 ? codes[0]! : `(${codes.join('/')})`;
    })
    .join(' + ');
}
