import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sofaModulePricesFromSkus, normalizeCompartmentCode, representativeArtCode } from '@2990s/shared/sofa-build';
import { comboChargedPrices, maintActiveValues, type MfgSeatHeightPrice, type DefaultFreeGift, type FreeItemEligibility, type FreeItemCampaign, type RuleTarget } from '@2990s/shared';
import { authedFetch, authedFetchRaw, API_URL, IS_HOUZS, HOUZS_COMPANY_ID, houzsApiRoot, posApiBase } from './apiClient';
import { useMaintenanceConfig, type MaintenanceResolved } from './products/mfg-products-queries';

/* ─── Houzs seam helpers (P4.3) ───────────────────────────────────────────
 * The configurator resolves a SKU (mfg_products.id) → its Model's
 * allowed_options (the Modular ON/OFF gate). On Houzs there is no embedded
 * PostgREST join; instead we compose the two documented list endpoints:
 *   GET /mfg-products   → { products:[{ id, model_id }] }   (SKU → model_id)
 *   GET /product-models → { models:[{ id, allowed_options }] } (model → gate)
 * allowed_options is a pure GATE (which options may be offered), never a
 * price, so this resolution touches no pricing math. */
type MfgAllowedOptions = {
  fabrics?:       string[];
  specials?:      string[];
  sizes?:         string[];
  gaps?:          string[];
  leg_heights?:   string[];
  divan_heights?: string[];
  total_heights?: string[];
  compartments?:  string[];
};

async function fetchModelAllowedOptions(productId: string): Promise<MfgAllowedOptions | null> {
  const { products } = await authedFetch<{ products: Array<{ id: string; model_id: string | null }> }>(
    '/mfg-products',
  );
  const modelId = (products ?? []).find((p) => p.id === productId)?.model_id ?? null;
  if (!modelId) return null;
  const { models } = await authedFetch<{ models: Array<{ id: string; allowed_options: MfgAllowedOptions | null }> }>(
    '/product-models',
  );
  return (models ?? []).find((m) => m.id === modelId)?.allowed_options ?? null;
}

/* ─── POS-catalog SKU read (P4.3) ─────────────────────────────────────────
 * GET /pos-pools/mfg-catalog is the Houzs seam that replaces the five direct
 * `supabase.from('mfg_products')` reads the map couldn't serve: GET /mfg-products
 * filters status=ACTIVE, but the POS keeps pos_active=true SKUs even when
 * status=INACTIVE, and derives sofa-module + per-size prices from SIBLING SKUs
 * whose original query carried NO status/pos_active filter at all.
 *
 * Params (mutually exclusive, precedence id > modelId > baseModel):
 *   {}                                → pos_active=true, any status (the catalog)
 *   { id }                            → that ONE SKU, any status/pos_active
 *   { modelId }                       → all SKUs of a model_id, no status/pos filter
 *   { baseModel, category? }          → all SKUs of a base_model (+category), no filter
 *
 * COST STRIP (#625): the endpoint emits SELLING fields only (sell_price_sen /
 * pwp_price_sen). It never sends base_price_sen / cost_price_sen, and
 * seat_height_prices arrives with its per-height cost (priceSen) already
 * removed — so nothing here can fall back to, or leak, a cost. */
interface MfgCatalogApiRow {
  id:                 string;
  code:               string;
  name:               string;
  category:           MfgCatalogCategory;
  description:        string | null;
  branding:           string | null;
  size_label:         string | null;
  size_code:          string | null;
  sell_price_sen:     number | null;
  pwp_price_sen:      number | null;
  seat_height_prices: MfgSeatHeightPrice[] | null;
  included_addons:    { addonId: string; qty: number }[] | null;
  base_model:         string | null;
  model_id:           string | null;
  retail_product_id:  string | null;
  status:             string;
  pos_active:         boolean | null;
  product_models:     {
    id:              string;
    name:            string;
    model_code:      string;
    photo_url:       string | null;
    active:          boolean;
    allowed_options: MfgAllowedOptions | null;
  } | null;
}

async function fetchMfgCatalog(params?: Record<string, string>): Promise<MfgCatalogApiRow[]> {
  const qs = params && Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
  const { products } = await authedFetch<{ products: MfgCatalogApiRow[] }>(`/pos-pools/mfg-catalog${qs}`);
  return products ?? [];
}

export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  detail: string | null;
  size_display: string | null;
  img_key: string | null;
  thumb_key: string | null;
  pricing_kind: 'sofa_build' | 'size_variants' | 'bedframe_build' | 'flat' | 'tbc';
  flat_price: number | null;
  recliner_upgrade_price: number | null;
  stock: number;
  low_at: number;
  visible: boolean;
  category: { id: string; label: string; icon: string; tbc: boolean } | null;
  series: { id: string; label: string; active: boolean } | null;
  /** product_models.id for mfg-backed catalog rows (null for legacy retail
   *  rows). Drives the PWP eligibility check + the special-delivery-fee lookup. */
  model_id?: string | null;
}

interface ProductsResponse {
  products: CatalogProduct[];
}

export const useCatalog = () =>
  useQuery({
    queryKey: ['catalog'],
    queryFn: async (): Promise<CatalogProduct[]> => {
      const body = await authedFetch<ProductsResponse>('/products');
      return body.products;
    },
    staleTime: 30_000,
    // Houzs has NO realtime — poll every 30s in place of the old
    // `catalog-products` postgres_changes channel (P4.3 seam port).
    refetchInterval: 30_000,
  });

// (P4.3) Was a Supabase Realtime subscription on `products` that invalidated
// the catalog query on any change. Houzs has no realtime, so the invalidation
// is replaced by `refetchInterval: 30_000` on useCatalog above. Kept as an
// exported no-op so existing call sites (OrderBoard etc.) stay unchanged.
export const useCatalogRealtime = () => {
  /* no-op — polling replaces realtime (see useCatalog refetchInterval) */
};

/* ─── Per-product pricing (configurator screens) ───────────────────── */

export interface ProductBundleRow { bundleId: string; active: boolean; price: number }
export interface ProductCompartmentRow { compartmentId: string; active: boolean; price: number }
export interface ProductSizeRow { sizeId: string; active: boolean; price: number; pwpPrice: number | null }

export const useProduct = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId],
    // Houzs has NO realtime — poll in place of the `product-pricing` channel.
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!productId) throw new Error('no productId');
      // (P4.3 / auth cutover) The legacy retail `products` branch was the POS's
      // LAST direct `supabase.from(...)` data read. It is removed here: the
      // retail `products` table starts EMPTY in production (PORT_DESIGN §10
      // Decision 10) and every Catalog card links to an mfg- id, so the lookup
      // missed every time and fell through to the mfg fallback anyway. Dropping
      // it makes ALL ids resolve via GET /pos-pools/mfg-catalog?id= below — the
      // Houzs-served path — and lets the POS shed @supabase/supabase-js for data.
      //
      // Behaviour choice (FLAGGED in the PR): rather than gate on the backend
      // target, the branch is deleted for BOTH targets — faithful because the
      // 2990 retail table is likewise empty in production, so a legacy UUID id
      // already fell through to the mfg fallback. A non-empty retail `products`
      // table (never the case in prod) would no longer be served.

      /* Look up by mfg_products.id (what the Catalog cards link
         to). mfg category enum → legacy pricing_kind. SOFA → 'sofa_build',
         BEDFRAME → 'bedframe_build', MATTRESS → 'size_variants', everything
         else → 'flat'. Keeps the Configurator's existing branch logic
         working without porting it to talk to mfg_products directly.

         (P4.3) Houzs seam: the single SKU by id comes from
         GET /pos-pools/mfg-catalog?id= (any status/pos_active). SELLING only —
         the endpoint never emits a cost, so flat_price derives from
         sell_price_sen alone (no base_price_sen fallback, #625 cost strip). */
      const mfg = (await fetchMfgCatalog({ id: productId }))[0] ?? null;
      if (!mfg) throw new Error('not_found');

      const pricingKind: 'sofa_build' | 'bedframe_build' | 'size_variants' | 'flat' =
        mfg.category === 'SOFA'     ? 'sofa_build'     :
        mfg.category === 'BEDFRAME' ? 'bedframe_build' :
        mfg.category === 'MATTRESS' ? 'size_variants'  :
                                       'flat';

      // Synthesise a row shape matching the products select() above so
      // downstream code that reads `product.data?.foo` keeps working.
      // base_price_sen is in sen (cents); flat_price expects ringgit
      // (legacy schema uses whole-RM integers — see CLAUDE.md "Money").
      return {
        id: mfg.id,
        sku: mfg.code,
        name: mfg.name,
        detail: mfg.description,
        size_display: mfg.size_label,
        img_key: null,
        thumb_key: null,
        // Widen to the full CatalogProduct union (this map never yields 'tbc',
        // but before the legacy retail branch was removed the return type carried
        // 'tbc' from the `products` row, and Configurator still switches on it).
        pricing_kind: pricingKind as CatalogProduct['pricing_kind'],
        // ACCESSORY is flat + has no variants; Loo wants even an unpriced (null)
        // or RM 0 accessory to be sellable in POS. Treat null as 0 so the
        // Configurator's FlatAddToCart renders (its gate is flat_price != null)
        // and the line books at RM 0. Server reprice has no authoritative figure
        // for a 0-base accessory → trusts the submitted 0 (no drift). Other flat
        // categories (legacy / SERVICE) keep null = "no price yet".
        flat_price:
          mfg.sell_price_sen != null
            ? Math.round(mfg.sell_price_sen / 100)
            : mfg.category === 'ACCESSORY' ? 0 : null,
        recliner_upgrade_price: 0,
        seat_upgrade_label: null,
        seat_upgrade_footrest: true,
        depth_options: null,
        stock: 0,
        low_at: 0,
        visible: true,
        /* BUGFIX 2026-05-28: the Configurator topbar chip does
           `p.category_id.toUpperCase()` — a null here crashed the whole
           configure route ("Cannot read properties of null (reading
           'toUpperCase')"). Stamp the lowercased mfg category so the chip
           reads e.g. "BOOQIT · SOFA". */
        category_id: mfg.category ? mfg.category.toLowerCase() : null,
        /* base_model is needed by Configurator so it can pass it to
           useSofaCombos() and filter Quick Pick combos to this Model. */
        base_model: mfg.base_model,
        /* model_id (product_models.id) — used by the PWP (换购) eligibility check
           to match this product against a rule's eligible model lists (0128). */
        model_id: mfg.model_id,
        series_id: null,
        included_addons: mfg.included_addons ?? [],
        updated_at: new Date().toISOString(),
      };
    },
  });

/* ─── Add-ons (used by Configurator's PILLOWS + ADD-ON sections) ───── */

export interface AddonRow {
  id: string;
  label: string;
  description: string | null;
  icon: string;
  kind: 'qty' | 'floors_items' | 'flat';
  category: string | null;
  price: number;
  perFloorItem: number | null;
  unit: string | null;
  enabled: boolean;
  /** Migration 0157 (Loo 2026-06-06) — data-driven handover membership,
   *  replacing the hardcoded HANDOVER_ADDON_IDS allowlist. */
  showAtHandover: boolean;
}

/** Houzs GET /addons row (camelCase). Superset used by both useAddons
 *  (enabled-only handover slice) and useAllAddons (admin editor). */
interface HouzsAddonRow {
  id: string;
  label: string;
  description: string | null;
  icon: string;
  kind: 'qty' | 'floors_items' | 'flat';
  category: string | null;
  price: number;
  perFloorItem: number | null;
  unit: string | null;
  defaultQty: number;
  stock: number | null;
  enabled: boolean;
  showAtHandover: boolean | null;
  serviceSku: string | null;
  sortOrder: number;
}

