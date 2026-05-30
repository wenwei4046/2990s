// ----------------------------------------------------------------------------
// allowed-options-check — server-side enforcement of per-Model variant chips.
//
// PR #216 (Commander 2026-05-27 follow-up to the pricing-engine PR #205):
// allowedCompartments / allowedSeatSizes / allowedDivanHeights / etc.
// used to gate the UI only — commander could still hand-craft a POST that
// dropped a 2C(LHF) variant onto a Model that explicitly allowed only
// 1A(LHF) + 2A(LHF). The pricing engine would happily price it; the SO
// would persist; nobody complained until the production floor pushed back
// "this Model can't actually be built in 2C". Enforce here so the API is
// the source of truth, matching the "server-side pricing recompute"
// non-negotiable in 2990s-readonly/CLAUDE.md.
//
// Rule: empty / null `allowed_options.<key>` = NO restriction (pre-PR #50
// rows simply never set the pool — must keep working). A non-empty array
// means "only these values are accepted on a line item under this Model".
// Variants the line didn't send are ignored (only what the line sends is
// validated — the UI may legitimately omit divanHeight on a sofa SO line).
//
// Pure projection of (allowed_options × product × line.variants) → ok | err.
// No DB calls — caller pre-loads the model row via `loadModelForCode` so
// tests can hit this without Supabase. ----------------------------------------

export type AllowedOptionsLite = {
  sizes?:                 string[] | null;
  compartments?:          string[] | null;
  divan_heights?:         string[] | null;
  total_heights?:         string[] | null;
  leg_heights?:           string[] | null;
  specials?:              string[] | null;
};

/** Subset of mfg_products columns needed to validate. `model_id = null`
 *  means the SKU isn't bound to a Model (legacy row, orphan, accessory) —
 *  validation is skipped entirely in that case. */
export type ProductForCheck = {
  code:        string;
  category:    string;             // 'BEDFRAME' | 'SOFA' | 'MATTRESS' | 'ACCESSORY' | 'SERVICE'
  model_id:    string | null;
  size_code:   string | null;
};

/** Subset of product_models columns we read. */
export type ModelForCheck = {
  id:              string;
  allowed_options: AllowedOptionsLite | null;
};

/** The variant blob shape we accept on the wire. Matches MfgItemVariants
 *  in apps/api/src/lib/mfg-pricing-recompute.ts. */
export type VariantsLite = {
  divanHeight?:   string | null;
  legHeight?:     string | null;
  totalHeight?:   string | null;
  seatHeight?:    string | null;
  sofaLegHeight?: string | null;
  specials?:      string[] | string | null;
  special?:       string[] | string | null;
} | null | undefined;

export type AllowedCheckError = {
  error:   'variant_not_allowed';
  field:   string;
  value:   string;
  allowed: string[];
};

const hasRestriction = (pool: string[] | null | undefined): pool is string[] => {
  return Array.isArray(pool) && pool.length > 0;
};

const toSpecialsArray = (s: string[] | string | null | undefined): string[] => {
  if (!s) return [];
  if (Array.isArray(s)) return s.map((x) => String(x).trim()).filter(Boolean);
  return [String(s).trim()].filter(Boolean);
};

/** Run the per-Model allowed-options check against one line item. Returns
 *  the first violation found, or null when every variant the line sent is
 *  inside the Model's pool (or the pool is empty / not restricted).
 *
 *  Caller wiring (POST + PATCH SO items):
 *    const err = checkAllowedOptions(product, model, variants);
 *    if (err) return c.json(err, 400);
 *
 *  Skipped (returns null) when:
 *    - product.model_id is null (no Model linkage — nothing to check)
 *    - model is null (FK dangling — best-effort, don't 500 the SO)
 *    - allowed_options is null / {} entirely
 *    - the specific key in allowed_options is null / [] (no restriction)
 *    - the line didn't send the corresponding variant at all
 */
