import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sofaModulePricesFromSkus, normalizeCompartmentCode, representativeArtCode } from '@2990s/shared/sofa-build';
import { comboChargedPrices, type MfgSeatHeightPrice, type DefaultFreeGift, type FreeItemEligibility, type FreeItemCampaign } from '@2990s/shared';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/products`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /products failed (${res.status})`);
      const body = (await res.json()) as ProductsResponse;
      return body.products;
    },
    staleTime: 30_000,
  });

// Realtime subscription on `products`. Any INSERT/UPDATE/DELETE invalidates the
// catalog query so the table refetches within ~300ms — replaces the prototype's
// localStorage push from Backend → POS.
export const useCatalogRealtime = () => {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('catalog-products')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        () => {
          void qc.invalidateQueries({ queryKey: ['catalog'] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
};

/* ─── Per-product pricing (configurator screens) ───────────────────── */

export interface ProductBundleRow { bundleId: string; active: boolean; price: number }
export interface ProductCompartmentRow { compartmentId: string; active: boolean; price: number }
export interface ProductSizeRow { sizeId: string; active: boolean; price: number; pwpPrice: number | null }

export const useProduct = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId],
    queryFn: async () => {
      if (!productId) throw new Error('no productId');
      /* Legacy path: `products` is the prototype's retail catalogue table.
         Production starts EMPTY (PORT_DESIGN.md §10 Decision 10) — only
         the per-Model `mfg_products` is seeded by commander via the
         Backend SKU Master. POS Catalog cards link to `/configure/{mfg.id}`
         (the mfg SKU id), so the lookup below misses every time.

         PR — Commander 2026-05-28 (CATALOG ROUTING FIX): when products
         doesn't have the row, fall back to mfg_products + product_models
         and synthesise a CatalogProduct-shaped object the Configurator
         can render. The Configurator only touches a small subset of the
         columns (recliner_upgrade_price / seat_upgrade_label /
         seat_upgrade_footrest / depth_options / included_addons / etc.),
         so defaults are safe for now — sofa pricing data flows in from
         `useSofaCustomizerData` + `useProductCompartments` regardless.

         BUGFIX 2026-05-28 (commander caught "Loading product…" hang):
         mfg_products.id is a TEXT key shaped `mfg-<12hex>` (e.g.
         mfg-9f684f4b9336). products.id is a UUID column. Querying
         products by a non-UUID text id makes Postgres throw "invalid
         input syntax for type uuid", which the old `if (error) throw`
         propagated → the Configurator (which renders "Loading product…"
         whenever `!data`) was stuck forever. Skip the products query
         entirely for mfg- ids; only legacy UUID ids hit the retail table. */
      const isMfgId = productId.startsWith('mfg-');
      if (!isMfgId) {
        const { data, error } = await supabase
          .from('products')
          .select(
            'id, sku, name, detail, size_display, img_key, thumb_key, pricing_kind, flat_price, recliner_upgrade_price, seat_upgrade_label, seat_upgrade_footrest, depth_options, stock, low_at, visible, category_id, series_id, included_addons, updated_at',
          )
          .eq('id', productId)
          .maybeSingle();
        if (error) throw error;
        if (data) {
          return data as typeof data & {
            included_addons: { addonId: string; qty: number }[];
            seat_upgrade_label: string | null;
            seat_upgrade_footrest: boolean;
            depth_options: string | null;
            // legacy products table has no base_model column — typed optional
            // so downstream code that checks product.data?.base_model compiles.
            base_model?: string | null;
          };
        }
      }

      /* Fallback: look up by mfg_products.id (what the Catalog cards link
         to). mfg category enum → legacy pricing_kind. SOFA → 'sofa_build',
         BEDFRAME → 'bedframe_build', MATTRESS → 'size_variants', everything
         else → 'flat'. Keeps the Configurator's existing branch logic
         working without porting it to talk to mfg_products directly. */
      const { data: mfgData, error: mfgErr } = await supabase
        .from('mfg_products')
        .select(
          'id, code, name, category, description, branding, size_label, base_price_sen, sell_price_sen, included_addons, base_model, model_id',
        )
        .eq('id', productId)
        .maybeSingle();
      if (mfgErr) throw mfgErr;
      if (!mfgData) throw new Error('not_found');

      const mfg = mfgData as {
        id: string;
        code: string;
        name: string;
        category: 'SOFA' | 'BEDFRAME' | 'MATTRESS' | 'ACCESSORY' | 'SERVICE';
        description: string | null;
        branding: string | null;
        size_label: string | null;
        base_price_sen: number | null;
        sell_price_sen: number | null;
        included_addons: { addonId: string; qty: number }[] | null;
        base_model: string | null;
        model_id: string | null;
      };

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
        pricing_kind: pricingKind,
        // ACCESSORY is flat + has no variants; Loo wants even an unpriced (null)
        // or RM 0 accessory to be sellable in POS. Treat null as 0 so the
        // Configurator's FlatAddToCart renders (its gate is flat_price != null)
        // and the line books at RM 0. Server reprice has no authoritative figure
        // for a 0-base accessory → trusts the submitted 0 (no drift). Other flat
        // categories (legacy / SERVICE) keep null = "no price yet".
        flat_price:
          (mfg.sell_price_sen ?? mfg.base_price_sen) != null
            ? Math.round((mfg.sell_price_sen ?? mfg.base_price_sen)! / 100)
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

export const useAddons = () =>
  useQuery({
    queryKey: ['addons'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AddonRow[]> => {
      const { data, error } = await supabase
        .from('addons')
        .select('id, label, description, icon, kind, category, price, per_floor_item, unit, enabled, show_at_handover')
        .eq('enabled', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        description: r.description,
        icon: r.icon,
        kind: r.kind,
        category: r.category,
        price: r.price,
        perFloorItem: r.per_floor_item,
        unit: r.unit,
        enabled: r.enabled,
        showAtHandover: r.show_at_handover ?? false,
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
      const { data, error } = await supabase
        .from('addons')
        .select('id, label, description, icon, kind, category, price, per_floor_item, unit, default_qty, stock, enabled, show_at_handover, service_sku, sort_order')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id, label: r.label, description: r.description, icon: r.icon, kind: r.kind,
        category: r.category, price: r.price, perFloorItem: r.per_floor_item, unit: r.unit,
        defaultQty: r.default_qty, stock: r.stock, enabled: r.enabled,
        showAtHandover: r.show_at_handover ?? false, serviceSku: r.service_sku ?? null,
        sortOrder: r.sort_order,
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
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.price !== undefined)          update.price = patch.price;
      if (patch.perFloorItem !== undefined)   update.per_floor_item = patch.perFloorItem;
      if (patch.enabled !== undefined)        update.enabled = patch.enabled;
      if (patch.showAtHandover !== undefined) update.show_at_handover = patch.showAtHandover;
      if (patch.serviceSku !== undefined)     update.service_sku = patch.serviceSku;
      const { error } = await supabase.from('addons').update(update).eq('id', id);
      if (error) throw error;
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
      const { error } = await supabase.from('addons').insert({
        id: row.id, label: row.label, description: row.description, icon: row.icon,
        kind: row.kind, category: row.category, price: row.price,
        per_floor_item: row.perFloorItem, unit: row.unit, stock: row.stock,
        enabled: row.enabled, show_at_handover: row.showAtHandover,
        service_sku: row.serviceSku, sort_order: row.sortOrder,
      });
      if (error) throw error;
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
      const { error } = await supabase.from('addons').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAddons(qc),
  });
};

export const useProductBundles = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'bundles'],
    queryFn: async (): Promise<ProductBundleRow[]> => {
      if (!productId) throw new Error('no productId');
      // mfg-{12hex} products have no rows in product_bundles (UUID FK).
      // Their bundles are sourced from sofa_combos via useSofaCombos().
      if (productId.startsWith('mfg-')) return [];
      const { data, error } = await supabase
        .from('product_bundles')
        .select('bundle_id, active, price')
        .eq('product_id', productId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        bundleId: r.bundle_id,
        active: r.active,
        price: r.price,
      }));
    },
  });