export const useAddons = () =>
  useQuery({
    queryKey: ['addons'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AddonRow[]> => {
      // GET /addons returns ALL rows; the handover screen wants enabled-only,
      // sorted by sortOrder — filter/sort client-side to preserve the old shape.
      // REVERTED (2026-07-22): a prior strip of the '2990-' prefix from the id
      // broke Dispose/Lift booking silently. The strip made local compares
      // convenient, but addon.id flows STRAIGHT through the handover payload
      // into Houzs's `.in('id', […])` addon lookup — where company_2 rows are
      // stored as '2990-dispose-mattress'. A stripped id never matched, so the
      // service line was quietly dropped and the customer wasn't charged.
      // Keep the prefixed id verbatim; any local compare that needs the
      // canonical form must normalise at the call site, not here.
      const { addons } = await authedFetch<{ addons: HouzsAddonRow[] }>('/addons');
      return (addons ?? [])
        .filter((r) => r.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((r) => ({
          id: r.id,
          label: r.label,
          description: r.description,
          icon: r.icon,
          kind: r.kind,
          category: r.category,
          price: r.price,
          perFloorItem: r.perFloorItem,
          unit: r.unit,
          enabled: r.enabled,
          showAtHandover: r.showAtHandover ?? false,
        }));
    },
  });

/* ─── Order Add-ons admin (migration 0022/0023; editor moved to POS 2026-06-02)
 * The Order Add-ons (Dispose / Lift access …) editor — reads ALL addons (the
 * `useAddons` above is enabled-only for the handover screen) + writes direct to
 * the `addons` table (RLS: SELECT all staff, write is_admin = admin/super_admin,
 * migration 0002). One-time order-level fees, distinct from the per-Model
 * `special_addons` (Product Add-ons). Used by the Order Add-ons section of the
 * POS Special Add-ons tab; the Backend Add-ons page is retired. */
export interface AdminAddonRow {
  id: string;
  label: string;
  description: string | null;
  icon: string;
  kind: 'qty' | 'floors_items' | 'flat';
  category: string | null;
  price: number;
  perFloorItem: number | null;
  unit: string | null;
  defaultQty: number;
  stock: number | null;
  enabled: boolean;
  /** Migration 0157 — shows on the POS handover add-ons screen. */
  showAtHandover: boolean;
  /** Migration 0160 — per-add-on SERVICE SKU (SVC-*); NULL books under the
   *  generic SVC-ADDON bucket. */
  serviceSku: string | null;
  sortOrder: number;
}

export const useAllAddons = () =>
  useQuery({
    queryKey: ['addons-all'],
    staleTime: 60_000,
    queryFn: async (): Promise<AdminAddonRow[]> => {
      const { addons } = await authedFetch<{ addons: HouzsAddonRow[] }>('/addons');
      return (addons ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((r) => ({
          id: r.id, label: r.label, description: r.description, icon: r.icon, kind: r.kind,
          category: r.category, price: r.price, perFloorItem: r.perFloorItem, unit: r.unit,
          defaultQty: r.defaultQty, stock: r.stock, enabled: r.enabled,
          showAtHandover: r.showAtHandover ?? false, serviceSku: r.serviceSku ?? null,
          sortOrder: r.sortOrder,
        }));
    },
  });

const invalidateAddons = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['addons'] });       // handover (enabled-only)
  void qc.invalidateQueries({ queryKey: ['addons-all'] });   // admin editor
};

export const useUpdateAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { price?: number; perFloorItem?: number | null; enabled?: boolean; showAtHandover?: boolean; serviceSku?: string | null } }) => {
      // Houzs PATCH /addons/:id takes a camelCase partial (only the provided
      // keys). Forward the patch as-is; the server stamps updated_at.
      const body: Record<string, unknown> = {};
      if (patch.price !== undefined)          body.price = patch.price;
      if (patch.perFloorItem !== undefined)   body.perFloorItem = patch.perFloorItem;
      if (patch.enabled !== undefined)        body.enabled = patch.enabled;
      if (patch.showAtHandover !== undefined) body.showAtHandover = patch.showAtHandover;
      if (patch.serviceSku !== undefined)     body.serviceSku = patch.serviceSku;
      await authedFetch<void>(`/addons/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => invalidateAddons(qc),
  });
};

export const useCreateAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: {
      id: string; label: string; description: string | null; icon: string;
      kind: 'qty' | 'floors_items' | 'flat'; category: string | null;
      price: number; perFloorItem: number | null; unit: string | null;
      stock: number | null; enabled: boolean; showAtHandover: boolean;
      serviceSku: string | null; sortOrder: number;
    }) => {
      // Houzs POST /addons — camelCase body mirrors the CreateAddon input.
      await authedFetch<void>('/addons', {
        method: 'POST',
        body: JSON.stringify(row),
      });
    },
    onSuccess: () => invalidateAddons(qc),
  });
};

/* Hard delete (Loo 2026-06-08). `cart_items.addon_id` is a RESTRICT FK, so an
 * add-on already used on an order can't be deleted — the caller surfaces that
 * as "use Off to retire it". Unused/test rows delete cleanly. */
export const useDeleteAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await authedFetch<void>(`/addons/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    onSuccess: () => invalidateAddons(qc),
  });
};

export const useProductBundles = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'bundles'],
    refetchInterval: 30_000,   // Houzs poll (replaces product-pricing channel)
    queryFn: async (): Promise<ProductBundleRow[]> => {
      if (!productId) throw new Error('no productId');
      // mfg-{12hex} products have no rows in product_bundles (UUID FK).
      // Their bundles are sourced from sofa_combos via useSofaCombos().
      if (productId.startsWith('mfg-')) return [];
      // Houzs GET /pos-pools/product-bundles → { rows: ProductBundleRow[] }
      // (already {bundleId,active,price}) — return as-is.
      const { rows } = await authedFetch<{ rows: ProductBundleRow[] }>(
        `/pos-pools/product-bundles?productId=${encodeURIComponent(productId)}`,
      );
      return rows ?? [];
    },
  });

export const useProductCompartments = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'compartments'],
    refetchInterval: 30_000,   // Houzs poll (replaces product-pricing channel)
    queryFn: async (): Promise<ProductCompartmentRow[]> => {
      if (!productId) throw new Error('no productId');
      // mfg-{12hex} products have no rows in product_compartments (UUID FK).
      // Their compartments are sourced from useSofaCustomizerData() → allowed_options.
      if (productId.startsWith('mfg-')) return [];
      // Houzs GET /pos-pools/product-compartments → { rows: ProductCompartmentRow[] }
      // (already {compartmentId,active,price}) — return as-is.
      const { rows } = await authedFetch<{ rows: ProductCompartmentRow[] }>(
        `/pos-pools/product-compartments?productId=${encodeURIComponent(productId)}`,
      );
      return rows ?? [];
    },
  });

/* ─── Sofa fabric & colour (spec 2026-05-24) ─── */

export interface FabricLibraryRow {
  id: string;
  label: string;
  tier: string;
  defaultSurcharge: number;
  active: boolean;
  sortOrder: number;
  // SELLING tiers (migration 0124) — PRICE_1/2/3 per context; drive the
  // fabric-tier add-on. Distinct from the display `tier` ('standard'/'premium').
  sofaTier: string | null;
  bedframeTier: string | null;
}
export interface FabricColourRow {
  fabricId: string;
  colourId: string;
  label: string;
  swatchHex: string | null;
  active: boolean;
  sortOrder: number;
}
export interface ProductFabricRow {
  fabricId: string;
  active: boolean;
  surcharge: number;
}

// Global fabric collection (active only) — drives the POS swatch palette.
export const useFabricLibrary = () =>
  useQuery({
    queryKey: ['fabric-library'],
    queryFn: async (): Promise<FabricLibraryRow[]> => {
      // Houzs GET /fabric-library → { fabrics: FabricLibraryRow[] } (camelCase).
      // Endpoint returns the full library; keep the active-only + sorted slice.
      const { fabrics } = await authedFetch<{ fabrics: FabricLibraryRow[] }>('/fabric-library');
      return (fabrics ?? [])
        .filter((r) => r.active)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((r) => ({
          id: r.id, label: r.label, tier: r.tier, defaultSurcharge: r.defaultSurcharge,
          active: r.active, sortOrder: r.sortOrder,
          sofaTier: r.sofaTier ?? null, bedframeTier: r.bedframeTier ?? null,
        }));
    },
  });

// All active colours (global, small) — filtered per fabric in the picker.
export const useFabricColours = () =>
  useQuery({
    queryKey: ['fabric-colours'],
    queryFn: async (): Promise<FabricColourRow[]> => {
      // Houzs GET /fabric-colours → { colours: FabricColourRow[] } (camelCase).
      // Keep the active-only + sorted slice the picker expects.
      const { colours } = await authedFetch<{ colours: FabricColourRow[] }>('/fabric-colours');
      return (colours ?? [])
        .filter((r) => r.active)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((r) => ({
          fabricId: r.fabricId, colourId: r.colourId, label: r.label,
          swatchHex: r.swatchHex, active: r.active, sortOrder: r.sortOrder,
        }));
    },
  });

// Enabled fabric COLOUR codes for a Model (allowed_options.fabrics — the codes
// ticked in the Modular drawer). Sofa reads them off useSofaCustomizerData;
// this hook is the bedframe (and any-category) equivalent, joining mfg_products
// → product_models. Returns [] for legacy UUID products (no Model link).
export const useModelAllowedFabricCodes = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['model-allowed-fabrics', productId],
    queryFn: async (): Promise<string[]> => {
      if (!productId || !productId.startsWith('mfg-')) return [];
      const allowed = await fetchModelAllowedOptions(productId);
      return allowed?.fabrics ?? [];
    },
  });

// Enabled Special Add-on CODES for a Model (allowed_options.specials — the codes
// ticked in the Modular drawer). The configurator filters its Special Add-ons to
// these so a picked code is always allowed (the server gate validates the same
// list). Returns [] for legacy UUID products (no Model link) → no add-ons shown.
export const useModelAllowedSpecials = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['model-allowed-specials', productId],
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      if (!productId || !productId.startsWith('mfg-')) return [];
      const allowed = await fetchModelAllowedOptions(productId);
      return allowed?.specials ?? [];
    },
  });

// Per-Model fabric availability + surcharge.
// mfg-{12hex} products have no rows in product_fabrics (UUID FK). Their
// fabrics are configured via product_models.allowed_options.fabrics and
// surfaced through useSofaCustomizerData() → the Configurator builds
// the ProductFabricRow[] from sofaCustomizer.data.fabricIds + useFabricLibrary.
export const useProductFabrics = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'fabrics'],
    refetchInterval: 30_000,   // Houzs poll (replaces product-pricing channel)
    queryFn: async (): Promise<ProductFabricRow[]> => {
      if (!productId) throw new Error('no productId');
      if (productId.startsWith('mfg-')) return [];   // mfg path uses sofaCustomizer
      // Houzs GET /pos-pools/product-fabrics → { rows: ProductFabricRow[] }
      // (already {fabricId,active,surcharge}) — return as-is.
      const { rows } = await authedFetch<{ rows: ProductFabricRow[] }>(
        `/pos-pools/product-fabrics?productId=${encodeURIComponent(productId)}`,
      );
      return rows ?? [];
    },
  });

/* ─── Bedframe configurator (spec 2026-05-25) ─────────────────────────
 * Mirrors the sofa fabric/colour hooks. Colour = global `bedframe_colours`
 * library ∩ the Model's `product_bedframe_colours` ticks (surcharge lives on
 * the global colour, no per-Model override). Options = global `bedframe_options`
 * (gap / leg_height / divan_height / total_height / special), grouped by `kind`
 * in the configurator. All surcharges 0 for pilot. */

export interface BedframeColourRow {
  id: string;
  label: string;
  swatchHex: string | null;
  surcharge: number;
  sortOrder: number;
}
export interface BedframeOptionRow {
  id: string;
  kind: string; // 'gap'|'leg_height'|'divan_height'|'total_height'|'special'
  value: string;
  surcharge: number;
  sortOrder: number;
}

// Colours offered for a given bedframe Model = global active bedframe_colours
// intersected with the Model's active product_bedframe_colours ticks.
export const useBedframeColours = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['bedframe-colours', productId],
    refetchInterval: 30_000,   // Houzs poll (replaces product-pricing channel)
    queryFn: async (): Promise<BedframeColourRow[]> => {
      if (!productId) throw new Error('no productId');
      // Houzs GET /pos-pools/bedframe-colours → { rows: BedframeColourRow[] }
      // (active-only global library, already {id,label,swatchHex,surcharge,sortOrder}).
      // Per-model ticks: GET /pos-pools/product-bedframe-colours?productId= →
      // { rows:[{colourId,active}] }. mfg-{12hex} ids have no tick rows → accept
      // all active global colours (no per-model colour gating at pilot).
      const [globalRes, tickRes] = await Promise.all([
        authedFetch<{ rows: BedframeColourRow[] }>('/pos-pools/bedframe-colours'),
        productId.startsWith('mfg-')
          ? Promise.resolve<{ rows: Array<{ colourId: string; active: boolean }> } | null>(null)
          : authedFetch<{ rows: Array<{ colourId: string; active: boolean }> }>(
              `/pos-pools/product-bedframe-colours?productId=${encodeURIComponent(productId)}`,
            ),
      ]);
      const global = (globalRes.rows ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
      // mfg products: all active global colours available (tickRes === null)
      // legacy UUID products: intersect with the per-model ticked colours
      if (tickRes === null) return global;
      const ticked = new Set((tickRes.rows ?? []).filter((r) => r.active).map((r) => r.colourId));
      return global.filter((r) => ticked.has(r.id));
    },
  });

