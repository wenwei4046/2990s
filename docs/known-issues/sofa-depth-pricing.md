# Known issue — Sofa per-compartment-per-depth pricing

**Status:** open · documented 2026-05-09 · requires schema change before resolving
**Discovered:** Sub-project D, flag #5 — Hookka catalog port (commit `54930d0`)
**Affects:** any sofa Model whose pricing differs across seat depths (e.g. Hookka)
**Does NOT affect:** 2990's own catalog (Noor / Tanah / Rumah / Petang) — see §"Why 2990's is unaffected"

---

## TL;DR

Our sofa pricing schema stores **one price per compartment** and **one price per size variant**.
Hookka's real catalog stores **one price per (compartment, depth) pair** — three tiers per compartment
(24", 28", 30") with non-uniform uplifts. The two models don't reconcile without a schema change.

For MVP, we ship with the existing schema and treat Hookka pricing as "one depth, one price" by
seeding only the 28" tier. The other two tiers are **silently dropped**.

The proper fix requires a new composite-key table `product_compartment_size_prices`. **Not in scope for
MVP** — would need Loo's explicit approval (red line: schema migration affects production data shape).

---

## What the catalog actually looks like

Hookka's quotation (extracted in commit `54930d0`) has rows like:

```
SOFA 5531 1A (LHF/RHF)  P2  RM   519.75 (24")  RM   623.70 (28")  RM   623.70 (30")
SOFA 5531 2A (LHF/RHF)  P2  RM   992.25 (24")  RM 1,039.50 (28")  RM 1,143.45 (30")
SOFA 5531 1NA           P2  RM   472.50 (24")  RM   519.75 (28")  RM   519.75 (30")
```

Key observations:

1. The uplift per depth is **not constant** — 1A goes +103.95 / +0.00 across the depth steps,
   2A goes +47.25 / +103.95, 1NA goes +47.25 / +0.00. There is no single "+RM X for 28 inch"
   modifier that works.
2. There are **3 depth tiers** (24" / 28" / 30"). Our `Depth` type currently only allows `'24' | '28'`
   (see `packages/shared/src/sofa-build.ts:13`).
3. The full catalog is a **3D matrix**: (Model, Compartment, Depth) → price. Bundles have a similar
   structure if Hookka offers depth-priced bundles (TBC during port).

---

## What our schema can store

Three composite-PK tables in `packages/db/src/schema.ts`:

| Table | PK | Stores |
|---|---|---|
| `product_compartments` | `(product_id, compartment_id)` | one `price` column — no depth dimension |
| `product_size_variants` | `(product_id, size_id)` | one `price` column — but for `pricing_kind = 'size_variants'` only (mattress/bedframe), NOT used for sofas |
| `product_bundles` | `(product_id, bundle_id)` | one `price` column — same single-price limitation |

For `pricing_kind = 'sofa_build'`, only `product_compartments` and `product_bundles` are read.
`product_size_variants` is ignored entirely (see "What the math actually does" below).

---

## What the math actually does

`computeSofaPrice(cells, depth, pricing)` in `packages/shared/src/sofa-build.ts:378`:

1. Groups cells into independent sofas by edge contact (uses `depth` for footprint geometry only).
2. Per group: sums `pricing.compartments[i].price` for each cell → à la carte total.
3. If signature matches a bundle and that bundle is active and cheaper → substitute bundle price.
4. Counts recliner-marked seats × `pricing.reclinerUpgradePrice` → recliner extra.
5. `finalPrice = basePrice + reclinerExtra`.

**`depth` is consumed by `groupSofas` / `cellBbox` for layout geometry, but it never enters the
price arithmetic.** The pricing math is intentionally depth-blind.

The wrapper `computeOrderTotal` in `packages/shared/src/pricing.ts:171` calls `computeSofaPrice` for
`pricing_kind = 'sofa_build'` lines, and uses `product_size_variants` only for the disjoint
`pricing_kind = 'size_variants'` path (mattress/bedframe). There is no code path that combines
sofa compartments with size variants.

This is a **deliberate design choice for 2990's brand**, not a bug — see next section.

---

## Why 2990's is unaffected

The prototype POS in `prototype/pos-sofa-config.jsx:450` literally tells the customer:

> "Both depths are the same price. Choose what feels right to sit on —
> 24″ is a classic upright posture; 28″ lets you sink in and lounge."

2990's brand promise is "honest pricing" — flat per-compartment prices that don't change by depth.
The schema is **correctly tuned to that promise**. The math is **correctly tuned to that promise**.
No fix needed for 2990's own SKUs (Noor / Tanah / Rumah / Petang).

---

## What this means for the Hookka port

Hookka is the **first 3rd-party Model** to be sold through this POS (sub-project D). Its catalog
breaks the assumption above.

### MVP workaround (in-flight)

When seeding Hookka's catalog:

- Pick **one canonical depth** to be the stored price. Recommended: **28"** (the middle tier;
  closest to a "fair" mid-point between Hookka's actual 24" and 30" pricing).
- Store that one price in `product_compartments.price`.
- Configurator continues to show the depth selector, but the price displayed and charged is the
  28" tier regardless of what the customer picks.
- 30" depth is **not selectable** (the `Depth` type only allows 24/28). The customer can only
  pick between 24 and 28; both bill at the 28" tier.

This mirrors 2990's brand behaviour ("both depths same price") at the cost of:

- **Underpricing** when customer picks 24" (they pay 28" rate but get 24" hardware).
- **No 30" option at all**, even though Hookka offers it.
- **No transparency** that the catalog has multiple tiers.

For MVP this is acceptable (Hookka pilot is shadow-priced anyway, with Loo personally reviewing
each quote). It is **not acceptable for general release** of Hookka pricing.

### Proper fix (post-MVP, requires Loo approval)

New composite-PK table, additive migration:

```ts
export const productCompartmentSizePrices = pgTable('product_compartment_size_prices', {
  productId:     uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  compartmentId: text('compartment_id').notNull().references(() => compartmentLibrary.id),
  sizeId:        text('size_id').notNull().references(() => sizeLibrary.id),  // depth here
  active:        boolean('active').notNull().default(true),
  price:         integer('price').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.productId, t.compartmentId, t.sizeId] }),
}));
```

Plus:

- Extend `Depth` type to `'24' | '28' | '30'` in `packages/shared/src/sofa-build.ts:13`.
- Add a `depth_pricing_mode` flag on `products`: `'flat' | 'per_depth'`.
  - `flat` → existing path, `product_compartments.price` used regardless of depth (2990's case).
  - `per_depth` → new path, look up `product_compartment_size_prices` keyed on `(product_id, compartment_id, depth_size_id)` (Hookka case).
- Update `computeSofaPrice` to branch on the mode.
- SKU Master Pricing Editor needs a 3-column grid (24/28/30) for `per_depth` Models.
- Bundles likely need the same treatment if Hookka offers depth-priced bundles —
  parallel `product_bundle_size_prices` table.

### Why we're NOT shipping the proper fix now

1. Schema migration touches production data shape — red-line per `CLAUDE.md` global §8.
2. SKU Master UI rework (3-column pricing grid) is out of scope for current sprint.
3. Hookka pilot is shadow-mode; Loo signs off each quote, so silent underpricing is caught.
4. Decision needs Loo's input on whether **all** new 3rd-party Models will be `per_depth`, in which
   case we may want a different default rather than a flag.

**Action item:** raise this with Loo before Hookka goes from shadow to live pricing.

---

## Verification

`packages/shared/src/pricing.ts` is correct as-is for the documented scope (2990's brand). No code
fix shipped with this doc. Typecheck passes.

If you came here looking for "why does Hookka 24" cost the same as 28"" — this is why, by design.