export function checkAllowedOptions(
  product:  ProductForCheck | null,
  model:    ModelForCheck   | null,
  variants: VariantsLite,
): AllowedCheckError | null {
  if (!product || !product.model_id) return null;
  if (!model) return null;
  const opts = model.allowed_options ?? {};

  // ── Product-level checks (SKU's own size_code / compartment) ─────────
  // BEDFRAME + MATTRESS — size_code lives on mfg_products.
  if (
    (product.category === 'BEDFRAME' || product.category === 'MATTRESS')
    && product.size_code
    && hasRestriction(opts.sizes)
    && !opts.sizes.includes(product.size_code)
  ) {
    return {
      error: 'variant_not_allowed',
      field: 'size_code',
      value: product.size_code,
      allowed: opts.sizes,
    };
  }

  // SOFA — compartment is encoded in the SKU code suffix (commander's
  // sofaCodeFormat = '{model_code}-{compartment}'). Empty / no-dash codes
  // are skipped (orphan SKU, no compartment).
  if (product.category === 'SOFA' && hasRestriction(opts.compartments)) {
    const dashAt = product.code.indexOf('-');
    const compartment = dashAt > 0 ? product.code.slice(dashAt + 1).trim() : '';
    if (compartment && !opts.compartments.includes(compartment)) {
      return {
        error: 'variant_not_allowed',
        field: 'compartment',
        value: compartment,
        allowed: opts.compartments,
      };
    }
  }

  // ── Variant-level checks (live on the SO line's variants blob) ───────
  const v = variants ?? {};

  if (v.divanHeight && hasRestriction(opts.divan_heights)
      && !opts.divan_heights.includes(v.divanHeight)) {
    return {
      error: 'variant_not_allowed',
      field: 'divan_height',
      value: v.divanHeight,
      allowed: opts.divan_heights,
    };
  }

  if (v.totalHeight && hasRestriction(opts.total_heights)
      && !opts.total_heights.includes(v.totalHeight)) {
    return {
      error: 'variant_not_allowed',
      field: 'total_height',
      value: v.totalHeight,
      allowed: opts.total_heights,
    };
  }

  // legHeight (bedframe) AND sofaLegHeight (sofa) both validate against
  // the same leg_heights pool — commander has only one leg-height list per
  // Model regardless of category.
  const legPick = v.legHeight ?? v.sofaLegHeight ?? null;
  if (legPick && hasRestriction(opts.leg_heights)
      && !opts.leg_heights.includes(legPick)) {
    return {
      error: 'variant_not_allowed',
      field: 'leg_height',
      value: legPick,
      allowed: opts.leg_heights,
    };
  }

  // Sofa: seatHeight maps to allowed_options.sizes (sofa "size" = seat
  // height in commander's parlance — same chip list).
  if (product.category === 'SOFA' && v.seatHeight && hasRestriction(opts.sizes)
      && !opts.sizes.includes(v.seatHeight)) {
    return {
      error: 'variant_not_allowed',
      field: 'seat_size',
      value: v.seatHeight,
      allowed: opts.sizes,
    };
  }

  // Specials — multi-pick. Reject on the first unmatched pick.
  if (hasRestriction(opts.specials)) {
    const picks = toSpecialsArray(v.specials ?? v.special);
    for (const p of picks) {
      if (!opts.specials.includes(p)) {
        return {
          error: 'variant_not_allowed',
          field: 'specials',
          value: p,
          allowed: opts.specials,
        };
      }
    }
  }

  return null;
}

/** Loader paired with the check above. Reads the product → model rows
 *  from Supabase using the line's item_code. Returns nulls when either
 *  side is missing (caller's check shortcircuits to "allowed"). Safe to
 *  call with empty / missing item_code (returns nulls).
 *
 *  Keeping the I/O here lets the SO route hand a clean (product, model)
 *  tuple into checkAllowedOptions without the test having to mock two
 *  table builds. */
export async function loadProductAndModel(
  sb:       any,
  itemCode: string | null | undefined,
): Promise<{ product: ProductForCheck | null; model: ModelForCheck | null }> {
  const code = (itemCode ?? '').trim();
  if (!code) return { product: null, model: null };

  const { data: productRow } = await sb
    .from('mfg_products')
    .select('code, category, model_id, size_code')
    .eq('code', code)
    .maybeSingle();
  const product = (productRow ?? null) as ProductForCheck | null;
  if (!product || !product.model_id) return { product, model: null };

  const { data: modelRow } = await sb
    .from('product_models')
    .select('id, allowed_options')
    .eq('id', product.model_id)
    .maybeSingle();
  const model = (modelRow ?? null) as ModelForCheck | null;
  return { product, model };
}