// Global bedframe option choice-lists (active only). Small + changes rarely
// (Backend admin), so cache aggressively like size_library — no realtime.
export const useBedframeOptions = () =>
  useQuery({
    queryKey: ['bedframe-options'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BedframeOptionRow[]> => {
      // Houzs GET /pos-pools/bedframe-options → { rows: BedframeOptionRow[] }
      // (active-only, already {id,kind,value,surcharge,sortOrder}).
      const { rows } = await authedFetch<{ rows: BedframeOptionRow[] }>('/pos-pools/bedframe-options');
      return (rows ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    },
  });

/* Bedframe option pool for the configurator — UNIFIED on the master
 * maintenance config (the POS Master-Admin "Special Add-ons" pool) ∩ the
 * Model's allowed_options (the Modular drawer ON/OFF ticks). Replaces the old
 * global `bedframe_options` table read so that:
 *   • turning an option off in Modular actually removes it from the picker, and
 *   • the SELLING surcharge comes from the SAME source the server prices from
 *     (maintenance_config option `sellingPriceSen` → computeMfgLinePrice), so
 *     POS live total == server authoritative selling (no drift 400).
 * Mirrors useSofaCustomizerData. gaps carry NO price (string pool); leg/divan
 * surcharge (RM) = sellingPriceSen / 100. Backend-owned `priceSen` is COST and
 * is never read here (it never reaches the buyer). Empty allowed pool = no
 * restriction (show every master option) — matches the server's allowed-options
 * rule. Returns the SAME BedframeOptionRow[] shape as useBedframeOptions with
 * `id = value` so the configurator's byKind grouping + edit-hydration are
 * unchanged. Legacy (non-mfg) products have no Model link → no restriction. */
type CfgPricedOption = { value: string; priceSen?: number; sellingPriceSen?: number };

export const useBedframeCustomizerData = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['bedframe-customizer-data', productId],
    staleTime: 30_000,
    queryFn: async (): Promise<BedframeOptionRow[]> => {
      if (!productId) return [];

      // Per-Model allowed_options (mfg products only; legacy UUID products have
      // no Model link → empty = no restriction, same as the old global pool).
      let allowed: { gaps?: string[]; leg_heights?: string[]; divan_heights?: string[] } = {};
      if (productId.startsWith('mfg-')) {
        allowed = (await fetchModelAllowedOptions(productId)) ?? {};
      }

      // Master maintenance config = the POS Master-Admin Special Add-ons pool.
      // Houzs GET /maintenance-config/resolved?scope=master → { data, ... };
      // `data` IS the resolved config blob (same as the old history `config`).
      const resolved = await authedFetch<MaintenanceResolved>(
        '/maintenance-config/resolved?scope=master',
      );
      const cfg = (resolved?.data ?? {}) as unknown as {
        gaps?: Array<string | CfgPricedOption>;
        legHeights?: CfgPricedOption[];
        divanHeights?: CfgPricedOption[];
      };

      const rows: BedframeOptionRow[] = [];
      let order = 0;
      const gate = (pool: string[] | undefined) =>
        (pool?.length ?? 0) > 0 ? new Set(pool) : null;

      // gaps — plain strings, NO surcharge (gap has no price contribution).
      const gapAllow = gate(allowed.gaps);
      for (const g of cfg.gaps ?? []) {
        const value = typeof g === 'string' ? g : g?.value;
        // ACTIVE toggles (owner spec 2026-06-12) — inactive options never
        // surface on NEW POS orders; saved orders display their stored value.
        if (typeof g === 'object' && g !== null && (g as { active?: boolean }).active === false) continue;
        if (!value || (gapAllow && !gapAllow.has(value))) continue;
        rows.push({ id: value, kind: 'gap', value, surcharge: 0, sortOrder: order++ });
      }

      // leg_height / divan_height — surcharge (RM) = sellingPriceSen / 100.
      const pushPriced = (
        list: CfgPricedOption[] | undefined,
        kind: 'leg_height' | 'divan_height',
        pool: string[] | undefined,
      ) => {
        const allow = gate(pool);
        for (const o of list ?? []) {
          if (!o?.value || (allow && !allow.has(o.value))) continue;
          // ACTIVE toggles (owner spec 2026-06-12) — skip deactivated options.
          if ((o as { active?: boolean }).active === false) continue;
          rows.push({
            id: o.value, kind, value: o.value,
            surcharge: Math.round(o.sellingPriceSen ?? 0) / 100,
            sortOrder: order++,
          });
        }
      };
      pushPriced(cfg.legHeights, 'leg_height', allowed.leg_heights);
      pushPriced(cfg.divanHeights, 'divan_height', allowed.divan_heights);

      return rows;
    },
  });

export interface SofaLegOption { value: string; surcharge: number }

/* Sofa leg-height options for the configurator — the master maintenance
 * `sofaLegHeights` pool (set + priced in POS Master-Admin → Special Add-ons,
 * sellingPriceSen) ∩ the Model's `allowed_options.leg_heights` (Modular ON/OFF
 * ticks). Mirrors the bedframe customizer; the server prices the SAME pool via
 * computeMfgLinePrice(sofaLegHeights) + gates sofaLegHeight against leg_heights,
 * so POS and server stay in lockstep. surcharge (RM) = sellingPriceSen / 100.
 * Empty allowed pool = no restriction; legacy (non-mfg) = no restriction. */
export const useSofaLegHeights = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['sofa-leg-heights', productId],
    staleTime: 30_000,
    queryFn: async (): Promise<SofaLegOption[]> => {
      if (!productId) return [];

      // allowedLegs === null  → no restriction (offer every leg)
      // allowedLegs === []     → offer NO legs (explicitly turned all off)
      // allowedLegs === [...]   → offer exactly those legs
      let allowedLegs: string[] | null = null;
      if (productId.startsWith('mfg-')) {
        const ao = await fetchModelAllowedOptions(productId);
        // Empty-semantics (owner 2026-06-16): the leg_heights KEY being ABSENT
        // means "unconfigured → offer ALL legs" (sensible default for a brand-new
        // Model). The key being PRESENT — even as [] — means it was explicitly
        // configured, so it offers EXACTLY that set; an empty [] = offer NO legs.
        // This lets staff turn every leg off in the Allowed Options drawer and
        // actually hide them all (previously [] wrongly meant "show all").
        if (ao && 'leg_heights' in ao && Array.isArray(ao.leg_heights)) {
          allowedLegs = ao.leg_heights;
        }
      }

      // Houzs GET /maintenance-config/resolved?scope=master → { data, ... }.
      const resolved = await authedFetch<MaintenanceResolved>(
        '/maintenance-config/resolved?scope=master',
      );
      const list = ((resolved?.data ?? {}) as unknown as { sofaLegHeights?: CfgPricedOption[] }).sofaLegHeights ?? [];
      // null → no gate (all); [] → empty gate (none); [...] → that subset.
      const gate = allowedLegs === null ? null : new Set(allowedLegs);
      return list
        // ACTIVE toggles (owner spec 2026-06-12) — deactivated leg heights
        // never surface on NEW POS orders.
        .filter((o) => o?.value && (o as { active?: boolean }).active !== false && (!gate || gate.has(o.value)))
        .map((o) => ({ value: o.value, surcharge: Math.round(o.sellingPriceSen ?? 0) / 100 }));
    },
  });

/** Maps HOOKKA mfg_products.size_code → size_library.id (seeded in seed-libraries.sql).
 *  Only the 4 standard bed sizes have library entries at MVP; SK/SP/7FT etc. are ignored
 *  until size_library is extended to include them. */
const MFG_SIZE_CODE_TO_LIB: Record<string, string> = {
  K: 'king', Q: 'queen', S: 'single', SS: 'super-single',
};

/** Inverse of MFG_SIZE_CODE_TO_LIB: size_library.id → mfg size_code (UPPERCASE).
 *  Used to feed the unified rule matcher a cart line's variant size_code
 *  (the booked SKU's size_code equals this, so client/server stay drift-safe). */
const SIZE_ID_TO_MFG: Record<string, string> = Object.fromEntries(
  Object.entries(MFG_SIZE_CODE_TO_LIB).map(([code, id]) => [id, code]),
);
export const sizeIdToMfgCode = (sizeId: string | null | undefined): string | null =>
  sizeId ? (SIZE_ID_TO_MFG[sizeId] ?? null) : null;

/** The mfg size_codes a POS line can actually carry (each maps to a size_library
 *  id, so a cart line can be configured + booked at that size). SK/SP SKUs exist
 *  but aren't tablet-pickable, so a rule targeting them would never match — the
 *  RuleTargetPicker only offers these to avoid that dead/confusing config. */
export const POS_PICKABLE_SIZE_CODES: ReadonlySet<string> = new Set(Object.keys(MFG_SIZE_CODE_TO_LIB));

export const useProductSizes = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'sizes'],
    refetchInterval: 30_000,   // Houzs poll (replaces product-pricing channel)
    queryFn: async (): Promise<ProductSizeRow[]> => {
      if (!productId) throw new Error('no productId');

      /* ── mfg-* path (new manufacturer SKU system) ──────────────────────────
         The POS catalog links to `/configure/{mfg.id}` where `mfg.id` is a
         TEXT key like `mfg-4ea1697f0783`. `product_size_variants.product_id`
         is a UUID FK to the legacy `products` table — passing a mfg- id
         directly returns zero rows (Postgres type coercion makes it a no-op,
         not an error).

         Fix: two-step resolve.
           1. Fetch `retail_product_id` (nullable UUID bridge) + `model_id`
              from `mfg_products`.
           2a. If `retail_product_id` is set → use `product_size_variants` as
               normal (admin-configured prices from Backend SKU Master).
           2b. Otherwise → fetch all sibling SKUs that share the same
               `model_id` and synthesise ProductSizeRow[] from their
               `size_code` + `base_price_sen`. Works even if `retail_product_id`
               is never populated — prices come directly from mfg data.
           2c. Truly orphan SKU (no model, no retail link) → single size entry
               from its own `size_code`/`base_price_sen`. */
      // (P4.3) mfg-* branch ported to GET /pos-pools/mfg-catalog. The lead SKU
      // comes back by id (any status/pos_active), and the sibling derivations use
      // the ?modelId / ?baseModel scopes — which carry NO status/pos_active filter
      // server-side, exactly like the original queries — so a cost-discontinued
      // (INACTIVE) but pos_active sibling is KEPT and greyed here, never dropped.
      // SELLING-only (no base_price_sen leaves the endpoint, #625 cost strip).
      if (productId.startsWith('mfg-')) {
        const mfgRow = (await fetchMfgCatalog({ id: productId }))[0] ?? null;
        if (!mfgRow) return [];

        // Master-Admin's Modular ON/OFF is the single source of truth: a size is
        // offered only if it's in the Model's allowed_options.sizes (Chairman
        // 2026-06-01). Empty/absent sizes = no restriction (show all). Combined
        // with the per-SKU pos_active "Visible" flag below in sibsToRows so an
        // OFF size disappears from the picker instead of staying selectable.
        const modelRel = Array.isArray(mfgRow.product_models)
          ? mfgRow.product_models[0]
          : mfgRow.product_models;
        const allowedSizesArr = ((modelRel as { allowed_options?: { sizes?: string[] } } | null)
          ?.allowed_options?.sizes) ?? null;
        const allowedSizes = Array.isArray(allowedSizesArr) && allowedSizesArr.length > 0
          ? new Set(allowedSizesArr.map((s) => s.toUpperCase()))
          : null;

        // 2a — retail bridge exists: use admin-configured product_size_variants
        // via the existing pos-pools passthrough (already {sizeId,active,price,
        // pwpPrice:null}; legacy retail variants carry no PWP price).
        if (mfgRow.retail_product_id) {
          const { rows } = await authedFetch<{ rows: ProductSizeRow[] }>(
            `/pos-pools/product-size-variants?productId=${encodeURIComponent(mfgRow.retail_product_id)}`,
          );
          if (rows && rows.length > 0) return rows;
          // Fall through to mfg siblings if the retail link exists but has no variants yet.
        }

        // Helper: map sibling rows → ProductSizeRow[]. Drops sizes the Master
        // Admin turned OFF in Modular — a size is kept only if it's in the
        // Model's allowed_options.sizes (when restricted) AND its SKU is
        // pos_active (the "Visible" flag the catalog also honors). A kept size's
        // `active` still follows `status` so a cost-discontinued one greys out.
        // Case-insensitive size_code lookup guards older lowercase imports.
        const sibsToRows = (sibs: Array<{ size_code: string | null; sell_price_sen: number | null; pwp_price_sen: number | null; status: string; pos_active: boolean | null }>) =>
          sibs
            .filter((s) => {
              const sc = (s.size_code ?? '').toUpperCase();
              if (!sc || !(sc in MFG_SIZE_CODE_TO_LIB)) return false;
              if (s.pos_active === false) return false;          // OFF via Visible / catalog flag
              if (allowedSizes && !allowedSizes.has(sc)) return false; // OFF in Modular allowed_options
              return true;
            })
            .map((s) => ({
              sizeId: MFG_SIZE_CODE_TO_LIB[(s.size_code!).toUpperCase()] as string,
              // Surviving size: greys out only if cost-discontinued (status).
              active: (s.status as string) === 'ACTIVE',
              // SELLING price only (#625 cost strip — no base_price_sen fallback).
              price: s.sell_price_sen != null ? Math.round(s.sell_price_sen / 100) : 0,
              // PWP (换购, 0128) base price per size, whole MYR. 0 / null = not set.
              pwpPrice: s.pwp_price_sen ? Math.round(s.pwp_price_sen / 100) : null,
            }));

        // 2b — derive sizes from mfg_products siblings (same model_id — set by
        // generate-skus). sibsToRows drops sizes turned OFF in Modular /
        // pos_active so they vanish from the picker (Chairman 2026-06-01).
        if (mfgRow.model_id) {
          const siblings = await fetchMfgCatalog({ modelId: mfgRow.model_id });
          const rows = sibsToRows(siblings);
          if (rows.length > 0) return rows;
        }

        // 2b-alt — fallback for SKUs imported before the product_models layer
        // (model_id is NULL). Group by base_model + category instead — same
        // denormalised text that generate-skus stamps on every sibling.
        if (mfgRow.base_model && mfgRow.category) {
          const siblings = await fetchMfgCatalog({ baseModel: mfgRow.base_model, category: mfgRow.category });
          const rows = sibsToRows(siblings);
          if (rows.length > 0) return rows;
        }

        // 2c — truly orphan SKU: single size from this SKU's own code + price.
        // Case-insensitive so lowercase size_codes ('k' → 'K') are handled.
        const ownCode = (mfgRow.size_code ?? '').toUpperCase();
        if (ownCode && ownCode in MFG_SIZE_CODE_TO_LIB) {
          return [{
            sizeId: MFG_SIZE_CODE_TO_LIB[ownCode] as string,
            active: true,
            // SELLING price only (#625 cost strip — no base_price_sen fallback).
            price: mfgRow.sell_price_sen != null ? Math.round(mfgRow.sell_price_sen / 100) : 0,
            pwpPrice: mfgRow.pwp_price_sen ? Math.round(mfgRow.pwp_price_sen / 100) : null,
          }];
        }

        return [];
      }

      // ── Legacy UUID path (retail `products` table) ──────────────────────────
      // Houzs GET /pos-pools/product-size-variants → { rows: ProductSizeRow[] }
      // (already {sizeId,active,price,pwpPrice}; legacy retail variants carry a
      // null pwpPrice from the endpoint) — return as-is.
      const { rows } = await authedFetch<{ rows: ProductSizeRow[] }>(
        `/pos-pools/product-size-variants?productId=${encodeURIComponent(productId)}`,
      );
      return rows ?? [];
    },
  });