export const useProductCompartments = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'compartments'],
    queryFn: async (): Promise<ProductCompartmentRow[]> => {
      if (!productId) throw new Error('no productId');
      // mfg-{12hex} products have no rows in product_compartments (UUID FK).
      // Their compartments are sourced from useSofaCustomizerData() → allowed_options.
      if (productId.startsWith('mfg-')) return [];
      const { data, error } = await supabase
        .from('product_compartments')
        .select('compartment_id, active, price')
        .eq('product_id', productId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        compartmentId: r.compartment_id,
        active: r.active,
        price: r.price,
      }));
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
      const { data, error } = await supabase
        .from('fabric_library')
        .select('id, label, tier, default_surcharge, active, sort_order, sofa_tier, bedframe_tier')
        .eq('active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id, label: r.label, tier: r.tier, defaultSurcharge: r.default_surcharge,
        active: r.active, sortOrder: r.sort_order,
        sofaTier: r.sofa_tier ?? null, bedframeTier: r.bedframe_tier ?? null,
      }));
    },
  });

// All active colours (global, small) — filtered per fabric in the picker.
export const useFabricColours = () =>
  useQuery({
    queryKey: ['fabric-colours'],
    queryFn: async (): Promise<FabricColourRow[]> => {
      const { data, error } = await supabase
        .from('fabric_colours')
        .select('fabric_id, colour_id, label, swatch_hex, active, sort_order')
        .eq('active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        fabricId: r.fabric_id, colourId: r.colour_id, label: r.label,
        swatchHex: r.swatch_hex, active: r.active, sortOrder: r.sort_order,
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
      const { data, error } = await supabase
        .from('mfg_products')
        .select('product_models:model_id ( allowed_options )')
        .eq('id', productId)
        .maybeSingle();
      if (error) throw error;
      const modelRel = (data as { product_models?: { allowed_options?: { fabrics?: string[] } } | null } | null)
        ?.product_models;
      return modelRel?.allowed_options?.fabrics ?? [];
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
      const { data, error } = await supabase
        .from('mfg_products')
        .select('product_models:model_id ( allowed_options )')
        .eq('id', productId)
        .maybeSingle();
      if (error) throw error;
      const modelRel = (data as { product_models?: { allowed_options?: { specials?: string[] } } | null } | null)
        ?.product_models;
      return modelRel?.allowed_options?.specials ?? [];
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
    queryFn: async (): Promise<ProductFabricRow[]> => {
      if (!productId) throw new Error('no productId');
      if (productId.startsWith('mfg-')) return [];   // mfg path uses sofaCustomizer
      const { data, error } = await supabase
        .from('product_fabrics')
        .select('fabric_id, active, surcharge')
        .eq('product_id', productId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        fabricId: r.fabric_id, active: r.active, surcharge: r.surcharge,
      }));
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
    queryFn: async (): Promise<BedframeColourRow[]> => {
      if (!productId) throw new Error('no productId');
      const [globalRes, tickRes] = await Promise.all([
        supabase
          .from('bedframe_colours')
          .select('id, label, swatch_hex, surcharge, active, sort_order')
          .eq('active', true)
          .order('sort_order'),
        // product_bedframe_colours.product_id is a UUID FK. mfg-{12hex} ids
        // have no tick rows → we skip and accept all active global colours
        // for mfg bedframe products (no per-model colour gating at pilot).
        productId.startsWith('mfg-')
          ? Promise.resolve({ data: null as null, error: null })
          : supabase
              .from('product_bedframe_colours')
              .select('colour_id, active')
              .eq('product_id', productId)
              .eq('active', true),
      ]);
      if (globalRes.error) throw globalRes.error;
      if (tickRes.error) throw tickRes.error;
      // mfg products: all active global colours available (tickRes.data = null)
      // legacy UUID products: intersect with the per-model ticked colours
      if (tickRes.data === null) {
        return (globalRes.data ?? []).map((r) => ({
          id: r.id, label: r.label, swatchHex: r.swatch_hex,
          surcharge: r.surcharge, sortOrder: r.sort_order,
        }));
      }
      const ticked = new Set((tickRes.data ?? []).map((r) => r.colour_id));
      return (globalRes.data ?? [])
        .filter((r) => ticked.has(r.id))
        .map((r) => ({
          id: r.id, label: r.label, swatchHex: r.swatch_hex,
          surcharge: r.surcharge, sortOrder: r.sort_order,
        }));
    },
  });

// Global bedframe option choice-lists (active only). Small + changes rarely
// (Backend admin), so cache aggressively like size_library — no realtime.
export const useBedframeOptions = () =>
  useQuery({
    queryKey: ['bedframe-options'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BedframeOptionRow[]> => {
      const { data, error } = await supabase
        .from('bedframe_options')
        .select('id, kind, value, surcharge, active, sort_order')
        .eq('active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id, kind: r.kind, value: r.value,
        surcharge: r.surcharge, sortOrder: r.sort_order,
      }));
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
        const { data, error } = await supabase
          .from('mfg_products')
          .select('product_models:model_id ( allowed_options )')
          .eq('id', productId)
          .maybeSingle();
        if (error) throw error;
        const modelRel = (data as { product_models?: { allowed_options?: typeof allowed } | null } | null)
          ?.product_models;
        allowed = modelRel?.allowed_options ?? {};
      }

      // Master maintenance config = the POS Master-Admin Special Add-ons pool.
      const { data: cfgRow, error: cfgErr } = await supabase
        .from('maintenance_config_history')
        .select('config')
        .eq('scope', 'master')
        .lte('effective_from', new Date().toISOString().slice(0, 10))
        .order('effective_from', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cfgErr) throw cfgErr;
      const cfg = (cfgRow?.config ?? {}) as {
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
        const { data, error } = await supabase
          .from('mfg_products')
          .select('product_models:model_id ( allowed_options )')
          .eq('id', productId)
          .maybeSingle();
        if (error) throw error;
        const ao = (data as { product_models?: { allowed_options?: Record<string, unknown> } | null } | null)
          ?.product_models?.allowed_options ?? null;
        // Empty-semantics (owner 2026-06-16): the leg_heights KEY being ABSENT
        // means "unconfigured → offer ALL legs" (sensible default for a brand-new
        // Model). The key being PRESENT — even as [] — means it was explicitly
        // configured, so it offers EXACTLY that set; an empty [] = offer NO legs.
        // This lets staff turn every leg off in the Allowed Options drawer and
        // actually hide them all (previously [] wrongly meant "show all").
        if (ao && 'leg_heights' in ao && Array.isArray((ao as { leg_heights?: unknown }).leg_heights)) {
          allowedLegs = (ao as { leg_heights: string[] }).leg_heights;
        }
      }

      const { data: cfgRow, error: cfgErr } = await supabase
        .from('maintenance_config_history')
        .select('config')
        .eq('scope', 'master')
        .lte('effective_from', new Date().toISOString().slice(0, 10))
        .order('effective_from', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cfgErr) throw cfgErr;
      const list = ((cfgRow?.config ?? {}) as { sofaLegHeights?: CfgPricedOption[] }).sofaLegHeights ?? [];
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

export const useProductSizes = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'sizes'],
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
      if (productId.startsWith('mfg-')) {
        const { data: mfgRow, error: mfgErr } = await supabase
          .from('mfg_products')
          .select('retail_product_id, model_id, size_code, base_price_sen, sell_price_sen, pwp_price_sen, base_model, category, product_models:model_id ( allowed_options )')
          .eq('id', productId)
          .maybeSingle();
        if (mfgErr) throw mfgErr;
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
        if (mfgRow.retail_product_id) {
          const { data, error } = await supabase
            .from('product_size_variants')
            .select('size_id, active, price')
            .eq('product_id', mfgRow.retail_product_id);
          if (error) throw error;
          if (data && data.length > 0) {
            // Legacy retail variants carry no PWP price (it lives on mfg_products).
            return data.map((r) => ({ sizeId: r.size_id, active: r.active, price: r.price, pwpPrice: null }));
          }
          // Fall through to mfg siblings if the retail link exists but has no variants yet.
        }

        // Helper: map sibling rows → ProductSizeRow[]. Drops sizes the Master
        // Admin turned OFF in Modular — a size is kept only if it's in the
        // Model's allowed_options.sizes (when restricted) AND its SKU is
        // pos_active (the "Visible" flag the catalog also honors). A kept size's
        // `active` still follows `status` so a cost-discontinued one greys out.
        // Case-insensitive size_code lookup guards older lowercase imports.
        const sibsToRows = (sibs: Array<{ size_code: string | null; base_price_sen: number | null; sell_price_sen: number | null; pwp_price_sen: number | null; status: string; pos_active: boolean | null }>) =>
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
              // SELLING price (0109 cost/sell split): sell_price_sen ?? base_price_sen.
              price: (s.sell_price_sen ?? s.base_price_sen) != null ? Math.round((s.sell_price_sen ?? s.base_price_sen)! / 100) : 0,
              // PWP (换购, 0128) base price per size, whole MYR. 0 / null = not set.
              pwpPrice: s.pwp_price_sen ? Math.round(s.pwp_price_sen / 100) : null,
            }));

        // 2b — derive sizes from mfg_products siblings (same model_id — set by
        // generate-skus). sibsToRows drops sizes turned OFF in Modular /
        // pos_active so they vanish from the picker (Chairman 2026-06-01).
        if (mfgRow.model_id) {
          const { data: siblings, error: sibErr } = await supabase
            .from('mfg_products')
            .select('size_code, base_price_sen, sell_price_sen, pwp_price_sen, status, pos_active')
            .eq('model_id', mfgRow.model_id);
          if (sibErr) throw sibErr;
          const rows = sibsToRows(siblings ?? []);
          if (rows.length > 0) return rows;
        }

        // 2b-alt — fallback for SKUs imported before the product_models layer
        // (model_id is NULL). Group by base_model + category instead — same
        // denormalised text that generate-skus stamps on every sibling.
        if (mfgRow.base_model && mfgRow.category) {
          const { data: siblings, error: sibErr } = await supabase
            .from('mfg_products')
            .select('size_code, base_price_sen, sell_price_sen, pwp_price_sen, status, pos_active')
            .eq('base_model', mfgRow.base_model)
            .eq('category', mfgRow.category);
          if (sibErr) throw sibErr;
          const rows = sibsToRows(siblings ?? []);
          if (rows.length > 0) return rows;
        }

        // 2c — truly orphan SKU: single size from this SKU's own code + price.
        // Case-insensitive so lowercase size_codes ('k' → 'K') are handled.
        const ownCode = (mfgRow.size_code ?? '').toUpperCase();
        if (ownCode && ownCode in MFG_SIZE_CODE_TO_LIB) {
          return [{
            sizeId: MFG_SIZE_CODE_TO_LIB[ownCode] as string,
            active: true,
            price: (mfgRow.sell_price_sen ?? mfgRow.base_price_sen) != null ? Math.round((mfgRow.sell_price_sen ?? mfgRow.base_price_sen)! / 100) : 0,
            pwpPrice: mfgRow.pwp_price_sen ? Math.round(mfgRow.pwp_price_sen / 100) : null,
          }];
        }

        return [];
      }

      // ── Legacy UUID path (retail `products` table) ──────────────────────────
      const { data, error } = await supabase
        .from('product_size_variants')
        .select('size_id, active, price')
        .eq('product_id', productId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        sizeId: r.size_id,
        active: r.active,
        price: r.price,
        pwpPrice: null, // legacy retail variants carry no PWP price
      }));
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
      const { data, error } = await supabase
        .from('size_library')
        .select('id, label, width_cm, length_cm, sort_order')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        widthCm: r.width_cm,
        lengthCm: r.length_cm,
        sortOrder: r.sort_order,
      }));
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
      const { data, error } = await supabase
        .from('categories')
        .select('id, label, icon, tbc, sort_order')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        icon: r.icon,
        tbc: r.tbc,
        sortOrder: r.sort_order,
      }));
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
    queryFn: async (): Promise<MfgCatalogRow[]> => {
      // Two-step fetch: (1) ACTIVE SKUs, (2) active Models referenced by them.
      // Supabase JS supports embedded select via the FK (mfg_products.model_id
      // → product_models.id) — the cheap path. If the embed fails (no FK
      // metadata cached) the rows still come back with a NULL model field
      // and the card falls back to the monogram placeholder.
      const { data, error } = await supabase
        .from('mfg_products')
        .select(
          'id, code, name, category, description, branding, size_label, base_price_sen, sell_price_sen, model_id, ' +
          'product_models:model_id ( id, name, photo_url, active )',
        )
        // D5 (cost/sell split Phase 2): customer catalog visibility = the
        // selling-only pos_active flag, NOT cost-side status. The Master
        // Account "Visible" toggle writes pos_active; status stays for cost/PO.
        .eq('pos_active', true)
        .order('code', { ascending: true });
      if (error) throw error;

      // PR — Use `as unknown as` two-step cast because the supabase-js return
      // type for `select(...)` with an embedded FK is sometimes inferred as
      // `GenericStringError[]` when the schema cache hasn't materialised the
      // relationship yet (same fix pattern as task #94 hotfix).
      const rows = (data ?? []) as unknown as Array<{
        id:              string;
        code:            string;
        name:            string;
        category:        MfgCatalogCategory;
        description:     string | null;
        branding:        string | null;
        size_label:      string | null;
        base_price_sen:  number | null;
        sell_price_sen:  number | null;
        model_id:        string | null;
        // Supabase embeds come back as an object OR an array depending on the
        // join cardinality the schema cache infers. mfg_products → product_models
        // is a single-record FK so we expect an object, but the type defaults
        // to an array in PostgREST. Coerce defensively.
        product_models:  { id: string; name: string; photo_url: string | null; active: boolean } |
                         Array<{ id: string; name: string; photo_url: string | null; active: boolean }> |
                         null;
      }>;

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
            basePriceSen: r.sell_price_sen ?? r.base_price_sen, // SELLING (0109 cost/sell split)
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
  if (/^STOOL|^Console|^WC-/i.test(norm)) return 'Accessory';
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

      // Step 1: resolve the SKU → Model. mfg_products carries the model_id FK.
      const { data: sku, error: skuErr } = await supabase
        .from('mfg_products')
        .select('id, model_id, category, product_models:model_id ( id, name, model_code, allowed_options, active )')
        .eq('id', leadSkuId)
        .maybeSingle();
      if (skuErr) throw skuErr;
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
      const { data: skuPriceRows, error: skuPriceErr } = await supabase
        .from('mfg_products')
        .select('code, sell_price_sen, seat_height_prices')
        .eq('base_model', model.model_code)
        .eq('category', 'SOFA');
      if (skuPriceErr) throw skuPriceErr;
      // Raw per-module SELLING rows. The flat `modulePrices` (depth/tier-agnostic
      // sell_price_sen) is the fallback; the Configurator rebuilds a depth-aware
      // P1 selling map from `sellingRows` so the per-seat-size grid price reaches
      // the live total + palette (SOFA-SELLING Phase B; Chairman 2026-06-01: run
      // at P1, no fabric-tier variation yet).
      const sellingRows = ((skuPriceRows ?? []) as Array<{
        code: string;
        sell_price_sen: number | null;
        seat_height_prices: MfgSeatHeightPrice[] | null;
      }>).map((r) => ({
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

      // Step 2: pull the current effective master maintenance config so we
      // can resolve compartment images + descriptions + default prices.
      const { data: cfgRow, error: cfgErr } = await supabase
        .from('maintenance_config_history')
        .select('config')
        .eq('scope', 'master')
        .lte('effective_from', new Date().toISOString().slice(0, 10))
        .order('effective_from', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cfgErr) throw cfgErr;
      const cfg = (cfgRow?.config ?? {}) as {
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
  });

/** Realtime invalidate on mfg_products + product_models edits so commander's
 *  Backend changes land on the POS catalog within ~300ms. Mirrors the
 *  prototype's localStorage push but via Supabase Realtime. */
export const useMfgCatalogRealtime = () => {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('mfg-catalog')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mfg_products' },
        () => { void qc.invalidateQueries({ queryKey: ['mfg-catalog'] }); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_models' },
        () => { void qc.invalidateQueries({ queryKey: ['mfg-catalog'] }); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc]);
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
const LOCALITY_PAGE = 1000;
export const useLocalities = () =>
  useQuery({
    queryKey: ['my_localities'],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<LocalityRow[]> => {
      const all: LocalityRow[] = [];
      for (let from = 0; ; from += LOCALITY_PAGE) {
        const { data, error } = await supabase
          .from('my_localities')
          .select('postcode, city, state, state_code')
          .order('state')
          .order('city')
          .order('postcode')
          .range(from, from + LOCALITY_PAGE - 1);
        if (error) throw error;
        const page = data ?? [];
        for (const r of page) {
          all.push({ postcode: r.postcode, city: r.city, state: r.state, stateCode: r.state_code });
        }
        if (page.length < LOCALITY_PAGE) break;
      }
      return all;
    },
  });

/** PR — Commander 2026-05-28: realtime invalidate the sofa customizer
 *  cache whenever commander edits the Model row (allowed_options) OR the
 *  master maintenance_config_history row (compartment meta). Mirrors the
 *  catalog realtime hook; mount inside the Configurator so a price/photo
 *  tweak in the Backend lands within ~300ms. */
export const useSofaCustomizerRealtime = (leadSkuId: string | undefined) => {
  const qc = useQueryClient();
  useEffect(() => {
    if (!leadSkuId) return;
    const channel = supabase
      .channel(`sofa-customizer-${leadSkuId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_models' },
        () => { void qc.invalidateQueries({ queryKey: ['sofa-customizer-data', leadSkuId] }); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'maintenance_config_history' },
        () => { void qc.invalidateQueries({ queryKey: ['sofa-customizer-data', leadSkuId] }); },
      )
      // SOFA-SELLING-PLAN — the customizer now reads per-Model module SKU
      // sell_price_sen, so a Master-Admin price edit (mfg_products) must
      // re-fetch the configurator's module prices within ~300ms.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mfg_products' },
        () => { void qc.invalidateQueries({ queryKey: ['sofa-customizer-data', leadSkuId] }); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc, leadSkuId]);
};

// Realtime invalidate any product_bundles / product_compartments / product_size_variants
// row matching this productId. Used inside Configurator so Backend price tweaks
// land within ~300ms.
export const useProductPricingRealtime = (productId: string | undefined) => {
  const qc = useQueryClient();
  useEffect(() => {
    if (!productId) return;
    const channel = supabase
      .channel(`product-pricing-${productId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_bundles', filter: `product_id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['product', productId, 'bundles'] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_compartments', filter: `product_id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['product', productId, 'compartments'] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_fabrics', filter: `product_id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['product', productId, 'fabrics'] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_bedframe_colours', filter: `product_id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['bedframe-colours', productId] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_size_variants', filter: `product_id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['product', productId, 'sizes'] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products', filter: `id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['product', productId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, productId]);
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/delivery-fees`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /delivery-fees failed (${res.status})`);
      const body = (await res.json()) as {
        baseFee:                  number;
        crossCategoryFee:         number;
        mattressBedframeLeadDays: number;
        sofaLeadDays:             number;
      };
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/fabric-tier-addon`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /fabric-tier-addon failed (${res.status})`);
      const body = (await res.json()) as FabricTierAddonConfigRow;
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/delivery-fees`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
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

/* ─── Per-Model special delivery fees (migration 0140) ─── */

export interface SpecialDeliveryFeeRow {
  modelId:             string;
  modelName:           string;
  modelCode:           string | null;
  category:            string | null;
  standaloneFee:       number;   // whole MYR
  crossCatFollowupFee: number;   // whole MYR
}

/** List the Models tagged with a special delivery fee. Read by the Master
 *  editor AND the Handover summary (so the shown fee matches what the server
 *  charges when a special model is in the cart). */
export const useSpecialDeliveryFees = () =>
  useQuery({
    queryKey: ['special-delivery-fees'],
    queryFn: async (): Promise<SpecialDeliveryFeeRow[]> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/delivery-fees/special`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /delivery-fees/special failed (${res.status})`);
      return (await res.json()) as SpecialDeliveryFeeRow[];
    },
    staleTime: 60_000,
  });

export const useUpsertSpecialDeliveryFee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { modelId: string; standaloneFee: number; crossCatFollowupFee: number }) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/delivery-fees/special`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
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
    mutationFn: async (modelId: string) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/delivery-fees/special/${encodeURIComponent(modelId)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `DELETE /delivery-fees/special failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['special-delivery-fees'] }); },
  });
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const qs = new URLSearchParams({ docNo: docNo.trim(), phone: phone.trim() });
      const res = await fetch(`${API_URL}/mfg-sales-orders/cross-category-eligibility?${qs.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`eligibility check failed (${res.status})`);
      return (await res.json()) as CrossCategoryEligibility;
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const qs = new URLSearchParams({ name: name.trim(), phone: phone.trim() });
      const res = await fetch(`${API_URL}/mfg-sales-orders/cross-category-match?${qs.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`auto-match failed (${res.status})`);
      return (await res.json()) as CrossCategoryMatchResult;
    },
  });

/** Master Admin — writes the 4 fabric-tier Δ amounts (PATCH /fabric-tier-addon).
 *  Gated by the fabric_tier_addon_config UPDATE RLS + API WRITE_ROLES (0124). */
export const useUpdateFabricTierAddonConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<FabricTierAddonConfigRow>) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/fabric-tier-addon`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/fabric-library/${encodeURIComponent(id)}/tier`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/fabric-tier-addon/special`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /fabric-tier-addon/special failed (${res.status})`);
      return (await res.json()) as ModelFabricTierOverrideRow[];
    },
    staleTime: 60_000,
  });

export const useUpsertModelFabricTierOverride = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { modelId: string; tier2Delta: number | null; tier3Delta: number | null }) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/fabric-tier-addon/special`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/fabric-tier-addon/special/${encodeURIComponent(modelId)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `DELETE /fabric-tier-addon/special failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['model-fabric-tier-overrides'] }); },
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/model-free-gifts`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`GET /model-free-gifts failed (${res.status})`);
      return (await res.json()) as ModelDefaultGiftRow[];
    },
    staleTime: 60_000,
  });

export const useUpsertModelDefaultGifts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { modelId: string; gifts: DefaultFreeGift[] }) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/model-free-gifts`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/model-free-gifts/${encodeURIComponent(modelId)}`, {
        method: 'DELETE', headers: { authorization: `Bearer ${token}` },
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
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.body ? { 'content-type': 'application/json' } : {}) },
  });
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

async function authToken(): Promise<string> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return token;
}

