# Sofa fabric-tier special price — by Model OR Compartment

> Design spec. 2026-06-20. Branch `feat/fabric-compartment-override`.
> Status: approved (owner confirmed trigger-style + "take the highest").

## Problem

Today a sofa is charged the fabric-tier upgrade (Price 2 / Price 3 surcharge Δ) **once for the whole
build**, and an admin can override that Δ **per Model** (`model_fabric_tier_overrides`, migration 0172).
The owner wants the special price to also be settable **per compartment**: if a sofa build uses a
compartment that has a special price, the whole-sofa fabric Δ uses it.

## Decisions (confirmed with owner)

1. **Whole-sofa, trigger-style** — the fabric Δ stays a single value per sofa line (the pricing engine
   is unchanged). Only *which Δ* is selected changes.
2. **Set by Model OR Compartment** — both kinds of special price can be defined.
3. **Take the highest** — when more than one special price applies (the Model's, and/or one or more
   matching compartments'), the effective Δ is the **maximum** of the applicable special values. No
   precedence hierarchy. (This supersedes an earlier "compartment-priority" idea.)
4. Falls back to the global standard Δ when no special price applies.

## Key insight — the pricing engine is unchanged

The fabric Δ is applied at exactly one place per recompute:
`recomputeFromSnapshot` (`apps/api/src/lib/mfg-pricing-recompute.ts:495–500, 533`) calls
`fabricTierAddon(category, tier, config, override)` and folds the result into the sofa unit price. The
override is currently `modelFabricOverrides.get(product.model_id)`. **The whole feature = replace that
single lookup with a resolver that also considers compartments and takes the max.**

## 1. Resolution rule (the one new behaviour)

`fabricTierAddon`'s existing semantics (`fabric-tier-addon.ts:36–50`): each tier Δ is `null = inherit
global`, `0 = free`, positive = that price; `pick(ovr, glob)` = `ovr ?? glob`.

New shared pure function (`packages/shared/src/fabric-tier-override-resolve.ts`):
```ts
import type { FabricTierModelOverride } from './fabric-tier-addon';
import { normalizeCompartmentCode } from './sofa-build';

/** Per-tier effective Δ = MAX over the applicable SET special values (the Model's override and every
 *  compartment override whose code is in the build), or null (→ global) when none is set for that tier.
 *  "Take the highest": 0 (free) only wins if nothing pricier is set. */
export function resolveFabricTierOverride(
  buildCompartments: string[],                       // normalized cell moduleIds (custom build); [] otherwise
  modelOverride: FabricTierModelOverride | null,
  compartmentOverrides: Map<string, FabricTierModelOverride>,  // compartmentId → Δ pair
): FabricTierModelOverride | null;
```
- Candidates for tier N = `[modelOverride?.tierNDelta, ...buildCompartments.map(c => compOvr.get(norm(c))?.tierNDelta)]`, dropping `null`/`undefined`.
- `tierNDelta = candidates.length ? Math.max(...candidates) : null`.
- Return `{ tier2Delta, tier3Delta }` (both possibly null) or `null` if both null. Feed to `fabricTierAddon` unchanged.

## 2. Scope of compartment matching

- **Custom builds** (have `variants.cells[]`): match each cell's normalized `moduleId` against the
  compartment-override map. This is the "pick a compartment" case the owner means.
- **Quick-Pick bundles** (no cells, only `bundleId`): a customer does not individually pick
  compartments, so **only the Model override applies** to bundles in this version. Expanding a bundle's
  modules for compartment matching is a possible follow-up, explicitly out of scope here.
- **Non-sofa lines**: unaffected (Model override path as today).

## 3. Data model — migration 0184

New table `compartment_fabric_tier_overrides` (Drizzle `compartmentFabricTierOverrides`), mirroring
`model_fabric_tier_overrides`:

| Column | Type | Notes |
|---|---|---|
| `compartment_id` | text PK → `compartment_library(id)` | global (any sofa using this compartment) |
| `tier2_delta` | integer NULL | NULL = inherit global P2; 0 = free; positive = Δ |
| `tier3_delta` | integer NULL | NULL = inherit global P3 |
| `updated_at` | timestamptz NOT NULL default now() | |
| `updated_by` | uuid | staff(id) |

`model_fabric_tier_overrides` is unchanged. RLS: read = authenticated; write = the same roles as
0172's model table **plus `super_admin`** (the fabric route WRITE_ROLES — verify it already includes
super_admin; the delivery feature found this gap). Migration is append-only; next number on disk is 0184.

## 4. Server wiring (mirror the Model-override path exactly)

- New loader `loadCompartmentFabricTierOverrides(sb)` → `Map<compartmentId, FabricTierModelOverride>`
  (alongside `loadModelFabricTierOverrides`, `mfg-pricing-recompute.ts:797`).
- `recomputeFromSnapshot`: add a `compartmentFabricOverrides` param; replace the inline
  `modelFabricOverrides.get(...)` (lines 495–497) with
  `resolveFabricTierOverride(buildCompartments, modelOverride, compartmentFabricOverrides)`, where
  `buildCompartments` = the sofa cells' moduleIds already in scope (used for `computeSofaSellingSen`,
  line 528). Non-sofa → `[]`.
- Thread the compartment map through every site that already loads the model map: the **8 mfg**
  recompute points (`mfg-sales-orders.ts:1798, 4426, 4926, 5335, 5739, 5931, 6101`), the **3
  consignment** points (`consignment-orders.ts:595, 1277, 1426`), and `recomputeOneLine`
  (`mfg-pricing-recompute.ts:871`). Each `loadModelFabricTierOverrides(sb)` gets a sibling
  `loadCompartmentFabricTierOverrides(sb)` and passes both. **Missing one = pricing drift** (same risk
  the per-Model override carried).

## 5. POS live Δ surfaces (4)

The 4 POS surfaces that compute/show the fabric Δ (picker / Configurator / CustomBuilder / Tbc) must
call the same `resolveFabricTierOverride` against the loaded compartment-override map, so the POS
preview matches the server. POS fetches the compartment overrides via a new hook (mirror
`useModelFabricTierOverrides`).

## 6. API — `apps/api/src/routes/fabric-tier-addon.ts`

Mirror the existing per-Model `/special` endpoints:
- **GET `/compartment-special`** → `[{ compartmentId, tier2Delta, tier3Delta, updatedAt }]`.
- **PUT `/compartment-special`** → `{ compartmentId, tier2Delta, tier3Delta }` upsert on `compartment_id`.
- **DELETE `/compartment-special/:compartmentId`** → revert to standard.
Keep the route WRITE_ROLES (verify super_admin present). `.select()` after write to confirm row count.

## 7. UI — `FabricPricingPanel` (`apps/pos/src/pages/Products.tsx`)

Add a **"Per-compartment special prices"** block directly below the existing "Per-model special
prices" block, same layout: a **compartment** dropdown (from the `sofaCompartments` maintenance pool /
`compartment_library`) + Price 2 (+RM) + Price 3 (+RM) inputs + **Add / Save**, and a list (Compartment
| Price 2 | Price 3 | Clear). Help text mirrors the model one, plus a line: "取最高 — 一张沙发同时命中
型号和部件(或多个部件)时,用最贵的那个;设 0(免费)只有在没有更贵的特别价时才生效。"

New hooks in `apps/pos/src/lib/queries.ts`: `useCompartmentFabricTierOverrides`,
`useUpsertCompartmentFabricTierOverride`, `useDeleteCompartmentFabricTierOverride`.

## 8. Testing

`packages/shared/src/fabric-tier-override-resolve.test.ts` (vitest):
- model only → model Δ; compartment only → compartment Δ.
- both set → MAX (model +250 vs compartment +300 → 300).
- multiple matching compartments → MAX.
- 0 (free) loses to a higher set value; wins only when it is the highest.
- none set → null (→ global via fabricTierAddon).
- per-tier independence (tier2 maxed separately from tier3).
- non-sofa / empty compartments → model path only.

## Non-goals
- No change to `fabricTierAddon`, the per-line/whole-sofa fabric model, or the base per-compartment price.
- No bundle/Quick-Pick compartment expansion (Model override only for bundles) — possible follow-up.
- No combo / variant scopes (owner asked for model + compartment only).
- No RuleTarget reuse — this resolves a per-line *value with max*, not an order-level boolean trigger;
  a parallel compartment table + resolver mirrors the existing Model-override code with less risk.

## Deploy order
1. Apply migration 0184 (Supabase MCP) — verify table + RLS.
2. Deploy API (Worker).
3. Deploy POS (`deploy-pos.sh` semantics / wrangler pages via OAuth). PWA hard-refresh reminder.