// size_library is small (7 rows) and changes rarely — cache aggressively so
// every Configurator screen doesn't re-fetch.
export interface SizeLibraryRow {
  id: string;
  label: string;
  widthCm: number;
  lengthCm: number;
  sortOrder: number;
}
export const useSizeLibrary = () =>
  useQuery({
    queryKey: ['size_library'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SizeLibraryRow[]> => {
      // Houzs GET /pos-pools/size-library → { rows: SizeLibraryRow[] }.
      // POST-CUTOVER NORMALIZE (same rationale as useCategoriesAll): Houzs's
      // scm.size_library.id is company-prefixed for company_2 ('2990-king',
      // '2990-queen', …) to avoid a global TEXT PK collision with HOUZS's
      // company_1 seed (mig 0089). POS-side lookup keys are unprefixed
      // ('king', 'queen') via MFG_SIZE_CODE_TO_LIB below and in size-info.ts.
      // Strip the prefix here so downstream lookups + the mattress SIZE picker
      // resolve. Prod live-verified: 7/7 co_2 rows carry the '2990-' prefix.
      const { rows } = await authedFetch<{ rows: SizeLibraryRow[] }>('/pos-pools/size-library');
      return (rows ?? [])
        .map((r) => ({ ...r, id: r.id.replace(/^2990-/, '') }))
        .sort((a, b) => a.sortOrder - b.sortOrder);
    },
  });

// All categories — including the TBC ones (Dining/Bathroom/Kids zone/Accessories).
// We can't derive these from the product list because TBC categories are by
// definition empty. Catalog sidebar reads from here so the "To be confirmed"
// section shows even when no products exist for those categories yet.
export interface CategoryRow {
  id: string;
  label: string;
  icon: string;
  tbc: boolean;
  sortOrder: number;
}
export const useCategoriesAll = () =>
  useQuery({
    queryKey: ['categories_all'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CategoryRow[]> => {
      // Houzs GET /categories → { categories: CategoryRow[] } (camelCase,
      // already {id,label,icon,tbc,sortOrder}).
      // Post-cutover normalize: Houzs's scm.categories.id is company-prefixed
      // (e.g. '2990-mattress') because the TEXT PK is globally unique across
      // companies (mig 0089). The POS was designed for a single-company world
      // and its product bucketing (`MFG_CATEGORY_ID['MATTRESS'] = 'mattress'`)
      // + Catalog.tsx cross-category rules (`p.categoryId === 'sofa'`, etc.)
      // compare against unprefixed lowercase ids. Strip the '2990-' prefix
      // here so sidebar ids match product buckets. POS is 2990-only
      // (VITE_HOUZS_COMPANY_ID=2 baked at build); safe to hardcode the prefix.
      const { categories } = await authedFetch<{ categories: CategoryRow[] }>('/categories');
      return (categories ?? [])
        .map((c) => ({ ...c, id: c.id.replace(/^2990-/, '') }))
        .sort((a, b) => a.sortOrder - b.sortOrder);
    },
  });

/* ─── Backend SKU Master catalog (mfg_products × product_models) ───────────
 *
 * PR — Commander 2026-05-27: "你的这个第一张照片，应该要接上我的这个 Product
 * Module 这一边。然后我的 Product Module 这一边也是会 upload 照片，所以就会
 * 变成第三张照片". POS Catalog needs to surface the SKU rows commander seeds
 * via the Backend (Products & Maintenance) AND show the Model-level photos
 * he uploaded via PR #97. The legacy `/products` table is the retail layer
 * that hasn't been wired through for Phase 1.5 yet — `mfg_products` is the
 * source of truth for what's in stock.
 *
 * The query joins:
 *   - mfg_products (status = ACTIVE) → one row per SKU
 *   - product_models (active = true) → for the photo_url + Model name
 * Categories sidebar counts roll up from this list (mattress / sofa /
 * bedframe). Cards render `model.photo_url` when present; fall back to the
 * monogram placeholder.
 *
 * Why direct Supabase (not the API): mfg_products / product_models have no
 * RLS configured (admin-managed catalogue, all authed staff can read). The
 * Worker /mfg-products route is auth'd via supabaseAuth which forwards the
 * same JWT; using the JS client here saves the extra hop and avoids a new
 * POS-specific endpoint. If RLS gets added later, swap to a Worker route.
 * ───────────────────────────────────────────────────────────────────────── */

export type MfgCatalogCategory = 'SOFA' | 'BEDFRAME' | 'MATTRESS' | 'ACCESSORY' | 'SERVICE';

export interface MfgCatalogRow {
  id:            string;
  code:          string;
  name:          string;
  category:      MfgCatalogCategory;
  /** Lowercase categories table id ('sofa' / 'bedframe' / 'mattress' / …).
      Derived from `category` so the sidebar filter can match against the
      `categories` table without UI doing two enum mappings. */
  categoryId:    string;
  description:   string | null;
  /** From mfg_products.branding (denormalized from the Model in PR #65). */
  branding:      string | null;
  sizeLabel:     string | null;
  basePriceSen:  number | null;
  modelId:       string | null;
  /** product_models.name — used for the card subtitle when present. */
  modelName:     string | null;
  /** product_models.photo_url — hero image flowed from the Model. */
  photoUrl:      string | null;
}

/** Resolve a Model photo_url (stored as relative proxy path
 *  `/product-models/{id}/photo/{key}`) against VITE_API_URL so the
 *  rendered <img> works from the POS origin. Absolute URLs (legacy /
 *  externally-hosted photos) pass through untouched. Returns null when
 *  there's no photo. */
function resolvePhotoUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!API_URL) return raw; // best effort during local dev — let it break visibly
  return raw.startsWith('/') ? `${API_URL}${raw}` : `${API_URL}/${raw}`;
}

/** Map mfg category enum → /categories table id used by the sidebar. */
const MFG_CATEGORY_ID: Record<MfgCatalogCategory, string> = {
  SOFA:      'sofa',
  BEDFRAME:  'bedframe',
  MATTRESS:  'mattress',
  ACCESSORY: 'accessory',
  SERVICE:   'accessory', // services aren't a catalog category — bucket under accessory tab
};

export const useMfgCatalog = () =>
  useQuery({
    queryKey: ['mfg-catalog'],
    staleTime: 30_000,
    // Houzs has NO realtime — poll in place of the `mfg-catalog` channel.
    refetchInterval: 30_000,
    queryFn: async (): Promise<MfgCatalogRow[]> => {
      // (P4.3) Ported to GET /pos-pools/mfg-catalog (no params) — the endpoint's
      // default view is pos_active=true regardless of status, matching this read's
      // original `.eq('pos_active', true)` with NO status filter, so a pos_active +
      // status=INACTIVE SKU still shows (greyed downstream). The product_models
      // join (id, name, photo_url, active) rides the same payload; SELLING-only
      // (basePriceSen = sell_price_sen, no base_price_sen fallback, #625 cost strip).
      const rows = await fetchMfgCatalog();

      return rows
        .map((r) => {
          const m = Array.isArray(r.product_models) ? r.product_models[0] : r.product_models;
          // Hide SKUs whose Model is currently deactivated — commander's
          // "All off" toggle on the Model Detail page should pull the whole
          // Model's variants from the POS catalog. SKUs without a model link
          // still show (orphan SKUs predate the Model layer).
          if (m && m.active === false) return null;
          return {
            id:           r.id,
            code:         r.code,
            name:         r.name,
            category:     r.category,
            categoryId:   MFG_CATEGORY_ID[r.category] ?? 'accessory',
            description:  r.description,
            branding:     r.branding,
            sizeLabel:    r.size_label,
            basePriceSen: r.sell_price_sen, // SELLING only (#625 cost strip)
            modelId:      r.model_id,
            modelName:    m?.name ?? null,
            // photo_url is stored as a relative proxy path from the API
            // (e.g. "/product-models/{id}/photo/{key}") — resolve against
            // VITE_API_URL so the <img> works from the POS origin. Absolute
            // URLs (legacy / migrated rows) pass through unchanged.
            photoUrl:     resolvePhotoUrl(m?.photo_url ?? null),
          } satisfies MfgCatalogRow;
        })
        .filter((r): r is MfgCatalogRow => r !== null);
    },
  });

/* ─── Sofa Customizer per-Model data (PR — Commander 2026-05-28) ──────────
 *
 * The POS Configurator's Custom build mode used to read the palette from
 * the LEGACY product_compartments table (per-Model active/price ticks). The
 * source of truth is now Backend → Products → Modular → [Model] → Allowed
 * Options (commander ticks which compartments + sizes this Model offers).
 *
 * This hook resolves a leadSkuId (the link target on /configure/:id) up to
 * the Model row's allowed_options, then ANDs that against the master
 * maintenance config's sofaCompartments pool + sofaCompartmentMeta map.
 * Output: an array of ResolvedCompartment rows the CustomBuilder palette
 * can render (image src, description, default price), grouped by the POS
 * palette buckets (1-seater / 2-seater / Corner / L-Shape / Accessory).
 *
 * The configurator can pass this data into <CustomBuilder modelCustomizer />
 * as an override layer; absent the prop the builder falls back to the
 * legacy pricing.compartments filter + bundled /sofa-modules/*.png assets.
 * ─────────────────────────────────────────────────────────────────────── */

export interface ResolvedSofaCompartment {
  /** Raw code as commander typed it (canonical parens form, e.g. '1A(LHF)'). */
  code:        string;
  /** Canonicalized code (parens form) — matches shared SOFA_MODULES.id. */
  normalizedCode: string;
  /** Free-text label for the palette card. */
  label:       string;
  /** Per-Model module SELLING price in sen (1 RM = 100), from this Model's
   *  module SKU `sell_price_sen`. 0 = unpriced (no SKU price set yet). */
  priceSen:    number;
  /** Fully-resolved image URL — Worker proxy when uploaded, /sofa-modules/<id>.png
   *  fallback otherwise. null = no image. */
  imageUrl:    string | null;
  /** POS palette group (1-seater / 2-seater / Corner / L-Shape / Accessory / Other). */
  group:       'Other' | '1-seater' | '2-seater' | 'Corner' | 'L-Shape' | 'Accessory';
}

export interface SofaCustomizerData {
  /** Compartments commander ticked on this Model, intersected with the master
   *  compartment pool. Each row carries the resolved photo + price + label. */
  compartments: ResolvedSofaCompartment[];
  /** Raw per-module SELLING rows for this Model (code + flat sell_price_sen +
   *  per-(size,tier) seat_height_prices). The Configurator builds a depth-aware
   *  P1 selling map from these (sofaModuleSellingPricesFromSkus) so the grid's
   *  per-seat-size price reaches the live total + palette; the query itself
   *  stays depth-agnostic. */
  sellingRows: Array<{
    code: string;
    sellPriceSen: number | null;
    seatHeightPrices: MfgSeatHeightPrice[] | null;
  }>;
  /** Seat-size inches commander ticked (24/26/28/30/32/35). */
  sizes:        string[];
  /** Leg height options ticked (subset of master pool). */
  legHeights:   string[];
  /** Special options ticked. */
  specials:     string[];
  /** Fabric COLOUR codes ticked on this Model (allowed_options.fabrics, e.g.
   *  'CG-002'). Empty = no fabrics enabled → picker shows "No fabrics enabled".
   *  The Configurator maps these → their series via fabric_colours, then filters
   *  the colour swatches to this set. */
  fabricIds:    string[];
  /** The Model row that resolved (so caller can show Model name / branding). */
  modelId:      string;
  modelName:    string;
  modelCode:    string;
}

interface MaintenanceCompartmentMeta {
  imageKey?:          string;
  description?:       string;
  defaultPriceCenti?: number;
}

/** Resolve a Maintenance compartment imageKey to a fetchable URL.
 *   - Worker-uploaded photos (`sofa-compartments/{code}/...`) go through the
 *     public Worker proxy so the POS <img src> works from any origin.
 *   - Legacy bundled paths (`sofa-modules/...`) go through /public.
 *   - Absolute http(s) URLs pass through. */