export const useSpecialAddons = () =>
  useQuery({
    queryKey: ['special-addons'],
    staleTime: 60_000,
    queryFn: async (): Promise<SpecialAddonRow[]> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const res = await fetch(`${API_URL}/special-addons`, {
        headers: { authorization: `Bearer ${await authToken()}` },
      });
      if (!res.ok) throw new Error(`GET /special-addons failed (${res.status})`);
      const body = (await res.json()) as { addons: SpecialAddonRow[] };
      return body.addons ?? [];
    },
  });

export const useCreateSpecialAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SpecialAddonInput) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const res = await fetch(`${API_URL}/special-addons`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await authToken()}`, 'content-type': 'application/json' },
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const res = await fetch(`${API_URL}/special-addons/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${await authToken()}`, 'content-type': 'application/json' },
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const res = await fetch(`${API_URL}/special-addons/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${await authToken()}` },
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const params = new URLSearchParams();
      if (window?.from) params.set('from', window.from);
      if (window?.to)   params.set('to', window.to);
      // Owner-tier only: scope the Personal card to a chosen salesperson.
      if (salesperson && salesperson !== 'all') params.set('salesperson', salesperson);
      const qs = params.toString();
      const res = await fetch(`${API_URL}/pos/sales-stats${qs ? `?${qs}` : ''}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /pos/sales-stats failed (${res.status})`);
      return await res.json() as SalesStatsRow;
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
  /** Combo Price 2/3 by fabric tier (Option B, migration 0179). EXPLICIT per-tier
   *  selling price per height. {} = inherit price1 + the flat fabric-tier add-on
   *  (byte-identical to pre-Option-B). The Configurator resolves the line's
   *  fabric tier and (when set) charges the tier map + suppresses the flat Δ. */
  price2ByHeight?: Record<string, number | null>;
  price3ByHeight?: Record<string, number | null>;
  /** Raw COST map (Option B). `pricesByHeight` is overwritten with the merged
   *  charged map below; the tier re-merge needs the original cost side. */
  costPricesByHeight?: Record<string, number | null>;
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
      if (!API_URL) return [];
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return [];  // POS may render anonymously; quietly skip
      const params = new URLSearchParams();
      if (baseModel) params.set('baseModel', baseModel);
      params.set('customerId', '__all__');  // 2990 is B2C — only default-scope rows
      const res = await fetch(
        `${API_URL}/sofa-combos?${params.toString()}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return [];
      const body = (await res.json()) as { rules: SofaComboRow[] };
      // The engine's pricesByHeight is the CHARGED (selling) price: selling wins
      // per height, falling back to cost. Same merge the server gate uses, so
      // POS live total and server recompute price from one source.
      return (body.rules ?? []).map((r) => ({
        ...r,
        // Keep the raw cost side for the Option-B per-tier re-merge (the merge
        // below overwrites pricesByHeight with the charged price1 map).
        costPricesByHeight: r.pricesByHeight,
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/sofa-combos`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
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
      if (!API_URL) return [];
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return [];  // POS may render anonymously; quietly skip
      const params = new URLSearchParams();
      if (baseModel) params.set('baseModel', baseModel);
      const res = await fetch(
        `${API_URL}/sofa-quick-picks${params.toString() ? `?${params.toString()}` : ''}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return [];
      const body = (await res.json()) as { picks: SofaQuickPickRow[] };
      return body.picks ?? [];
    },
    staleTime: 30_000,
  });

