// ----------------------------------------------------------------------------
// sofa-combo-pricing — pure lookup function for Sofa Combo Pricing.
//
// Given a SO/POS line about to be priced — (baseModel, modules array,
// customerId, fabricTier, height) — pick the best-matching combo row from
// a pre-fetched list and return the height-tier price, or null when no
// combo applies (caller should fall through to per-Model compartment
// pricing).
//
// Scope precedence (high → low):
//   1. customer-specific row matching (baseModel, modules-set, tier)
//   2. customer = null row matching the same
// Within a scope, the row with the LATEST effective_from on/before today
// wins. Soft-deleted rows (deleted_at != null) never match.
//
// Module-set match is UNORDERED — the input modules array and the row's
// modules array are sorted then compared element-by-element. The migration
// stores modules sorted so this is cheap.
//
// Tier match: row.tier === null matches any input tier (commander rarely
// uses this — most combos are tier-specific).
// ----------------------------------------------------------------------------

export type SofaPriceTier = 'PRICE_1' | 'PRICE_2' | 'PRICE_3';

export interface SofaComboRow {
  id: string;
  baseModel: string;
  modules: string[];
  tier: SofaPriceTier | null;
  customerId: string | null;
  pricesByHeight: Record<string, number | null>;
  label?: string | null;
  effectiveFrom: string;        // ISO date 'YYYY-MM-DD'
  deletedAt?: string | null;
}

export interface PickComboArgs {
  baseModel: string;
  modules: string[];            // unsorted input — we normalize
  customerId: string | null;
  tier: SofaPriceTier;
  height: string;               // '24' | '28' | '30' | '32' | '35'
  asOf?: string;                // ISO date; defaults to today
}

/** Sort an array of compartment codes — used so module-set match is order-free. */
export function normalizeComboModules(arr: readonly string[]): string[] {
  return [...arr].map((s) => s.trim()).filter(Boolean).sort();
}

/** True iff two sorted module arrays match element-for-element. */
function modulesEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Pick the centi price for the given (modules, baseModel, tier, customer,
 * height) tuple. Returns null when no combo applies (caller falls through
 * to per-Model compartment pricing).
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
  const wantedModules = normalizeComboModules(args.modules);

  // 1. Filter to candidate rows: same base model, modules match, tier matches
  //    (or row tier null), effective on/before asOf, not soft-deleted.
  const candidates = rows.filter((r) => {
    if (r.deletedAt) return false;
    if (r.baseModel !== args.baseModel) return false;
    if (r.tier !== null && r.tier !== args.tier) return false;
    if (r.effectiveFrom > asOf) return false;
    if (!modulesEqual(normalizeComboModules(r.modules), wantedModules)) return false;
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

/**
 * Auto-build a human-readable combo label from a modules array. Example:
 *   ['1A-LHF','1A-RHF','2NA','L-LHF','L-RHF']
 *   → "1A(LHF) / 1A(RHF) + 2NA + L(LHF) / L(RHF)"
 *
 * Logic: group consecutive matching base codes with their LHF/RHF
 * orientation suffix wrapped in parens; '+' joins distinct bases.
 */
export function buildComboLabel(modules: readonly string[]): string {
  const parts: string[] = [];
  for (const raw of modules) {
    const m = raw.match(/^(.+?)-(LHF|RHF)$/);
    if (m) parts.push(`${m[1]}(${m[2]})`);
    else parts.push(raw);
  }
  return parts.join(' + ');
}