function resolveCompartmentPhoto(code: string, imageKey: string | undefined): string | null {
  if (!imageKey) return null;
  if (/^https?:\/\//i.test(imageKey)) return imageKey;
  if (imageKey.startsWith('sofa-compartments/')) {
    if (!API_URL) return null;
    return `${API_URL}/maintenance-config/sofa-compartments/${encodeURIComponent(code)}/photo/${encodeURIComponent(imageKey)}`;
  }
  return `/${imageKey}`;
}

/** Classify a compartment code into the POS palette group. Mirrors
 *  `classifySofaCompartment` from @2990s/shared. Works on the canonical
 *  parens form (and tolerates a stray legacy dash code). */
function classifyCompartmentCode(rawCode: string): ResolvedSofaCompartment['group'] {
  const norm = rawCode.trim();
  if (/^L[-(]/i.test(norm) || /^L$/i.test(norm)) return 'L-Shape';
  if (/^CNR$/i.test(norm) || /^CORNER/i.test(norm)) return 'Corner';
  if (/^STOOL|^Console|^WC-|^HEADREST/i.test(norm)) return 'Accessory';
  if (/^2/.test(norm)) return '2-seater';
  if (/^1/.test(norm)) return '1-seater';
  return 'Other';
}

/** Fetch + resolve everything the Custom Builder needs per the Model
 *  commander ticked from. Pass any SKU id from the catalog click — we
 *  follow `mfg_products.model_id → product_models` to land on the Model.
 *  When the SKU has no model_id (orphan, predates the Model layer), the
 *  query resolves to null and the configurator falls back to its legacy
 *  per-Model `products` row. */
export const useSofaCustomizerData = (leadSkuId: string | undefined) =>
  useQuery({
    enabled: !!leadSkuId,
    queryKey: ['sofa-customizer-data', leadSkuId],
    queryFn: async (): Promise<SofaCustomizerData | null> => {
      if (!leadSkuId) return null;

      // (P4.3) Ported to GET /pos-pools/mfg-catalog. Step 2 builds the per-Model
      // sofa MODULE SELLING-price map from every sofa SKU sharing base_model, via
      // the ?baseModel scope which carries NO status/pos_active filter server-side
      // — so an INACTIVE-but-pos_active module SKU stays in the price map exactly
      // as the original unfiltered query intended (HARD RULE 5). SELLING-only:
      // sell_price_sen + seat_height_prices[].sellingPriceSen; the endpoint strips
      // the per-height cost (priceSen) so nothing here can leak or misprice on cost.
      // Step 1: resolve the SKU → Model. mfg_products carries the model_id FK.
      const sku = (await fetchMfgCatalog({ id: leadSkuId }))[0] ?? null;
      if (!sku) return null;

      const model = Array.isArray(sku.product_models)
        ? sku.product_models[0]
        : sku.product_models;
      if (!model || sku.category !== 'SOFA') return null;

      // Per-Model module SELLING prices (SOFA-SELLING-PLAN, Chairman
      // 2026-05-31). Each module of this Model is its own mfg SKU (e.g.
      // BOOQIT-2A(LHF)); its `sell_price_sen` IS the per-Model module price the
      // Master Admin sets. Build the SAME normalized module→sen map the server
      // drift gate uses (shared `sofaModulePricesFromSkus`) so the live total
      // and the server price from one source. Replaces the old global
      // sofaCompartmentMeta.defaultPriceCenti read.
      //
      // Scope by base_model (= model_code) — the SAME key the server uses
      // (loadModelSofaModulePrices) and the same key combo scoping uses, so the
      // POS and server SKU sets are identical by construction (not just for
      // today's data). model_code === base_model on every sofa SKU.
      const skuPriceRows = await fetchMfgCatalog({ baseModel: model.model_code, category: 'SOFA' });
      // Raw per-module SELLING rows. The flat `modulePrices` (depth/tier-agnostic
      // sell_price_sen) is the fallback; the Configurator rebuilds a depth-aware
      // P1 selling map from `sellingRows` so the per-seat-size grid price reaches
      // the live total + palette (SOFA-SELLING Phase B; Chairman 2026-06-01: run
      // at P1, no fabric-tier variation yet).
      const sellingRows = skuPriceRows.map((r) => ({
        code: r.code,
        sellPriceSen: r.sell_price_sen,
        seatHeightPrices: r.seat_height_prices,
      }));
      const modulePrices = sofaModulePricesFromSkus(sellingRows, model.model_code);

      const allowed = (model.allowed_options ?? {}) as {
        compartments?: string[];
        sizes?:        string[];
        leg_heights?:  string[];
        specials?:     string[];
      };

      // Step 2: pull the current effective master maintenance config so we can
      // resolve compartment images + descriptions. (P4.3) Ported to
      // GET /maintenance-config/resolved?scope=master, which returns the same
      // effective-dated master config blob (respecting effective_from) this read
      // used to select from maintenance_config_history — image/label meta only,
      // no pricing (module price comes from modulePrices above).
      const resolved = await authedFetch<MaintenanceResolved>('/maintenance-config/resolved?scope=master');
      const cfg = (resolved.data ?? {}) as {
        sofaCompartmentMeta?: Record<string, MaintenanceCompartmentMeta>;
        sofaCompartments?:    string[];
      };
      const metaMap = cfg.sofaCompartmentMeta ?? {};

      const tickedCompartments = allowed.compartments ?? [];
      const compartments: ResolvedSofaCompartment[] = tickedCompartments.map((rawCode) => {
        const meta = metaMap[rawCode] ?? {};
        // Legacy bundled SVG fallback — when commander hasn't uploaded a
        // photo yet, render the design-system's hand-drawn SVG so the
        // palette card isn't empty. Maintenance UI auto-seeds the imageKey
        // (defaulting to `sofa-modules/<CANONICAL_ID>.svg`) on read but
        // stored overrides may omit it.
        const norm = normalizeCompartmentCode(rawCode);
        const imageKey = meta.imageKey ?? `sofa-modules/${representativeArtCode(rawCode)}.svg`;
        return {
          code:           rawCode,
          normalizedCode: norm,
          label:          meta.description ?? rawCode,
          // Per-Model module SELLING price from this Model's module SKU
          // (SOFA-SELLING-PLAN). meta is still the source for image + label.
          priceSen:       modulePrices[norm] ?? 0,
          imageUrl:       resolveCompartmentPhoto(rawCode, imageKey),
          group:          classifyCompartmentCode(rawCode),
        };
      });

      return {
        compartments,
        sellingRows,
        sizes:      allowed.sizes ?? [],
        legHeights: allowed.leg_heights ?? [],
        specials:   allowed.specials ?? [],
        // Fabric IDs commander ticked on this Model (from allowed_options.fabrics).
        // Empty array = no fabrics configured → Configurator hides fabric picker.
        fabricIds:  (allowed as { fabrics?: string[] }).fabrics ?? [],
        modelId:    model.id,
        modelName:  model.name,
        modelCode:  model.model_code,
      };
    },
    staleTime: 30_000,
    // Houzs has NO realtime — poll in place of the `sofa-customizer-${leadSkuId}` channel.
    refetchInterval: 30_000,
  });

/** Realtime invalidate on mfg_products + product_models edits so commander's
 *  Backend changes land on the POS catalog within ~300ms. Mirrors the
 *  prototype's localStorage push but via Supabase Realtime. */
export const useMfgCatalogRealtime = () => {
  /* (P4.3) no-op — polling replaces the `mfg-catalog` realtime channel
     (see useMfgCatalog refetchInterval). Kept exported so callers are unchanged. */
};

// my_localities is a static Malaysia postcode dataset (~3000 rows). Fetched
// once and cached forever — the seed file regenerates only when the upstream
// dataset is refreshed (see packages/db/scripts/build-my-localities-seed.mjs).
// Used by Handover to drive cascading state → city → postcode dropdowns.
//
// Supabase PostgREST caps responses at 1000 rows; we page through with
// .range() and stop when a batch returns short. Three round-trips on first
// open, then served from cache for the rest of the session.
export interface LocalityRow {
  postcode: string;
  city: string;
  state: string;
  stateCode: string;
}
export const useLocalities = () =>
  useQuery({
    queryKey: ['my_localities'],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<LocalityRow[]> => {
      // Houzs GET /localities → { localities:[{postcode,city,state,stateCode}] }.
      // The server returns the full postcode dataset in one response (no
      // PostgREST 1000-row cap to page around).
      const { localities } = await authedFetch<{ localities: LocalityRow[] }>('/localities');
      return (localities ?? []).map((r) => ({
        postcode: r.postcode, city: r.city, state: r.state, stateCode: r.stateCode,
      }));
    },
  });

/** PR — Commander 2026-05-28: realtime invalidate the sofa customizer
 *  cache whenever commander edits the Model row (allowed_options) OR the
 *  master maintenance_config_history row (compartment meta). Mirrors the
 *  catalog realtime hook; mount inside the Configurator so a price/photo
 *  tweak in the Backend lands within ~300ms. */
export const useSofaCustomizerRealtime = (_leadSkuId: string | undefined) => {
  /* (P4.3) no-op — polling replaces the `sofa-customizer-${leadSkuId}` realtime
     channel (see useSofaCustomizerData refetchInterval). Kept exported so callers
     are unchanged. */
};

// Realtime invalidate any product_bundles / product_compartments / product_size_variants
// row matching this productId. Used inside Configurator so Backend price tweaks
// land within ~300ms.
export const useProductPricingRealtime = (_productId: string | undefined) => {
  /* (P4.3) no-op — polling replaces the `product-pricing-${productId}` realtime
     channel. The per-product pricing queries (bundles / compartments / fabrics /
     bedframe-colours / sizes / product) each carry refetchInterval: 30_000 so a
     Backend price tweak lands within one poll. Kept exported so callers are
     unchanged. */
};

/* ─── Delivery fee config ─── */

export interface DeliveryFeeConfigRow {
  baseFee:                  number;
  crossCategoryFee:         number;
  mattressBedframeLeadDays: number;
  sofaLeadDays:             number;
}

export const useDeliveryFeeConfig = () =>
  useQuery({
    queryKey: ['delivery-fee-config'],
    queryFn: async (): Promise<DeliveryFeeConfigRow> => {
      const body = await authedFetch<{
        baseFee:                  number;
        crossCategoryFee:         number;
        mattressBedframeLeadDays: number;
        sofaLeadDays:             number;
      }>('/delivery-fees');
      return {
        baseFee:                  body.baseFee,
        crossCategoryFee:         body.crossCategoryFee,
        mattressBedframeLeadDays: body.mattressBedframeLeadDays,
        sofaLeadDays:             body.sofaLeadDays,
      };
    },
    staleTime: 60_000,
  });

/* ─── Fabric-tier add-on config (migration 0124) — the 4 Δ amounts ─── */

export interface FabricTierAddonConfigRow {
  sofaTier2Delta:     number;
  sofaTier3Delta:     number;
  bedframeTier2Delta: number;
  bedframeTier3Delta: number;
}

export const useFabricTierAddonConfig = () =>
  useQuery({
    queryKey: ['fabric-tier-addon-config'],
    queryFn: async (): Promise<FabricTierAddonConfigRow> => {
      const body = await authedFetch<FabricTierAddonConfigRow>('/fabric-tier-addon');
      return {
        sofaTier2Delta:     body.sofaTier2Delta,
        sofaTier3Delta:     body.sofaTier3Delta,
        bedframeTier2Delta: body.bedframeTier2Delta,
        bedframeTier3Delta: body.bedframeTier3Delta,
      };
    },
    staleTime: 60_000,
  });

/** Master Account (cost/sell split Phase 2) — writes the delivery-fee config
 *  (base fee + cross-category surcharge + lead-days). The whole block moved to
 *  the POS Master Account surface; the Backend editor was retired. Gated by the
 *  delivery_fee_config UPDATE RLS policy + the API WRITE_ROLES (admin /
 *  coordinator / master_account). */
export const useUpdateDeliveryFeeConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: {
      baseFee?:                  number;
      crossCategoryFee?:         number;
      mattressBedframeLeadDays?: number;
      sofaLeadDays?:             number;
    }) => {
      const res = await authedFetchRaw('/delivery-fees', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `PATCH /delivery-fees failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-fee-config'] }); },
  });
};

/* ─── Special delivery fee rules (RuleTarget targeting, migration 0182) ───
 *
 * Reuses the #691 RuleTarget abstraction. A rule's `target` is a RuleTarget[]:
 * each entry scopes by model / variant (size codes) / combo / compartment.
 * model & variant carry a real modelId; combo & compartment are model-agnostic
 * (modelId may be empty). The server (deliveryTargetMatchesAnyLine) runs the
 * SAME shared matcher when it recomputes the fee — these hooks only drive the
 * Master editor + the Handover summary preview. */

export interface SpecialDeliveryFeeRow {
  id:                  string;
  target:              RuleTarget[];
  standaloneFee:       number;        // whole MYR
  crossCatFollowupFee: number;        // whole MYR
  label:               string | null;
}

/** List the special delivery fee rules. Read by the Master editor AND the
 *  Handover summary (so the shown fee matches what the server charges when a
 *  matching line is in the cart). */
export const useSpecialDeliveryFees = () =>
  useQuery({
    queryKey: ['special-delivery-fees'],
    queryFn: async (): Promise<SpecialDeliveryFeeRow[]> => {
      return await authedFetch<SpecialDeliveryFeeRow[]>('/delivery-fees/special');
    },
    staleTime: 60_000,
  });

/** PUT body mirrors Task 3: omit `id` to insert, pass it to update. */
export interface UpsertSpecialDeliveryFeeInput {
  id?:                 string;
  target:              RuleTarget[];
  standaloneFee:       number;        // whole MYR, >= 0
  crossCatFollowupFee: number;        // whole MYR, >= 0
  label?:              string;
}

export const useUpsertSpecialDeliveryFee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: UpsertSpecialDeliveryFeeInput) => {
      const res = await authedFetchRaw('/delivery-fees/special', {
        method: 'PUT',
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `PUT /delivery-fees/special failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['special-delivery-fees'] }); },
  });
};