/** Realtime: invalidate the global Quick Picks when Master Admin curates. */
export const useSofaQuickPicksRealtime = () => {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('sofa-quick-picks')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sofa_quick_picks' },
        () => { void qc.invalidateQueries({ queryKey: ['sofa-quick-picks'] }); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc]);
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/sofa-quick-picks`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/sofa-quick-picks/${id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/mfg-sales-orders`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
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

export const useShowroomSalesStaff = () =>
  useQuery({
    queryKey: ['pos', 'sales-staff', SHOWROOM_ID ?? 'all'],
    queryFn: async (): Promise<SalesStaffRow[]> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const qs = SHOWROOM_ID ? `?showroomId=${encodeURIComponent(SHOWROOM_ID)}` : '';
      const res = await fetch(`${API_URL}/pos/sales-staff${qs}`);
      if (!res.ok) throw new Error(`GET /pos/sales-staff failed (${res.status})`);
      const rows = (await res.json()) as SalesStaffRow[];
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      if (!docNo) throw new Error('no docNo');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/mfg-sales-orders/${encodeURIComponent(docNo)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /mfg-sales-orders/${docNo} failed (${res.status})`);
      const body = (await res.json()) as {
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
      };
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
      // NOTE: do NOT select pwp_price_sen here — that column lives on
      // mfg_products (the reward SKU's per-size PWP price), NOT on pwp_codes.
      // Selecting it made PostgREST 400 ("column does not exist"), so the query
      // threw and no order code was ever auto-filled in addToOrder mode. The
      // reward price is derived from the configured product's size, not the code.
      const { data, error } = await supabase
        .from('pwp_codes')
        .select(
          'code, rule_id, reward_category, eligible_reward_model_ids, reward_combo_ids, type, status, source_doc_no, customer_id',
        )
        .eq('source_doc_no', docNo)
        .in('status', ['AVAILABLE', 'RESERVED']);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        code: r.code as string,
        ruleId: (r.rule_id as string | null) ?? null,
        rewardCategory: r.reward_category as string,
        eligibleRewardModelIds: (r.eligible_reward_model_ids as string[] | null) ?? [],
        rewardComboIds: (r.reward_combo_ids as string[] | null) ?? [],
        type: r.type as 'pwp' | 'promo',
        status: r.status as 'AVAILABLE' | 'RESERVED',
        sourceDocNo: (r.source_doc_no as string | null) ?? null,
        customerId: (r.customer_id as string | null) ?? null,
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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(
        `${API_URL}/mfg-sales-orders/${encodeURIComponent(docNo)}/items`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
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