export const useDeleteSpecialDeliveryFee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await authedFetchRaw(`/delivery-fees/special/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `DELETE /delivery-fees/special failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['special-delivery-fees'] }); },
  });
};

/** Global sofa compartment code pool (canonical parens form, e.g. '1A(LHF)').
 *  Sourced from the master maintenance config's `sofaCompartments` pool — the
 *  same list the RuleTargetPicker offers for `scope: 'compartment'` rules. */
export const useCompartmentPool = (): string[] => {
  const { data } = useMaintenanceConfig('master');
  return maintActiveValues(data?.data?.sofaCompartments ?? []);
};

/* ─── Cross-category link eligibility (migration 0141) ─── */

export interface CrossCategoryEligibility {
  eligible:   boolean;
  debtorName: string | null;
  /** Human reason when not eligible (e.g. "Order SO-2605 was not found."). */
  message:    string | null;
}

/** Live-validate a "Previous SO number" so the handover only applies the
 *  cross-category delivery discount for a REAL, eligible SO. Same checks as the
 *  order POST (exists / not cancelled / same customer / not already used) — so
 *  typing a random value no longer shows the reduced rate. Pass a DEBOUNCED
 *  docNo; the query only runs when it's non-empty. */
export const useCrossCategoryEligibility = (docNo: string, phone: string) =>
  useQuery({
    queryKey: ['cross-cat-eligibility', docNo, phone],
    enabled: docNo.trim().length > 0,
    retry: 0,
    staleTime: 10_000,
    queryFn: async (): Promise<CrossCategoryEligibility> => {
      const qs = new URLSearchParams({ docNo: docNo.trim(), phone: phone.trim() });
      return await authedFetch<CrossCategoryEligibility>(
        `/mfg-sales-orders/cross-category-eligibility?${qs.toString()}`,
      );
    },
  });

export interface CrossCategoryMatchResult {
  found:       boolean;
  docNo?:      string;
  debtorName?: string | null;
}

/** "Auto-match" button on the Confirm screen — scans the customer's earlier SOs
 *  (by the name + phone identity) and returns the most recent one that can still
 *  back a cross-category follow-up. A mutation, not a query, so it fires only on
 *  the button press. The caller fills the returned docNo into the SO field; the
 *  live eligibility check above then confirms it. */
export const useCrossCategoryAutoMatch = () =>
  useMutation({
    mutationFn: async ({ name, phone }: { name: string; phone: string }): Promise<CrossCategoryMatchResult> => {
      const qs = new URLSearchParams({ name: name.trim(), phone: phone.trim() });
      return await authedFetch<CrossCategoryMatchResult>(
        `/mfg-sales-orders/cross-category-match?${qs.toString()}`,
      );
    },
  });

/** Master Admin — writes the 4 fabric-tier Δ amounts (PATCH /fabric-tier-addon).
 *  Gated by the fabric_tier_addon_config UPDATE RLS + API WRITE_ROLES (0124). */
export const useUpdateFabricTierAddonConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<FabricTierAddonConfigRow>) => {
      const res = await authedFetchRaw('/fabric-tier-addon', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `PATCH /fabric-tier-addon failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fabric-tier-addon-config'] }); },
  });
};

/** Master Admin — sets a fabric's SELLING tier (PATCH /fabric-library/:id/tier).
 *  field 'sofaTier' | 'bedframeTier'; tier PRICE_1/2/3 (migration 0124). */
export const useUpdateFabricLibraryTier = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, field, tier }: { id: string; field: 'sofaTier' | 'bedframeTier'; tier: 'PRICE_1' | 'PRICE_2' | 'PRICE_3' }) => {
      const res = await authedFetchRaw(`/fabric-library/${encodeURIComponent(id)}/tier`, {
        method: 'PATCH',
        body: JSON.stringify({ field, tier }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `PATCH /fabric-library tier failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fabric-library'] }); },
  });
};

/* ─── Per-Model fabric-tier Δ overrides (migration 0172) ─── */

export interface ModelFabricTierOverrideRow {
  modelId:    string;
  modelName:  string;
  modelCode:  string | null;
  category:   string | null;
  tier2Delta: number | null;   // whole MYR; null = inherit global
  tier3Delta: number | null;
}

/** List Models tagged with a fabric-tier override. Read by the Master editor
 *  AND every POS Δ surface (so the shown add-on matches what the server
 *  charges for a special Model). */
export const useModelFabricTierOverrides = () =>
  useQuery({
    queryKey: ['model-fabric-tier-overrides'],
    queryFn: async (): Promise<ModelFabricTierOverrideRow[]> => {
      return await authedFetch<ModelFabricTierOverrideRow[]>('/fabric-tier-addon/special');
    },
    staleTime: 60_000,
  });

export const useUpsertModelFabricTierOverride = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { modelId: string; tier2Delta: number | null; tier3Delta: number | null }) => {
      const res = await authedFetchRaw('/fabric-tier-addon/special', {
        method: 'PUT',
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `PUT /fabric-tier-addon/special failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['model-fabric-tier-overrides'] }); },
  });
};

export const useDeleteModelFabricTierOverride = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modelId: string) => {
      const res = await authedFetchRaw(`/fabric-tier-addon/special/${encodeURIComponent(modelId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `DELETE /fabric-tier-addon/special failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['model-fabric-tier-overrides'] }); },
  });
};

/* ─── Per-compartment fabric-tier Δ overrides (migration 0184) ─── */

export interface CompartmentFabricTierOverrideRow {
  compartmentId: string;
  tier2Delta:    number | null;   // whole MYR; null = inherit global
  tier3Delta:    number | null;
}

/** List compartment codes tagged with a fabric-tier override. Read by the
 *  Master editor AND every POS Δ surface so the shown add-on matches what
 *  the server charges for a special compartment on a custom build. */
export const useCompartmentFabricTierOverrides = () =>
  useQuery({
    queryKey: ['compartment-fabric-tier-overrides'],
    queryFn: async (): Promise<CompartmentFabricTierOverrideRow[]> => {
      return await authedFetch<CompartmentFabricTierOverrideRow[]>('/fabric-tier-addon/compartment-special');
    },
    staleTime: 60_000,
  });

export const useUpsertCompartmentFabricTierOverride = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { compartmentId: string; tier2Delta: number | null; tier3Delta: number | null }) => {
      const res = await authedFetchRaw('/fabric-tier-addon/compartment-special', {
        method: 'PUT',
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `PUT /fabric-tier-addon/compartment-special failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['compartment-fabric-tier-overrides'] }); },
  });
};

export const useDeleteCompartmentFabricTierOverride = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (compartmentId: string) => {
      const res = await authedFetchRaw(`/fabric-tier-addon/compartment-special/${encodeURIComponent(compartmentId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `DELETE /fabric-tier-addon/compartment-special failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['compartment-fabric-tier-overrides'] }); },
  });
};

/* ─── Per-Model default free gifts (migration 0174) ────────────────────
 *
 * GET /model-free-gifts   → list of ModelDefaultGiftRow
 * PUT /model-free-gifts   → upsert { modelId, gifts }
 * DELETE /model-free-gifts/:modelId → remove override
 *
 * Read by the PWP & Promo tab (PwpRulesTab) editor AND the cart reconciler
 * (useFreeGiftSync) so the cart knows which gift lines to maintain. */
export interface ModelDefaultGiftRow {
  modelId: string;
  modelName: string;
  modelCode: string | null;
  category: string | null;
  gifts: DefaultFreeGift[];
  updatedAt: string;
}

export const useModelDefaultGifts = () =>
  useQuery({
    queryKey: ['model-default-gifts'],
    queryFn: async (): Promise<ModelDefaultGiftRow[]> => {
      return await authedFetch<ModelDefaultGiftRow[]>('/model-free-gifts');
    },
    staleTime: 60_000,
  });

export const useUpsertModelDefaultGifts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { modelId: string; gifts: DefaultFreeGift[] }) => {
      const res = await authedFetchRaw('/model-free-gifts', {
        method: 'PUT',
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(b.reason ?? b.error ?? `PUT /model-free-gifts failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['model-default-gifts'] }); },
  });
};

export const useDeleteModelDefaultGifts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modelId: string) => {
      const res = await authedFetchRaw(`/model-free-gifts/${encodeURIComponent(modelId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(b.reason ?? b.error ?? `DELETE /model-free-gifts failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['model-default-gifts'] }); },
  });
};

/* ─── Free Item Campaigns (migration 0176) ───────────────────────────────
 * GET /free-item-campaigns        → all (admin editor)
 * GET /free-item-campaigns?active=1 → active (cart "Make free")
 * POST / PATCH /:id / DELETE /:id  → editor mutations */
export type FreeItemCampaignRow = FreeItemCampaign;

const fic = async (path: string, init?: RequestInit) => {
  const res = await authedFetchRaw(path, init);
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
    throw new Error(b.reason ?? b.error ?? `${init?.method ?? 'GET'} ${path} failed (${res.status})`);
  }
  return res;
};

export const useFreeItemCampaigns = () =>
  useQuery({
    queryKey: ['free-item-campaigns'],
    queryFn: async (): Promise<FreeItemCampaignRow[]> => (await (await fic('/free-item-campaigns')).json()) as FreeItemCampaignRow[],
    staleTime: 60_000,
  });

export const useActiveFreeItemCampaigns = () =>
  useQuery({
    queryKey: ['free-item-campaigns', 'active'],
    queryFn: async (): Promise<FreeItemCampaignRow[]> => (await (await fic('/free-item-campaigns?active=1')).json()) as FreeItemCampaignRow[],
    staleTime: 60_000,
  });

type FreeItemCampaignInput = { name: string; active: boolean; maxFreeQty: number; eligible: FreeItemEligibility[] };

export const useCreateFreeItemCampaign = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FreeItemCampaignInput) => { await fic('/free-item-campaigns', { method: 'POST', body: JSON.stringify(input) }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['free-item-campaigns'] }); },
  });
};

export const useUpdateFreeItemCampaign = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: FreeItemCampaignInput & { id: string }) => {
      await fic(`/free-item-campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['free-item-campaigns'] }); },
  });
};

export const useDeleteFreeItemCampaign = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await fic(`/free-item-campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['free-item-campaigns'] }); },
  });
};

/* ─── Special add-ons (migration 0133) — Product Add-ons CRUD ──────────
 *
 * The grown-up "Specials": per-Model product add-on (selling surcharge +
 * 0..N follow-up choice groups) shown as an SO line description, not a SKU.
 * Read by any staff; writes go through /special-addons (admin-set role gate +
 * RLS). selling/cost may be NEGATIVE (a deduction). `code` is the stable key
 * reused by allowed_options.specials + variants.specials. */
export interface SpecialAddonChoice { label: string; extraSen: number; }
export interface SpecialAddonGroup { label: string; required: boolean; choices: SpecialAddonChoice[]; }
export interface SpecialAddonRow {
  id: string;
  code: string;
  label: string;
  soDescription: string;
  categories: string[];
  sellingPriceSen: number;
  costPriceSen: number;
  optionGroups: SpecialAddonGroup[];
  active: boolean;
  sortOrder: number;
}
export interface SpecialAddonInput {
  code: string;
  label: string;
  soDescription: string;
  categories: string[];
  sellingPriceSen: number;
  costPriceSen: number;
  optionGroups: SpecialAddonGroup[];
  active: boolean;
  sortOrder: number;
}

export const useSpecialAddons = () =>
  useQuery({
    queryKey: ['special-addons'],
    staleTime: 60_000,
    queryFn: async (): Promise<SpecialAddonRow[]> => {
      const body = await authedFetch<{ addons: SpecialAddonRow[] }>('/special-addons');
      return body.addons ?? [];
    },
  });

export const useCreateSpecialAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SpecialAddonInput) => {
      const res = await authedFetchRaw('/special-addons', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `POST /special-addons failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['special-addons'] }); },
  });
};

export const useUpdateSpecialAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SpecialAddonInput> }) => {
      const res = await authedFetchRaw(`/special-addons/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `PATCH /special-addons failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['special-addons'] }); },
  });
};

export const useDeleteSpecialAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await authedFetchRaw(`/special-addons/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `DELETE /special-addons failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['special-addons'] }); },
  });
};

/* ─── Sales staff (LockScreen pre-session list) ───────────────────────
 *
 * This query is unique: it MUST work BEFORE Supabase auth, because the
 * LockScreen shows the staff picker before anyone has logged in. So we
 * hit the unauthenticated Worker route directly (no bearer token), and
 * cache the last response in localStorage so cold-boot offline still
 * shows the picker. The route is authenticated by network position
 * (CF Worker behind the same domain) + showroomId filtering, not JWT.
 */

const SHOWROOM_ID = import.meta.env.VITE_POS_SHOWROOM_ID as string | undefined;

export interface SalesStaffRow {
  id: string;
  staffCode: string;
  name: string;
  initials: string;
  color: string;
}

const SALES_STAFF_CACHE_KEY = 'pos:sales-staff-cache';

/* ─── Sales stats (My Orders KPI cards) ────────────────────────────────
 *
 * Calendar-month totals + counts for the current sales user, scoped to
 * the user's home showroom. RLS would clamp this to "own orders only"
 * if hit via the JS client — the server endpoint uses service-role to
 * compute showroom-wide aggregates and then returns both numbers.
 */

export interface SalesStatsRow {
  monthLabel:     string;
  monthStart:     string | null;
  monthEnd:       string | null;
  staffName:      string;
  showroomTotal:  number;
  showroomCount:  number;
  personalTotal:  number;
  personalCount:  number;
  // Revenue split per card (Loo 2026-06-20). Products = goods − KPI add-ons (the
  // threshold base, excl. KPI + service); Service = delivery + every SERVICE
  // line; KPI = the item-KPI flagged add-on amount. The three sum to *Total.
  showroomProducts: number;
  showroomService:  number;
  showroomKpi:      number;
  personalProducts: number;
  personalService:  number;
  personalKpi:      number;
}

/* `window` = the My-orders toolbar period (MY-local YYYY-MM-DD, `to` inclusive).
   Omitted / empty → the server defaults to the current calendar month. The two
   bounds are part of the query key so each selected period caches separately. */
export const useSalesStats = (
  window?: { from: string | null; to: string | null },
  salesperson?: string | null,
) =>
  useQuery({
    queryKey: ['pos', 'sales-stats', window?.from ?? null, window?.to ?? null, salesperson ?? null],
    staleTime: 60_000,
    queryFn: async (): Promise<SalesStatsRow> => {
      const params = new URLSearchParams();
      if (window?.from) params.set('from', window.from);
      if (window?.to)   params.set('to', window.to);
      // Owner-tier only: scope the Personal card to a chosen salesperson.
      if (salesperson && salesperson !== 'all') params.set('salesperson', salesperson);
      const qs = params.toString();
      // /pos/sales-stats lives at /api/pos (NOT under /api/scm), so route it via
      // posApiBase() — same as verify-pin/set-pin. Without the override authedFetch
      // used the /api/scm base and 404'd on Houzs (My-Orders KPI tiles blank).
      return await authedFetch<SalesStatsRow>(`/pos/sales-stats${qs ? `?${qs}` : ''}`, undefined, posApiBase());
    },
  });

/* ─── Sofa Combo Pricing ──────────────────────────────────────────────
   Commander 2026-05-28: Sofa Combos defined in Backend = COSTING; the same
   rows surfaced in POS = SELLING PRICE. POS Quick Pick auto-renders one
   card per combo (combo.label + the price for the active seat height).
   ────────────────────────────────────────────────────────────────────── */

export type SofaPriceTier = 'PRICE_1' | 'PRICE_2' | 'PRICE_3';

export interface SofaComboRow {
  id: string;
  baseModel: string;
  /** OR-set per slot: ordered slots, each an array of alternative codes. */
  modules: string[][];
  tier: SofaPriceTier | null;
  customerId: string | null;
  pricesByHeight: Record<string, number | null>;
  /** SELLING prices per height (Master Admin). The engine charges these merged
   *  over cost via comboChargedPrices — `pricesByHeight` above is the COST side. */
  sellingPricesByHeight: Record<string, number | null>;
  /** PWP (换购) selling price per height (Phase 2). Charged instead of selling
   *  when a sofa-reward line redeems a valid PWP code. {} = unset. POS-only. */
  pwpPricesByHeight?: Record<string, number | null>;
  label: string | null;
  effectiveFrom: string;
  deletedAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

/**
 * Fetch active sofa-combo rows. Pass `baseModel` to filter; omit for ALL.
 * Returns [] when the API is unreachable (combos are optional — Quick Pick
 * still works with the legacy BUNDLES path).
 *
 * 2026-05-28: POS doesn't yet have a clean POS-product → mfg_products.base_model
 * link, so the Configurator fetches ALL combos and shows them as a separate
 * "Combo Pricing" row. Each card carries the base_model chip so commander can
 * see at a glance which Model the combo applies to. Filtering by current Model
 * lands once the retail↔mfg bridge surfaces base_model on CatalogProduct.
 */
export const useSofaCombos = (baseModel?: string | null) =>
  useQuery({
    queryKey: ['sofa-combos', baseModel ?? 'all'],
    queryFn: async (): Promise<SofaComboRow[]> => {
      const params = new URLSearchParams();
      if (baseModel) params.set('baseModel', baseModel);
      params.set('customerId', '__all__');  // 2990 is B2C — only default-scope rows
      // POS may render anonymously (no token) or with the API base unset —
      // authedFetchRaw throws in both cases; combos are optional so quietly
      // return []. A non-ok status also degrades to [] (Quick Pick still works).
      let res: Response;
      try {
        // Houzs: the admin /sofa-combos is cost-gated (returns supplier cost +
        // supplierId, no openRead). The POS reads the cost-stripped seam variant
        // /pos-pools/sofa-combos — sellingPricesByHeight already = charged
        // (selling ?? cost), pricesByHeight = {}, so the merge below is a no-op
        // that matches the server recompute. 2990 keeps the flat /sofa-combos.
        const combosPath = IS_HOUZS ? '/pos-pools/sofa-combos' : '/sofa-combos';
        res = await authedFetchRaw(`${combosPath}?${params.toString()}`);
      } catch {
        return [];
      }
      if (!res.ok) return [];
      const body = (await res.json()) as { rules: SofaComboRow[] };
      // The engine's pricesByHeight is the CHARGED (selling) price: selling wins
      // per height, falling back to cost. Same merge the server gate uses, so
      // POS live total and server recompute price from one source.
      return (body.rules ?? []).map((r) => ({
        ...r,
        pricesByHeight: comboChargedPrices(r.sellingPricesByHeight, r.pricesByHeight),
      }));
    },
    staleTime: 30_000,
  });

/* Commander 2026-05-28 — "Save as Quick Pick" from POS Customize.
   Persists the current cell layout as a new Sofa Combo row so it
   appears in the Quick Pick row next time. Backend Maintenance can
   then tweak the price tier / effective date later. */
export const useCreateSofaCombo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      baseModel: string;       // '' allowed (wildcard)
      modules: string[][];     // OR-set per slot
      tier: SofaPriceTier | null;
      /** COST per height (centi). Optional — when omitted, the server
       *  auto-detects it = Σ the constituent module SKUs' costs (Master Admin
       *  creates a Combo on POS knowing only the SELLING price; Chairman
       *  2026-05-31). Backend-overridable later. */
      pricesByHeight?: Record<string, number | null>;  // centi (COST)
      /** SELLING per height (centi) — what the customer pays (Master Admin). */
      sellingPricesByHeight?: Record<string, number | null>;  // centi (SELLING)
      /** PWP (换购) selling per height (centi) — Phase 2. {} = unset. */
      pwpPricesByHeight?: Record<string, number | null>;
      label?: string | null;
      effectiveFrom: string;   // 'YYYY-MM-DD'
      notes?: string | null;
    }): Promise<SofaComboRow> => {
      const res = await authedFetchRaw('/sofa-combos', {
        method: 'POST',
        body: JSON.stringify({
          baseModel: body.baseModel,
          modules: body.modules,
          tier: body.tier,
          customerId: null,  // 2990 is B2C
          // Omit pricesByHeight when not set so the server auto-detects COST.
          ...(body.pricesByHeight !== undefined ? { pricesByHeight: body.pricesByHeight } : {}),
          ...(body.sellingPricesByHeight !== undefined ? { sellingPricesByHeight: body.sellingPricesByHeight } : {}),
          ...(body.pwpPricesByHeight !== undefined ? { pwpPricesByHeight: body.pwpPricesByHeight } : {}),
          label: body.label ?? null,
          effectiveFrom: body.effectiveFrom,
          notes: body.notes ?? null,
        }),
      });
      if (!res.ok) {
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
        throw new Error(`POST /sofa-combos failed (${res.status}): ${detail}`);
      }
      return (await res.json()) as SofaComboRow;
    },
    onSuccess: () => {
      // Combos refetch so the new card lands in Quick Pick on next render.
      void qc.invalidateQueries({ queryKey: ['sofa-combos'] });
    },
  });
};

/* ─── Sofa Quick Picks (global layer) ─────────────────────────────────────
   Phase 5 (Chairman 2026-05-31): a Quick Pick is a VISIBLE saved sofa LAYOUT
   for easy selection (it may be unpriced). The card price is computed by the
   pricing engine — these rows carry NO price. Master Admin curates the global
   layer (sofa_quick_picks); the personal layer lives in state/quickpicks.ts.
   Combos stay invisible (they auto-apply on module match via the engine). */
export interface SofaQuickPickRow {
  id: string;
  baseModel: string;
  label: string | null;
  /** OR-set per slot (string[][]); the layout the salesperson taps to start. */
  modules: string[][];
  depth: string;
  sortOrder: number;
  createdAt: string;
  createdBy: string | null;
}

/** Active global Quick Picks for one Model (or all when baseModel omitted). */
export const useSofaQuickPicks = (baseModel?: string | null) =>
  useQuery({
    queryKey: ['sofa-quick-picks', baseModel ?? 'all'],
    queryFn: async (): Promise<SofaQuickPickRow[]> => {
      const params = new URLSearchParams();
      if (baseModel) params.set('baseModel', baseModel);
      // POS may render anonymously (no token) or with the API base unset —
      // authedFetchRaw throws in both cases; Quick Picks are optional so quietly
      // return []. A non-ok status also degrades to [].
      let res: Response;
      try {
        res = await authedFetchRaw(`/sofa-quick-picks${params.toString() ? `?${params.toString()}` : ''}`);
      } catch {
        return [];
      }
      if (!res.ok) return [];
      const body = (await res.json()) as { picks: SofaQuickPickRow[] };
      return body.picks ?? [];
    },
    staleTime: 30_000,
    // Houzs has NO realtime — poll in place of the `sofa-quick-picks` channel.
    refetchInterval: 30_000,
  });

/** (P4.3) no-op — polling replaces the `sofa-quick-picks` realtime channel
 *  (see useSofaQuickPicks refetchInterval). Kept exported so callers are
 *  unchanged. */
export const useSofaQuickPicksRealtime = () => {
  /* no-op */
};

/** Create a GLOBAL Quick Pick (Master Admin curates; server role-gates). */
export const useCreateSofaQuickPick = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      baseModel: string;
      modules: string[][];   // OR-set per slot (a POS save = singleton slots)
      depth: string;
      label?: string | null;
    }): Promise<SofaQuickPickRow> => {
      const res = await authedFetchRaw('/sofa-quick-picks', {
        method: 'POST',
        body: JSON.stringify({
          baseModel: body.baseModel,
          modules: body.modules,
          depth: body.depth,
          label: body.label ?? null,
        }),
      });
      if (!res.ok) {
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
        throw new Error(`POST /sofa-quick-picks failed (${res.status}): ${detail}`);
      }
      return (await res.json()) as SofaQuickPickRow;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sofa-quick-picks'] });
    },
  });
};

/** Soft-delete a GLOBAL Quick Pick (server role-gates). */
export const useDeleteSofaQuickPick = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await authedFetchRaw(`/sofa-quick-picks/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
        throw new Error(`DELETE /sofa-quick-picks failed (${res.status}): ${detail}`);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sofa-quick-picks'] });
    },
  });
};

/* Commander 2026-05-28 — POS-native "New Order" flow (Topic 4 path 2:
   customer-first). POSTs a minimal SO header to /mfg-sales-orders with
   empty items[]; items can be added later from the SO detail. Returns
   the new docNo so the caller navigates to /handover-confirmed/{docNo}. */
export const useNewOrderMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      debtorName: string;
      phone?: string;
      email?: string;
      address1?: string;
      address2?: string;
      customerState?: string;
      city?: string;
      postcode?: string;
      buildingType?: string;
      customerType?: string;
      note?: string;
    }): Promise<{ docNo: string }> => {
      const res = await authedFetchRaw('/mfg-sales-orders', {
        method: 'POST',
        body: JSON.stringify({ ...body, items: [] }),
      });
      if (!res.ok) {
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
        throw new Error(`POST /mfg-sales-orders failed (${res.status}): ${detail}`);
      }
      const data = (await res.json()) as { docNo?: string; doc_no?: string };
      const docNo = data.docNo ?? data.doc_no ?? '';
      if (!docNo) throw new Error('no_doc_no_returned');
      return { docNo };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
    },
  });
};

// Houzs /api/pos/sales-staff returns only {id, staff_code, name, has_pin}; 2990's
// endpoint carried server-computed initials + color. Derive them client-side on
// the houzs path so the lock-screen picker still renders (see STAGING TODO below).
const STAFF_COLORS = ['#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#14B8A6', '#6366F1'];
const deriveInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
};
const deriveStaffColor = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return STAFF_COLORS[h % STAFF_COLORS.length]!;
};

export const useShowroomSalesStaff = () =>
  useQuery({
    queryKey: ['pos', 'sales-staff', SHOWROOM_ID ?? 'all'],
    queryFn: async (): Promise<SalesStaffRow[]> => {
      const qs = SHOWROOM_ID ? `?showroomId=${encodeURIComponent(SHOWROOM_ID)}` : '';
      let rows: SalesStaffRow[];
      if (IS_HOUZS) {
        // The pin-login staff picker lives at /api/pos (PRE-AUTH, outside the
        // /api/scm seam) and returns { staff:[{id,staff_code,name,has_pin}] }.
        // STAGING TODO: (1) confirm /api/pos/sales-staff honours X-Company-Id
        // pre-auth so only company-2 staff list; (2) initials/color are derived
        // here (2990 computed them server-side) so colours may differ; (3)
        // has_pin is NOT filtered, matching 2990's "list all showroom staff".
        const root = houzsApiRoot();
        if (!root) throw new Error('VITE_HOUZS_API_URL is not set');
        const res = await fetch(`${root}/pos/sales-staff${qs}`, { headers: { 'X-Company-Id': HOUZS_COMPANY_ID } });
        if (!res.ok) throw new Error(`GET /pos/sales-staff failed (${res.status})`);
        const { staff } = (await res.json()) as {
          staff: Array<{ id: string; staff_code: string; name: string; has_pin: boolean }>;
        };
        rows = (staff ?? []).map((s) => ({
          id: s.id,
          staffCode: s.staff_code,
          name: s.name,
          initials: deriveInitials(s.name),
          color: deriveStaffColor(s.id),
        }));
      } else {
        if (!API_URL) throw new Error('VITE_API_URL is not set');
        const res = await fetch(`${API_URL}/pos/sales-staff${qs}`);
        if (!res.ok) throw new Error(`GET /pos/sales-staff failed (${res.status})`);
        rows = (await res.json()) as SalesStaffRow[];
      }
      try { localStorage.setItem(SALES_STAFF_CACHE_KEY, JSON.stringify(rows)); } catch { /* quota */ }
      return rows;
    },
    staleTime: 5 * 60_000,
    placeholderData: () => {
      try {
        const cached = localStorage.getItem(SALES_STAFF_CACHE_KEY);
        if (cached) return JSON.parse(cached) as SalesStaffRow[];
      } catch { /* parse */ }
      return undefined;
    },
  });

/* ─── Add-product-to-placed-SO hooks (Task 5, free-item-campaign) ──────────
 *
 * Three hooks that together enable the "add product to placed SO" flow:
 *
 *   1. useSoHeaderForAdd(docNo) — fetch the SO header + customer so the
 *      configurator can show the order context and gate itself on eligibility.
 *
 *   2. useRedeemablePwpCodesForOrder(docNo) — list AVAILABLE/RESERVED PWP
 *      codes for this order's customer + source SO so the configurator can
 *      pre-fill a PWP reward code.
 *
 *   3. useAddProductToPlacedSo() — mutation → POST /:docNo/items. Surfaces
 *      the server error body (pricing_drift, pwp_code_rejected, etc.) so the
 *      calling UI can render it.
 *
 * All three mirror the existing POS patterns: authedFetch via raw fetch +
 * supabase.auth.getSession() for API routes; supabase JS client for direct
 * table reads (pwp_codes). */

/* ── 1. SO header for add-product context ──────────────────────────────── */

export interface SoHeaderForAdd {
  docNo: string;
  status: string;
  proceededAt: string | null;
  processingDate: string | null;       // internal_expected_dd
  deliveryDate: string | null;         // customer_delivery_date
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  /** True when the server's POST /:docNo/items will not reject with a scope /
   *  downstream lock. The rules mirror the server:
   *    - status === CONFIRMED (the only status that allows item edits)
   *    - not processing-locked (processing date not passed)
   *    - no downstream DO / SI (checked lazily — if the SO has been proceeded
   *      with no DO yet this stays true; the server will block a real DO lock)
   *
   *  Note: we do NOT check proceeded_at here because the server's add-item
   *  endpoint allows adding to a proceeded-but-not-DO'd SO (the downstream
   *  lock is what truly gates it, not the proceed marker). */
  addEligible: boolean;
  /** Human reason when addEligible is false (for UI display). */
  addBlockedReason: string | null;
}

/** Fetch the SO header fields needed for the add-product context.
 *
 *  Reuses the existing GET /mfg-sales-orders/:docNo API endpoint (the same
 *  one useSalesOrderDoc calls) rather than duplicating a new fetch. Returns
 *  the minimal subset the add-product flow needs: status, dates, customer.
 *
 *  addEligible mirrors the server-side gates in POST /:docNo/items:
 *    1. status CONFIRMED  (only status that accepts line edits)
 *    2. processing date not passed  (soProcessingLocked)
 *    3. no DO / SI downstream  (soHasDownstream — this hook uses the
 *       API response flag "hasDownstream" if present; falls back to safe
 *       assumption of false when the flag is absent so we don't over-block)
 */
export const useSoHeaderForAdd = (docNo: string | undefined) =>
  useQuery({
    enabled: !!docNo,
    queryKey: ['so-header-for-add', docNo],
    staleTime: 10_000,
    queryFn: async (): Promise<SoHeaderForAdd> => {
      if (!docNo) throw new Error('no docNo');
      const body = await authedFetch<{
        salesOrder: {
          doc_no: string;
          status: string;
          proceeded_at: string | null;
          internal_expected_dd: string | null;
          processing_date: string | null;
          customer_delivery_date: string | null;
          customer_id: string | null;
          debtor_name: string | null;
          phone: string | null;
        };
        /** Present when the API has computed downstream relationships.
         *  If absent (older build) we conservatively treat as no downstream. */
        hasDownstream?: boolean;
      }>(`/mfg-sales-orders/${encodeURIComponent(docNo)}`);
      const so = body.salesOrder;

      /* Mirror soProcessingLocked from the server: the lock triggers once
         internal_expected_dd OR processing_date is in the past (Malaysia UTC+8 date). */
      const todayIso = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const procDate = so.internal_expected_dd ?? so.processing_date ?? null;
      const processingLocked = procDate != null && procDate < todayIso;

      const hasDownstream = (so as { has_children?: boolean }).has_children ?? false;

      let addEligible = true;
      let addBlockedReason: string | null = null;

      if (so.status !== 'CONFIRMED') {
        addEligible = false;
        addBlockedReason = `Order is ${so.status} — items can only be added to CONFIRMED orders.`;
      } else if (processingLocked) {
        addEligible = false;
        addBlockedReason = `Processing date (${procDate!}) has passed — contact a coordinator to add items.`;
      } else if (hasDownstream) {
        addEligible = false;
        addBlockedReason = 'This order already has a delivery or invoice — items cannot be added.';
      }

      return {
        docNo: so.doc_no,
        status: so.status,
        proceededAt: so.proceeded_at ?? null,
        processingDate: procDate,
        deliveryDate: so.customer_delivery_date ?? null,
        customerId: so.customer_id ?? null,
        customerName: so.debtor_name ?? '',
        customerPhone: so.phone ?? null,
        addEligible,
        addBlockedReason,
      };
    },
  });

/* ── 2. Redeemable PWP codes for an order ──────────────────────────────── */

export interface RedeemablePwpCode {
  code: string;
  ruleId: string | null;
  /** Reward category (e.g. 'MATTRESS'). */
  rewardCategory: string;
  /** Model ids the reward must match (empty = any model). */
  eligibleRewardModelIds: string[];
  /** Combo ids for a SOFA reward (Phase 2). */
  rewardComboIds: string[];
  type: 'pwp' | 'promo';
  status: 'AVAILABLE' | 'RESERVED';
  sourceDocNo: string | null;
  customerId: string | null;
}

/** List AVAILABLE / RESERVED PWP codes that are redeemable for an order.
 *
 *  Queries pwp_codes directly via the Supabase JS client (same pattern as
 *  TbcLineEditor.tsx useSwapContext — the pwp_codes table is readable by any
 *  authed staff via RLS). Filters:
 *    - status IN ('AVAILABLE', 'RESERVED')
 *    - source_doc_no = docNo  (codes this SO earned, not yet spent)
 *
 *  The configurator also accepts manually-entered codes — this query is for
 *  auto-prefill only (saves the salesperson from typing). The server re-
 *  validates at POST /:docNo/items (pwpCode in variants), so no extra client-
 *  side category/model filter is needed here.
 *
 *  disabled when docNo is undefined (used as a conditional hook). */
export const useRedeemablePwpCodesForOrder = (docNo: string | undefined) =>
  useQuery({
    enabled: !!docNo,
    queryKey: ['pwp-codes-for-add', docNo],
    staleTime: 15_000,
    queryFn: async (): Promise<RedeemablePwpCode[]> => {
      if (!docNo) return [];
      // Houzs GET /pwp-codes/by-so/:doc → { codes: [...] } — the codes this SO
      // earned (source_doc_no = docNo), in the same camelCase shape as
      // usePwpCodesForSo. Keep the AVAILABLE/RESERVED slice (drops USED). The
      // per-SKU pwp price lives on mfg_products, not the code — so it isn't read
      // here (the reward price derives from the configured product's size).
      const { codes } = await authedFetch<{
        codes: Array<{
          code: string;
          ruleId: string | null;
          rewardCategory: string;
          eligibleRewardModelIds: string[] | null;
          rewardComboIds: string[] | null;
          type: 'pwp' | 'promo';
          status: string;
          sourceDocNo: string | null;
          customerId: string | null;
        }>;
      }>(`/pwp-codes/by-so/${encodeURIComponent(docNo)}`);
      return (codes ?? [])
        .filter((r) => r.status === 'AVAILABLE' || r.status === 'RESERVED')
        .map((r) => ({
          code: r.code,
          ruleId: r.ruleId ?? null,
          rewardCategory: r.rewardCategory,
          eligibleRewardModelIds: r.eligibleRewardModelIds ?? [],
          rewardComboIds: r.rewardComboIds ?? [],
          type: r.type,
          status: r.status as 'AVAILABLE' | 'RESERVED',
          sourceDocNo: r.sourceDocNo ?? null,
          customerId: r.customerId ?? null,
        }));
    },
  });

/* ── 3. Add product to a placed SO mutation ─────────────────────────────── */

/** Body shape for POST /mfg-sales-orders/:docNo/items.
 *  `variants` may carry `pwpCode` for PWP redemption; `freeItemCampaignId`
 *  opts the line into server-validated forced-RM0 (Task 4 / migration 0176).
 *  Mirrors PosHandoffItem but scoped to a single line (no per-SO fields). */
export interface AddSoItemBody {
  itemCode: string;
  itemGroup: 'sofa' | 'bedframe' | 'mattress' | 'accessory' | 'others';
  qty: number;
  variants: Record<string, unknown> | null;
  unitPriceCenti: number;
  discountCenti?: number;
  lineDeliveryDate?: string;
  /** free-item-campaign (migration 0176) — server validates eligibility + cap.
   *  Mutually exclusive with a pwpCode in variants. */
  freeItemCampaignId?: string | null;
}

/** Server error body from POST /:docNo/items.
 *  Mirrors PosHandoffError from pos-handover-so.ts — same API error shapes. */
export interface AddSoItemError {
  error: string;
  reason?: string;
  message?: string;
  itemCode?: string;
  client?: number;
  server?: number;
  field?: string;
  value?: string;
  allowed?: string[];
  offenders?: Array<{ id?: string; itemCode: string; group: string; missing: string[] }>;
}

export class AddSoItemApiError extends Error {
  payload: AddSoItemError;
  status: number;
  constructor(status: number, payload: AddSoItemError) {
    super(payload.reason ?? payload.message ?? payload.error ?? `POST /:docNo/items failed (${status})`);
    this.status = status;
    this.payload = payload;
  }
}

/** POST /mfg-sales-orders/:docNo/items — add a single configured line to a
 *  placed SO. On success invalidates both the 'my-orders' board and the
 *  'so-header-for-add' context so the drawer refreshes. Throws
 *  AddSoItemApiError on non-2xx so the caller can inspect the error body
 *  (pricing_drift, pwp_code_rejected, free_item_not_eligible, etc.). */
export const useAddProductToPlacedSo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      docNo,
      item,
    }: {
      docNo: string;
      item: AddSoItemBody;
    }): Promise<{ ok: boolean }> => {
      const res = await authedFetchRaw(
        `/mfg-sales-orders/${encodeURIComponent(docNo)}/items`,
        {
          method: 'POST',
          body: JSON.stringify(item),
        },
      );
      if (!res.ok) {
        let payload: AddSoItemError = { error: `http_${res.status}` };
        try {
          payload = (await res.json()) as AddSoItemError;
        } catch { /* body wasn't JSON — keep the http_NNN code */ }
        throw new AddSoItemApiError(res.status, payload);
      }
      return { ok: true };
    },
    onSuccess: (_data, { docNo }) => {
      // Refresh the My-orders board (lane + drawer) and the add-header context.
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
      void qc.invalidateQueries({ queryKey: ['so-header-for-add', docNo] });
      // Also invalidate the printable doc so SalesOrderPrint refreshes.
      void qc.invalidateQueries({ queryKey: ['so-doc-print', docNo] });
    },
  });
};
